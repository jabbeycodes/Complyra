-- Personal Spending: signed months follow the caller's role (founder
-- decision, 2026-11-04: managers can record and void on closed months).
--
-- On a signed month:
--   * administrator, program manager, house manager (the closers,
--     PERSONAL_SPENDING_CLOSER_ROLE_KEYS): record new entries and void any
--     entry, as they can on an open month. The app marks what they write as
--     a post-close correction, since the signed statement predates it.
--   * everyone else: no new entry, no replacement, no void, their own
--     entries included. Reads are unchanged.
-- Open months are unchanged. The balance floor, site pinning, replacement
-- link checks, and void shape all still apply on a signed month.
--
-- Triggers fire before row security, so a manager outside their scope now
-- passes the closed-month check and is refused by row security (42501).
--
-- The trigger is unchanged; it already points at this function by name.

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
  v_manager boolean := v_uid is not null and private.role_key_in(
    new.agency_id,
    array['administrator', 'program_manager', 'house_manager']
  );
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
    -- A closed month takes entries from managers only (founder decision
    -- 2026-11-04). Everyone else is refused, for a new entry and for a
    -- replacement alike, and a replacement also may not correct an entry
    -- dated in a closed month, wherever the replacement itself is dated:
    -- that is a void of the closed-month entry by another route.
    if v_uid is not null then
      if not v_manager and exists (
        select 1 from public.personal_spending_month_closes c
         where c.individual_id = new.individual_id
           and c.month in (v_month, v_original_month)
      ) then
        raise exception 'This month is closed and signed; only a manager can add entries to it.'
          using errcode = 'P0001';
      end if;
    -- Service-role writes (no signed-in caller) keep the earlier rule: no
    -- new entries, and a correction stays inside the month it corrects.
    elsif exists (
      select 1 from public.personal_spending_month_closes c
      where c.individual_id = new.individual_id and c.month = v_month
    ) then
      if new.replaces_entry_id is null
         or v_original_month is distinct from v_month then
        raise exception 'This month is closed and signed; new entries cannot be added to it.'
          using errcode = 'P0001';
      end if;
    end if;
    -- Batch 7 (PR #201): a spend may not take the person's balance below $0. The
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

  -- A closed month is read-only for everyone but managers: no void and no
  -- replacement link, on any entry, their own included. Service-role
  -- writes (no signed-in caller) are not gated here.
  if v_uid is not null and not v_manager and exists (
    select 1 from public.personal_spending_month_closes c
     where c.individual_id = old.individual_id
       and c.month = to_char(old.entry_date, 'YYYY-MM')
  ) then
    raise exception 'This month is closed and signed; only a manager can void its entries.'
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
    -- PR #252 review: voiding another staff member's entry is a manager
    -- action (the closers); a recorder may void only their OWN entry. The
    -- same rule as the House Card and as canVoidPersonalSpendingEntry.
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
