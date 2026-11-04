-- Medication order-expiry notices reach the house managers of the order's
-- home (simulation wave 4A follow-up): the worklist queues the nurse and
-- Program Manager ROLE notices as before, and — new — a user-targeted
-- copy for each HM whose membership home is the Individual's home.
-- queue_operating_notice already supports user-targeted rows and the
-- notifications SELECT policy delivers a row only to its addressee (or
-- to holders of its role); this file pins that delivery end to end:
-- the HM of the home receives both order types, the HM of another home
-- receives nothing, and the role copies are unchanged.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a9300000-0000-0000-0000-000000000001','Order HM agency','ORDHM-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b9300000-0000-0000-0000-000000000001','a9300000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c9300000-0000-0000-0000-000000000001','a9300000-0000-0000-0000-000000000001','b9300000-0000-0000-0000-000000000001','Home A'),
 ('c9300000-0000-0000-0000-000000000002','a9300000-0000-0000-0000-000000000001','b9300000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d9300000-0000-0000-0000-000000000001','ord-nurse@example.invalid'),
 ('d9300000-0000-0000-0000-000000000002','ord-pm@example.invalid'),
 ('d9300000-0000-0000-0000-000000000003','ord-hm-a@example.invalid'),
 ('d9300000-0000-0000-0000-000000000004','ord-hm-b@example.invalid');
update profiles set must_change_password = false
 where id::text like 'd9300000-%';
update profiles set home_agency_id = 'a9300000-0000-0000-0000-000000000001'
 where id::text like 'd9300000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a9300000-0000-0000-0000-000000000001','d9300000-0000-0000-0000-000000000001','nurse','nurse',null),
 ('a9300000-0000-0000-0000-000000000001','d9300000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a9300000-0000-0000-0000-000000000001','d9300000-0000-0000-0000-000000000003','manager','house_manager','c9300000-0000-0000-0000-000000000001'),
 ('a9300000-0000-0000-0000-000000000001','d9300000-0000-0000-0000-000000000004','manager','house_manager','c9300000-0000-0000-0000-000000000002');
select public.provision_agency_roles('a9300000-0000-0000-0000-000000000001');

set local role authenticated;

-- 1–2: a nurse opening the worklist queues the Home A manager's personal
-- copies of both order-expiry types (the notify-someone-else guard passes
-- because the queuer holds clinical.view).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9300000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select queue_operating_notice(
  'a9300000-0000-0000-0000-000000000001',
  'd9300000-0000-0000-0000-000000000003',
  null,
  'med.order_expiring',
  'Medication order expiring',
  'Valproate for Home A person is approaching its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:house_manager:d9300000-0000-0000-0000-000000000003:order-1:2026-11-15'
)$$, 'A nurse can queue a med.order_expiring notice addressed to the home''s HM');
select lives_ok($$select queue_operating_notice(
  'a9300000-0000-0000-0000-000000000001',
  'd9300000-0000-0000-0000-000000000003',
  null,
  'med.order_expired',
  'Medication order expired',
  'Valproate for Home A person has passed its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expired:house_manager:d9300000-0000-0000-0000-000000000003:order-1:2026-11-15'
)$$, 'A nurse can queue a med.order_expired notice addressed to the home''s HM');

-- 3–4: the existing role audiences are unchanged.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9300000-0000-0000-0000-000000000002"}',true);
select lives_ok($$select queue_operating_notice(
  'a9300000-0000-0000-0000-000000000001',
  null,
  'nurse',
  'med.order_expiring',
  'Medication order expiring',
  'Valproate for Home A person is approaching its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:nurse:order-1:2026-11-15'
)$$, 'The nurse role copy still queues');
select lives_ok($$select queue_operating_notice(
  'a9300000-0000-0000-0000-000000000001',
  null,
  'program_manager',
  'med.order_expired',
  'Medication order expired',
  'Valproate for Home A person has passed its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expired:program_manager:order-1:2026-11-15'
)$$, 'The Program Manager role copy still queues');

-- 5–6: HM of Home A sees exactly their two personal copies.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9300000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from notifications), 2,
  'HM of the home sees the two order notices addressed to them');
select is((select count(*)::int from notifications where type in ('med.order_expiring','med.order_expired')), 2,
  'Both order-expiry types reached the HM of the home');

-- 7: HM of Home B sees nothing — no role broadcast leaks the notice
-- across homes, and the personal copies are not theirs.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9300000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from notifications), 0,
  'HM of another home receives no order notices for Home A');

-- 8: the nurse sees her role copy (and not the HM's personal copies).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9300000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from notifications), 1,
  'Nurse sees only the nurse role copy');

-- 9: the table holds exactly the four queued copies.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*)::int from notifications where agency_id = 'a9300000-0000-0000-0000-000000000001'), 4,
  'Four notices stored: two role copies + two HM copies');

select * from finish();
rollback;
