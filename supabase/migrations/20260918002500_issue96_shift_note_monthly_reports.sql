-- 2026-09-18: issue #96 — Monthly shift notes report: manager summary.
--
-- New table:
--   shift_note_monthly_reports — one row per Individual per calendar month
--     (month stored as "YYYY-MM"): the manager's narrative summary, plus the
--     signature lock (signed_by / signed_by_name / signed_by_title /
--     signed_at). A signed report is locked in the app; a PM/administrator
--     may re-open it (signature fields cleared). Soft-delete column kept for
--     parity with shift_notes.
--
-- The day grid, signature log, and header of the report are derived from
-- shift_notes / isp_programs at render time — no snapshot tables needed.
--
-- RLS is enabled + forced. Reads are agency-member wide. Writes are a coarse
-- row-level backstop; field-level authorization lives in the app layer
-- (src/data/localApi.ts, src/data/hostedApi.ts), gated by
-- canConfigureIspTasks (program_manager / administrator) for summary
-- write / sign / re-open.
begin;

create table public.shift_note_monthly_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  program_id uuid references public.isp_programs (id) on delete set null,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  narrative text not null default '',
  signed_by uuid references public.profiles (id) on delete set null,
  signed_by_name text not null default '',
  signed_by_title text not null default '',
  signed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (agency_id, individual_id, month)
);

create index shift_note_monthly_reports_lookup_idx
  on public.shift_note_monthly_reports (agency_id, individual_id, month)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.shift_note_monthly_reports enable row level security;
alter table public.shift_note_monthly_reports force row level security;

-- Read: any agency member.
create policy shift_note_monthly_reports_select on public.shift_note_monthly_reports
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write (coarse backstop): PM / administrator only, matching canConfigureIspTasks.
create policy shift_note_monthly_reports_write on public.shift_note_monthly_reports
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,program_manager}')));

commit;
