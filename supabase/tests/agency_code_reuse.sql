begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- F-2 (20261112220000): a rejected application no longer squats its
-- provider code. The partial unique index keeps at most one LIVE holder
-- per code; rejected rows keep the code as history, and resolve_login
-- prefers the live row when one username exists under both.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2000000-0000-0000-0000-000000000001','Rejected applicant','CODETEST-MO','MO','rejected');

select lives_ok($$insert into agencies (id, name, agency_code, state_code, status)
  values ('a2000000-0000-0000-0000-000000000002','Second applicant','CODETEST-MO','MO','pending')$$,
  'A live application can take a code a rejected row still shows');

select throws_ok($$insert into agencies (id, name, agency_code, state_code, status)
  values ('a2000000-0000-0000-0000-000000000003','Third applicant','CODETEST-MO','MO','active')$$,
  '23505', null, 'A second live holder of the same code is refused');

select lives_ok($$insert into agencies (id, name, agency_code, state_code, status)
  values ('a2000000-0000-0000-0000-000000000004','Fourth applicant','CODETEST-MO','MO','rejected')$$,
  'Another rejected row may share the code as history');

insert into auth.users (id, email) values
 ('d2000000-0000-0000-0000-000000000001','shared.admin@codetest-mo.complyrer.user'),
 ('d2000000-0000-0000-0000-000000000002','shared.admin+a2000000@codetest-mo.complyrer.user'),
 ('d2000000-0000-0000-0000-000000000003','only.rejected@codetest-mo.complyrer.user');
update profiles set username = 'shared.admin',
  home_agency_id = 'a2000000-0000-0000-0000-000000000001'
 where id = 'd2000000-0000-0000-0000-000000000001';
update profiles set username = 'shared.admin',
  home_agency_id = 'a2000000-0000-0000-0000-000000000002'
 where id = 'd2000000-0000-0000-0000-000000000002';
update profiles set username = 'only.rejected',
  home_agency_id = 'a2000000-0000-0000-0000-000000000001'
 where id = 'd2000000-0000-0000-0000-000000000003';

select is((select email from public.resolve_login('CODETEST-MO', 'shared.admin')),
  'shared.admin+a2000000@codetest-mo.complyrer.user',
  'resolve_login signs in the live agency admin when a username exists under both rows');

select is((select email from public.resolve_login('CODETEST-MO', 'only.rejected')),
  'only.rejected@codetest-mo.complyrer.user',
  'A username that exists only on the rejected row still resolves to it');

select * from finish();
rollback;
