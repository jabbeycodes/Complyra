-- WAVE-7V (founder decision, 2026-11-02): compliance_admin narrowed to
-- read-and-audit. Asserts the platform rows carry the narrowed canonical
-- map after migration 20261031290000, that a freshly provisioned agency
-- starts narrowed, and — by replaying the migration's PART 3 statement —
-- that the agency_roles backfill deletes exactly the removed keys while
-- preserving agency-added keys, agency-granted keys outside the remove
-- list, and kept keys an agency turned off.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- The narrowed canonical map (generated from src/data/permissions.ts).
-- Keep list true: audit.read, audit.export, individuals.view,
-- documents.view, documents.review, clinical.view,
-- delegation.templates.view, hub.access, messages.use, mileage.manage,
-- acknowledgments.sign_own, recognition.view_winners, ger.review,
-- ger.resolve, requirements.complete. Everything else false.

select is(
  (select permissions from public.role_templates where key = 'compliance_admin'),
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":true,"ger.resolve":true,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb,
  'role_templates: compliance_admin default is the narrowed map'
);

select is(
  (select permissions from public.role_permission_matrix where role_key = 'compliance_admin'),
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":true,"ger.resolve":true,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb,
  'role_permission_matrix: compliance_admin row is the narrowed map'
);

select ok(
  (select permissions ->> 'roles.manage' = 'true' and permissions ->> 'members.invite' = 'true'
     from public.role_permission_matrix where role_key = 'administrator'),
  'other roles untouched: administrator keeps roles.manage and members.invite'
);

select ok(
  (select permissions ->> 'qa.audit' = 'true' and permissions ->> 'messages.use' = 'false'
     from public.role_permission_matrix where role_key = 'auditor'),
  'other roles untouched: auditor keeps qa.audit and no messaging'
);

-- A fresh agency provisions its compliance role from the narrowed template.
insert into public.agencies(id, name, agency_code, state_code, status)
values ('11111111-1111-4111-8111-111111111111', '7V Fixture Agency', 'FIXTURE7V-MO', 'MO', 'active');

select is(
  (select permissions from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'),
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":true,"ger.resolve":true,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb,
  'provisioning: a new agency compliance role starts with the narrowed map'
);

-- Backfill semantics: fatten the fixture compliance row the way a live
-- agency might look — removed keys back on, an agency-added custom key, an
-- agency-granted canonical key outside the remove list (qa.audit), and a
-- KEPT key deliberately turned off (documents.review).
update public.agency_roles
set permissions = permissions || '{"members.invite":true,"roles.manage":true,"certificates.manage":true,"documents.upload":true,"ger.create":true,"agency.custom_flag":true,"qa.audit":true,"documents.review":false}'::jsonb
where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin';

-- Fatten a NON-compliance row too; the backfill must not touch it.
update public.agency_roles
set permissions = permissions || '{"members.invite":true}'::jsonb
where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'dsp';

-- Replay the migration's PART 3 statement verbatim.
update public.agency_roles
set permissions = permissions - array[
  'acknowledgments.manage',
  'behavior.plan',
  'behavior.record',
  'certificates.manage',
  'correctiveActions.manage',
  'delegation.acknowledge',
  'delegation.activate',
  'delegation.assign',
  'delegation.templates.manage',
  'delegation.training.approve',
  'delegation.training.review',
  'documents.upload',
  'ger.create',
  'health.record',
  'lifeEvents.record',
  'members.assign_roles',
  'members.invite',
  'members.reset_password',
  'recognition.manage',
  'recognition.rate_hm',
  'recognition.review_dsp',
  'requirements.approve',
  'roles.manage',
  'sites.create'
]
where template_key = 'compliance_admin';

select ok(
  (select not (permissions ? 'members.invite') and not (permissions ? 'roles.manage')
           and not (permissions ? 'certificates.manage') and not (permissions ? 'documents.upload')
           and not (permissions ? 'ger.create')
     from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'),
  'backfill: removed keys are deleted from existing compliance rows'
);

select ok(
  (select permissions ->> 'agency.custom_flag' = 'true'
     from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'),
  'backfill: agency-added custom keys are preserved'
);

select ok(
  (select permissions ->> 'qa.audit' = 'true'
     from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'),
  'backfill: agency-granted keys outside the remove list are preserved'
);

select ok(
  (select permissions ->> 'documents.review' = 'false' and permissions ->> 'audit.read' = 'true'
           and permissions ->> 'ger.resolve' = 'true'
     from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'),
  'backfill: kept keys keep their stored values (off stays off, on stays on)'
);

select is(
  (select count(*)::int from jsonb_object_keys(
     (select permissions from public.agency_roles
       where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'compliance_admin'))),
  29,
  'backfill: key count is 52 canonical - 24 removed + 1 custom = 29'
);

select ok(
  (select permissions ->> 'members.invite' = 'true'
     from public.agency_roles
    where agency_id = '11111111-1111-4111-8111-111111111111' and template_key = 'dsp'),
  'backfill: non-compliance rows are untouched'
);

select ok(
  (select permissions ->> 'acknowledgments.sign_own' = 'true'
           and permissions ->> 'requirements.complete' = 'true'
           and permissions ->> 'messages.use' = 'true'
           and permissions ->> 'mileage.manage' = 'true'
     from public.role_templates where key = 'compliance_admin'),
  'flagged keeps survive: sign_own, requirements.complete, messages, mileage'
);

select ok(
  (select permissions ->> 'requirements.approve' = 'false'
           and permissions ->> 'delegation.assign' = 'false'
           and permissions ->> 'sites.create' = 'false'
           and permissions ->> 'health.record' = 'false'
     from public.role_templates where key = 'compliance_admin'),
  'removed powers are false in the default template'
);

select * from finish();
rollback;
