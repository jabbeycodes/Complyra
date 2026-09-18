-- 2026-09-18: Health Track — per-individual health logging (Complyrer-original).
--
-- Table for structured health entries logged by care staff:
--   health_track_entries — one row per logged event (meal, fluid, bowel,
--                          bladder, emesis, skin check, vitals, seizure,
--                          menses, blood sugar). Abnormal findings flag the
--                          entry for nurse review (flag_for_nurse).
--
-- RLS is enabled + forced on the table. Reads are agency-member wide.
-- Writes are a coarse row-level backstop; field-level authorization lives in
-- the app layer (src/data/localApi.ts, src/data/hostedApi.ts), gated by
-- health.record (DSP/HM/PM/nurse) and health.review (nurse/PM).
begin;

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------

create table public.health_track_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  kind text not null
    check (kind in (
      'meal', 'fluid', 'bowel', 'bladder', 'emesis',
      'skin', 'vitals', 'seizure', 'menses', 'blood_sugar'
    )),
  occurred_at timestamptz not null,
  details jsonb not null default '{}'::jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_by_name text not null default '',
  flag_for_nurse boolean not null default false,
  flag_reason text,
  nurse_reviewed_at timestamptz,
  nurse_reviewed_by text,
  nurse_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create index health_track_entries_individual_occurred_idx
  on public.health_track_entries (agency_id, individual_id, occurred_at);
create index health_track_entries_nurse_queue_idx
  on public.health_track_entries (agency_id, occurred_at)
  where flag_for_nurse and nurse_reviewed_at is null;

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.health_track_entries enable row level security;
alter table public.health_track_entries force row level security;

-- Read: any agency member.
create policy health_track_entries_select on public.health_track_entries
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write (coarse backstop): any agency member may insert; only the author or
-- a privileged role may update; staff who record entries (health.record —
-- DSP, house manager, program manager, nurse, and both administrators) may
-- delete, matching the app-layer gate so recorders can correct their own
-- mistaken logs.
create policy health_track_entries_insert on public.health_track_entries
for insert to authenticated
with check ((select private.has_agency(agency_id)));

create policy health_track_entries_update on public.health_track_entries
for update to authenticated
using (
  recorded_by = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,nurse}'))
)
with check (
  recorded_by = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,nurse}'))
);

create policy health_track_entries_delete on public.health_track_entries
for delete to authenticated
using ((select private.has_permission(agency_id, 'health.record')));

-- ----------------------------------------------------------------------------
-- Health photos bucket
-- ----------------------------------------------------------------------------

-- Photos for skin-check observations (PNG/JPEG, 5 MB; mirrors the
-- uploadHealthPhoto validation in src/data/localApi.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'health-photos',
  'health-photos',
  false,
  5242880,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

-- Paths look like <agencyId>/<individualId>/<uuid>-<file>, so the agency id
-- is the first folder segment (same convention as the staff-certificates
-- bucket's foldername parsing).
create policy health_photos_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'health-photos'
  and (select private.has_agency((storage.foldername(name))[1]::uuid))
);

create policy health_photos_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'health-photos'
  and (select private.has_permission(
    (storage.foldername(name))[1]::uuid,
    'health.record'
  ))
);

create policy health_photos_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'health-photos'
  and (select private.has_permission(
    (storage.foldername(name))[1]::uuid,
    'health.record'
  ))
)
with check (
  bucket_id = 'health-photos'
  and (select private.has_permission(
    (storage.foldername(name))[1]::uuid,
    'health.record'
  ))
);

create policy health_photos_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'health-photos'
  and (select private.role_key_in(
    (storage.foldername(name))[1]::uuid,
    '{administrator,program_manager,nurse}'
  ))
);

-- ----------------------------------------------------------------------------
-- Permission seeding — health.record / health.review
--
-- These keys are defined in src/data/permissions.ts, but the canonical
-- role_permission_matrix insert lives in an already-applied 2026-09-15
-- migration, so existing databases never received them and
-- private.has_permission(..., 'health.record') stays false (blocking the
-- skin-check photo upload above). Seed the keys here the way mileage and
-- certificates did: add each key only where it is missing so explicit
-- per-agency customizations are preserved.
--
-- Defaults (from ROLE_TEMPLATES):
--   health.record — administrator, compliance_admin, house_manager,
--                    program_manager, dsp, nurse (HR + auditor stay out).
--   health.review — administrator, compliance_admin, program_manager, nurse.
-- ----------------------------------------------------------------------------

update public.role_templates
set permissions = permissions || jsonb_build_object(
  'health.record',
  key in ('administrator', 'compliance_admin', 'house_manager',
          'program_manager', 'dsp', 'nurse')
)
where not (permissions ? 'health.record');

update public.role_templates
set permissions = permissions || jsonb_build_object(
  'health.review',
  key in ('administrator', 'compliance_admin', 'program_manager', 'nurse')
)
where not (permissions ? 'health.review');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'health.record',
  template_key in ('administrator', 'compliance_admin', 'house_manager',
                   'program_manager', 'dsp', 'nurse')
)
where not (permissions ? 'health.record');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'health.review',
  template_key in ('administrator', 'compliance_admin', 'program_manager', 'nurse')
)
where not (permissions ? 'health.review');

commit;
