-- UNAPPLIED. Packet signing is the sole new unauthenticated surface. Anonymous
-- callers have NO table/RPC access. The consent-signing Edge Function validates
-- a 256-bit capability using these service-only token functions; finalization
-- locks and consumes that one token transactionally. No account data is returned.
begin;
create table public.consent_packets (
 id uuid primary key default gen_random_uuid(), agency_id uuid not null references public.agencies(id),
 individual_id uuid not null references public.individuals(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 snapshot jsonb not null,status text not null default 'draft' check(status in ('draft','generated','sent','signed','filed')),
 generated_at timestamptz,sent_at timestamptz,opened_at timestamptz,signed_at timestamptz,filed_at timestamptz,link_expires_at timestamptz,
 outstanding_after_days integer not null check(outstanding_after_days between 1 and 90),
 choices jsonb,signer jsonb,evidence_name text
);
create table private.consent_packet_tokens (
 packet_id uuid primary key references public.consent_packets(id),token_hash text not null unique,expires_at timestamptz not null
);
create table public.consent_packet_evidence (
 packet_id uuid primary key references public.consent_packets(id),agency_id uuid not null,individual_id uuid not null,evidence jsonb not null
);
create table public.consent_packet_audit (
 id uuid primary key default gen_random_uuid(),packet_id uuid not null references public.consent_packets(id),
 agency_id uuid not null,individual_id uuid not null,event text not null,at timestamptz not null default now(),
 actor_id uuid,signer_name text,authority text
);
alter table public.individual_consents add column packet_id uuid references public.consent_packets(id);
alter table public.individual_consents drop constraint individual_consents_activation_check;
alter table public.individual_consents add constraint individual_consents_activation_check
 check ((activated_at is null and activated_by is null) or (activated_at is not null and (activated_by is not null or packet_id is not null)));
alter table public.consent_packets enable row level security;
alter table public.consent_packets force row level security;
alter table public.consent_packet_evidence enable row level security;
alter table public.consent_packet_evidence force row level security;
alter table public.consent_packet_audit enable row level security;
alter table public.consent_packet_audit force row level security;
alter table private.consent_packet_tokens enable row level security;
alter table private.consent_packet_tokens force row level security;
create policy consent_packets_read on public.consent_packets for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor}'));
create policy consent_packet_evidence_read on public.consent_packet_evidence for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor}'));
create policy consent_packet_audit_read on public.consent_packet_audit for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor}'));
revoke all on public.consent_packets,public.consent_packet_evidence,public.consent_packet_audit,private.consent_packet_tokens from public,anon,authenticated;
grant select on public.consent_packets,public.consent_packet_evidence,public.consent_packet_audit to authenticated;

create function private.packet_audit(p public.consent_packets,p_event text) returns void
language sql security definer set search_path=public,pg_temp as $$
 insert into public.consent_packet_audit(packet_id,agency_id,individual_id,event,actor_id,signer_name,authority)
 values(p.id,p.agency_id,p.individual_id,p_event,auth.uid(),p.signer->>'printedName',p.signer->>'authority');
$$;
create function private.packet_immutable() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or (tg_table_name<>'consent_packets' and tg_op='UPDATE') then raise exception 'Packet evidence and history are immutable.' using errcode='42501'; end if;
 if tg_table_name='consent_packets' then
  if old.signed_at is not null then raise exception 'Signed packets are immutable.' using errcode='42501'; end if;
  if new.snapshot is distinct from old.snapshot or new.id<>old.id or new.agency_id<>old.agency_id or new.individual_id<>old.individual_id or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Packet identity and content are immutable.' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
create trigger consent_packet_immutable before update or delete on public.consent_packets for each row execute function private.packet_immutable();
create trigger consent_packet_evidence_immutable before update or delete on public.consent_packet_evidence for each row execute function private.packet_immutable();
create trigger consent_packet_audit_immutable before update or delete on public.consent_packet_audit for each row execute function private.packet_immutable();

-- Signed packet rows are generated only after validated completion. The external
-- signer has no account UUID: giverName/relationship and packet.signer retain
-- their identity, while activated_by stays NULL instead of impersonating staff.
create or replace function private.consent_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;
begin
 if tg_op='DELETE' then raise exception 'Consent history cannot be deleted.' using errcode='42501'; end if;
 if tg_op='INSERT' and new.packet_id is not null then
  select * into p from public.consent_packets where id=new.packet_id;
  if p.id is null or p.signed_at is null or p.agency_id<>new.agency_id or p.individual_id<>new.individual_id
   or not exists(select 1 from jsonb_array_elements(p.snapshot->'items') item where item->>'typeId'=new.type_id)
   or (auth.uid() is not null and not private.can_manage_consent(p.agency_id,p.individual_id)) then raise exception 'Invalid signed packet record.' using errcode='42501'; end if;
  new.created_by:=p.created_by;new.created_at:=p.signed_at;new.activated_at:=p.signed_at;new.activated_by:=auth.uid();return new;
 end if;
 if tg_op='UPDATE' then
  if old.activated_at is not null then raise exception 'Signed consent is immutable.' using errcode='42501'; end if;
  if new.id<>old.id or new.agency_id<>old.agency_id or new.individual_id<>old.individual_id or new.type_id<>old.type_id
   or new.supersedes_id is distinct from old.supersedes_id or new.packet_id is distinct from old.packet_id
   or new.created_by<>old.created_by or new.created_at<>old.created_at then raise exception 'Consent identity is immutable.' using errcode='42501'; end if;
  if old.created_by is distinct from auth.uid() then raise exception 'Only the author can change a draft.' using errcode='42501'; end if;
 end if;
 if not private.can_manage_consent(new.agency_id,new.individual_id) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=now();new.activated_at:=null;new.activated_by:=null; end if;
 if new.activated_at is not null then new.activated_by:=auth.uid();new.activated_at:=now(); end if;
 return new;
end;
$$;

create function private.packet_content() returns jsonb language sql immutable set search_path=public,pg_temp as $body$ select $copy${"items":[{"key":"participation","typeId":"service","label":"Participation in agency services","text":"I choose whether the Individual may take part in the services arranged with this agency."},{"key":"photograph","typeId":"photograph","label":"Photographs for identification and recreation","text":"I choose whether identification and recreational photographs may be kept in the case record, including sharing an identification photograph with law enforcement during an emergency."},{"key":"medications","typeId":"medication","label":"Prescribed medication support","text":"I choose whether the agency may support medication administration under physician or psychiatrist orders for medical or mental health needs. Before a non-emergency medication begins, the prescriber explains its purpose and possible side effects."},{"key":"emergency","typeId":"emergency","label":"Urgent medical assistance","text":"I choose whether emergency medical care, including surgery when needed, may be arranged when the guardian cannot be reached."},{"key":"outings","typeId":"outings","label":"Supported community activities","text":"I choose whether the Individual may join activities away from home with education, support, and oversight appropriate to the activity."},{"key":"law_enforcement","typeId":"law_enforcement","label":"Safety coordination with law enforcement","text":"I choose whether the agency may contact police and provide relevant information when the Individual is missing or there is a safety concern."},{"key":"information","typeId":"information","label":"Health information exchange","text":"I choose whether the agency may exchange the listed health information with healthcare providers to keep the required medical file current and support coordinated care. This permission lasts while the agency provides residential services, subject to the review date shown. I may end it by written notice; that notice cannot reverse information already shared. I receive a copy. My choice is voluntary and does not determine treatment, payment, or eligibility."},{"key":"rights","typeId":"rights","label":"Rights information and grievance process","text":"I received the state Individual Rights publication and this agency's grievance procedure. I was offered time to read them, discuss concerns, and ask questions."},{"key":"media","typeId":"media","label":"Public media and social media","text":"Choose how names, event information, photographs, sound recordings, and video may be used for recreation or promotion in public settings: full permission, group photographs only, or no permission."}],"healthScope":["Visit notes: specialists, urgent care, emergency department, and annual physicals","Mental health assessments and recommendations","Immunization records","Laboratory and other test results","Prescriber orders","Behavior reports"],"copyVersion":"complyrer-consents-2026-10-v1"}$copy$::jsonb; $body$;
create function public.create_consent_packet(p_input jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.individuals;a_name text;result uuid;snapshot jsonb;
begin
 select * into i from public.individuals where id=(p_input->>'individualId')::uuid;
 if i.id is null or not private.can_manage_consent(i.agency_id,i.id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 if length(trim(coalesce(p_input->>'signerName','')))=0 or (p_input->>'outstandingAfterDays')::int not between 1 and 90
 or p_input->>'effectiveOn' is null or p_input->>'reviewOn' is null or (p_input->>'reviewOn')::date<(p_input->>'effectiveOn')::date then raise exception 'Specify signer, valid dates, and outstanding window.'; end if;
 if exists(select 1 from jsonb_array_elements(private.packet_content()->'items') item where not exists(select 1 from jsonb_array_elements(private.consent_types(i.agency_id)) t where t->>'id'=item->>'typeId')) then raise exception 'Restore the packet consent types in agency settings.'; end if;
 select name into a_name from public.agencies where id=i.agency_id;
 snapshot:=private.packet_content()||jsonb_build_object('individualName',i.full_name,'agencyName',a_name,'signerName',p_input->>'signerName','effectiveOn',p_input->>'effectiveOn','reviewOn',p_input->>'reviewOn');
 insert into public.consent_packets(agency_id,individual_id,created_by,snapshot,outstanding_after_days)
 values(i.agency_id,i.id,auth.uid(),snapshot,(p_input->>'outstandingAfterDays')::int) returning id into result;
 perform private.packet_audit(p,'draft') from public.consent_packets p where id=result;return result;
end;
$$;
create function public.generate_consent_packet(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;
begin
 select * into p from public.consent_packets where id=p_id for update;
 if p.id is null or not private.can_manage_consent(p.agency_id,p.individual_id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 if p.status not in ('draft','generated') then raise exception 'Packet already sent or signed.'; end if;
 update public.consent_packets set status='generated',generated_at=coalesce(generated_at,now()) where id=p_id returning * into p;
 perform private.packet_audit(p,'generated');
end;
$$;
create function public.send_consent_packet(p_id uuid,p_days integer) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;token text;
begin
 select * into p from public.consent_packets where id=p_id for update;
 if p.id is null or not private.can_manage_consent(p.agency_id,p.individual_id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 if p.status not in ('generated','sent') or p_days is null or p_days not between 1 and 30 then raise exception 'Generate the packet and choose a link expiry from 1 to 30 days.'; end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into private.consent_packet_tokens values(p.id,encode(extensions.digest(token,'sha256'),'hex'),now()+make_interval(days=>p_days))
 on conflict(packet_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
 update public.consent_packets set status='sent',sent_at=now(),link_expires_at=now()+make_interval(days=>p_days) where id=p.id returning * into p;
 perform private.packet_audit(p,'sent');return token;
end;
$$;
create function private.validate_packet_submission(p_choices jsonb,p_signer jsonb,p public.consent_packets) returns void
language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;f text;
begin
 if jsonb_typeof(p_choices) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_choices))<>9 then raise exception 'Complete all nine packet choices.'; end if;
 for item in select * from jsonb_array_elements(p.snapshot->'items') loop
  if coalesce(p_choices->>(item->>'key'),'')<>all(case when item->>'key'='media' then array['full','group','none'] else array['yes','no'] end) then raise exception 'Invalid packet choice.'; end if;
 end loop;
 foreach f in array array['printedName','signature','witness'] loop
  if length(trim(coalesce(p_signer->>f,''))) not between 1 and 500 then raise exception 'Complete signer, signature, and witness.'; end if;
 end loop;
 if p_signer->'accepted' is distinct from 'true'::jsonb or coalesce(p_signer->>'authority','') not in ('Self','Parent','Guardian','Medical Power of Attorney','Other') or (p_signer->>'authority'='Other' and length(trim(coalesce(p_signer->>'authorityOther','')))=0) then raise exception 'State legal authority and signing agreement.'; end if;
 if p_signer->>'signedOn' is null or (p_signer->>'signedOn') !~ '^\d{4}-\d{2}-\d{2}$' or (p_signer->>'signedOn')::date>current_date or (p_signer->>'signedOn')::date>(p.snapshot->>'reviewOn')::date then raise exception 'Use a valid signing date.'; end if;
end;
$$;
create function private.complete_consent_packet(p_id uuid,p_choices jsonb,p_signer jsonb,p_evidence jsonb,p_external boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;item jsonb;prior uuid;content bytea;
begin
 select * into p from public.consent_packets where id=p_id for update;
 if p.id is null or p.signed_at is not null or p.status='draft' then raise exception 'Packet unavailable or already signed.' using errcode='42501'; end if;
 if not p_external and not private.can_manage_consent(p.agency_id,p.individual_id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 perform private.validate_packet_submission(p_choices,p_signer,p);
 content:=decode(p_evidence->>'base64','base64');
 if content is null or octet_length(content) not between 1 and 10485760 or length(coalesce(p_evidence->>'name',''))=0 then raise exception 'Attach signed evidence up to 10 MB.'; end if;
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
create function public.file_paper_consent_packet(p_id uuid,p_choices jsonb,p_signer jsonb,p_evidence jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform private.complete_consent_packet(p_id,p_choices,p_signer,p_evidence,false); end;
$$;
create function public.get_consent_packet_evidence(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;result jsonb;
begin
 select * into p from public.consent_packets where id=p_id;
 if p.id is null or not private.can_read_individual(p.agency_id,p.individual_id) or not private.role_key_in(p.agency_id,'{house_manager,program_manager,nurse,auditor}') then raise exception 'Packet access denied.' using errcode='42501'; end if;
 select evidence into result from public.consent_packet_evidence where packet_id=p_id;return result;
end;
$$;
-- Service-only bridge. Token is the only lookup input: never accept packet,
-- agency or Individual identifiers on the public signing path.
create function public.read_consent_packet_token(p_token text,p_open boolean default true) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;t private.consent_packet_tokens;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Signing link is unavailable or expired.' using errcode='42501'; end if;
 select * into t from private.consent_packet_tokens where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 if t.packet_id is null or t.expires_at<=now() then raise exception 'Signing link is unavailable or expired.' using errcode='42501'; end if;
 select * into p from public.consent_packets where id=t.packet_id for update;
 select * into t from private.consent_packet_tokens where packet_id=p.id and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if t.packet_id is null or t.expires_at<=now() then raise exception 'Signing link is unavailable or expired.' using errcode='42501'; end if;
 if p.status<>'sent' or p.signed_at is not null then raise exception 'Signing link is unavailable or expired.' using errcode='42501'; end if;
 if p_open then
  update public.consent_packets set opened_at=coalesce(opened_at,now()) where id=p.id returning * into p;
  perform private.packet_audit(p,'opened');
 end if;
 return jsonb_build_object('id',p.id,'snapshot',p.snapshot);
end;
$$;
create function public.complete_consent_packet_token(p_token text,p_choices jsonb,p_signer jsonb,p_evidence jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p_id uuid;
begin
 -- Locks token until completion commits: replay/racing submissions cannot win twice.
 p_id:=(public.read_consent_packet_token(p_token,false)->>'id')::uuid;
 perform private.complete_consent_packet(p_id,p_choices,p_signer,p_evidence,true);
end;
$$;
create function private.sweep_packet_alerts(p_agency_id uuid,p_scoped boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;t record;
begin
 for p in select cp.*,i.site_id from public.consent_packets cp join public.individuals i on i.id=cp.individual_id where cp.agency_id=p_agency_id and cp.status='sent' and cp.sent_at+make_interval(days=>cp.outstanding_after_days)<=now() and (not p_scoped or private.can_read_individual(cp.agency_id,cp.individual_id)) loop
  for t in select distinct m.user_id,null::text role_key,m.user_id::text target from public.memberships m where m.agency_id=p_agency_id and m.role_key='house_manager' and (m.site_id is null or m.site_id=p.site_id) and (m.expires_on is null or m.expires_on>=current_date)
   union all select null::uuid,'program_manager','program_manager'
   union all select null::uuid,'nurse','nurse' loop
   insert into public.notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
   values(p_agency_id,t.user_id,t.role_key,'consent.packet_outstanding','Outstanding consent packet',(p.snapshot->>'individualName')||': consent packet remains unsigned.','/consents','consent_packet',p.id::text,'consent.packet_outstanding:'||p.id::text||':'||t.target) on conflict do nothing;
  end loop;
 end loop;
end;
$$;
create or replace function public.sweep_consent_alerts(p_agency_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not private.has_agency(p_agency_id) or not private.role_key_in(p_agency_id,'{house_manager,program_manager,nurse}') then raise exception 'Consent access denied.' using errcode='42501'; end if;
 perform private.sweep_consents(p_agency_id,true);perform private.sweep_packet_alerts(p_agency_id,true);
end;
$$;
create or replace function private.sweep_all_consents() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare a record;
begin for a in select id from public.agencies where status='active' loop perform private.sweep_consents(a.id,false);perform private.sweep_packet_alerts(a.id,false);end loop;end;
$$;
revoke all on function private.packet_audit(public.consent_packets,text),private.packet_immutable(),private.packet_content(),private.validate_packet_submission(jsonb,jsonb,public.consent_packets),private.complete_consent_packet(uuid,jsonb,jsonb,jsonb,boolean),private.sweep_packet_alerts(uuid,boolean) from public,anon,authenticated;
revoke all on function public.create_consent_packet(jsonb),public.generate_consent_packet(uuid),public.send_consent_packet(uuid,integer),public.file_paper_consent_packet(uuid,jsonb,jsonb,jsonb),public.get_consent_packet_evidence(uuid),public.read_consent_packet_token(text,boolean),public.complete_consent_packet_token(text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_consent_packet(jsonb),public.generate_consent_packet(uuid),public.send_consent_packet(uuid,integer),public.file_paper_consent_packet(uuid,jsonb,jsonb,jsonb),public.get_consent_packet_evidence(uuid) to authenticated;
grant execute on function public.read_consent_packet_token(text,boolean),public.complete_consent_packet_token(text,jsonb,jsonb,jsonb) to service_role;
commit;
