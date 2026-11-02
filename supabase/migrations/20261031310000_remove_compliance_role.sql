-- 2026-11-02: remove the compliance_admin role (founder decision, Joshua,
-- 2026-11-02, confirmed via options widget: "Remove the compliance role —
-- those users become administrators").
--
-- Joshua's reasoning: "The compliance role is basically PM role n agency
-- administrator. They need access to everything. I don't think we need a
-- separate role for that." The platform goes from eight roles to seven.
-- This supersedes PR #242 (the compliance-narrowing wave, closed unmerged);
-- its migration 20261031290000 was never applied and is NOT referenced here.
--
-- This migration:
--   1. Updates private.role_key_in / private.can_grant_role_key so RLS
--      policies and grant checks that historically named the retired
--      compliance_admin key keep working for the migrated memberships:
--      the retired key is normalized to 'administrator' inside both
--      functions (the same treatment the retired
--      degreed_professional_manager key received in 20260916060000).
--      Both functions keep their exact signatures.
--   2. Merges agency_roles rows customized under BOTH keys: permissions
--      merge with true-wins (mirroring the DPM merge), then the
--      compliance_admin row is removed.
--   3. Renames remaining compliance_admin agency_roles + memberships to
--      administrator. memberships is unique(agency_id, user_id), so the
--      rename can never collide. The legacy memberships.role enum column
--      is mapped the same way ('compliance_admin' -> 'administrator').
--   4. Refreshes the canonical role_templates + role_permission_matrix
--      rows for the seven surviving roles (generated from
--      src/data/permissions.ts), and lets agency administrator rows
--      inherit canonical permissions they lack (existing agency choices
--      win, mirroring the seed pattern). Converted compliance rows keep
--      the union of what they had: step 2's true-wins merge already
--      folded their grants into the agency's administrator row, and
--      renamed rows (step 3) carry their permissions forward and are
--      refreshed to the canonical administrator presentation + any
--      canonical permissions they lack.
--   5. Deletes the retired compliance_admin template/matrix rows.
--
-- The 'compliance_admin' value of the Postgres enum public.app_role is
-- deliberately LEFT IN PLACE (dormant): Postgres enum values cannot be
-- dropped safely, and nothing references the value after this migration —
-- no template row, no matrix row, no membership, no agency role. The TS
-- AppRole / RoleKey unions drop the member in the same change.
-- Historical migrations are left untouched.
--
-- Idempotency: every step is a no-op on a second run (no compliance_admin
-- rows remain to match; the seed refresh is an upsert; the function
-- definitions are create-or-replace).

begin;

-- ---------------------------------------------------------------------------
-- 1. Compatibility: historical policies naming compliance_admin still work
-- ---------------------------------------------------------------------------
create or replace function private.role_key_in(p_agency_id uuid, p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      -- retired keys: the merged roles carry their access forward
      and role_key = any(
        array_replace(
          array_replace(p_keys, 'degreed_professional_manager', 'program_manager'),
          'compliance_admin', 'administrator'
        )
      )
      and (expires_on is null or expires_on >= current_date)
  );
$$;

create or replace function private.can_grant_role_key(p_agency_id uuid, p_target_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select key_ok and hierarchy_ok
  from (
    select
      -- retired keys are evaluated as the roles they merged into
      case
        when p_target_key = 'degreed_professional_manager' then 'program_manager'
        when p_target_key = 'compliance_admin' then 'administrator'
        else p_target_key
      end as t
  ) norm
  cross join lateral (
    select
      norm.t in (
        'administrator', 'house_manager', 'program_manager',
        'dsp', 'nurse', 'hr', 'auditor'
      ) as key_ok,
      case
        when norm.t = 'administrator' then exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.agency_id = p_agency_id
            and (m.expires_on is null or m.expires_on >= current_date)
            and m.role_key = 'administrator'
        )
        else true
      end as hierarchy_ok
  ) h;
$$;

revoke all on function private.role_key_in(uuid, text[]) from public;
grant execute on function private.role_key_in(uuid, text[]) to authenticated;
revoke all on function private.can_grant_role_key(uuid, text) from public;
grant execute on function private.can_grant_role_key(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Merge agency_roles rows customized under both keys (true-wins on JSON)
-- ---------------------------------------------------------------------------
-- agency_roles is unique(agency_id, template_key): an agency may hold one
-- row per key. Where both exist, fold the compliance row's grants into the
-- administrator row so nothing the agency granted is lost.
update public.agency_roles adm
set permissions = (
      select jsonb_object_agg(
        key,
        (adm.permissions -> key) is not distinct from to_jsonb(true)
        or (ca.permissions -> key) is not distinct from to_jsonb(true)
      )
      from (
        select distinct key
        from jsonb_each(coalesce(adm.permissions, '{}'::jsonb))
        union
        select distinct key
        from jsonb_each(coalesce(ca.permissions, '{}'::jsonb))
      ) keys
    )
from public.agency_roles ca
where ca.agency_id = adm.agency_id
  and ca.template_key = 'compliance_admin'
  and adm.template_key = 'administrator';

-- Now the merged compliance rows are redundant: drop them where an
-- administrator row exists.
delete from public.agency_roles
where template_key = 'compliance_admin'
  and exists (
    select 1 from public.agency_roles adm2
    where adm2.agency_id = agency_roles.agency_id
      and adm2.template_key = 'administrator'
  );

-- ---------------------------------------------------------------------------
-- 3. Rename the rest: agency_roles, then memberships
-- ---------------------------------------------------------------------------
-- Remaining compliance-only agency rows become administrator rows
-- (unique on (agency_id, template_key) is safe: step 2 removed every
-- conflicting pair). Name/short code take the canonical administrator
-- presentation; scope stays — both roles were agency-scoped.
update public.agency_roles
set template_key = 'administrator',
    name = 'Agency administrator',
    short_code = 'ADMIN'
where template_key = 'compliance_admin';

-- memberships are unique(agency_id, user_id): one role per user per
-- agency, so the rename can never collide.
update public.memberships
set role_key = 'administrator'
where role_key = 'compliance_admin';

-- The legacy capability column follows the same mapping.
update public.memberships
set role = 'administrator'
where role = 'compliance_admin';

-- ---------------------------------------------------------------------------
-- 4. Refresh the canonical rows for the seven surviving roles
-- ---------------------------------------------------------------------------
-- Canonical permission JSON generated from src/data/permissions.ts
-- (ROLE_TEMPLATES), 2026-11-02. This file is the latest seed refresh for
-- the permission-truth tests.
insert into public.role_permission_matrix (role_key, permissions)
values
('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":true,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":true,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":false,"ger.resolve":false,"behavior.record":true,"behavior.plan":false,"health.record":true}'::jsonb),
('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb),
('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":false,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb)
on conflict (role_key) do update set
  permissions = excluded.permissions,
  updated_at = now();

insert into public.role_templates
  (key, name, short_code, description, default_scope, capability, permissions)
values
(
    'administrator',
    'Agency administrator',
    'ADMIN',
    'Creates the agency workspace, assigns roles, and can do every operational action.',
    'agency',
    'administrator',
    '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":true,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb
  ),
(
    'house_manager',
    'House manager',
    'HM',
    'Runs one home, creates plans for PM approval, and signs acknowledgments for that site.',
    'site',
    'manager',
    '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":true,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb
  ),
(
    'program_manager',
    'Program Manager',
    'PM',
    'Program-level oversight across homes: creates and approves ISPs/PCSPs, uploads and signs plans, reviews delegation training, and resets staff passwords.',
    'program',
    'manager',
    '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb
  ),
(
    'dsp',
    'Direct support professional',
    'DSP',
    'Sees assigned individuals, completes assigned work, and signs their own acknowledgments.',
    'assigned',
    'dsp',
    '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":false,"ger.resolve":false,"behavior.record":true,"behavior.plan":false,"health.record":true}'::jsonb
  ),
(
    'nurse',
    'Nurse',
    'RN',
    'Creates and approves clinical plans, uploads ISPs, and signs acknowledgments.',
    'site',
    'nurse',
    '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb
  ),
(
    'hr',
    'Human resources',
    'HR',
    'Staff accounts and employment records only. Sees the agency score, not individual care files.',
    'agency',
    'hr',
    '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb
  ),
(
    'auditor',
    'Auditor',
    'AUD',
    'Time-limited read and export access. Cannot change records or add staff.',
    'agency',
    'auditor',
    '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":false,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb
  )
on conflict (key) do update set
  name = excluded.name,
  short_code = excluded.short_code,
  description = excluded.description,
  default_scope = excluded.default_scope,
  capability = excluded.capability,
  permissions = excluded.permissions;

-- Missing canonical capabilities inherit their defaults in stored copies;
-- existing agency choices win (the established seed pattern).
update public.role_templates t set permissions = m.permissions || t.permissions
from public.role_permission_matrix m where m.role_key = t.key;
update public.agency_roles a set permissions = m.permissions || a.permissions
from public.role_permission_matrix m where m.role_key = a.template_key;

-- ---------------------------------------------------------------------------
-- 5. Retire the compliance_admin template + matrix rows
-- ---------------------------------------------------------------------------
-- Safe: steps 2-3 removed every agency_roles row referencing the old key,
-- and the FK from agency_roles.template_key would raise otherwise.
delete from public.role_permission_matrix where role_key = 'compliance_admin';
delete from public.role_templates where key = 'compliance_admin';

-- ---------------------------------------------------------------------------
-- Guardrails: fail loudly if the removal left anything behind
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.role_templates where key = 'compliance_admin') then
    raise exception 'remove-compliance migration failed: compliance_admin template row still present';
  end if;
  if exists (select 1 from public.role_permission_matrix where role_key = 'compliance_admin') then
    raise exception 'remove-compliance migration failed: compliance_admin matrix row still present';
  end if;
  if exists (select 1 from public.memberships where role_key = 'compliance_admin') then
    raise exception 'remove-compliance migration failed: memberships still reference compliance_admin';
  end if;
  if exists (select 1 from public.memberships where role = 'compliance_admin') then
    raise exception 'remove-compliance migration failed: memberships.role still references compliance_admin';
  end if;
  if exists (select 1 from public.agency_roles where template_key = 'compliance_admin') then
    raise exception 'remove-compliance migration failed: agency_roles still reference compliance_admin';
  end if;
end;
$$;

commit;
