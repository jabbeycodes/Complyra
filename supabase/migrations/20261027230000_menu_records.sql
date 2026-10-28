-- Menu records: what each Individual actually ate, recorded by the staff
-- supporting them. One row per food entry: service date, meal slot
-- (breakfast / lunch / dinner / snack), the food eaten, how much was eaten
-- (all / most / some / none — a text label, never color alone), and an
-- optional note. The record lives on the Individual's chart (Individuals tab
-- → Menu section) and the week view there prints/downloads as a PDF.
--
-- This is a CONSUMPTION record (what was served and eaten). It sits next to
-- the health intake trackers (meals/fluids amounts charted clinically) — the
-- two are deliberately not merged.
--
-- Security model mirrors the shift-note family after the Phase 0 scoping
-- (20260925120000) and the corrections rule (20260925140000):
-- - Reads and writes scope through private.can_read_individual: site for
--   managers, the DSP site rule for direct support staff, agency-wide for
--   auditors (auditors see everything, edit nothing — the write policies
--   below exclude the auditor role by construction).
-- - NO new permission key is introduced, so the program_manager template
--   trap (20260916060000 wholesale-replacing the PM matrix after the seed)
--   does not apply: access rides on the pre-existing 'individuals.view'
--   key inside can_read_individual, provisioned per agency by
--   public.provision_agency_roles().
-- - The author is stamped by trigger from auth.uid(); a client cannot
--   record under another person's name. Identity columns (agency,
--   Individual, author, created_at) are frozen on update.
-- - Corrections never erase the original: the author may correct their own
--   entry at any time; house managers / program managers / administrators
--   may correct any entry in their scope. Every edit first copies the
--   previous version into menu_entry_history.
-- - Removal is a VOID, not a delete: voiding (same edit gate) stamps
--   deleted_at + voided_by + void_reason through an update, so the voided
--   entry and its reason stay on the record. A hard-delete policy remains
--   only as an administrator backstop; the app never calls it.

begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.menu_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  individual_id uuid not null references public.individuals (id) on delete cascade,
  entry_date date not null,
  meal_slot text not null
    check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_text text not null check (length(btrim(food_text)) > 0),
  amount_eaten text not null
    check (amount_eaten in ('all', 'most', 'some', 'none')),
  note text not null default '',
  recorded_by uuid not null references public.profiles (id) on delete cascade,
  recorded_by_name text not null default '',
  recorded_by_role text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  voided_by uuid references public.profiles (id) on delete set null,
  void_reason text not null default '',
  unique (id, agency_id)
);

create index menu_entries_individual_date_idx
  on public.menu_entries (agency_id, individual_id, entry_date)
  where deleted_at is null;

-- Previous versions of a menu entry, written by trigger only.
create table public.menu_entry_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.menu_entries (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  entry_date date not null,
  meal_slot text not null,
  food_text text not null,
  amount_eaten text not null,
  note text not null default '',
  deleted_at timestamptz,
  version_saved_at timestamptz not null,
  replaced_by uuid,
  replaced_at timestamptz not null default now()
);

create index menu_entry_history_entry_idx
  on public.menu_entry_history (entry_id, replaced_at);

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------

alter table public.menu_entries enable row level security;
alter table public.menu_entries force row level security;
alter table public.menu_entry_history enable row level security;
alter table public.menu_entry_history force row level security;

-- Read: anyone who can read the Individual (site-scoped; auditors included).
create policy menu_entries_select on public.menu_entries
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

-- Write: the staff roles that document daily care. Auditors and
-- compliance-only roles are excluded here even though they can read.
create policy menu_entries_insert on public.menu_entries
for insert to authenticated
with check (
  recorded_by = (select auth.uid())
  and (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,house_manager,nurse,dsp}'))
);

-- Correct / void: the author, or a manager-tier role in scope.
create policy menu_entries_update on public.menu_entries
for update to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    recorded_by = (select auth.uid())
    or (select private.role_key_in(
      agency_id, '{administrator,program_manager,house_manager}'))
  )
)
with check (
  (select private.can_read_individual(agency_id, individual_id))
  and (
    recorded_by = (select auth.uid())
    or (select private.role_key_in(
      agency_id, '{administrator,program_manager,house_manager}'))
  )
);

-- Hard delete backstop only (the app voids through update instead).
create policy menu_entries_delete on public.menu_entries
for delete to authenticated
using (
  (select private.can_read_individual(agency_id, individual_id))
  and (select private.role_key_in(
    agency_id, '{administrator,program_manager,compliance_admin}'))
);

create policy menu_entry_history_select on public.menu_entry_history
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

-- ----------------------------------------------------------------------------
-- Identity guard: stamp the author on insert; freeze identity on update.
-- ----------------------------------------------------------------------------

create or replace function private.menu_entries_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
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
    end if;
    -- The entry's home is the Individual's home, never a client-supplied one.
    new.site_id := coalesce(
      (select i.site_id from public.individuals i
        where i.id = new.individual_id and i.agency_id = new.agency_id),
      new.site_id
    );
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.site_id is distinct from old.site_id
     or new.individual_id is distinct from old.individual_id
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_by_name is distinct from old.recorded_by_name
     or new.recorded_by_role is distinct from old.recorded_by_role
     or new.created_at is distinct from old.created_at then
    raise exception 'A menu entry''s Individual and author cannot be changed.'
      using errcode = 'P0001';
  end if;

  -- A void stamps who voided it (the reason rides on the row itself).
  if new.deleted_at is not null and old.deleted_at is null then
    new.voided_by := v_uid;
  end if;
  return new;
end;
$$;

drop trigger if exists menu_entries_identity_guard on public.menu_entries;
create trigger menu_entries_identity_guard
before insert or update on public.menu_entries
for each row execute function private.menu_entries_identity_guard();

-- ----------------------------------------------------------------------------
-- History: every correction keeps the previous version.
-- ----------------------------------------------------------------------------

create or replace function private.menu_entries_keep_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.entry_date, new.meal_slot, new.food_text, new.amount_eaten,
      new.note, new.deleted_at)
     is distinct from
     (old.entry_date, old.meal_slot, old.food_text, old.amount_eaten,
      old.note, old.deleted_at) then
    insert into public.menu_entry_history (
      entry_id, agency_id, individual_id, entry_date, meal_slot, food_text,
      amount_eaten, note, deleted_at, version_saved_at, replaced_by
    ) values (
      old.id, old.agency_id, old.individual_id, old.entry_date, old.meal_slot,
      old.food_text, old.amount_eaten, old.note, old.deleted_at,
      old.updated_at, auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists menu_entries_keep_history on public.menu_entries;
create trigger menu_entries_keep_history
after update on public.menu_entries
for each row execute function private.menu_entries_keep_history();

revoke all on public.menu_entries from anon, authenticated;
grant select, insert, update, delete on public.menu_entries to authenticated;
revoke all on public.menu_entry_history from anon, authenticated;
grant select on public.menu_entry_history to authenticated;

commit;
