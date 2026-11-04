-- Migration 20261031190000: money integrity, simulation fix wave 3.
--
-- Agency-simulation findings (batches 7 and 9) that the API-layer fixes
-- in this wave must also hold in the database, so no client path can
-- bypass them:
--
--   1. Personal Spending (batch 7): a $55 spend against a $40 balance
--      went through and the month then CLOSED at -$15.00. Now:
--      - the entries guard refuses a SPEND that would take the
--        person's balance below $0 (the entry a replacement corrects
--        counts as already voided, so void-and-replace still works);
--      - the closes guard IGNORES the caller-supplied closing balance,
--        computes it from the ledger through month end, and refuses
--        the close while it is below $0.
--      Service-role writes (auth.uid() null — seeds, imports) are not
--      live spends and keep their freedom, matching the other guards.
--
--   2. House Card (batch 9): a DSP could void ANY ledger entry,
--      including the administrator's. The entries guard now refuses a
--      void of another staff member's entry unless the caller holds a
--      manager role (administrator / program_manager / house_manager —
--      the same roles that can close the month). A recorder may still
--      void their OWN entry: that is the quick-entry Undo and
--      self-correction path.
--
-- Forward-only: this file REPLACES three guard functions in full
-- (copied from 20261029130000_house_card.sql and
-- 20261029130100_personal_spending.sql with only the additions above);
-- no merged migration is edited.

begin;

-- ----------------------------------------------------------------------------
-- 1a. Personal spending entries: no spend below a $0 balance.
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
    -- Batch 7: a spend may not take the person's balance below $0. The
    -- entry being replaced counts as already voided, so correcting a
    -- spend never double-counts it. Deposits are never refused here,
    -- and service-role writes (v_uid null) are not live spends. The
    -- check runs only when the caller can read the site: triggers fire
    -- before RLS, and an out-of-scope insert must surface its 42501,
    -- not a balance refusal computed from a ledger they cannot see.
    if v_uid is not null and new.kind = 'spend'
       and private.can_read_site(new.agency_id, new.site_id) then
      if (select coalesce(sum(
                   case when e.kind = 'deposit' then e.amount_cents
                        else -e.amount_cents end), 0)
            from public.personal_spending_entries e
           where e.individual_id = new.individual_id
             and e.voided_at is null
             and e.id is distinct from new.replaces_entry_id)
         - new.amount_cents < 0 then
        raise exception 'That spend would take the Individual''s balance below $0.'
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

-- ----------------------------------------------------------------------------
-- 1b. Personal spending closes: the balance is computed here, and a
--     month never closes below $0.
-- ----------------------------------------------------------------------------

create or replace function private.personal_spending_closes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance bigint;
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
  -- Batch 7: the closing balance is computed from the ledger through
  -- month end — the caller's figure is never trusted — and a month
  -- cannot be signed closed while the balance is below $0.
  select coalesce(sum(
           case when e.kind = 'deposit' then e.amount_cents
                else -e.amount_cents end), 0)
    into v_balance
    from public.personal_spending_entries e
   where e.individual_id = new.individual_id
     and e.voided_at is null
     and e.entry_date <= ((new.month || '-01')::date
                          + interval '1 month' - interval '1 day')::date;
  new.closing_balance_cents := v_balance;
  if v_balance < 0 then
    raise exception 'This month cannot be closed while the balance is below $0.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. House card entries: voiding another person's entry is a manager
--    action; voiding your own stays open (Undo / self-correction).
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
    -- Batch 9: voiding is a manager action. A manager (the same roles
    -- that can close the month) may void any entry; a recorder may
    -- void only their OWN entry — never another staff member's.
    if v_uid is not null
       and old.recorded_by is distinct from v_uid
       and not private.role_key_in(
             new.agency_id,
             array['administrator', 'program_manager', 'house_manager']
           ) then
      raise exception 'Only a manager can void another staff member''s entry.'
        using errcode = 'P0001';
    end if;
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

commit;
