-- Phase 6 (med inventory countdown): per-medication inventory settings.
--
-- The pill count itself is NOT stored here — it is derived deterministically
-- from medication_deliveries / prn_dose_logs (see projectInventory). This
-- table carries only Phase-6-owned state: the reorder threshold in days of
-- doses, the dose-time schedule, and the last reorder-alert acknowledgment.
-- Write gates mirror the local canRecordDelivery helper (house manager, RN,
-- DPM, administrators).

create table public.med_inventory (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  medication_id uuid not null,
  low_threshold_days integer not null default 7 check (low_threshold_days > 0),
  dose_times text[] not null default '{}',
  reorder_acknowledged_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, medication_id),
  unique (id, agency_id),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index med_inventory_individual_idx
  on public.med_inventory (agency_id, individual_id);

create trigger med_inventory_updated_at before update on public.med_inventory
for each row execute function private.set_updated_at();

alter table public.med_inventory enable row level security;
alter table public.med_inventory force row level security;

-- Read: any agency member. Write gates mirror the local role-key helpers.
create policy med_inventory_select on public.med_inventory
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy med_inventory_write on public.med_inventory
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')));
