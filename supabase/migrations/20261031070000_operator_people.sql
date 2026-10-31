-- UNAPPLIED: read-only support/account metadata. No impersonation or grants.
begin;
create or replace function public.operator_people(p_query text default '',p_agency_id uuid default null,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 if p_query is null or length(p_query)>80 or p_page is null or p_page<0 or p_page>2000 then raise exception 'Invalid people search.'; end if;
 return (with people as(select p.*,coalesce((select jsonb_agg(jsonb_build_object('agencyId',m.agency_id,'agencyCode',a.agency_code,'roleKey',m.role_key,'expiresOn',m.expires_on) order by a.agency_code) from memberships m join agencies a on a.id=m.agency_id where m.user_id=p.id),'[]'::jsonb) as seats from profiles p
 where (p_agency_id is null or exists(select 1 from memberships where user_id=p.id and agency_id=p_agency_id))
 and (strpos(lower(p.full_name||' '||coalesce(p.username,'')||' '||p.email),lower(trim(p_query)))>0 or exists(select 1 from memberships m join agencies a on a.id=m.agency_id where m.user_id=p.id and strpos(lower(a.agency_code),lower(trim(p_query)))>0))),
 page as(select * from people order by full_name,id limit 51 offset p_page*50),visible as(select * from page order by full_name,id limit 50)
 select jsonb_build_object('hasMore',(select count(*)>50 from page),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'fullName',full_name,'username',coalesce(username,''),'email',email,'active',active,'platformAdmin',platform_admin,'mustChangePassword',must_change_password,'memberships',seats) order by full_name,id) from visible),'[]'::jsonb)));
end $$;
revoke all on function public.operator_people(text,uuid,integer) from public,anon;
grant execute on function public.operator_people(text,uuid,integer) to authenticated;
commit;
