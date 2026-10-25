begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(4);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a6100000-0000-0000-0000-000000000001','System notice agency','SYSNOTE-MO','MO','active');
insert into auth.users(id,email) values
 ('d6100000-0000-0000-0000-000000000001','system-notice@example.invalid');
update profiles set must_change_password=false,home_agency_id='a6100000-0000-0000-0000-000000000001'
 where id='d6100000-0000-0000-0000-000000000001';

select lives_ok($$select queue_system_notice(
  'a6100000-0000-0000-0000-000000000001',
  'd6100000-0000-0000-0000-000000000001',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Morgan · Day. Needed from Alex.',
  '/plans/morgan#chart-shift-notes',
  'morgan',
  'documentation.missing_note:system-one'
)$$, 'The service role can queue a missing-note notice');

select lives_ok($$select queue_system_notice(
  'a6100000-0000-0000-0000-000000000001',
  'd6100000-0000-0000-0000-000000000001',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Morgan · Day. Needed from Alex.',
  '/plans/morgan#chart-shift-notes',
  'morgan',
  'documentation.missing_note:system-one'
)$$, 'A second run does not insert another row');

select is(
  (select count(*) from notifications where dedupe_key = 'documentation.missing_note:system-one'),
  1::bigint,
  'One notice is stored'
);

select set_config('request.jwt.claims', '{"role":"authenticated","sub":"d6100000-0000-0000-0000-000000000001"}', true);
select throws_ok($$select queue_system_notice(
  'a6100000-0000-0000-0000-000000000001',
  'd6100000-0000-0000-0000-000000000001',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'No',
  '/plans',
  'morgan',
  'documentation.missing_note:system-two'
)$$, 'P0001', 'Not allowed', 'A signed-in member cannot use the system notice');

select * from finish();
rollback;
