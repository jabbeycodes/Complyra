-- Appointment complete / consultation-form upload (Health H1 calendar lock).
-- RN/HM/admin still create via appointments_write. DSP may UPDATE a live
-- appointment they can read (upload → auto-complete) but cannot INSERT.
-- Consultation scans live in chart_files.kind = 'other'.

alter table public.appointments
  add column if not exists completed_by uuid references public.profiles (id) on delete set null,
  add column if not exists completed_by_name text not null default '',
  add column if not exists completed_at timestamptz,
  add column if not exists visit_comments text not null default '',
  add column if not exists consultation_file_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_consultation_file_fk'
  ) then
    alter table public.appointments
      add constraint appointments_consultation_file_fk
      foreign key (consultation_file_id, agency_id)
      references public.chart_files (id, agency_id)
      on delete set null;
  end if;
end $$;

create index if not exists appointments_starts_on_idx
  on public.appointments (agency_id, starts_on)
  where deleted_at is null;

drop policy if exists appointments_complete on public.appointments;
create policy appointments_complete on public.appointments
for update to authenticated
using (
  deleted_at is null
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}'
  ))
)
with check (
  deleted_at is null
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}'
  ))
);

drop policy if exists chart_files_consultation_insert on public.chart_files;
create policy chart_files_consultation_insert on public.chart_files
for insert to authenticated
with check (
  kind = 'other'
  and (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}'
  ))
);

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg']::text[]
where id = 'care-plan-docs';

drop policy if exists care_plan_docs_consultation_insert on storage.objects;
create policy care_plan_docs_consultation_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'care-plan-docs'
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
  and (select private.role_key_in(
    (storage.foldername(name))[1]::uuid,
    '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}'
  ))
);
