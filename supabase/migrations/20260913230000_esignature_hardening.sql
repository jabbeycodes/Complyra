-- E-SIGNATURE HARDENING (2026-09-13): 13 CSR 65-3.050 compliance for the
-- DocuSign-style e-signature flow.
--
-- 13 CSR 65-3.050 (MO HealthNet electronic signatures on Medicaid records)
-- requires:
--   (1) affixing a signature requires at least two distinct identification
--       components (e.g. ID code + password) -> password re-entry at signing
--       ("second ID component"), one re-entry covering a 5-minute signing
--       session, tracked in public.signature_reauth;
--   (2) the system tracks user log-in/log-out dates/times, user ID, device ID,
--       and dates/times records are created, updated, viewed, or modified ->
--       public.signature_audit_log (login, logout, document_viewed,
--       reauth_*, sign_applied), plus device_id / ip_address columns on
--       public.signature_events;
--   (3) a signature stamp or merely typing a name does not constitute an
--       e-signature -> the v2 consent text documents why an adopted typed
--       style qualifies (adoption ceremony + recorded intent).
--
-- RETENTION (6-YEAR): waiver providers must retain records six years from the
-- date of service (MMAC Record Retention Policy; Medicaid audits reach back
-- five). Accordingly:
--   - signature_events, signature_audit_log, user_signatures and
--     signature_reauth carry NO delete RLS policies for the authenticated
--     role; rows are written only by the apply-signature edge function through
--     the service_role key (signature_reauth is additionally excluded from
--     every client read path).
--   - NO data-lifecycle / auto-purge jobs may target these tables. Any future
--     destruction workflow must implement legal hold and agency sign-off
--     BEFORE it is allowed to touch them.
--
-- Idempotent (if not exists / drop policy if exists) so the file is re-runnable.

-- ============================================================================
-- Tables
-- ============================================================================

-- Second-ID-component state: when the user last re-entered their password for
-- the signing ceremony. A row is (re)written by the apply-signature edge
-- function only, after it verifies the password against the Auth API. The
-- function treats reauth_at as fresh for REAUTH_WINDOW_SECONDS (300s / 5 min);
-- older than that, signing is rejected with code `reauth_required`.
create table if not exists public.signature_reauth (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reauth_at timestamptz not null default now(),
  failed_attempts integer not null default 0,
  attempt_window_start timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.signature_reauth is
  '13 CSR 65-3.050 second identification component: password re-entry state for the e-signing ceremony. Written only by the apply-signature edge function (service role). 6-year retention: no client delete, no purge jobs.';

-- 13 CSR 65-3.050 audit trail: log-in/log-out, signing-ceremony steps, and
-- record views for signed documents, with device and network identifiers.
create table if not exists public.signature_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agency_id uuid references public.agencies(id) on delete set null,
  action text not null check (action in (
    'login', 'logout',
    'reauth_success', 'reauth_failed',
    'sign_applied', 'document_viewed'
  )),
  document_type text,
  document_id text,
  field_name text,
  created_at timestamptz not null default now(),
  device_id text,
  ip_address inet,
  user_agent text,
  details jsonb
);
comment on table public.signature_audit_log is
  '13 CSR 65-3.050 audit trail: login/logout, password re-entry outcomes, applied signatures, and signed-document views, with device ID and IP. Written only by the apply-signature edge function (service role). 6-year retention: no client delete, no purge jobs.';

create index if not exists signature_audit_log_user_idx
  on public.signature_audit_log (user_id, created_at desc);
create index if not exists signature_audit_log_document_idx
  on public.signature_audit_log (document_type, document_id, created_at desc);

-- Signing-ceremony metadata on the event itself (13 CSR 65-3.050: track the
-- device ID alongside who signed what, when).
alter table public.signature_events
  add column if not exists device_id text;
alter table public.signature_events
  add column if not exists ip_address inet;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.signature_reauth enable row level security;
alter table public.signature_reauth force row level security;

alter table public.signature_audit_log enable row level security;
alter table public.signature_audit_log force row level security;

-- -- signature_reauth ------------------------------------------------------------
-- No policies for the authenticated role at all: the table is readable and
-- writable only through the service_role key (the apply-signature edge
-- function). Clients must never learn another user's re-auth state.
-- (Deliberately no GRANT to authenticated either.)

-- -- signature_audit_log -----------------------------------------------------------
-- Immutable ledger, same pattern as signature_events: no INSERT/UPDATE/DELETE
-- policies for the authenticated role, so rows can only be written by the
-- apply-signature edge function through the service_role key (clients request
-- login/logout/view logging through the function's `log` action, which lets
-- the server capture the true IP). Reads: the actor themselves, and
-- administrator/compliance_admin of any agency the actor belongs to.
drop policy if exists signature_audit_log_select_own on public.signature_audit_log;
create policy signature_audit_log_select_own on public.signature_audit_log
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists signature_audit_log_select_verifier on public.signature_audit_log;
create policy signature_audit_log_select_verifier on public.signature_audit_log
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = signature_audit_log.user_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

grant select on public.signature_audit_log to authenticated;
grant usage on schema public to authenticated;

-- -- training_signoffs_update: trainee carve-out ---------------------------------
-- 13 CSR 65-3.050 attribution requires that ONLY the assigned trainee initials
-- their own training lines (enforced for the stamp in the apply-signature edge
-- function). The save path must not lock the trainee out of the re-initial a
-- correction demands: the INSERT policy already reads "staff initial their own
-- lines", so UPDATE gains the same carve-out. The signed-sheet lock (no edits
-- once the HM has countersigned) is unchanged.
drop policy if exists training_signoffs_update on public.training_signoffs;
create policy training_signoffs_update on public.training_signoffs
for update to authenticated
using (
  (
    (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
    or exists (
      select 1 from public.training_requirements r
      where r.id = training_signoffs.requirement_id
        and r.user_id = (select auth.uid())
    )
  )
  and not exists (
    select 1
    from public.training_requirements r
    join public.training_countersignatures cs
      on cs.agency_id = r.agency_id
     and cs.user_id = r.user_id
     and cs.site_id = r.site_id
    where r.id = training_signoffs.requirement_id
      and cs.hm_signed_at is not null
  )
)
with check (
  (
    (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
    or exists (
      select 1 from public.training_requirements r
      where r.id = training_signoffs.requirement_id
        and r.user_id = (select auth.uid())
    )
  )
  and not exists (
    select 1
    from public.training_requirements r
    join public.training_countersignatures cs
      on cs.agency_id = r.agency_id
     and cs.user_id = r.user_id
     and cs.site_id = r.site_id
    where r.id = training_signoffs.requirement_id
      and cs.hm_signed_at is not null
  )
);
