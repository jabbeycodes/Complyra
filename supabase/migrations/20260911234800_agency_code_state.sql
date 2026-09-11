-- Agency codes are the login tenant key: {slug}-{state}, e.g. evergreen-mo.
-- Stored lowercase. Immutable after create (no public update policy on agencies).

alter table public.agencies
  add column if not exists state_code text,
  add column if not exists provisioned_by text not null default 'self';

update public.agencies
set
  state_code = coalesce(state_code, 'MO'),
  agency_code = 'evergreen-mo'
where id = '00000000-0000-4000-8000-000000000001'
   or upper(replace(agency_code, '-', '')) in ('EVERGREEN', 'EVERGREENCARE');

update public.agencies
set agency_code = lower(btrim(agency_code))
where agency_code is distinct from lower(btrim(agency_code));

update public.agencies
set state_code = upper(split_part(agency_code, '-', 2))
where (state_code is null or btrim(state_code) = '')
  and agency_code like '%-%';

alter table public.agencies
  alter column state_code set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_state_code_chk'
  ) then
    alter table public.agencies
      add constraint agencies_state_code_chk
      check (state_code ~ '^[A-Z]{2}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_agency_code_format_chk'
  ) then
    alter table public.agencies
      add constraint agencies_agency_code_format_chk
      check (agency_code ~ '^[a-z0-9]{2,20}-[a-z]{2}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_provisioned_by_chk'
  ) then
    alter table public.agencies
      add constraint agencies_provisioned_by_chk
      check (provisioned_by in ('self', 'platform'));
  end if;
end $$;

create or replace function public.normalize_agency_code(p_agency_code text)
returns text
language sql
immutable
as $$
  select lower(btrim(p_agency_code));
$$;

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
    and lower(p.username) = lower(trim(p_username))
    and p.active = true
    and a.active = true
  limit 1;
$$;

revoke all on function public.normalize_agency_code(text) from public;
grant execute on function public.normalize_agency_code(text) to anon, authenticated;
revoke all on function public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text, text) to anon, authenticated;
