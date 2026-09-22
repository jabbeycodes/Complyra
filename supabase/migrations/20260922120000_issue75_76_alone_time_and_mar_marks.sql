-- 2026-09-22: issue #75 (alone time) + #76 (MAR dose marks).
--
-- Two tables backing the site Overview due-items list:
--   alone_time_windows — HM-set hours an Individual is intentionally unstaffed.
--                        These SHRINK the required Shift-note range and never
--                        flag a missing note. Soft-deleted (deleted_at).
--   med_dose_marks     — one MAR check-off per (medication × date × time).
--                        Any status (given/missed/loa/on_hold) "marks" the
--                        dose and clears the unmarked-overdue due item.
--
-- RLS is enabled + forced. Reads are agency-member wide. Writes are a coarse
-- row-level backstop; field-level authorization lives in the app layer
-- (canEditAloneTime = HM/Admin; canLogDoseException for MAR marks).
begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.alone_time_windows (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  recurrence text not null default 'weekly'
    check (recurrence in ('weekly', 'once')),
  -- 0=Sunday..6=Saturday for weekly windows; null for one-offs.
  weekday integer check (weekday between 0 and 6),
  -- ISO date for one-off windows; null for weekly.
  on_date date,
  -- Site-local "HH:MM" (24-hour). end <= start wraps past midnight.
  start_time text not null,
  end_time text not null,
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint alone_time_start_hhmm check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint alone_time_end_hhmm check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  constraint alone_time_recurrence_shape check (
    (recurrence = 'weekly' and weekday is not null)
    or (recurrence = 'once' and on_date is not null)
  )
);

create table public.med_dose_marks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  medication_id uuid not null,
  dose_date date not null,
  dose_time text not null,
  status text not null
    check (status in ('given', 'missed', 'loa', 'on_hold')),
  marked_by uuid references public.profiles (id) on delete set null,
  marked_by_name text not null default '',
  marked_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, medication_id, dose_date, dose_time),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint med_dose_mark_time_hhmm check (dose_time ~ '^[0-2][0-9]:[0-5][0-9]$')
);

create index alone_time_windows_individual_idx
  on public.alone_time_windows (agency_id, individual_id)
  where deleted_at is null;
create index med_dose_marks_individual_date_idx
  on public.med_dose_marks (agency_id, individual_id, dose_date);

create trigger alone_time_windows_updated_at before update on public.alone_time_windows
for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.alone_time_windows enable row level security;
alter table public.alone_time_windows force row level security;
alter table public.med_dose_marks enable row level security;
alter table public.med_dose_marks force row level security;

-- Read: any agency member (DSP / Nurse / PM see windows so they do not
-- over-document; DSPs see MAR marks during the med pass).
create policy alone_time_windows_select on public.alone_time_windows
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy med_dose_marks_select on public.med_dose_marks
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write (coarse backstop): alone time is House manager + Admin only.
create policy alone_time_windows_write on public.alone_time_windows
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,house_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,house_manager}')));

-- Write (coarse backstop): MAR marks mirror the local canLogDoseException set.
create policy med_dose_marks_write on public.med_dose_marks
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,degreed_professional_manager,nurse,dsp}')));

commit;
