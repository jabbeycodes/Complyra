-- ============================================================================
-- HR DATA SCOPING (2026-11-12): close the house-manager agency-wide reach
-- into HR data at the database layer.
--
-- THE EXPOSURE: most HR tables take their team visibility from
-- private.hr_team_visible, whose privileged shortcut
-- (private.is_privileged) treats every membership with the legacy role
-- 'manager' as agency-wide. Legacy 'manager' is exactly the house-manager
-- membership (role_templates maps it to role_key 'house_manager'), so the
-- helper's house-manager site branch was dead code: ANY house manager
-- holding hub.view_team could read every home's punches, corrections,
-- timecard approvals, document acks, accrual ledger, shift swaps and
-- missed-punch reports — and several write policies gated only on a hub.*
-- permission (punch review update/delete, shift writes, kiosk token
-- writes, swap decisions, review-punch inserts, accrual-ledger writes,
-- staffing-pattern writes, binder writes) gave the same cross-home write
-- reach. PR #133 fixed this for time-off only
-- (private.time_off_team_visible); this migration applies the same
-- role_key-based scoping to the rest of the HR domain.
--
-- END STATE (every other role's effective access is preserved exactly):
--   - administrator / program_manager: agency-wide, as today.
--   - hr: agency-wide exactly where it is today (pay-settings-gated
--     tables, staffing patterns, binders, performance, time-off) and
--     still excluded from the team-visibility reads (punches, timecards,
--     swaps, ledger) — the deliberate #133 design, unchanged.
--   - house_manager: HR records for their own homes only — the row's
--     site, or for staff-keyed rows the subject staff member's sites,
--     where a viewer's/subject's sites are their membership home plus
--     their active staff_assignments. A house-manager membership with
--     NO home site remains an unscoped (program-level) manager
--     membership — the same convention private.time_off_team_visible
--     established — because that is an explicit agency configuration,
--     not a leak.
--   - dsp / nurse / auditor: unchanged (no branch admits them anywhere
--     they are not admitted today).
--
-- DELIBERATELY UNCHANGED (recorded so the choice is auditable):
--   - hr_time_off_* — already scoped by PR #133.
--   - hr_performance_reviews / hr_staff_corrective_actions — already
--     scoped by private.performance_chain_member (role_key based).
--   - hr_open_shifts / hr_open_shift_responses — already scoped by
--     private.can_manage_site_schedule (can_read_site is site-checked)
--     plus the by-design agency audience for open postings.
--   - Agency config / library tables whose policies never used the
--     team-visibility helpers: hr_pay_periods, hr_documents,
--     hr_readiness_requirements, hr_accrual_policies, hr_overtime_rules,
--     hr_punch_rules, hr_clock_credentials, hr_kiosk_audit,
--     hr_staff_permission_grants, hr_binder_templates. Their writes gate
--     on agency-level permissions (hub.approve_payroll,
--     hub.manage_documents, hub.manage_pay_settings,
--     certificates.manage) that house managers do not hold, and their
--     rows are agency configuration, not one home's staff records.
--   - Agency-member reads (private.has_agency, some plus hub.access) on
--     hr_shifts, hr_pay_periods, hr_documents,
--     hr_readiness_requirements, hr_accrual_policies, hr_overtime_rules,
--     hr_punch_rules, hr_kiosk_tokens (token HASHES only; the raw token
--     never leaves the resolve_kiosk_token RPC) and hr_binder_templates:
--     the schedule board and configuration libraries are agency-wide by
--     design. Only the WRITE side of hr_shifts / hr_kiosk_tokens is
--     scoped below, because hub.manage_schedule IS a house-manager
--     permission.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Scope primitives. hr_hm_site_in_scope / hr_hm_subject_in_scope answer for
-- the house-manager role only; the composed helpers add the agency-wide
-- roles. None of these replaces a policy's own permission gate — policies
-- keep their hub.* checks and AND the scope in.
-- ----------------------------------------------------------------------------

-- Is this site one of the caller's homes (house managers only)?
-- Membership home + active staff_assignments; an unscoped membership
-- (site_id null) counts as program-level and matches any site.
create or replace function private.hr_hm_site_in_scope(
  p_agency_id uuid, p_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= current_date)
      and p_site_id is not null
      and (
        m.site_id is null
        or m.site_id = p_site_id
        or exists (
          select 1
          from public.staff_assignments sa
          where sa.user_id = auth.uid()
            and sa.agency_id = p_agency_id
            and sa.site_id = p_site_id
            and sa.starts_on <= current_date
            and (sa.ends_on is null or sa.ends_on >= current_date)
        )
      )
  );
$$;

revoke all on function private.hr_hm_site_in_scope(uuid, uuid) from public;
grant execute on function private.hr_hm_site_in_scope(uuid, uuid) to authenticated;

-- Is this staff member one of the caller's people (house managers only)?
-- The subject's sites (membership home + active assignments) intersected
-- with the caller's sites; an unscoped caller membership matches anyone.
create or replace function private.hr_hm_subject_in_scope(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= current_date)
      and (
        m.site_id is null
        or exists (
          select 1
          from (
            select m.site_id as site_id
            union
            select sa.site_id
            from public.staff_assignments sa
            where sa.user_id = auth.uid()
              and sa.agency_id = p_agency_id
              and sa.site_id is not null
              and sa.starts_on <= current_date
              and (sa.ends_on is null or sa.ends_on >= current_date)
          ) viewer_sites
          join (
            select sm.site_id as site_id
            from public.memberships sm
            where sm.user_id = p_staff_id
              and sm.agency_id = p_agency_id
              and (sm.expires_on is null or sm.expires_on >= current_date)
              and sm.site_id is not null
            union
            select sa2.site_id
            from public.staff_assignments sa2
            where sa2.user_id = p_staff_id
              and sa2.agency_id = p_agency_id
              and sa2.site_id is not null
              and sa2.starts_on <= current_date
              and (sa2.ends_on is null or sa2.ends_on >= current_date)
          ) subject_sites on subject_sites.site_id = viewer_sites.site_id
        )
      )
  );
$$;

revoke all on function private.hr_hm_subject_in_scope(uuid, uuid) from public;
grant execute on function private.hr_hm_subject_in_scope(uuid, uuid) to authenticated;

-- Write-side site scope: the agency-wide HR roles (administrator,
-- program_manager, hr) act anywhere; house managers stay in their homes.
create or replace function private.hr_scope_site(
  p_agency_id uuid, p_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.role_key_in(
      p_agency_id, '{administrator,compliance_admin,program_manager,hr}'))
    or (select private.hr_hm_site_in_scope(p_agency_id, p_site_id));
$$;

revoke all on function private.hr_scope_site(uuid, uuid) from public;
grant execute on function private.hr_scope_site(uuid, uuid) to authenticated;

-- Write-side subject scope: same composition for staff-keyed rows.
create or replace function private.hr_scope_subject(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.role_key_in(
      p_agency_id, '{administrator,compliance_admin,program_manager,hr}'))
    or (select private.hr_hm_subject_in_scope(p_agency_id, p_staff_id));
$$;

revoke all on function private.hr_scope_subject(uuid, uuid) from public;
grant execute on function private.hr_scope_subject(uuid, uuid) to authenticated;

-- Team-visibility for staff-keyed rows, mirroring hr_team_visible's
-- audience (hub.view_team + administrator / program_manager agency-wide;
-- house managers scoped; hr deliberately NOT added — see the header).
create or replace function private.hr_subject_team_visible(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and (
      (select private.role_key_in(
        p_agency_id, '{administrator,compliance_admin,program_manager}'))
      or (select private.hr_hm_subject_in_scope(p_agency_id, p_staff_id))
    );
$$;

revoke all on function private.hr_subject_team_visible(uuid, uuid) from public;
grant execute on function private.hr_subject_team_visible(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- The shared team-visibility helper, redefined on role_key. Same
-- signature, same hub.view_team gate, same audience as today — except the
-- is_privileged shortcut is gone, so a site-bound house manager's branch
-- is finally the one that decides. Site-less rows stay program-level
-- (administrator / program_manager), as the original HM branch intended.
-- Every policy that calls this helper (punches, punch corrections,
-- missed-punch reports) is fixed by this redefinition alone.
-- ----------------------------------------------------------------------------

create or replace function private.hr_team_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and (
      (select private.role_key_in(
        p_agency_id, '{administrator,compliance_admin,program_manager}'))
      or (select private.hr_hm_site_in_scope(p_agency_id, p_site_id))
    );
$$;

-- ----------------------------------------------------------------------------
-- hr_punches: team read gains a subject fallback for site-less punches
-- (remote punches may carry no site; the staff member's home decides).
-- Review update/delete and reviewer inserts were gated on the permission
-- alone — a house manager of one home could edit, delete, or create
-- correction punches for every home. They now also require scope.
-- ----------------------------------------------------------------------------

drop policy if exists hr_punches_select on public.hr_punches;
create policy hr_punches_select on public.hr_punches
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, site_id))
  or (
    site_id is null
    and (select private.hr_subject_team_visible(agency_id, staff_id))
  )
);

drop policy if exists hr_punches_review_update on public.hr_punches;
create policy hr_punches_review_update on public.hr_punches
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_scope_site(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_scope_subject(agency_id, staff_id))
    )
  )
)
with check (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_scope_site(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_scope_subject(agency_id, staff_id))
    )
  )
);

drop policy if exists hr_punches_review_delete on public.hr_punches;
create policy hr_punches_review_delete on public.hr_punches
for delete to authenticated
using (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_scope_site(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_scope_subject(agency_id, staff_id))
    )
  )
);

drop policy if exists hr_punches_insert_review on public.hr_punches;
create policy hr_punches_insert_review on public.hr_punches
for insert to authenticated
with check (
  verification_method <> 'kiosk_pin'
  and (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_scope_site(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_scope_subject(agency_id, staff_id))
    )
  )
);

-- ----------------------------------------------------------------------------
-- hr_punch_corrections: the read/review joins already route through
-- hr_team_visible (fixed above); add the same site-less subject fallback
-- via the parent punch.
-- ----------------------------------------------------------------------------

drop policy if exists hr_punch_corrections_select on public.hr_punch_corrections;
create policy hr_punch_corrections_select on public.hr_punch_corrections
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and (
        private.hr_team_visible(p.agency_id, p.site_id)
        or (
          p.site_id is null
          and private.hr_subject_team_visible(
            p.agency_id, hr_punch_corrections.staff_id)
        )
      )
  )
);

drop policy if exists hr_punch_corrections_review on public.hr_punch_corrections;
create policy hr_punch_corrections_review on public.hr_punch_corrections
for update to authenticated
using (
  exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and private.has_permission(p.agency_id, 'hub.review_timecards')
      and (
        private.hr_team_visible(p.agency_id, p.site_id)
        or (
          p.site_id is null
          and private.hr_subject_team_visible(
            p.agency_id, hr_punch_corrections.staff_id)
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and private.has_permission(p.agency_id, 'hub.review_timecards')
      and (
        private.hr_team_visible(p.agency_id, p.site_id)
        or (
          p.site_id is null
          and private.hr_subject_team_visible(
            p.agency_id, hr_punch_corrections.staff_id)
        )
      )
  )
);

-- ----------------------------------------------------------------------------
-- hr_shifts + hr_kiosk_tokens writes: hub.manage_schedule is a
-- house-manager permission, so the permission alone was an agency-wide
-- write. Scope it to the row's site (agency-wide roles unaffected).
-- A site-less shift is program-level: administrator / program_manager
-- only, as with site-less team rows.
-- ----------------------------------------------------------------------------

drop policy if exists hr_shifts_write on public.hr_shifts;
create policy hr_shifts_write on public.hr_shifts
for all to authenticated
using (
  (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and (select private.hr_scope_site(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and (select private.hr_scope_site(agency_id, site_id))
);

drop policy if exists hr_kiosk_tokens_write on public.hr_kiosk_tokens;
create policy hr_kiosk_tokens_write on public.hr_kiosk_tokens
for all to authenticated
using (
  (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and (select private.hr_scope_site(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and (select private.hr_scope_site(agency_id, site_id))
);

-- ----------------------------------------------------------------------------
-- hr_timecard_approvals: team visibility was taken through the pay period
-- with a null site, which only the privileged shortcut could satisfy —
-- for house managers it satisfied it everywhere. The approval row is
-- staff-keyed, so scope by the subject.
-- ----------------------------------------------------------------------------

drop policy if exists hr_timecard_approvals_select on public.hr_timecard_approvals;
create policy hr_timecard_approvals_select on public.hr_timecard_approvals
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.hr_subject_team_visible(
        pp.agency_id, hr_timecard_approvals.staff_id)
  )
);

drop policy if exists hr_timecard_approvals_decide on public.hr_timecard_approvals;
create policy hr_timecard_approvals_decide on public.hr_timecard_approvals
for update to authenticated
using (
  exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.has_permission(pp.agency_id, 'hub.review_timecards')
      and private.hr_subject_team_visible(
        pp.agency_id, hr_timecard_approvals.staff_id)
  )
)
with check (
  exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.has_permission(pp.agency_id, 'hub.review_timecards')
      and private.hr_subject_team_visible(
        pp.agency_id, hr_timecard_approvals.staff_id)
  )
);

-- ----------------------------------------------------------------------------
-- hr_document_acks: same shape — staff-keyed rows read through the parent
-- document's agency, now with subject scope instead of the null-site
-- team check.
-- ----------------------------------------------------------------------------

drop policy if exists hr_document_acks_select on public.hr_document_acks;
create policy hr_document_acks_select on public.hr_document_acks
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_documents d
    where d.id = hr_document_acks.doc_id
      and private.hr_subject_team_visible(
        d.agency_id, hr_document_acks.staff_id)
  )
);

-- ----------------------------------------------------------------------------
-- hr_accrual_ledger: reads move from the null-site team check to subject
-- scope. Writes keep two paths: hub.manage_pay_settings (the payroll
-- configuration roles — administrator / program_manager / hr — post
-- adjustments agency-wide, as HR-PHASE2 designed) and hub.approve_time_off
-- (the deciding manager posts the debit/restore for a request they
-- decided — now limited to staff of their own homes).
-- ----------------------------------------------------------------------------

drop policy if exists hr_accrual_ledger_select on public.hr_accrual_ledger;
create policy hr_accrual_ledger_select on public.hr_accrual_ledger
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_subject_team_visible(agency_id, staff_id))
);

drop policy if exists hr_accrual_ledger_write on public.hr_accrual_ledger;
create policy hr_accrual_ledger_write on public.hr_accrual_ledger
for insert to authenticated
with check (
  (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
  or (
    (select private.has_permission(agency_id, 'hub.approve_time_off'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
);

drop policy if exists hr_accrual_ledger_update on public.hr_accrual_ledger;
create policy hr_accrual_ledger_update on public.hr_accrual_ledger
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
  or (
    (select private.has_permission(agency_id, 'hub.approve_time_off'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
)
with check (
  (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
  or (
    (select private.has_permission(agency_id, 'hub.approve_time_off'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
);

-- ----------------------------------------------------------------------------
-- hr_shift_swaps: the team read and the decide path are scoped by the
-- offered shift's site (subject fallback when the shift is site-less).
-- The requester/target/open-claim branches are untouched.
-- ----------------------------------------------------------------------------

drop policy if exists hr_shift_swaps_select on public.hr_shift_swaps;
create policy hr_shift_swaps_select on public.hr_shift_swaps
for select to authenticated
using (
  requester_id = auth.uid()
  or target_staff_id = auth.uid()
  or (
    status = 'pending'
    and target_staff_id is null
    and (select private.has_permission(agency_id, 'hub.access'))
  )
  or exists (
    select 1
    from public.hr_shifts s
    where s.id = hr_shift_swaps.offered_shift_id
      and (
        private.hr_team_visible(s.agency_id, s.site_id)
        or (
          s.site_id is null
          and private.hr_subject_team_visible(
            s.agency_id, hr_shift_swaps.requester_id)
        )
      )
  )
);

drop policy if exists hr_shift_swaps_decide on public.hr_shift_swaps;
create policy hr_shift_swaps_decide on public.hr_shift_swaps
for update to authenticated
using (
  status = 'pending'
  and (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and exists (
    select 1
    from public.hr_shifts s
    where s.id = hr_shift_swaps.offered_shift_id
      and (
        private.hr_scope_site(s.agency_id, s.site_id)
        or (
          s.site_id is null
          and private.hr_scope_subject(
            s.agency_id, hr_shift_swaps.requester_id)
        )
      )
  )
)
with check (
  status in ('approved', 'denied', 'cancelled')
  and decided_by = auth.uid()
  and decided_at is not null
  and (select private.has_permission(agency_id, 'hub.manage_schedule'))
  and exists (
    select 1
    from public.hr_shifts s
    where s.id = hr_shift_swaps.offered_shift_id
      and (
        private.hr_scope_site(s.agency_id, s.site_id)
        or (
          s.site_id is null
          and private.hr_scope_subject(
            s.agency_id, hr_shift_swaps.requester_id)
        )
      )
  )
);

-- ----------------------------------------------------------------------------
-- hr_missed_punch_reports: read/decide already route through
-- hr_team_visible (fixed above); add the site-less subject fallback.
-- ----------------------------------------------------------------------------

drop policy if exists hr_missed_punch_reports_select on public.hr_missed_punch_reports;
create policy hr_missed_punch_reports_select on public.hr_missed_punch_reports
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, site_id))
  or (
    site_id is null
    and (select private.hr_subject_team_visible(agency_id, staff_id))
  )
);

drop policy if exists hr_missed_punch_reports_decide on public.hr_missed_punch_reports;
create policy hr_missed_punch_reports_decide on public.hr_missed_punch_reports
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_team_visible(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_subject_team_visible(agency_id, staff_id))
    )
  )
)
with check (
  (select private.has_permission(agency_id, 'hub.review_timecards'))
  and (
    (select private.hr_team_visible(agency_id, site_id))
    or (
      site_id is null
      and (select private.hr_subject_team_visible(agency_id, staff_id))
    )
  )
);

-- ----------------------------------------------------------------------------
-- hr_staffing_patterns: the read helper and the write policy each carried
-- their own copy of the scope rule with private.is_privileged as the first
-- disjunct — the leak again (a house manager passed it for every site).
-- Both now compose hub.* permission + hr_scope_site. (Site-less patterns
-- are program-level: administrator / program_manager / hr.)
-- ----------------------------------------------------------------------------

create or replace function private.hr_staffing_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_agency(p_agency_id)
  and (select private.has_permission(p_agency_id, 'hub.access'))
  and (select private.hr_scope_site(p_agency_id, p_site_id));
$$;

drop policy if exists hr_staffing_patterns_write on public.hr_staffing_patterns;
create policy hr_staffing_patterns_write on public.hr_staffing_patterns
for all to authenticated
using (
  (select private.has_permission(agency_id, 'hub.manage_staffing'))
  and (select private.hr_scope_site(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.manage_staffing'))
  and (select private.hr_scope_site(agency_id, site_id))
);

-- ----------------------------------------------------------------------------
-- New-hire binders: the subject read rule admitted any hub.view_team
-- holder for every staff member (binders, wallet documents, emergency
-- contacts), and the write policies did the same. Team access is now
-- subject-scoped; the subject, HR-side roles, auditors (read), and
-- certificates.manage holders keep exactly what they had.
-- ----------------------------------------------------------------------------

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
    or (select private.hr_subject_team_visible(p_agency_id, p_staff_id))
    or (select private.role_key_in(
      p_agency_id, '{administrator,compliance_admin,hr,auditor}'))
$$;

drop policy if exists hr_binders_write on public.hr_binders;
create policy hr_binders_write on public.hr_binders
for all to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
)
with check (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
);

drop policy if exists hr_binder_documents_insert on public.hr_binder_documents;
create policy hr_binder_documents_insert on public.hr_binder_documents
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (
    staff_id = (select auth.uid())
    or (select private.has_permission(agency_id, 'certificates.manage'))
    or (
      (select private.has_permission(agency_id, 'hub.view_team'))
      and (select private.hr_scope_subject(agency_id, staff_id))
    )
  )
);

drop policy if exists hr_binder_documents_update on public.hr_binder_documents;
create policy hr_binder_documents_update on public.hr_binder_documents
for update to authenticated
using (
  staff_id = (select auth.uid())
  or uploaded_by = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
)
with check (
  staff_id = (select auth.uid())
  or uploaded_by = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
);

drop policy if exists hr_emergency_contacts_write on public.hr_emergency_contacts;
create policy hr_emergency_contacts_write on public.hr_emergency_contacts
for all to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
  or (select private.role_key_in(agency_id, '{hr}'))
)
with check (
  staff_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'certificates.manage'))
  or (
    (select private.has_permission(agency_id, 'hub.view_team'))
    and (select private.hr_scope_subject(agency_id, staff_id))
  )
  or (select private.role_key_in(agency_id, '{hr}'))
);
