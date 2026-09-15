-- ISP DATA (shift notes, goals/objectives/trackables, monthly reports).
--
-- Data foundation for the ISP Data feature (contract §1). DMH-flavored
-- Missouri ISP documentation: DSPs record per-shift notes against each
-- individual's ISP goals/objectives; the system builds note expectations
-- from shift assignments, escalates missing notes, and rolls everything
-- into monthly program-progress reports.
--
-- Conventions mirrored from the mileage migration
-- (20260913170000_mileage_tracking.sql):
--   * `unique (id, agency_id)` on every table (repo convention; composite
--     FK targets elsewhere use the same shape).
--   * RLS: select for any agency member via private.has_agency(agency_id);
--     writes gated on isp.* permission keys via
--     private.has_permission(agency_id, '<key>').
--   * Role-template + agency-role default grants, only where the key is
--     missing, so per-agency customizations are never overwritten.
--
-- Immutability (server-side backstop for the API rules in contract §6):
--   * isp_notes: rows with status in ('submitted','late','amended') reject
--     UPDATE; DELETE is always rejected. Corrections go through
--     isp_note_amendments only (note.status flips to 'amended' via an
--     allowed draft->amended transition — see below).
--   * isp_monthly_reports: rows with status = 'finalized' reject UPDATE
--     and DELETE.

-- ---------------------------------------------------------------------------
-- Shift patterns & assignments
-- ---------------------------------------------------------------------------

create table if not exists public.isp_shift_patterns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

create index if not exists isp_shift_patterns_site_idx
  on public.isp_shift_patterns (agency_id, site_id, sort_order);

create table if not exists public.isp_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  shift_pattern_id uuid not null,
  work_date date not null,
  user_id uuid not null,
  role_at_shift text not null default 'DSP',
  coverage_type text not null default 'scheduled'
    check (coverage_type in ('scheduled', 'swap', 'call_in', 'overtime')),
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id, shift_pattern_id, work_date, user_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (shift_pattern_id, agency_id)
    references public.isp_shift_patterns (id, agency_id) on delete cascade
);

create index if not exists isp_shift_assignments_site_date_idx
  on public.isp_shift_assignments (agency_id, site_id, work_date);

create index if not exists isp_shift_assignments_user_date_idx
  on public.isp_shift_assignments (agency_id, user_id, work_date);

-- ---------------------------------------------------------------------------
-- Note expectations (one per assignment x individual)
-- ---------------------------------------------------------------------------

create table if not exists public.isp_note_expectations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  individual_id uuid not null,
  assignment_id uuid not null,
  work_date date not null,
  shift_pattern_id uuid not null,
  user_id uuid not null,
  due_at timestamptz not null,
  note_id uuid,
  excused boolean not null default false,
  excused_reason text,
  excused_by uuid,
  excused_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (assignment_id, individual_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (assignment_id, agency_id)
    references public.isp_shift_assignments (id, agency_id) on delete cascade
);

create index if not exists isp_note_expectations_due_idx
  on public.isp_note_expectations (agency_id, due_at)
  where note_id is null and excused = false;

create index if not exists isp_note_expectations_user_idx
  on public.isp_note_expectations (agency_id, user_id, work_date);

create index if not exists isp_note_expectations_individual_idx
  on public.isp_note_expectations (agency_id, individual_id, work_date);

-- ---------------------------------------------------------------------------
-- Plan: goals -> objectives -> trackables
-- ---------------------------------------------------------------------------

create table if not exists public.isp_goals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null default 'active'
    check (status in ('active', 'completed', 'discontinued')),
  effective_from date not null,
  effective_to date,
  sort_order int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index if not exists isp_goals_individual_idx
  on public.isp_goals (agency_id, individual_id, sort_order);

create table if not exists public.isp_objectives (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  goal_id uuid not null,
  title text not null,
  measure_of_success text not null default '',
  responsible_party text not null default '',
  target_date date,
  status text not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (goal_id, agency_id)
    references public.isp_goals (id, agency_id) on delete cascade
);

create index if not exists isp_objectives_goal_idx
  on public.isp_objectives (agency_id, goal_id, sort_order);

create table if not exists public.isp_trackables (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  objective_id uuid not null,
  name text not null,
  prompt text not null default '',
  measurement_method text not null
    check (measurement_method in ('yes_no', 'count', 'rating_scale', 'narrative', 'percentage')),
  rating_min int,
  rating_max int,
  rating_labels jsonb,
  frequency text not null default 'per_shift'
    check (frequency in ('per_shift', 'daily', 'per_service')),
  max_per_shift int,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (objective_id, agency_id)
    references public.isp_objectives (id, agency_id) on delete cascade
);

create index if not exists isp_trackables_objective_idx
  on public.isp_trackables (agency_id, objective_id, sort_order);

create table if not exists public.isp_trackable_assignments (
  trackable_id uuid not null,
  user_id uuid not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  primary key (trackable_id, user_id),
  foreign key (trackable_id)
    references public.isp_trackables (id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Shift notes + scores + amendments
-- ---------------------------------------------------------------------------

create table if not exists public.isp_notes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  site_id uuid not null,
  assignment_id uuid,
  expectation_id uuid,
  work_date date not null,
  shift_pattern_id uuid,
  service_title text not null default '',
  setting text not null default '',
  time_in time,
  time_out time,
  services_provided text not null default '',
  individual_response text not null default '',
  author_user_id uuid not null,
  author_name text not null default '',
  author_title text not null default '',
  signature_mark text,
  signature_event_id uuid,
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'late', 'amended')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (assignment_id, agency_id)
    references public.isp_shift_assignments (id, agency_id) on delete set null,
  foreign key (expectation_id, agency_id)
    references public.isp_note_expectations (id, agency_id) on delete set null
);

create index if not exists isp_notes_individual_date_idx
  on public.isp_notes (agency_id, individual_id, work_date);

create index if not exists isp_notes_expectation_idx
  on public.isp_notes (agency_id, expectation_id)
  where expectation_id is not null;

create table if not exists public.isp_note_trackable_scores (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  trackable_id uuid not null,
  score_yes_no boolean,
  score_count int,
  score_rating int,
  score_percentage numeric,
  score_text text,
  comment text,
  unique (note_id, trackable_id),
  foreign key (note_id)
    references public.isp_notes (id) on delete cascade,
  foreign key (trackable_id)
    references public.isp_trackables (id) on delete cascade
);

create index if not exists isp_note_trackable_scores_note_idx
  on public.isp_note_trackable_scores (note_id);

create table if not exists public.isp_note_amendments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  note_id uuid not null,
  author_user_id uuid not null,
  reason text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (note_id)
    references public.isp_notes (id) on delete cascade
);

create index if not exists isp_note_amendments_note_idx
  on public.isp_note_amendments (agency_id, note_id, created_at);

-- ---------------------------------------------------------------------------
-- Monthly reports + signatures
-- ---------------------------------------------------------------------------

create table if not exists public.isp_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  service_month date not null,
  status text not null default 'draft'
    check (status in ('draft', 'hm_review', 'dpm_review', 'sc_review', 'finalized')),
  sections jsonb not null default '{}'::jsonb,
  tallies jsonb not null default '{}'::jsonb,
  prepared_by uuid,
  prepared_at timestamptz,
  due_on date not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (individual_id, service_month),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index if not exists isp_monthly_reports_individual_idx
  on public.isp_monthly_reports (agency_id, individual_id, service_month);

create table if not exists public.isp_monthly_signatures (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null,
  role text not null
    check (role in ('preparer', 'hm', 'pm', 'support_coordinator', 'individual')),
  user_id uuid,
  signer_name text not null,
  signature_mark text,
  signed_at timestamptz not null default now(),
  unique (report_id, role, user_id),
  foreign key (report_id)
    references public.isp_monthly_reports (id) on delete cascade
);

create index if not exists isp_monthly_signatures_report_idx
  on public.isp_monthly_signatures (report_id);

-- ---------------------------------------------------------------------------
-- Escalations + agency settings
-- ---------------------------------------------------------------------------

create table if not exists public.isp_escalations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  expectation_id uuid,
  kind text not null
    check (kind in ('nudge', 'hm_alert', 'dpm_escalation', 'message')),
  from_user_id uuid,
  to_user_id uuid not null,
  message text not null default '',
  channel text not null default 'in_app',
  sent_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (expectation_id, agency_id)
    references public.isp_note_expectations (id, agency_id) on delete cascade
);

create index if not exists isp_escalations_expectation_idx
  on public.isp_escalations (agency_id, expectation_id, kind);

create table if not exists public.isp_note_settings (
  agency_id uuid primary key,
  note_grace_minutes int not null default 0,
  nudge_before_minutes int not null default 60,
  hm_alert_after_minutes int not null default 60,
  dpm_escalation_hours int not null default 24,
  contemporaneous_days int not null default 5,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutability triggers
-- ---------------------------------------------------------------------------

-- Submitted/late/amended notes are append-only: corrections go through
-- isp_note_amendments only. Deletes are always forbidden.
create or replace function private.forbid_isp_note_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'isp_notes are append-only: delete is forbidden';
  end if;
  if OLD.status in ('submitted', 'late', 'amended') then
    raise exception 'isp_notes with status % cannot be edited directly; use isp_note_amendments',
      OLD.status;
  end if;
  return NEW;
end;
$$;

drop trigger if exists isp_notes_no_direct_update on public.isp_notes;
create trigger isp_notes_no_direct_update
before update on public.isp_notes
for each row execute function private.forbid_isp_note_mutation();

drop trigger if exists isp_notes_no_delete on public.isp_notes;
create trigger isp_notes_no_delete
before delete on public.isp_notes
for each row execute function private.forbid_isp_note_mutation();

-- Finalized monthly reports are frozen: no updates, no deletes.
create or replace function private.forbid_finalized_report_mutation()
returns trigger
language plpgsql
as $$
begin
  if OLD.status = 'finalized' then
    raise exception 'isp_monthly_reports with status finalized cannot be changed';
  end if;
  return NEW;
end;
$$;

drop trigger if exists isp_monthly_reports_finalized_lock on public.isp_monthly_reports;
create trigger isp_monthly_reports_finalized_lock
before update or delete on public.isp_monthly_reports
for each row execute function private.forbid_finalized_report_mutation();

-- ---------------------------------------------------------------------------
-- RLS (mirrors the mileage pattern)
-- ---------------------------------------------------------------------------

alter table public.isp_shift_patterns enable row level security;
alter table public.isp_shift_patterns force row level security;
alter table public.isp_shift_assignments enable row level security;
alter table public.isp_shift_assignments force row level security;
alter table public.isp_note_expectations enable row level security;
alter table public.isp_note_expectations force row level security;
alter table public.isp_goals enable row level security;
alter table public.isp_goals force row level security;
alter table public.isp_objectives enable row level security;
alter table public.isp_objectives force row level security;
alter table public.isp_trackables enable row level security;
alter table public.isp_trackables force row level security;
alter table public.isp_trackable_assignments enable row level security;
alter table public.isp_trackable_assignments force row level security;
alter table public.isp_notes enable row level security;
alter table public.isp_notes force row level security;
alter table public.isp_note_trackable_scores enable row level security;
alter table public.isp_note_trackable_scores force row level security;
alter table public.isp_note_amendments enable row level security;
alter table public.isp_note_amendments force row level security;
alter table public.isp_monthly_reports enable row level security;
alter table public.isp_monthly_reports force row level security;
alter table public.isp_monthly_signatures enable row level security;
alter table public.isp_monthly_signatures force row level security;
alter table public.isp_escalations enable row level security;
alter table public.isp_escalations force row level security;
alter table public.isp_note_settings enable row level security;
alter table public.isp_note_settings force row level security;

-- Read: any agency member.
drop policy if exists isp_shift_patterns_select on public.isp_shift_patterns;
create policy isp_shift_patterns_select on public.isp_shift_patterns
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_shift_assignments_select on public.isp_shift_assignments;
create policy isp_shift_assignments_select on public.isp_shift_assignments
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_note_expectations_select on public.isp_note_expectations;
create policy isp_note_expectations_select on public.isp_note_expectations
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_goals_select on public.isp_goals;
create policy isp_goals_select on public.isp_goals
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_objectives_select on public.isp_objectives;
create policy isp_objectives_select on public.isp_objectives
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_trackables_select on public.isp_trackables;
create policy isp_trackables_select on public.isp_trackables
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_trackable_assignments_select on public.isp_trackable_assignments;
create policy isp_trackable_assignments_select on public.isp_trackable_assignments
for select to authenticated
using ((select private.has_agency(t.agency_id)
        from public.isp_trackables t where t.id = isp_trackable_assignments.trackable_id));

drop policy if exists isp_notes_select on public.isp_notes;
create policy isp_notes_select on public.isp_notes
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_note_trackable_scores_select on public.isp_note_trackable_scores;
create policy isp_note_trackable_scores_select on public.isp_note_trackable_scores
for select to authenticated
using ((select private.has_agency(n.agency_id)
        from public.isp_notes n where n.id = isp_note_trackable_scores.note_id));

drop policy if exists isp_note_amendments_select on public.isp_note_amendments;
create policy isp_note_amendments_select on public.isp_note_amendments
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_monthly_reports_select on public.isp_monthly_reports;
create policy isp_monthly_reports_select on public.isp_monthly_reports
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_monthly_signatures_select on public.isp_monthly_signatures;
create policy isp_monthly_signatures_select on public.isp_monthly_signatures
for select to authenticated
using ((select private.has_agency(r.agency_id)
        from public.isp_monthly_reports r where r.id = isp_monthly_signatures.report_id));

drop policy if exists isp_escalations_select on public.isp_escalations;
create policy isp_escalations_select on public.isp_escalations
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists isp_note_settings_select on public.isp_note_settings;
create policy isp_note_settings_select on public.isp_note_settings
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write: permission-gated. Plan tables need isp.manage_plan; expectations
-- also allow isp.review_monthly so HMs can excuse notes on their own site
-- (API layer adds the site check). Scores/amendments follow the note.
drop policy if exists isp_shift_patterns_write on public.isp_shift_patterns;
create policy isp_shift_patterns_write on public.isp_shift_patterns
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

drop policy if exists isp_shift_assignments_write on public.isp_shift_assignments;
create policy isp_shift_assignments_write on public.isp_shift_assignments
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

drop policy if exists isp_note_expectations_write on public.isp_note_expectations;
create policy isp_note_expectations_write on public.isp_note_expectations
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')
        or private.has_permission(agency_id, 'isp.review_monthly')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')
             or private.has_permission(agency_id, 'isp.review_monthly')));

drop policy if exists isp_goals_write on public.isp_goals;
create policy isp_goals_write on public.isp_goals
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

drop policy if exists isp_objectives_write on public.isp_objectives;
create policy isp_objectives_write on public.isp_objectives
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

drop policy if exists isp_trackables_write on public.isp_trackables;
create policy isp_trackables_write on public.isp_trackables
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

drop policy if exists isp_trackable_assignments_write on public.isp_trackable_assignments;
create policy isp_trackable_assignments_write on public.isp_trackable_assignments
for all to authenticated
using ((select private.has_permission(t.agency_id, 'isp.manage_plan')
        from public.isp_trackables t where t.id = isp_trackable_assignments.trackable_id))
with check ((select private.has_permission(t.agency_id, 'isp.manage_plan')
             from public.isp_trackables t where t.id = isp_trackable_assignments.trackable_id));

drop policy if exists isp_notes_write on public.isp_notes;
create policy isp_notes_write on public.isp_notes
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.record_notes')))
with check ((select private.has_permission(agency_id, 'isp.record_notes')));

drop policy if exists isp_note_trackable_scores_write on public.isp_note_trackable_scores;
create policy isp_note_trackable_scores_write on public.isp_note_trackable_scores
for all to authenticated
using ((select private.has_permission(n.agency_id, 'isp.record_notes')
        from public.isp_notes n where n.id = isp_note_trackable_scores.note_id))
with check ((select private.has_permission(n.agency_id, 'isp.record_notes')
             from public.isp_notes n where n.id = isp_note_trackable_scores.note_id));

drop policy if exists isp_note_amendments_write on public.isp_note_amendments;
create policy isp_note_amendments_write on public.isp_note_amendments
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.record_notes')))
with check ((select private.has_permission(agency_id, 'isp.record_notes')));

drop policy if exists isp_monthly_reports_write on public.isp_monthly_reports;
create policy isp_monthly_reports_write on public.isp_monthly_reports
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.review_monthly')))
with check ((select private.has_permission(agency_id, 'isp.review_monthly')));

drop policy if exists isp_monthly_signatures_write on public.isp_monthly_signatures;
create policy isp_monthly_signatures_write on public.isp_monthly_signatures
for all to authenticated
using ((select private.has_permission(r.agency_id, 'isp.review_monthly')
        from public.isp_monthly_reports r where r.id = isp_monthly_signatures.report_id))
with check ((select private.has_permission(r.agency_id, 'isp.review_monthly')
             from public.isp_monthly_reports r where r.id = isp_monthly_signatures.report_id));

drop policy if exists isp_escalations_write on public.isp_escalations;
create policy isp_escalations_write on public.isp_escalations
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.message_staff')))
with check ((select private.has_permission(agency_id, 'isp.message_staff')));

drop policy if exists isp_note_settings_write on public.isp_note_settings;
create policy isp_note_settings_write on public.isp_note_settings
for all to authenticated
using ((select private.has_permission(agency_id, 'isp.manage_plan')))
with check ((select private.has_permission(agency_id, 'isp.manage_plan')));

-- ---------------------------------------------------------------------------
-- Default role grants (only add keys that are missing; never overwrite
-- per-agency customizations). Mirrors the mileage.manage grant block.
-- ---------------------------------------------------------------------------

-- Full ISP access: administrator + DPM.
update public.role_templates
set permissions = permissions || '{"isp.view":true,"isp.record_notes":true,"isp.manage_plan":true,"isp.review_monthly":true,"isp.message_staff":true}'::jsonb
where key in ('administrator', 'degreed_professional_manager')
and not (permissions ? 'isp.view');

-- House manager: view + record + review monthly + message staff.
update public.role_templates
set permissions = permissions || '{"isp.view":true,"isp.record_notes":true,"isp.review_monthly":true,"isp.message_staff":true}'::jsonb
where key = 'house_manager'
and not (permissions ? 'isp.view');

-- DSP: view + record notes.
update public.role_templates
set permissions = permissions || '{"isp.view":true,"isp.record_notes":true}'::jsonb
where key = 'dsp'
and not (permissions ? 'isp.view');

-- Read-only ISP access: auditor, compliance_admin, nurse, program_manager.
update public.role_templates
set permissions = permissions || '{"isp.view":true}'::jsonb
where key in ('auditor', 'compliance_admin', 'nurse', 'program_manager')
and not (permissions ? 'isp.view');

-- HR: no ISP access.
update public.role_templates
set permissions = permissions || '{"isp.view":false,"isp.record_notes":false,"isp.manage_plan":false,"isp.review_monthly":false,"isp.message_staff":false}'::jsonb
where key = 'hr'
and not (permissions ? 'isp.view');

-- Same defaults for already-provisioned agency roles.
update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'isp.view', true,
  'isp.record_notes', template_key in ('administrator', 'degreed_professional_manager', 'house_manager', 'dsp'),
  'isp.manage_plan', template_key in ('administrator', 'degreed_professional_manager'),
  'isp.review_monthly', template_key in ('administrator', 'degreed_professional_manager', 'house_manager'),
  'isp.message_staff', template_key in ('administrator', 'degreed_professional_manager', 'house_manager')
)
where not (permissions ? 'isp.view');
