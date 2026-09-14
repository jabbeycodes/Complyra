-- Complyrer Phase 1, Workstream 1: notification engine.
--
-- The `notifications` table backs the real notification bell. Rows are
-- produced server-side by edge functions (the `notify-event` function slug)
-- and by scheduled/event triggers; the client only reads its own rows.
--
-- Conventions follow the foundation migration: RLS enabled + forced,
-- agency-scoped rows, and the private.has_agency()/private.has_permission()
-- helper style for policies.
--
-- Delivery rule: a row is visible to a member when it is either addressed to
-- them directly (user_id = auth.uid()) or broadcast to a role they hold
-- (role_key matches an active membership role_key). Members only ever see
-- notifications for agencies they belong to (agency-scoped).
--
-- Inserts come from edge functions using the service role key (service_role
-- bypasses RLS), so no authenticated insert policy is granted.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid null references public.profiles (id) on delete cascade,
  role_key text null,
  type text not null,
  title text not null,
  body text not null,
  deep_link text not null,
  entity_type text null,
  entity_id text null,
  dedupe_key text null,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint notifications_target_check
    check (user_id is not null or role_key is not null)
);

-- Every statement below is defensive (`if not exists`, `drop ... if exists`)
-- so the migration is re-runnable.

alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- Read: an agency member sees notifications addressed to them directly or
-- broadcast to a role they hold (active membership only).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (
  (select private.has_agency(notifications.agency_id))
  and (
    notifications.user_id = auth.uid()
    or (
      notifications.role_key is not null
      and exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.agency_id = notifications.agency_id
          and (m.expires_on is null or m.expires_on >= current_date)
          and coalesce(m.role_key, m.role::text) = notifications.role_key
      )
    )
  )
);

-- Update: a member may only mark their own notifications read (read_at), via
-- their targeted rows. Role broadcasts visible to multiple staff are marked
-- per-reader via the notification_reads side table (see below), so `read_at`
-- here only ever applies to user-targeted rows.
drop policy if exists notifications_update_read on public.notifications;
create policy notifications_update_read on public.notifications
for update to authenticated
using (
  notifications.user_id = auth.uid()
  and (select private.has_agency(notifications.agency_id))
)
with check (
  notifications.user_id = auth.uid()
  and (select private.has_agency(notifications.agency_id))
);

-- Per-reader read state for role broadcasts: one row per (notification, user).
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;

drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads
for select to authenticated
using (notification_reads.user_id = auth.uid());

drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads
for insert to authenticated
with check (
  notification_reads.user_id = auth.uid()
  and exists (
    select 1
    from public.notifications n
    where n.id = notification_reads.notification_id
      and (select private.has_agency(n.agency_id))
      and (
        n.user_id = auth.uid()
        or (
          n.role_key is not null
          and exists (
            select 1
            from public.memberships m
            where m.user_id = auth.uid()
              and m.agency_id = n.agency_id
              and (m.expires_on is null or m.expires_on >= current_date)
              and coalesce(m.role_key, m.role::text) = n.role_key
          )
        )
      )
  )
);

drop policy if exists notification_reads_delete on public.notification_reads;
create policy notification_reads_delete on public.notification_reads
for delete to authenticated
using (notification_reads.user_id = auth.uid());

-- One event, one notification: dedupe_key (e.g. 'checklist.late:<id>')
-- prevents duplicate rows for the same event. Partial unique index keeps
-- NULL dedupe_keys unconstrained.
create unique index if not exists notifications_dedupe_key_unique
  on public.notifications (agency_id, dedupe_key)
  where dedupe_key is not null;

-- Read path indexes: unread listing per recipient and per role, newest first.
create index if not exists notifications_recipient_recent_idx
  on public.notifications (agency_id, user_id, read_at, created_at desc);
create index if not exists notifications_role_recent_idx
  on public.notifications (agency_id, role_key, created_at desc)
  where role_key is not null;
create index if not exists notifications_type_idx
  on public.notifications (agency_id, type);

-- Housekeeping helper for edge functions: prune notifications older than the
-- given number of days for an agency (compliance tooling reads do not need
-- per-row deletes, so members get no delete policy).
create or replace function public.prune_notifications(p_agency_id uuid, p_older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_older_than_days < 30 then
    raise exception 'prune window must be at least 30 days';
  end if;
  if not private.has_agency(p_agency_id) then
    raise exception 'not a member of agency %', p_agency_id;
  end if;
  delete from public.notifications
  where agency_id = p_agency_id
    and created_at < now() - (p_older_than_days || ' days')::interval;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
