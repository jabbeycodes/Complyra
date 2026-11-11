-- UNAPPLIED: deploy separately. Operator review with atomic lifecycle attribution.
begin;
create or replace function private.require_operator() returns void
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from profiles where id=auth.uid() and platform_admin and active and not must_change_password) then
  raise exception 'Operator access required.' using errcode='42501';
 end if;
end $$;
revoke all on function private.require_operator() from public,anon;
grant execute on function private.require_operator() to authenticated;
create table public.operator_agency_lifecycle (
 id uuid primary key default gen_random_uuid(), agency_id uuid not null references agencies(id),
 actor_id uuid not null references profiles(id), from_status text not null, to_status text not null,
 reason text not null check(length(trim(reason)) between 1 and 1000), created_at timestamptz not null default now()
);
create index operator_lifecycle_agency_time on public.operator_agency_lifecycle(agency_id,created_at desc);
alter table public.operator_agency_lifecycle enable row level security;
alter table public.operator_agency_lifecycle force row level security;
create policy operator_lifecycle_read on public.operator_agency_lifecycle for select to authenticated using (private.is_platform_admin());
revoke all on public.operator_agency_lifecycle from anon,authenticated;
grant select on public.operator_agency_lifecycle to authenticated;
create trigger operator_lifecycle_immutable before update or delete on public.operator_agency_lifecycle for each row execute function private.forbid_audit_mutation();
-- Remove direct browser status writes; all transitions pass through the RPC.
revoke update(status) on public.agencies from authenticated;
drop policy if exists agencies_platform_update on public.agencies;
create or replace function public.operator_transition_agency(p_agency_id uuid,p_status text,p_reason text,p_expected_status text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare a agencies%rowtype;
begin
 perform private.require_operator();
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception 'Add a reason of at most 1000 characters.'; end if;
 select * into a from agencies where id=p_agency_id for update;
 if not found then raise exception 'Agency not found.'; end if;
 if p_expected_status is not null and a.status<>p_expected_status then raise exception 'Agency changed. Refresh and try again.'; end if;
 if a.status<>'pending' or p_status not in ('active','rejected') or p_status is null then raise exception 'Invalid agency transition.'; end if;
 update agencies set status=p_status where id=a.id;
 insert into operator_agency_lifecycle(agency_id,actor_id,from_status,to_status,reason) values(a.id,auth.uid(),a.status,p_status,trim(p_reason));
 insert into audit_events(agency_id,actor_id,action,target_type,target_id,detail,metadata)
 values(a.id,auth.uid(),'agency.status','agency',a.id,trim(p_reason),jsonb_build_object('from',a.status,'to',p_status));
end $$;
revoke all on function public.operator_transition_agency(uuid,text,text,text) from public,anon;
grant execute on function public.operator_transition_agency(uuid,text,text,text) to authenticated;
commit;
