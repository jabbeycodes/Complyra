-- House Card: the per-home petty cash ledger.
--
-- Every program site runs a house card: the agency credits funds onto it,
-- staff record each purchase against it, and the home's manager signs the
-- month closed. One append-only entry per money movement (credit /
-- purchase / refund); purchases carry a category, and the Gas, Health
-- card, and Food stamps categories are always tied to one Individual of
-- the home while Groceries & household is the home's own spending. Money
-- is integer cents. The balance is derived from the entries — it is never
-- stored as an editable number.
--
-- Corrections never erase: a wrong entry is voided with a reason through
-- an update, and its replacement (when the spend still happened) is a new
-- entry linked to the voided one. Voided rows stay visible and never
-- count. There is NO delete path — no policy, no grant.
--
-- A month close is the manager's attestation (printed name = their
-- account name, typed signature, server timestamp, closing-balance
-- snapshot). A database trigger refuses NEW entries dated into a closed
-- month; void/replace corrections into the same closed month stay
-- possible and are marked post-close corrections by the app.
--
-- Security model mirrors the menu-records / mileage family:
-- - Reads scope through private.can_read_site (site for managers and
--   assigned DSPs, agency-wide for PM/administrator/auditor) AND the
--   reader role list. Nurses and HR are excluded by construction.
-- - Writes require a recorder role (administrator, program_manager,
--   house_manager, dsp) in site scope; closes require a closer role
--   (administrator, program_manager, house_manager).
-- - NO new permission key is introduced, so the program_manager template
--   trap (20260916060000 wholesale-replacing the PM matrix after the
--   seed) does not apply: access rides on role keys, like menu records.
-- - The author is stamped by trigger from auth.uid(); identity columns
--   (agency, site, Individual, author, created_at) are frozen on update,
--   and the only update a live row accepts is the void transition plus
--   its replacement link. A voided row is immutable.

begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.house_card_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  entry_date date not null,
  kind text not null check (kind in ('credit', 'purchase', 'refund')),
  location text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  category text
    check (category in ('groceries_household', 'gas', 'health_card', 'food_stamps')),
  individual_id uuid references public.individuals (id) on delete cascade,
  note text not null default '',
  receipt_photo jsonb,
  recorded_by uuid not null references public.profiles (id) on delete cascade,
  recorded_by_name text not null default '',
  recorded_by_role text not null default '',
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  replaces_entry_id uuid references public.house_card_entries (id) on delete cascade,
  replaced_by_entry_id uuid references public.house_card_entries (id) on delete cascade,
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  -- Category / Individual shape: purchases carry exactly one category;
  -- the attributed categories require an Individual, Groceries &
  -- household forbids one; credits and refunds carry neither.
  constraint house_card_entries_category_shape check (
    (kind = 'purchase' and category is not null and (
      (category = 'groceries_household' and individual_id is null)
      or (category in ('gas', 'health_card', 'food_stamps')
          and individual_id is not null)
    ))
    or (kind in ('credit', 'refund')
        and category is null and individual_id is null)
  ),
  -- A void is all-or-nothing: stamp, voider, and reason land together.
  constraint house_card_entries_void_shape check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
        and length(btrim(coalesce(void_reason, ''))) > 0)
  )
);

create index house_card_entries_site_date_idx
  on public.house_card_entries (agency_id, site_id, entry_date);

create table public.house_card_month_closes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closing_balance_cents integer not null,
  printed_name text not null,
  signature_text text not null check (length(btrim(signature_text)) > 0),
  signed_by uuid not null references public.profiles (id) on delete cascade,
  signed_by_name text not null default '',
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id, month),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

create index house_card_month_closes_site_idx
  on public.house_card_month_closes (agency_id, site_id, month);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.house_card_entries enable row level security;
alter table public.house_card_entries force row level security;
alter table public.house_card_month_closes enable row level security;
alter table public.house_card_month_closes force row level security;

-- Read: a reader role at a readable site. Auditors and compliance
-- administrators read; nurses and HR never do.
create policy house_card_entries_select on public.house_card_entries
for select to authenticated
using (
  (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,house_manager,dsp,auditor}'))
);

-- Record: the staff who run the home's money, at their own site scope
-- (can_read_site is site-bound for house managers and assigned DSPs,
-- agency-wide for program managers and administrators).
create policy house_card_entries_insert on public.house_card_entries
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
);

-- Void / link a replacement: same recorder gate. The identity guard
-- trigger below restricts what such an update may actually change.
create policy house_card_entries_update on public.house_card_entries
for update to authenticated
using (
  (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
)
with check (
  (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
);

-- No delete policy: the ledger is append-only, for every role.

create policy house_card_month_closes_select on public.house_card_month_closes
for select to authenticated
using (
  (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,house_manager,dsp,auditor}'))
);

create policy house_card_month_closes_insert on public.house_card_month_closes
for insert to authenticated
with check (
  signed_by = (select auth.uid())
  and (select private.can_read_site(agency_id, site_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager}'))
);

-- No update or delete policy on closes: a signed month is final.

-- The audit access boundaries (20260915023000) as restrictive policies,
-- the way the appointments and life-events tables carry them: an active
-- membership in the row's agency, and — for entries tied to one
-- Individual — read access to that Individual. Unattributed rows
-- (credits, refunds, Groceries & household) carry no Individual scope.
create policy house_card_entries_audit_membership on public.house_card_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy house_card_entries_audit_individual_scope
  on public.house_card_entries
as restrictive for all to authenticated
using (
  individual_id is null
  or (select private.can_read_individual(agency_id, individual_id))
)
with check (
  individual_id is null
  or (select private.can_read_individual(agency_id, individual_id))
);

create policy house_card_closes_audit_membership
  on public.house_card_month_closes
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- ----------------------------------------------------------------------------
-- Entry guard: stamp the author, freeze identity, keep voids final, and
-- refuse new entries dated into a signed-closed month.
-- ----------------------------------------------------------------------------

create or replace function private.house_card_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_month text := to_char(new.entry_date, 'YYYY-MM');
  v_original_month text;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if v_uid is not null then
      new.recorded_by := v_uid;
      new.recorded_by_name := coalesce(
        (select p.full_name from public.profiles p where p.id = v_uid),
        new.recorded_by_name
      );
      new.recorded_by_role := coalesce(
        (select m.role_key from public.memberships m
          where m.agency_id = new.agency_id and m.user_id = v_uid
          limit 1),
        new.recorded_by_role
      );
      -- A new entry is always live: voiding is an update, never an insert.
      new.voided_at := null;
      new.voided_by := null;
      new.void_reason := null;
      new.replaced_by_entry_id := null;
    end if;
    -- A closed month refuses new entries. A replacement entry may still
    -- land in the closed month it corrects (same month as the entry it
    -- replaces); moving a correction into a DIFFERENT closed month is a
    -- new entry there and is refused the same way.
    if exists (
      select 1 from public.house_card_month_closes c
      where c.site_id = new.site_id and c.month = v_month
    ) then
      if new.replaces_entry_id is null then
        raise exception 'This month is closed and signed; new entries cannot be added to it.'
          using errcode = 'P0001';
      end if;
      select to_char(e.entry_date, 'YYYY-MM') into v_original_month
        from public.house_card_entries e where e.id = new.replaces_entry_id;
      if v_original_month is distinct from v_month then
        raise exception 'This month is closed and signed; new entries cannot be added to it.'
          using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  -- A voided entry is immutable: no un-voiding, no rewriting its reason
  -- or voider, whoever asks.
  if old.voided_at is not null then
    raise exception 'A voided house card entry cannot be changed.'
      using errcode = 'P0001';
  end if;

  -- On a live row the ONLY permitted change is the void transition
  -- (voided_at / voided_by / void_reason) and the replacement link.
  if new.agency_id is distinct from old.agency_id
     or new.site_id is distinct from old.site_id
     or new.entry_date is distinct from old.entry_date
     or new.kind is distinct from old.kind
     or new.location is distinct from old.location
     or new.amount_cents is distinct from old.amount_cents
     or new.category is distinct from old.category
     or new.individual_id is distinct from old.individual_id
     or new.note is distinct from old.note
     or new.receipt_photo is distinct from old.receipt_photo
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_name is distinct from old.recorded_by_name
     or new.recorded_by_role is distinct from old.recorded_by_role
     or new.created_at is distinct from old.created_at
     or new.replaces_entry_id is distinct from old.replaces_entry_id then
    raise exception 'A house card entry cannot be edited; void it and record a replacement.'
      using errcode = 'P0001';
  end if;

  if new.voided_at is not null then
    -- The void transition: a reason is mandatory and the stamp is ours.
    if length(btrim(coalesce(new.void_reason, ''))) = 0 then
      raise exception 'A reason is required to void a house card entry.'
        using errcode = 'P0001';
    end if;
    new.voided_at := now();
    new.voided_by := v_uid;
  else
    -- Not a void: the void fields stay exactly as they were (empty).
    new.voided_at := old.voided_at;
    new.voided_by := old.voided_by;
    new.void_reason := old.void_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists house_card_entries_guard on public.house_card_entries;
create trigger house_card_entries_guard
before insert or update on public.house_card_entries
for each row execute function private.house_card_entries_guard();

-- ----------------------------------------------------------------------------
-- Close guard: the sign-off names the closer, from their own account.
-- ----------------------------------------------------------------------------

create or replace function private.house_card_closes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  new.created_at := now();
  new.signed_at := now();
  if v_uid is not null then
    new.signed_by := v_uid;
    new.printed_name := coalesce(
      (select p.full_name from public.profiles p where p.id = v_uid),
      new.printed_name
    );
    new.signed_by_name := new.printed_name;
  end if;
  return new;
end;
$$;

drop trigger if exists house_card_closes_guard on public.house_card_month_closes;
create trigger house_card_closes_guard
before insert on public.house_card_month_closes
for each row execute function private.house_card_closes_guard();

revoke all on public.house_card_entries from anon, authenticated;
grant select, insert, update on public.house_card_entries to authenticated;
revoke all on public.house_card_month_closes from anon, authenticated;
grant select, insert on public.house_card_month_closes to authenticated;

commit;
