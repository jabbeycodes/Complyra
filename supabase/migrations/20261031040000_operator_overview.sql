-- UNAPPLIED: aggregate only metadata/audit events; never return care records.
begin;
create or replace function public.operator_overview(p_start date,p_end date,p_category text default 'customer') returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or p_category is null or p_category not in ('all','customer','demo','internal') then raise exception 'Choose a valid date range of at most 366 days and reporting group.'; end if;
 return (with selected as (select * from agencies where p_category='all' or reporting_category=p_category),
 days as (select p_start+n as day from generate_series(0,p_end-p_start) n),
 series as (select day,(select count(*) from selected where (created_at at time zone 'UTC')::date=day) as signups,
 (select count(*) from selected where (created_at at time zone 'UTC')::date<=day) as growth from days)
 select jsonb_build_object('total',(select count(*) from selected),'active',(select count(*) from selected where status='active' and active),
 'inactive',(select count(*) from selected where status<>'active' or not active),'pending',(select count(*) from selected where status='pending'),
 'registrations',(select count(*) from selected where (created_at at time zone 'UTC')::date between p_start and p_end),
 'activity',(select count(*) from audit_events e join selected a on a.id=e.agency_id where e.created_at>=p_start::timestamp at time zone 'UTC' and e.created_at<(p_end+1)::timestamp at time zone 'UTC'),
 'unknownDates',0,'series',(select jsonb_agg(jsonb_build_object('date',day,'signups',signups,'growth',growth) order by day) from series)));
end $$;
revoke all on function public.operator_overview(date,date,text) from public,anon;
grant execute on function public.operator_overview(date,date,text) to authenticated;
commit;
