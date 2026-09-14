-- ============================================================================
-- 20260914040000_permission_source_of_truth.sql
-- Workstream 4 — SINGLE PERMISSION SOURCE OF TRUTH (Complyrer Phase 1)
--
-- AUTHORING SOURCE: TypeScript src/data/permissions.ts.
-- This seed MIRRORS that module; it does not define anything new.
-- Change the TS module first, then regenerate this seed (see the seed
-- generator note at the bottom of this file).
--
-- What this migration does:
--   1. Creates public.role_permission_matrix — a read-only snapshot of the
--      canonical role templates (role_key PK, permissions jsonb).
--   2. Seeds it with the EXACT default permission maps from
--      ROLE_TEMPLATE_BY_KEY (idempotent upsert; safe to re-run).
--   3. VERIFIES Phase 0's hierarchy enforcement is intact
--      (20260913191500_phase0_security.sql) and RAISES EXCEPTION if a prior
--      migration ever dropped it. It does NOT modify those objects.
--   4. RLS: readable by agency members, writable only by service_role.
--
-- It deliberately does NOT replace the agency_roles table (per-agency
-- customized templates) or the Phase 0 policies/triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. role_permission_matrix table
-- ----------------------------------------------------------------------------
create table if not exists public.role_permission_matrix (
  role_key text primary key,
  permissions jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.role_permission_matrix is
  'Read-only mirror of the canonical role templates in src/data/permissions.ts. '
  'Seeded by 20260914040000_permission_source_of_truth.sql; regenerate from the '
  'TS module — never hand-edit.';

-- ----------------------------------------------------------------------------
-- 2. Seed — EXACT permission maps from ROLE_TEMPLATE_BY_KEY, 2026-09-14
--    (generated programmatically from src/data/permissions.ts; JSON key order
--    follows PERMISSION_KEYS). Idempotent: upsert on conflict.
-- ----------------------------------------------------------------------------
insert into public.role_permission_matrix (role_key, permissions)
values
    ('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('degreed_professional_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb),
    ('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb)
on conflict (role_key) do update
set permissions = excluded.permissions,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- 3. Phase 0 hierarchy guard — VERIFY, never modify
--    20260913191500_phase0_security.sql created:
--      - function private.can_grant_role_key(uuid, text)  (grant hierarchy)
--      - function private.guard_last_administrator()      (last-admin guard)
--      - trigger memberships_guard_last_administrator on public.memberships
--      - trigger agency_roles_audit_update on public.agency_roles
--    If any of these are missing, a migration has silently dropped Phase 0's
--    enforcement — fail loudly instead of continuing.
-- ----------------------------------------------------------------------------
do $$
declare
  v_missing text[];
begin
  v_missing := array[]::text[];

  if to_regprocedure('private.can_grant_role_key(uuid, text)') is null then
    v_missing := v_missing || 'private.can_grant_role_key(uuid, text)';
  end if;

  if to_regprocedure('private.guard_last_administrator()') is null then
    v_missing := v_missing || 'private.guard_last_administrator()';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'memberships_guard_last_administrator'
      and not t.tgisinternal
      and c.relname = 'memberships'
      and c.relnamespace = 'public'::regnamespace
  ) then
    v_missing := v_missing || 'trigger memberships_guard_last_administrator on public.memberships';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'agency_roles_audit_update'
      and not t.tgisinternal
      and c.relname = 'agency_roles'
      and c.relnamespace = 'public'::regnamespace
  ) then
    v_missing := v_missing || 'trigger agency_roles_audit_update on public.agency_roles';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception
      'PERMISSION SOURCE OF TRUTH: Phase 0 hierarchy enforcement objects are MISSING: %. '
      '20260913191500_phase0_security.sql must be applied before this migration, and no '
      'later migration may drop them.',
      array_to_string(v_missing, ', ');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS — readable by agency members, writable only by service_role
--    (no insert/update/delete policies: service_role bypasses RLS, so only it
--    — plus migration authors — can write).
-- ----------------------------------------------------------------------------
alter table public.role_permission_matrix enable row level security;

drop policy if exists role_permission_matrix_read on public.role_permission_matrix;
create policy role_permission_matrix_read on public.role_permission_matrix
for select to authenticated
using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
  )
);

-- ----------------------------------------------------------------------------
-- Seed regeneration note (for future maintainers):
--   node --import tsx -e "
--     import { ROLE_KEYS, ROLE_TEMPLATE_BY_KEY } from './src/data/permissions.ts';
--     for (const key of ROLE_KEYS) {
--       const json = JSON.stringify(ROLE_TEMPLATE_BY_KEY[key].permissions).replace(/'/g, \"''\");
--       console.log(\`    ('${key}', '${json}'::jsonb),\`);
--     }"
-- then paste the rows into the INSERT above. Never hand-edit a JSON map.
-- ----------------------------------------------------------------------------
