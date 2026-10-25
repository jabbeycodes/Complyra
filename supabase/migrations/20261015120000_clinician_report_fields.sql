-- Clinician-report fields. Begin and end let two notes overlap on the same
-- day. Goal, criteria, and the schedule comment print in the report header.
-- Not applied to a remote project from this change.

alter table public.shift_notes
  add column if not exists begin_time text not null default '',
  add column if not exists end_time text not null default '',
  add column if not exists location text not null default '',
  add column if not exists staff_title text not null default '';

alter table public.isp_programs
  add column if not exists goal_service text not null default '',
  add column if not exists completion_criteria text not null default '',
  add column if not exists schedule_comment text not null default '';
