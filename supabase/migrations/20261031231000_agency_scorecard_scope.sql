-- Agency administrator slice 1: aggregate the caller's authorized requirement
-- population, not every requirement in a tenant merely because they are a member.
-- HR keeps the existing aggregate-only agency view; no care-record grant is added.
begin;
create or replace function public.agency_scorecard(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (private.has_agency(p_agency_id) or private.is_platform_admin()) then
    raise exception 'Agency outside your access' using errcode = '42501';
  end if;
  return (
    with scoped as (
      select case
        when r.status in ('compliant','pending_review') then r.status::text
        when r.due_on < current_date then
          case when r.category ~* 'delegat' then 'expired' else 'overdue' end
        when r.due_on <= current_date + 7 then 'due_soon'
        else 'upcoming'
      end as status
      from public.requirement_definitions r
      where r.agency_id = p_agency_id and (
        private.is_platform_admin()
        or private.role_key_in(p_agency_id, array['hr'])
        or (
          private.has_permission(p_agency_id, 'individuals.view')
          and private.can_read_site(p_agency_id, r.site_id)
          and (r.individual_id is null or private.can_read_individual(p_agency_id, r.individual_id))
        )
      )
    ), active as (select * from scoped where status <> 'pending_review')
    select jsonb_build_object(
      'score', case when (select count(*) from active) = 0 then 100
        else round(100.0 * (select count(*) from active where status = 'compliant') / (select count(*) from active)) end,
      'total', (select count(*) from active),
      'done', (select count(*) from active where status = 'compliant'),
      'overdue', (select count(*) from active where status in ('overdue','expired')),
      'dueSoon', (select count(*) from active where status = 'due_soon'),
      'review', (select count(*) from scoped where status = 'pending_review')
    )
  );
end;
$$;
revoke all on function public.agency_scorecard(uuid) from public, anon;
grant execute on function public.agency_scorecard(uuid) to authenticated;
commit;
