-- Money integrity hardening for the two ledgers (review follow-up to
-- PR #150 House Card and PR #152 Personal Spending).
--
-- The original migrations (20261029130000 / 20261029130100) left four
-- database-level gaps that the application layer happens to avoid but a
-- direct database writer could exploit:
--
-- 1. Closed-month correction bypass (both ledgers). The entry guards
--    let a replacement entry land in a closed month whenever the entry
--    it named in replaces_entry_id was dated in that same month — with
--    no check that the named entry belongs to the same home (house
--    card) or the same Individual (personal spending), or even the
--    same agency. A closer could therefore write into a signed month
--    by "correcting" another home's / another person's entry, and an
--    entry could be replaced more than once, forking the ledger.
--    Fixed below: a replacement link must name an entry in the SAME
--    agency and home (and, for personal spending, the same
--    Individual), and an entry can be replaced at most once — enforced
--    on the insert side (the named entry is not already replaced and
--    no other entry already replaces it) and on the update side (the
--    replaced_by link may only name the entry that actually replaced
--    this one).
--
-- 2. Client-controlled closing balances (both ledgers). The close
--    guards stamped the signer but stored closing_balance_cents
--    exactly as supplied, so a signed statement could state any figure
--    regardless of the ledger. Fixed below: the close guards COMPUTE
--    the balance from the ledger (non-voided entries dated through
--    month end, the same math both API layers use) and overwrite the
--    supplied value. Overwriting — rather than rejecting a mismatch —
--    keeps every legitimate close working unchanged (both APIs already
--    send exactly this figure) while making the stored snapshot true
--    by construction; a mismatch can then only mean a forged or stale
--    client, and the ledger wins either way.
--
-- 3. Personal spending site integrity. An entry (or close) pairs an
--    Individual with a site through two independent foreign keys, so a
--    row could attribute a person's money to a home they do not live
--    in, corrupting the denormalized site used for scope and print.
--    Fixed below: the guards require site_id to be the Individual's
--    own current home on insert, for entries and closes alike.
--
-- Forward-only: this file replaces the four guard functions in place;
-- no merged migration is edited and no table shape changes. The
-- second-staff attestation flow is untouched by design (a separate
-- founder decision).

begin;

-- ----------------------------------------------------------------------------
-- House Card entry guard: validate the correction link.
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
  v_orig_agency uuid;
  v_orig_site uuid;
  v_orig_replaced_by uuid;
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
    -- A replacement link must name a real correction target in the
    -- SAME agency and the SAME home, and an entry may be replaced at
    -- most once. (The app's void-and-replace flow always satisfies
    -- this: the replacement is inserted against the live original at
    -- its own home, then the void links back to it.)
    if new.replaces_entry_id is not null then
      select e.agency_id, e.site_id, e.replaced_by_entry_id,
             to_char(e.entry_date, 'YYYY-MM')
        into v_orig_agency, v_orig_site, v_orig_replaced_by,
             v_original_month
        from public.house_card_entries e
       where e.id = new.replaces_entry_id;
      if not found then
        raise exception 'The entry this correction replaces could not be found.'
          using errcode = 'P0001';
      end if;
      if v_orig_agency is distinct from new.agency_id
         or v_orig_site is distinct from new.site_id then
        raise exception 'A correction must replace an entry from the same home.'
          using errcode = 'P0001';
      end if;
      if v_orig_replaced_by is not null
         or exists (
           select 1 from public.house_card_entries x
            where x.replaces_entry_id = new.replaces_entry_id
         ) then
        raise exception 'That entry has already been replaced; correct the replacement entry instead.'
          using errcode = 'P0001';
      end if;
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

  -- The replacement link may only name the entry that actually
  -- replaced this one: same agency, same home, and its own
  -- replaces_entry_id pointing back at this row.
  if new.replaced_by_entry_id is distinct from old.replaced_by_entry_id
     and new.replaced_by_entry_id is not null then
    if not exists (
      select 1 from public.house_card_entries x
       where x.id = new.replaced_by_entry_id
         and x.replaces_entry_id = old.id
         and x.agency_id = old.agency_id
         and x.site_id = old.site_id
    ) then
      raise exception 'The replacement link must name the entry that replaced this one.'
        using errcode = 'P0001';
    end if;
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

-- ----------------------------------------------------------------------------
-- House Card close guard: the signed balance is computed, never supplied.
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
  -- The closing balance is the ledger's own figure: every non-voided
  -- entry dated through the end of the signed month, credits and
  -- refunds adding, purchases subtracting — the same math the app
  -- derives (balanceThroughCents). Whatever the caller supplied is
  -- replaced, so a signed statement always equals the ledger.
  new.closing_balance_cents := (
    select coalesce(sum(
             case when e.kind = 'purchase'
                  then -e.amount_cents else e.amount_cents end), 0)
      from public.house_card_entries e
     where e.agency_id = new.agency_id
       and e.site_id = new.site_id
       and e.voided_at is null
       and e.entry_date < ((new.month || '-01')::date
                           + interval '1 month')::date
  );
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Personal Spending entry guard: site integrity + correction link.
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
  v_orig_agency uuid;
  v_orig_site uuid;
  v_orig_individual uuid;
  v_orig_replaced_by uuid;
  v_person_site uuid;
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
    -- Site integrity: an entry lives where its Individual lives. The
    -- composite foreign keys only tie each column to the agency, so
    -- the guard pins site_id to the Individual's own current home.
    -- (A missing or cross-agency Individual falls to the foreign key.)
    select i.site_id into v_person_site
      from public.individuals i
     where i.id = new.individual_id and i.agency_id = new.agency_id;
    if v_person_site is not null
       and new.site_id is distinct from v_person_site then
      raise exception 'A personal spending entry must be recorded at the home where the Individual lives.'
        using errcode = 'P0001';
    end if;
    -- A replacement link must name a real correction target in the
    -- SAME agency, at the SAME home, in the SAME Individual's ledger,
    -- and an entry may be replaced at most once.
    if new.replaces_entry_id is not null then
      select e.agency_id, e.site_id, e.individual_id,
             e.replaced_by_entry_id, to_char(e.entry_date, 'YYYY-MM')
        into v_orig_agency, v_orig_site, v_orig_individual,
             v_orig_replaced_by, v_original_month
        from public.personal_spending_entries e
       where e.id = new.replaces_entry_id;
      if not found then
        raise exception 'The entry this correction replaces could not be found.'
          using errcode = 'P0001';
      end if;
      if v_orig_agency is distinct from new.agency_id
         or v_orig_site is distinct from new.site_id
         or v_orig_individual is distinct from new.individual_id then
        raise exception 'A correction must replace an entry belonging to the same Individual.'
          using errcode = 'P0001';
      end if;
      if v_orig_replaced_by is not null
         or exists (
           select 1 from public.personal_spending_entries x
            where x.replaces_entry_id = new.replaces_entry_id
         ) then
        raise exception 'That entry has already been replaced; correct the replacement entry instead.'
          using errcode = 'P0001';
      end if;
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

  -- The replacement link may only name the entry that actually
  -- replaced this one: same agency, same home, same Individual, and
  -- its own replaces_entry_id pointing back at this row.
  if new.replaced_by_entry_id is distinct from old.replaced_by_entry_id
     and new.replaced_by_entry_id is not null then
    if not exists (
      select 1 from public.personal_spending_entries x
       where x.id = new.replaced_by_entry_id
         and x.replaces_entry_id = old.id
         and x.agency_id = old.agency_id
         and x.site_id = old.site_id
         and x.individual_id = old.individual_id
    ) then
      raise exception 'The replacement link must name the entry that replaced this one.'
        using errcode = 'P0001';
    end if;
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
-- Personal Spending close guard: site integrity + computed balance.
-- The dual sign-off rules below the balance are unchanged.
-- ----------------------------------------------------------------------------

create or replace function private.personal_spending_closes_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_person_site uuid;
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
  -- Site integrity, as on the entries: the close is recorded at the
  -- home where the Individual lives.
  select i.site_id into v_person_site
    from public.individuals i
   where i.id = new.individual_id and i.agency_id = new.agency_id;
  if v_person_site is not null
     and new.site_id is distinct from v_person_site then
    raise exception 'A personal spending month close must be recorded at the home where the Individual lives.'
      using errcode = 'P0001';
  end if;
  -- The closing balance is the ledger's own figure: every non-voided
  -- entry dated through the end of the signed month, deposits adding,
  -- spends subtracting (the balance carries across months). Whatever
  -- the caller supplied is replaced, so a signed statement always
  -- equals the ledger.
  new.closing_balance_cents := (
    select coalesce(sum(
             case when e.kind = 'spend'
                  then -e.amount_cents else e.amount_cents end), 0)
      from public.personal_spending_entries e
     where e.agency_id = new.agency_id
       and e.individual_id = new.individual_id
       and e.voided_at is null
       and e.entry_date < ((new.month || '-01')::date
                           + interval '1 month')::date
  );
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

commit;
