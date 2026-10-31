-- Staff scope repair (simulation Phase D, 2026-10-31; design corrected
-- after CI review the same day — see below).
--
-- Two hosted scope defects surfaced by the agency simulation
-- (NORTHSTAR2-MO), where a real agency ended up with zero
-- staff_assignments rows even though its DSPs had a home site on their
-- membership, and a nurse invited "Agency-wide" could not see anyone:
--
-- 1. private.dsp_works_at_site counted ONLY staff_assignments. Nothing
--    in the invite flow creates a staff_assignments row (the
--    invite-member edge function writes only the membership), so a DSP
--    whose membership names a home site still read zero Individuals.
--    A DSP now also works at the site named on their own membership
--    (their assigned home). The staff_assignments logic is unchanged,
--    so reassignment history keeps working exactly as before. This
--    half broke nothing and is unchanged from the original design.
--
-- 2. Nurse / house-manager caseloads now come from staff_assignments,
--    the same explicit record DSPs use: the staff_assignments branch
--    of private.can_read_site is widened from dsp-only to
--    dsp / nurse / house_manager, resolving an assignment's site the
--    same way private.dsp_works_at_site does (the assignment's own
--    site_id, or the site of the Individual it names). The invite flow
--    creates these assignments: a single chosen site becomes one site
--    assignment, and the "Agency-wide" choice for a nurse or house
--    manager becomes one site assignment per current site — so
--    widening coverage is an explicit, auditable assignment, never an
--    inference from a NULL membership site.
--
-- CORRECTED DESIGN — why coverage is NOT keyed off a NULL membership
-- site: the first version of this migration treated
-- memberships.site_id IS NULL for nurse/house_manager as agency-wide
-- in can_read_site. CI's therap_core_gaps_rls suite (18 failures)
-- proved that wrong. The product's nurse model is deliberate: nurses
-- are agency-wide clinical REVIEWERS through explicit
-- role_key_in('{nurse}') widenings on the GER / behavior / health
-- tables, while private.can_read_individual stays FALSE for a nurse
-- with no site scope — and that false is load-bearing:
-- private.ger_reports_scope_update() uses
-- `not can_read_individual(...)` to detect an out-of-scope nurse and
-- restrict her to review columns only. A NULL membership site does
-- not mean "deliberately agency-wide" in the existing data (the
-- therap fixture nurse has a NULL site and zero assignments), so the
-- null-site branch silently disabled those overwrite protections.
-- It is removed; can_read_individual stays false for a nurse or house
-- manager who has neither a membership home site nor an assignment.
--
-- Mirrors canReadIndividual in src/data/access.ts and the invite-member
-- edge function / LocalApi inviteMember, which create the assignments.

begin;

create or replace function private.dsp_works_at_site(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_assignments a
    left join individuals ai
      on ai.id = a.individual_id and ai.agency_id = a.agency_id
    where a.agency_id = p_agency_id and a.user_id = auth.uid()
      and a.starts_on <= current_date
      and coalesce(a.site_id, ai.site_id) = p_site_id
  ) or exists (
    select 1 from memberships m
    where m.agency_id = p_agency_id and m.user_id = auth.uid()
      and m.site_id = p_site_id
  );
$$;

revoke all on function private.dsp_works_at_site(uuid, uuid) from public;
grant execute on function private.dsp_works_at_site(uuid, uuid) to authenticated;

create or replace function private.can_read_site(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id) and exists (
    select 1 from memberships m join sites s on s.agency_id = m.agency_id
    where m.user_id = auth.uid() and m.agency_id = p_agency_id and s.id = p_site_id
      and (
        m.role_key in ('administrator','compliance_admin','degreed_professional_manager','program_manager','auditor','hr')
        or m.site_id = p_site_id
        or (m.role_key in ('dsp','nurse','house_manager') and exists (
          select 1 from staff_assignments a
          left join individuals ai
            on ai.id = a.individual_id and ai.agency_id = a.agency_id
          where a.agency_id = p_agency_id
            and a.user_id = auth.uid()
            and a.starts_on <= current_date
            and (a.ends_on is null or a.ends_on >= current_date)
            and coalesce(a.site_id, ai.site_id) = p_site_id
        ))
      )
  );
$$;

revoke all on function private.can_read_site(uuid, uuid) from public;
grant execute on function private.can_read_site(uuid, uuid) to authenticated;

commit;
