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
-- site-scoped roles and auditors stay inside the individuals they may read.
--
-- PR #117 re-review hardening (the PR-review agent's blockers): writes are
-- NOT role-broad `for all` policies. Every table has operation-specific
-- policies, and BEFORE triggers enforce the record-level rules RLS cannot
-- express:
--   * GER inserts start as the caller's own draft; review and resolution
--     columns can only move through their lifecycle transitions, by the
--     roles that hold ger.review / ger.resolve; an approved report's event
--     body, review record, and signatures are immutable (follow-up columns
--     may still move so an approved report can be resolved).
--   * A GER's site is the home its Individual lives at: the site/individual
--     integrity trigger rejects any insert or update whose site_id does
--     not match the Individual's home, and any linked Individual who does
--     not live at that same home — alerts and review queues can therefore
--     never route to the wrong home's managers.
--   * Behavior and health entries are editable/deletable only by their
--     author or a manager/nurse role for that site; behavior plans only
--     by the roles that hold behavior.plan.
-- Table-level grants still list every operation the policies gate: without
-- a grant, PostgREST fails with "permission denied" before RLS evaluates
-- (see PR #103's hardening). All enforcement lives in the policies and
-- triggers below.

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

-- INSERT: only the caller's own fresh draft. Review and resolution state
-- starts untouched, so no direct write can forge a reviewer, pre-approve a
-- report, or open a report already resolved.
create policy ger_reports_insert on public.ger_reports
for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and status = 'draft'
  and reviewed_by_user_id is null
  and reviewed_at is null
  and resolved_by_user_id is null
  and resolved_at is null
  and (select private.has_permission(agency_id, 'ger.create'))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'))
);

-- UPDATE: the author works their own draft/returned report; reviewers and
-- resolvers (ger.review / ger.resolve holders) may update for the review
-- and follow-up steps. WHICH columns and transitions each path may use is
-- enforced by the workflow trigger below — RLS is row-wide.
create policy ger_reports_update on public.ger_reports
for update to authenticated
using (
  (
    created_by_user_id = (select auth.uid())
    and status in ('draft', 'returned')
    and (select private.has_permission(agency_id, 'ger.create'))
  )
  or (select private.has_permission(agency_id, 'ger.review'))
  or (select private.has_permission(agency_id, 'ger.resolve'))
)
with check (
  -- Evaluated on the NEW row: a submit moves the row out of draft/returned,
  -- so the status condition lives only in USING (old row). Allowed target
  -- states and transitions are the workflow trigger's job.
  (
    created_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'ger.create'))
  )
  or (select private.has_permission(agency_id, 'ger.review'))
  or (select private.has_permission(agency_id, 'ger.resolve'))
);

-- DELETE: only the author, and only while the report is still a draft —
-- the same rule the API applies.
create policy ger_reports_delete on public.ger_reports
for delete to authenticated
using (
  created_by_user_id = (select auth.uid())
  and status = 'draft'
  and (select private.has_permission(agency_id, 'ger.create'))
);

create policy ger_reports_audit_membership on public.ger_reports
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- Nurses are agency-wide clinical reviewers (they cover every home), so the
-- individual-scope restriction must let them read and review event reports for
-- individuals outside their assigned site, matching the hosted GER API's nurse
-- widening for listing (SELECT) and review/resolve (UPDATE). INSERT and DELETE
-- stay strictly site-scoped so a nurse cannot author or destroy reports —
-- including approved, locked records — for homes they are not assigned to.
create policy ger_reports_audit_individual_scope_read on public.ger_reports
as restrictive for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy ger_reports_audit_individual_scope_update on public.ger_reports
as restrictive for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy ger_reports_audit_individual_scope_insert on public.ger_reports
as restrictive for insert to authenticated
with check ((select private.can_read_individual(agency_id, individual_id)));

create policy ger_reports_audit_individual_scope_delete on public.ger_reports
as restrictive for delete to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

-- RLS UPDATE is row-wide, so the nurse widening above would otherwise let an
-- out-of-scope nurse rewrite any column — description, individual_id,
-- signatures, even on approved/locked rows — not just review/resolve. Scope
-- the widening to the review/resolution lifecycle: a caller who cannot read
-- the individual (only reachable through the nurse widening) may change the
-- review and follow-up columns but must leave the event body, signatures, and
-- the individual the report belongs to untouched.
create or replace function private.ger_reports_scope_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select private.can_read_individual(old.agency_id, old.individual_id))
     and (
       old.id, old.agency_id, old.site_id, old.individual_id,
       old.linked_individual_ids, old.event_date, old.event_time, old.location,
       old.event_type, old.severity, old.description, old.immediate_actions,
       old.notifications_made, old.witnesses, old.reporter_name,
       old.reporter_signature, old.reporter_date, old.created_by_user_id,
       old.created_at
     ) is distinct from (
       new.id, new.agency_id, new.site_id, new.individual_id,
       new.linked_individual_ids, new.event_date, new.event_time, new.location,
       new.event_type, new.severity, new.description, new.immediate_actions,
       new.notifications_made, new.witnesses, new.reporter_name,
       new.reporter_signature, new.reporter_date, new.created_by_user_id,
       new.created_at
     ) then
    raise exception
      'A nurse may review or resolve, but not edit, event reports for individuals outside their assigned site.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger ger_reports_scope_update before update on public.ger_reports
for each row execute function private.ger_reports_scope_update();

-- Site/individual integrity: a report belongs to the home its Individual
-- lives at, and every linked Individual must live at that same home. This
-- fires for every writer (including service_role), so chart, dashboard,
-- alerts, and review queues can never disagree about which home a report
-- belongs to.
create or replace function private.ger_reports_site_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home_site uuid;
  v_linked uuid;
  v_linked_site uuid;
begin
  select i.site_id into v_home_site
  from public.individuals i
  where i.id = new.individual_id and i.agency_id = new.agency_id;
  if v_home_site is null then
    raise exception 'The Individual on this event report is not in this agency.'
      using errcode = 'foreign_key_violation';
  end if;
  if new.site_id is distinct from v_home_site then
    raise exception
      'An event report must be filed under the home its Individual lives at.'
      using errcode = 'check_violation';
  end if;
  foreach v_linked in array coalesce(new.linked_individual_ids, '{}') loop
    select i.site_id into v_linked_site
    from public.individuals i
    where i.id = v_linked and i.agency_id = new.agency_id;
    if v_linked_site is null or v_linked_site is distinct from new.site_id then
      raise exception
        'A linked Individual must live at the same home as this event report.'
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

create trigger ger_reports_site_integrity
before insert or update on public.ger_reports
for each row execute function private.ger_reports_site_integrity();

-- Workflow discipline at the database layer. RLS decides WHO may attempt an
-- update; this trigger decides WHAT the update may do:
--   * ownership (agency, author, creation time) never changes;
--   * draft/returned -> submitted is the author (ger.create) or a reviewer;
--     the event body may be finished in the same write, but review and
--     resolution columns stay untouched;
--   * submitted -> approved/returned is a ger.review decision, recorded
--     against the signed-in reviewer, with body and resolution untouched;
--   * with no status change: drafts/returned reports take body edits from
--     the author or a reviewer; submitted and approved reports take ONLY
--     follow-up (resolution) changes, and only from ger.resolve holders —
--     so an approved report's body and review record are immutable while
--     its follow-up can still be worked to resolution.
create or replace function private.ger_reports_workflow_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_author boolean := old.created_by_user_id = auth.uid();
  v_can_create boolean := private.has_permission(old.agency_id, 'ger.create');
  v_can_review boolean := private.has_permission(old.agency_id, 'ger.review');
  v_can_resolve boolean := private.has_permission(old.agency_id, 'ger.resolve');
  v_body_changed boolean;
  v_review_changed boolean;
  v_resolution_changed boolean;
begin
  if new.agency_id is distinct from old.agency_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Event report ownership cannot be changed.'
      using errcode = 'check_violation';
  end if;

  v_body_changed := (
    old.site_id, old.individual_id, old.linked_individual_ids, old.event_date,
    old.event_time, old.location, old.event_type, old.severity,
    old.description, old.immediate_actions, old.notifications_made,
    old.witnesses, old.reporter_name, old.reporter_signature, old.reporter_date
  ) is distinct from (
    new.site_id, new.individual_id, new.linked_individual_ids, new.event_date,
    new.event_time, new.location, new.event_type, new.severity,
    new.description, new.immediate_actions, new.notifications_made,
    new.witnesses, new.reporter_name, new.reporter_signature, new.reporter_date
  );
  v_review_changed := (
    old.review_note, old.reviewed_by_user_id, old.reviewed_at
  ) is distinct from (
    new.review_note, new.reviewed_by_user_id, new.reviewed_at
  );
  v_resolution_changed := (
    old.resolution_status, old.investigation_required, old.investigation_notes,
    old.assigned_manager_user_id, old.resolution_due_on, old.closure_note,
    old.resolved_by_user_id, old.resolved_at
  ) is distinct from (
    new.resolution_status, new.investigation_required, new.investigation_notes,
    new.assigned_manager_user_id, new.resolution_due_on, new.closure_note,
    new.resolved_by_user_id, new.resolved_at
  );

  if new.status is distinct from old.status then
    if old.status in ('draft', 'returned') and new.status = 'submitted' then
      if not ((v_is_author and v_can_create) or v_can_review) then
        raise exception 'Only the author or a reviewer can submit this event report.'
          using errcode = 'check_violation';
      end if;
      if v_review_changed or v_resolution_changed then
        raise exception 'Review and follow-up fields cannot change when a report is submitted.'
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'submitted' and new.status in ('approved', 'returned') then
      if not v_can_review then
        raise exception 'Only a reviewer can approve or return an event report.'
          using errcode = 'check_violation';
      end if;
      if v_body_changed or v_resolution_changed then
        raise exception 'A review decision cannot change the event report or its follow-up.'
          using errcode = 'check_violation';
      end if;
      if new.reviewed_by_user_id is distinct from auth.uid() then
        raise exception 'The reviewer must be the signed-in user.'
          using errcode = 'check_violation';
      end if;
    else
      raise exception 'Invalid event report workflow transition.'
        using errcode = 'check_violation';
    end if;
  else
    if v_review_changed then
      raise exception 'Review fields may only change through a review decision.'
        using errcode = 'check_violation';
    end if;
    if old.status in ('draft', 'returned') then
      if v_resolution_changed then
        raise exception 'Follow-up starts once a report is submitted.'
          using errcode = 'check_violation';
      end if;
      if v_body_changed and not ((v_is_author and v_can_create) or v_can_review) then
        raise exception 'Only the author or a reviewer can edit this event report.'
          using errcode = 'check_violation';
      end if;
    else
      -- submitted or approved: the event body is locked; only the follow-up
      -- may move, and only by a ger.resolve holder.
      if v_body_changed then
        raise exception 'A submitted event report can no longer be edited.'
          using errcode = 'check_violation';
      end if;
      if v_resolution_changed and not v_can_resolve then
        raise exception 'Only a manager or nurse can work this follow-up.'
          using errcode = 'check_violation';
      end if;
      if new.resolution_status = 'resolved'
         and old.resolution_status is distinct from 'resolved'
         and new.resolved_by_user_id is distinct from auth.uid() then
        raise exception 'The resolver must be the signed-in user.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger ger_reports_workflow_guard before update on public.ger_reports
for each row execute function private.ger_reports_workflow_guard();

grant select on public.ger_reports to authenticated;
grant insert on public.ger_reports to authenticated;
grant update on public.ger_reports to authenticated;
grant delete on public.ger_reports to authenticated;
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

-- Plans are manager/nurse-owned (behavior.plan): DSPs and auditors cannot
-- write them at any operation.
create policy behavior_plans_insert on public.behavior_plans
for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and (select private.has_permission(agency_id, 'behavior.plan'))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
);

create policy behavior_plans_update on public.behavior_plans
for update to authenticated
using ((select private.has_permission(agency_id, 'behavior.plan')))
with check ((select private.has_permission(agency_id, 'behavior.plan')));

create policy behavior_plans_delete on public.behavior_plans
for delete to authenticated
using ((select private.has_permission(agency_id, 'behavior.plan')));

create policy behavior_plans_audit_membership on public.behavior_plans
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- Nurse scope mirrors ger_reports: agency-wide READ and UPDATE (clinical
-- oversight — the API lets nurses manage plans), while INSERT and DELETE
-- stay limited to Individuals the nurse can read at their own sites.
create policy behavior_plans_audit_individual_scope_read on public.behavior_plans
as restrictive for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy behavior_plans_audit_individual_scope_update on public.behavior_plans
as restrictive for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy behavior_plans_audit_individual_scope_insert on public.behavior_plans
as restrictive for insert to authenticated
with check ((select private.can_read_individual(agency_id, individual_id)));

create policy behavior_plans_audit_individual_scope_delete on public.behavior_plans
as restrictive for delete to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

grant select on public.behavior_plans to authenticated;
grant insert on public.behavior_plans to authenticated;
grant update on public.behavior_plans to authenticated;
grant delete on public.behavior_plans to authenticated;
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

-- Entries belong to their author: anyone with behavior.record may add their
-- own entry; only the author — or a manager/nurse role for the site — may
-- change or remove one.
create policy behavior_entries_insert on public.behavior_entries
for insert to authenticated
with check (
  recorded_by_user_id = (select auth.uid())
  and (select private.has_permission(agency_id, 'behavior.record'))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'))
);

create policy behavior_entries_update on public.behavior_entries
for update to authenticated
using (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'behavior.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
)
with check (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'behavior.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
);

create policy behavior_entries_delete on public.behavior_entries
for delete to authenticated
using (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'behavior.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
);

create policy behavior_entries_audit_membership on public.behavior_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- Nurse scope mirrors ger_reports: agency-wide READ (the API has no nurse
-- behavior review; read is the oversight surface), INSERT/UPDATE/DELETE stay
-- limited to Individuals the nurse can read at their own sites — except the
-- author/manager UPDATE and DELETE paths above, which the restrictive
-- INSERT/DELETE-style scope would otherwise block cross-site for entries a
-- nurse recorded while covering another home. UPDATE therefore also carries
-- the nurse widening, exactly as on ger_reports.
create policy behavior_entries_audit_individual_scope_read on public.behavior_entries
as restrictive for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy behavior_entries_audit_individual_scope_update on public.behavior_entries
as restrictive for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy behavior_entries_audit_individual_scope_insert on public.behavior_entries
as restrictive for insert to authenticated
with check ((select private.can_read_individual(agency_id, individual_id)));

create policy behavior_entries_audit_individual_scope_delete on public.behavior_entries
as restrictive for delete to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

grant select on public.behavior_entries to authenticated;
grant insert on public.behavior_entries to authenticated;
grant update on public.behavior_entries to authenticated;
grant delete on public.behavior_entries to authenticated;
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

-- Same author rule as behavior entries, with health.record: the author may
-- change or remove their own entry; a manager/nurse role for the site may
-- change or remove any entry at the site.
create policy health_track_entries_insert on public.health_track_entries
for insert to authenticated
with check (
  recorded_by_user_id = (select auth.uid())
  and (select private.has_permission(agency_id, 'health.record'))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse,dsp}'))
);

create policy health_track_entries_update on public.health_track_entries
for update to authenticated
using (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'health.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
)
with check (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'health.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
);

create policy health_track_entries_delete on public.health_track_entries
for delete to authenticated
using (
  (
    recorded_by_user_id = (select auth.uid())
    and (select private.has_permission(agency_id, 'health.record'))
  )
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,program_manager,nurse}'))
);

create policy health_track_entries_audit_membership on public.health_track_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- Nurse scope mirrors ger_reports: agency-wide READ and UPDATE (clinical
-- oversight of flagged results), INSERT and DELETE site-scoped.
create policy health_track_entries_audit_individual_scope_read on public.health_track_entries
as restrictive for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy health_track_entries_audit_individual_scope_update on public.health_track_entries
as restrictive for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  or (select private.role_key_in(agency_id, '{nurse}'))
);

create policy health_track_entries_audit_individual_scope_insert on public.health_track_entries
as restrictive for insert to authenticated
with check ((select private.can_read_individual(agency_id, individual_id)));

create policy health_track_entries_audit_individual_scope_delete on public.health_track_entries
as restrictive for delete to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

grant select on public.health_track_entries to authenticated;
grant insert on public.health_track_entries to authenticated;
grant update on public.health_track_entries to authenticated;
grant delete on public.health_track_entries to authenticated;
grant all on public.health_track_entries to service_role;

-- Ownership immutability for the entry tables: a behavior or health entry
-- can be edited in place, but it can never be moved to another Individual,
-- another agency, or another author after the fact.
create or replace function private.guard_entry_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_id is distinct from old.agency_id
     or new.individual_id is distinct from old.individual_id
     or new.recorded_by_user_id is distinct from old.recorded_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'An entry cannot be moved to another Individual, agency, or author.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger behavior_entries_ownership_guard before update on public.behavior_entries
for each row execute function private.guard_entry_ownership();

create trigger health_track_entries_ownership_guard before update on public.health_track_entries
for each row execute function private.guard_entry_ownership();

create or replace function private.guard_behavior_plan_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agency_id is distinct from old.agency_id
     or new.individual_id is distinct from old.individual_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A behavior plan cannot be moved to another Individual, agency, or author.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger behavior_plans_ownership_guard before update on public.behavior_plans
for each row execute function private.guard_behavior_plan_ownership();
