-- 2026-09-18: issue #96 follow-up — support-coordinator summary fields.
--
-- Extends public.shift_note_monthly_reports (created by
-- 20260918002500_issue96_shift_note_monthly_reports.sql, still unapplied)
-- with the "Monthly summary for support coordinator" section:
--   sc_objective_narratives — per-objective narratives, JSONB array of
--     { taskId, narrative } (taskId references the ISP program task)
--   sc_overall_narrative   — overall status narrative for the month
--   sc_signatures          — signature lines, JSONB object:
--     { supportCoordinator: {name, date}, provider: {name, date},
--       professionalManager: {name, date} }
--
-- The section rides the same row and the same sign-and-lock lifecycle as the
-- manager's narrative: editable while unsigned, locked once signed, re-opened
-- by a PM/administrator. Existing RLS policies cover the new columns (same
-- table, same PM/administrator write backstop).
begin;

alter table public.shift_note_monthly_reports
  add column sc_objective_narratives jsonb not null default '[]',
  add column sc_overall_narrative text not null default '',
  add column sc_signatures jsonb not null default '{}';

comment on column public.shift_note_monthly_reports.sc_objective_narratives is
  'Issue #96: per-objective narratives for the support coordinator monthly summary.';
comment on column public.shift_note_monthly_reports.sc_overall_narrative is
  'Issue #96: overall status narrative for the support coordinator monthly summary.';
comment on column public.shift_note_monthly_reports.sc_signatures is
  'Issue #96: signature lines (support coordinator, provider, professional manager) for the support coordinator monthly summary.';

commit;
