-- ============================================================================
-- 20260914070000_audit_readiness.sql
-- Audit-readiness UX overhaul: compliance snapshots, corrective actions,
-- and the permission-matrix refresh for correctiveActions.manage.
--
-- AUTHORING SOURCE for permissions: TypeScript src/data/permissions.ts.
-- The role_permission_matrix upsert below was REGENERATED from that module
-- (see the seed regeneration note in
-- 20260914040000_permission_source_of_truth.sql) — never hand-edit.
--
-- What this migration does:
--   1. Creates public.compliance_score_snapshots — periodic agency/site
--      score snapshots for the trend chart (written by schedulers or
--      managers with correctiveActions.manage; read by agency members).
--   2. Creates public.corrective_actions — the corrective-action workflow
--      (create/assign/due-date/status/linked risk). Writes require the
--      correctiveActions.manage permission; reads are agency-member-wide.
--   3. Upserts public.role_permission_matrix with the regenerated maps
--      (adds correctiveActions.manage).
--   4. RLS on both tables, following the (select private.has_agency(...))
--      / private.has_permission(agency_id, '...') conventions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. compliance_score_snapshots
-- ----------------------------------------------------------------------------
create table if not exists public.compliance_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  -- Null = agency-wide snapshot; set = one program site.
  site_id uuid null,
  score integer not null check (score >= 0 and score <= 100),
  band text not null check (band in ('compliant', 'at-risk', 'non-compliant')),
  breakdown jsonb not null default '{}'::jsonb,
  fact_count integer not null default 0,
  computed_at timestamptz not null default now()
);

comment on table public.compliance_score_snapshots is
  'Periodic compliance score snapshots (agency or per-site) for the '
  'command-center trend chart. Written by schedulers / managers; read by '
  'agency members.';

create index if not exists compliance_score_snapshots_agency_time
  on public.compliance_score_snapshots (agency_id, site_id, computed_at desc);

alter table public.compliance_score_snapshots enable row level security;
alter table public.compliance_score_snapshots force row level security;

drop policy if exists compliance_score_snapshots_select
  on public.compliance_score_snapshots;
create policy compliance_score_snapshots_select
  on public.compliance_score_snapshots
  for select to authenticated
  using ((select private.has_agency(agency_id)));

drop policy if exists compliance_score_snapshots_write
  on public.compliance_score_snapshots;
create policy compliance_score_snapshots_write
  on public.compliance_score_snapshots
  for all to authenticated
  using ((select private.has_permission(agency_id, 'correctiveActions.manage')))
  with check ((select private.has_permission(agency_id, 'correctiveActions.manage')));

-- ----------------------------------------------------------------------------
-- 2. corrective_actions
-- ----------------------------------------------------------------------------
create table if not exists public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  assigned_to_user_id uuid null references public.profiles (id) on delete set null,
  due_on date null,
  -- Stored lifecycle: open -> in_progress -> resolved. "overdue" is DERIVED
  -- client-side from due_on (see src/data/correctiveActions.ts) and is
  -- never stored here.
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  linked_risk_id text null,
  linked_risk_source text null,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  updated_at timestamptz not null default now()
);

comment on table public.corrective_actions is
  'Corrective-action workflow: title, owner, due date, lifecycle status, '
  'and the risk item that raised it. Writes require correctiveActions.manage.';

create index if not exists corrective_actions_agency_due
  on public.corrective_actions (agency_id, due_on);

create index if not exists corrective_actions_assignee
  on public.corrective_actions (assigned_to_user_id)
  where assigned_to_user_id is not null;

alter table public.corrective_actions enable row level security;
alter table public.corrective_actions force row level security;

drop policy if exists corrective_actions_select on public.corrective_actions;
create policy corrective_actions_select on public.corrective_actions
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists corrective_actions_write on public.corrective_actions;
create policy corrective_actions_write on public.corrective_actions
for all to authenticated
using ((select private.has_permission(agency_id, 'correctiveActions.manage')))
with check ((select private.has_permission(agency_id, 'correctiveActions.manage')));

-- Stamp resolved_at when an action moves to resolved (and clear it when
-- reopened), so the UI never has to infer it.
create or replace function private.corrective_action_resolved_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists corrective_actions_resolved_stamp on public.corrective_actions;
create trigger corrective_actions_resolved_stamp
before update on public.corrective_actions
for each row execute function private.corrective_action_resolved_stamp();

-- ----------------------------------------------------------------------------
-- 3. role_permission_matrix refresh — regenerated from
--    src/data/permissions.ts on 2026-09-14 (adds correctiveActions.manage).
--    Idempotent upsert; safe to re-run.
-- ----------------------------------------------------------------------------
insert into public.role_permission_matrix (role_key, permissions)
values
    ('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"correctiveActions.manage":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"correctiveActions.manage":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"correctiveActions.manage":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('degreed_professional_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"correctiveActions.manage":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"correctiveActions.manage":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"sites.create":false,"correctiveActions.manage":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"correctiveActions.manage":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"sites.create":false,"correctiveActions.manage":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"correctiveActions.manage":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb)
on conflict (role_key) do update
set permissions = excluded.permissions,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- Seed regeneration note (for future maintainers):
--   node --import tsx -e "
--     import { writeFileSync } from 'node:fs';
--     import { ROLE_KEYS, ROLE_TEMPLATE_BY_KEY } from './src/data/permissions.ts';
--     ... (see 20260914040000_permission_source_of_truth.sql)"
-- then paste the rows into the INSERT above. Never hand-edit a JSON map.
-- ----------------------------------------------------------------------------
