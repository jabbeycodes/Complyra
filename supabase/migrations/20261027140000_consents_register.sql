-- UNAPPLIED. Individual consents: immutable signed versions and append-only revocations.
-- The requested 20261027120000_care_plans_screening.sql is absent from main at
-- 2d96fea. Uses the existing private.can_read_individual scope and RPC-only writes.
begin;
create table public.consent_type_settings (
  agency_id uuid primary key references public.agencies(id),
  types jsonb not null,
  updated_by uuid not null references public.profiles(id)
);
create table public.individual_consents (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  individual_id uuid not null references public.individuals(id),
  type_id text not null,
  details jsonb not null,
  supersedes_id uuid references public.individual_consents(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  activated_by uuid references public.profiles(id),
  activated_at timestamptz,
  constraint individual_consents_activation_check check ((activated_at is null) = (activated_by is null)),
  check (supersedes_id is null or supersedes_id <> id)
);
create unique index consent_one_renewal on public.individual_consents(supersedes_id)
  where activated_at is not null and supersedes_id is not null;
create index consent_individual_history on public.individual_consents(agency_id,individual_id,created_at);
create table public.consent_revocations (
  consent_id uuid primary key references public.individual_consents(id),
  agency_id uuid not null references public.agencies(id),
  individual_id uuid not null references public.individuals(id),
  revoked_on date not null,
  revoked_by uuid not null references public.profiles(id),
  revoked_by_name text not null,
  reason text not null check (length(trim(reason)) > 0),
  recorded_at timestamptz not null default now()
);
alter table public.consent_type_settings enable row level security;
alter table public.consent_type_settings force row level security;
alter table public.individual_consents enable row level security;
alter table public.individual_consents force row level security;
alter table public.consent_revocations enable row level security;
alter table public.consent_revocations force row level security;

create function private.consent_types(p_agency_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce((select types from public.consent_type_settings where agency_id=p_agency_id),
 '[{"id":"service","label":"Service consent","required":true,"medication":false},
 {"id":"medication","label":"Medication administration consent","required":true,"medication":true},
 {"id":"information","label":"Release of information","required":true,"medication":false},
 {"id":"media","label":"Photo/media release","required":true,"medication":false},
 {"id":"rights","label":"Rights acknowledgement","required":true,"medication":false},
 {"id":"photograph","label":"Identification and recreation photographs","required":true,"medication":false},
 {"id":"emergency","label":"Emergency services","required":true,"medication":false},
 {"id":"outings","label":"Supported community activities","required":true,"medication":false},
 {"id":"law_enforcement","label":"Law enforcement safety coordination","required":true,"medication":false},
 {"id":"other","label":"Other","required":false,"medication":false}]'::jsonb);
$$;
create function private.can_manage_consent(p_agency_id uuid,p_individual_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and private.can_read_individual(p_agency_id,p_individual_id)
 and private.role_key_in(p_agency_id,'{house_manager,program_manager,nurse}');
$$;
-- Security definer prevents recursive SELECT policies when testing supersession.
create function private.consent_current(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from public.individual_consents c where c.id=p_id
 and c.activated_at is not null and (c.details->>'effectiveOn')::date <= current_date
 and (c.details->>'reviewOn')::date >= current_date
 and not exists(select 1 from public.consent_revocations r where r.consent_id=c.id and r.revoked_on<=current_date)
 and not exists(select 1 from public.individual_consents n where n.supersedes_id=c.id and n.activated_at is not null and (n.details->>'effectiveOn')::date<=current_date));
$$;
create policy consent_types_read on public.consent_type_settings for select to authenticated
using (private.has_agency(agency_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,dsp,auditor}'));
create policy consents_read on public.individual_consents for select to authenticated
using (private.can_read_individual(agency_id,individual_id) and (
 private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor}')
 or (private.role_key_in(agency_id,'{dsp}') and private.consent_current(id))));
create policy consent_revocations_read on public.consent_revocations for select to authenticated
using (private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor}'));
-- No direct write policies, grants, or DELETE capability. Only validated functions write.
revoke all on public.individual_consents,public.consent_revocations,public.consent_type_settings from public,anon,authenticated;
grant select on public.individual_consents,public.consent_revocations,public.consent_type_settings to authenticated;

create function private.consent_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Consent history cannot be deleted.' using errcode='42501'; end if;
 if tg_op='UPDATE' then
   if old.activated_at is not null then raise exception 'Signed consent is immutable.' using errcode='42501'; end if;
   if new.id<>old.id or new.agency_id<>old.agency_id or new.individual_id<>old.individual_id
     or new.type_id<>old.type_id or new.supersedes_id is distinct from old.supersedes_id
     or new.created_by<>old.created_by or new.created_at<>old.created_at then
     raise exception 'Consent identity is immutable.' using errcode='42501';
   end if;
   if old.created_by is distinct from auth.uid() then raise exception 'Only the author can change a draft.' using errcode='42501'; end if;
 end if;
 if not private.can_manage_consent(new.agency_id,new.individual_id) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 if tg_op='INSERT' then
   new.created_by:=auth.uid(); new.created_at:=now();
   new.activated_at:=null; new.activated_by:=null;
 end if;
 if new.activated_at is not null then new.activated_by:=auth.uid(); new.activated_at:=now(); end if;
 return new;
end;
$$;
create trigger consent_guard before insert or update or delete on public.individual_consents for each row execute function private.consent_guard();
create function private.consent_revocation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.individual_consents;
begin
 if tg_op<>'INSERT' then raise exception 'Revocations are immutable.' using errcode='42501'; end if;
 select * into c from public.individual_consents where id=new.consent_id for update;
 if c.id is null or c.activated_at is null or not private.can_manage_consent(c.agency_id,c.individual_id) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 if new.revoked_on< (c.details->>'signedOn')::date or new.revoked_on>current_date then raise exception 'Invalid revocation date.'; end if;
 new.agency_id:=c.agency_id; new.individual_id:=c.individual_id; new.revoked_by:=auth.uid();
 select full_name into new.revoked_by_name from public.profiles where id=auth.uid();
 new.recorded_at:=now(); return new;
end;
$$;
create trigger consent_revocation_guard before insert or update or delete on public.consent_revocations for each row execute function private.consent_revocation_guard();

create function private.validate_consent(p_draft jsonb,p_types jsonb,p_activate boolean default false) returns void
language plpgsql set search_path = public, pg_temp as $$
declare f text; v text;
begin
 if not exists(select 1 from jsonb_array_elements(p_types) t where t->>'id'=p_draft->>'typeId') then raise exception 'Choose a consent type.'; end if;
 if coalesce(p_draft->>'outcome','') not in ('','yes','no','full','group','none') then raise exception 'Choose a valid consent decision.'; end if;
 if coalesce(p_draft->>'giver','') not in ('individual','guardian','representative') then raise exception 'Choose who gave consent.'; end if;
 foreach f in array array['covers','giverName','relationship'] loop
  if length(trim(coalesce(p_draft->>f,'')))=0 then raise exception 'Describe the consent, giver name, and relationship.'; end if;
 end loop;
 foreach f in array array['effectiveOn','reviewOn','signedOn'] loop
  v:=p_draft->>f;
  if f='signedOn' and coalesce(v,'')='' and not p_activate then continue; end if;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Use a valid date.'; end if;
 end loop;
 if (p_draft->>'reviewOn')::date < (p_draft->>'effectiveOn')::date then raise exception 'Review date must be on or after the effective date.'; end if;
 if p_activate and ((p_draft->>'signedOn')::date > current_date or (p_draft->>'signedOn')::date > (p_draft->>'reviewOn')::date) then raise exception 'Record a valid signed date before activation.'; end if;
end;
$$;
create function public.save_consent(p_id uuid,p_draft jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a uuid; c public.individual_consents; prior public.individual_consents; result uuid;
begin
 select agency_id into a from public.individuals where id=(p_draft->>'individualId')::uuid;
 if not coalesce(private.can_manage_consent(a,(p_draft->>'individualId')::uuid),false) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 perform private.validate_consent(p_draft,private.consent_types(a));
 if p_id is not null then
  select * into c from public.individual_consents where id=p_id for update;
  if c.id is null or c.agency_id<>a or c.created_by<>auth.uid() or c.activated_at is not null then raise exception 'Only your own draft can be edited.' using errcode='42501'; end if;
  if c.individual_id<>(p_draft->>'individualId')::uuid or c.type_id<>p_draft->>'typeId' or c.supersedes_id is distinct from (p_draft->>'supersedesId')::uuid then raise exception 'Consent identity cannot change.' using errcode='42501'; end if;
  update public.individual_consents set details=p_draft where id=p_id;
  return p_id;
 end if;
 if p_draft->>'supersedesId' is not null then
  select * into prior from public.individual_consents where id=(p_draft->>'supersedesId')::uuid for update;
  if prior.id is null or prior.agency_id<>a or prior.individual_id<>(p_draft->>'individualId')::uuid or prior.type_id<>p_draft->>'typeId' or prior.activated_at is null then raise exception 'Renew the same Individual and consent type.'; end if;
 end if;
 insert into public.individual_consents(agency_id,individual_id,type_id,details,supersedes_id,created_by)
 values(a,(p_draft->>'individualId')::uuid,p_draft->>'typeId',p_draft,(p_draft->>'supersedesId')::uuid,auth.uid()) returning id into result;
 return result;
end;
$$;
create function public.activate_consent(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.individual_consents;
begin
 select * into c from public.individual_consents where id=p_id for update;
 if c.id is null or c.created_by<>auth.uid() or c.activated_at is not null or not private.can_manage_consent(c.agency_id,c.individual_id) then raise exception 'Only your own draft can be activated.' using errcode='42501'; end if;
 perform private.validate_consent(c.details,private.consent_types(c.agency_id),true);
 update public.individual_consents set activated_at=now(),activated_by=auth.uid() where id=p_id;
end;
$$;
create function public.revoke_consent(p_id uuid,p_revoked_on date,p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.individual_consents;
begin
 select * into c from public.individual_consents where id=p_id for update;
 if c.id is null or c.activated_at is null or not private.can_manage_consent(c.agency_id,c.individual_id) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 insert into public.consent_revocations(consent_id,agency_id,individual_id,revoked_on,revoked_by,revoked_by_name,reason)
 values(c.id,c.agency_id,c.individual_id,p_revoked_on,auth.uid(),'',trim(p_reason));
end;
$$;
create function public.save_consent_types(p_agency_id uuid,p_types jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not private.has_agency(p_agency_id) or not exists(select 1 from public.memberships where agency_id=p_agency_id and user_id=auth.uid() and role_key='program_manager' and site_id is null and (expires_on is null or expires_on>=current_date)) then raise exception 'An agency-wide Program Manager configures consent types.' using errcode='42501'; end if;
 if jsonb_typeof(p_types)<>'array' or jsonb_array_length(p_types) not between 1 and 50 then raise exception 'Use up to 50 consent types.'; end if;
 if exists(select 1 from jsonb_array_elements(p_types) t where coalesce(t->>'id','') !~ '^[a-z][a-z0-9_-]{0,49}$' or length(trim(coalesce(t->>'label','')))=0 or jsonb_typeof(t->'required') is distinct from 'boolean' or jsonb_typeof(t->'medication') is distinct from 'boolean') or
 (select count(*) from jsonb_array_elements(p_types))<>(select count(distinct t->>'id') from jsonb_array_elements(p_types) t) then raise exception 'Use unique consent type keys and nonempty labels.'; end if;
 if not exists(select 1 from jsonb_array_elements(p_types) t where t->>'id'='medication' and t->'medication'='true'::jsonb) then raise exception 'Keep the medication administration consent type.'; end if;
 if exists(select 1 from jsonb_array_elements(private.consent_types(p_agency_id)) t where exists(select 1 from public.individual_consents c where c.agency_id=p_agency_id and c.type_id=t->>'id') and not exists(select 1 from jsonb_array_elements(p_types) n where n->>'id'=t->>'id' and n->'medication'=t->'medication')) then raise exception 'Keep types referenced by consent history and their medication classification.'; end if;
 insert into public.consent_type_settings(agency_id,types,updated_by) values(p_agency_id,p_types,auth.uid()) on conflict(agency_id) do update set types=excluded.types,updated_by=excluded.updated_by;
end;
$$;

-- Former managers who become auditors/HR cannot keep receiving consent notices.
create policy consent_notification_roles on public.notifications as restrictive for select to authenticated
using (type not like 'consent.%' or private.role_key_in(agency_id,'{house_manager,program_manager,nurse}'));

-- Both signed-in refresh and the daily job use these targets and the same unique
-- (agency_id,dedupe_key) index as existing notifications. No browser-authored alerts.
create function private.sweep_consents(p_agency_id uuid,p_scoped boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; target record; alert text; entity text; key text;
begin
 for g in
  select i.id individual_id,i.full_name,i.site_id,t.value typ,c.id consent_id,c.state
  from public.individuals i
  cross join lateral jsonb_array_elements(private.consent_types(i.agency_id)) t(value)
  left join lateral (
    select c0.id,case
      when c0.activated_at is null then 'Draft'
      when exists(select 1 from public.consent_revocations r where r.consent_id=c0.id and r.revoked_on<=current_date) then 'Revoked'
      when exists(select 1 from public.individual_consents n where n.supersedes_id=c0.id and n.activated_at is not null and (n.details->>'effectiveOn')::date<=current_date) then 'Superseded'
      when (c0.details->>'effectiveOn')::date>current_date then 'Scheduled'
      when (c0.details->>'reviewOn')::date<current_date then 'Expired'
      when (c0.details->>'reviewOn')::date<=current_date+30 then 'Expiring soon'
      else 'Active' end state
    from public.individual_consents c0
    where c0.agency_id=i.agency_id and c0.individual_id=i.id and c0.type_id=t.value->>'id'
    order by private.consent_current(c0.id) desc,(c0.activated_at is not null) desc,
      case when private.consent_current(c0.id) then c0.details->>'effectiveOn' else null end desc nulls last,
      c0.created_at desc limit 1
  ) c on true
  where i.agency_id=p_agency_id and t.value->'required'='true'::jsonb
    and (not p_scoped or private.can_read_individual(i.agency_id,i.id))
    and coalesce(c.state,'Missing')<>'Active'
 loop
  alert:=case when g.state='Expiring soon' then 'expiring' else 'missing' end;
  entity:=coalesce(g.consent_id::text,g.individual_id::text||':'||(g.typ->>'id'));
  for target in
    select distinct m.user_id,null::text role_key,m.user_id::text target_key
      from public.memberships m join public.profiles p on p.id=m.user_id
      where m.agency_id=p_agency_id and m.role_key='house_manager'
      and (m.site_id is null or m.site_id=g.site_id) and (m.expires_on is null or m.expires_on>=current_date)
    union all select null::uuid,'program_manager','role:program_manager'
    union all select null::uuid,'nurse','role:nurse' where g.typ->'medication'='true'::jsonb
  loop
   key:='consent.'||alert||':'||entity||':'||target.target_key;
   insert into public.notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
   values(p_agency_id,target.user_id,target.role_key,'consent.'||alert,
     case when alert='expiring' then 'Consent expiring soon' else 'Consent needs attention' end,
     g.full_name||': '||(g.typ->>'label')||' — '||coalesce(g.state,'Missing')||'.',
     '/consents','consent',entity,key)
   on conflict do nothing;
  end loop;
 end loop;
end;
$$;
create function public.sweep_consent_alerts(p_agency_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not private.has_agency(p_agency_id) or not private.role_key_in(p_agency_id,'{house_manager,program_manager,nurse}') then raise exception 'Consent access denied.' using errcode='42501'; end if;
 perform private.sweep_consents(p_agency_id,true);
end;
$$;
create function private.sweep_all_consents() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a record;
begin
 for a in select id from public.agencies where status='active' loop
  perform private.sweep_consents(a.id,false);
 end loop;
end;
$$;
-- The scheduled path also catches missing/expiring consents with no open browser.
-- Use the installed scheduler where available; no migration or job is run here.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('consent-register-daily','10 6 * * *','select private.sweep_all_consents()');
 end if;
end $$;

revoke all on function private.consent_types(uuid),private.can_manage_consent(uuid,uuid),private.consent_current(uuid),private.consent_guard(),private.consent_revocation_guard(),private.validate_consent(jsonb,jsonb,boolean),private.sweep_consents(uuid,boolean),private.sweep_all_consents() from public,anon,authenticated;
-- Only the two helpers used by read policies need authenticated execution.
grant execute on function private.consent_current(uuid) to authenticated;
revoke all on function public.save_consent(uuid,jsonb),public.activate_consent(uuid),public.revoke_consent(uuid,date,text),public.save_consent_types(uuid,jsonb),public.sweep_consent_alerts(uuid) from public,anon,authenticated;
grant execute on function public.save_consent(uuid,jsonb),public.activate_consent(uuid),public.revoke_consent(uuid,date,text),public.save_consent_types(uuid,jsonb),public.sweep_consent_alerts(uuid) to authenticated;
commit;
