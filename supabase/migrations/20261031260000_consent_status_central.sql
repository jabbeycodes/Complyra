-- Wave 7J (simulation batch 38; alert contradictions in batches 10/24):
-- one consent status, judged on the Central calendar, everywhere.
--
-- The screens compute consent status in TS (src/data/consents.ts) from
-- the viewer's calendar day, but the hosted alert sweep re-implemented
-- the same status chain in SQL against current_date — the database
-- server's day (UTC on Supabase). For a Central-time agency the two
-- disagree every evening from 19:00 CDT, when UTC is already tomorrow:
-- a consent on its review day read "Expiring soon" on the chart while
-- the sweep filed it as "Expired", and the DSP row gate
-- (private.consent_current, the RLS branch that decides which consent
-- rows a DSP may read) dropped the same consent hours early.
--
-- This migration judges the hosted side on the agency's Central day —
-- (now() at time zone 'America/Chicago')::date, the same day the TS
-- selector (consentStatusFor, whose default is centralTodayIso()), the
-- med dose clock, and House Card already use:
--
--   * private.consent_current now means "current on the Central day".
--     The DSP scoping RULE is unchanged — DSPs still read only
--     currently usable consents and never revocations — only the
--     calendar the word "currently" is judged on is aligned.
--   * private.sweep_consents computes its state chain against the
--     Central day and picks the representative record in exactly the
--     shared selector's order: usable first (latest effective, then
--     latest created), then latest created activated, then latest
--     created overall.
--
-- The sweep body otherwise reproduces migration 20261031250000
-- (wave 7B sibling-alert retraction) verbatim, so this migration is
-- safe to apply after it; if it is applied without 20261031250000,
-- the retraction arrives with this wave instead of being lost.
--
-- UNAPPLIED — production application is a separate step, like every
-- migration. Until it is applied, hosted alerts and the hosted DSP
-- gate still judge the database day while the screens judge Central.
begin;

create or replace function private.consent_current(p_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select private.consent_current_at(p_id,(now() at time zone 'America/Chicago')::date);
$$;

create or replace function private.sweep_consents(p_agency_id uuid,p_scoped boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; target record; alert text; entity text; key text;
  today date := (now() at time zone 'America/Chicago')::date;
begin
 for g in
  select i.id individual_id,i.full_name,i.site_id,t.value typ,c.id consent_id,c.state
  from public.individuals i
  cross join lateral jsonb_array_elements(private.consent_types(i.agency_id)) t(value)
  left join lateral (
    select c0.id,case
      when c0.activated_at is null then 'Draft'
      when exists(select 1 from public.consent_revocations r where r.consent_id=c0.id and r.revoked_on<=today) then 'Revoked'
      when exists(select 1 from public.individual_consents n where n.supersedes_id=c0.id and n.activated_at is not null and (n.details->>'effectiveOn')::date<=today) then 'Superseded'
      when (c0.details->>'effectiveOn')::date>today then 'Scheduled'
      when (c0.details->>'reviewOn')::date<today then 'Expired'
      when (c0.details->>'reviewOn')::date<=today+30 then 'Expiring soon'
      else 'Active' end state
    from public.individual_consents c0
    where c0.agency_id=i.agency_id and c0.individual_id=i.id and c0.type_id=t.value->>'id'
    order by
      case when private.consent_current(c0.id) then 0
           when c0.activated_at is not null then 1
           else 2 end,
      case when private.consent_current(c0.id) then (c0.details->>'effectiveOn')::date end desc nulls last,
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
      and (m.site_id is null or m.site_id=g.site_id) and (m.expires_on is null or m.expires_on>=today)
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
