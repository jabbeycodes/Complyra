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
-- compliance / auditor). Writes are gated to the clinical roles that own this
-- workflow; field-level rules (who may activate, who may sign off) are layered
-- in the app (see src/data/permissions.ts). Direct support professionals are
-- deliberately excluded from reading orders / reconciliations — they continue
-- to see only the MAR (med_dose_marks), exactly as before.

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

-- Write: nurses and Program Managers own orders; administrators and compliance
-- administrators may act too. House managers and auditors cannot change orders.
create policy medication_orders_write on public.medication_orders
for all to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse}'))
);

create policy medication_reconciliations_select on public.medication_reconciliations
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager,auditor}'))
);

-- Write: nurses / PMs / admins manage and sign off. House managers may start
-- (insert) and update a reconciliation for their homes, but sign-off is gated
-- to nurses / PMs in the app layer.
create policy medication_reconciliations_write on public.medication_reconciliations
for all to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
);

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

create policy medication_reconciliation_items_write on public.medication_reconciliation_items
for all to authenticated
using (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
)
with check (
  exists (
    select 1 from public.medication_reconciliations r
    where r.id = medication_reconciliation_items.reconciliation_id
      and r.agency_id = medication_reconciliation_items.agency_id
      and (select private.can_read_individual(r.agency_id, r.individual_id))
      and (select private.role_key_in(r.agency_id, '{administrator,compliance_admin,program_manager,nurse,house_manager}'))
  )
);

-- SQL privileges for `authenticated` (mirrors the policy-driven grant used by
-- tables created after 20260915025000; see 20260925120000). Each table gets
-- exactly the operations its authenticated policies allow.
do $$
declare p record; operation text;
begin
  for p in
    select pol.tablename, pol.cmd
    from pg_policies pol
    join pg_class c on c.relname = pol.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = pol.schemaname
    where pol.schemaname = 'public'
      and pol.tablename in (
        'medication_orders',
        'medication_reconciliations',
        'medication_reconciliation_items'
      )
      and 'authenticated' = any(pol.roles)
      and pol.permissive = 'PERMISSIVE'
      and c.relrowsecurity
  loop
    foreach operation in array case when p.cmd = 'ALL'
      then array['SELECT','INSERT','UPDATE','DELETE'] else array[p.cmd] end
    loop
      if not has_table_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)
        and (operation = 'DELETE'
             or not has_any_column_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)) then
        execute format('grant %s on public.%I to authenticated', operation, p.tablename);
      end if;
    end loop;
  end loop;
end $$;

commit;
