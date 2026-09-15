-- ISP data follow-up: let a house manager save shift assignments for their own
-- site. The client API already scopes HMs to their own site (ispScopeSite),
-- but the base RLS policy only allowed isp.manage_plan, so HM assignment
-- saves were rejected on hosted. DPM/administrator still hold full plan
-- rights; shift patterns themselves remain isp.manage_plan-only.

drop policy if exists isp_shift_assignments_write on public.isp_shift_assignments;
create policy isp_shift_assignments_write on public.isp_shift_assignments
for all to authenticated
using (
  (select private.has_permission(agency_id, 'isp.manage_plan'))
  or exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = isp_shift_assignments.agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= current_date)
      and (m.site_id = isp_shift_assignments.site_id or m.site_id is null)
  )
)
with check (
  (select private.has_permission(agency_id, 'isp.manage_plan'))
  or exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = isp_shift_assignments.agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= current_date)
      and (m.site_id = isp_shift_assignments.site_id or m.site_id is null)
  )
);
