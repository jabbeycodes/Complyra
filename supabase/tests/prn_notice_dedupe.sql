begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- PRN notice dedupe (20261031330000): an event-keyed notice is one row however
-- many sweeps run, and the repeat reminder re-arms that row instead of adding one.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a3000000-0000-0000-0000-000000000001','PRN agency','PRNDEDUP-MO','MO','active');
insert into auth.users(id,email) values
 ('d3000000-0000-0000-0000-000000000001','prn-hm@example.invalid'),
 ('d3000000-0000-0000-0000-000000000002','prn-other@example.invalid');
update profiles set must_change_password=false,home_agency_id='a3000000-0000-0000-0000-000000000001'
 where id::text like 'd3000000-%';
insert into memberships(agency_id,user_id,role,role_key) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','manager','house_manager'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','manager','house_manager');

select queue_system_notice('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',null,
  'med.prn_repeat','PRN follow-up still open','Open','/meds','med-1','med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z');
select queue_system_notice('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',null,
  'med.prn_repeat','PRN follow-up still open','Open','/meds','med-1','med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z');
select is((select count(*) from notifications where agency_id='a3000000-0000-0000-0000-000000000001'),1::bigint,
  'A second sweep of the same dose stores no second notice');

update notifications set read_at = now() - interval '5 minutes'
 where agency_id='a3000000-0000-0000-0000-000000000001';
select is(rearm_prn_repeat_notices('a3000000-0000-0000-0000-000000000001',
  array['med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z'],15),0,'A notice read inside the interval stays read');

update notifications set read_at = now() - interval '20 minutes'
 where agency_id='a3000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000002"}',true);
select is(rearm_prn_repeat_notices('a3000000-0000-0000-0000-000000000001',
  array['med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z'],15),0,'A member cannot re-arm another person''s notice');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select is(rearm_prn_repeat_notices('a3000000-0000-0000-0000-000000000001',
  array['med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z'],15),1,'A member re-arms their own notice after the interval');
select is((select read_at from notifications where agency_id='a3000000-0000-0000-0000-000000000001'),null::timestamptz,
  'The re-armed notice is unread again');
select is((select count(*) from notifications where agency_id='a3000000-0000-0000-0000-000000000001'),1::bigint,
  'Re-arming adds no row');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update notifications set read_at = now() - interval '20 minutes'
 where agency_id='a3000000-0000-0000-0000-000000000001';
select is(rearm_prn_repeat_notices('a3000000-0000-0000-0000-000000000001',
  array['med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z'],15),1,'The unattended sweep re-arms any recipient''s notice');

-- The one-time retirement predicate: slot keys match, event keys do not.
select ok('med.prn_repeat:med-1:hm:1234567' ~ '^med\.prn_repeat:[^:]+:[^:]+:[0-9]+$','An old slot key is retired');
select ok(not 'med.prn_repeat:med-1:hm:2026-11-01T12:00:00.000Z' ~ '^med\.prn_repeat:[^:]+:[^:]+:[0-9]+$','A new event key is not retired');

select * from finish();
rollback;
