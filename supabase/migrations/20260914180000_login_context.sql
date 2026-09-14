-- Login bootstrap that does not depend on memberships RLS, plus a second
-- pass at the Evergreen nurse membership. Seed used to upsert memberships
-- on id; Cameron's seed id was already taken by a remapped DSP, so the
-- nurse could authenticate but had no seat.

create or replace function public.login_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'job_title', p.job_title,
      'username', p.username,
      'must_change_password', p.must_change_password,
      'home_agency_id', p.home_agency_id,
      'platform_admin', coalesce(p.platform_admin, false)
    ),
    'membership', case
      when m.user_id is null then null
      else jsonb_build_object(
        'agency_id', m.agency_id,
        'role', m.role,
        'role_key', m.role_key,
        'site_id', m.site_id,
        'expires_on', m.expires_on
      )
    end,
    'agency', case
      when a.id is null then null
      else jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'agency_code', a.agency_code,
        'status', a.status
      )
    end
  )
  from public.profiles p
  left join lateral (
    select *
    from public.memberships m
    where m.user_id = p.id
    order by m.created_at
    limit 1
  ) m on true
  left join public.agencies a on a.id = m.agency_id
  where p.id = auth.uid();
$$;

revoke all on function public.login_context() from public;
grant execute on function public.login_context() to authenticated;

do $$
declare
  v_agency_id uuid;
  v_site_id uuid;
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
    where lower(u.email) = 'cameron.price@evergreen.example'
    limit 1;
  exception
    when undefined_table then
      v_auth_id := null;
  end;

  if v_auth_id is null then
    select p.id into v_auth_id
    from public.profiles p
    where p.home_agency_id = v_agency_id
      and lower(coalesce(p.username, split_part(p.email, '@', 1))) = 'cameron.price'
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
    v_auth_id, 'cameron.price', 'cameron.price@evergreen.example',
    'Cameron Price', 'Nurse', v_agency_id, false, true
  )
  on conflict (id) do update
    set username = 'cameron.price',
        email = coalesce(nullif(public.profiles.email, ''), excluded.email),
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
