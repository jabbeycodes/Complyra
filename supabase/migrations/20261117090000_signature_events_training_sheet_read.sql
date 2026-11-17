-- Wave 5, Item 2 (simulation retest batches 316-317): two viewers derived
-- DIFFERENT states for the same training line, and the state that said
-- "Needs re-initialing" never surfaced the owner's Re-initial action.
--
-- Cause: the training profile page derives a line's initials state (the
-- "Needs re-initialing" hint, the stamp, and the owner's Re-initial
-- button) from the sheet's signature_events. The only SELECT policies on
-- signature_events (20260913200000) are the signer's own rows and an
-- administrator-of-the-signer's-agency verifier policy, so every other
-- profile viewer — house manager, program manager, nurse, auditor —
-- silently reads ZERO events for another staffer's sheet (RLS filters,
-- no error). An empty event set makes every stamped line read "Needs
-- re-initialing" for those viewers, while the owner reads the true
-- state and the server rule (private.training_line_initialed, security
-- definer) counts the line resolved regardless of viewer.
--
-- Fix: ONE new SELECT policy, scoped to training_checklist documents,
-- admitting exactly the viewers who may already read the sheet owner's
-- training rows — the training_requirements_select rule of
-- 20261031320000 (hr.view_staff holders; program_manager / nurse by
-- role) plus the profile gate's oversight roles (house_manager via
-- canOverseeTraining) and the auditor read path (auditor + audit.read,
-- the canReadAsAuditor twin). Every profile viewer now derives line
-- state from the SAME event set the owner sees.
--
-- Nothing else changes: other document types keep the original two
-- policies, DSPs still read only their own events (select_own), and
-- writes remain service-role only (no write policies are added).

begin;

drop policy if exists signature_events_select_training_sheet on public.signature_events;
create policy signature_events_select_training_sheet on public.signature_events
for select to authenticated
using (
  document_type = 'training_checklist'
  and (
    (select private.has_permission(agency_id, 'hr.view_staff'))
    or (select private.role_key_in(agency_id, '{program_manager,nurse,house_manager}'))
    or (
      (select private.role_key_in(agency_id, '{auditor}'))
      and (select private.has_permission(agency_id, 'audit.read'))
    )
  )
);

commit;
