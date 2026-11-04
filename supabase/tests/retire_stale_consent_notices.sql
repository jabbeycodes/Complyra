-- retire_stale_consent_notices.sql — pgTAP coverage for sim wave 6
-- item 8 (migration 20261031220000_retire_stale_consent_notices.sql):
-- a consent.missing / consent.expiring notice retires (is marked
-- read) once a current consent covers that Individual + type, a
-- consent.packet_outstanding notice retires once its packet leaves
-- 'sent', rights-packet rows that reuse the consent types always
-- survive, Individuals still missing/expired keep their notices, and
-- cross-agency / wrong-role calls are refused. Runs in CI (no local
-- harness).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a8100000-0000-0000-0000-000000000001','Retire test agency A','RETIREA-MO','MO','active'),
 ('a8100000-0000-0000-0000-000000000002','Retire test agency B','RETIREB-MO','MO','active');
insert into programs(id,agency_id,name) values
 ('b8100000-0000-0000-0000-000000000001','a8100000-0000-0000-0000-000000000001','Program A'),
 ('b8100000-0000-0000-0000-000000000002','a8100000-0000-0000-0000-000000000002','Program B');
insert into sites(id,agency_id,program_id,name) values
 ('c8100000-0000-0000-0000-000000000001','a8100000-0000-0000-0000-000000000001','b8100000-0000-0000-0000-000000000001','Home A'),
 ('c8100000-0000-0000-0000-000000000002','a8100000-0000-0000-0000-000000000002','b8100000-0000-0000-0000-000000000002','Home B');
insert into auth.users(id,email) values
 ('d8100000-0000-0000-0000-000000000001','retire-hm-a@example.invalid'),
 ('d8100000-0000-0000-0000-000000000002','retire-hm-b@example.invalid'),
 ('d8100000-0000-0000-0000-000000000003','retire-auditor@example.invalid');
update profiles set must_change_password=false,home_agency_id='a8100000-0000-0000-0000-000000000001'
 where id in ('d8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000003');
update profiles set must_change_password=false,home_agency_id='a8100000-0000-0000-0000-000000000002'
 where id='d8100000-0000-0000-0000-000000000002';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','manager','house_manager','c8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000002','d8100000-0000-0000-0000-000000000002','manager','house_manager','c8100000-0000-0000-0000-000000000002'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000003','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e8100000-0000-0000-0000-000000000001','a8100000-0000-0000-0000-000000000001','c8100000-0000-0000-0000-000000000001','Resolved Person','1980-01-01'),
 ('e8100000-0000-0000-0000-000000000002','a8100000-0000-0000-0000-000000000001','c8100000-0000-0000-0000-000000000001','Still Missing Person','1980-01-01'),
 ('e8100000-0000-0000-0000-000000000003','a8100000-0000-0000-0000-000000000002','c8100000-0000-0000-0000-000000000002','Other Agency Person','1980-01-01');

create temp table consent_retire_values(kind text,id uuid);
grant all on consent_retire_values to authenticated;

-- 1: the RPC is executable by authenticated callers (the guard inside
-- does the real authorization, mirroring the missing-note retire).
select ok(has_function_privilege('authenticated','public.retire_stale_consent_notices(uuid,uuid)','EXECUTE'),
 'Authenticated can execute retire_stale_consent_notices');

-- Person One's consents, created through the real signing RPCs as
-- their home house manager: media is current with a review a year
-- out; service is current but inside the 30-day expiring window.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8100000-0000-0000-0000-000000000001"}',true);
insert into consent_retire_values(kind,id) select 'media', public.save_consent(null, jsonb_build_object(
 'individualId','e8100000-0000-0000-0000-000000000001','typeId','media',
 'covers','Photographs for the agency newsletter.','giver','individual','giverName','Resolved Person','relationship','Self',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'supersedesId',null));
select public.activate_consent(id) from consent_retire_values where kind='media';
insert into consent_retire_values(kind,id) select 'service', public.save_consent(null, jsonb_build_object(
 'individualId','e8100000-0000-0000-0000-000000000001','typeId','service',
 'covers','Participation in agency services.','giver','individual','giverName','Resolved Person','relationship','Self',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+10)::text,'supersedesId',null));
select public.activate_consent(id) from consent_retire_values where kind='service';
reset role;

-- Packets and notices, seeded directly. The rights packet is an
-- awaiting-signature packet for Person One; its notices reuse the
-- consent types, exactly like the rights tracker produces.
insert into public.rights_packets(id,agency_id,individual_id,created_by,signer_name,copy_version) values
 ('f8100000-0000-0000-0000-000000000001','a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','Dana Hart','complyrer-rights-2026-10-v1');
insert into public.consent_packets(id,agency_id,individual_id,created_by,snapshot,status,signed_at,filed_at,outstanding_after_days) values
 ('f8100000-0000-0000-0000-000000000002','a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','{}'::jsonb,'filed',now(),now(),7),
 ('f8100000-0000-0000-0000-000000000003','a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','{}'::jsonb,'sent',null,null,7);

insert into public.notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key) values
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.missing','Consent needs attention','Resolved Person: media','/consents','consent','e8100000-0000-0000-0000-000000000001:media','consent.missing:e8100000-0000-0000-0000-000000000001:media:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.missing','Consent needs attention','Resolved Person: service','/consents','consent','e8100000-0000-0000-0000-000000000001:service','consent.missing:e8100000-0000-0000-0000-000000000001:service:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.missing','Consent needs attention','Resolved Person: emergency','/consents','consent','e8100000-0000-0000-0000-000000000001:emergency','consent.missing:e8100000-0000-0000-0000-000000000001:emergency:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.missing','Rights packet not yet signed','Resolved Person: rights packet','/consents','rights_packet','f8100000-0000-0000-0000-000000000001','rights.missing:f8100000-0000-0000-0000-000000000001:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001',null,'program_manager','consent.missing','Rights packet not yet signed','Resolved Person: rights packet','/consents','consent','f8100000-0000-0000-0000-000000000001','consent.missing:f8100000-0000-0000-0000-000000000001:role:program_manager'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.packet_outstanding','Outstanding consent packet','Resolved Person: packet filed','/consents','consent_packet','f8100000-0000-0000-0000-000000000002','consent.packet_outstanding:f8100000-0000-0000-0000-000000000002:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.packet_outstanding','Outstanding consent packet','Resolved Person: packet still sent','/consents','consent_packet','f8100000-0000-0000-0000-000000000003','consent.packet_outstanding:f8100000-0000-0000-0000-000000000003:d8100000-0000-0000-0000-000000000001'),
 ('a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001',null,'consent.missing','Consent needs attention','Still Missing Person: media','/consents','consent','e8100000-0000-0000-0000-000000000002:media','consent.missing:e8100000-0000-0000-0000-000000000002:media:d8100000-0000-0000-0000-000000000001');
insert into public.notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
 select 'a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','consent.missing','Consent needs attention','Resolved Person: media (consent id)','/consents','consent',id::text,'consent.missing:'||id::text||':d8100000-0000-0000-0000-000000000001'
 from consent_retire_values where kind='media';
insert into public.notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
 select 'a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','consent.expiring','Consent expiring soon','Resolved Person: media','/consents','consent',id::text,'consent.expiring:'||id::text||':d8100000-0000-0000-0000-000000000001'
 from consent_retire_values where kind='media';
insert into public.notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
 select 'a8100000-0000-0000-0000-000000000001','d8100000-0000-0000-0000-000000000001','consent.expiring','Consent expiring soon','Resolved Person: service','/consents','consent',id::text,'consent.expiring:'||id::text||':d8100000-0000-0000-0000-000000000001'
 from consent_retire_values where kind='service';

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8100000-0000-0000-0000-000000000001"}',true);
-- 2: exactly the five resolved rows retire — missing media (composite
-- and consent-id linkage), missing service (a current consent inside
-- its expiring window still clears a *missing* notice), expiring
-- media (review a year out), and the filed packet's outstanding row.
select is(public.retire_stale_consent_notices('a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001'),5,
 'Retire clears exactly the resolved consent notices for Person One');
-- 3: Person Two has no consents at all — nothing may retire.
select is(public.retire_stale_consent_notices('a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000002'),0,
 'Retire is a no-op for an Individual still missing every consent');
-- 4: auditors are not consent managers — the call is refused.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8100000-0000-0000-0000-000000000003"}',true);
select throws_ok($$select public.retire_stale_consent_notices('a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001')$$,'P0001','Not allowed',
 'Auditor cannot retire consent notices');
-- 5: another agency's manager cannot retire this agency's notices.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8100000-0000-0000-0000-000000000002"}',true);
select throws_ok($$select public.retire_stale_consent_notices('a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000001')$$,'P0001','Not allowed',
 'Cross-agency call is refused');
-- 6: a mismatched agency / Individual pair is refused, not a no-op
-- sweep of the other agency's rows.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8100000-0000-0000-0000-000000000001"}',true);
select throws_ok($$select public.retire_stale_consent_notices('a8100000-0000-0000-0000-000000000001','e8100000-0000-0000-0000-000000000003')$$,'P0001','Not allowed',
 'Individual from another agency is refused');
reset role;

-- 7–11: the retired rows are marked read.
select is((select read_at is not null from notifications where dedupe_key='consent.missing:e8100000-0000-0000-0000-000000000001:media:d8100000-0000-0000-0000-000000000001'),true,
 'Missing media notice (composite entity) is retired');
select is((select read_at is not null from notifications where dedupe_key like 'consent.missing:%' and entity_id=(select id::text from consent_retire_values where kind='media')),true,
 'Missing media notice (consent-id entity) is retired');
select is((select read_at is not null from notifications where dedupe_key like 'consent.expiring:%' and entity_id=(select id::text from consent_retire_values where kind='media')),true,
 'Expiring media notice retires when the current consent review is over 30 days out');
select is((select read_at is not null from notifications where dedupe_key='consent.missing:e8100000-0000-0000-0000-000000000001:service:d8100000-0000-0000-0000-000000000001'),true,
 'Missing service notice retires — the consent is current even though it is expiring soon');
select is((select read_at is not null from notifications where dedupe_key='consent.packet_outstanding:f8100000-0000-0000-0000-000000000002:d8100000-0000-0000-0000-000000000001'),true,
 'Outstanding notice retires once the packet is filed');

-- 12–17: everything still warranted — or exempt — stays unread.
select is((select read_at is not null from notifications where dedupe_key like 'consent.expiring:%' and entity_id=(select id::text from consent_retire_values where kind='service')),false,
 'Expiring service notice survives — its consent is still inside the expiring window');
select is((select read_at is not null from notifications where dedupe_key='consent.missing:e8100000-0000-0000-0000-000000000001:emergency:d8100000-0000-0000-0000-000000000001'),false,
 'Missing emergency notice survives — no consent covers that type');
select is((select read_at is not null from notifications where dedupe_key='rights.missing:f8100000-0000-0000-0000-000000000001:d8100000-0000-0000-0000-000000000001'),false,
 'Rights-packet notice (rights dedupe namespace) survives');
select is((select read_at is not null from notifications where dedupe_key='consent.missing:f8100000-0000-0000-0000-000000000001:role:program_manager'),false,
 'Rights-packet notice survives even stored with a consent entity type');
select is((select read_at is not null from notifications where dedupe_key='consent.packet_outstanding:f8100000-0000-0000-0000-000000000003:d8100000-0000-0000-0000-000000000001'),false,
 'Outstanding notice survives while its packet is still sent');
select is((select read_at is not null from notifications where dedupe_key='consent.missing:e8100000-0000-0000-0000-000000000002:media:d8100000-0000-0000-0000-000000000001'),false,
 'Still-missing Individual keeps their notice');

select * from finish();
rollback;
