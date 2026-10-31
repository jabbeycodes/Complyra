-- UNAPPLIED: operator directory. Classify demo agencies explicitly during deployment.
begin;
alter table agencies add column reporting_category text not null default 'customer' check(reporting_category in ('customer','demo','internal'));
update agencies set reporting_category='internal' where agency_code='COMPLYRER-MO';
create or replace function public.operator_directory() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'agencyCode',agency_code,'stateCode',state_code,
  'status',status,'active',active,'provisionedBy',provisioned_by,'createdAt',created_at,'reportingCategory',reporting_category) order by name,id) from agencies),'[]'::jsonb);
end $$;
revoke all on function public.operator_directory() from public,anon;
grant execute on function public.operator_directory() to authenticated;
commit;
