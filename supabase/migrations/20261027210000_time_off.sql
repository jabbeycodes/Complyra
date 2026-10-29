-- ============================================================================
-- TIME-OFF (2026-10-27): the full request lifecycle on the HR-PHASE2 leave
-- machinery — per-day hours, cancellation, append-only status history, and
-- DB-enforced status transitions. No parallel balance system: balances stay
-- in the HR-PHASE2 accrual ledger (approvals debit it; cancelling an
-- approved request restores it with an adjustment entry, posted by the app).
--
-- Type reconciliation: hr_time_off_requests.kind becomes a LeaveType. The
-- PHASE2 banks (vacation / pto — "Earned Time Off" / sick) are joined by
-- bereavement and unpaid; the accrual policy + ledger leave_type checks
-- widen to match. Legacy kind 'other' rows are remapped to 'unpaid' (they
-- never carried a balance).
--
-- New tables:
--   hr_time_off_request_days — per-day hours. A request's total_hours is
--     recomputed from these rows by trigger, so the stored total can never
--     disagree with the days.
--   hr_time_off_events — append-only status history (submitted / approved /
--     denied / cancelled, with actor + note). No update or delete policy
--     exists for anyone; rows leave only with their request.
--
-- Status machine, enforced by a BEFORE UPDATE trigger on the requests
-- table with actors bound to auth.uid(): pending → approved / denied
-- (decider stamped), pending → cancelled (owner or manager), approved →
-- cancelled (manager path, only before the start date, reason required).
-- Denied and cancelled requests are immutable. A trigger backfills day
-- rows + history for requests created before this migration.
--
-- Permissions: NO new permission keys. Approvals stay on
-- hub.approve_time_off and team visibility on hub.view_team /
-- private.hr_team_visible — both seeded by the HR migrations
-- (20260916120000 / 20260916130000), which run AFTER the
-- DPM/program-manager merge migration (20260916060000), so the
-- permission-clobber trap does not apply and no backfill is needed.
-- HR (whose template deliberately holds hub.view_team = false so it
-- cannot read the other HR tables) gets an agency-wide READ of time-off
-- requests/days/history through private.time_off_visible, with no write
-- path. House-manager SITE SCOPING is enforced by
-- private.time_off_team_visible: the shared private.hr_team_visible
-- cannot provide it (its privileged shortcut treats every legacy
-- 'manager' membership as agency-wide, house managers included), so the
-- requests decide policy is re-pointed at the scoped rule; the shared
-- helper itself is unchanged for the other HR tables. Auditors are
-- deliberately excluded from team visibility on all time-off tables:
-- time off is employment data, not an Individual's compliance record
-- (the same principle as Internal Messaging).
--
-- UNAPPLIED: this migration has NOT been run against any hosted database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kind remap + widened checks (requests, accrual policies, ledger)
-- ---------------------------------------------------------------------------

update public.hr_time_off_requests set kind = 'unpaid' where kind = 'other';

alter table public.hr_time_off_requests
  drop constraint if exists hr_time_off_requests_kind_check;
alter table public.hr_time_off_requests
  add constraint hr_time_off_requests_kind_check
  check (kind in ('vacation', 'pto', 'sick', 'bereavement', 'unpaid'));

alter table public.hr_time_off_requests
  drop constraint if exists hr_time_off_requests_status_check;
alter table public.hr_time_off_requests
  add constraint hr_time_off_requests_status_check
  check (status in ('pending', 'approved', 'denied', 'cancelled'));

alter table public.hr_accrual_policies
  drop constraint if exists hr_accrual_policies_leave_type_check;
alter table public.hr_accrual_policies
  add constraint hr_accrual_policies_leave_type_check
  check (leave_type in ('vacation', 'pto', 'sick', 'bereavement', 'unpaid'));

alter table public.hr_accrual_ledger
  drop constraint if exists hr_accrual_ledger_leave_type_check;
alter table public.hr_accrual_ledger
  add constraint hr_accrual_ledger_leave_type_check
  check (leave_type in ('vacation', 'pto', 'sick', 'bereavement', 'unpaid'));

-- ---------------------------------------------------------------------------
-- 2. Request columns: totals, cancellation stamp, updated_at
-- ---------------------------------------------------------------------------

alter table public.hr_time_off_requests
  add column if not exists total_hours numeric not null default 0,
  add column if not exists cancelled_by uuid references public.profiles (id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists updated_at timestamptz not null default now();

-- Legacy rows predate per-day hours: backfill the standard 8h/day total
-- (day rows are backfilled in step 3 and the trigger keeps them in sync).
update public.hr_time_off_requests
set total_hours = (ends_on - starts_on + 1) * 8
where total_hours = 0;

drop trigger if exists hr_time_off_requests_updated_at
  on public.hr_time_off_requests;
create trigger hr_time_off_requests_updated_at
before update on public.hr_time_off_requests
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Per-day hours
-- ---------------------------------------------------------------------------

create table public.hr_time_off_request_days (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  request_id uuid not null,
  day_date date not null,
  hours numeric not null check (hours > 0 and hours <= 24),
  created_at timestamptz not null default now(),
  unique (request_id, day_date),
  unique (id, agency_id),
  foreign key (request_id, agency_id)
    references public.hr_time_off_requests (id, agency_id) on delete cascade
);

create index hr_time_off_request_days_request_idx
  on public.hr_time_off_request_days (request_id);
create index hr_time_off_request_days_agency_date_idx
  on public.hr_time_off_request_days (agency_id, day_date);

alter table public.hr_time_off_request_days enable row level security;
alter table public.hr_time_off_request_days force row level security;

-- A day must sit inside its request's range, in the request's agency, and
-- day rows freeze once the request leaves pending.
create or replace function private.guard_time_off_day()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_starts_on date;
  v_ends_on date;
  v_agency_id uuid;
  v_status text;
begin
  select starts_on, ends_on, agency_id, status
    into v_starts_on, v_ends_on, v_agency_id, v_status
  from public.hr_time_off_requests
  where id = new.request_id;
  if not found then
    raise exception 'Time-off request % not found.', new.request_id
      using errcode = '23503';
  end if;
  if new.agency_id <> v_agency_id then
    raise exception 'A time-off day must sit in the same agency as its request.'
      using errcode = '23514';
  end if;
  if v_status <> 'pending' then
    raise exception 'The days of a % request can no longer change.', v_status
      using errcode = '23514';
  end if;
  if new.day_date < v_starts_on or new.day_date > v_ends_on then
    raise exception 'Day % is outside the requested dates.', new.day_date
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_time_off_day() from public;

-- (The guard trigger is created after the legacy backfill below: backfilled
-- day rows belong to requests that may already be decided.)

-- The stored total is always the sum of the day rows.
create or replace function private.recompute_time_off_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid := coalesce(new.request_id, old.request_id);
begin
  update public.hr_time_off_requests r
     set total_hours = coalesce(
           (select sum(d.hours)
              from public.hr_time_off_request_days d
             where d.request_id = v_request_id), 0)
   where r.id = v_request_id;
  return null;
end;
$$;

revoke all on function private.recompute_time_off_total() from public;

create trigger hr_time_off_request_days_total
after insert or update or delete on public.hr_time_off_request_days
for each row execute function private.recompute_time_off_total();

-- Backfill day rows for requests created before per-day hours existed.
insert into public.hr_time_off_request_days (agency_id, request_id, day_date, hours)
select r.agency_id, r.id, gs::date, 8
from public.hr_time_off_requests r
cross join lateral generate_series(r.starts_on, r.ends_on, interval '1 day') as gs
where not exists (
  select 1 from public.hr_time_off_request_days d where d.request_id = r.id
);

create trigger hr_time_off_request_days_guard
before insert or update on public.hr_time_off_request_days
for each row execute function private.guard_time_off_day();

-- ---------------------------------------------------------------------------
-- 4. Append-only status history
-- ---------------------------------------------------------------------------

create table public.hr_time_off_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.profiles (id),
  event text not null check (event in ('submitted', 'approved', 'denied', 'cancelled')),
  note text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (request_id, agency_id)
    references public.hr_time_off_requests (id, agency_id) on delete cascade
);

create index hr_time_off_events_request_idx
  on public.hr_time_off_events (request_id, created_at);

alter table public.hr_time_off_events enable row level security;
alter table public.hr_time_off_events force row level security;

-- Backfill history for pre-existing requests: a submission, plus the
-- decision where one was recorded.
insert into public.hr_time_off_events (agency_id, request_id, actor_id, event, note, created_at)
select agency_id, id, staff_id, 'submitted', null, created_at
from public.hr_time_off_requests;

insert into public.hr_time_off_events (agency_id, request_id, actor_id, event, note, created_at)
select agency_id, id, decided_by, status, decision_note, decided_at
from public.hr_time_off_requests
where decided_by is not null and status in ('approved', 'denied');

-- ---------------------------------------------------------------------------
-- 5. The status machine (trigger) + owner-cancel policy fix
-- ---------------------------------------------------------------------------

create or replace function private.guard_time_off_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Identity fields never move.
  if new.staff_id <> old.staff_id or new.agency_id <> old.agency_id then
    raise exception 'A time-off request cannot change owner or agency.'
      using errcode = '23514';
  end if;

  -- Closed requests are immutable.
  if old.status in ('denied', 'cancelled') then
    raise exception 'This time-off request is % and can no longer change.', old.status
      using errcode = '23514';
  end if;

  -- A range edit must keep every day row inside the range.
  if (new.starts_on <> old.starts_on or new.ends_on <> old.ends_on)
     and exists (
       select 1 from public.hr_time_off_request_days d
       where d.request_id = old.id
         and (d.day_date < new.starts_on or d.day_date > new.ends_on)
     ) then
    raise exception 'The new dates would leave a day outside the request range.'
      using errcode = '23514';
  end if;

  if new.status = old.status then
    -- No transition: while pending, decision/cancellation stamps stay empty.
    if old.status = 'pending'
       and (new.decided_by is not null or new.cancelled_by is not null) then
      raise exception 'A pending request cannot carry a decision or cancellation.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved', 'denied') then
    if new.decided_by is distinct from auth.uid() or new.decided_at is null then
      raise exception 'A decision must be stamped with the deciding manager.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    if new.cancelled_by is distinct from auth.uid() or new.cancelled_at is null then
      raise exception 'A cancellation must be stamped with who cancelled it.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'approved' and new.status = 'cancelled' then
    -- Manager-only path (RLS decides who may write at all): before the
    -- start date, with a reason, stamped with the canceller.
    if new.cancelled_by is distinct from auth.uid() or new.cancelled_at is null then
      raise exception 'A cancellation must be stamped with who cancelled it.'
        using errcode = '23514';
    end if;
    if old.starts_on <= current_date then
      raise exception 'This time off has already started and can no longer be cancelled.'
        using errcode = '23514';
    end if;
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' then
      raise exception 'Cancelling approved time off requires a reason.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Time-off requests cannot move from % to %.', old.status, new.status
    using errcode = '23514';
end;
$$;

revoke all on function private.guard_time_off_transition() from public;

create trigger hr_time_off_requests_guard
before update on public.hr_time_off_requests
for each row execute function private.guard_time_off_transition();

-- The PHASE2 self-update policy required the new row to stay 'pending',
-- which made owner-cancellation impossible. Owners may now land on
-- 'cancelled' too; the transition trigger above polices what is legal.
drop policy if exists hr_time_off_requests_self_update
  on public.hr_time_off_requests;
create policy hr_time_off_requests_self_update on public.hr_time_off_requests
for update to authenticated
using (staff_id = auth.uid() and status = 'pending')
with check (staff_id = auth.uid() and status in ('pending', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 6. Visibility: the approver chain sees requests through
--    private.hr_team_visible (hub.view_team + role/site scope). HR gets an
--    agency-wide READ of time-off requests and their days/history via a
--    time-off-specific rule — deliberately NOT a hub.view_team grant,
--    which would widen HR's read across every HR table (punches,
--    timecards, swaps). HR has no write path here: decisions stay on
--    hub.approve_time_off, and HR's balance adjustments post to the ledger
--    under hub.manage_pay_settings, exactly as HR-PHASE2 designed.
-- ---------------------------------------------------------------------------

create or replace function private.time_off_hr_visible(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'hr'
      and (m.expires_on is null or m.expires_on >= current_date)
  );
$$;

grant execute on function private.time_off_hr_visible(uuid) to authenticated;

-- The approver chain's visibility for time off, with the site scope
-- actually enforced for house managers. private.hr_team_visible cannot
-- be reused for this: its privileged shortcut (private.is_privileged)
-- treats every membership with the legacy role 'manager' as privileged,
-- which makes its house-manager site branch dead code — a house manager
-- of one home would see every home's requests. That helper is shared by
-- all HR-PHASE2 tables and is left untouched; time off gets the scoped
-- rule the workflow promises (null-site rows stay program-level).
create or replace function private.time_off_team_visible(p_agency_id uuid, p_site_id uuid)
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
          m.role_key in ('administrator', 'compliance_admin', 'program_manager')
          or (
            m.role_key = 'house_manager'
            and p_site_id is not null
            and (m.site_id is null or m.site_id = p_site_id)
          )
        )
    );
$$;

grant execute on function private.time_off_team_visible(uuid, uuid) to authenticated;

create or replace function private.time_off_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select private.time_off_team_visible(p_agency_id, p_site_id))
      or (select private.time_off_hr_visible(p_agency_id));
$$;

grant execute on function private.time_off_visible(uuid, uuid) to authenticated;

-- Decisions bind to the same scoped rule (HR's read path never decides):
-- the PHASE2 decide policy pointed at the unscoped shared helper.
drop policy if exists hr_time_off_requests_decide on public.hr_time_off_requests;
create policy hr_time_off_requests_decide on public.hr_time_off_requests
for update to authenticated
using (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  and (select private.time_off_team_visible(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'hub.approve_time_off'))
  and (select private.time_off_team_visible(agency_id, site_id))
);

-- The requests select policy gains the HR read path (writes unchanged).
drop policy if exists hr_time_off_requests_select on public.hr_time_off_requests;
create policy hr_time_off_requests_select on public.hr_time_off_requests
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.time_off_visible(agency_id, site_id))
);

-- Auditors are fully excluded — including creating a request of their
-- own. (The tab is also hidden for the auditor role in the Hub.) The
-- membership probe is security-definer so the policy does not depend on
-- the caller's own view of the memberships table.
create or replace function private.time_off_is_auditor(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'auditor'
      and (m.expires_on is null or m.expires_on >= current_date)
  );
$$;

grant execute on function private.time_off_is_auditor(uuid) to authenticated;

drop policy if exists hr_time_off_requests_insert on public.hr_time_off_requests;
create policy hr_time_off_requests_insert on public.hr_time_off_requests
for insert to authenticated
with check (
  staff_id = auth.uid()
  and not (select private.time_off_is_auditor(agency_id))
);

-- ---------------------------------------------------------------------------
-- 7. RLS for the new tables — per-command policies keyed to the parent
--    request's visibility. No DELETE policy anywhere: cancellations are
--    status changes, history is append-only.
-- ---------------------------------------------------------------------------

create policy hr_time_off_request_days_select on public.hr_time_off_request_days
for select to authenticated
using (
  exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and (
        r.staff_id = auth.uid()
        or (select private.time_off_visible(r.agency_id, r.site_id))
      )
  )
);

create policy hr_time_off_request_days_insert on public.hr_time_off_request_days
for insert to authenticated
with check (
  exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and r.staff_id = auth.uid()
      and r.status = 'pending'
  )
);

create policy hr_time_off_request_days_update on public.hr_time_off_request_days
for update to authenticated
using (
  exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and r.staff_id = auth.uid()
      and r.status = 'pending'
  )
)
with check (
  exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and r.staff_id = auth.uid()
      and r.status = 'pending'
  )
);

create policy hr_time_off_events_select on public.hr_time_off_events
for select to authenticated
using (
  exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and (
        r.staff_id = auth.uid()
        or (select private.time_off_visible(r.agency_id, r.site_id))
      )
  )
);

create policy hr_time_off_events_insert on public.hr_time_off_events
for insert to authenticated
with check (
  actor_id = auth.uid()
  and exists (
    select 1 from public.hr_time_off_requests r
    where r.id = request_id
      and r.agency_id = agency_id
      and (
        r.staff_id = auth.uid()
        or (select private.time_off_team_visible(r.agency_id, r.site_id))
      )
  )
);

-- Table privileges mirror the policies exactly (policies do not grant SQL
-- privileges): no DELETE grant on either table, no UPDATE on history.
grant select, insert, update on public.hr_time_off_request_days to authenticated;
grant select, insert on public.hr_time_off_events to authenticated;
