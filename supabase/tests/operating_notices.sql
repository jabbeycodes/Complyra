begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a4000000-0000-0000-0000-000000000001','Notice agency A','NOTEA-MO','MO','active'),
 ('a4000000-0000-0000-0000-000000000002','Notice agency B','NOTEB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Cedar');
insert into auth.users(id,email) values
 ('d4000000-0000-0000-0000-000000000001','notice-admin@example.invalid'),
 ('d4000000-0000-0000-0000-000000000002','notice-dsp@example.invalid'),
 ('d4000000-0000-0000-0000-000000000004','notice-admin-b@example.invalid');
update profiles set must_change_password=false,home_agency_id='a4000000-0000-0000-0000-000000000001'
 where id in ('d4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002');
update profiles set must_change_password=false,home_agency_id='a4000000-0000-0000-0000-000000000002'
 where id='d4000000-0000-0000-0000-000000000004';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','dsp','dsp','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000004','administrator','administrator',null);

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000002"}',true);

select lives_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Morgan · Day. Needed from Alex.',
  '/plans',
  'person-1',
  'documentation.missing_note:one'
)$$, 'A member can queue their own missing-note notice');

select lives_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Morgan · Day. Needed from Alex.',
  '/plans',
  'person-1',
  'documentation.missing_note:one'
)$$, 'The same notice is not inserted twice');

select lives_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000001',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Cedar: Morgan · Day. Needed from Alex.',
  '/plans',
  'person-1',
  'documentation.missing_note:manager'
)$$, 'A member with clinical access can notify a manager');

select throws_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000001',
  'd4000000-0000-0000-0000-000000000002',
  null,
  'not.a.notice',
  'No',
  'No',
  '/plans',
  'person-1',
  'bad-type'
)$$, 'P0001', 'Unsupported notice', 'Unknown notice types are rejected');

select throws_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000002',
  'd4000000-0000-0000-0000-000000000002',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Other agency',
  '/plans',
  'person-1',
  'other-agency'
)$$, 'P0001', 'Not allowed', 'A notice cannot be queued for another agency');

select throws_ok($$select queue_operating_notice(
  'a4000000-0000-0000-0000-000000000001',
  null,
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Nobody',
  '/plans',
  'person-1',
  'nobody'
)$$, 'P0001', 'A notice needs a person or a role', 'A notice needs a person or a role');

reset role;
select is(
  (select count(*)::int from public.notifications where dedupe_key = 'documentation.missing_note:one'),
  1,
  'One dedupe key stores one row'
);
select is(
  (select entity_type from public.notifications where dedupe_key = 'documentation.missing_note:manager'),
  'shift_note',
  'A missing Shift note is not stored as a medication'
);

select * from finish();
rollback;
