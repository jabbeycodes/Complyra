-- LIFEPATH-P3 (delegation forms): extended RN delegation form fields.
--
-- The full "LifePath RN Delegation of Specified Nursing Task Form" (purpose,
-- procedures, observe/report instructions, instructing professional,
-- delegating RN, rescind state, non-transferability acknowledgment,
-- inspection interval/cadence, review date, and the 12-row employee roster)
-- lives as one jsonb object on the delegation obligation, mirroring how
-- training checklist lines stay a jsonb array in training_checklists.

alter table public.obligations
  add column if not exists delegation_form jsonb not null default '{}'::jsonb;
