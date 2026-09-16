-- Complyrer HR / Employee Hub: schedules, time tracking, payroll prep,
-- HR documents, time off, and compliance readiness requirements.
--
-- RLS is enabled + forced on every table below. Personal rows (punches,
-- punch corrections, timecard approvals, document acks, time-off requests)
-- are visible to the owner (staff_id = auth.uid()) or to managers through
-- private.hr_team_visible (site-scoped for house managers). Agency-wide
-- tables (shifts, pay periods, documents, readiness requirements) are
-- readable by any agency member. Writes are gated by the hub.* permission
-- pack seeded at the bottom of this migration.

-- ----------------------------------------------------------------------------
-- Helper: manager team visibility (site-scoped for house managers)
-- ----------------------------------------------------------------------------
--
-- Returns true when the caller holds hub.view_team AND is one of:
--   - a privileged membership (administrator / compliance_admin),
--   - a program_manager (sees every site),
--   - a house_manager whose membership is unscoped (site_id null) or matches
--     the row's site.
-- Rows with a null site are treated as program-level: visible to privileged
-- memberships and program managers only.

create or replace function private.hr_team_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= current_date)
        and (
          (select private.is_privileged(p_agency_id))
          or m.role_key = 'program_manager'
          or (
            m.role_key = 'house_manager'
            and p_site_id is not null
            and (m.site_id is null or m.site_id = p_site_id)
          )
        )
    );
$$;

revoke all on function private.hr_team_visible(uuid, uuid) from public;
grant execute on function private.hr_team_visible(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Scheduled / published shifts. staff_id null means an open (unassigned) shift.
create table public.hr_shifts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid,
  staff_id uuid references public.profiles (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'published', 'cancelled')),
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  constraint hr_shifts_time_order check (ends_at > starts_at)
);

-- Clock in/out punches.
create table public.hr_punches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  kind text check (kind in ('in', 'out')),
  punched_at timestamptz not null default now(),
  source text not null default 'web',
  note text,
  shift_id uuid references public.hr_shifts (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade
);

-- Staff-requested corrections to punches (staff never edit punches directly).
create table public.hr_punch_corrections (
  id uuid primary key default gen_random_uuid(),
  punch_id uuid not null references public.hr_punches (id) on delete cascade,
  staff_id uuid not null references public.profiles (id),
  requested_kind text check (requested_kind in ('in', 'out')),
  requested_at timestamptz,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

-- Payroll periods (export-first payroll: CSV import into Paycor/ADP/Gusto).
create table public.hr_pay_periods (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open'
    check (status in ('open', 'locked', 'exported')),
  locked_by uuid references public.profiles (id),
  locked_at timestamptz,
  unique (id, agency_id),
  constraint hr_pay_periods_date_order check (ends_on >= starts_on)
);

-- Per-staff timecard approval rows within a pay period.
create table public.hr_timecard_approvals (
  id uuid primary key default gen_random_uuid(),
  pay_period_id uuid not null references public.hr_pay_periods (id) on delete cascade,
  staff_id uuid not null references public.profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'approved', 'changes_requested')),
  submitted_at timestamptz,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  note text,
  unique (pay_period_id, staff_id)
);

-- HR documents: handbook, policies, forms, notices.
create table public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  title text not null,
  category text check (category in ('handbook', 'policy', 'form', 'notice')),
  body text,
  file_url text,
  requires_ack boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

-- Staff acknowledgments of HR documents.
create table public.hr_document_acks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.hr_documents (id) on delete cascade,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  acked_at timestamptz not null default now(),
  signature_name text not null,
  unique (doc_id, staff_id)
);

-- Time-off requests (PTO / sick / unpaid / other).
create table public.hr_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  kind text check (kind in ('pto', 'sick', 'unpaid', 'other')),
  starts_on date not null,
  ends_on date not null,
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  constraint hr_time_off_requests_date_order check (ends_on >= starts_on)
);

-- Compliance readiness requirements (certificate / training / document /
-- acknowledgment), optionally recurring and scoped to role keys.
create table public.hr_readiness_requirements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  key text not null,
  label text not null,
  kind text check (kind in ('certificate', 'training', 'document', 'acknowledgment')),
  due_every_days integer check (due_every_days is null or due_every_days > 0),
  required_role_keys text[] not null default '{}',
  active boolean not null default true,
  unique (agency_id, key),
  unique (id, agency_id)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index hr_shifts_agency_starts_idx
  on public.hr_shifts (agency_id, starts_at);

create index hr_punches_agency_staff_time_idx
  on public.hr_punches (agency_id, staff_id, punched_at);

create index hr_punches_staff_idx
  on public.hr_punches (staff_id);

create index hr_punch_corrections_punch_idx
  on public.hr_punch_corrections (punch_id, status);

create index hr_punch_corrections_staff_idx
  on public.hr_punch_corrections (staff_id);

create index hr_timecard_approvals_staff_idx
  on public.hr_timecard_approvals (staff_id);

create index hr_time_off_requests_agency_status_idx
  on public.hr_time_off_requests (agency_id, status);

create index hr_time_off_requests_staff_idx
  on public.hr_time_off_requests (staff_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------

create trigger hr_shifts_updated_at before update on public.hr_shifts
for each row execute function private.set_updated_at();

create trigger hr_documents_updated_at before update on public.hr_documents
for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------------------

alter table public.hr_shifts enable row level security;
alter table public.hr_shifts force row level security;
alter table public.hr_punches enable row level security;
alter table public.hr_punches force row level security;
alter table public.hr_punch_corrections enable row level security;
alter table public.hr_punch_corrections force row level security;
alter table public.hr_pay_periods enable row level security;
alter table public.hr_pay_periods force row level security;
alter table public.hr_timecard_approvals enable row level security;
alter table public.hr_timecard_approvals force row level security;
alter table public.hr_documents enable row level security;
alter table public.hr_documents force row level security;
alter table public.hr_document_acks enable row level security;
alter table public.hr_document_acks force row level security;
alter table public.hr_time_off_requests enable row level security;
alter table public.hr_time_off_requests force row level security;
alter table public.hr_readiness_requirements enable row level security;
alter table public.hr_readiness_requirements force row level security;

-- hr_shifts: read for any agency member; writes for hub.manage_schedule only.
create policy hr_shifts_select on public.hr_shifts
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hr_shifts_write on public.hr_shifts
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_schedule')))
with check ((select private.has_permission(agency_id, 'hub.manage_schedule')));

-- hr_punches: staff read their own and insert their own; update/delete by
-- hub.review_timecards only (staff correct via the corrections flow).
create policy hr_punches_select on public.hr_punches
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, site_id))
);

create policy hr_punches_insert on public.hr_punches
for insert to authenticated
with check (staff_id = auth.uid());

create policy hr_punches_review_update on public.hr_punches
for update to authenticated
using ((select private.has_permission(agency_id, 'hub.review_timecards')))
with check ((select private.has_permission(agency_id, 'hub.review_timecards')));

create policy hr_punches_review_delete on public.hr_punches
for delete to authenticated
using ((select private.has_permission(agency_id, 'hub.review_timecards')));

-- hr_punch_corrections: staff request corrections on their own punches;
-- review (update) by hub.review_timecards only; no deletes.
create policy hr_punch_corrections_select on public.hr_punch_corrections
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and private.hr_team_visible(p.agency_id, p.site_id)
  )
);

create policy hr_punch_corrections_insert on public.hr_punch_corrections
for insert to authenticated
with check (
  staff_id = auth.uid()
  and exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and p.staff_id = auth.uid()
  )
);

create policy hr_punch_corrections_review on public.hr_punch_corrections
for update to authenticated
using (
  exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and private.has_permission(p.agency_id, 'hub.review_timecards')
      and private.hr_team_visible(p.agency_id, p.site_id)
  )
)
with check (
  exists (
    select 1
    from public.hr_punches p
    where p.id = hr_punch_corrections.punch_id
      and private.has_permission(p.agency_id, 'hub.review_timecards')
      and private.hr_team_visible(p.agency_id, p.site_id)
  )
);

-- hr_pay_periods: read for any agency member; writes for hub.approve_payroll.
create policy hr_pay_periods_select on public.hr_pay_periods
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hr_pay_periods_write on public.hr_pay_periods
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.approve_payroll')))
with check ((select private.has_permission(agency_id, 'hub.approve_payroll')));

-- hr_timecard_approvals: staff manage their own row (submit); decisions by
-- hub.review_timecards only. A staff row can never move itself past
-- pending/submitted.
create policy hr_timecard_approvals_select on public.hr_timecard_approvals
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.hr_team_visible(pp.agency_id, null)
  )
);

create policy hr_timecard_approvals_insert on public.hr_timecard_approvals
for insert to authenticated
with check (staff_id = auth.uid() and status in ('pending', 'submitted'));

create policy hr_timecard_approvals_submit on public.hr_timecard_approvals
for update to authenticated
using (staff_id = auth.uid())
with check (staff_id = auth.uid() and status in ('pending', 'submitted'));

create policy hr_timecard_approvals_decide on public.hr_timecard_approvals
for update to authenticated
using (
  exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.has_permission(pp.agency_id, 'hub.review_timecards')
      and private.hr_team_visible(pp.agency_id, null)
  )
)
with check (
  exists (
    select 1
    from public.hr_pay_periods pp
    where pp.id = hr_timecard_approvals.pay_period_id
      and private.has_permission(pp.agency_id, 'hub.review_timecards')
      and private.hr_team_visible(pp.agency_id, null)
  )
);

-- hr_documents: read for any agency member; writes for hub.manage_documents.
create policy hr_documents_select on public.hr_documents
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hr_documents_write on public.hr_documents
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_documents')))
with check ((select private.has_permission(agency_id, 'hub.manage_documents')));

-- hr_document_acks: staff insert their own acks only (no updates/deletes).
create policy hr_document_acks_select on public.hr_document_acks
for select to authenticated
using (
  staff_id = auth.uid()
  or exists (
    select 1
    from public.hr_documents d
    where d.id = hr_document_acks.doc_id
      and private.hr_team_visible(d.agency_id, null)
  )
);

create policy hr_document_acks_insert on public.hr_document_acks
for insert to authenticated
with check (
  staff_id = auth.uid()
  and exists (
    select 1
    from public.hr_documents d
    where d.id = hr_document_acks.doc_id
      and d.active
  )
);

-- hr_time_off_requests: staff insert their own and edit while pending;
-- decisions by hub.approve_time_off (site-scoped for house managers).
create policy hr_time_off_requests_select on public.hr_time_off_requests
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, site_id))
);

create policy hr_time_off_requests_insert on public.hr_time_off_requests
for insert to authenticated
with check (staff_id = auth.uid());

create policy hr_time_off_requests_self_update on public.hr_time_off_requests
for update to authenticated
using (staff_id = auth.uid() and status = 'pending')
with check (staff_id = auth.uid() and status = 'pending');

create policy hr_time_off_requests_decide on public.hr_time_off_requests
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  and (select private.hr_team_visible(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  and (select private.hr_team_visible(agency_id, site_id))
);

-- hr_readiness_requirements: read for any agency member; writes for
-- hub.manage_documents.
create policy hr_readiness_requirements_select on public.hr_readiness_requirements
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy hr_readiness_requirements_write on public.hr_readiness_requirements
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_documents')))
with check ((select private.has_permission(agency_id, 'hub.manage_documents')));

-- ----------------------------------------------------------------------------
-- Permission seeding (merge-only: never overwrite explicit agency choices)
-- ----------------------------------------------------------------------------

create temporary table hr_perm_defaults (
  role_key text not null,
  perm_key text not null,
  perm_value boolean not null,
  primary key (role_key, perm_key)
) on commit drop;

insert into hr_perm_defaults (role_key, perm_key, perm_value)
values
  -- hub.access: every role gets Employee Hub access.
  ('administrator', 'hub.access', true),
  ('compliance_admin', 'hub.access', true),
  ('house_manager', 'hub.access', true),
  ('program_manager', 'hub.access', true),
  ('dsp', 'hub.access', true),
  ('nurse', 'hub.access', true),
  ('hr', 'hub.access', true),
  ('auditor', 'hub.access', true),
  -- Scheduling / timecards / time off / team view: operational managers.
  ('administrator', 'hub.manage_schedule', true),
  ('program_manager', 'hub.manage_schedule', true),
  ('house_manager', 'hub.manage_schedule', true),
  ('compliance_admin', 'hub.manage_schedule', false),
  ('dsp', 'hub.manage_schedule', false),
  ('nurse', 'hub.manage_schedule', false),
  ('hr', 'hub.manage_schedule', false),
  ('auditor', 'hub.manage_schedule', false),
  ('administrator', 'hub.review_timecards', true),
  ('program_manager', 'hub.review_timecards', true),
  ('house_manager', 'hub.review_timecards', true),
  ('compliance_admin', 'hub.review_timecards', false),
  ('dsp', 'hub.review_timecards', false),
  ('nurse', 'hub.review_timecards', false),
  ('hr', 'hub.review_timecards', false),
  ('auditor', 'hub.review_timecards', false),
  ('administrator', 'hub.approve_time_off', true),
  ('program_manager', 'hub.approve_time_off', true),
  ('house_manager', 'hub.approve_time_off', true),
  ('compliance_admin', 'hub.approve_time_off', false),
  ('dsp', 'hub.approve_time_off', false),
  ('nurse', 'hub.approve_time_off', false),
  ('hr', 'hub.approve_time_off', false),
  ('auditor', 'hub.approve_time_off', false),
  ('administrator', 'hub.view_team', true),
  ('program_manager', 'hub.view_team', true),
  ('house_manager', 'hub.view_team', true),
  ('compliance_admin', 'hub.view_team', false),
  ('dsp', 'hub.view_team', false),
  ('nurse', 'hub.view_team', false),
  ('hr', 'hub.view_team', false),
  ('auditor', 'hub.view_team', false),
  -- Payroll approval / document management: administrator + program manager.
  ('administrator', 'hub.approve_payroll', true),
  ('program_manager', 'hub.approve_payroll', true),
  ('compliance_admin', 'hub.approve_payroll', false),
  ('house_manager', 'hub.approve_payroll', false),
  ('dsp', 'hub.approve_payroll', false),
  ('nurse', 'hub.approve_payroll', false),
  ('hr', 'hub.approve_payroll', false),
  ('auditor', 'hub.approve_payroll', false),
  ('administrator', 'hub.manage_documents', true),
  ('program_manager', 'hub.manage_documents', true),
  ('compliance_admin', 'hub.manage_documents', false),
  ('house_manager', 'hub.manage_documents', false),
  ('dsp', 'hub.manage_documents', false),
  ('nurse', 'hub.manage_documents', false),
  ('hr', 'hub.manage_documents', false),
  ('auditor', 'hub.manage_documents', false);

-- Add each key only where it is missing, so per-agency customizations are
-- never overwritten. New agencies inherit these defaults through
-- public.provision_agency_roles (copied from role_templates).
update public.role_templates rt
set permissions = rt.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_perm_defaults d
  where d.role_key = rt.key
    and not (rt.permissions ? d.perm_key)
);

update public.role_permission_matrix rpm
set permissions = rpm.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_perm_defaults d
  where d.role_key = rpm.role_key
    and not (rpm.permissions ? d.perm_key)
),
updated_at = now();

update public.agency_roles ar
set permissions = ar.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_perm_defaults d
  where d.role_key = ar.template_key
    and not (ar.permissions ? d.perm_key)
);

drop table hr_perm_defaults;

-- ----------------------------------------------------------------------------
-- Guardrail: fail loudly if any table is missing or lacks RLS
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
  v_tables text[] := array[
    'hr_shifts', 'hr_punches', 'hr_punch_corrections', 'hr_pay_periods',
    'hr_timecard_approvals', 'hr_documents', 'hr_document_acks',
    'hr_time_off_requests', 'hr_readiness_requirements'
  ];
begin
  foreach t in array v_tables
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'HR Employee Hub migration guard: table public.% is missing', t;
    end if;
    if not (
      select c.relrowsecurity and c.relforcerowsecurity
      from pg_class c
      where c.oid = ('public.' || t)::regclass
    ) then
      raise exception 'HR Employee Hub migration guard: table public.% lacks row level security', t;
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- STAFFING PATTERNS (2026-09-16): recurring weekly schedules, replacing the
-- free-text staffing spreadsheet. One row = one staff member's recurring
-- assignment: days of week + time windows (+ optional individual or house).
-- ----------------------------------------------------------------------------

create table public.hr_staffing_patterns (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid null references public.sites (id) on delete set null,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  individual_id uuid null references public.individuals (id) on delete set null,
  shift_label text null,
  days smallint[] not null default '{}',
  windows jsonb not null default '[]'::jsonb,
  weekly_hours numeric not null,
  service_tags text[] not null default '{}',
  requires_isd_training boolean not null default false,
  on_call boolean not null default false,
  notes text null,
  effective_from date not null,
  effective_to date null,
  active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  constraint hr_staffing_patterns_weekly_hours_check check (weekly_hours >= 0),
  constraint hr_staffing_patterns_dates_check
    check (effective_to is null or effective_to >= effective_from),
  constraint hr_staffing_patterns_windows_is_array
    check (jsonb_typeof(windows) = 'array')
);

create index hr_staffing_patterns_staff_idx
  on public.hr_staffing_patterns (agency_id, staff_id);
create index hr_staffing_patterns_site_idx
  on public.hr_staffing_patterns (agency_id, site_id);

create trigger hr_staffing_patterns_updated_at
  before update on public.hr_staffing_patterns
  for each row execute function private.set_updated_at();

alter table public.hr_staffing_patterns enable row level security;
alter table public.hr_staffing_patterns force row level security;

-- Team visibility for staffing patterns: hub.access holders see their own
-- rows plus team rows in scope (privileged + program_manager + hr see the
-- agency; house managers see their own site only; site-less patterns stay
-- with program-level staff and above).
create or replace function private.hr_staffing_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_agency(p_agency_id)
  and (select private.has_permission(p_agency_id, 'hub.access'))
  and (
    private.is_privileged(p_agency_id)
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and coalesce(m.role_key, m.role::text) in ('program_manager', 'hr')
    )
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and coalesce(m.role_key, m.role::text) = 'house_manager'
        and m.site_id is not null
        and m.site_id = p_site_id
    )
  );
$$;

-- Read: own patterns, or team patterns in scope (see helper above).
create policy hr_staffing_patterns_select on public.hr_staffing_patterns
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_staffing_visible(agency_id, site_id))
);

-- Write: hub.manage_staffing holders only; house managers stay site-scoped.
create policy hr_staffing_patterns_write on public.hr_staffing_patterns
for all to authenticated
using (
  (select private.has_permission(agency_id, 'hub.manage_staffing'))
  and (
    (select private.is_privileged(agency_id))
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = hr_staffing_patterns.agency_id
        and coalesce(m.role_key, m.role::text) in ('program_manager', 'hr')
    )
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = hr_staffing_patterns.agency_id
        and coalesce(m.role_key, m.role::text) = 'house_manager'
        and m.site_id is not null
        and m.site_id = hr_staffing_patterns.site_id
    )
  )
)
with check (
  (select private.has_permission(agency_id, 'hub.manage_staffing'))
  and (
    (select private.is_privileged(agency_id))
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = hr_staffing_patterns.agency_id
        and coalesce(m.role_key, m.role::text) in ('program_manager', 'hr')
    )
    or exists (
      select 1 from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = hr_staffing_patterns.agency_id
        and coalesce(m.role_key, m.role::text) = 'house_manager'
        and m.site_id is not null
        and m.site_id = hr_staffing_patterns.site_id
    )
  )
);

-- ----------------------------------------------------------------------------
-- hub.manage_staffing permission seed (merge-only-missing-keys, same pattern
-- as the hub.* seed above): administrator, program_manager, hr, and
-- house_manager can configure staffing patterns; everyone else is read-only.
-- ----------------------------------------------------------------------------

create temporary table hr_staffing_perm_defaults (
  role_key text not null,
  perm_key text not null,
  perm_value boolean not null,
  primary key (role_key, perm_key)
) on commit drop;

insert into hr_staffing_perm_defaults (role_key, perm_key, perm_value)
values
  ('administrator', 'hub.manage_staffing', true),
  ('program_manager', 'hub.manage_staffing', true),
  ('hr', 'hub.manage_staffing', true),
  ('house_manager', 'hub.manage_staffing', true),
  ('compliance_admin', 'hub.manage_staffing', false),
  ('dsp', 'hub.manage_staffing', false),
  ('nurse', 'hub.manage_staffing', false),
  ('auditor', 'hub.manage_staffing', false);

update public.role_templates rt
set permissions = rt.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_staffing_perm_defaults d
  where d.role_key = rt.key
    and not (rt.permissions ? d.perm_key)
);

update public.role_permission_matrix rpm
set permissions = rpm.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_staffing_perm_defaults d
  where d.role_key = rpm.role_key
    and not (rpm.permissions ? d.perm_key)
),
updated_at = now();

update public.agency_roles ar
set permissions = ar.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_staffing_perm_defaults d
  where d.role_key = ar.template_key
    and not (ar.permissions ? d.perm_key)
);

drop table hr_staffing_perm_defaults;

-- ----------------------------------------------------------------------------
-- DEMO SEED — fictional staffing patterns for the Evergreen demo agency.
-- Gated on the demo agency existing; idempotent (skips when demo patterns
-- already exist). All names come from the fictional Evergreen roster already
-- in the database — no real people, no real phone numbers.
-- ----------------------------------------------------------------------------

do $$
declare
  v_agency uuid := '00000000-0000-4000-8000-000000000001';
  v_site_a uuid;
  v_site_b uuid;
  v_creator uuid;
  v_staff uuid[];
  v_individuals uuid[];
begin
  if to_regclass('public.hr_staffing_patterns') is null then
    raise exception 'public.hr_staffing_patterns is missing';
  end if;
  if not exists (select 1 from public.agencies where id = v_agency) then
    return;
  end if;
  if exists (
    select 1 from public.hr_staffing_patterns
    where agency_id = v_agency and notes like 'DEMO SEED%'
  ) then
    return;
  end if;

  select id into v_site_a from public.sites
  where agency_id = v_agency order by name limit 1;
  select id into v_site_b from public.sites
  where agency_id = v_agency and id <> coalesce(v_site_a, '00000000-0000-0000-0000-000000000000'::uuid)
  order by name limit 1;

  select id into v_creator from public.profiles
  where home_agency_id = v_agency order by full_name limit 1;

  select coalesce(array_agg(sid order by sname), '{}')
  into v_staff
  from (select id as sid, full_name as sname from public.profiles where home_agency_id = v_agency limit 14) s;

  -- Fictional served individuals for the CSS-style rows (may be empty).
  select coalesce(array_agg(iid order by iname), '{}')
  into v_individuals
  from (select id as iid, full_name as iname from public.individuals where agency_id = v_agency limit 8) s;

  if coalesce(array_length(v_staff, 1), 0) < 4 or v_creator is null then
    return;
  end if;

  -- CSS-style rows: individual/community assignments with service tags.
  insert into public.hr_staffing_patterns
    (agency_id, site_id, staff_id, individual_id, shift_label, days, windows, weekly_hours,
     service_tags, requires_isd_training, on_call, notes,
     effective_from, active, created_by)
  select
    v_agency, null, v_staff[i],
    case
      when coalesce(array_length(v_individuals, 1), 0) = 0 then null
      else v_individuals[1 + ((i - 1) % array_length(v_individuals, 1))]
    end,
    case when i % 3 = 0 then 'Community support' else 'In-home support' end,
    case when i % 2 = 0 then array[1,2,3,4,5]::smallint[] else array[1,3,5]::smallint[] end,
    '[{"start":"07:30","end":"08:30"},{"start":"16:30","end":"17:30"}]'::jsonb,
    case when i % 2 = 0 then 10 else 6 end,
    case
      when i % 3 = 0 then array['Community Networking']
      when i % 3 = 1 then array['In-Home Respite']
      else array['In-Home Respite','Community Networking']
    end,
    (i % 4 = 1),
    (i % 5 = 2),
    'DEMO SEED — fictional CSS-style staffing pattern',
    current_date - interval '30 days',
    true,
    v_creator
  from generate_series(1, least(array_length(v_staff, 1), 8)) as i;

  -- LPMM-style rows: house-based shift labels across two demo houses.
  insert into public.hr_staffing_patterns
    (agency_id, site_id, staff_id, shift_label, days, windows, weekly_hours,
     service_tags, requires_isd_training, on_call, notes,
     effective_from, active, created_by)
  select
    v_agency,
    case when j % 2 = 0 then v_site_a else v_site_b end,
    v_staff[least(array_length(v_staff, 1), 8) + j],
    (array['1st shift','2nd shift','Overnight'])[1 + ((j - 1) % 3)],
    case ((j - 1) % 3)
      when 0 then array[1,2,3,4,5]::smallint[]
      when 1 then array[1,2,3,4,5]::smallint[]
      else array[0,6]::smallint[]
    end,
    (array[
      '[{"start":"07:00","end":"15:00"}]',
      '[{"start":"15:00","end":"23:00"}]',
      '[{"start":"23:00","end":"07:00"}]'
    ])[1 + ((j - 1) % 3)]::jsonb,
    (array[40, 40, 16])[1 + ((j - 1) % 3)],
    array['Residential']::text[],
    false,
    false,
    'DEMO SEED — fictional house staffing pattern',
    current_date - interval '30 days',
    true,
    v_creator
  from generate_series(1, least(array_length(v_staff, 1) - least(array_length(v_staff, 1), 8), 6)) as j;

end
$$;

-- ----------------------------------------------------------------------------
-- Guardrail: staffing patterns table present with RLS enforced
-- ----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.hr_staffing_patterns') is null then
    raise exception 'HR Employee Hub migration guard: table public.hr_staffing_patterns is missing';
  end if;
  if not (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class c
    where c.oid = 'public.hr_staffing_patterns'::regclass
  ) then
    raise exception 'HR Employee Hub migration guard: table public.hr_staffing_patterns lacks row level security';
  end if;
  if exists (
    select 1 from public.role_permission_matrix
    where not (permissions ? 'hub.manage_staffing')
  ) then
    raise exception 'HR Employee Hub migration guard: hub.manage_staffing missing from role_permission_matrix';
  end if;
end
$$;
