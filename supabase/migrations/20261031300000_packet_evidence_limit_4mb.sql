-- Packet evidence upload limit: 10 MB -> 4 MB (founder instruction, 2026-11-02).
-- Client validator: PACKET_EVIDENCE_MAX_BYTES in src/data/consentPackets.ts.
-- This recreates private.complete_consent_packet verbatim from
-- 20261027180000_consent_packets.sql with only the evidence size ceiling and
-- its error message changed. The check measures the DECODED evidence bytes
-- (octet_length of decode(base64)), so the 4 MiB ceiling matches the client's
-- raw-file limit exactly -- no base64-inflation adjustment applies (the
-- encoded string is ~4/3 larger in transit, but it is not what is measured).
create or replace function private.complete_consent_packet(p_id uuid,p_choices jsonb,p_signer jsonb,p_evidence jsonb,p_external boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;item jsonb;prior uuid;content bytea;
begin
 select * into p from public.consent_packets where id=p_id for update;
 if p.id is null or p.signed_at is not null or p.status='draft' then raise exception 'Packet unavailable or already signed.' using errcode='42501'; end if;
 if not p_external and not private.can_manage_consent(p.agency_id,p.individual_id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 perform private.validate_packet_submission(p_choices,p_signer,p);
 content:=decode(p_evidence->>'base64','base64');
 if content is null or octet_length(content) not between 1 and 4194304 or length(coalesce(p_evidence->>'name',''))=0 then raise exception 'Attach signed evidence up to 4 MB.'; end if;
 if not ((p_evidence->>'mime'='application/pdf' and substring(content from 1 for 5)=convert_to('%PDF-','UTF8')) or (not p_external and p_evidence->>'mime'='image/png' and substring(content from 1 for 4)=decode('89504e47','hex')) or (not p_external and p_evidence->>'mime'='image/jpeg' and substring(content from 1 for 2)=decode('ffd8','hex'))) then raise exception 'Unsupported signed evidence.'; end if;
 -- Serialize renewal creation for this Individual, including simultaneous packets.
 perform 1 from public.individuals where id=p.individual_id for update;
 update public.consent_packets set status='filed',signed_at=now(),filed_at=now(),choices=p_choices,signer=p_signer,evidence_name=p_evidence->>'name' where id=p.id returning * into p;
 for item in select * from jsonb_array_elements(p.snapshot->'items') loop
  prior:=null;
  select c.id into prior from public.individual_consents c where c.agency_id=p.agency_id and c.individual_id=p.individual_id and c.type_id=item->>'typeId' and c.activated_at is not null
  and not exists(select 1 from public.individual_consents n where n.supersedes_id=c.id and n.activated_at is not null) order by c.created_at desc limit 1 for update;
  insert into public.individual_consents(agency_id,individual_id,type_id,details,supersedes_id,created_by,activated_at,activated_by,packet_id)
  values(p.agency_id,p.individual_id,item->>'typeId',jsonb_build_object('covers',item->>'text','outcome',p_choices->>(item->>'key'),
   'giver',case when p_signer->>'authority'='Self' then 'individual' when p_signer->>'authority'='Guardian' then 'guardian' else 'representative' end,
   'giverName',p_signer->>'printedName','relationship',(p_signer->>'authority')||case when coalesce(p_signer->>'authorityOther','')<>'' then ': '||(p_signer->>'authorityOther') else '' end,
   'signedOn',p_signer->>'signedOn','effectiveOn',p.snapshot->>'effectiveOn','reviewOn',p.snapshot->>'reviewOn','packetId',p.id),prior,p.created_by,p.signed_at,auth.uid(),p.id);
 end loop;
 insert into public.consent_packet_evidence values(p.id,p.agency_id,p.individual_id,p_evidence);
 delete from private.consent_packet_tokens where packet_id=p.id;
 perform private.packet_audit(p,'signed');perform private.packet_audit(p,'filed');
 if exists(select 1 from public.memberships m where m.agency_id=p.agency_id and m.user_id=p.created_by and m.role_key in ('house_manager','program_manager','nurse') and (m.expires_on is null or m.expires_on>=current_date)) then
 insert into public.notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
 values(p.agency_id,p.created_by,'consent.packet_signed','Consent packet filed',(p.snapshot->>'individualName')||': signed consent packet filed.','/consents','consent_packet',p.id::text,'consent.packet_signed:'||p.id::text||':'||p.created_by::text) on conflict do nothing;
 end if;
end;
$$;
