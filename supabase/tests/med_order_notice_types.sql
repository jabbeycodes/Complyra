-- queue_operating_notice must accept the medication order-expiry types the
-- med-orders worklist queues ('med.order_expiring' / 'med.order_expired'),
-- while keeping every other guard from the live definition: the notify-
-- someone-else permission rule (no missing-note-style exemption for the
-- new types), the unsupported-type rejection, and the agency guard.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a9100000-0000-0000-0000-000000000001','Order notice agency A','ORDNOTA-MO','MO','active'),
 ('a9100000-0000-0000-0000-000000000002','Order notice agency B','ORDNOTB-MO','MO','active');
insert into auth.users(id,email) values
 ('d9100000-0000-0000-0000-000000000001','order-nurse@example.invalid'),
 ('d9100000-0000-0000-0000-000000000002','order-pm@example.invalid'),
 ('d9100000-0000-0000-0000-000000000003','order-hr@example.invalid');
update profiles set must_change_password=false,home_agency_id='a9100000-0000-0000-0000-000000000001'
 where id in ('d9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000002','d9100000-0000-0000-0000-000000000003');
-- Agency roles are provisioned from the seeded templates on agency insert:
-- nurse and program_manager hold clinical.view; hr holds none of the
-- clinical / hub / recognition permissions the notify-other rule accepts.
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000001','nurse','nurse',null),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a9100000-0000-0000-0000-000000000001','d9100000-0000-0000-0000-000000000003','hr','hr',null);

set local role authenticated;

-- 1: a nurse opening the worklist queues the expiring notice for the
-- nurse role (the production flow: role-targeted, dedupe key role-scoped).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  null,
  'nurse',
  'med.order_expiring',
  'Medication order expiring',
  'Valproate for Ellis Hart is approaching its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:nurse:order-1:2026-11-15'
)$$, 'A nurse can queue a med.order_expiring notice for the nurse role');

-- 2: a Program Manager queues the expired notice for the PM role; with a
-- role-scoped dedupe key it lands alongside the nurse copy.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000002"}',true);
select lives_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  null,
  'program_manager',
  'med.order_expired',
  'Medication order expired',
  'Valproate for Ellis Hart has passed its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expired:program_manager:order-1:2026-11-15'
)$$, 'A Program Manager can queue a med.order_expired notice for the PM role');

-- 3: re-queueing the nurse notice is a deduped no-op, not an error.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  null,
  'nurse',
  'med.order_expiring',
  'Medication order expiring',
  'Valproate for Ellis Hart is approaching its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:nurse:order-1:2026-11-15'
)$$, 'Re-queueing the same order notice is a deduped no-op');

-- 4: an unprivileged caller (HR holds none of the guard permissions) still
-- cannot notify someone else with a new type — no exemption was added.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000003"}',true);
select throws_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  null,
  'nurse',
  'med.order_expiring',
  'Medication order expiring',
  'Queued by HR.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:nurse:order-1:hr-attempt'
)$$, 'P0001', 'Not allowed', 'An unprivileged member cannot queue an order notice for a role');

-- 5: unknown types are still rejected.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9100000-0000-0000-0000-000000000001"}',true);
select throws_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  null,
  'nurse',
  'med.order_unknown',
  'No',
  'No',
  '/medication-orders',
  'order-1',
  'med.order_unknown:nurse:order-1'
)$$, 'P0001', 'Unsupported notice', 'Unknown notice types are still rejected');

-- 6: a member can always notify themselves with a new type.
select lives_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000001',
  'd9100000-0000-0000-0000-000000000001',
  null,
  'med.order_expired',
  'Medication order expired',
  'Valproate for Ellis Hart has passed its review date (2026-11-15). Review or renew the order.',
  '/medication-orders',
  'order-1',
  'med.order_expired:self:d9100000-0000-0000-0000-000000000001:order-1:2026-11-15'
)$$, 'A member can queue an order notice for themselves');

-- 7: the agency guard still applies to the new types.
select throws_ok($$select queue_operating_notice(
  'a9100000-0000-0000-0000-000000000002',
  null,
  'nurse',
  'med.order_expiring',
  'Medication order expiring',
  'Other agency.',
  '/medication-orders',
  'order-1',
  'med.order_expiring:nurse:order-1:other-agency'
)$$, 'P0001', 'Not allowed', 'An order notice cannot be queued for another agency');

reset role;
select is(
  (select type from public.notifications
    where dedupe_key = 'med.order_expiring:nurse:order-1:2026-11-15'),
  'med.order_expiring',
  'The nurse-role copy landed with its type and role-scoped dedupe key intact'
);
select is(
  (select count(*)::int from public.notifications
    where agency_id = 'a9100000-0000-0000-0000-000000000001'
      and type in ('med.order_expiring', 'med.order_expired')),
  3,
  'Both role copies and the self notice landed; the deduped re-queue and the refused calls stored nothing'
);
select is(
  (select entity_type from public.notifications
    where dedupe_key = 'med.order_expiring:nurse:order-1:2026-11-15'),
  'medication',
  'An order notice stores entity_type medication, like the other med types'
);

select * from finish();
rollback;
