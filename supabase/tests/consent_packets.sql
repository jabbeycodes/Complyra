begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a7000000-0000-0000-0000-000000000001','Consent test agency','CONSENT-MO','MO','active');
insert into programs(id,agency_id,name) values ('b7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','Consent test program');
insert into sites(id,agency_id,program_id,name) values
 ('c7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001','Home One'),
 ('c7000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001','Home Two');
insert into auth.users(id,email) values
 ('d7000000-0000-0000-0000-000000000001','consent-hm@example.invalid'),
 ('d7000000-0000-0000-0000-000000000002','consent-peer@example.invalid'),
 ('d7000000-0000-0000-0000-000000000003','consent-auditor@example.invalid'),
 ('d7000000-0000-0000-0000-000000000004','consent-dsp@example.invalid'),
 ('d7000000-0000-0000-0000-000000000005','consent-hr@example.invalid');
update profiles set must_change_password=false,home_agency_id='a7000000-0000-0000-0000-000000000001' where id::text like 'd7000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','manager','house_manager','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','nurse','nurse','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','auditor','auditor',null),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000004','dsp','dsp','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000005','hr','hr',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','Individual One','1980-01-01'),
 ('e7000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000002','Individual Two','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000004','e7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001');
create temp table packet_values(existing_id uuid,first_id uuid,second_id uuid,token text,second_token text,choices jsonb,signer jsonb,evidence jsonb);
grant all on packet_values to authenticated,service_role;
insert into packet_values(choices,signer,evidence) values(
 '{"rights":"yes","information":"yes","participation":"yes","photograph":"no","medications":"yes","emergency":"yes","outings":"yes","law_enforcement":"yes","media":"group"}',
 jsonb_build_object('printedName','Jordan Lee','authority','Guardian','authorityOther','','signature','Jordan Lee','witness','Taylor Witness','signedOn',current_date::text,'accepted',true),
 jsonb_build_object('name','Signed packet.pdf','mime','application/pdf','base64',encode(convert_to('%PDF-1.7 test','UTF8'),'base64')));
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.consent_packets'::regclass),'Packet RLS enabled and forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.consent_packet_tokens'::regclass),'Token RLS enabled and forced');
select ok(not has_function_privilege('anon','public.read_consent_packet_token(text,boolean)','EXECUTE'),'Anonymous cannot call token database bridge');
select ok(not has_function_privilege('authenticated','public.complete_consent_packet_token(text,jsonb,jsonb,jsonb)','EXECUTE'),'Authenticated staff cannot bypass token service');
select ok(not has_table_privilege('anon','private.consent_packet_tokens','SELECT'),'No public token enumeration');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
update packet_values set first_id=create_consent_packet(jsonb_build_object('individualId','e7000000-0000-0000-0000-000000000001','signerName','Jordan Lee','effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'outstandingAfterDays',7));
update packet_values set second_id=create_consent_packet(jsonb_build_object('individualId','e7000000-0000-0000-0000-000000000001','signerName','Another signer','effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'outstandingAfterDays',7));
select generate_consent_packet(first_id) from packet_values;
select generate_consent_packet(second_id) from packet_values;
update packet_values set token=send_consent_packet(first_id,14),second_token=send_consent_packet(second_id,14);
select is((select snapshot->>'agencyName' from consent_packets limit 1),'Consent test agency','Agency name is from settings');
select throws_ok($$update consent_packets set status='filed'$$,'42501',null,'Direct packet status forgery denied');
-- A packet must supersede an already-current standalone decision, rather than
-- merely adding a second chain that a DSP could read alongside it.
update packet_values set existing_id=save_consent(null,jsonb_build_object(
 'individualId','e7000000-0000-0000-0000-000000000001','typeId','media','covers','No public media permission.',
 'giver','individual','giverName','Individual One','relationship','Self','outcome','none',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'supersedesId',null));
select activate_consent(existing_id) from packet_values;

reset role;
-- Expire one link without touching the first packet.
update private.consent_packet_tokens set expires_at=now()-interval '1 second' where packet_id=(select second_id from packet_values);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select (read_consent_packet_token(token)->>'id')::uuid from packet_values),(select first_id from packet_values),'Token reads only its named packet');
select is((select count(*)::int from jsonb_object_keys((select read_consent_packet_token(token) from packet_values))),2,'Public response contains only packet id and snapshot');
select throws_ok($$select read_consent_packet_token(second_token) from packet_values$$,'42501',null,'Expired token cannot read');
select throws_ok($$select complete_consent_packet_token(second_token,choices,signer,evidence) from packet_values$$,'42501',null,'Expired token cannot complete');
select throws_ok($$select read_consent_packet_token(repeat('0',64))$$,'42501',null,'Unknown token denied uniformly');
select throws_ok($$select complete_consent_packet_token(token,choices||jsonb_build_object('packetId',second_id),signer,evidence) from packet_values$$,'P0001',null,'Token submission cannot target a different packet');
select lives_ok($$select complete_consent_packet_token(token,choices,signer,evidence) from packet_values$$,'Token completes its packet once');
select throws_ok($$select complete_consent_packet_token(token,choices,signer,evidence) from packet_values$$,'42501',null,'Second submission rejected');
select throws_ok($$select read_consent_packet_token(token) from packet_values$$,'42501',null,'Used token cannot reopen packet');
reset role;
select is((select status from consent_packets where id=(select second_id from packet_values)),'sent','Another packet remains untouched');
select is((select count(*)::int from individual_consents where packet_id=(select first_id from packet_values)),9,'All nine packet items tracked');
select is((select supersedes_id from individual_consents where packet_id=(select first_id from packet_values) and type_id='media'),(select existing_id from packet_values),'Packet completion supersedes the pre-existing current media decision');
select is((select count(*)::int from individual_consents where type_id='media' and private.consent_current(id)),1,'Packet leaves exactly one current media version');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from individual_consents where type_id='media'),1,'DSP sees only the packet replacement media version');
select is((select packet_id from individual_consents where type_id='media'),(select first_id from packet_values),'DSP-visible media decision belongs to the completed packet');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

select is((select details->>'outcome' from individual_consents where packet_id=(select first_id from packet_values) and type_id='photograph'),'no','No permission is preserved explicitly');
select throws_ok($$update consent_packets set snapshot='{}' where id=(select first_id from packet_values)$$,'42501',null,'Signed packet is immutable even for direct owner writes');
select throws_ok($$update individual_consents set details='{}' where packet_id=(select first_id from packet_values)$$,'42501',null,'Signed packet consent records immutable');
select is((select count(*)::int from consent_packet_audit where packet_id=(select first_id from packet_values) and event in ('sent','opened','signed','filed')),5,'Sent, opened, signed and filed events remain in audit history');
select is((select count(*)::int from private.consent_packet_tokens where packet_id=(select first_id from packet_values)),0,'Successful completion consumes token');
update consent_packets set sent_at=now()-interval '10 days' where id=(select second_id from packet_values);
select private.sweep_packet_alerts('a7000000-0000-0000-0000-000000000001',false);
select private.sweep_packet_alerts('a7000000-0000-0000-0000-000000000001',false);
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and type='consent.packet_outstanding'),3,'Outstanding packet alerts dedupe');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and type='consent.packet_outstanding' and user_id='d7000000-0000-0000-0000-000000000001'),1,'Outstanding packet targets home manager');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and type='consent.packet_outstanding' and role_key='program_manager'),1,'Outstanding packet broadcasts to Program Managers');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and type='consent.packet_outstanding' and role_key='nurse'),1,'Packet containing medication decision alerts nurses');
select * from finish();
rollback;
