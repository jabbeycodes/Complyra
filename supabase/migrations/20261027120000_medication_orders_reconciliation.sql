-- Medication Orders + Medication Reconciliation (feature/medication-orders).
--
-- Builds ON TOP of the existing Medication Administration Record (MAR):
-- the medications / med_inventory / med_dose_marks tables are untouched in
-- shape. This migration adds the prescriber-order layer that now FEEDS the
-- MAR, plus the reconciliation checklist history.
--
--   medication_orders              — per-Individual prescriber orders with a
--                                    draft -> active -> discontinued lifecycle.
--                                    Activating a scheduled order creates (or
--                                    links) the medications row the MAR already
--                                    reads, and sets its dose-time schedule;
--                                    discontinuing it clears the schedule so the
--                                    dose leaves the MAR. The medications list
--                                    therefore derives from active orders rather
--                                    than being maintained separately.
--   medication_reconciliations     — a checklist run on admission, after an
--                                    ER / hospital return, or when orders
--                                    change. Each run compares active orders
--                                    against the current MAR list, requires a
--                                    nurse sign-off, and stays on the chart as
--                                    auditable history.
--   medication_reconciliation_items — one continue / change / stop decision per
--                                    medication, with a discrepancy flag + note.
--
-- A nullable medications.source_order_id back-link lets reconciliation detect
-- discrepancies (an active order with no MAR medication, or a MAR medication
-- whose order is no longer active).
--
-- RLS is enabled + forced on every new table, scoped to the agency and to the
-- Individual the caller may read (private.can_read_individual: site for
-- managers, worked-site for DSPs, agency-wide for PM / nurse / admin /
-- compliance / auditor). Direct support professionals are deliberately
-- excluded from reading orders / reconciliations — they continue to see only
-- the MAR (med_dose_marks), exactly as before.
--
-- Enforcement lives at the database layer, not only in the app (hardened
-- after the PR #120 review): writes use per-command policies instead of one
-- permissive `for all` policy, there is NO delete path for orders or
-- reconciliations (the app exposes none), reconciliation items may only be
-- deleted while their run is still in progress (the app's save flow replaces
-- the checklist of an open run), and BEFORE triggers enforce the lifecycle
-- itself — legal status transitions only, activation / discontinuation /
-- sign-off recorded against the signed-in user, sign-off closed to house
-- managers even by direct write, and completed reconciliations (with their
-- items) immutable as signed history.

begin;

-- ---------------------------------------------------------------------------
-- medications: back-link to the order that feeds this MAR medication.
-- ---------------------------------------------------------------------------
alter table public.medications
  add column if not exists source_order_id uuid;

-- ---------------------------------------------------------------------------
-- medication_orders
-- ---------------------------------------------------------------------------
create table public.medication_orders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  medication_name text not null,
  dose text not null default '',
  route text not null default '',
  -- Human-readable schedule as written by the prescriber (e.g. "BID", "Every
  -- morning"). The MAR dose slots live in schedule_times.
  schedule text not null default '',
  -- Scheduled "HH:MM" dose times projected onto the MAR when the order is
  -- active and not PRN. Empty for PRN or as-needed orders.
  schedule_times text[] not null default '{}',
  is_prn boolean not null default false,
  start_date date not null default current_date,
  -- End / review date: the order is "expiring" as this date approaches and
  -- "expired" once it passes. Null for an open-ended order.
  end_review_date date,
  prescriber_name text not null default '',
  reason text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'discontinued')),
  -- The MAR medication this order feeds, set when the order is activated.
  medication_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  activated_by uuid references public.profiles (id) on delete set null,
  activated_by_name text not null default '',
  activated_at timestamptz,
  discontinued_by uuid references public.profiles (id) on delete set null,
  discontinued_by_name text not null default '',
  discontinued_at timestamptz,
  discontinue_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete set null,
  constraint medication_orders_name_present check (length(btrim(medication_name)) > 0)
);

create index medication_orders_individual_idx
  on public.medication_orders (agency_id, individual_id);
create index medication_orders_status_idx
  on public.medication_orders (agency_id, status);
create index medication_orders_review_idx
  on public.medication_orders (agency_id, end_review_date)
  where status = 'active' and end_review_date is not null;

-- The medications back-link points at the activated order (added now that the
-- target table exists).
alter table public.medications
  add constraint medications_source_order_fk
  foreign key (source_order_id, agency_id)
  references public.medication_orders (id, agency_id) on delete set null;

create trigger medication_orders_updated_at before update on public.medication_orders
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- medication_reconciliations
-- ---------------------------------------------------------------------------
create table public.medication_reconciliations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  trigger text not null
    check (trigger in ('admission', 'hospital_return', 'order_change')),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),
  started_by uuid references public.profiles (id) on delete set null,
  started_by_name text not null default '',
  started_at timestamptz not null default now(),
  -- Nurse sign-off: required before a reconciliation is completed.
  signed_off_by uuid references public.profiles (id) on delete set null,
  signed_off_by_name text not null default '',
  signed_off_at timestamptz,
  sign_off_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create index medication_reconciliations_individual_idx
  on public.medication_reconciliations (agency_id, individual_id, started_at desc);

create trigger medication_reconciliations_updated_at before update on public.medication_reconciliations
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- medication_reconciliation_items
-- ---------------------------------------------------------------------------
create table public.medication_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  reconciliation_id uuid not null,
  -- The order and / or MAR medication this line answers (either may be null for
  -- a flagged discrepancy that exists on one side only).
  order_id uuid,
  medication_id uuid,
  -- Snapshot label so a completed reconciliation reads the same forever, even
  -- if the order or medication is later renamed.
  medication_label text not null default '',
  decision text not null default 'continue'
    check (decision in ('continue', 'change', 'stop')),
  discrepancy boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (reconciliation_id, agency_id)
    references public.medication_reconciliations (id, agency_id) on delete cascade
);

create index medication_reconciliation_items_parent_idx
  on public.medication_reconciliation_items (agency_id, reconciliation_id);

create trigger medication_reconciliation_items_updated_at before update on public.medication_reconciliation_items
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.medication_orders enable row level security;
alter table public.medication_orders force row level security;
alter table public.medication_reconciliations enable row level security;
alter table public.medication_reconciliations force row level security;
alter table public.medication_reconciliation_items enable row level security;
alter table public.medication_reconciliation_items force row level security;

-- Read: anyone who may read the Individual AND holds a clinical / oversight
-- role. DSPs are excluded here on purpose — they keep MAR-only visibility.
-- House managers read (and may start a reconciliation) for their homes.
create policy medication_orders_select on public.medication_orders
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager,auditor}'))
);

-- Insert: only the caller's own fresh draft. Lifecycle state starts
-- untouched, so no direct write can insert an order already active, forge
-- an activator, or pre-link the MAR medication.
create policy medication_orders_insert on public.medication_orders
for insert to authenticated
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse}'))
  and status = 'draft'
  and created_by = (select auth.uid())
  and medication_id is null
  and activated_by is null
  and activated_at is null
  and discontinued_by is null
  and discontinued_at is null
);

-- Update: the clinical roles that own orders. WHICH transitions and columns
-- each write may use is enforced by the workflow trigger below — RLS is
-- row-wide, so the policy only decides who may attempt an update at all.
create policy medication_orders_update on public.medication_orders
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse}'))
);

-- No DELETE policy and no DELETE grant: the app exposes no delete for
-- orders, and an order is part of the chart's audit record.

-- Workflow discipline for orders, at the database layer:
--   * ownership (agency, Individual, author, creation time) never changes;
--   * draft -> active is the only activation, recorded against the
--     signed-in user, and the only write that may set the MAR medication
--     link; the prescriber body cannot change in the same write;
--   * active -> discontinued is the only discontinuation, recorded against
--     the signed-in user with a reason; the activation record is history;
--   * with no status change, only draft body fields may move — so an
--     active or discontinued order cannot be edited in place, and the
--     activation / discontinuation records cannot be rewritten directly.
create or replace function private.medication_orders_workflow_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body_changed boolean;
  v_lifecycle_changed boolean;
begin
  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.individual_id is distinct from old.individual_id
     or new.created_by is distinct from old.created_by
     or new.created_by_name is distinct from old.created_by_name
     or new.created_at is distinct from old.created_at then
    raise exception 'Medication order ownership cannot be changed.'
      using errcode = 'check_violation';
  end if;

  v_body_changed := (
    old.medication_name, old.dose, old.route, old.schedule,
    old.schedule_times, old.is_prn, old.start_date, old.end_review_date,
    old.prescriber_name, old.reason
  ) is distinct from (
    new.medication_name, new.dose, new.route, new.schedule,
    new.schedule_times, new.is_prn, new.start_date, new.end_review_date,
    new.prescriber_name, new.reason
  );
  v_lifecycle_changed := (
    old.activated_by, old.activated_by_name, old.activated_at,
    old.discontinued_by, old.discontinued_by_name, old.discontinued_at,
    old.discontinue_reason
  ) is distinct from (
    new.activated_by, new.activated_by_name, new.activated_at,
    new.discontinued_by, new.discontinued_by_name, new.discontinued_at,
    new.discontinue_reason
  );

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'active' then
      if new.activated_by is distinct from (select auth.uid())
         or new.activated_at is null then
        raise exception 'An order can only be activated by the signed-in user.'
          using errcode = 'check_violation';
      end if;
      if new.discontinued_by is not null or new.discontinued_at is not null then
        raise exception 'An order cannot be discontinued in the same write that activates it.'
          using errcode = 'check_violation';
      end if;
      if v_body_changed then
        raise exception 'Activating an order cannot change what the prescriber ordered.'
          using errcode = 'check_violation';
      end if;
    elsif old.status = 'active' and new.status = 'discontinued' then
      if new.discontinued_by is distinct from (select auth.uid())
         or new.discontinued_at is null
         or length(btrim(new.discontinue_reason)) = 0 then
        raise exception 'An order can only be discontinued by the signed-in user, with a reason.'
          using errcode = 'check_violation';
      end if;
      if (new.activated_by, new.activated_at, new.medication_id)
         is distinct from (old.activated_by, old.activated_at, old.medication_id) then
        raise exception 'The activation record of an order cannot be rewritten.'
          using errcode = 'check_violation';
      end if;
      if v_body_changed then
        raise exception 'Discontinuing an order cannot change what the prescriber ordered.'
          using errcode = 'check_violation';
      end if;
    else
      raise exception 'Invalid medication order status transition.'
        using errcode = 'check_violation';
    end if;
  else
    if v_lifecycle_changed then
      raise exception 'Activation and discontinuation records cannot be edited directly.'
        using errcode = 'check_violation';
    end if;
    if new.medication_id is distinct from old.medication_id then
      raise exception 'The MAR medication link is only set when an order is activated.'
        using errcode = 'check_violation';
    end if;
    if old.status <> 'draft' and v_body_changed then
      raise exception 'Only a draft medication order can be edited.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger medication_orders_workflow_guard before update on public.medication_orders
for each row execute function private.medication_orders_workflow_guard();

create policy medication_reconciliations_select on public.medication_reconciliations
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager,auditor}'))
);

-- Insert: only the caller's own fresh, unsigned run. Sign-off state starts
-- untouched, so no direct write can insert a run already completed or
-- already signed by someone else. House managers may start runs for their
-- homes — starting is the only write the trigger below ever lets them
-- complete toward sign-off (see the workflow guard).
create policy medication_reconciliations_insert on public.medication_reconciliations
for insert to authenticated
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  and status = 'in_progress'
  and started_by = (select auth.uid())
  and signed_off_by is null
  and signed_off_at is null
);

-- Update: starters and signers alike pass this row gate; the workflow
-- trigger below decides which of them may actually complete a run.
create policy medication_reconciliations_update on public.medication_reconciliations
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
);

-- No DELETE policy and no DELETE grant: a reconciliation is auditable
-- history and the app exposes no delete for it.

-- Workflow discipline for reconciliations, at the database layer:
--   * ownership (agency, Individual, trigger, who started it, when) never
--     changes;
--   * in_progress -> completed is the only transition, and completing a run
--     is a clinical sign-off: the signer must hold a signing role
--     (nurse / Program Manager / administrator / compliance administrator —
--     the same set the app gates on; house managers are deliberately NOT
--     signers, so a house manager cannot complete or sign a run even by
--     direct write), the sign-off is recorded against the signed-in user,
--     and a sign-off note is required;
--   * while a run is in progress its sign-off fields stay untouched;
--   * a completed run is signed history: no column may change at all.
create or replace function private.medication_reconciliations_workflow_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.agency_id is distinct from old.agency_id
     or new.individual_id is distinct from old.individual_id
     or new.trigger is distinct from old.trigger
     or new.started_by is distinct from old.started_by
     or new.started_by_name is distinct from old.started_by_name
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Reconciliation ownership cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if old.status = 'completed' then
    raise exception 'A completed reconciliation is signed history and cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'in_progress' and new.status = 'completed' then
      if not (select private.role_key_in(old.agency_id, '{administrator,compliance_admin,program_manager,nurse}')) then
        raise exception 'Only a nurse or Program Manager can sign off a reconciliation.'
          using errcode = 'check_violation';
      end if;
      if new.signed_off_by is distinct from (select auth.uid())
         or new.signed_off_at is null
         or length(btrim(new.sign_off_note)) = 0 then
        raise exception 'A sign-off must be recorded against the signed-in user, with a note.'
          using errcode = 'check_violation';
      end if;
    else
      raise exception 'Invalid reconciliation status transition.'
        using errcode = 'check_violation';
    end if;
  else
    if (new.signed_off_by, new.signed_off_by_name, new.signed_off_at, new.sign_off_note)
       is distinct from
       (old.signed_off_by, old.signed_off_by_name, old.signed_off_at, old.sign_off_note) then
      raise exception 'Sign-off fields can only be set by completing the reconciliation.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger medication_reconciliations_workflow_guard before update on public.medication_reconciliations
for each row execute function private.medication_reconciliations_workflow_guard();

-- Items inherit their parent reconciliation's scope.
create policy medication_reconciliation_items_select on public.medication_reconciliation_items
for select to authenticated
using (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager,auditor}'))
  )
);

-- Writes on items are scoped to an IN-PROGRESS parent run: the checklist of
-- an open run may be seeded, edited, and replaced (the app's save flow
-- deletes and re-inserts the decisions of an open run). Once the parent run
-- is completed, its items are signed history — the policies below no longer
-- match, and the guard trigger after them raises as a backstop.
create policy medication_reconciliation_items_insert on public.medication_reconciliation_items
for insert to authenticated
with check (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and r.status = 'in_progress'
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
);

create policy medication_reconciliation_items_update on public.medication_reconciliation_items
for update to authenticated
using (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and r.status = 'in_progress'
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
)
with check (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and r.status = 'in_progress'
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
);

create policy medication_reconciliation_items_delete on public.medication_reconciliation_items
for delete to authenticated
using (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and r.status = 'in_progress'
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
);

-- Backstop for the item policies: an item may only be inserted into, moved
-- between, edited within, or deleted from runs that are still in progress.
-- This fires for every writer, so a completed run's checklist cannot be
-- rewritten even if a future policy edit reopens a path.
create or replace function private.medication_reconciliation_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select r.status into v_old_status
    from public.medication_reconciliations r
    where r.id = old.reconciliation_id and r.agency_id = old.agency_id;
    if v_old_status is distinct from 'in_progress' then
      raise exception 'The checklist of a completed reconciliation is signed history and cannot be changed.'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select r.status into v_new_status
    from public.medication_reconciliations r
    where r.id = new.reconciliation_id and r.agency_id = new.agency_id;
    if v_new_status is distinct from 'in_progress' then
      raise exception 'Decisions can only be recorded on a reconciliation that is still in progress.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  return old;
end;
$$;

create trigger medication_reconciliation_items_guard
before insert or update or delete on public.medication_reconciliation_items
for each row execute function private.medication_reconciliation_items_guard();

-- SQL privileges for `authenticated`: exactly the operations the policies
-- above allow — no DELETE on orders or reconciliations (the app exposes
-- none), item deletes only through the in-progress policy.
revoke delete on public.medication_orders, public.medication_reconciliations
  from authenticated, anon;
grant select on public.medication_orders to authenticated;
grant insert on public.medication_orders to authenticated;
grant update on public.medication_orders to authenticated;
grant all on public.medication_orders to service_role;
grant select on public.medication_reconciliations to authenticated;
grant insert on public.medication_reconciliations to authenticated;
grant update on public.medication_reconciliations to authenticated;
grant all on public.medication_reconciliations to service_role;
grant select on public.medication_reconciliation_items to authenticated;
grant insert on public.medication_reconciliation_items to authenticated;
grant update on public.medication_reconciliation_items to authenticated;
grant delete on public.medication_reconciliation_items to authenticated;
grant all on public.medication_reconciliation_items to service_role;

commit;
