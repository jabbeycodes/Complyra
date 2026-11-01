-- Wave 7B (simulation batches 51/52/58): a consent gap must hold ONE live
-- alert per recipient in the bell. private.sweep_consents keyed a gap's
-- "Missing" alert by person:type (no record yet) but the later
-- "Expiring soon" alert by the consent record id — when a record was
-- created inside its 30-day window, the stale Missing alert was never
-- retired, so the same consent showed in the bell as both missing and
-- expiring (and the unread counts stacked). The sweep now retires the
-- gap's UNREAD sibling alerts for the same recipient before inserting
-- the current alert. A sibling anyone has read is history and stays;
-- which events notify does not change. The LocalApi sweep mirrors this
-- in src/data/localApi.ts (retireConsentAlertSiblings).
begin;

create or replace function private.sweep_consents(p_agency_id uuid,p_scoped boolean) returns void
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
   -- Retire this gap's unread sibling alerts for this recipient: the
   -- person:type incarnation and the consent-id incarnation of the same
   -- gap (either alert flavor). Read rows are never deleted.
   delete from public.notifications n
   where n.agency_id=p_agency_id
     and n.type in ('consent.missing','consent.expiring')
     and n.entity_type='consent'
     and (n.entity_id=entity or n.entity_id=g.individual_id::text||':'||(g.typ->>'id'))
     and n.user_id is not distinct from target.user_id
     and n.role_key is not distinct from target.role_key
     and n.dedupe_key is distinct from key
     and (case when n.user_id is not null then n.read_at is null
               else not exists(select 1 from public.notification_reads r where r.notification_id=n.id) end);
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

commit;
