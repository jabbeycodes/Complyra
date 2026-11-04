-- Sim wave 6, item 8: hard-retire stale consent notices.
--
-- Consent missing/expiring alerts and consent-packet outstanding alerts
-- fire once per consent (or packet) and target and then dedupe forever
-- (private.sweep_consents / private.sweep_packet_alerts in
-- 20261027140000 / 20261027180000). Nothing ever cleared them: a notice
-- raised while a consent was missing stayed unread in the bell even
-- after the consent was signed and activated, so the bell kept crying
-- wolf for a resolved gap. The missing-note family already solves the
-- same problem with public.retire_stale_missing_note_notices
-- (20261025120000), which marks the stale rows read; this is the
-- consent mirror of that function, with the same shape: SECURITY
-- DEFINER, a service_role bypass, a private.has_agency guard plus an
-- active-membership role check for authenticated callers, a count of
-- rows retired, and "retire" = mark read_at (never delete — the row
-- stays as the record that the alert once fired).
--
-- "No longer warrants" is judged per consent TYPE for one Individual,
-- using the register's own currency predicate
-- (private.consent_current: activated, effectiveOn <= today <=
-- reviewOn, not revoked on/before today, not superseded by a version
-- already in effect):
--   * consent.missing for a type retires when a CURRENT consent for
--     that Individual + type exists. A consent in its last 30 days is
--     still current, so it clears a missing notice (the sweep may then
--     raise the expiring notice instead — that one is warranted).
--   * consent.expiring for a type retires only when a current consent
--     for that Individual + type exists whose review date is MORE
--     than 30 days out — the exact complement of the sweep's
--     "Expiring soon" window (reviewOn <= current_date + 30). A
--     consent that is still expiring soon keeps its notice.
--   * consent.packet_outstanding retires when the linked consent
--     packet is no longer in 'sent' status. Outstanding alerts only
--     ever fire for sent packets, and the only exits from 'sent' are
--     signing/filing, which create the packet's consents — so a
--     packet that left 'sent' is resolved by construction. A packet
--     still sent keeps its notice.
-- Rows whose consent type cannot be derived (unknown entity linkage)
-- are never retired: when in doubt, the notice stays.
--
-- Rights-packet exemption: the annual Rights packet reuses the
-- consent.missing / consent.expiring types (src/data/rightsPackets.ts),
-- but its notices are NOT consent-register notices and must survive
-- this retire — a current consent must never clear a rights-packet
-- alert. Three independent guards keep them out:
--   1. entity_type = 'rights_packet' rows are excluded outright;
--   2. dedupe keys in the rights tracker's 'rights.' namespace are
--      excluded (its keys are 'rights.missing:…' / 'rights.expiring:…');
--   3. any row whose entity_id is the id of a rights_packets row for
--      this Individual is excluded, even if it was stored with a
--      consent entity_type by mistake.
-- Only rows positively linked to this Individual are touched at all:
-- entity_type 'consent' rows link either by consent id (a row of
-- public.individual_consents for this Individual) or by the sweep's
-- composite entity '<individual_id>:<type_id>'; entity_type
-- 'consent_packet' rows link through public.consent_packets.
--
-- UNAPPLIED — production application needs Joshua's explicit go-ahead
-- like every migration. Until it is applied, the HostedApi call sites
-- treat this RPC as best-effort, so a missing function cannot undo a
-- consent save/activate/revoke or break the notification load.

create or replace function public.retire_stale_consent_notices(
  p_agency_id uuid,
  p_individual_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if auth.uid() is null or not private.has_agency(p_agency_id) then
      raise exception 'Not allowed';
    end if;
    if not exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= current_date)
        and coalesce(m.role_key, m.role::text) in (
          'administrator', 'program_manager', 'house_manager', 'nurse'
        )
    ) then
      raise exception 'Not allowed';
    end if;
  end if;

  -- A mismatched agency / Individual pair is refused, never a partial
  -- retire: consent notices are only ever retired inside their own
  -- agency, for the Individual they are actually about.
  if not exists (
    select 1
    from public.individuals i
    where i.id = p_individual_id
      and i.agency_id = p_agency_id
  ) then
    raise exception 'Not allowed';
  end if;

  update public.notifications n
  set read_at = now()
  where n.agency_id = p_agency_id
    and n.read_at is null
    and n.type in ('consent.missing', 'consent.expiring', 'consent.packet_outstanding')
    -- Rights-packet exemption (guards 1 and 2 above).
    and coalesce(n.entity_type, '') <> 'rights_packet'
    and coalesce(n.dedupe_key, '') not like 'rights.%'
    -- Rights-packet exemption (guard 3 above).
    and not exists (
      select 1
      from public.rights_packets rp
      where rp.id::text = n.entity_id
        and rp.agency_id = p_agency_id
        and rp.individual_id = p_individual_id
    )
    and (
      -- Consent-register rows: retire per consent type, and only when
      -- a current consent for this Individual + type now covers them.
      (
        n.entity_type = 'consent'
        and n.type in ('consent.missing', 'consent.expiring')
        and exists (
          select 1
          from public.individual_consents c
          where c.agency_id = p_agency_id
            and c.individual_id = p_individual_id
            and c.type_id = coalesce(
              (
                select linked.type_id
                from public.individual_consents linked
                where linked.id::text = n.entity_id
                  and linked.agency_id = p_agency_id
                  and linked.individual_id = p_individual_id
              ),
              case
                when n.entity_id like p_individual_id::text || ':%'
                  then split_part(n.entity_id, ':', 2)
              end
            )
            and private.consent_current(c.id)
            and (
              n.type = 'consent.missing'
              or (c.details ->> 'reviewOn')::date > current_date + 30
            )
        )
      )
      or
      -- Consent-packet rows: retire only when the packet that raised
      -- the alert has left 'sent' (signed/filed — see header).
      (
        n.entity_type = 'consent_packet'
        and n.type = 'consent.packet_outstanding'
        and exists (
          select 1
          from public.consent_packets cp
          where cp.id::text = n.entity_id
            and cp.agency_id = p_agency_id
            and cp.individual_id = p_individual_id
            and cp.status <> 'sent'
        )
      )
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

comment on function public.retire_stale_consent_notices(uuid, uuid) is
  'Marks consent missing/expiring and consent-packet outstanding notices read for one Individual when a current consent now covers that type or the packet is no longer outstanding. Rights-packet notices, which reuse the consent types, are always exempt.';

revoke all on function public.retire_stale_consent_notices(uuid, uuid) from public;
grant execute on function public.retire_stale_consent_notices(uuid, uuid) to authenticated, service_role;
