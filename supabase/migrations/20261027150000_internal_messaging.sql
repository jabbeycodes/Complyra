-- Internal staff messaging — INTENTIONALLY UNAPPLIED.
--
-- Staff-to-staff conversations for operational roles (administrator,
-- compliance_admin, program_manager, house_manager, nurse, dsp, hr).
-- AUDITORS ARE EXCLUDED BY DESIGN: messaging is staff communication, not a
-- compliance record surface. The exclusion is enforced three ways — the
-- `messages.use` permission is not in the auditor template, the
-- private.can_use_messaging() helper below refuses the auditor role even
-- if a role map is misconfigured, and the app layer mirrors both checks.
--
-- Hardening (following the fixed PR #117 / PR #119 patterns):
--   * RLS enabled AND forced on all three tables.
--   * Per-command policies only — there is NO `for all` write policy.
--   * Reads are scoped to thread participants via a security-definer
--     membership helper (private.is_thread_participant).
--   * Messages are append-only: no UPDATE or DELETE policy exists, and no
--     UPDATE/DELETE grant is issued, so a sent message can never be edited
--     or erased through the API.
--   * Authorship is bound to auth.uid() in the INSERT policy
--     (sender_id = auth.uid(), kind pinned to 'user'); system notes are
--     written only by the security-definer trigger below.
--   * Participant rows may be created only by the thread creator (seeding
--     a new thread) or by an existing participant (adding to a live
--     thread), and only for agency staff whose role can use messaging.
--   * A participant row UPDATE may touch only that user's own read/hide
--     state; a trigger freezes every other column.
begin;

-- ── Helpers ──────────────────────────────────────────────────────────────

-- The messaging gate: active agency membership + the `messages.use`
-- permission for the caller's role + NOT the auditor role.
create or replace function private.can_use_messaging(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select private.has_agency(p_agency_id))
    and (select private.has_permission(p_agency_id, 'messages.use'))
    and not (select private.role_key_in(p_agency_id, '{auditor}'));
$$;

-- ── Tables ───────────────────────────────────────────────────────────────

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  subject text not null default '' check (length(subject) <= 120),
  individual_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  foreign key (individual_id, agency_id)
    references public.individuals(id, agency_id)
);

create table public.message_participants (
  thread_id uuid not null references public.message_threads(id),
  agency_id uuid not null references public.agencies(id),
  user_id uuid not null references public.profiles(id),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  last_read_at timestamptz,
  hidden_at timestamptz,
  primary key (thread_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id),
  agency_id uuid not null references public.agencies(id),
  sender_id uuid references public.profiles(id),
  kind text not null default 'user' check (kind in ('user', 'system')),
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now(),
  -- Authorship invariant: staff messages always carry their author; only
  -- system notes (written by the trigger) have no sender.
  check ((kind = 'user' and sender_id is not null)
      or (kind = 'system' and sender_id is null))
);

create index message_participants_user_idx
  on public.message_participants (agency_id, user_id);
create index messages_thread_idx
  on public.messages (thread_id, created_at);
create index message_threads_recent_idx
  on public.message_threads (agency_id, last_message_at desc);

alter table public.message_threads enable row level security;
alter table public.message_threads force row level security;
alter table public.message_participants enable row level security;
alter table public.message_participants force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

-- Participant check that does not recurse through RLS on
-- message_participants itself (security definer reads the table directly).
-- Defined after the tables because SQL functions resolve references at
-- creation time.
create or replace function private.is_thread_participant(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_participants mp
    where mp.thread_id = p_thread_id
      and mp.user_id = auth.uid()
  );
$$;

-- Cross-table facts the policies need about a thread the caller may not be
-- able to see yet (a creator seeding a brand-new thread is not a
-- participant until the first participant row lands, so policy subqueries
-- against the RLS tables would see nothing). All security definer for the
-- same reason as is_thread_participant.
create or replace function private.thread_in_agency(p_thread_id uuid, p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.message_threads t
    where t.id = p_thread_id and t.agency_id = p_agency_id
  );
$$;

create or replace function private.thread_created_by_caller(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.message_threads t
    where t.id = p_thread_id and t.created_by = auth.uid()
  );
$$;

create or replace function private.thread_has_messages(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.messages m
    where m.thread_id = p_thread_id
  );
$$;

-- ── message_threads policies ─────────────────────────────────────────────
-- Read: participants only. Create: an eligible staff member creating their
-- own thread, optionally linked to an Individual they may read. There is
-- deliberately NO update or delete policy: thread metadata never changes
-- after creation (last_message_at moves only via the definer trigger).

create policy message_threads_select on public.message_threads
for select to authenticated
using ((select private.is_thread_participant(id)));

create policy message_threads_insert on public.message_threads
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_use_messaging(agency_id))
  and (
    individual_id is null
    or (select private.can_read_individual(agency_id, individual_id))
  )
);

-- ── message_participants policies ────────────────────────────────────────
-- Read: fellow participants of the same thread. Create: the thread creator
-- seeding a brand-new thread, or an existing participant adding to a live
-- thread; the added user must be active agency staff whose role can use
-- messaging (auditors can never be added). Update: own row only, and the
-- guard trigger freezes everything except last_read_at / hidden_at.

create policy message_participants_select on public.message_participants
for select to authenticated
using ((select private.is_thread_participant(thread_id)));

create policy message_participants_insert on public.message_participants
for insert to authenticated
with check (
  (select private.can_use_messaging(agency_id))
  and (
    (user_id = (select auth.uid()) and added_by is null)
    or added_by = (select auth.uid())
  )
  and (select private.thread_in_agency(thread_id, agency_id))
  and (
    -- Seeding: the caller created this thread and it has no messages yet.
    (
      (select private.thread_created_by_caller(thread_id))
      and not (select private.thread_has_messages(thread_id))
    )
    -- Adding: the caller already belongs to the thread.
    or (select private.is_thread_participant(thread_id))
  )
  and exists (
    select 1
    from public.memberships tm
    join public.agency_roles ar
      on ar.agency_id = tm.agency_id
     and ar.template_key = coalesce(tm.role_key, tm.role::text)
    where tm.user_id = message_participants.user_id
      and tm.agency_id = message_participants.agency_id
      and (tm.expires_on is null or tm.expires_on >= current_date)
      and coalesce(tm.role_key, tm.role::text) in (
        'administrator', 'compliance_admin', 'program_manager',
        'house_manager', 'nurse', 'dsp', 'hr'
      )
      and coalesce((ar.permissions ->> 'messages.use')::boolean, false)
  )
);

create policy message_participants_update on public.message_participants
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ── messages policies ────────────────────────────────────────────────────
-- Read: participants only. Create: the caller, as themselves, posting a
-- 'user' message into a thread they belong to. NO update or delete policy
-- exists — sent messages are immutable.

create policy messages_select on public.messages
for select to authenticated
using ((select private.is_thread_participant(thread_id)));

create policy messages_insert on public.messages
for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and kind = 'user'
  and (select private.is_thread_participant(thread_id))
  and (select private.can_use_messaging(agency_id))
  and (select private.thread_in_agency(thread_id, agency_id))
);

-- ── Triggers ─────────────────────────────────────────────────────────────

-- Participant rows: only read/hide state may ever change.
create or replace function private.guard_message_participant_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.thread_id is distinct from old.thread_id
     or new.agency_id is distinct from old.agency_id
     or new.user_id is distinct from old.user_id
     or new.added_by is distinct from old.added_by
     or new.added_at is distinct from old.added_at then
    raise exception 'Only read state can change on a conversation participant.';
  end if;
  return new;
end;
$$;

create trigger message_participants_guard_update
before update on public.message_participants
for each row execute function private.guard_message_participant_update();

-- Keep the thread's last-activity stamp moving (threads expose no UPDATE
-- policy, so this runs as definer).
create or replace function private.touch_message_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_threads
  set last_message_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$;

create trigger messages_touch_thread
after insert on public.messages
for each row execute function private.touch_message_thread();

-- Adding a participant is visible in the thread: a system note names the
-- actor and the person added, in the same wording the app composes
-- (src/data/messaging.ts systemAddedBody). Seeding inserts (thread has no
-- messages yet) write no note.
create or replace function private.note_participant_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  added_name text;
begin
  if new.added_by is null then
    return new;
  end if;
  if not exists (select 1 from public.messages where thread_id = new.thread_id) then
    return new;
  end if;
  select full_name into actor_name from public.profiles where id = new.added_by;
  select full_name into added_name from public.profiles where id = new.user_id;
  insert into public.messages (thread_id, agency_id, sender_id, kind, body)
  values (
    new.thread_id,
    new.agency_id,
    null,
    'system',
    coalesce(actor_name, 'A staff member') || ' added '
      || coalesce(added_name, 'a staff member')
      || ' to this conversation.'
  );
  return new;
end;
$$;

create trigger message_participants_note_added
after insert on public.message_participants
for each row execute function private.note_participant_added();

-- ── Grants ───────────────────────────────────────────────────────────────
-- Direct table access for the hosted API, scoped by the policies above.
-- SELECT + INSERT everywhere; UPDATE only on message_participants (own
-- read/hide state); NO delete grant on any messaging table.

revoke all on public.message_threads, public.message_participants, public.messages
  from authenticated, anon;
grant select, insert on public.message_threads to authenticated;
grant select, insert, update on public.message_participants to authenticated;
grant select, insert on public.messages to authenticated;

revoke all on function private.can_use_messaging(uuid),
  private.is_thread_participant(uuid),
  private.thread_in_agency(uuid, uuid),
  private.thread_created_by_caller(uuid),
  private.thread_has_messages(uuid) from public;
grant execute on function private.can_use_messaging(uuid),
  private.is_thread_participant(uuid),
  private.thread_in_agency(uuid, uuid),
  private.thread_created_by_caller(uuid),
  private.thread_has_messages(uuid) to authenticated;

commit;
