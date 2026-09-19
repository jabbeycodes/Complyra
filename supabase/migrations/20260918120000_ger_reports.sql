-- Complyrer migration: General Event Reports (GER) for program sites.
--
--   ger_reports — one row per reported event. Workflow:
--   draft → submitted → approved | returned → submitted (resubmit after
--   corrections). Approved reports are final — the app locks their body.
--
-- This migration is applied with the GER reporting feature.  The following
-- hardening migration narrows the direct write policies to site-scoped
-- permission holders, adds a tamper-resistant workflow trigger, and
-- provides security-definer workflow RPCs before release.

create table public.ger_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  individual_id uuid references public.individuals (id) on delete cascade,
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

-- ----------------------------------------------------------------------------
-- Permission seeding (merge-only: never overwrite explicit agency choices)
-- ----------------------------------------------------------------------------
--
-- ger.create / ger.review are new capability keys. Deployed databases already
-- ran the earlier permission seed, so re-editing that seed does not reach
-- them. Merge the GER defaults into role_templates, role_permission_matrix,
-- and agency_roles here so existing agencies inherit the new keys without
-- clobbering any per-agency customizations.

create temporary table ger_perm_defaults (
  role_key text not null,
  perm_key text not null,
  perm_value boolean not null,
  primary key (role_key, perm_key)
) on commit drop;

insert into ger_perm_defaults (role_key, perm_key, perm_value)
values
  ('administrator', 'ger.create', true),
  ('compliance_admin', 'ger.create', true),
  ('house_manager', 'ger.create', true),
  ('program_manager', 'ger.create', true),
  ('dsp', 'ger.create', true),
  ('nurse', 'ger.create', true),
  ('hr', 'ger.create', false),
  ('auditor', 'ger.create', false),
  ('administrator', 'ger.review', true),
  ('compliance_admin', 'ger.review', true),
  ('house_manager', 'ger.review', true),
  ('program_manager', 'ger.review', true),
  ('dsp', 'ger.review', false),
  ('nurse', 'ger.review', true),
  ('hr', 'ger.review', false),
  ('auditor', 'ger.review', false);

-- Add each key only where it is missing, so per-agency customizations are
-- never overwritten. New agencies inherit these defaults through
-- public.provision_agency_roles (copied from role_templates).
update public.role_templates rt
set permissions = rt.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from ger_perm_defaults d
  where d.role_key = rt.key
    and not (rt.permissions ? d.perm_key)
);

update public.role_permission_matrix rpm
set permissions = rpm.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from ger_perm_defaults d
  where d.role_key = rpm.role_key
    and not (rpm.permissions ? d.perm_key)
),
updated_at = now();

update public.agency_roles ar
set permissions = ar.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from ger_perm_defaults d
  where d.role_key = ar.template_key
    and not (ar.permissions ? d.perm_key)
);

drop table ger_perm_defaults;
