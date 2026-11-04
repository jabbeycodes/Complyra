-- Training roster: program manager read (simulation batches 195/196/197).
--
-- The Training roster is read by every hr.view_staff holder plus the program
-- manager (canViewTrainingRoster in src/data/permissions.ts). The program
-- manager template does not carry hr.view_staff, so the phase-0 SELECT
-- policies let a PM read only their own training rows: without this the
-- roster would list every staffer as "No training assigned yet" whatever
-- their real state. Each policy below is the 20260913191500 definition with
-- program_manager added to the reviewer list. Reads only: no write policy
-- changes, and a DSP still reads only their own rows.

begin;

drop policy if exists training_requirements_select on public.training_requirements;
create policy training_requirements_select on public.training_requirements
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.role_key_in(agency_id, '{compliance_admin,degreed_professional_manager,nurse,program_manager}'))
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
        or (select private.role_key_in(r.agency_id, '{compliance_admin,degreed_professional_manager,nurse,program_manager}'))
      )
  )
);

drop policy if exists training_countersignatures_select on public.training_countersignatures;
create policy training_countersignatures_select on public.training_countersignatures
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'hr.view_staff'))
  or (select private.role_key_in(agency_id, '{compliance_admin,degreed_professional_manager,nurse,program_manager}'))
);

commit;
