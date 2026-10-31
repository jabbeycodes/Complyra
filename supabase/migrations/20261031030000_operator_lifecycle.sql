-- UNAPPLIED: canonical suspension state, no billing semantics.
begin;
alter table agencies drop constraint agencies_status_chk;
alter table agencies add constraint agencies_status_chk check(status in ('pending','active','rejected','suspended'));
update agencies set status='suspended' where status='active' and not active;
alter table agencies add constraint agencies_active_lifecycle_chk check((status<>'active' or active) and (status<>'suspended' or not active));
create or replace function public.operator_transition_agency(p_agency_id uuid,p_status text,p_reason text,p_expected_status text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a agencies%rowtype;
begin
 perform private.require_operator();
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Add a reason of at most 1000 characters.'; end if;
 select * into a from agencies where id=p_agency_id for update;
 if not found then raise exception 'Agency not found.'; end if;
 if p_expected_status is not null and a.status<>p_expected_status then raise exception 'Agency changed. Refresh and try again.'; end if;
 if a.agency_code='COMPLYRER-MO' then raise exception 'The platform agency cannot be suspended or reviewed.'; end if;
 if p_status is null or not ((a.status='pending' and p_status in ('active','rejected')) or (a.status='active' and p_status='suspended') or (a.status='suspended' and p_status='active')) then raise exception 'Invalid agency transition.'; end if;
 update agencies set status=p_status,active=(p_status<>'suspended') where id=a.id;
 insert into operator_agency_lifecycle(agency_id,actor_id,from_status,to_status,reason) values(a.id,auth.uid(),a.status,p_status,trim(p_reason));
 insert into audit_events(agency_id,actor_id,action,target_type,target_id,detail,metadata)
 values(a.id,auth.uid(),'agency.status','agency',a.id,trim(p_reason),jsonb_build_object('from',a.status,'to',p_status));
end $$;
create or replace function private.is_privileged(p_agency_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select private.has_agency(p_agency_id) and exists(select 1 from memberships where user_id=auth.uid() and agency_id=p_agency_id and role in ('administrator','compliance_admin','manager') and (expires_on is null or expires_on>=current_date));
$$;
create or replace function private.is_agency_admin(p_agency_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select private.has_agency(p_agency_id) and exists(select 1 from memberships where user_id=auth.uid() and agency_id=p_agency_id and role in ('administrator','compliance_admin') and (expires_on is null or expires_on>=current_date));
$$;
create or replace function private.role_key_in(p_agency_id uuid,p_keys text[]) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select private.has_agency(p_agency_id) and exists(select 1 from memberships where user_id=auth.uid() and agency_id=p_agency_id and role_key=any(array_replace(p_keys,'degreed_professional_manager','program_manager')) and (expires_on is null or expires_on>=current_date));
$$;
create or replace function private.has_permission(p_agency_id uuid,p_key text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select private.has_agency(p_agency_id) and coalesce((select (ar.permissions->>p_key)::boolean from memberships m join agency_roles ar on ar.agency_id=m.agency_id and ar.template_key=coalesce(m.role_key,m.role::text) where m.user_id=auth.uid() and m.agency_id=p_agency_id and (m.expires_on is null or m.expires_on>=current_date) limit 1),false);
$$;
commit;
