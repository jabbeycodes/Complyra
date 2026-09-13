-- Complyrer LifePath Phase 4: HR certificate tracking.
-- staff_certificates rows mirror the StaffCertificate type in src/data/types.ts
-- (mirrors the local workspace collection in src/data/localApi.ts so the
-- hosted API can replace its stubs).
--
-- Conventions follow the foundation migration: RLS enabled + forced,
-- agency-scoped rows, (select private.has_agency(...)) style policies, and
-- append-only audit. Permission gating matches the local helpers
-- (certificates.manage for writes; hr.view_staff or certificates.manage for reads).

-- Staff certificate records (CPR, CPI, PBS, L1MA, or free text).
alter table public.profiles
  add constraint profiles_id_home_agency_unique
  unique (id, home_agency_id);

create table public.staff_certificates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  cert_name text not null,
  issued_on date not null,
  expires_on date not null,
  storage_path text,
  file_name text,
  entered_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (user_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

alter table public.staff_certificates enable row level security;
alter table public.staff_certificates force row level security;

-- Read: any agency member can read; the API further requires
-- hr.view_staff or certificates.manage.
create policy staff_certificates_select on public.staff_certificates
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write: certificates.manage permission only (HR by default; administrators
-- only when explicitly granted via Roles & access).
create policy staff_certificates_write on public.staff_certificates
for all to authenticated
using ((select private.has_permission(agency_id, 'certificates.manage')))
with check ((select private.has_permission(agency_id, 'certificates.manage')));

-- Certificate scans bucket (PDF/PNG/JPEG, 10 MB; mirrors the uploadDocument
-- 10 MB pattern in src/data/localApi.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-certificates',
  'staff-certificates',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

-- Paths look like agency/<agencyId>/certs/<certId>/<file>, so the agency id
-- is the second folder segment (same convention as the agency-assets bucket).
create policy staff_certificates_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'staff-certificates'
  and (select private.has_agency((storage.foldername(name))[2]::uuid))
);

create policy staff_certificates_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'staff-certificates'
  and (select private.has_permission(
    (storage.foldername(name))[2]::uuid,
    'certificates.manage'
  ))
);

create policy staff_certificates_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'staff-certificates'
  and (select private.has_permission(
    (storage.foldername(name))[2]::uuid,
    'certificates.manage'
  ))
)
with check (
  bucket_id = 'staff-certificates'
  and (select private.has_permission(
    (storage.foldername(name))[2]::uuid,
    'certificates.manage'
  ))
);

create policy staff_certificates_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'staff-certificates'
  and (select private.has_permission(
    (storage.foldername(name))[2]::uuid,
    'certificates.manage'
  ))
);

-- certificates.manage default sets (locked decision 2026-09-13):
-- HR true by default; administrator NOT in the default set (grantable via
-- Roles & access). Only add the key where it is missing so explicit
-- per-agency customizations are never overwritten.
update public.role_templates
set permissions = permissions || '{"certificates.manage":true}'::jsonb
where key = 'hr' and not (permissions ? 'certificates.manage');

update public.role_templates
set permissions = permissions || '{"certificates.manage":false}'::jsonb
where key = 'administrator' and not (permissions ? 'certificates.manage');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'certificates.manage',
  template_key = 'hr'
)
where not (permissions ? 'certificates.manage');
