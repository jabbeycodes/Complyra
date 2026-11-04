begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(5);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Binder template write gate (20261104110000): administrators and program
-- managers write; HR, which holds certificates.manage, reads only.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a4000000-0000-0000-0000-000000000001','Binder template agency','BINDTMPL-MO','MO','active');
insert into auth.users(id,email) values
 ('d4000000-0000-0000-0000-000000000001','tmpl-admin@example.invalid'),
 ('d4000000-0000-0000-0000-000000000002','tmpl-pm@example.invalid'),
 ('d4000000-0000-0000-0000-000000000003','tmpl-hr@example.invalid');
update profiles set must_change_password=false,home_agency_id='a4000000-0000-0000-0000-000000000001'
 where id::text like 'd4000000-%';
insert into memberships(agency_id,user_id,role,role_key) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','admin','administrator'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','manager','program_manager'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000003','hr','hr');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
select throws_ok($$insert into hr_binder_templates(agency_id,template)
  values ('a4000000-0000-0000-0000-000000000001','{"sections":[]}'::jsonb)$$,
  '42501',null,'HR cannot create a binder template');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into hr_binder_templates(agency_id,template)
  values ('a4000000-0000-0000-0000-000000000001','{"sections":[],"by":"admin"}'::jsonb)$$,
  'An administrator can create a binder template');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update hr_binder_templates set template='{"sections":[],"by":"pm"}'::jsonb
  where agency_id='a4000000-0000-0000-0000-000000000001'$$,
  'A program manager can edit a binder template');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
update hr_binder_templates set template='{"sections":[],"by":"hr"}'::jsonb
 where agency_id='a4000000-0000-0000-0000-000000000001';
select is((select template->>'by' from hr_binder_templates where agency_id='a4000000-0000-0000-0000-000000000001'),'pm',
  'An HR edit changes nothing');
select is((select count(*) from hr_binder_templates where agency_id='a4000000-0000-0000-0000-000000000001'),1::bigint,
  'HR can still read the template binders snapshot');

select * from finish();
rollback;
