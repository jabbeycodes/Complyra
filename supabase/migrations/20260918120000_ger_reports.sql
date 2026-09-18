-- Complyrer migration: General Event Reports (GER) for program sites.
--
--   ger_reports — one row per reported event. Workflow:
--   draft → submitted → approved | returned → submitted (resubmit after
--   corrections). Approved reports are final — the app locks their body.
--
-- This migration is included in the repository but intentionally NOT applied
-- yet (part of the GER reporting PR; applied when the feature ships).

create table public.ger_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  event_date date not null,
  event_time text not null default '',
  location text not null default '',
  event_type text not null,
  severity text not null default 'low',
  description text not null default '',
  actions_taken text not null default '',
  notifications_made jsonb not null default '[]'::jsonb,
  witnesses text not null default '',
  reported_by_name text not null default '',
  signature_name text not null default '',
  signed_at timestamptz,
  status text not null default 'draft',
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewer_name text not null default '',
  reviewed_at timestamptz,
  review_note text not null default '',
  created_by_user_id uuid not null references public.profiles (id) on delete cascade,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  check (status in ('draft', 'submitted', 'approved', 'returned')),
  check (severity in ('low', 'moderate', 'high', 'critical'))
);

create index ger_reports_site_date_idx
  on public.ger_reports (agency_id, site_id, event_date desc);
create index ger_reports_individual_idx
  on public.ger_reports (agency_id, individual_id, event_date desc);
create index ger_reports_status_idx
  on public.ger_reports (agency_id, site_id, status);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.ger_reports enable row level security;
alter table public.ger_reports force row level security;

-- Read: any agency member.
create policy ger_reports_select on public.ger_reports
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Write (coarse backstop): any agency member may insert; the app enforces
-- the ger.create gate. Updates: the author, or a review-capable role
-- (the app enforces the draft/returned/submitted edit rules and locks
-- approved reports). Deletes: administrators, PMs, and compliance admins.
create policy ger_reports_insert on public.ger_reports
for insert to authenticated
with check ((select private.has_agency(agency_id)));

create policy ger_reports_update on public.ger_reports
for update to authenticated
using (
  created_by_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin,nurse}'))
)
with check (
  created_by_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,program_manager,house_manager,compliance_admin,nurse}'))
);

create policy ger_reports_delete on public.ger_reports
for delete to authenticated
using ((select private.role_key_in(agency_id, '{administrator,program_manager,compliance_admin}')));
