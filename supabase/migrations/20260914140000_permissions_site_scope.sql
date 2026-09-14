-- Permissions / login repairs for issues #18–#21:
--   * resolve_login also matches the email local-part so invited usernames
--     like qa.dpm still sign in if profiles.username was not written
--   * protect_profile_identity recognizes service_role via auth.role()
--   * Evergreen demo nurse (cameron.price) gets a membership on the auth
--     user that actually owns that email

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
  where a.agency_code = public.normalize_agency_code(p_agency_code)
    and (
      lower(p.username) = lower(trim(p_username))
      or lower(split_part(p.email, '@', 1)) = lower(trim(p_username))
    )
    and p.active = true
    and a.active = true
  limit 1;
$$;

revoke all on function public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text, text) to anon, authenticated;

create or replace function private.protect_profile_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or auth.role() = 'service_role' then
    return new;
  end if;
  if current_setting('complyra.allow_identity_update', true) = 'on' then
    return new;
  end if;
  new.username := old.username;
  new.home_agency_id := old.home_agency_id;
  new.must_change_password := old.must_change_password;
  new.email := old.email;
  new.platform_admin := old.platform_admin;
  new.active := old.active;
  return new;
end;
$$;

do $$
declare
  v_agency_id uuid;
  v_site_id uuid;
  v_email text := 'cameron.price@evergreen.example';
  v_username text := 'cameron.price';
  v_auth_id uuid;
begin
  select id into v_agency_id
  from public.agencies
  where agency_code = 'EVERGREEN-MO'
  limit 1;
  if v_agency_id is null then
    return;
  end if;

  select id into v_site_id
  from public.sites
  where agency_id = v_agency_id and name = 'Maple House'
  limit 1;

  begin
    select u.id into v_auth_id
    from auth.users u
    where lower(u.email) = v_email
    limit 1;
  exception
    when undefined_table then
      v_auth_id := null;
  end;

  if v_auth_id is null then
    select p.id into v_auth_id
    from public.profiles p
    where lower(coalesce(p.username, split_part(p.email, '@', 1))) = v_username
      and p.home_agency_id = v_agency_id
    limit 1;
  end if;

  if v_auth_id is null then
    return;
  end if;

  perform set_config('complyra.allow_identity_update', 'on', true);

  insert into public.profiles (
    id, username, email, full_name, job_title,
    home_agency_id, must_change_password, active
  )
  values (
    v_auth_id, v_username, v_email, 'Cameron Price', 'Nurse',
    v_agency_id, false, true
  )
  on conflict (id) do update
    set username = excluded.username,
        email = coalesce(nullif(public.profiles.email, ''), excluded.email),
        full_name = case
          when coalesce(public.profiles.full_name, '') in ('', split_part(excluded.email, '@', 1))
            then excluded.full_name
          else public.profiles.full_name
        end,
        job_title = case
          when public.profiles.job_title in ('DSP', '') then 'Nurse'
          else public.profiles.job_title
        end,
        home_agency_id = excluded.home_agency_id,
        must_change_password = false,
        active = true;

  insert into public.memberships (agency_id, user_id, role, role_key, site_id)
  values (v_agency_id, v_auth_id, 'nurse', 'nurse', v_site_id)
  on conflict (agency_id, user_id) do update
    set role = 'nurse',
        role_key = 'nurse',
        site_id = coalesce(excluded.site_id, public.memberships.site_id);
end;
$$;
