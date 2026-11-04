-- Wave 3 (retest batches 277-293): two notice fixes.
--
-- 1. Unmarked-dose notices. med.unrecorded keys ended in a reminder slot, so a
--    home with an unmarked dose minted a new row for every recipient every
--    interval (proven live: 62 rows in one bell). The key now names the home
--    and the agency day, so queue_operating_notice / queue_system_notice's
--    ON CONFLICT DO NOTHING holds it to one row. Same pattern as
--    20261031330000 for med.prn_repeat. SQL owns the rest:
--
--    rearm_unmarked_dose_notices keeps the row current. It refreshes the
--    wording, since the dose count moves through the day. It makes a row unread
--    again once it was read a full medication.unrecorded_reminder_minutes
--    ago and the dose is still unmarked. It retires the recipient's unread
--    row for that home from an earlier day. A signed-in member touches only
--    their own rows; the unattended sweep (service role) touches every
--    recipient's.
--
--    Slot-keyed rows still unread are retired by marking them read. Nothing is
--    deleted. A home that is still overdue gets its one row on the next sweep.
--
-- 2. Consent alert audience. Consent alerts now also reach administrators, as
--    a role notice alongside the program manager's. Nurses keep medication
--    consents only. private.sweep_consents serves both the signed-in sweep
--    (public.sweep_consent_alerts) and the unattended one
--    (private.sweep_all_consents), so one change covers both.
--    The two function bodies below are 20261031260000's sweep_consents and
--    20261027180000's sweep_packet_alerts with only the administrator line
--    added.

begin;

create or replace function public.rearm_unmarked_dose_notices(
  p_agency_id uuid,
  p_notices jsonb,
  p_repeat_minutes integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_keys text[];
  v_rearmed integer;
begin
  if not v_is_service and (auth.uid() is null or not private.has_agency(p_agency_id)) then
    raise exception 'Not allowed';
  end if;

  select coalesce(array_agg(x.dedupe_key), array[]::text[]) into v_keys
  from jsonb_to_recordset(coalesce(p_notices, '[]'::jsonb)) as x(dedupe_key text, body text);

  update public.notifications n
  set body = x.body
  from jsonb_to_recordset(coalesce(p_notices, '[]'::jsonb)) as x(dedupe_key text, body text)
  where n.agency_id = p_agency_id
    and n.type = 'med.unrecorded'
    and n.dedupe_key = x.dedupe_key
    and n.body is distinct from x.body
    and (v_is_service or n.user_id = auth.uid());

  update public.notifications n
  set read_at = null,
      created_at = now()
  where n.agency_id = p_agency_id
    and n.type = 'med.unrecorded'
    and n.dedupe_key = any(v_keys)
    and n.read_at is not null
    and n.read_at <= now() - make_interval(mins => greatest(coalesce(p_repeat_minutes, 60), 1))
    and (v_is_service or n.user_id = auth.uid());

  get diagnostics v_rearmed = row_count;

  update public.notifications n
  set read_at = now()
  where n.agency_id = p_agency_id
    and n.type = 'med.unrecorded'
    and n.read_at is null
    and not (n.dedupe_key = any(v_keys))
    and (v_is_service or n.user_id = auth.uid())
    and exists (
      select 1 from public.notifications cur
      where cur.agency_id = p_agency_id
        and cur.type = 'med.unrecorded'
        and cur.dedupe_key = any(v_keys)
        and cur.user_id = n.user_id
        and cur.entity_id = n.entity_id
    );

  return v_rearmed;
end;
$$;

revoke all on function public.rearm_unmarked_dose_notices(uuid, jsonb, integer) from public, anon;
grant execute on function public.rearm_unmarked_dose_notices(uuid, jsonb, integer) to authenticated, service_role;

update public.notifications
set read_at = now()
where type = 'med.unrecorded'
  and read_at is null
  and dedupe_key ~ '^med\.unrecorded:[^:]+:[^:]+:[0-9]+$';

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
    union all select null::uuid,'administrator','role:administrator'
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

create or replace function private.sweep_packet_alerts(p_agency_id uuid,p_scoped boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;t record;
begin
 for p in select cp.*,i.site_id from public.consent_packets cp join public.individuals i on i.id=cp.individual_id where cp.agency_id=p_agency_id and cp.status='sent' and cp.sent_at+make_interval(days=>cp.outstanding_after_days)<=now() and (not p_scoped or private.can_read_individual(cp.agency_id,cp.individual_id)) loop
  for t in select distinct m.user_id,null::text role_key,m.user_id::text target from public.memberships m where m.agency_id=p_agency_id and m.role_key='house_manager' and (m.site_id is null or m.site_id=p.site_id) and (m.expires_on is null or m.expires_on>=current_date)
   union all select null::uuid,'program_manager','program_manager'
   union all select null::uuid,'administrator','administrator'
   union all select null::uuid,'nurse','nurse' loop
   insert into public.notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
   values(p_agency_id,t.user_id,t.role_key,'consent.packet_outstanding','Outstanding consent packet',(p.snapshot->>'individualName')||': consent packet remains unsigned.','/consents','consent_packet',p.id::text,'consent.packet_outstanding:'||p.id::text||':'||t.target) on conflict do nothing;
  end loop;
 end loop;
end;
$$;

commit;
