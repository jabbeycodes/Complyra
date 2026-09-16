-- 2026-09-16: issue #81 — Individual chart Overview.
--
-- House managers and nurses may save their own Overview fields (contacts for
-- HM; diagnoses for the nurse). Field-level authorization lives in the app
-- layer via the new scoped API methods updateIndividualContacts /
-- updateIndividualDiagnosis (src/data/localApi.ts, src/data/hostedApi.ts),
-- gated by canEditIndividualContacts / canEditDiagnoses (src/data/chart.ts).
-- This policy is the coarse row-level backstop that lets those roles write
-- the profile row at all; the API is what keeps each role inside its fields.
begin;

drop policy if exists individual_profiles_write on public.individual_profiles;

create policy individual_profiles_write on public.individual_profiles
for all to authenticated
using (
  (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,degreed_professional_manager,program_manager,house_manager,nurse}'
  ))
)
with check (
  (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,degreed_professional_manager,program_manager,house_manager,nurse}'
  ))
);

commit;
