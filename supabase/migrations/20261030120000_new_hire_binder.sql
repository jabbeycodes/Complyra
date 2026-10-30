-- New Hire Binder (2026-10-30): the paper "New Hire Binder Content List"
-- digitized. One binder per staff member, snapshotted from the agency's
-- binder template; wallet documents carry an HR verification lifecycle
-- (on_file → verified / returned); emergency contacts back the binder's
-- profile item.
--
-- LINKED items (certificates, the training checklist, document
-- acknowledgments) are NOT stored here — their status derives from
-- staff_certificates, the training engine, and hr_document_acks, which
-- remain the systems of record. This migration stores only what the
-- binder itself owns: templates, snapshots, wallet file metadata, and
-- emergency contacts.
--
-- Permissions: NO new permission keys. Reads ride on self-access,
-- hub.view_team, and the agency's HR-side roles (administrator,
-- compliance_admin, hr, auditor — auditors read-only, per "auditors see
-- everything"). Verification (verify / return) rides on the existing
-- certificates.manage permission — the same gate certificate writes
-- use — so the program_manager template trap (20260916060000) does not
-- apply and no backfill is needed. Wallet files live in the private
-- `binder-documents` storage bucket.
--
-- UNAPPLIED: this migration has NOT been run against any hosted
-- database. It joins the pending migration list (house card, personal
-- spending) and applies only on the founder's word.

begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- One row per agency: the template new binders snapshot. Editing the
-- template never rewrites existing binders (their snapshot is theirs).
create table public.hr_binder_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  template jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id),
  unique (id, agency_id)
);

-- One binder per staff member: the template snapshot at creation.
create table public.hr_binders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  sections jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, staff_id),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

create index hr_binders_staff_idx
  on public.hr_binders (agency_id, staff_id);

-- Wallet files: one row per (binder, item). The file itself is in the
-- binder-documents bucket; this row is metadata + verification state.
-- A re-upload replaces the row and resets it to on_file.
create table public.hr_binder_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  binder_id uuid not null,
  staff_id uuid not null,
  item_key text not null,
  file_name text not null default '',
  file_size bigint not null default 0,
  mime_type text not null default '',
  storage_path text,
  obtained_on date,
  status text not null default 'on_file'
    check (status in ('on_file', 'verified', 'returned')),
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  uploaded_by_name text not null default '',
  uploaded_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_by_name text,
  verified_at timestamptz,
  return_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (binder_id, item_key),
  unique (id, agency_id),
  foreign key (binder_id, agency_id)
    references public.hr_binders (id, agency_id) on delete cascade,
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  -- Verification is all-or-nothing: stamp, verifier, and time land
  -- together, and only on a verified row.
  constraint hr_binder_documents_verified_shape check (
    (status = 'verified' and verified_by is not null and verified_at is not null)
    or (status <> 'verified' and verified_by is null and verified_at is null)
  ),
  -- A return always carries HR's note.
  constraint hr_binder_documents_return_shape check (
    status <> 'returned'
    or length(btrim(coalesce(return_note, ''))) > 0
  )
);

create index hr_binder_documents_staff_idx
  on public.hr_binder_documents (agency_id, staff_id, status);

-- The staff member's emergency contact (one per staff member).
create table public.hr_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  contact_name text not null,
  relationship text not null default '',
  phone text not null default '',
  alternate_phone text,
  updated_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, staff_id),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.hr_binder_templates enable row level security;
alter table public.hr_binder_templates force row level security;
alter table public.hr_binders enable row level security;
alter table public.hr_binders force row level security;
alter table public.hr_binder_documents enable row level security;
alter table public.hr_binder_documents force row level security;
alter table public.hr_emergency_contacts enable row level security;
alter table public.hr_emergency_contacts force row level security;

-- Shared read rule for subject rows (binders, wallet documents, contacts):
-- the staff member themselves, team viewers (hub.view_team), and the
-- HR-side roles. Auditors read — they never write (no write policy below
-- names them).
--   private.binder_subject_visible(agency_id, staff_id)

create or replace function private.binder_subject_visible(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_staff_id = auth.uid()
    or (select private.has_permission(p_agency_id, 'hub.view_team'))
    or (select private.role_key_in(
      p_agency_id, '{administrator,compliance_admin,hr,auditor}'))
$$;

revoke all on function private.binder_subject_visible(uuid, uuid) from public;
grant execute on function private.binder_subject_visible(uuid, uuid) to authenticated;

-- Templates: any agency member reads; only certificates.manage holders
-- (HR by default) or administrators write (the editor itself is a later
-- build — the write gate is set now so it is never widened by accident).
create policy hr_binder_templates_select on public.hr_binder_templates
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hr_binder_templates_write on public.hr_binder_templates
for all to authenticated
using (
  (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.role_key_in(agency_id, '{administrator}'))
)
with check (
  (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.role_key_in(agency_id, '{administrator}'))
);

-- Binders: read by the subject rule. Open/write by the subject, team
-- viewers, or certificates.manage holders.
create policy hr_binders_select on public.hr_binders
for select to authenticated
using ((select private.binder_subject_visible(agency_id, staff_id)));

create policy hr_binders_write on public.hr_binders
for all to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hub.view_team'))
  or (select private.has_permission(agency_id, 'certificates.manage'))
)
with check (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hub.view_team'))
  or (select private.has_permission(agency_id, 'certificates.manage'))
);

-- Wallet documents: read by the subject rule. Insert by the uploader
-- (self, or HR/manager on the subject's behalf). Updates are further
-- narrowed by the guard trigger: only certificates.manage holders may
-- move a row to verified / returned.
create policy hr_binder_documents_select on public.hr_binder_documents
for select to authenticated
using ((select private.binder_subject_visible(agency_id, staff_id)));

create policy hr_binder_documents_insert on public.hr_binder_documents
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (
    staff_id = (select auth.uid())
    or (select private.has_permission(agency_id, 'certificates.manage'))
    or (select private.has_permission(agency_id, 'hub.view_team'))
  )
);

create policy hr_binder_documents_update on public.hr_binder_documents
for update to authenticated
using (
  staff_id = (select auth.uid())
  or uploaded_by = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.has_permission(agency_id, 'hub.view_team'))
)
with check (
  staff_id = (select auth.uid())
  or uploaded_by = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.has_permission(agency_id, 'hub.view_team'))
);

-- No delete policy: a wallet row is replaced by re-upload, never erased.

-- Emergency contacts: read by the subject rule; written by the subject
-- or the same HR-side write gates as the wallet.
create policy hr_emergency_contacts_select on public.hr_emergency_contacts
for select to authenticated
using ((select private.binder_subject_visible(agency_id, staff_id)));

create policy hr_emergency_contacts_write on public.hr_emergency_contacts
for all to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.has_permission(agency_id, 'hub.view_team'))
  or (select private.role_key_in(agency_id, '{hr}'))
)
with check (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (select private.has_permission(agency_id, 'hub.view_team'))
  or (select private.role_key_in(agency_id, '{hr}'))
);

-- The audit access boundary (20260915023000), as restrictive policies on
-- the subject tables: an active membership in the row's agency.
create policy hr_binders_audit_membership on public.hr_binders
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy hr_binder_documents_audit_membership on public.hr_binder_documents
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy hr_emergency_contacts_audit_membership on public.hr_emergency_contacts
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- ----------------------------------------------------------------------------
-- Document guard: freeze identity; verification transitions belong to
-- certificates.manage holders and stamp themselves.
-- ----------------------------------------------------------------------------

create or replace function private.hr_binder_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if v_uid is not null then
      new.uploaded_by := v_uid;
      -- A new row is always a fresh upload awaiting verification.
      new.status := 'on_file';
      new.verified_by := null;
      new.verified_by_name := null;
      new.verified_at := null;
      new.return_note := null;
    end if;
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.binder_id is distinct from old.binder_id
     or new.staff_id is distinct from old.staff_id
     or new.item_key is distinct from old.item_key
     or new.created_at is distinct from old.created_at then
    raise exception 'A binder document''s identity cannot change.'
      using errcode = 'P0001';
  end if;
  new.updated_at := now();

  -- Verification transitions: only certificates.manage holders, and the
  -- stamp names the caller.
  if new.status in ('verified', 'returned') and old.status is distinct from new.status then
    if not (
      (select private.has_permission(new.agency_id, 'certificates.manage'))
      or (select private.role_key_in(array['administrator', 'hr']))
    ) then
      raise exception 'Only HR can verify or return a binder document.'
        using errcode = 'P0001';
    end if;
    if new.status = 'verified' then
      new.verified_by := v_uid;
      new.verified_at := now();
      new.return_note := null;
    else
      if length(btrim(coalesce(new.return_note, ''))) = 0 then
        raise exception 'A reason is required to send a document back.'
          using errcode = 'P0001';
      end if;
      new.verified_by := null;
      new.verified_by_name := null;
      new.verified_at := null;
    end if;
  end if;

  -- A re-upload (file fields change) resets the row to awaiting
  -- verification, whoever sent it back before.
  if new.file_name is distinct from old.file_name
     or new.storage_path is distinct from old.storage_path
     or new.file_size is distinct from old.file_size then
    new.status := 'on_file';
    new.verified_by := null;
    new.verified_by_name := null;
    new.verified_at := null;
    new.return_note := null;
    new.uploaded_by := coalesce(v_uid, old.uploaded_by);
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists hr_binder_documents_guard on public.hr_binder_documents;
create trigger hr_binder_documents_guard
before insert or update on public.hr_binder_documents
for each row execute function private.hr_binder_documents_guard();

-- ----------------------------------------------------------------------------
-- Wallet file storage (private bucket; paths agency/<agencyId>/binder/
-- <staffId>/<itemKey>/<file> — agency is the second folder segment, the
-- same convention as the staff-certificates bucket).
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'binder-documents',
  'binder-documents',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

create policy binder_documents_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'binder-documents'
  and (select private.binder_subject_visible(
    (storage.foldername(name))[2]::uuid,
    (storage.foldername(name))[4]::uuid
  ))
);

create policy binder_documents_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'binder-documents'
  and (select private.has_agency((storage.foldername(name))[2]::uuid))
  and (
    (storage.foldername(name))[4]::uuid = (select auth.uid())
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'certificates.manage'))
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'hub.view_team'))
  )
);

create policy binder_documents_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'binder-documents'
  and (select private.has_agency((storage.foldername(name))[2]::uuid))
  and (
    (storage.foldername(name))[4]::uuid = (select auth.uid())
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'certificates.manage'))
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'hub.view_team'))
  )
)
with check (
  bucket_id = 'binder-documents'
  and (select private.has_agency((storage.foldername(name))[2]::uuid))
  and (
    (storage.foldername(name))[4]::uuid = (select auth.uid())
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'certificates.manage'))
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid, 'hub.view_team'))
  )
);

create policy binder_documents_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'binder-documents'
  and (select private.has_permission(
    (storage.foldername(name))[2]::uuid, 'certificates.manage'))
);

revoke all on public.hr_binder_templates from anon, authenticated;
grant select, insert, update on public.hr_binder_templates to authenticated;
revoke all on public.hr_binders from anon, authenticated;
grant select, insert, update on public.hr_binders to authenticated;
revoke all on public.hr_binder_documents from anon, authenticated;
grant select, insert, update on public.hr_binder_documents to authenticated;
revoke all on public.hr_emergency_contacts from anon, authenticated;
grant select, insert, update on public.hr_emergency_contacts to authenticated;

commit;
