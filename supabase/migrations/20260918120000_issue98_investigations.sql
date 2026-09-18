-- 2026-09-18: issue #98 — Investigations: assignable follow-ups raised from
-- any site-dashboard metric.
--
-- Tables:
--   investigations        — one row per investigation; soft-delete.
--                           Stored lifecycle is open -> in_progress -> resolved
--                           ("overdue" is derived from the due date, never stored).
--   investigation_events  — status/assignment/note history for an investigation.
--
-- RLS is enabled + forced on every table. Reads are agency wide for
-- investigation managers (administrator, program_manager, house_manager);
-- everyone else sees only investigations they created or are assigned.
-- Writes are a coarse row-level backstop; field-level authorization lives in
-- the app layer (src/data/localApi.ts, src/data/hostedApi.ts), gated by the
-- investigations.manage permission (administrator / program_manager /
-- house_manager).
begin;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  source_metric text not null default 'general',
  source_record_id text,
  source_label text not null default '',
  title text not null,
  description text not null default '',
  assigned_to_user_id uuid references public.profiles (id) on delete set null,
  assigned_to_name text not null default '',
  due_on date,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  deleted_at timestamptz,
  unique (id, agency_id)
);

create table public.investigation_events (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations (id) on delete cascade,
  agency_id uuid not null references public.agencies (id) on delete cascade,
  event_type text not null default 'note'
    check (event_type in ('created', 'assigned', 'status_changed', 'note', 'reopened', 'deleted')),
  from_status text check (from_status in ('open', 'in_progress', 'resolved')),
  to_status text check (to_status in ('open', 'in_progress', 'resolved')),
  note text not null default '',
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (id, agency_id)
);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.investigations enable row level security;
alter table public.investigations force row level security;
alter table public.investigation_events enable row level security;
alter table public.investigation_events force row level security;

-- Investigation notes may name individuals or staff. Managers see everything
-- in their agency; everyone else sees only what they created or are assigned.
create policy investigations_visible on public.investigations as restrictive
for all to authenticated
using (private.has_agency(agency_id) and (
  private.role_key_in(agency_id, array['administrator', 'program_manager', 'house_manager'])
  or created_by_user_id = auth.uid()
  or assigned_to_user_id = auth.uid()
))
with check (private.has_agency(agency_id) and (
  private.role_key_in(agency_id, array['administrator', 'program_manager', 'house_manager'])
  or created_by_user_id = auth.uid()
  or assigned_to_user_id = auth.uid()
));

create policy investigation_events_visible on public.investigation_events as restrictive
for all to authenticated
using (
  private.has_agency(agency_id) and exists (
    select 1 from public.investigations i
    where i.id = investigation_events.investigation_id
      and i.agency_id = investigation_events.agency_id
      and (
        private.role_key_in(agency_id, array['administrator', 'program_manager', 'house_manager'])
        or i.created_by_user_id = auth.uid()
        or i.assigned_to_user_id = auth.uid()
      )
  )
)
with check (private.has_agency(agency_id));

-- ----------------------------------------------------------------------------
-- Guards
-- ----------------------------------------------------------------------------

-- Keep created_by honest, require a title, and only let managers manage.
create or replace function private.investigation_identity_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.title is null or trim(new.title) = '' then
    raise exception 'Give the investigation a title.';
  end if;
  if new.assigned_to_user_id is not null and not exists (
    select 1 from memberships m
    where m.agency_id = new.agency_id
      and m.user_id = new.assigned_to_user_id
      and (m.expires_on is null or m.expires_on >= current_date)
  ) then
    raise exception 'Assign an active member of this agency.';
  end if;
  if TG_OP = 'INSERT' and auth.role() = 'authenticated' then
    new.created_by_user_id := auth.uid();
  elsif TG_OP = 'UPDATE' and (
    new.agency_id <> old.agency_id
    or new.created_by_user_id <> old.created_by_user_id
    or new.id <> old.id
  ) then
    raise exception 'Investigation identity cannot be changed.';
  end if;
  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger investigation_identity_guard
before insert or update on public.investigations
for each row execute function private.investigation_identity_guard();

-- Keep the assignee display name in sync without app round-trips.
create or replace function private.investigation_assignee_name_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.assigned_to_user_id is not null then
    select coalesce(full_name, '') into new.assigned_to_name
    from public.profiles where id = new.assigned_to_user_id;
  else
    new.assigned_to_name := '';
  end if;
  return new;
end $$;

create trigger investigation_assignee_name_guard
before insert or update of assigned_to_user_id on public.investigations
for each row execute function private.investigation_assignee_name_guard();

-- ----------------------------------------------------------------------------
-- investigations.manage permission seed (merge-only-missing-keys, same pattern
-- as the hub.* and corrective-action seeds): administrator, program_manager,
-- and house_manager manage investigations; everyone else is read-only.
-- ----------------------------------------------------------------------------

create temporary table issue98_perm_defaults (
  role_key text not null,
  perm_key text not null,
  perm_value boolean not null,
  primary key (role_key, perm_key)
) on commit drop;

insert into issue98_perm_defaults (role_key, perm_key, perm_value)
values
  ('administrator', 'investigations.manage', true),
  ('program_manager', 'investigations.manage', true),
  ('house_manager', 'investigations.manage', true),
  ('compliance_admin', 'investigations.manage', false),
  ('dsp', 'investigations.manage', false),
  ('nurse', 'investigations.manage', false),
  ('hr', 'investigations.manage', false),
  ('auditor', 'investigations.manage', false);

update public.role_templates rt
set permissions = rt.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from issue98_perm_defaults d
  where d.role_key = rt.key
    and not (rt.permissions ? d.perm_key)
);

update public.role_permission_matrix rpm
set permissions = rpm.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from issue98_perm_defaults d
  where d.role_key = rpm.role_key
    and not (rpm.permissions ? d.perm_key)
),
updated_at = now();

update public.agency_roles ar
set permissions = ar.permissions || (
  select coalesce(jsonb_object_agg(d.perm_key, d.perm_value), '{}'::jsonb)
  from issue98_perm_defaults d
  where d.role_key = ar.template_key
    and not (ar.permissions ? d.perm_key)
);

drop table issue98_perm_defaults;

commit;
