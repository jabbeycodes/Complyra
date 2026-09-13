-- Phase 0 security hardening (audit 2026-09-13: P0-1, P0-2, P0-5, P0-7) plus
-- DDL the app worker needs for P0-6/P0-8 (training signoff attribution,
-- signoff freeze + countersignature correction flow, med dose exceptions).
--
-- Conventions: every statement is defensive (`or replace`, `if not exists`,
-- `drop ... if exists`) so the file is re-runnable. RLS is already enabled +
-- forced on all touched tables by their original migrations.

-- ============================================================================
-- P0-1: protect_profile_identity() must also guard platform_admin and active.
--
-- profiles_update_self (20260911120000) allows UPDATE where id = auth.uid(),
-- and the guard trigger reset username/home_agency_id/must_change_password/
-- email but NOT platform_admin -- any authenticated user could PATCH their own
-- row with {"platform_admin": true} and unlock every cross-agency bypass.
-- The service_role bypass and the complyra.allow_identity_update escape hatch
-- (complete_password_change) behave exactly as before. No app flow writes
-- profiles.platform_admin or profiles.active through the authenticated role
-- (verified: only reads), so nothing legitimate breaks.
-- ============================================================================
create or replace function private.protect_profile_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if current_setting('complyra.allow_identity_update', true) = 'on' then
    return new;
  end if;
  new.username := old.username;
  new.home_agency_id := old.home_agency_id;
  new.must_change_password := old.must_change_password;
  new.email := old.email;
  -- P0-1: privilege + activation flags are never self-service. They change
  -- only via service_role (edge functions / admin tooling) or a
  -- separately-gated admin function.
  new.platform_admin := old.platform_admin;
  new.active := old.active;
  return new;
end;
$$;

-- ============================================================================
-- P0-7b: private.role_key_in() must honor membership expiry, like its sibling
-- helpers (has_agency, is_privileged, has_permission, can_read_*). Without
-- this, expired staff kept WRITE access on every role_key_in-gated policy.
-- ============================================================================
create or replace function private.role_key_in(p_agency_id uuid, p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role_key = any(p_keys)
      and (expires_on is null or expires_on >= current_date)
  );
$$;

-- ============================================================================
-- P0-2: server-side role-grant hierarchy.
--
-- canGrantRole() (src/data/permissions.ts) is UI-only; the RLS policies on
-- memberships/agency_roles accepted members.assign_roles for writes, so HR
-- could rewrite the administrator template's permission JSON or promote
-- themselves via direct PostgREST. This mirrors canGrantRole in SQL:
--   - unknown target key            -> false
--   - target 'administrator'        -> caller must be 'administrator'
--   - target 'compliance_admin'     -> caller in ('administrator','compliance_admin')
--   - any other valid key           -> true (the policy USING clause still
--                                      restricts WHO may write at all)
-- The caller's membership must be unexpired, matching the sibling helpers.
-- ============================================================================
create or replace function private.can_grant_role_key(p_agency_id uuid, p_target_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_target_key in (
      'administrator', 'compliance_admin', 'house_manager',
      'degreed_professional_manager', 'program_manager',
      'dsp', 'nurse', 'hr', 'auditor'
    )
    and case
      when p_target_key = 'administrator' then exists (
        select 1 from public.memberships m
        where m.user_id = auth.uid()
          and m.agency_id = p_agency_id
          and (m.expires_on is null or m.expires_on >= current_date)
          and m.role_key = 'administrator'
      )
      when p_target_key = 'compliance_admin' then exists (
        select 1 from public.memberships m
        where m.user_id = auth.uid()
          and m.agency_id = p_agency_id
          and (m.expires_on is null or m.expires_on >= current_date)
          and m.role_key in ('administrator', 'compliance_admin')
      )
      else true
    end;
$$;

revoke all on function private.can_grant_role_key(uuid, text) from public;
grant execute on function private.can_grant_role_key(uuid, text) to authenticated;

-- memberships_write_admin: keep the existing USING (who may touch rows), but
-- the WITH CHECK now also validates the WRITTEN role_key against the grant
-- hierarchy. HR keeps assigning operational roles; administrator /
-- compliance_admin grants stay administrator-only.
drop policy if exists memberships_write_admin on public.memberships;
create policy memberships_write_admin on public.memberships
for all to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'members.assign_roles'))
)
with check (
  (
    (select private.is_agency_admin(agency_id))
    or (select private.has_permission(agency_id, 'members.assign_roles'))
  )
  and (select private.can_grant_role_key(agency_id, role_key))
);

-- agency_roles_update: editing role templates requires roles.manage (the
-- dedicated "edit role access levels" permission), not members.assign_roles
-- ("assign roles to staff"). Agency administrators keep the backstop.
drop policy if exists agency_roles_update on public.agency_roles;
create policy agency_roles_update on public.agency_roles
for update to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
)
with check (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'roles.manage'))
);

-- Last-administrator guard as a trigger (the client's read-then-count has a
-- TOCTOU race). Blocks demoting, deleting, or deactivating the agency's last
-- ACTIVE administrator. Expiry-aware: an already-expired admin row does not
-- count, and deactivating the last active admin is blocked the same as
-- deleting them (both are lockouts).
create or replace function private.guard_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_remaining integer;
  v_was_admin_active boolean;
  v_stays_admin_active boolean;
begin
  if tg_op = 'DELETE' then
    v_agency_id := old.agency_id;
    v_was_admin_active :=
      old.role_key = 'administrator'
      and (old.expires_on is null or old.expires_on >= current_date);
    if v_was_admin_active then
      select count(*) into v_remaining
      from public.memberships m
      where m.agency_id = v_agency_id
        and m.id <> old.id
        and m.role_key = 'administrator'
        and (m.expires_on is null or m.expires_on >= current_date);
      if v_remaining = 0 then
        raise exception 'Cannot remove the last active agency administrator.';
      end if;
    end if;
    return old;
  end if;

  -- UPDATE
  v_agency_id := new.agency_id;
  v_was_admin_active :=
    old.role_key = 'administrator'
    and (old.expires_on is null or old.expires_on >= current_date);
  v_stays_admin_active :=
    new.role_key = 'administrator'
    and (new.expires_on is null or new.expires_on >= current_date);
  if v_was_admin_active and not v_stays_admin_active then
    select count(*) into v_remaining
    from public.memberships m
    where m.agency_id = v_agency_id
      and m.id <> old.id
      and m.role_key = 'administrator'
      and (m.expires_on is null or m.expires_on >= current_date);
    if v_remaining = 0 then
      raise exception 'Cannot demote or deactivate the last active agency administrator.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_last_administrator on public.memberships;
create trigger memberships_guard_last_administrator
before update or delete on public.memberships
for each row execute function private.guard_last_administrator();

-- Trigger-based audit on role-template edits: direct-DB edits bypass the
-- client-side audit() call, so the database records them itself. (The app's
-- own 'role.updated' entry still fires too -- expect both on app edits.)
create or replace function private.audit_agency_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (
    agency_id, actor_id, action, target_type, target_id, detail, metadata
  )
  values (
    new.agency_id,
    auth.uid(),
    'role.updated',
    'agency_role',
    new.id,
    'Role template "' || new.name || '" updated (database trigger).',
    jsonb_build_object(
      'template_key', new.template_key,
      'before', old.permissions,
      'after', new.permissions
    )
  );
  return new;
end;
$$;

drop trigger if exists agency_roles_audit_update on public.agency_roles;
create trigger agency_roles_audit_update
after update on public.agency_roles
for each row execute function private.audit_agency_role_change();

-- ============================================================================
-- P0-5: create the missing care-plan-docs storage bucket.
--
-- hostedApi.ts CHART_BUCKET = "care-plan-docs", used by saveChartFile() /
-- getChartFile() for renewal evidence and delegation discontinuation uploads.
-- No migration created it, so every such upload failed on hosted with
-- "Bucket not found". Private bucket, PDF-only, 10 MB -- mirroring the
-- agency-documents bucket. Paths are
--   <agencyId>/<individualId>/chart/<fileId>/<fileName>
-- so foldername(name)[1] = agency, [2] = individual, exactly like
-- agency-documents; the storage policies mirror it too (select gated on
-- can_read_individual, matching the chart_files table policy below).
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'care-plan-docs',
  'care-plan-docs',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

drop policy if exists care_plan_docs_storage_select on storage.objects;
create policy care_plan_docs_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'care-plan-docs'
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

drop policy if exists care_plan_docs_storage_insert on storage.objects;
create policy care_plan_docs_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'care-plan-docs'
  and (
    (select private.can_upload((storage.foldername(name))[1]::uuid))
    or (select private.can_approve((storage.foldername(name))[1]::uuid))
  )
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

drop policy if exists care_plan_docs_storage_update on storage.objects;
create policy care_plan_docs_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'care-plan-docs'
  and (select private.can_approve((storage.foldername(name))[1]::uuid))
)
with check (
  bucket_id = 'care-plan-docs'
  and (select private.can_approve((storage.foldername(name))[1]::uuid))
);

-- ============================================================================
-- P0-7a: clinical SELECT policies must implement the documented boundaries,
-- not has_agency.
--
-- Every *_select below previously used private.has_agency(agency_id), so any
-- agency member (e.g. HR, whose documented boundary is "employment records
-- only, not individual care files") could dump clinical data via direct
-- PostgREST. Replacements follow the foundation helpers:
--   individual-linked tables -> private.can_read_individual(agency_id, individual_id)
--   site-linked tables       -> private.can_read_site(agency_id, site_id)
--   staff-linked tables      -> the roles the app's UI gates actually serve
--                               (HR/admin/DPM/nurse/HM; DSPs see only their own
--                               rows; auditors keep only what the foundation
--                               pattern already grants them)
-- agency_monthly_due, agency_branding, and the agency-assets bucket stay on
-- has_agency: they are genuinely agency-wide.
--
-- Write policies are intentionally untouched: legitimate write flows (DSPs
-- logging mileage/meds, HMs answering checklists, DPMs reviewing) keep the
-- exact predicates they had.
-- ============================================================================

-- -- chart (individual-linked) -----------------------------------------------
drop policy if exists individual_profiles_select on public.individual_profiles;
create policy individual_profiles_select on public.individual_profiles
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists obligations_select on public.obligations;
create policy obligations_select on public.obligations
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists obligation_signatures_select on public.obligation_signatures;
create policy obligation_signatures_select on public.obligation_signatures
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.obligations o
    where o.id = obligation_signatures.obligation_id
      and (select private.can_read_individual(o.agency_id, o.individual_id))
  )
);

drop policy if exists packet_submissions_select on public.packet_submissions;
create policy packet_submissions_select on public.packet_submissions
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.can_read_individual(agency_id, individual_id))
);

drop policy if exists chart_files_select on public.chart_files;
create policy chart_files_select on public.chart_files
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists clinical_renewals_select on public.clinical_renewals;
create policy clinical_renewals_select on public.clinical_renewals
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists medications_select on public.medications;
create policy medications_select on public.medications
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists medication_deliveries_select on public.medication_deliveries;
create policy medication_deliveries_select on public.medication_deliveries
for select to authenticated
using (
  exists (
    select 1
    from public.medications m
    where m.id = medication_deliveries.medication_id
      and (select private.can_read_individual(m.agency_id, m.individual_id))
  )
);

drop policy if exists prn_dose_logs_select on public.prn_dose_logs;
create policy prn_dose_logs_select on public.prn_dose_logs
for select to authenticated
using (
  exists (
    select 1
    from public.medications m
    where m.id = prn_dose_logs.medication_id
      and (select private.can_read_individual(m.agency_id, m.individual_id))
  )
);

drop policy if exists adaptive_equipment_select on public.adaptive_equipment;
create policy adaptive_equipment_select on public.adaptive_equipment
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists equipment_month_logs_select on public.equipment_month_logs;
create policy equipment_month_logs_select on public.equipment_month_logs
for select to authenticated
using (
  exists (
    select 1
    from public.adaptive_equipment e
    where e.id = equipment_month_logs.equipment_id
      and (select private.can_read_individual(e.agency_id, e.individual_id))
  )
);

-- legacy training checklists: individual-linked AND staff-linked. Readers are
-- the staffer themselves, hr.view_staff holders (HR/admin/HM -- the app's
-- training gates), and individual readers (DPM/nurse/admin/CA/auditor per the
-- foundation pattern, which the app's canSeeRenewals gate also serves).
drop policy if exists training_checklists_select on public.training_checklists;
create policy training_checklists_select on public.training_checklists
for select to authenticated
using (
  staff_user_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.can_read_individual(agency_id, individual_id))
);

-- -- chart (site-linked) -------------------------------------------------------
drop policy if exists drills_select on public.emergency_drills;
create policy drills_select on public.emergency_drills
for select to authenticated
using ((select private.can_read_site(agency_id, site_id)));

drop policy if exists safety_reports_select on public.home_safety_reports;
create policy safety_reports_select on public.home_safety_reports
for select to authenticated
using ((select private.can_read_site(agency_id, site_id)));

drop policy if exists site_facts_select on public.site_facts;
create policy site_facts_select on public.site_facts
for select to authenticated
using ((select private.can_read_site(agency_id, site_id)));

drop policy if exists site_reviews_select on public.site_reviews;
create policy site_reviews_select on public.site_reviews
for select to authenticated
using ((select private.can_read_site(agency_id, site_id)));

-- -- certificates (staff-linked) ----------------------------------------------
-- The app gates certificate reads on hr.view_staff OR certificates.manage
-- (App.tsx canViewCerts; CertificateManager). The DB now matches: HR, admin,
-- and HMs (hr.view_staff) plus anyone explicitly granted certificates.manage.
-- DPM/nurse have no cert UI today, so they get none here either.
drop policy if exists staff_certificates_select on public.staff_certificates;
create policy staff_certificates_select on public.staff_certificates
for select to authenticated
using (
  (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.has_permission(agency_id, 'certificates.manage'))
);

drop policy if exists staff_certificates_storage_select on storage.objects;
create policy staff_certificates_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'staff-certificates'
  and (
    (select private.has_permission(
      (storage.foldername(name))[2]::uuid,
      'hr.view_staff'
    ))
    or (select private.has_permission(
      (storage.foldername(name))[2]::uuid,
      'certificates.manage'
    ))
  )
);

-- -- HM weekly checklists (site-linked) -----------------------------------------
-- Site-scoped reads, plus the assigned HM can always read their own rows
-- (covers an HM assigned to a site outside their membership site_id).
drop policy if exists hm_weekly_checklists_select on public.hm_weekly_checklists;
create policy hm_weekly_checklists_select on public.hm_weekly_checklists
for select to authenticated
using (
  assigned_to_user_id = (select auth.uid())
  or (select private.can_read_site(agency_id, site_id))
);

-- -- training engine (staff-linked) ----------------------------------------------
-- The app lets staff view their OWN training profile
-- (getStaffTrainingProfile: self, else requires hr.view_staff). Readers:
-- the staffer, hr.view_staff holders (HR/admin/HM), and compliance_admin /
-- DPM / nurse (the reviewer roles). Plain DSPs see only their own rows;
-- auditors are excluded (the app never serves them training data).
drop policy if exists training_requirements_select on public.training_requirements;
create policy training_requirements_select on public.training_requirements
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.role_key_in(agency_id, '{compliance_admin,degreed_professional_manager,nurse}'))
);

drop policy if exists training_signoffs_select on public.training_signoffs;
create policy training_signoffs_select on public.training_signoffs
for select to authenticated
using (
  exists (
    select 1
    from public.training_requirements r
    where r.id = training_signoffs.requirement_id
      and (
        r.user_id = (select auth.uid())
        or (select private.has_permission(r.agency_id, 'hr.view_staff'))
        or (select private.role_key_in(r.agency_id, '{compliance_admin,degreed_professional_manager,nurse}'))
      )
  )
);

drop policy if exists training_countersignatures_select on public.training_countersignatures;
create policy training_countersignatures_select on public.training_countersignatures
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.role_key_in(agency_id, '{compliance_admin,degreed_professional_manager,nurse}'))
);

-- -- med inventory (individual-linked) -------------------------------------------
drop policy if exists med_inventory_select on public.med_inventory;
create policy med_inventory_select on public.med_inventory
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

-- -- mileage (site-linked) --------------------------------------------------------
-- Site-scoped reads, plus anyone holding mileage.manage (the app deliberately
-- grants it to HR as well as DSP/HM/DPM/nurse/admins, and the Mileage page has
-- no narrower gate) keeps read access so their legitimate logging flow works.
drop policy if exists mileage_trips_select on public.mileage_trips;
create policy mileage_trips_select on public.mileage_trips
for select to authenticated
using (
  (select private.can_read_site(agency_id, site_id))
  or (select private.has_permission(agency_id, 'mileage.manage'))
);

-- ============================================================================
-- DDL for the app worker (P0-6/P0-8).
-- ============================================================================

-- -- training signoff attribution (T1-T4) -----------------------------------------
-- Who entered the line (from the session), which staffer actually delivered
-- the training (trainer picker; free text stays as fallback), and whether the
-- staffer trained themselves (flagged for review).
alter table public.training_signoffs
  add column if not exists signed_by_user_id uuid references public.profiles(id),
  add column if not exists trainer_user_id uuid references public.profiles(id),
  add column if not exists self_training boolean not null default false;

-- -- signoff freeze after HM countersignature (T1-T4) -------------------------------
-- training_countersignatures is keyed (agency_id, user_id, site_id): one sheet
-- per staffer per site, no checklist_id. A signoff joins via its requirement
-- (requirement -> user_id + site_id). Once hm_signed_at is set, signoff rows
-- are no longer updatable. Correction path: a privileged role DELETES the
-- countersignature row (see training_countersignatures_delete below) + writes
-- an audit entry with the reason; signoffs become editable again and the
-- sheet must be re-countersigned.
drop policy if exists training_signoffs_update on public.training_signoffs;
create policy training_signoffs_update on public.training_signoffs
for update to authenticated
using (
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
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
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
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

-- Split the old `for all` countersignature policy into per-operation policies
-- so DELETE becomes the explicit, privileged correction path. INSERT/UPDATE
-- predicates are unchanged (staff sign their own sheet; house managers and
-- other privileged roles countersign). DELETE is restricted to
-- administrator / compliance_admin / DPM -- staff can no longer void their
-- own sheet, and HMs void via the same privileged path.
drop policy if exists training_countersignatures_write on public.training_countersignatures;
drop policy if exists training_countersignatures_insert on public.training_countersignatures;
drop policy if exists training_countersignatures_update on public.training_countersignatures;
drop policy if exists training_countersignatures_delete on public.training_countersignatures;
create policy training_countersignatures_insert on public.training_countersignatures
for insert to authenticated
with check (
  user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
);
create policy training_countersignatures_update on public.training_countersignatures
for update to authenticated
using (
  user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
)
with check (
  user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
);
create policy training_countersignatures_delete on public.training_countersignatures
for delete to authenticated
using (
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}'))
);

-- -- med dose exceptions (M1: refused / held / wasted) ------------------------------
-- Dose-event exceptions that adjust the med forecast. Recorded during the med
-- pass, so DSPs are included (mirrors prn_dose_logs_write); the med-inventory
-- write set alone would RLS-block the primary flow, so dsp is added here.
-- Insert-only by policy: corrections are new rows, never edits (audit-safe).
create table if not exists public.med_dose_exceptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  individual_id uuid not null,
  medication_id uuid not null,
  occurred_on date not null default current_date,
  kind text not null check (kind in ('refused','held','wasted')),
  pills_affected integer not null check (pills_affected > 0),
  reason text not null check (char_length(trim(reason)) > 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals(id, agency_id) on delete cascade,
  foreign key (medication_id, agency_id) references public.medications(id, agency_id) on delete cascade
);

create index if not exists med_dose_exceptions_medication_idx
  on public.med_dose_exceptions (agency_id, medication_id);
create index if not exists med_dose_exceptions_individual_idx
  on public.med_dose_exceptions (agency_id, individual_id);

alter table public.med_dose_exceptions enable row level security;
alter table public.med_dose_exceptions force row level security;

drop policy if exists med_dose_exceptions_select on public.med_dose_exceptions;
create policy med_dose_exceptions_select on public.med_dose_exceptions
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

drop policy if exists med_dose_exceptions_insert on public.med_dose_exceptions;
create policy med_dose_exceptions_insert on public.med_dose_exceptions
for insert to authenticated
with check (
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}'))
);

grant select, insert, update, delete on public.med_dose_exceptions to authenticated;
grant usage on schema public to authenticated;

-- ============================================================================
-- P0-7a follow-up: close the FOR ALL write-policy SELECT leak.
--
-- Every *_write policy below was created FOR ALL with an agency-wide
-- role_key_in()/can_approve()/has_permission() USING clause. In Postgres a
-- FOR ALL policy also governs SELECT, and permissive policies are OR-ed --
-- so e.g. any DSP in the agency could SELECT every medication row despite the
-- tightened medications_select policy (verified on hosted before this fix).
--
-- This splits each FOR ALL policy into INSERT/UPDATE/DELETE policies with
-- byte-identical predicates (generated from the live catalog, so the exact
-- original expressions are preserved). Write behavior is unchanged; SELECT is
-- now governed solely by the tightened *_select policies above.
-- Idempotent: safe to re-run (drops the per-operation names first).
-- ============================================================================
do $$
declare
  v record;
  v_base text;
  v_using text;
  v_check text;
begin
  for v in
    select t.relname as tbl, c.polname as old
    from pg_policy c
    join pg_class t on t.oid = c.polrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.polcmd = '*'
      and c.polname in (
        'individual_profiles_write',
        'obligations_write',
        'chart_files_write',
        'clinical_renewals_write',
        'medications_write',
        'medication_deliveries_write',
        'prn_dose_logs_write',
        'adaptive_equipment_write',
        'equipment_logs_write',
        'drills_write',
        'safety_reports_write',
        'site_facts_write',
        'site_reviews_write',
        'staff_certificates_write',
        'training_requirements_write',
        'med_inventory_write',
        'mileage_trips_write'
      )
  loop
    select pg_get_expr(p.polqual, p.polrelid),
           pg_get_expr(p.polwithcheck, p.polrelid)
      into v_using, v_check
    from pg_policy p
    join pg_class t2 on t2.oid = p.polrelid
    where p.polname = v.old and t2.relname = v.tbl;
    if v_using is null or v_check is null then
      raise exception 'unexpected null predicate on policy %', v.old;
    end if;
    v_base := regexp_replace(v.old, '_write$', '');
    execute format('drop policy if exists %I on public.%I', v.old, v.tbl);
    execute format('drop policy if exists %I on public.%I', v_base || '_insert', v.tbl);
    execute format('drop policy if exists %I on public.%I', v_base || '_update', v.tbl);
    execute format('drop policy if exists %I on public.%I', v_base || '_delete', v.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (%s)',
      v_base || '_insert', v.tbl, v_check);
    execute format(
      'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      v_base || '_update', v.tbl, v_using, v_check);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (%s)',
      v_base || '_delete', v.tbl, v_using);
  end loop;
end
$$;
