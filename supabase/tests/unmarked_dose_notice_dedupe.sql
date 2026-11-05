begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Unmarked-dose notice dedupe (20261104120000): one row per home, recipient,
-- and agency day however many sweeps run; the reminder cadence lives on it.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a5000000-0000-0000-0000-000000000001','Unmarked agency','UNMARKED-MO','MO','active');
insert into auth.users(id,email) values
 ('d5000000-0000-0000-0000-000000000001','unmarked-hm@example.invalid'),
 ('d5000000-0000-0000-0000-000000000002','unmarked-other@example.invalid');
update profiles set must_change_password=false,home_agency_id='a5000000-0000-0000-0000-000000000001'
 where id::text like 'd5000000-%';
insert into memberships(agency_id,user_id,role,role_key) values
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001','manager','house_manager'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002','manager','house_manager');

select queue_system_notice('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001',null,
  'med.unrecorded','Unmarked medication','Home has 1 unmarked dose past the window.','/meds','site-1','med.unrecorded:site-1:hm:2026-11-04');
select queue_system_notice('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001',null,
  'med.unrecorded','Unmarked medication','Home has 1 unmarked dose past the window.','/meds','site-1','med.unrecorded:site-1:hm:2026-11-04');
select is((select count(*) from notifications where agency_id='a5000000-0000-0000-0000-000000000001'),1::bigint,
  'A second sweep of the same day stores no second notice');

select is(rearm_unmarked_dose_notices('a5000000-0000-0000-0000-000000000001',
  '[{"dedupe_key":"med.unrecorded:site-1:hm:2026-11-04","body":"Home has 2 unmarked doses past the window."}]'::jsonb,60),0,
  'An unread notice has nothing to re-arm');
select is((select body from notifications where agency_id='a5000000-0000-0000-0000-000000000001'),
  'Home has 2 unmarked doses past the window.','The sweep refreshes the count on the one row');

update notifications set read_at = now() - interval '5 minutes'
 where agency_id='a5000000-0000-0000-0000-000000000001';
select is(rearm_unmarked_dose_notices('a5000000-0000-0000-0000-000000000001',
  '[{"dedupe_key":"med.unrecorded:site-1:hm:2026-11-04","body":"Home has 2 unmarked doses past the window."}]'::jsonb,60),0,
  'A notice read inside the interval stays read');

update notifications set read_at = now() - interval '61 minutes'
 where agency_id='a5000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000002"}',true);
select is(rearm_unmarked_dose_notices('a5000000-0000-0000-0000-000000000001',
  '[{"dedupe_key":"med.unrecorded:site-1:hm:2026-11-04","body":"Tampered"}]'::jsonb,60),0,
  'A member cannot re-arm another person''s notice');
-- Read back outside the member's role: the notice belongs to someone else, so
-- RLS hides it from any authenticated read and the check would see NULL.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select body from public.notifications where agency_id='a5000000-0000-0000-0000-000000000001'),
  'Home has 2 unmarked doses past the window.','A member cannot rewrite another person''s notice');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000001"}',true);
select is(rearm_unmarked_dose_notices('a5000000-0000-0000-0000-000000000001',
  '[{"dedupe_key":"med.unrecorded:site-1:hm:2026-11-04","body":"Home has 2 unmarked doses past the window."}]'::jsonb,60),1,
  'A member re-arms their own notice after the interval');
select is((select read_at from notifications where agency_id='a5000000-0000-0000-0000-000000000001'),null::timestamptz,
  'The re-armed notice is unread again');
select is((select count(*) from notifications where agency_id='a5000000-0000-0000-0000-000000000001'),1::bigint,
  'Re-arming adds no row');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select queue_system_notice('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001',null,
  'med.unrecorded','Unmarked medication','Home has 1 unmarked dose past the window.','/meds','site-1','med.unrecorded:site-1:hm:2026-11-05');
select is(rearm_unmarked_dose_notices('a5000000-0000-0000-0000-000000000001',
  '[{"dedupe_key":"med.unrecorded:site-1:hm:2026-11-05","body":"Home has 1 unmarked dose past the window."}]'::jsonb,60),0,
  'The unattended sweep runs for a new day');
select is((select count(*) from notifications where agency_id='a5000000-0000-0000-0000-000000000001' and read_at is null),1::bigint,
  'A new day retires the earlier unread row: one unread row per home and recipient');

-- The one-time retirement predicate: slot keys match, event keys do not.
select ok('med.unrecorded:site-1:hm:495123' ~ '^med\.unrecorded:[^:]+:[^:]+:[0-9]+$','An old slot key is retired');
select ok(not 'med.unrecorded:site-1:hm:2026-11-04' ~ '^med\.unrecorded:[^:]+:[^:]+:[0-9]+$','A new day key is not retired');

select * from finish();
rollback;
