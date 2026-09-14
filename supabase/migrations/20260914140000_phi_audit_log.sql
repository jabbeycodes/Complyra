-- PHI ACCESS LOG (HIPAA technical safeguards, 2026-09-14).
--
-- HIPAA Security Rule technical safeguards (164.308 administrative /
-- 164.312 technical) require audit controls that record access to electronic
-- protected health information (ePHI): who accessed what, when, and what they
-- did. This migration creates that application-level trail.
--
-- DESIGN
--   - Mutations (create/update/delete) on PHI-bearing tables are captured by
--     a database trigger (private.phi_audit_trigger), so every write path is
--     logged no matter which client or edge function performed it. The
--     trigger stamps auth.uid() server-side; service-role writes are logged
--     with user_id NULL and details.source = 'service'.
--   - Views and exports cannot be captured by triggers (Postgres has no
--     SELECT triggers), so the client reports them through the
--     public.log_phi_access RPC, which stamps auth.uid() and created_at
--     server-side. user_agent / device_id are client-supplied; ip_address is
--     captured best-effort from the request headers GUC where available.
--     (Full server-observed IP for views would need an edge-function hop like
--     apply-signature's log action; that is a documented follow-up, not a
--     blocker: who/when/what is tamper-proof either way.)
--   - The table carries NO foreign keys: audit rows must survive the
--     deletion of the user, agency, or record they describe.
--   - RETENTION: waiver providers retain records six years from the date of
--     service (MMAC Record Retention Policy). Accordingly this table has NO
--     delete path for the authenticated role, and NO data-lifecycle /
--     auto-purge job may target it. Any future destruction workflow must
--     implement legal hold and agency sign-off BEFORE it is allowed to touch
--     this table.
--
-- Idempotent (if not exists / drop if exists) so the file is re-runnable.

-- ============================================================================
-- Table
-- ============================================================================

create table if not exists public.phi_access_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  user_id uuid, -- auth.uid() at write time; null for service/system writes
  action text not null
    check (action in ('view', 'create', 'update', 'delete', 'export')),
  record_type text not null, -- source table name, e.g. 'individuals'
  record_id text not null,   -- source row id, as text
  individual_id uuid,         -- set when the record relates to an individual
  created_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  device_id text,
  details jsonb not null default '{}'::jsonb
);

create index if not exists phi_access_log_agency_time_idx
  on public.phi_access_log (agency_id, created_at desc);
create index if not exists phi_access_log_user_idx
  on public.phi_access_log (user_id, created_at desc);
create index if not exists phi_access_log_record_idx
  on public.phi_access_log (record_type, record_id, created_at desc);
create index if not exists phi_access_log_individual_idx
  on public.phi_access_log (individual_id, created_at desc)
  where individual_id is not null;

-- ============================================================================
-- Row-level security
-- ============================================================================

alter table public.phi_access_log enable row level security;
alter table public.phi_access_log force row level security;

-- Readable only by the roles that own compliance oversight. There is
-- deliberately no INSERT/UPDATE/DELETE policy for the authenticated role:
-- rows are written by the trigger (owner context) and the SECURITY DEFINER
-- RPC below; the service_role key bypasses RLS for system writes.
drop policy if exists phi_access_log_select on public.phi_access_log;
create policy phi_access_log_select on public.phi_access_log
  for select to authenticated
  using (
    private.role_key_in(
      phi_access_log.agency_id,
      '{administrator,compliance_admin,auditor}'::text[]
    )
  );

-- ============================================================================
-- Trigger: capture every mutation on PHI-bearing tables
-- ============================================================================

create or replace function private.phi_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row jsonb;
  v_action text;
  v_agency uuid;
  v_individual uuid;
  v_headers jsonb;
  v_ip text;
  v_ua text;
begin
  if TG_OP = 'INSERT' then
    v_row := row_to_json(NEW);
    v_action := 'create';
  elsif TG_OP = 'UPDATE' then
    v_row := row_to_json(NEW);
    v_action := 'update';
  else
    v_row := row_to_json(OLD);
    v_action := 'delete';
  end if;

  -- Every trigger-carrying table has agency_id (verified 2026-09-14).
  v_agency := (v_row ->> 'agency_id')::uuid;
  if v_agency is null then
    raise exception 'phi_access_log: % row has no agency_id', TG_TABLE_NAME;
  end if;
  v_individual := nullif(v_row ->> 'individual_id', '')::uuid;

  -- Best-effort client network details. request.headers is not guaranteed to
  -- be present or JSON (it is absent on plain PostgREST writes), so a parse
  -- failure here must never break the clinical write below.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := v_headers ->> 'x-forwarded-for';
    v_ua := v_headers ->> 'user-agent';
  exception when others then
    v_ip := null;
    v_ua := null;
  end;

  insert into public.phi_access_log (
    agency_id, user_id, action, record_type, record_id, individual_id,
    ip_address, user_agent, details
  ) values (
    v_agency,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_row ->> 'id',
    v_individual,
    v_ip,
    v_ua,
    jsonb_build_object(
      'source', case when auth.uid() is null then 'service' else 'client' end,
      'table', TG_TABLE_NAME
    )
  );
  return coalesce(NEW, OLD);
exception
  -- Audit logging must never break the clinical write it observes: if the
  -- audit insert itself fails, record that fact in the row's absence would
  -- be silent, so we re-raise. (Deliberately fail-closed: a broken audit
  -- trail must be loud, not invisible.)
  when others then raise;
end;
$$;

-- Tables whose rows are (or directly describe) individual health, care,
-- medication, training, certification, or delegation records. Every table
-- listed here has an agency_id column; record_type is the table name.
do $$
declare
  t text;
  tables text[] := array[
    'individuals',
    'individual_profiles',
    'chart_files',
    'medications',
    'medication_deliveries',
    'med_dose_exceptions',
    'prn_dose_logs',
    'med_inventory',
    'training_checklists',
    'training_signoffs',
    'training_countersignatures',
    'training_requirements',
    'staff_certificates',
    'obligations',
    'obligation_signatures',
    'delegation_acknowledgments',
    'delegation_training_materials',
    'individual_delegation_assignments',
    'documents',
    'document_uploads',
    'home_safety_reports',
    'site_reviews',
    'emergency_drills',
    'hm_weekly_checklists',
    'mileage_trips',
    'hm_dsp_reviews',
    'adaptive_equipment',
    'equipment_month_logs',
    'clinical_renewals',
    'site_facts'
  ];
begin
  foreach t in array tables loop
    execute format(
      'drop trigger if exists phi_audit_%1$s on public.%1$I',
      t
    );
    execute format(
      'create trigger phi_audit_%1$s ' ||
      'after insert or update or delete on public.%1$I ' ||
      'for each row execute function private.phi_audit_trigger()',
      t
    );
  end loop;
end;
$$;

-- ============================================================================
-- RPC: client-reported views and exports
-- ============================================================================

-- Tables the client may report a view/export against. The agency is resolved
-- server-side from the referenced row, never trusted from the client — unless
-- the caller supplies p_agency_id for an export whose natural record id is a
-- parent (e.g. a site-level PDF): the function still verifies the caller
-- belongs to that agency via private.has_agency.
create or replace function public.log_phi_access(
  p_action text,
  p_record_type text,
  p_record_id text,
  p_individual_id uuid default null,
  p_user_agent text default null,
  p_device_id text default null,
  p_details jsonb default '{}'::jsonb,
  p_agency_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_agency uuid;
  v_id uuid;
  v_headers jsonb;
  v_ip text;
  v_allowed text[] := array[
    'individuals', 'individual_profiles', 'chart_files', 'medications',
    'medication_deliveries', 'med_dose_exceptions', 'prn_dose_logs',
    'med_inventory', 'training_checklists', 'training_signoffs',
    'training_countersignatures', 'training_requirements',
    'staff_certificates', 'obligations', 'obligation_signatures',
    'delegation_acknowledgments', 'delegation_training_materials',
    'individual_delegation_assignments', 'documents', 'document_uploads',
    'home_safety_reports', 'site_reviews', 'emergency_drills',
    'hm_weekly_checklists', 'mileage_trips', 'hm_dsp_reviews',
    'adaptive_equipment', 'equipment_month_logs', 'clinical_renewals',
    'site_facts', 'phi_access_log', 'workspace_export'
  ];
begin
  if p_action not in ('view', 'export') then
    raise exception 'log_phi_access only accepts view/export, got %', p_action;
  end if;
  if not (p_record_type = any (v_allowed)) then
    raise exception 'log_phi_access: unknown record_type %', p_record_type;
  end if;
  if p_agency_id is not null then
    -- Export against a parent record (e.g. a site-level PDF) or a virtual
    -- record (e.g. a filtered access-log export, a workspace CSV): the row
    -- cannot be looked up by id, so the caller supplies the agency they
    -- exported from; membership is still verified server-side.
    if not private.has_agency(p_agency_id) then
      raise exception 'log_phi_access: access denied';
    end if;
    v_agency := p_agency_id;
  else
    -- Agency is resolved from the referenced row, never trusted from the client.
    v_id := p_record_id::uuid;
    execute format(
      'select agency_id from public.%I where id = $1',
      p_record_type
    ) using v_id into v_agency;
    if v_agency is null then
      raise exception 'log_phi_access: % % not found', p_record_type, p_record_id;
    end if;
    -- The caller must belong to the agency they are reporting access to.
    if not private.has_agency(v_agency) then
      raise exception 'log_phi_access: access denied';
    end if;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := v_headers ->> 'x-forwarded-for';
  exception when others then
    v_ip := null;
  end;

  insert into public.phi_access_log (
    agency_id, user_id, action, record_type, record_id, individual_id,
    ip_address, user_agent, device_id, details
  ) values (
    v_agency,
    auth.uid(),
    p_action,
    p_record_type,
    p_record_id,
    p_individual_id,
    v_ip,
    p_user_agent,
    p_device_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_phi_access(
  text, text, text, uuid, text, text, jsonb, uuid
) to authenticated;

-- Read path for the Access log screen: agency-scoped, newest first.
create or replace function public.list_phi_access_log(
  p_user_id uuid default null,
  p_record_type text default null,
  p_record_id text default null,
  p_action text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns setof public.phi_access_log
language sql
security definer
set search_path = public, private
stable
as $$
  select l.*
  from public.phi_access_log l
  where private.role_key_in(
      l.agency_id,
      '{administrator,compliance_admin,auditor}'::text[]
    )
    and (p_user_id is null or l.user_id = p_user_id)
    and (p_record_type is null or l.record_type = p_record_type)
    and (p_record_id is null or l.record_id = p_record_id)
    and (p_action is null or l.action = p_action)
    and (p_from is null or l.created_at >= p_from)
    and (p_to is null or l.created_at <= p_to)
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.list_phi_access_log(
  uuid, text, text, text, timestamptz, timestamptz, integer, integer
) to authenticated;
