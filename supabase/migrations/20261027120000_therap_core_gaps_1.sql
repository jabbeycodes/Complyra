-- THERAP-CORE-GAPS-1: event reports (GER) with follow-up/resolution
-- lifecycle, behavior support plans + behavior data log, and health
-- trackers (immunizations, lab results, infection tracking, sleep).
--
-- New permission keys (ger.create / ger.review / ger.resolve /
-- behavior.record / behavior.plan / health.record) are seeded through the
-- regenerated 20260915024000_integrated_permissions.sql, which runs before
-- this migration and merges canonical defaults into role templates and
-- agency roles.
--
-- RLS follows the appointments pattern (20260915160000): agency membership
-- as the base gate, private.can_read_individual as a restrictive scope so
-- site-scoped roles and auditors stay inside the individuals they may read,
-- and role-gated writes. Record-level rules (own drafts, own entries) are
-- enforced in the API layer, mirroring corrective actions.

-- ───────────────────────────── Event reports ─────────────────────────────

create table public.ger_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  individual_id uuid not null,
  linked_individual_ids uuid[] not null default '{}',
  event_date date not null,
  event_time text not null default '',
  location text not null default '',
  event_type text not null,
  severity text not null,
  description text not null default '',
  immediate_actions text not null default '',
  notifications_made jsonb not null default '[]'::jsonb,
  witnesses text not null default '',
  reporter_name text not null default '',
  reporter_signature text not null default '',
  reporter_date date,
  status text not null default 'draft',
  review_note text not null default '',
  reviewed_by_user_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  resolution_status text not null default 'unaddressed',
  investigation_required boolean not null default false,
  investigation_notes text not null default '',
  assigned_manager_user_id uuid references public.profiles (id) on delete set null,
  resolution_due_on date,
  closure_note text not null default '',
  resolved_by_user_id uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint ger_reports_status_check
    check (status in ('draft', 'submitted', 'approved', 'returned')),
  constraint ger_reports_severity_check
    check (severity in ('Low', 'Moderate', 'High', 'Critical')),
  constraint ger_reports_resolution_check
    check (resolution_status in ('unaddressed', 'in_progress', 'resolved')),
  constraint ger_reports_event_type_check
    check (event_type in (
      'Fall', 'Injury', 'Illness', 'ER/Hospital visit', 'Behavior incident',
      'Medication issue', 'Elopement/Wandering', 'Property damage', 'Other'
    ))
);

create index ger_reports_site_idx
  on public.ger_reports (agency_id, site_id, event_date desc);
create index ger_reports_individual_idx
  on public.ger_reports (agency_id, individual_id, event_date desc);

create trigger ger_reports_updated_at before update on public.ger_reports
for each row execute function private.set_updated_at();

alter table public.ger_reports enable row level security;
alter table public.ger_reports force row level security;

create policy ger_reports_select on public.ger_reports
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy ger_reports_write on public.ger_reports
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')));

create policy ger_reports_audit_membership on public.ger_reports
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy ger_reports_audit_individual_scope on public.ger_reports
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

grant select, insert, update, delete on public.ger_reports to authenticated;
grant all on public.ger_reports to service_role;

-- ───────────────────────────── Behavior plans ─────────────────────────────

create table public.behavior_plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  target_behaviors text not null default '',
  interventions text not null default '',
  crisis_steps text not null default '',
  active boolean not null default true,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index behavior_plans_individual_idx
  on public.behavior_plans (agency_id, individual_id, active);

create trigger behavior_plans_updated_at before update on public.behavior_plans
for each row execute function private.set_updated_at();

alter table public.behavior_plans enable row level security;
alter table public.behavior_plans force row level security;

create policy behavior_plans_select on public.behavior_plans
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy behavior_plans_write on public.behavior_plans
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse}')));

create policy behavior_plans_audit_membership on public.behavior_plans
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy behavior_plans_audit_individual_scope on public.behavior_plans
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

grant select, insert, update, delete on public.behavior_plans to authenticated;
grant all on public.behavior_plans to service_role;

-- ───────────────────────────── Behavior data log ─────────────────────────────

create table public.behavior_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  occurred_on date not null,
  occurred_at_time text not null default '',
  behavior text not null default '',
  antecedent text not null default '',
  duration_minutes integer,
  intensity text not null default 'Moderate',
  intervention_used text not null default '',
  outcome text not null default '',
  recorded_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint behavior_entries_intensity_check
    check (intensity in ('Low', 'Moderate', 'High')),
  constraint behavior_entries_duration_check
    check (duration_minutes is null or duration_minutes >= 0)
);

create index behavior_entries_individual_idx
  on public.behavior_entries (agency_id, individual_id, occurred_on desc);

alter table public.behavior_entries enable row level security;
alter table public.behavior_entries force row level security;

create policy behavior_entries_select on public.behavior_entries
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy behavior_entries_write on public.behavior_entries
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')));

create policy behavior_entries_audit_membership on public.behavior_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy behavior_entries_audit_individual_scope on public.behavior_entries
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

grant select, insert, update, delete on public.behavior_entries to authenticated;
grant all on public.behavior_entries to service_role;

-- ───────────────────────────── Health trackers ─────────────────────────────

create table public.health_track_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  kind text not null,
  occurred_on date not null,
  title text not null default '',
  details jsonb not null default '{}'::jsonb,
  flagged_abnormal boolean not null default false,
  note text not null default '',
  recorded_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  constraint health_track_entries_kind_check
    check (kind in ('immunization', 'lab', 'infection', 'sleep'))
);

create index health_track_entries_individual_idx
  on public.health_track_entries (agency_id, individual_id, kind, occurred_on desc);

alter table public.health_track_entries enable row level security;
alter table public.health_track_entries force row level security;

create policy health_track_entries_select on public.health_track_entries
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy health_track_entries_write on public.health_track_entries
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,program_manager,nurse,dsp}')));

create policy health_track_entries_audit_membership on public.health_track_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy health_track_entries_audit_individual_scope on public.health_track_entries
as restrictive for all to authenticated
using ((select private.can_read_individual(agency_id, individual_id)))
with check ((select private.can_read_individual(agency_id, individual_id)));

grant select, insert, update, delete on public.health_track_entries to authenticated;
grant all on public.health_track_entries to service_role;
