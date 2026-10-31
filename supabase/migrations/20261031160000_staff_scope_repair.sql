-- Staff scope repair (simulation Phase D, 2026-10-31).
--
-- Two hosted scope defects surfaced by the agency simulation
-- (NORTHSTAR2-MO), where a real agency ended up with zero
-- staff_assignments rows even though its DSPs had a home site on their
-- membership, and an agency-wide nurse could not see any site:
--
-- 1. private.dsp_works_at_site counted ONLY staff_assignments. Nothing
--    in the invite flow creates a staff_assignments row (the
--    invite-member edge function writes only the membership), so a DSP
--    whose membership names a home site still read zero Individuals.
--    A DSP now also works at the site named on their own membership
--    (their assigned home). The staff_assignments logic is unchanged,
--    so reassignment history keeps working exactly as before.
--
-- 2. private.can_read_site matched a site only through an agency-wide
--    role or an exact membership site_id. A nurse or house manager
--    whose membership site_id is NULL (the invite form's "Agency-wide"
--    choice) therefore matched nothing. The null-site allowance for
--    manager/nurse memberships existed in 20260912000000 but was
--    dropped by 20260915023000; this restores it for nurse and
--    house_manager only. DSPs are NOT extended: a DSP with no home
--    site and no assignments still sees nothing.
--
-- Mirrors canReadIndividual in src/data/access.ts and canAccessSite in
-- src/data/dashboard.ts.

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
        or (m.role_key in ('nurse','house_manager') and m.site_id is null)
        or (m.role_key = 'dsp' and exists (
          select 1 from staff_assignments a where a.agency_id = p_agency_id
            and a.user_id = auth.uid() and a.site_id = p_site_id
            and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
        ))
      )
  );
$$;

revoke all on function private.can_read_site(uuid, uuid) from public;
grant execute on function private.can_read_site(uuid, uuid) to authenticated;

commit;
