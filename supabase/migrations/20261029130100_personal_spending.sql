-- Personal Spending: one Individual's own money, tracked on their chart.
--
-- Every Individual in care has personal funds: money that arrives for
-- them and money spent on their behalf or with them. One append-only
-- entry per money movement (spend / deposit). A spend always carries a
-- PURPOSE — what the person's money was used for is the audit control.
-- A deposit names its source in location. Money is integer cents. The
-- balance is derived from the entries and carries across months — it is
-- never stored as an editable number.
--
-- This ledger is SEPARATE from the house card (20261029130000): the
-- home's petty cash lives in house_card_entries; a person's own money
-- lives here. No row ever crosses between them.
--
-- Corrections never erase: a wrong entry is voided with a reason
-- through an update, and its replacement (when the money still moved)
-- is a new entry linked to the voided one. Voided rows stay visible and
-- never count. There is NO delete path — no policy, no grant.
--
-- A month close carries TWO sign-offs: the closing manager's
-- attestation (printed name = their account name, typed signature,
-- server timestamp, closing-balance snapshot) AND the Individual's own
-- sign-off state — either the Individual signed, or the Individual was
-- unable to sign and a second staff member signed in their place (that
-- member is named on the close, with their typed signature). A database
-- trigger refuses NEW entries dated into a closed month; void/replace
-- corrections into the same closed month stay possible and are marked
-- post-close corrections by the app.
--
-- Security model mirrors the menu-records / house-card family:
-- - Reads and writes scope through private.can_read_individual (site
--   for managers and assigned DSPs, agency-wide for PM/administrator/
--   auditor) AND the reader/recorder role lists below. Nurses and HR
--   are excluded by construction.
-- - Writes require a recorder role (administrator, program_manager,
--   house_manager, dsp); closes require a closer role (administrator,
--   program_manager, house_manager).
-- - NO new permission key is introduced, so the program_manager
--   template trap (20260916060000 wholesale-replacing the PM matrix
--   after the seed) does not apply: access rides on role keys and the
--   pre-existing 'individuals.view' key inside can_read_individual.
-- - The author is stamped by trigger from auth.uid(); identity columns
--   (agency, site, Individual, author, created_at) are frozen on
--   update, and the only update a live row accepts is the void
--   transition plus its replacement link. A voided row is immutable.

begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.personal_spending_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('spend', 'deposit')),
  location text not null default '',
  purpose text not null default '',
  amount_cents integer not null check (amount_cents > 0),
  note text not null default '',
  receipt_photo jsonb,
  recorded_by uuid not null references public.profiles (id) on delete cascade,
  recorded_by_name text not null default '',
  recorded_by_role text not null default '',
  created_at timestamptz not null default now(),
  voided_by uuid references public.profiles (id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  replaces_entry_id uuid references public.personal_spending_entries (id) on delete cascade,
  replaced_by_entry_id uuid references public.personal_spending_entries (id) on delete cascade,
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  -- Purpose shape: a spend always says what the money was for; a
  -- deposit's purpose stays blank (its source is the location).
  constraint personal_spending_entries_purpose_shape check (
    (kind = 'spend' and length(btrim(purpose)) > 0)
    or (kind = 'deposit' and purpose = '')
  ),
  -- A void is all-or-nothing: stamp, voider, and reason land together.
  constraint personal_spending_entries_void_shape check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null
        and length(btrim(coalesce(void_reason, ''))) > 0)
  )
);

create index personal_spending_entries_person_date_idx
  on public.personal_spending_entries (agency_id, individual_id, entry_date);

create table public.personal_spending_month_closes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  closing_balance_cents integer not null,
  printed_name text not null,
  signature_text text not null check (length(btrim(signature_text)) > 0),
  signed_by uuid not null references public.profiles (id) on delete cascade,
  signed_by_name text not null default '',
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  individual_signoff text not null
    check (individual_signoff in ('individual_signed', 'unable_second_staff')),
  second_staff_id uuid references public.profiles (id) on delete set null,
  second_staff_name text,
  second_staff_signature text,
  unique (id, agency_id),
  unique (individual_id, month),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade,
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  -- The dual sign-off is all-or-nothing: the unable case names the
  -- second staff member and carries their signature; the signed case
  -- carries neither.
  constraint personal_spending_closes_signoff_shape check (
    (individual_signoff = 'individual_signed'
      and second_staff_id is null
      and second_staff_name is null
      and second_staff_signature is null)
    or (individual_signoff = 'unable_second_staff'
        and second_staff_id is not null
        and length(btrim(coalesce(second_staff_name, ''))) > 0
        and length(btrim(coalesce(second_staff_signature, ''))) > 0)
  )
);

create index personal_spending_closes_person_idx
  on public.personal_spending_month_closes (agency_id, individual_id, month);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.personal_spending_entries enable row level security;
alter table public.personal_spending_entries force row level security;
alter table public.personal_spending_month_closes enable row level security;
alter table public.personal_spending_month_closes force row level security;

-- Read: a reader role who can read the Individual. Auditors and
-- compliance administrators read; nurses and HR never do.
create policy personal_spending_entries_select on public.personal_spending_entries
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,house_manager,dsp,auditor}'))
);

-- Record: the staff who support the person day to day, in their
-- Individual scope (site-bound for house managers, assignment-bound
-- for DSPs, agency-wide for program managers and administrators).
create policy personal_spending_entries_insert on public.personal_spending_entries
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
);

-- Void / link a replacement: same recorder gate. The identity guard
-- trigger below restricts what such an update may actually change.
create policy personal_spending_entries_update on public.personal_spending_entries
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,dsp}'))
);

-- No delete policy: the ledger is append-only, for every role.

create policy personal_spending_closes_select on public.personal_spending_month_closes
for select to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id,
    '{administrator,compliance_admin,program_manager,house_manager,dsp,auditor}'))
);

create policy personal_spending_closes_insert on public.personal_spending_month_closes
for insert to authenticated
with check (
  signed_by = (select auth.uid())
  and (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager}'))
);

-- No update or delete policy on closes: a signed month is final.

-- The audit access boundaries (20260915023000) as a restrictive policy,
-- the way the house-card tables carry them: an active membership in
-- the row's agency on top of every permissive policy above.
create policy personal_spending_entries_audit_membership
  on public.personal_spending_entries
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

create policy personal_spending_closes_audit_membership
  on public.personal_spending_month_closes
as restrictive for all to authenticated
using ((select private.has_agency(agency_id)))
with check ((select private.has_agency(agency_id)));

-- ----------------------------------------------------------------------------
-- Entry guard: stamp the author, freeze identity, keep voids final, and
-- refuse new entries dated into a signed-closed month.
-- ----------------------------------------------------------------------------

create or replace function private.personal_spending_entries_guard()
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
      select 1 from public.personal_spending_month_closes c
      where c.individual_id = new.individual_id and c.month = v_month
    ) then
      if new.replaces_entry_id is null then
        raise exception 'This month is closed and signed; new entries cannot be added to it.'
          using errcode = 'P0001';
      end if;
      select to_char(e.entry_date, 'YYYY-MM') into v_original_month
        from public.personal_spending_entries e where e.id = new.replaces_entry_id;
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
    raise exception 'A voided personal spending entry cannot be changed.'
      using errcode = 'P0001';
  end if;

  -- On a live row the ONLY permitted change is the void transition
  -- (voided_at / voided_by / void_reason) and the replacement link.
  if new.agency_id is distinct from old.agency_id
     or new.site_id is distinct from old.site_id
     or new.individual_id is distinct from old.individual_id
     or new.entry_date is distinct from old.entry_date
     or new.kind is distinct from old.kind
     or new.location is distinct from old.location
     or new.purpose is distinct from old.purpose
     or new.amount_cents is distinct from old.amount_cents
     or new.note is distinct from old.note
     or new.receipt_photo is distinct from old.receipt_photo
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_name is distinct from old.recorded_by_name
     or new.recorded_by_role is distinct from old.recorded_by_role
     or new.created_at is distinct from old.created_at
     or new.replaces_entry_id is distinct from old.replaces_entry_id then
    raise exception 'A personal spending entry cannot be edited; void it and record a replacement.'
      using errcode = 'P0001';
  end if;

  if new.voided_at is not null then
    -- The void transition: a reason is mandatory and the stamp is ours.
    if length(btrim(coalesce(new.void_reason, ''))) = 0 then
      raise exception 'A reason is required to void a personal spending entry.'
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

drop trigger if exists personal_spending_entries_guard on public.personal_spending_entries;
create trigger personal_spending_entries_guard
before insert or update on public.personal_spending_entries
for each row execute function private.personal_spending_entries_guard();

-- ----------------------------------------------------------------------------
-- Close guard: the sign-offs name real people, from their own accounts.
-- ----------------------------------------------------------------------------

create or replace function private.personal_spending_closes_guard()
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
  if new.individual_signoff = 'unable_second_staff' then
    -- The second signer is whoever the close names; their printed name
    -- comes from their own profile, and they can never be the closer.
    if new.second_staff_id = new.signed_by then
      raise exception 'The second staff member must be someone other than the manager closing the month.'
        using errcode = 'P0001';
    end if;
    new.second_staff_name := coalesce(
      (select p.full_name from public.profiles p where p.id = new.second_staff_id),
      new.second_staff_name
    );
  end if;
  return new;
end;
$$;

drop trigger if exists personal_spending_closes_guard on public.personal_spending_month_closes;
create trigger personal_spending_closes_guard
before insert on public.personal_spending_month_closes
for each row execute function private.personal_spending_closes_guard();

revoke all on public.personal_spending_entries from anon, authenticated;
grant select, insert, update on public.personal_spending_entries to authenticated;
revoke all on public.personal_spending_month_closes from anon, authenticated;
grant select, insert on public.personal_spending_month_closes to authenticated;

commit;
