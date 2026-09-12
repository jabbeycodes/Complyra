-- Template roles with a short, agency-editable permission pack.
-- Do not copy Therap's per-module Super Role matrix.

alter table public.memberships
  add column if not exists role_key text,
  add column if not exists expires_on date;

update public.memberships
set role_key = case role::text
  when 'manager' then 'house_manager'
  else role::text
end
where role_key is null;

alter table public.memberships
  alter column role_key set not null;

create table if not exists public.role_templates (
  key text primary key,
  name text not null,
  short_code text not null,
  description text not null,
  default_scope text not null check (default_scope in ('agency', 'program', 'site', 'assigned')),
  capability public.app_role not null,
  permissions jsonb not null default '{}'::jsonb
);

create table if not exists public.agency_roles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  template_key text not null references public.role_templates (key),
  name text not null,
  short_code text not null,
  scope text not null check (scope in ('agency', 'program', 'site', 'assigned')),
  permissions jsonb not null default '{}'::jsonb,
  unique (agency_id, template_key),
  unique (id, agency_id)
);

insert into public.role_templates (key, name, short_code, description, default_scope, capability, permissions)
values
  (
    'administrator', 'Agency administrator', 'ADMIN',
    'Creates the agency workspace, assigns roles, and can do every operational action.',
    'agency', 'administrator',
    '{"members.invite":true,"members.assign_roles":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true}'::jsonb
  ),
  (
    'compliance_admin', 'Compliance administrator', 'CA',
    'Owns the compliance loop: plans, approvals, acknowledgments, and audit exports.',
    'agency', 'compliance_admin',
    '{"members.invite":true,"members.assign_roles":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true}'::jsonb
  ),
  (
    'house_manager', 'House manager', 'HM',
    'Runs one home: assigned staff, plan review, and acknowledgments for that site.',
    'site', 'manager',
    '{"members.invite":false,"members.assign_roles":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false}'::jsonb
  ),
  (
    'degreed_professional_manager', 'Degreed professional manager', 'DPM',
    'Program-level QIDP/QIP oversight across homes, without HR or role-assignment rights.',
    'program', 'manager',
    '{"members.invite":false,"members.assign_roles":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true}'::jsonb
  ),
  (
    'dsp', 'Direct support professional', 'DSP',
    'Sees assigned people, completes assigned work, and signs their own acknowledgments.',
    'assigned', 'dsp',
    '{"members.invite":false,"members.assign_roles":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false}'::jsonb
  ),
  (
    'nurse', 'Nurse', 'RN',
    'Clinical and delegation records for assigned people. No HR files and no role assignment.',
    'site', 'nurse',
    '{"members.invite":false,"members.assign_roles":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false}'::jsonb
  ),
  (
    'hr', 'Human resources', 'HR',
    'Staff accounts and employment records only. Does not receive individual care records.',
    'agency', 'hr',
    '{"members.invite":true,"members.assign_roles":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false}'::jsonb
  ),
  (
    'auditor', 'Auditor', 'AUD',
    'Time-limited read and export access. Cannot change records or add staff.',
    'agency', 'auditor',
    '{"members.invite":false,"members.assign_roles":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":true,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":true,"audit.export":true}'::jsonb
  )
on conflict (key) do update
  set name = excluded.name,
      short_code = excluded.short_code,
      description = excluded.description,
      default_scope = excluded.default_scope,
      capability = excluded.capability,
      permissions = excluded.permissions;

create or replace function public.provision_agency_roles(p_agency_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.agency_roles (agency_id, template_key, name, short_code, scope, permissions)
  select p_agency_id, key, name, short_code, default_scope, permissions
  from public.role_templates
  on conflict (agency_id, template_key) do nothing;
$$;

select public.provision_agency_roles(id) from public.agencies;

create or replace function private.agency_created_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_agency_roles(new.id);
  return new;
end;
$$;

drop trigger if exists agencies_provision_roles on public.agencies;
create trigger agencies_provision_roles
after insert on public.agencies
for each row execute function private.agency_created_roles();

create or replace function private.membership_current(p_agency_id uuid)
returns public.memberships
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.memberships
  where user_id = auth.uid()
    and agency_id = p_agency_id
    and (expires_on is null or expires_on >= current_date)
  limit 1;
$$;

create or replace function private.has_agency(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and (expires_on is null or expires_on >= current_date)
  );
$$;

create or replace function private.is_privileged(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role in ('administrator', 'compliance_admin', 'manager')
      and (expires_on is null or expires_on >= current_date)
  );
$$;

create or replace function private.can_approve(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role in ('administrator', 'compliance_admin', 'manager')
      and (expires_on is null or expires_on >= current_date)
  );
$$;

create or replace function private.is_agency_admin(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role in ('administrator', 'compliance_admin')
      and (expires_on is null or expires_on >= current_date)
  );
$$;

create or replace function private.can_read_site(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (
        m.role in ('administrator', 'compliance_admin', 'auditor')
        or (m.role in ('manager', 'nurse') and (m.site_id is null or m.site_id = p_site_id))
        or (
          m.role = 'dsp'
          and exists (
            select 1
            from public.staff_assignments a
            where a.user_id = m.user_id
              and a.agency_id = p_agency_id
              and a.site_id = p_site_id
              and a.starts_on <= current_date
              and (a.ends_on is null or a.ends_on >= current_date)
          )
        )
      )
  );
$$;

create or replace function private.can_read_individual(p_agency_id uuid, p_individual_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.individuals i
    join public.memberships m
      on m.agency_id = i.agency_id
     and m.user_id = auth.uid()
    where i.id = p_individual_id
      and i.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (
        m.role in ('administrator', 'compliance_admin', 'auditor')
        or (m.role in ('manager', 'nurse') and (m.site_id is null or m.site_id = i.site_id))
        or (
          m.role = 'dsp'
          and exists (
            select 1
            from public.staff_assignments a
            where a.user_id = m.user_id
              and a.agency_id = i.agency_id
              and a.starts_on <= current_date
              and (a.ends_on is null or a.ends_on >= current_date)
              and a.individual_id = i.id
          )
        )
      )
  );
$$;

alter table public.role_templates enable row level security;
alter table public.agency_roles enable row level security;
alter table public.role_templates force row level security;
alter table public.agency_roles force row level security;

create policy role_templates_select on public.role_templates
for select to authenticated
using (true);

create policy agency_roles_select on public.agency_roles
for select to authenticated
using ((select private.has_agency(agency_id)));

create or replace function private.has_permission(p_agency_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (ar.permissions ->> p_key)::boolean
    from public.memberships m
    join public.agency_roles ar
      on ar.agency_id = m.agency_id
     and ar.template_key = coalesce(m.role_key, m.role::text)
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
    limit 1
  ), false);
$$;

create policy agency_roles_update on public.agency_roles
for update to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'members.assign_roles'))
)
with check (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'members.assign_roles'))
);

drop policy if exists memberships_write_admin on public.memberships;
create policy memberships_write_admin on public.memberships
for all to authenticated
using (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'members.assign_roles'))
)
with check (
  (select private.is_agency_admin(agency_id))
  or (select private.has_permission(agency_id, 'members.assign_roles'))
);

drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events
for select to authenticated
using (
  actor_id = (select auth.uid())
  or (select private.has_permission(agency_id, 'audit.read'))
  or (select private.has_permission(agency_id, 'individuals.view'))
  or (select private.is_privileged(agency_id))
);

grant select on public.role_templates to authenticated, anon;
grant select, update on public.agency_roles to authenticated;
grant execute on function public.provision_agency_roles(uuid) to authenticated;

-- DSP roster reads are individual assignments only; site-wide DSP access is no longer implied.
