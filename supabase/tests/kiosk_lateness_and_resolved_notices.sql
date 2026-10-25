begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a5100000-0000-0000-0000-000000000001','Kiosk agency','KIOSK-MO','MO','active');
insert into programs (id, agency_id, name) values
 ('b5100000-0000-0000-0000-000000000001','a5100000-0000-0000-0000-000000000001','Program');
insert into sites (id, agency_id, program_id, name) values
 ('c5100000-0000-0000-0000-000000000001','a5100000-0000-0000-0000-000000000001','b5100000-0000-0000-0000-000000000001','Cedar');
insert into auth.users (id, email, raw_user_meta_data) values (
 'd5100000-0000-0000-0000-000000000001',
 'kiosk-dsp@example.invalid',
 jsonb_build_object(
   'full_name', 'Alex Morgan',
   'home_agency_id', 'a5100000-0000-0000-0000-000000000001',
   'must_change_password', false
 )
);
insert into memberships (agency_id, user_id, role, role_key, site_id) values
 ('a5100000-0000-0000-0000-000000000001','d5100000-0000-0000-0000-000000000001','dsp','dsp','c5100000-0000-0000-0000-000000000001');
insert into individuals (id, agency_id, site_id, full_name, date_of_birth) values
 ('e5100000-0000-0000-0000-000000000001','a5100000-0000-0000-0000-000000000001','c5100000-0000-0000-0000-000000000001','Ellis Hart','1990-01-01');
insert into hr_kiosk_tokens (agency_id, site_id, token_hash, active) values
 ('a5100000-0000-0000-0000-000000000001',
  'c5100000-0000-0000-0000-000000000001',
  encode(digest('kiosk-token', 'sha256'), 'hex'),
  true);
insert into hr_punches (
  agency_id, site_id, staff_id, kind, punched_at, source, created_by, verification_method
) values
 ('a5100000-0000-0000-0000-000000000001',
  'c5100000-0000-0000-0000-000000000001',
  'd5100000-0000-0000-0000-000000000001',
  'in',
  '2026-10-15 14:20:00+00',
  'kiosk',
  'd5100000-0000-0000-0000-000000000001',
  'kiosk_pin');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $$select note_kiosk_late_clock_in('wrong-token', 'd5100000-0000-0000-0000-000000000001', '2026-10-15 14:00:00+00', '2026-10-15 14:20:00+00', 'late-1')$$,
  'invalid kiosk token',
  'A bad kiosk token cannot record a point'
);

select is(
  note_kiosk_late_clock_in(
    'kiosk-token',
    'd5100000-0000-0000-0000-000000000001',
    '2026-10-15 14:10:00+00',
    '2026-10-15 14:20:00+00',
    'late-on-time'
  ),
  false,
  'A clock-in inside 15 minutes does not cost a point'
);

select is(
  note_kiosk_late_clock_in(
    'kiosk-token',
    'd5100000-0000-0000-0000-000000000001',
    '2026-10-15 14:00:00+00',
    '2026-10-15 14:20:00+00',
    'late-kiosk-1'
  ),
  true,
  'A clock-in 20 minutes late records a point'
);

select is(
  note_kiosk_late_clock_in(
    'kiosk-token',
    'd5100000-0000-0000-0000-000000000001',
    '2026-10-15 14:00:00+00',
    '2026-10-15 14:20:00+00',
    'late-kiosk-1'
  ),
  false,
  'The same clock-in does not record a second point'
);

reset role;

select is(
  (select count(*) from notifications where dedupe_key = 'late-kiosk-1'),
  1::bigint,
  'One late clock-in notice is stored'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d5100000-0000-0000-0000-000000000001"}',
  true
);
set local role authenticated;

select queue_operating_notice(
  'a5100000-0000-0000-0000-000000000001',
  'd5100000-0000-0000-0000-000000000001',
  null,
  'documentation.missing_note',
  'Missing Shift note',
  'Ellis · Day',
  '/plans',
  'e5100000-0000-0000-0000-000000000001',
  'documentation.missing_note:sn:2026-10-14:e5100000-0000-0000-0000-000000000001:day:d5100000-0000-0000-0000-000000000001:2026-10-15'
);

select is(
  resolve_missing_note_notices(
    'e5100000-0000-0000-0000-000000000001',
    '2026-10-14',
    'evening'
  ),
  0,
  'An evening note does not clear a day reminder'
);

select is(
  resolve_missing_note_notices(
    'e5100000-0000-0000-0000-000000000001',
    '2026-10-14',
    'day'
  ),
  1,
  'Filing the day note clears the day reminder'
);

select is(
  (select read_at is not null from notifications
    where dedupe_key = 'documentation.missing_note:sn:2026-10-14:e5100000-0000-0000-0000-000000000001:day:d5100000-0000-0000-0000-000000000001:2026-10-15'),
  true,
  'The day reminder is marked read'
);

select * from finish();
rollback;
