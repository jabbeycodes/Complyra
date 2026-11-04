-- QA Review creation gate (simulation wave 4A follow-up, 2026-10-31).
--
-- Starting a QA review is a program-management act, but every layer gated
-- it on qa.audit — the scoring permission held by the read-only auditor
-- role (and administrators). The Program Manager, who owns the QA
-- schedules (qa.schedule: "Schedule QA audits for program sites"), could
-- not start a review at all, while the one role that must never change
-- records was the only non-admin role that could. Both API clients now
-- require qa.schedule for createQaAudit; this migration makes the RLS
-- write policies the same rule so the database backstop agrees:
--
--   * INSERT on qa_audits requires qa.schedule (was: qa.audit).
--   * INSERT on qa_audit_items — the rows a creation writes — accepts
--     qa.schedule alongside the existing qa.audit / qa.dispute holders.
--   * UPDATE / DELETE keep the existing checks exactly (qa.audits:
--     qa.audit; qa_audit_items: qa.audit or qa.dispute), so scoring,
--     finalizing, and dispute writes are unchanged. The guard triggers
--     (qa_audits_guard / qa_audit_items_guard, UPDATE/DELETE only) are
--     untouched, and the restrictive read policies are untouched.
--
-- The auditor keeps qa.audit and can still score and finalize reviews
-- that management starts; they simply cannot start one.

drop policy if exists qa_audits_write on public.qa_audits;

create policy qa_audits_insert on public.qa_audits
for insert to authenticated
with check ((select private.has_permission(agency_id, 'qa.schedule')));

create policy qa_audits_update on public.qa_audits
for update to authenticated
using ((select private.has_permission(agency_id, 'qa.audit')))
with check ((select private.has_permission(agency_id, 'qa.audit')));

create policy qa_audits_delete on public.qa_audits
for delete to authenticated
using ((select private.has_permission(agency_id, 'qa.audit')));

drop policy if exists qa_audit_items_write on public.qa_audit_items;

create policy qa_audit_items_insert on public.qa_audit_items
for insert to authenticated
with check (
  (select private.has_permission(agency_id, 'qa.schedule'))
  or (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
);

create policy qa_audit_items_update on public.qa_audit_items
for update to authenticated
using (
  (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
)
with check (
  (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
);

create policy qa_audit_items_delete on public.qa_audit_items
for delete to authenticated
using (
  (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
);
