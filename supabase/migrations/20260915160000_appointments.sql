-- Appointments on an Individual chart (Health H1).
-- Consultation packets are generated in the app from live profile + meds +
-- allergies; this table is the appointment snapshot only.
-- Soft-delete only: no DELETE grant. Who/when names are stored at write time.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  starts_on date not null,
  start_time time not null,
  end_time time not null,
  timezone text not null default 'America/Chicago',
  consultant text not null,
  specialty text not null default '',
  reason text not null default '',
  visit_address text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_by_name text not null default '',
  deleted_at timestamptz,
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint appointments_time_order check (end_time > start_time)
);

create index appointments_individual_idx
  on public.appointments (agency_id, individual_id, starts_on);

create trigger appointments_updated_at before update on public.appointments
for each row execute function private.set_updated_at();

alter table public.appointments enable row level security;
alter table public.appointments force row level security;

-- Live rows for anyone in the agency; removed rows stay visible to writers.
create policy appointments_select on public.appointments
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (
    deleted_at is null
    or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse}'))
  )
);

-- RN, HM, Admin, DPM, PM. DSP / auditor / HR cannot write.
-- FOR ALL covers insert/update; DELETE is not granted to authenticated.
create policy appointments_write on public.appointments
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse}')));

create policy audit_active_membership on public.appointments
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy audit_individual_scope on public.appointments
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

grant select, insert, update on public.appointments to authenticated;
grant all on public.appointments to service_role;
