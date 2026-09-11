-- Therap-style member access: agency code + username + temporary password.
-- Username is unique inside one agency, not globally.

alter table public.agencies
  add column if not exists agency_code text,
  add column if not exists active boolean not null default true;

alter table public.profiles
  add column if not exists username text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists home_agency_id uuid references public.agencies (id) on delete set null,
  add column if not exists active boolean not null default true;

update public.agencies
set agency_code = case
  when id = '00000000-0000-4000-8000-000000000001' then 'EVERGREEN'
  else upper(regexp_replace(coalesce(name, 'AGENCY'), '[^a-zA-Z0-9]', '', 'g'))
end
where agency_code is null or btrim(agency_code) = '';

alter table public.agencies
  alter column agency_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_agency_code_key'
  ) then
    alter table public.agencies
      add constraint agencies_agency_code_key unique (agency_code);
  end if;
end $$;

create unique index if not exists profiles_agency_username_key
  on public.profiles (home_agency_id, lower(username))
  where username is not null and home_agency_id is not null;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, job_title, username, home_agency_id, must_change_password
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'job_title', 'DSP'),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'home_agency_id', '')::uuid,
    coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false)
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        job_title = coalesce(excluded.job_title, public.profiles.job_title),
        username = coalesce(excluded.username, public.profiles.username),
        home_agency_id = coalesce(excluded.home_agency_id, public.profiles.home_agency_id),
        must_change_password = excluded.must_change_password;
  return new;
end;
$$;

-- Keep username, home agency, and the forced-password flag off the self-serve update path.
create or replace function private.protect_profile_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if current_setting('complyra.allow_identity_update', true) = 'on' then
    return new;
  end if;
  new.username := old.username;
  new.home_agency_id := old.home_agency_id;
  new.must_change_password := old.must_change_password;
  new.email := old.email;
  return new;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
before update on public.profiles
for each row execute function private.protect_profile_identity();

-- Public login helper. Returns the Auth email for (agency_code, username).
-- Granted to anon so the login screen can resolve credentials before sign-in.
create or replace function public.resolve_login(p_agency_code text, p_username text)
returns table (email text, must_change_password boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.email, p.must_change_password
  from public.profiles p
  join public.agencies a on a.id = p.home_agency_id
  where a.agency_code = upper(trim(p_agency_code))
    and lower(p.username) = lower(trim(p_username))
    and p.active = true
    and a.active = true
  limit 1;
$$;

revoke all on function public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text, text) to anon, authenticated;

create or replace function public.username_taken(p_agency_id uuid, p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where home_agency_id = p_agency_id
      and lower(username) = lower(trim(p_username))
  );
$$;

revoke all on function public.username_taken(uuid, text) from public;
grant execute on function public.username_taken(uuid, text) to authenticated;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('complyra.allow_identity_update', 'on', true);
  update public.profiles
    set must_change_password = false
    where id = auth.uid();
end;
$$;

revoke all on function public.complete_password_change() from public;
grant execute on function public.complete_password_change() to authenticated;

-- Acknowledgment roster is staff assigned to that individual, not the whole house.
create or replace function public.sync_packet_roster(p_packet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pkt public.acknowledgment_packets%rowtype;
begin
  select * into pkt
  from public.acknowledgment_packets
  where id = p_packet_id;
  if not found then
    raise exception 'Acknowledgment packet not found.';
  end if;
  if not private.can_approve(pkt.agency_id) then
    raise exception 'You do not have permission to do that.';
  end if;

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
end;
$$;

revoke all on function public.sync_packet_roster(uuid) from public;
grant execute on function public.sync_packet_roster(uuid) to authenticated;

create or replace function public.activate_document_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.document_versions%rowtype;
  d public.documents%rowtype;
  pkt public.acknowledgment_packets%rowtype;
  next_label text;
begin
  select * into v from public.document_versions where id = p_version_id;
  if not found then
    raise exception 'Document version not found.';
  end if;
  if not private.can_approve(v.agency_id) then
    raise exception 'You do not have permission to do that.';
  end if;
  select * into d from public.documents where id = v.document_id;

  update public.document_versions
    set status = 'archived'
    where document_id = v.document_id
      and status = 'active'
      and id <> v.id;

  next_label := regexp_replace(v.version_label, ' draft$', '');
  update public.document_versions
    set status = 'active',
        version_label = next_label
    where id = v.id;

  update public.acknowledgment_packets
    set status = 'archived'
    where individual_id = d.individual_id
      and status = 'open'
      and document_version_id <> v.id;

  select * into pkt
  from public.acknowledgment_packets
  where document_version_id = v.id;

  if not found then
    insert into public.acknowledgment_packets (
      agency_id, individual_id, document_version_id,
      what_acknowledging, starts_on, ends_on, status
    )
    values (
      v.agency_id,
      d.individual_id,
      v.id,
      d.title || ' · ' || next_label,
      v.effective_on,
      v.expires_on,
      'open'
    )
    returning * into pkt;
  end if;

  perform public.sync_packet_roster(pkt.id);

  insert into public.audit_events (
    agency_id, actor_id, action, target_type, target_id, detail
  )
  values (
    v.agency_id,
    auth.uid(),
    'document.activated',
    'document_version',
    v.id,
    d.title || ' · ' || next_label || ' activated. Earlier versions retained.'
  );
end;
$$;

revoke all on function public.activate_document_version(uuid) from public;
grant execute on function public.activate_document_version(uuid) to authenticated;
