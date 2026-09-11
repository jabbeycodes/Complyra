-- Complyra foundation: multi-tenant compliance records, RBAC helpers, RLS, and private document storage.
-- Do not store real PHI until Auth, RLS, private storage, and audit logging are verified in a hosted project.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum (
  'administrator',
  'compliance_admin',
  'manager',
  'dsp'
);

create type public.document_kind as enum ('pcsp', 'isp', 'policy', 'other');

create type public.review_status as enum ('pending_review', 'active', 'archived');

create type public.requirement_status as enum (
  'pending_review',
  'compliant',
  'due_soon',
  'overdue',
  'expired',
  'upcoming'
);

create type public.packet_status as enum ('open', 'archived');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id)
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  program_id uuid not null,
  name text not null,
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (program_id, agency_id) references public.programs (id, agency_id)
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  job_title text not null default 'DSP',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  site_id uuid,
  created_at timestamptz not null default now(),
  unique (agency_id, user_id),
  unique (id, agency_id),
  foreign key (site_id, agency_id) references public.sites (id, agency_id)
);

create table public.individuals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  full_name text not null,
  date_of_birth date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (site_id, agency_id) references public.sites (id, agency_id)
);

create table public.staff_assignments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  individual_id uuid,
  site_id uuid,
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id),
  foreign key (site_id, agency_id) references public.sites (id, agency_id),
  check (individual_id is not null or site_id is not null)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  title text not null,
  kind public.document_kind not null default 'pcsp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id)
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  document_id uuid not null,
  version_label text not null,
  status public.review_status not null default 'pending_review',
  storage_path text,
  content_hash text,
  page_count integer not null default 1 check (page_count > 0),
  effective_on date not null,
  expires_on date,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (document_id, version_label),
  foreign key (document_id, agency_id) references public.documents (id, agency_id)
);

create table public.requirement_definitions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  document_version_id uuid,
  individual_id uuid,
  site_id uuid not null,
  title text not null,
  category text not null,
  owner_user_id uuid references public.profiles (id),
  due_on date not null,
  frequency text not null default 'On plan update',
  source_page integer not null default 1,
  status public.requirement_status not null default 'pending_review',
  evidence_note text not null default '',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (document_version_id, agency_id) references public.document_versions (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id),
  foreign key (site_id, agency_id) references public.sites (id, agency_id)
);

create table public.acknowledgment_packets (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  document_version_id uuid not null,
  what_acknowledging text not null,
  starts_on date not null,
  ends_on date,
  status public.packet_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (document_version_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id),
  foreign key (document_version_id, agency_id) references public.document_versions (id, agency_id)
);

create table public.acknowledgment_rows (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  packet_id uuid not null,
  user_id uuid not null references public.profiles (id),
  staff_name text not null,
  added_manually boolean not null default false,
  add_reason text,
  opened_at timestamptz,
  signed_at timestamptz,
  signature_name text,
  signature_mark text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (packet_id, user_id),
  foreign key (packet_id, agency_id) references public.acknowledgment_packets (id, agency_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  action text not null,
  target_type text not null,
  target_id uuid,
  detail text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_agency_id_idx on public.memberships (agency_id);
create index sites_agency_id_idx on public.sites (agency_id);
create index individuals_agency_site_idx on public.individuals (agency_id, site_id);
create index staff_assignments_user_idx on public.staff_assignments (user_id, starts_on, ends_on);
create index staff_assignments_individual_idx on public.staff_assignments (individual_id);
create index documents_individual_idx on public.documents (individual_id);
create index document_versions_document_idx on public.document_versions (document_id, status);
create index requirements_agency_status_idx on public.requirement_definitions (agency_id, status, due_on);
create index requirements_owner_idx on public.requirement_definitions (owner_user_id);
create index packets_individual_idx on public.acknowledgment_packets (individual_id, status);
create index ack_rows_packet_idx on public.acknowledgment_rows (packet_id, signed_at);
create index ack_rows_user_idx on public.acknowledgment_rows (user_id);
create index audit_events_agency_created_idx on public.audit_events (agency_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger agencies_updated_at before update on public.agencies
for each row execute function private.set_updated_at();
create trigger programs_updated_at before update on public.programs
for each row execute function private.set_updated_at();
create trigger sites_updated_at before update on public.sites
for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger individuals_updated_at before update on public.individuals
for each row execute function private.set_updated_at();
create trigger documents_updated_at before update on public.documents
for each row execute function private.set_updated_at();
create trigger requirements_updated_at before update on public.requirement_definitions
for each row execute function private.set_updated_at();

create or replace function private.forbid_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events are append-only';
end;
$$;

create trigger audit_events_no_update
before update on public.audit_events
for each row execute function private.forbid_audit_mutation();

create trigger audit_events_no_delete
before delete on public.audit_events
for each row execute function private.forbid_audit_mutation();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, job_title)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data ->> 'job_title', 'DSP')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Authorization helpers. Wrapped in SELECT at policy call sites for RLS performance.
create or replace function private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

create or replace function private.user_membership(p_agency_id uuid)
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
      and (
        m.role in ('administrator', 'compliance_admin')
        or (m.role = 'manager' and (m.site_id is null or m.site_id = p_site_id))
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
      and (
        m.role in ('administrator', 'compliance_admin')
        or (m.role = 'manager' and (m.site_id is null or m.site_id = i.site_id))
        or (
          m.role = 'dsp'
          and exists (
            select 1
            from public.staff_assignments a
            where a.user_id = m.user_id
              and a.agency_id = i.agency_id
              and a.starts_on <= current_date
              and (a.ends_on is null or a.ends_on >= current_date)
              and (
                a.individual_id = i.id
                or a.site_id = i.site_id
              )
          )
        )
      )
  );
$$;

grant execute on all functions in schema private to authenticated;

alter table public.agencies enable row level security;
alter table public.programs enable row level security;
alter table public.sites enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.individuals enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.requirement_definitions enable row level security;
alter table public.acknowledgment_packets enable row level security;
alter table public.acknowledgment_rows enable row level security;
alter table public.audit_events enable row level security;

alter table public.agencies force row level security;
alter table public.programs force row level security;
alter table public.sites force row level security;
alter table public.profiles force row level security;
alter table public.memberships force row level security;
alter table public.individuals force row level security;
alter table public.staff_assignments force row level security;
alter table public.documents force row level security;
alter table public.document_versions force row level security;
alter table public.requirement_definitions force row level security;
alter table public.acknowledgment_packets force row level security;
alter table public.acknowledgment_rows force row level security;
alter table public.audit_events force row level security;

create policy agencies_select on public.agencies
for select to authenticated
using ((select private.has_agency(id)));

create policy programs_select on public.programs
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy sites_select on public.sites
for select to authenticated
using ((select private.can_read_site(agency_id, id)));

create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.memberships mine
    join public.memberships theirs on theirs.agency_id = mine.agency_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = profiles.id
  )
);

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy memberships_select on public.memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_agency(agency_id))
);

create policy memberships_write_admin on public.memberships
for all to authenticated
using ((select private.is_agency_admin(agency_id)))
with check ((select private.is_agency_admin(agency_id)));

create policy individuals_select on public.individuals
for select to authenticated
using ((select private.can_read_individual(agency_id, id)));

create policy individuals_write on public.individuals
for all to authenticated
using ((select private.can_approve(agency_id)) and (select private.can_read_site(agency_id, site_id)))
with check ((select private.can_approve(agency_id)) and (select private.can_read_site(agency_id, site_id)));

create policy assignments_select on public.staff_assignments
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_privileged(agency_id))
);

create policy assignments_write on public.staff_assignments
for all to authenticated
using ((select private.can_approve(agency_id)))
with check ((select private.can_approve(agency_id)));

create policy documents_select on public.documents
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

create policy documents_write on public.documents
for all to authenticated
using ((select private.can_approve(agency_id)))
with check ((select private.can_approve(agency_id)));

create policy versions_select on public.document_versions
for select to authenticated
using (
  exists (
    select 1 from public.documents d
    where d.id = document_id
      and (select private.can_read_individual(d.agency_id, d.individual_id))
  )
);

create policy versions_write on public.document_versions
for all to authenticated
using ((select private.can_approve(agency_id)))
with check ((select private.can_approve(agency_id)));

create policy requirements_select on public.requirement_definitions
for select to authenticated
using (
  (individual_id is not null and (select private.can_read_individual(agency_id, individual_id)))
  or (individual_id is null and (select private.can_read_site(agency_id, site_id)))
);

create policy requirements_insert on public.requirement_definitions
for insert to authenticated
with check ((select private.can_approve(agency_id)));

create policy requirements_update on public.requirement_definitions
for update to authenticated
using (
  (select private.can_approve(agency_id))
  or owner_user_id = (select auth.uid())
)
with check (
  (select private.can_approve(agency_id))
  or owner_user_id = (select auth.uid())
);

create policy packets_select on public.acknowledgment_packets
for select to authenticated
using ((select private.can_read_individual(agency_id, individual_id)));

create policy packets_write on public.acknowledgment_packets
for all to authenticated
using ((select private.can_approve(agency_id)))
with check ((select private.can_approve(agency_id)));

create policy ack_rows_select on public.acknowledgment_rows
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.acknowledgment_packets p
    where p.id = packet_id
      and (select private.can_read_individual(p.agency_id, p.individual_id))
  )
);

create policy ack_rows_insert on public.acknowledgment_rows
for insert to authenticated
with check ((select private.can_approve(agency_id)));

create policy ack_rows_update on public.acknowledgment_rows
for update to authenticated
using (
  user_id = (select auth.uid())
  or (select private.can_approve(agency_id))
)
with check (
  user_id = (select auth.uid())
  or (select private.can_approve(agency_id))
);

create policy audit_select on public.audit_events
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy audit_insert on public.audit_events
for insert to authenticated
with check (
  (select private.has_agency(agency_id))
  and actor_id = (select auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-documents',
  'agency-documents',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do nothing;

create policy storage_documents_select on storage.objects
for select to authenticated
using (
  bucket_id = 'agency-documents'
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

create policy storage_documents_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'agency-documents'
  and (select private.can_approve((storage.foldername(name))[1]::uuid))
  and (select private.can_read_individual(
    (storage.foldername(name))[1]::uuid,
    (storage.foldername(name))[2]::uuid
  ))
);

create policy storage_documents_update on storage.objects
for update to authenticated
using (
  bucket_id = 'agency-documents'
  and (select private.can_approve((storage.foldername(name))[1]::uuid))
)
with check (
  bucket_id = 'agency-documents'
  and (select private.can_approve((storage.foldername(name))[1]::uuid))
);

grant usage on schema public to authenticated;
grant select on public.agencies, public.programs, public.sites, public.profiles, public.memberships to authenticated;
grant select, insert, update, delete on public.individuals, public.staff_assignments, public.documents, public.document_versions, public.requirement_definitions, public.acknowledgment_packets, public.acknowledgment_rows to authenticated;
grant select, insert on public.audit_events to authenticated;
grant update on public.profiles to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
