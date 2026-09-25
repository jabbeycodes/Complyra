-- DSPs see every Individual at a program site where they currently work.
--
-- Agency rule (2026-09-25): staff are assigned to particular Individuals for
-- the day, but they must still see and record notes and MAR entries for the
-- other Individuals at the same program site. During some shifts the second
-- staff member leaves early and the remaining staff member becomes
-- responsible for everyone in the home.
--
-- Previously a DSP could read only the Individuals named on their own
-- staff_assignments rows. Now a DSP can read an Individual when they have
-- ever been assigned at that Individual's site (a site assignment, or an
-- Individual assignment whose Individual lives there), from the assignment's
-- start date. Reassignment does NOT end access: DSPs must be able to go back
-- and correct their own notes and MAR entries at any time. Access ends only
-- when the agency membership ends (private.has_agency: expired membership,
-- deactivated profile, inactive agency). Sites they never worked at stay
-- hidden.
--
-- Every policy built on private.can_read_individual (charts, notes, MAR,
-- medications, documents) follows this rule. Mirrors canReadIndividual in
-- src/data/access.ts.

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
  );
$$;

revoke all on function private.dsp_works_at_site(uuid, uuid) from public;
grant execute on function private.dsp_works_at_site(uuid, uuid) to authenticated;

create or replace function private.can_read_individual(p_agency_id uuid, p_individual_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id)
    and private.has_permission(p_agency_id, 'individuals.view') and exists (
      select 1 from individuals i join memberships m on m.agency_id = i.agency_id
      where m.user_id = auth.uid() and i.agency_id = p_agency_id and i.id = p_individual_id
        and (
          (m.role_key <> 'dsp' and private.can_read_site(p_agency_id, i.site_id))
          or (m.role_key = 'dsp' and private.dsp_works_at_site(p_agency_id, i.site_id))
        )
    );
$$;

commit;
