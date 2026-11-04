-- Wave 3 (retest): binder templates are agency configuration.
--
-- The write policy from 20261030120000 admitted certificates.manage holders
-- (HR by default) and administrators. Template edits now belong to
-- administrators and program managers only; both HR stores already refuse
-- anyone else, and this makes a direct API call refuse the same way. HR keeps
-- certificates.manage, and with it binder verification and every other board
-- operation. Reading templates stays open to any agency member, because
-- opening a binder snapshots one.

drop policy if exists hr_binder_templates_write on public.hr_binder_templates;

create policy hr_binder_templates_write on public.hr_binder_templates
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,program_manager}')));
