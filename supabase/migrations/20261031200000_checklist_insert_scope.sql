-- Checklist insert scope (agency simulation batch 19, High).
--
-- The HM weekly checklist page runs the idempotent weekly rollover under
-- the signed-in user's own session, and the rollover INSERTs the row that
-- opens the current week. The original INSERT policy on
-- hm_weekly_checklists only allowed the agency management roles
-- {administrator, compliance_admin, degreed_professional_manager}, so:
--   * a house manager opening her own weekly checklist hit a raw
--     "new row violates row-level security policy" error whenever her
--     home had no row yet for the week (batch 19: Juniper HM, two 403s);
--   * a program manager assigning a checklist — a flow the app explicitly
--     supports (checklistCanAssign / assertChecklistAssigner) — was only
--     covered accidentally, through role_key_in's degreed_professional_
--     manager -> program_manager compatibility mapping (20260916060000);
--     the role is now named explicitly instead of relying on the shim.
--
-- The insert check now mirrors the app's creation rules:
--   * management roles (administrator, compliance_admin,
--     degreed_professional_manager, program_manager) may create a row for
--     any home in their agency;
--   * a house manager may create the row assigned to themselves at a home
--     they can read (membership home or an active assignment) — exactly
--     the self-open path the rollover needs, nothing wider;
--   * everyone else (DSPs, nurses, HR, auditors) cannot create rows.
--
-- The restrictive audit_site_scope / audit_active_membership policies
-- still apply on top, so no branch of this check can write outside the
-- caller's readable sites or agency. Select/update/delete policies are
-- unchanged. Forward-only: the old policy is dropped and recreated.

drop policy if exists hm_weekly_checklists_insert on public.hm_weekly_checklists;
create policy hm_weekly_checklists_insert on public.hm_weekly_checklists
for insert to authenticated
with check (
  (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,program_manager}'))
  or (
    assigned_to_user_id = (select auth.uid())
    and (select private.role_key_in(agency_id, '{house_manager}'))
    and (select private.can_read_site(agency_id, site_id))
  )
);
