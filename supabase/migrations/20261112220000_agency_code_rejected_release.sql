-- F-2: a rejected agency application must not squat its provider code.
--
-- Until now agencies.agency_code carried an unconditional unique
-- constraint, so the row left behind by a rejected application held its
-- code forever (the original NORTHSTAR-MO application is the live case:
-- the simulation had to re-apply as NORTHSTAR2-MO). Nothing is deleted
-- or rewritten here: the rejected row keeps its code as history, and
-- the code simply stops counting as taken.
--
--   * The unique constraint becomes a partial unique index over live
--     rows only: unique (agency_code) where status <> 'rejected'. A
--     code has at most one live holder; any number of rejected rows
--     may share it as history.
--   * resolve_login learns to prefer the non-rejected row when the
--     same username exists under two rows sharing one code, so a
--     re-issued code signs the new agency's people in. A username that
--     exists only on the rejected row still resolves to it, so a
--     rejected applicant keeps reaching the "not approved" screen
--     until the code is re-issued to an agency whose admin picked the
--     same username.

alter table public.agencies
  drop constraint if exists agencies_agency_code_key;

create unique index agencies_agency_code_live_key
  on public.agencies (agency_code)
  where status <> 'rejected';

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
  order by (a.status = 'rejected')
  limit 1;
$$;

revoke all on function public.resolve_login(text, text) from public;
grant execute on function public.resolve_login(text, text) to anon, authenticated;
