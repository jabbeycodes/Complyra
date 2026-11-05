-- Wave 3c (PR #258 review HOLD): chart-file removal must be safe on hosted.
--
-- The chart's "Remove file" action (canRemoveRenewalFile in
-- src/data/planStack.ts) is offered to administrators, program managers,
-- nurses (RN) and house managers. Two hosted gaps made that action unable to
-- finish cleanly:
--
--   1. chart_files_insert / _update / _delete (split from chart_files_write by
--      20260913191500) name administrator, compliance_admin, house_manager,
--      degreed_professional_manager and nurse — never program_manager. A PM
--      only got through via role_key_in's retired-key aliasing
--      (degreed_professional_manager -> program_manager, 20260916060000).
--      The removal path must not depend on an alias for a retired role, so the
--      three write policies are recreated naming the surviving roles directly
--      (program_manager included). Each is also held to the Individual access
--      boundary (private.can_read_individual(agency_id, individual_id)) so a
--      house manager or nurse at one home cannot insert, re-point or delete
--      another home's chart_files row (PR #258 review, round 2). On UPDATE the
--      boundary is checked on both the old row (USING) and the new row
--      (WITH CHECK), so a row cannot be moved into or out of scope.
--
--   2. The care-plan-docs bucket had select / insert / update policies but no
--      DELETE policy, so every hosted storage removal was refused and the
--      PHI-bearing object stayed behind. care_plan_docs_storage_delete admits
--      the same four roles, within the Individual access boundary (path is
--      <agencyId>/<individualId>/chart/<fileId>/<fileName>, mirroring
--      care_plan_docs_storage_select).
--
-- Roles are listed by their surviving keys only; compliance_admin and
-- degreed_professional_manager were merged into administrator and
-- program_manager (20261031310000, 20260916060000) and role_key_in still
-- normalizes them, so no migrated membership loses access.
-- chart_files_consultation_insert (20260915170000) is left untouched: it
-- covers DSP consultation uploads (kind = 'other') and is OR-ed with these.
-- Idempotent: every policy is dropped by name before it is created.

begin;

drop policy if exists chart_files_write on public.chart_files;
drop policy if exists chart_files_insert on public.chart_files;
drop policy if exists chart_files_update on public.chart_files;
drop policy if exists chart_files_delete on public.chart_files;

create policy chart_files_insert on public.chart_files
for insert to authenticated
with check (
  (select private.role_key_in(agency_id, '{administrator,program_manager,nurse,house_manager}'))
  and (select private.can_read_individual(agency_id, individual_id))
);

create policy chart_files_update on public.chart_files
for update to authenticated
using (
  (select private.role_key_in(agency_id, '{administrator,program_manager,nurse,house_manager}'))
  and (select private.can_read_individual(agency_id, individual_id))
)
with check (
  (select private.role_key_in(agency_id, '{administrator,program_manager,nurse,house_manager}'))
  and (select private.can_read_individual(agency_id, individual_id))
);

create policy chart_files_delete on public.chart_files
for delete to authenticated
using (
  (select private.role_key_in(agency_id, '{administrator,program_manager,nurse,house_manager}'))
  and (select private.can_read_individual(agency_id, individual_id))
);

drop policy if exists care_plan_docs_storage_delete on storage.objects;
create policy care_plan_docs_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'care-plan-docs'
  and (select private.role_key_in(
    (storage.foldername(name))[1]::uuid,
    '{administrator,program_manager,nurse,house_manager}'
  ))
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

commit;
