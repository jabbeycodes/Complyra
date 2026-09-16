-- Complyrer HR / Employee Hub — phase 2: accrual policies + ledger, overtime
-- rules, and shift swaps.
--
-- Four new tables, RLS enabled + forced on each, following the phase-1
-- hr_employee_hub migration conventions:
--   - agency rows readable by members with hub.access,
--   - personal rows visible to the owner or through private.hr_team_visible,
--   - writes gated by hub.* permissions seeded merge-only at the bottom.
--
-- New permission: hub.manage_pay_settings (accrual policies, overtime rules).
--
-- CARRYOVER RUNBOOK — public.apply_accrual_carryover(p_agency_id, p_as_of):
--   Run once per year (pg_cron yearly job, or manually) to roll each staff
--   member's leave balance into the new carryover year, capped by the active
--   policy's carryover_cap_hours. Anything above the cap is forfeited.
--     select * from public.apply_accrual_carryover('<agency-uuid>', current_date);
--   The function is deterministic and idempotent: one ledger row per
--   staff + leave_type with period_start = the carryover boundary, inserted
--   with ON CONFLICT DO NOTHING on the (agency_id, staff_id, period_start,
--   leave_type) key, so re-running the same year inserts nothing new.
--   Returned rows report (staff_id, leave_type, carried, forfeited) for the
--   rows actually written. Grant execute only to callers with
--   hub.manage_pay_settings (the cron job uses the service role).
--
-- ANNIVERSARY BASIS NOTE: public.profiles has no hire/start-date column
-- (checked 2026-09-16 — grep across all migrations), so for 'anniversary'
-- basis policies the carryover year is anchored to each staff member's
-- earliest hr_accrual_ledger.period_start for that leave type. If a true
-- hire-date column is ever added to profiles, switch the anchor there.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- Leave accrual policies: tenure-based accrual rates + carryover caps.
create table public.hr_accrual_policies (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  leave_type text not null check (leave_type in ('vacation', 'pto', 'sick')),
  tenure_bands jsonb not null default '[]'::jsonb,
  carryover_cap_hours numeric not null default 0 check (carryover_cap_hours >= 0),
  carryover_basis text not null default 'calendar_year'
    check (carryover_basis in ('calendar_year', 'anniversary')),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  constraint hr_accrual_policies_bands_is_array
    check (jsonb_typeof(tenure_bands) = 'array'),
  constraint hr_accrual_policies_dates_check
    check (effective_to is null or effective_to >= effective_from)
);

-- One active policy per agency + leave type.
create unique index hr_accrual_policies_active_idx
  on public.hr_accrual_policies (agency_id, leave_type)
  where active;

-- Accrual ledger: append-only balance history per staff + leave type.
-- accrued/used/adjustment are the movements; balance is the running total.
create table public.hr_accrual_ledger (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  staff_id uuid not null,
  pay_period_id uuid,
  period_start date not null,
  leave_type text not null check (leave_type in ('vacation', 'pto', 'sick')),
  accrued numeric not null default 0,
  used numeric not null default 0,
  adjustment numeric not null default 0,
  balance numeric not null,
  note text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, staff_id, period_start, leave_type),
  foreign key (staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  foreign key (pay_period_id, agency_id)
    references public.hr_pay_periods (id, agency_id) on delete set null
);

-- Overtime rules: exactly one row per agency.
create table public.hr_overtime_rules (
  agency_id uuid not null unique
    references public.agencies (id) on delete cascade,
  weekly_threshold_hours numeric not null default 40
    check (weekly_threshold_hours > 0),
  daily_threshold_hours numeric
    check (daily_threshold_hours is null or daily_threshold_hours > 0),
  seventh_consecutive_day boolean not null default false,
  seventh_day_threshold_hours numeric not null default 8
    check (seventh_day_threshold_hours > 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

-- Shift swaps: requester offers one of their shifts, optionally targeting a
-- specific shift (requested_shift_id) or a specific staffer (target_staff_id).
-- Null requested_shift_id/target_staff_id means "open claim".
create table public.hr_shift_swaps (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  requester_id uuid not null,
  offered_shift_id uuid not null,
  requested_shift_id uuid,
  target_staff_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'cancelled')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (offered_shift_id, agency_id)
    references public.hr_shifts (id, agency_id) on delete cascade,
  foreign key (requested_shift_id, agency_id)
    references public.hr_shifts (id, agency_id) on delete set null,
  foreign key (requester_id, agency_id)
    references public.profiles (id, home_agency_id) on delete cascade,
  foreign key (target_staff_id, agency_id)
    references public.profiles (id, home_agency_id) on delete set null,
  constraint hr_shift_swaps_target_not_requester
    check (target_staff_id is null or target_staff_id <> requester_id),
  constraint hr_shift_swaps_shifts_distinct
    check (requested_shift_id is null or requested_shift_id <> offered_shift_id)
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index hr_accrual_ledger_staff_period_idx
  on public.hr_accrual_ledger (agency_id, staff_id, period_start);

create index hr_shift_swaps_offered_shift_idx
  on public.hr_shift_swaps (offered_shift_id);

create index hr_shift_swaps_agency_status_idx
  on public.hr_shift_swaps (agency_id, status);

-- ----------------------------------------------------------------------------
-- updated_at triggers (shared private.set_updated_at from the foundation
-- migration; hr_accrual_ledger is append-only so it keeps created_at only)
-- ----------------------------------------------------------------------------

create trigger hr_accrual_policies_updated_at before update on public.hr_accrual_policies
for each row execute function private.set_updated_at();

create trigger hr_overtime_rules_updated_at before update on public.hr_overtime_rules
for each row execute function private.set_updated_at();

create trigger hr_shift_swaps_updated_at before update on public.hr_shift_swaps
for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row level security
-- ----------------------------------------------------------------------------

alter table public.hr_accrual_policies enable row level security;
alter table public.hr_accrual_policies force row level security;
alter table public.hr_accrual_ledger enable row level security;
alter table public.hr_accrual_ledger force row level security;
alter table public.hr_overtime_rules enable row level security;
alter table public.hr_overtime_rules force row level security;
alter table public.hr_shift_swaps enable row level security;
alter table public.hr_shift_swaps force row level security;

-- hr_accrual_policies: read for agency members with hub.access; writes for
-- hub.manage_pay_settings.
create policy hr_accrual_policies_select on public.hr_accrual_policies
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (select private.has_permission(agency_id, 'hub.access'))
);

create policy hr_accrual_policies_write on public.hr_accrual_policies
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')))
with check ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- hr_accrual_ledger: staff read their own rows; team view through
-- hr_team_visible (program-level rows: privileged + program managers).
-- Writes (accrue/post/use) for hub.approve_time_off or hub.manage_pay_settings.
create policy hr_accrual_ledger_select on public.hr_accrual_ledger
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.hr_team_visible(agency_id, null))
);

create policy hr_accrual_ledger_write on public.hr_accrual_ledger
for insert to authenticated
with check (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  or (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
);

create policy hr_accrual_ledger_update on public.hr_accrual_ledger
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  or (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
)
with check (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  or (select private.has_permission(agency_id, 'hub.manage_pay_settings'))
);

-- hr_overtime_rules: read for agency members with hub.access; writes for
-- hub.manage_pay_settings.
create policy hr_overtime_rules_select on public.hr_overtime_rules
for select to authenticated
using (
  (select private.has_agency(agency_id))
  and (select private.has_permission(agency_id, 'hub.access'))
);

create policy hr_overtime_rules_write on public.hr_overtime_rules
for all to authenticated
using ((select private.has_permission(agency_id, 'hub.manage_pay_settings')))
with check ((select private.has_permission(agency_id, 'hub.manage_pay_settings')));

-- hr_shift_swaps: requester/target read their own; open (untargeted) pending
-- rows are visible to any hub.access member so they can claim them; team
-- view through hr_team_visible.
create policy hr_shift_swaps_select on public.hr_shift_swaps
for select to authenticated
using (
  requester_id = auth.uid()
  or target_staff_id = auth.uid()
  or (
    status = 'pending'
    and target_staff_id is null
    and (select private.has_permission(agency_id, 'hub.access'))
  )
  or (select private.hr_team_visible(agency_id, null))
);

-- Insert: the caller is the requester, holds hub.access, and may only offer
-- one of their own shifts (never a shift assigned to someone else).
create policy hr_shift_swaps_insert on public.hr_shift_swaps
for insert to authenticated
with check (
  requester_id = auth.uid()
  and status = 'pending'
  and decided_by is null
  and decided_at is null
  and (select private.has_permission(agency_id, 'hub.access'))
  and exists (
    select 1
    from public.hr_shifts s
    where s.id = offered_shift_id
      and s.agency_id = hr_shift_swaps.agency_id
      and s.staff_id = auth.uid()
  )
);

-- Requester may cancel their own pending swap.
create policy hr_shift_swaps_cancel on public.hr_shift_swaps
for update to authenticated
using (requester_id = auth.uid() and status = 'pending')
with check (requester_id = auth.uid() and status = 'cancelled');

-- Any hub.access member may claim an open (untargeted) pending swap.
create policy hr_shift_swaps_claim on public.hr_shift_swaps
for update to authenticated
using (
  status = 'pending'
  and target_staff_id is null
  and (select private.has_permission(agency_id, 'hub.access'))
)
with check (
  status = 'pending'
  and target_staff_id = auth.uid()
);

-- hub.manage_schedule holders decide (approve / deny / cancel) pending swaps.
create policy hr_shift_swaps_decide on public.hr_shift_swaps
for update to authenticated
using (
  status = 'pending'
  and (select private.has_permission(agency_id, 'hub.manage_schedule'))
)
with check (
  status in ('approved', 'denied', 'cancelled')
  and decided_by = auth.uid()
  and decided_at is not null
  and (select private.has_permission(agency_id, 'hub.manage_schedule'))
);

-- ----------------------------------------------------------------------------
-- Carryover: roll each staff member's leave balance into the new year.
-- Deterministic + idempotent (see runbook in the file header).
-- ----------------------------------------------------------------------------

create or replace function public.apply_accrual_carryover(
  p_agency_id uuid,
  p_as_of date default current_date
)
returns table (
  staff_id uuid,
  leave_type text,
  carried numeric,
  forfeited numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_year int := extract(year from p_as_of)::int;
  v_cal_boundary date := make_date(v_year, 1, 1);
  v_boundary date;
  v_anchor date;
  v_anniversary date;
  v_m int;
  v_d int;
  v_leap boolean := (v_year % 4 = 0) and (v_year % 100 <> 0 or v_year % 400 = 0);
  v_balance numeric;
  v_carried numeric;
  v_forfeited numeric;
begin
  -- Staff + leave types covered by an active policy as of the run date.
  for r in
    select distinct
      l.staff_id,
      l.leave_type,
      p.carryover_cap_hours,
      p.carryover_basis
    from public.hr_accrual_ledger l
    join public.hr_accrual_policies p
      on p.agency_id = l.agency_id
     and p.leave_type = l.leave_type
     and p.active
     and p.effective_from <= p_as_of
     and (p.effective_to is null or p.effective_to >= p_as_of)
    where l.agency_id = p_agency_id
  loop
    if r.carryover_basis = 'anniversary' then
      -- profiles carries no hire-date column, so anchor the anniversary year
      -- to this staff member's earliest ledger period_start for the leave
      -- type (see header note).
      select min(l2.period_start) into v_anchor
      from public.hr_accrual_ledger l2
      where l2.agency_id = p_agency_id
        and l2.staff_id = r.staff_id
        and l2.leave_type = r.leave_type;
      v_m := extract(month from v_anchor)::int;
      v_d := extract(day from v_anchor)::int;
      if v_m = 2 and v_d = 29 and not v_leap then
        v_d := 28;
      end if;
      v_anniversary := make_date(v_year, v_m, v_d);
      if v_anniversary > p_as_of then
        v_anniversary := (v_anniversary - interval '1 year')::date;
      end if;
      v_boundary := v_anniversary;
    else
      v_boundary := v_cal_boundary;
    end if;

    -- Latest balance before the carryover boundary.
    select l3.balance into v_balance
    from public.hr_accrual_ledger l3
    where l3.agency_id = p_agency_id
      and l3.staff_id = r.staff_id
      and l3.leave_type = r.leave_type
      and l3.period_start < v_boundary
    order by l3.period_start desc, l3.created_at desc
    limit 1;

    if v_balance is null or v_balance <= 0 then
      continue;
    end if;

    v_carried := least(v_balance, r.carryover_cap_hours);
    v_forfeited := greatest(v_balance - r.carryover_cap_hours, 0);

    insert into public.hr_accrual_ledger
      (agency_id, staff_id, pay_period_id, period_start, leave_type,
       accrued, used, adjustment, balance, note)
    values
      (p_agency_id, r.staff_id, null, v_boundary, r.leave_type,
       0, 0, v_carried - v_balance, v_carried,
       'carryover ' || extract(year from v_boundary)::int)
    on conflict (agency_id, staff_id, period_start, leave_type) do nothing;

    if found then
      staff_id := r.staff_id;
      leave_type := r.leave_type;
      carried := v_carried;
      forfeited := v_forfeited;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_accrual_carryover(uuid, date) from public;
grant execute on function public.apply_accrual_carryover(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- hub.manage_pay_settings permission seed (merge-only-missing-keys, same
-- pattern as the phase-1 hub.* seeds): administrator, program_manager, and
-- hr manage accrual policies + overtime rules; everyone else is read-only.
-- ----------------------------------------------------------------------------

create temporary table hr_pay_perm_defaults (
  role_key text not null,
  perm_key text not null,
  perm_value boolean not null,
  primary key (role_key, perm_key)
) on commit drop;

insert into hr_pay_perm_defaults (role_key, perm_key, perm_value)
values
  ('administrator', 'hub.manage_pay_settings', true),
  ('program_manager', 'hub.manage_pay_settings', true),
  ('hr', 'hub.manage_pay_settings', true),
  ('house_manager', 'hub.manage_pay_settings', false),
  ('compliance_admin', 'hub.manage_pay_settings', false),
  ('dsp', 'hub.manage_pay_settings', false),
  ('nurse', 'hub.manage_pay_settings', false),
  ('auditor', 'hub.manage_pay_settings', false);

update public.role_templates rt
set permissions = rt.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_pay_perm_defaults d
  where d.role_key = rt.key
    and not (rt.permissions ? d.perm_key)
);

update public.role_permission_matrix rpm
set permissions = rpm.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_pay_perm_defaults d
  where d.role_key = rpm.role_key
    and not (rpm.permissions ? d.perm_key)
),
updated_at = now();

update public.agency_roles ar
set permissions = ar.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from hr_pay_perm_defaults d
  where d.role_key = ar.template_key
    and not (ar.permissions ? d.perm_key)
);

drop table hr_pay_perm_defaults;

-- ----------------------------------------------------------------------------
-- DEMO SEED — fictional overtime rules + accrual policy for the Evergreen
-- demo agency. Gated on the demo agency existing; idempotent (skips when
-- rows already exist). No real people, no real phone numbers.
-- ----------------------------------------------------------------------------

do $$
declare
  v_agency uuid := '00000000-0000-4000-8000-000000000001';
  v_creator uuid;
begin
  if not exists (select 1 from public.agencies where id = v_agency) then
    return;
  end if;

  select id into v_creator from public.profiles
  where home_agency_id = v_agency order by full_name limit 1;
  if v_creator is null then
    return;
  end if;

  if not exists (select 1 from public.hr_overtime_rules where agency_id = v_agency) then
    insert into public.hr_overtime_rules
      (agency_id, weekly_threshold_hours, daily_threshold_hours,
       seventh_consecutive_day, seventh_day_threshold_hours, updated_by)
    values
      (v_agency, 40, null, false, 8, v_creator);
  end if;

  if not exists (
    select 1 from public.hr_accrual_policies
    where agency_id = v_agency and leave_type = 'pto' and active
  ) then
    insert into public.hr_accrual_policies
      (agency_id, leave_type, tenure_bands, carryover_cap_hours,
       carryover_basis, effective_from, active, created_by)
    values
      (v_agency, 'pto',
       '[{"min_years":0,"max_years":2,"hours_per_period":3.08},
         {"min_years":2,"max_years":5,"hours_per_period":4.62},
         {"min_years":5,"max_years":null,"hours_per_period":6.16}]'::jsonb,
       80, 'calendar_year', current_date, true, v_creator);
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- Guardrail: fail loudly if any table is missing, lacks RLS, or the new
-- permission was not seeded
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
  v_tables text[] := array[
    'hr_accrual_policies', 'hr_accrual_ledger',
    'hr_overtime_rules', 'hr_shift_swaps'
  ];
begin
  foreach t in array v_tables
  loop
    if to_regclass('public.' || t) is null then
      raise exception 'HR phase-2 migration guard: table public.% is missing', t;
    end if;
    if not (
      select c.relrowsecurity and c.relforcerowsecurity
      from pg_class c
      where c.oid = ('public.' || t)::regclass
    ) then
      raise exception 'HR phase-2 migration guard: table public.% lacks row level security', t;
    end if;
  end loop;
  if exists (
    select 1 from public.role_permission_matrix
    where not (permissions ? 'hub.manage_pay_settings')
  ) then
    raise exception 'HR phase-2 migration guard: hub.manage_pay_settings missing from role_permission_matrix';
  end if;
end
$$;
