-- Complyrer: ALL-CAPS provider codes, pending agency review, permission-based
-- upload/approve, DPM password reset, and HM/DPM plan signers.

alter table public.agencies drop constraint if exists agencies_agency_code_format_chk;

update public.agencies
set agency_code = upper(btrim(agency_code));

alter table public.agencies
  add constraint agencies_agency_code_format_chk
  check (agency_code ~ '^[A-Z0-9]{2,20}-[A-Z]{2}$');

create or replace function public.normalize_agency_code(p_agency_code text)
returns text
language sql
immutable
as $$
  select upper(btrim(p_agency_code));
$$;

alter table public.agencies
  add column if not exists status text not null default 'active';

alter table public.agencies drop constraint if exists agencies_status_chk;
alter table public.agencies
  add constraint agencies_status_chk
  check (status in ('pending', 'active', 'rejected'));

alter table public.profiles
  add column if not exists platform_admin boolean not null default false;

insert into public.agencies (id, name, agency_code, state_code, provisioned_by, status)
values (
  '00000000-0000-4000-8000-000000000090',
  'Complyrer',
  'COMPLYRER-MO',
  'MO',
  'platform',
  'active'
)
on conflict (id) do update
  set name = excluded.name,
      agency_code = excluded.agency_code,
      status = 'active';

insert into public.role_templates (key, name, short_code, description, default_scope, capability, permissions)
values (
  'program_manager', 'Program manager', 'PM',
  'Creates and approves ISPs/PCSPs across homes, and signs the plans they oversee.',
  'program', 'manager',
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true}'::jsonb
)
on conflict (key) do update
  set name = excluded.name,
      short_code = excluded.short_code,
      description = excluded.description,
      default_scope = excluded.default_scope,
      capability = excluded.capability,
      permissions = excluded.permissions;

update public.role_templates
set permissions = permissions || '{"members.reset_password":false}'::jsonb
where not (permissions ? 'members.reset_password');

update public.role_templates
set
  description = 'Runs one home, creates plans for DPM approval, and signs acknowledgments for that site.',
  permissions = '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false}'::jsonb
where key = 'house_manager';

update public.role_templates
set
  description = 'Program-level QIDP/QIP oversight: upload, approve, sign, and reset staff passwords.',
  permissions = '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true}'::jsonb
where key = 'degreed_professional_manager';

update public.role_templates
set
  description = 'Creates and approves clinical plans, uploads ISPs, and signs acknowledgments.',
  permissions = '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false}'::jsonb
where key = 'nurse';

update public.role_templates
set
  description = 'Staff accounts and employment records only. Sees the agency score, not individual care files.',
  permissions = '{"members.invite":true,"members.assign_roles":false,"members.reset_password":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false}'::jsonb
where key = 'hr';

update public.role_templates
set permissions = '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":true,"audit.export":true}'::jsonb
where key = 'auditor';

update public.role_templates
set permissions = permissions || '{"members.reset_password":true}'::jsonb
where key in ('administrator', 'compliance_admin');

select public.provision_agency_roles(id) from public.agencies;

update public.agency_roles ar
set
  name = rt.name,
  short_code = rt.short_code,
  scope = rt.default_scope,
  permissions = rt.permissions
from public.role_templates rt
where ar.template_key = rt.key;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select platform_admin
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

create or replace function private.can_approve(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_permission(p_agency_id, 'requirements.approve');
$$;

create or replace function private.can_upload(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_permission(p_agency_id, 'documents.upload');
$$;

drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies
for select to authenticated
using (
  (select private.has_agency(id))
  or (select private.is_platform_admin())
);

drop policy if exists agencies_platform_update on public.agencies;
create policy agencies_platform_update on public.agencies
for update to authenticated
using ((select private.is_platform_admin()))
with check ((select private.is_platform_admin()));

grant update (status) on public.agencies to authenticated;

drop policy if exists documents_write on public.documents;
create policy documents_write on public.documents
for all to authenticated
using (
  (select private.can_upload(agency_id) or private.can_approve(agency_id))
)
with check (
  (select private.can_upload(agency_id) or private.can_approve(agency_id))
);

drop policy if exists versions_write on public.document_versions;
create policy versions_write on public.document_versions
for all to authenticated
using (
  (select private.can_upload(agency_id) or private.can_approve(agency_id))
)
with check (
  (select private.can_upload(agency_id) or private.can_approve(agency_id))
);

drop policy if exists requirements_insert on public.requirement_definitions;
create policy requirements_insert on public.requirement_definitions
for insert to authenticated
with check (
  (select private.can_upload(agency_id) or private.can_approve(agency_id))
);

drop policy if exists storage_documents_insert on storage.objects;
create policy storage_documents_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'agency-documents'
  and (
    (select private.can_upload((storage.foldername(name))[1]::uuid))
    or (select private.can_approve((storage.foldername(name))[1]::uuid))
  )
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

create or replace function public.agency_scorecard(p_agency_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select status
    from public.requirement_definitions
    where agency_id = p_agency_id
      and (
        private.has_agency(p_agency_id)
        or private.is_platform_admin()
      )
  ),
  active as (
    select * from scoped where status <> 'pending_review'
  )
  select jsonb_build_object(
    'score', case when (select count(*) from active) = 0 then 100
      else round(100.0 * (select count(*) from active where status = 'compliant') / (select count(*) from active))
    end,
    'total', (select count(*) from active),
    'done', (select count(*) from active where status = 'compliant'),
    'overdue', (select count(*) from active where status in ('overdue', 'expired')),
    'dueSoon', (select count(*) from active where status = 'due_soon'),
    'review', (select count(*) from scoped where status = 'pending_review')
  );
$$;

revoke all on function public.agency_scorecard(uuid) from public;
grant execute on function public.agency_scorecard(uuid) to authenticated;

create or replace function public.sync_packet_roster(p_packet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pkt public.acknowledgment_packets%rowtype;
  person public.individuals%rowtype;
begin
  select * into pkt
  from public.acknowledgment_packets
  where id = p_packet_id;
  if not found then
    raise exception 'Acknowledgment packet not found.';
  end if;
  if not (
    private.can_approve(pkt.agency_id)
    or private.can_upload(pkt.agency_id)
  ) then
    raise exception 'You do not have permission to do that.';
  end if;
  select * into person from public.individuals where id = pkt.individual_id;

  insert into public.acknowledgment_rows (
    agency_id, packet_id, user_id, staff_name
  )
  select
    pkt.agency_id,
    pkt.id,
    a.user_id,
    p.full_name
  from public.staff_assignments a
  join public.profiles p on p.id = a.user_id
  where a.agency_id = pkt.agency_id
    and a.individual_id = pkt.individual_id
    and a.starts_on <= current_date
    and (a.ends_on is null or a.ends_on >= current_date)
  on conflict (packet_id, user_id) do nothing;

  insert into public.acknowledgment_rows (
    agency_id, packet_id, user_id, staff_name
  )
  select
    pkt.agency_id,
    pkt.id,
    m.user_id,
    p.full_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.agency_id = pkt.agency_id
    and coalesce(m.role_key, m.role::text) in (
      'house_manager',
      'degreed_professional_manager',
      'program_manager'
    )
    and (m.site_id is null or m.site_id = person.site_id)
    and (m.expires_on is null or m.expires_on >= current_date)
  on conflict (packet_id, user_id) do nothing;
end;
$$;
