-- Issue #100 — MAR: medication list, monthly administration grid, pill-count countdown.
--
-- Extends the medications table with MAR configuration fields, extends
-- medication_deliveries with an adjustment-note column, extends
-- prn_dose_logs with DMH administration fields (reason, effectiveness,
-- initials, administering staff) and individual linkage, and adds two new
-- tables: mar_administrations (the monthly administration grid) and
-- mar_concerns (medication error / adverse-reaction flags).
--
-- NOT applied by CI or tooling: this file ships with the PR for the DBA /
-- founder to apply once merged.

begin;

-- ----------------------------------------------------------------------
-- medications: MAR configuration fields
-- ----------------------------------------------------------------------
alter table public.medications
  add column dosage_form text not null default '',
  add column indication text not null default '',
  add column instructions text not null default '',
  add column begin_at timestamptz,
  add column frequency_label text not null default '',
  add column schedule_repeat text not null default '',
  add column time_slots text[] not null default '{}',
  add column route text not null default '',
  add column prescriber text not null default '',
  add column prn_criteria text not null default '',
  add column status text not null default 'active' check (status in ('active', 'discontinued')),
  add column discontinued_on date,
  add column order_attachment_path text,
  add column order_attachment_name text;

-- ----------------------------------------------------------------------
-- medication_deliveries: reason for manual count adjustments
-- ----------------------------------------------------------------------
alter table public.medication_deliveries
  add column note text not null default '';

-- ----------------------------------------------------------------------
-- prn_dose_logs: DMH administration fields + individual linkage
-- ----------------------------------------------------------------------
alter table public.prn_dose_logs
  add column reason_given text not null default '',
  add column effectiveness text not null default '',
  add column initials text not null default '',
  add column administered_by_name text not null default '',
  add column individual_id uuid;

-- Backfill individual_id from each log's medication, then lock it down.
update public.prn_dose_logs as log
set individual_id = med.individual_id
from public.medications as med
where log.medication_id = med.id
  and log.individual_id is null;

alter table public.prn_dose_logs
  alter column individual_id set not null;

alter table public.prn_dose_logs
  add constraint prn_dose_logs_individual_fk
  foreign key (individual_id, agency_id)
  references public.individuals (id, agency_id) on delete cascade;

create index if not exists prn_dose_logs_individual_month_idx
  on public.prn_dose_logs (agency_id, individual_id, logged_on);

-- ----------------------------------------------------------------------
-- mar_administrations: one row per scheduled time slot actually recorded
-- ----------------------------------------------------------------------
create table public.mar_administrations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  medication_id uuid not null,
  administered_on date not null,
  time_slot text not null,                       -- "HH:MM" 24h
  pills_given numeric not null default 1 check (pills_given > 0),
  status text not null default 'given'
    check (status in ('given', 'refused', 'omitted', 'held')),
  initials text not null default '',
  administered_by_name text not null default '',
  administered_by_user_id uuid references public.profiles (id),
  reason text not null default '',               -- required unless status = 'given'
  notify_nurse boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, medication_id, administered_on, time_slot),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index if not exists mar_admin_lookup_idx
  on public.mar_administrations (agency_id, individual_id, administered_on);

-- ----------------------------------------------------------------------
-- mar_concerns: medication error / adverse-reaction flags
-- ----------------------------------------------------------------------
create table public.mar_concerns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  medication_id uuid not null,
  administration_id uuid references public.mar_administrations (id) on delete set null,
  prn_log_id uuid references public.prn_dose_logs (id) on delete set null,
  concern_type text not null check (concern_type in ('med_error', 'adverse_reaction')),
  description text not null,
  initials text not null default '',
  flagged_by_name text not null default '',
  flagged_by_user_id uuid references public.profiles (id),
  nurse_notified boolean not null default false,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index if not exists mar_concern_lookup_idx
  on public.mar_concerns (agency_id, individual_id, created_at);

-- ----------------------------------------------------------------------
-- Row-level security (mirrors the repo's existing table style)
-- ----------------------------------------------------------------------
alter table public.mar_administrations enable row level security;
alter table public.mar_administrations force row level security;
alter table public.mar_concerns enable row level security;
alter table public.mar_concerns force row level security;

-- mar_administrations: readable by any agency member; writes for staff who
-- are cleared to administer/record medication.
create policy mar_administrations_select on public.mar_administrations
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy mar_administrations_write on public.mar_administrations
for all to authenticated
using ((
  select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'
  )
))
with check ((
  select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'
  )
));

-- mar_concerns: readable by any agency member; flags from the med-passing
-- staff; resolution by clinical / supervisory roles.
create policy mar_concerns_select on public.mar_concerns
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy mar_concerns_insert on public.mar_concerns
for insert to authenticated
with check ((
  select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'
  )
));

create policy mar_concerns_resolve on public.mar_concerns
for update to authenticated
using ((
  select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,nurse}'
  )
))
with check ((
  select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,nurse}'
  )
));

commit;
