-- E-SIGNATURE CAPTURE (2026-09-13): DocuSign-style signature adoption +
-- apply-on-sign flow for delegation forms (and any other signable document).
--
-- Tables:
--   public.user_signatures           adopted signature/initials images per user
--   public.signature_events          immutable sign-event ledger (server-written)
--   public.agency_signature_settings agency Signature Adoption Configuration
--
-- Conventions: idempotent (if not exists / create or replace / drop policy if
-- exists) so the file is re-runnable. Path convention in the user-signatures
-- bucket is <user_id>/signature.png and <user_id>/initials.png (PNG, 200 KB
-- cap enforced at write time by the app + edge function; storage policies
-- cannot check file size). signature_events has NO write policies for the
-- authenticated role: rows are inserted only by the apply-signature edge
-- function through the service_role key, which makes the ledger tamper-proof.

-- ============================================================================
-- Tables
-- ============================================================================
create table if not exists public.user_signatures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signature_path text not null,
  initials_path text not null,
  adopted_at timestamptz not null default now(),
  consent_at timestamptz not null,
  consent_text_version text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.signature_events (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  document_id text not null,
  field_name text not null,
  kind text not null default 'signature',
  signer_user_id uuid not null references auth.users(id) on delete cascade,
  signed_at timestamptz not null default now(),
  document_hash text not null,
  consent_version text not null,
  agency_id uuid references public.agencies(id) on delete set null
);

-- One signer stamp per field per document: a second signature on the same
-- field is a 409, not a second row.
create unique index if not exists signature_events_no_double_sign_idx
  on public.signature_events (document_type, document_id, field_name);

-- Lookup index for "who signed what" views.
create index if not exists signature_events_signer_idx
  on public.signature_events (signer_user_id, signed_at desc);

-- DocuSign "Signature Adoption Configuration" equivalent: which adoption
-- methods (draw / type / upload) the agency allows.
create table if not exists public.agency_signature_settings (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  allow_draw boolean default true,
  allow_type boolean default true,
  allow_upload boolean default true,
  updated_at timestamptz default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.user_signatures enable row level security;
alter table public.user_signatures force row level security;

alter table public.signature_events enable row level security;
alter table public.signature_events force row level security;

alter table public.agency_signature_settings enable row level security;
alter table public.agency_signature_settings force row level security;

-- -- user_signatures ------------------------------------------------------------
-- A user owns exactly one row: reads/writes are self-only. Administrators and
-- compliance_admin can READ any row, but only for a signer who holds an
-- unexpired membership in an agency where the caller is administrator or
-- compliance_admin (signature verification, e.g. before countersigning).
-- Nobody may modify another user's adopted signature; there is no DELETE
-- policy, so adopted signatures cannot be removed through the API.
drop policy if exists user_signatures_select_own on public.user_signatures;
create policy user_signatures_select_own on public.user_signatures
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists user_signatures_select_verifier on public.user_signatures;
create policy user_signatures_select_verifier on public.user_signatures
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = user_signatures.user_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

drop policy if exists user_signatures_insert_own on public.user_signatures;
create policy user_signatures_insert_own on public.user_signatures
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists user_signatures_update_own on public.user_signatures;
create policy user_signatures_update_own on public.user_signatures
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- -- signature_events -------------------------------------------------------------
-- Immutable ledger: no INSERT/UPDATE/DELETE policies for the authenticated
-- role at all, so rows can only be written by the apply-signature edge
-- function through the service_role key. Reads: the signer themselves, and
-- administrator/compliance_admin of any agency the signer belongs to.
drop policy if exists signature_events_select_own on public.signature_events;
create policy signature_events_select_own on public.signature_events
for select to authenticated
using (signer_user_id = (select auth.uid()));

drop policy if exists signature_events_select_verifier on public.signature_events;
create policy signature_events_select_verifier on public.signature_events
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = signature_events.signer_user_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

-- -- agency_signature_settings ----------------------------------------------------
-- Any agency member can read the settings (the app needs them at adoption
-- time). Writes are restricted to administrators and holders of
-- roles.manage (mirrors the agency_roles_update pattern from phase0).
drop policy if exists agency_signature_settings_select on public.agency_signature_settings;
create policy agency_signature_settings_select on public.agency_signature_settings
for select to authenticated
using ((select private.has_agency(agency_id)));

drop policy if exists agency_signature_settings_insert on public.agency_signature_settings;
create policy agency_signature_settings_insert on public.agency_signature_settings
for insert to authenticated
with check (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
);

drop policy if exists agency_signature_settings_update on public.agency_signature_settings;
create policy agency_signature_settings_update on public.agency_signature_settings
for update to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
)
with check (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
);

drop policy if exists agency_signature_settings_delete on public.agency_signature_settings;
create policy agency_signature_settings_delete on public.agency_signature_settings
for delete to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
);

grant select, insert, update, delete on public.user_signatures to authenticated;
grant select on public.signature_events to authenticated;
grant select, insert, update, delete on public.agency_signature_settings to authenticated;
grant usage on schema public to authenticated;

-- ============================================================================
-- Storage: private user-signatures bucket.
--
-- Paths: <user_id>/signature.png and <user_id>/initials.png. Owner has full
-- object access on their own prefix; administrators/compliance_admin get
-- SELECT on a signer's prefix for verification (same agency-scoped rule as
-- the user_signatures table policy above).
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-signatures',
  'user-signatures',
  false,
  204800,
  array['image/png']::text[]
)
on conflict (id) do nothing;

drop policy if exists user_signatures_storage_select_own on storage.objects;
create policy user_signatures_storage_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'user-signatures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists user_signatures_storage_select_verifier on storage.objects;
create policy user_signatures_storage_select_verifier on storage.objects
for select to authenticated
using (
  bucket_id = 'user-signatures'
  and exists (
    select 1
    from public.memberships m
    where m.user_id::text = (storage.foldername(name))[1]
      and (m.expires_on is null or m.expires_on >= current_date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

drop policy if exists user_signatures_storage_insert_own on storage.objects;
create policy user_signatures_storage_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'user-signatures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists user_signatures_storage_update_own on storage.objects;
create policy user_signatures_storage_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'user-signatures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'user-signatures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists user_signatures_storage_delete_own on storage.objects;
create policy user_signatures_storage_delete_own on storage.objects
for delete to authenticated
using (
  bucket_id = 'user-signatures'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
