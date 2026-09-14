-- Complyrer LifePath Phase 1, Workstream 2: Sunday HM-checklist scheduler +
-- real late flags.
--
-- Adds scheduler-owned columns to public.hm_weekly_checklists:
--   week_start      date        — the Monday that opens the scheduler week
--                                 (legacy rows carry week_of = the Sunday that
--                                 opens the week, so week_start = week_of + 1).
--   due_at          timestamptz — when the week's checklist is due:
--                                 Sunday 23:59 UTC (week_start + 6 days).
--   late            boolean     — set once the row is past due_at and still
--                                 unsubmitted. This is the DB-driven "real"
--                                 late flag; the client also derives lateness
--                                 from due_at for display.
--   late_flagged_at timestamptz — when the late flag was set.
--
-- Idempotency: UNIQUE (site_id, week_start) named
-- hm_weekly_checklists_site_week_uniq, so the Sunday scheduler (edge function
-- supabase/functions/schedule-hm-checklists) can INSERT ... ON CONFLICT DO
-- NOTHING and never create duplicates, even when run twice.
--
-- TIMEZONE NOTE (kept simple, documented): due_at is stored as an absolute
-- UTC instant — Sunday 23:59 UTC of the checklist week. LifePath agencies are
-- US-based (Columbia, MO = America/Chicago), so the local due moment is
-- ~6-7 hours earlier (e.g. 5:59/6:59 PM Sunday). The scheduler and the client
-- both treat due_at as an instant and compare against now(); the client
-- renders the due label in UTC to stay honest about the stored value.
-- Revisit with a per-agency timezone column if the product ever needs
-- local-midnight semantics.

-- 1) Scheduler columns (idempotent).
alter table public.hm_weekly_checklists
  add column if not exists week_start date,
  add column if not exists due_at timestamptz,
  add column if not exists late boolean not null default false,
  add column if not exists late_flagged_at timestamptz;

-- 2) Idempotency constraint for the scheduler upsert (added once).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hm_weekly_checklists_site_week_uniq'
  ) then
    alter table public.hm_weekly_checklists
      add constraint hm_weekly_checklists_site_week_uniq
      unique (site_id, week_start);
  end if;
end $$;

-- 3) Backfill existing rows: week_of is the Sunday opening the week, so the
-- Monday week_start is week_of + 1; due_at is that Sunday 23:59 UTC.
update public.hm_weekly_checklists
set week_start = week_of + 1
where week_start is null
  and week_of is not null;

update public.hm_weekly_checklists
set due_at = ((week_start + 6)::text || ' 23:59:00')::timestamp at time zone 'UTC'
where due_at is null
  and week_start is not null;

-- 4) Help the late-flag sweep find candidates.
create index if not exists hm_weekly_checklists_late_due_idx
  on public.hm_weekly_checklists (late, due_at)
  where submitted_at is null;

-- 5) The late-flag sweep. Sets late=true / late_flagged_at=now() on every row
-- that is past due_at and still unsubmitted, and returns the newly flagged
-- rows so the scheduler edge function can notify the assigned HMs.
-- SECURITY DEFINER + locked search_path: the function is the authority for
-- the flag; direct client writes to `late` remain governed by the existing
-- RLS update policy.
create or replace function public.flag_late_checklists()
returns table (
  checklist_id uuid,
  agency_id uuid,
  assigned_to_user_id uuid,
  site_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.hm_weekly_checklists as c
  set late = true,
      late_flagged_at = now()
  where c.late = false
    and c.submitted_at is null
    and c.due_at is not null
    and c.due_at < now()
  returning c.id, c.agency_id, c.assigned_to_user_id, c.site_id;
end;
$$;

-- The flag is applied by the scheduler (service_role) or this migration's
-- own backfill below — never directly by clients.
revoke all on function public.flag_late_checklists() from public;

-- 6) Backfill late flags for rows that are already past due (best effort,
-- documented). Idempotent: only rows with late=false are touched.
select public.flag_late_checklists();

-- 7) Scheduler wiring. The Sunday 06:00 job that calls the
-- `schedule-hm-checklists` edge function can be pg_cron (where the hosted
-- project allows it) or an external cron. pg_cron needs elevated privileges
-- on self-hosted Postgres and is NOT guaranteed on hosted Supabase, so the
-- extension install below is defensive and NEVER fails the migration.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'schedule-hm-checklists: pg_cron not enabled (%), use an external cron hitting the edge function instead.', sqlerrm;
  end;
end $$;

-- Recommended production wiring (pick ONE):
--
--   A) External cron (RECOMMENDED — Vercel Cron / GitHub Actions / any
--      scheduler), Sundays 06:00 agency-local:
--        POST https://<project-ref>.supabase.co/functions/v1/schedule-hm-checklists
--        Authorization: Bearer <service_role_key>
--      (or an admin member's JWT; the function also accepts that).
--
--   B) pg_cron — only where the extension is actually available (it also
--      needs the pg_net extension for the HTTP call):
/*
select cron.schedule(
  'schedule-hm-checklists-sunday',
  '0 6 * * 0',  -- Sundays 06:00 (database server timezone)
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/schedule-hm-checklists',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <service_role_key>'
    ),
    body := '{}'::jsonb
  );
  $$
);
-- To remove: select cron.unschedule('schedule-hm-checklists-sunday');
*/
