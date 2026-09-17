-- 2026-09-17: issue #80 — Shift notes (ISP Data) + ISP program config.
--
-- Tables for structured ISP documentation:
--   isp_scoring_methods  — agency-level scoring methods (levels stored as
--                           jsonb: caption, short_label, reportable, sort_order)
--   isp_programs         — per Individual per plan year; draft until approved
--   isp_program_tasks    — up to 60 tasks per program
--   shift_notes          — one row per staff/date/shift; soft-delete
--   shift_note_task_scores — per-task scores + comments for a note
--
-- RLS is enabled + forced on every table. Reads are agency-member wide.
-- Writes are a coarse row-level backstop; field-level authorization lives in
-- the app layer (src/data/localApi.ts, src/data/hostedApi.ts), gated by
-- canConfigureIspTasks (PM / administrator) for programs and
-- canEditShiftNoteRow (author, or HM/PM/admin in scope) for notes.
begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.isp_scoring_methods (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null,
  levels jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create table public.isp_programs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  plan_year text not null,
  name text not null,
  effective_on date not null,
  expires_on date not null,
  schedule text not null default 'per_shift'
    check (schedule in ('per_shift', 'per_day', 'custom')),
  max_entries_per_day integer not null default 1
    check (max_entries_per_day between 1 and 10),
  scoring_method_id uuid references public.isp_scoring_methods (id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded')),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_by_name text not null default '',
  approved_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  constraint isp_programs_date_order check (expires_on >= effective_on)
);

create table public.isp_program_tasks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.isp_programs (id) on delete cascade,
  title text not null,
  instructions text not null default '',
  sort_order integer not null default 0
);

create table public.shift_notes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  program_id uuid not null references public.isp_programs (id) on delete cascade,
  note_date date not null,
  shift text not null,
  summary text not null default '',
  time_spent_minutes integer,
  staff_user_id uuid not null references public.profiles (id) on delete cascade,
  staff_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, agency_id)
);

create table public.shift_note_task_scores (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.shift_notes (id) on delete cascade,
  task_id uuid not null references public.isp_program_tasks (id) on delete cascade,
  level_id uuid not null,
  comment text not null default ''
);

create index isp_programs_individual_year_idx
  on public.isp_programs (agency_id, individual_id, plan_year);
create index isp_program_tasks_program_idx
  on public.isp_program_tasks (program_id, sort_order);
create index shift_notes_individual_date_idx
  on public.shift_notes (agency_id, individual_id, note_date)
  where deleted_at is null;
create index shift_note_task_scores_note_idx
  on public.shift_note_task_scores (note_id);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.isp_scoring_methods enable row level security;
alter table public.isp_scoring_methods force row level security;
alter table public.isp_programs enable row level security;
alter table public.isp_programs force row level security;
alter table public.isp_program_tasks enable row level security;
alter table public.isp_program_tasks force row level security;
alter table public.shift_notes enable row level security;
alter table public.shift_notes force row level security;
alter table public.shift_note_task_scores enable row level security;
alter table public.shift_note_task_scores force row level security;

-- Read: any agency member.
create policy isp_scoring_methods_select on public.isp_scoring_methods
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy isp_programs_select on public.isp_programs
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy isp_program_tasks_select on public.isp_program_tasks
for select to authenticated
using (
  exists (
    select 1 from public.isp_programs p
    where p.id = isp_program_tasks.program_id
      and (select private.has_agency(p.agency_id))
  )
);

create policy shift_notes_select on public.shift_notes
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy shift_note_task_scores_select on public.shift_note_task_scores
for select to authenticated
using (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (select private.has_agency(n.agency_id))
  )
);

-- Write (coarse backstop): ISP config is PM / administrator only.
create policy isp_scoring_methods_write on public.isp_scoring_methods
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,program_manager,degreed_professional_manager}')));

create policy isp_programs_write on public.isp_programs
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,program_manager,degreed_professional_manager}')));

create policy isp_program_tasks_write on public.isp_program_tasks
for all to authenticated
using (
  exists (
    select 1 from public.isp_programs p
    where p.id = isp_program_tasks.program_id
      and (select private.role_key_in(p.agency_id, '{administrator,program_manager,degreed_professional_manager}'))
  )
)
with check (
  exists (
    select 1 from public.isp_programs p
    where p.id = isp_program_tasks.program_id
      and (select private.role_key_in(p.agency_id, '{administrator,program_manager,degreed_professional_manager}'))
  )
);

-- Write (coarse backstop): shift notes — any agency member may insert; only
-- the author or a privileged role may update; only privileged roles delete
-- (the app soft-deletes via update, gated by canEditShiftNoteRow).
create policy shift_notes_insert on public.shift_notes
for insert to authenticated
with check ((select private.has_agency(agency_id)));

create policy shift_notes_update on public.shift_notes
for update to authenticated
using (
  staff_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
)
with check (
  staff_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
);

create policy shift_notes_delete on public.shift_notes
for delete to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager,compliance_admin}')));

create policy shift_note_task_scores_write on public.shift_note_task_scores
for all to authenticated
using (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (
        n.staff_user_id = (select auth.uid())
        or (select private.role_key_in(n.agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
      )
  )
)
with check (
  exists (
    select 1 from public.shift_notes n
    where n.id = shift_note_task_scores.note_id
      and (
        n.staff_user_id = (select auth.uid())
        or (select private.role_key_in(n.agency_id, '{administrator,program_manager,house_manager,compliance_admin}'))
      )
  )
);

commit;
