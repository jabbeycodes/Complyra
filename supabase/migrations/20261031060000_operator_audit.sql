-- UNAPPLIED: labeled operator evidence, bounded pages, no care-record payloads.
begin;
create or replace function public.operator_audit(p_start date,p_end date,p_category text default 'all',p_agency_id uuid default null,p_actor_id uuid default null,p_action text default '',p_source text default 'all',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 or p_category is null or p_category not in ('all','customer','demo','internal') or p_page is null or p_page<0 or p_page>2000 or p_action is null or length(p_action)>80 or p_source is null or p_source not in ('all','application','lifecycle','rules','ai') then raise exception 'Invalid audit filters.'; end if;
 return (with events as (
 select 'lifecycle:'||id::text as id,agency_id,actor_id,'agency.'||to_status as action,'lifecycle'::text as source,from_status||' → '||to_status as summary,created_at from operator_agency_lifecycle
 union all select 'rules:'||id::text,agency_id,set_by,'rule.changed','rules',key,created_at from rule_values
 union all select 'ai:'||id::text,agency_id,actor,action,'ai',coalesce(detail->>'model',action),at from document_audit_log where upload_id is null and action in ('ai_settings_changed','ai_policy_acknowledged','ai_service_verified')
 union all select 'application:'||id::text,agency_id,actor_id,action,'application',target_type,created_at from audit_events where action<>'agency.status'
 ), filtered as (select e.* from events e join agencies a on a.id=e.agency_id where (p_category='all' or a.reporting_category=p_category)
 and e.created_at>=p_start::timestamp at time zone 'UTC' and e.created_at<(p_end+1)::timestamp at time zone 'UTC'
 and (p_agency_id is null or e.agency_id=p_agency_id) and (p_actor_id is null or e.actor_id=p_actor_id)
 and strpos(lower(e.action),lower(p_action))>0 and (p_source='all' or e.source=p_source)),
 page as (select * from filtered order by created_at desc,id desc limit 51 offset p_page*50),
 visible as (select * from page order by created_at desc,id desc limit 50)
 select jsonb_build_object('hasMore',(select count(*)>50 from page),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'agencyId',agency_id,'actorId',actor_id,'action',action,'source',source,'summary',summary,'createdAt',created_at) order by created_at desc,id desc) from visible),'[]'::jsonb)));
end $$;
revoke all on function public.operator_audit(date,date,text,uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.operator_audit(date,date,text,uuid,uuid,text,text,integer) to authenticated;
-- Only the verified edge-function service client records integration checks.
create function public.operator_record_ai_verification(p_agency_id uuid,p_actor_id uuid,p_project text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 if not exists(select 1 from profiles where id=p_actor_id and platform_admin and active and not must_change_password) then raise exception 'Operator access required.' using errcode='42501'; end if;
 insert into agency_ai_settings(agency_id,service_account_verified_at,vertex_project_id) values(p_agency_id,now(),p_project)
 on conflict(agency_id) do update set service_account_verified_at=excluded.service_account_verified_at,vertex_project_id=excluded.vertex_project_id;
 insert into document_audit_log(agency_id,actor,action,detail) values(p_agency_id,p_actor_id,'ai_service_verified',jsonb_build_object('project',p_project));
end $$;
revoke all on function public.operator_record_ai_verification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.operator_record_ai_verification(uuid,uuid,text) to service_role;
commit;
