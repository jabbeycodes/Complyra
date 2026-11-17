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
-- admitting the viewers who may already read the sheet owner's training
-- rows — the training_requirements_select rule of 20261031320000
-- (hr.view_staff holders; program_manager / nurse by role) plus the
-- profile gate's oversight roles and the auditor read path (auditor +
-- audit.read, the canReadAsAuditor twin). Every profile viewer now
-- derives line state from the SAME event set the owner sees.
--
-- Reviewer HOLD fix-up (PR #273, comment 6941979643): the first cut of
-- this policy admitted every house_manager agency-wide, which leaked
-- training-sheet signature metadata across homes — an HM at Home A
-- could read Home B staffers' events. The house-manager branch below is
-- now scoped PER EVENT to the sheet owner: an HM reads a sheet's events
-- only when the sheet owner is inside the manager's authorized scope,
-- via private.hr_hm_subject_in_scope (the PR #269 / migration
-- 20261112230000 primitive: the owner's membership home + active
-- assignments intersected with the manager's own homes; a house-manager
-- membership with NO home site stays program-level, the established
-- convention of hr_team_visible / time_off_team_visible). This file is
-- amended in place — migration 20261117090000 has never been applied to
-- production (it applies at merge time), so the version is unchanged.
--
-- Nothing else changes: program managers and administrators stay
-- agency-wide, the nurse stays agency-wide clinical, auditors keep the
-- audit.read path, other document types keep the original two policies,
-- DSPs still read only their own events (select_own), and writes remain
-- service-role only (no write policies are added).

begin;

-- The sheet owner of a training_checklist signature event. Current
-- sheets encode the owner in the document id (staff:<userId>:<siteId>,
-- trainingChecklistDocId in src/features/signatures/documentPayloads.ts);
-- legacy sheets use checklist:<checklistId> and resolve through the
-- legacy training_checklists row. Anything else yields null, which the
-- scoped house-manager branch treats as out of scope.
create or replace function private.training_sheet_owner_id(p_document_id text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_document_id ~ '^staff:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:'
      then split_part(p_document_id, ':', 2)::uuid
    when p_document_id ~ '^checklist:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (
        select tc.staff_user_id
        from public.training_checklists tc
        where tc.id = split_part(p_document_id, ':', 2)::uuid
      )
    else null
  end;
$$;

revoke all on function private.training_sheet_owner_id(text) from public;
grant execute on function private.training_sheet_owner_id(text) to authenticated;

drop policy if exists signature_events_select_training_sheet on public.signature_events;
create policy signature_events_select_training_sheet on public.signature_events
for select to authenticated
using (
  document_type = 'training_checklist'
  and (
    -- Agency-wide readers, exactly as the first cut admitted them:
    -- program managers and nurses by role.
    (select private.role_key_in(agency_id, '{program_manager,nurse}'))
    or (
      -- hr.view_staff holders (administrator / HR templates) stay
      -- agency-wide — EXCEPT house managers, whose admission is the
      -- per-event scoped branch below, never this one.
      (select private.has_permission(agency_id, 'hr.view_staff'))
      and not (select private.role_key_in(agency_id, '{house_manager}'))
    )
    or (
      -- House managers: only events on sheets whose owner is inside
      -- the manager's authorized scope (own homes, both sides resolved
      -- as membership home + active staff_assignments).
      (select private.role_key_in(agency_id, '{house_manager}'))
      and (select private.hr_hm_subject_in_scope(
        agency_id, (select private.training_sheet_owner_id(document_id))))
    )
    or (
      (select private.role_key_in(agency_id, '{auditor}'))
      and (select private.has_permission(agency_id, 'audit.read'))
    )
  )
);

commit;
