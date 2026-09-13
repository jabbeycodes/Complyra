-- LIFEPATH-P7 (mileage tracking): per-house vehicle mileage log.
--
-- Mirrors the paper "Mileage Log" form (one log per house per month):
-- each trip records DATE | ODOMETER START | ODOMETER STOP | MILES |
-- per-individual rider columns | REASON/TRIP | SIGNATURE. MILES is
-- stop - start; riders on a trip share the miles equally (the split is
-- derived in the app, see src/data/mileage.ts). Monthly totals are
-- derived from the trip rows — nothing is pre-aggregated here.
--
-- RLS mirrors staff_certificates: read for any agency member; writes
-- require the mileage.manage permission (granted by default to the
-- operational roles that log service: DSP, HM, DPM, PM, nurse, HR, plus
-- administrators). Role templates stay editable only through
-- roles.manage, so granting mileage.manage never lets anyone redefine
-- roles.

create table public.mileage_trips (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  trip_date date not null,
  odometer_start numeric not null check (odometer_start >= 0),
  odometer_end numeric not null check (odometer_end >= 0),
  miles numeric not null check (miles >= 0),
  rider_ids uuid[] not null default '{}',
  reason text not null default '',
  driver_name text not null default '',
  signature_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  constraint mileage_trips_odometer_order
    check (odometer_end >= odometer_start),
  constraint mileage_trips_needs_rider
    check (coalesce(cardinality(rider_ids), 0) >= 1)
);

create index mileage_trips_site_month_idx
  on public.mileage_trips (agency_id, site_id, trip_date);

create trigger mileage_trips_updated_at before update on public.mileage_trips
for each row execute function private.set_updated_at();

alter table public.mileage_trips enable row level security;
alter table public.mileage_trips force row level security;

-- Read: any agency member. Write: mileage.manage permission only.
create policy mileage_trips_select on public.mileage_trips
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy mileage_trips_write on public.mileage_trips
for all to authenticated
using ((select private.has_permission(agency_id, 'mileage.manage')))
with check ((select private.has_permission(agency_id, 'mileage.manage')));

-- mileage.manage default sets (locked 2026-09-13): on for the roles that
-- log service — DSP, HM, DPM, PM, nurse, HR — plus both administrators.
-- Auditor stays out. Only add the key where it is missing so explicit
-- per-agency customizations are never overwritten.
update public.role_templates
set permissions = permissions || '{"mileage.manage":true}'::jsonb
where key in (
  'administrator', 'compliance_admin', 'house_manager',
  'degreed_professional_manager', 'program_manager', 'dsp', 'nurse', 'hr'
)
and not (permissions ? 'mileage.manage');

update public.role_templates
set permissions = permissions || '{"mileage.manage":false}'::jsonb
where key = 'auditor' and not (permissions ? 'mileage.manage');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'mileage.manage',
  template_key in (
    'administrator', 'compliance_admin', 'house_manager',
    'degreed_professional_manager', 'program_manager', 'dsp', 'nurse', 'hr'
  )
)
where not (permissions ? 'mileage.manage');
