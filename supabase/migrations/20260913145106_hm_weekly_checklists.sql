-- Complyrer LifePath Phase 5: hosted schema for the digital HM Weekly Checklist.
--
-- One row per home per week (unique on site_id + week_of). The 26 Y/N/N/A
-- items, the structured service-log entries, and the HM attestation ride as
-- jsonb, mirroring the HmWeeklyChecklist shape in src/data/types.ts.
--
-- Conventions follow the earlier LifePath migrations: RLS enabled + forced,
-- agency-scoped rows, (select private.has_agency(...)) style policies, and
-- append-only audit. Assignment is DPM/admin-only; the assigned HM (or
-- DPM/admin oversight) can update the open week.

create table public.hm_weekly_checklists (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  week_of date not null,
  assigned_to_user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by_user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'submitted', 'overdue', 'locked')),
  submitted_at timestamptz,
  items jsonb not null default '[]'::jsonb,
  service_logs jsonb not null default '[]'::jsonb,
  attestation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id, week_of),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

create index hm_weekly_checklists_agency_idx
  on public.hm_weekly_checklists (agency_id, week_of);
create index hm_weekly_checklists_assignee_idx
  on public.hm_weekly_checklists (assigned_to_user_id);

create trigger hm_weekly_checklists_updated_at before update on public.hm_weekly_checklists
for each row execute function private.set_updated_at();

alter table public.hm_weekly_checklists enable row level security;
alter table public.hm_weekly_checklists force row level security;

create policy hm_weekly_checklists_select on public.hm_weekly_checklists
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hm_weekly_checklists_insert on public.hm_weekly_checklists
for insert to authenticated
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')));

create policy hm_weekly_checklists_update on public.hm_weekly_checklists
for update to authenticated
using (
  assigned_to_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}'))
)
with check (
  assigned_to_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}'))
);

create policy hm_weekly_checklists_delete on public.hm_weekly_checklists
for delete to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin}')));

grant select, insert, update, delete on public.hm_weekly_checklists to authenticated;
