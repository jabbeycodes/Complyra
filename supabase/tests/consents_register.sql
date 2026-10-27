begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);
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
-- Temp values remain available across SET ROLE for the actual public entry points.
create temp table consent_test_values(draft jsonb,id uuid);
grant all on consent_test_values to authenticated;
insert into consent_test_values(draft) values(jsonb_build_object(
 'individualId','e7000000-0000-0000-0000-000000000001','typeId','media',
 'covers','Photographs for the agency newsletter.','giver','individual','giverName','Individual One','relationship','Self',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'supersedesId',null,
 'createdBy','d7000000-0000-0000-0000-000000000002','activatedBy','d7000000-0000-0000-0000-000000000002'));
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.individual_consents'::regclass),'Consent RLS is enabled and forced');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.consent_revocations'::regclass),'Revocation RLS is enabled and forced');
select ok(not has_table_privilege('authenticated','public.individual_consents','DELETE'),'No blanket DELETE grant');
select ok(not has_table_privilege('authenticated','public.individual_consents','UPDATE'),'No direct UPDATE grant');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update consent_test_values set id=public.save_consent(null,draft)$$,'HM creates own draft');
select is((select created_by::text from individual_consents),(select auth.uid()::text),'Author is bound to acting user');
select is((select activated_by from individual_consents),null::uuid,'Forged activation metadata is ignored');
select throws_ok($$select public.save_consent(null,jsonb_set(draft,'{individualId}','"e7000000-0000-0000-0000-000000000002"')) from consent_test_values$$,'42501',null,'Cross-home creation denied');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000002"}',true);
select throws_ok($$select public.save_consent(id,draft) from consent_test_values$$,'42501',null,'Peer cannot edit another author draft');
select throws_ok($$select public.activate_consent(id) from consent_test_values$$,'42501',null,'Peer cannot sign another author draft');
select throws_ok($$update individual_consents set created_by=auth.uid()$$,'42501',null,'Cross-user direct tampering denied');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select public.activate_consent(id) from consent_test_values$$,'Author activates');
select is((select activated_by::text from individual_consents),auth.uid()::text,'Signer is bound to acting user');
select throws_ok($$select public.save_consent(id,draft) from consent_test_values$$,'42501',null,'Signed-record mutation via function denied');
select throws_ok($$update individual_consents set details='{}'$$,'42501',null,'Signed-record direct mutation denied');
select throws_ok($$delete from individual_consents$$,'42501',null,'Signed-record deletion denied');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from individual_consents),1,'Supporting DSP can read active consent');
select throws_ok($$select public.revoke_consent(id,current_date,'Forged') from consent_test_values$$,'42501',null,'DSP forged revocation denied');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from individual_consents),1,'Auditor sees consent history');
select throws_ok($$select public.save_consent(null,draft) from consent_test_values$$,'42501',null,'Auditor cannot create');
select throws_ok($$select public.revoke_consent(id,current_date,'Forged') from consent_test_values$$,'42501',null,'Auditor cannot revoke');
select throws_ok($$select public.sweep_consent_alerts('a7000000-0000-0000-0000-000000000001')$$,'42501',null,'Auditor cannot emit alerts');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select throws_ok($$insert into consent_revocations(consent_id,agency_id,individual_id,revoked_on,revoked_by,revoked_by_name,reason) select id,'a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001',current_date,'d7000000-0000-0000-0000-000000000002','Forged nurse','Forged' from consent_test_values$$,'42501',null,'Direct forged revoker denied');
select lives_ok($$select public.revoke_consent(id,current_date,'Individual withdrew consent') from consent_test_values$$,'HM records revocation');
select is((select revoked_by::text from consent_revocations),auth.uid()::text,'Revoker is bound to acting user');
select is((select count(*)::int from individual_consents),1,'Revoking preserves signed version');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from individual_consents),0,'DSP cannot read revoked consent');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from consent_revocations),1,'Auditor reads revocation history');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from individual_consents),0,'HR excluded');
select throws_ok($$select public.save_consent(null,draft) from consent_test_values$$,'42501',null,'HR cannot write');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select sweep_consent_alerts('a7000000-0000-0000-0000-000000000001')$$,'Manager sweep detects missing required consents');
select lives_ok($$select sweep_consent_alerts('a7000000-0000-0000-0000-000000000001')$$,'Repeated sweep is safe');
reset role;
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and type like 'consent.%'),19,'Alerts dedupe per consent and target');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and user_id='d7000000-0000-0000-0000-000000000001' and type like 'consent.%'),9,'Home House Manager receives direct alerts');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and role_key='program_manager' and type like 'consent.%'),9,'Program Manager receives broadcast alerts');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and role_key='nurse' and type like 'consent.%'),1,'Medication consent alerts nurses');
select is((select count(*)::int from notifications where agency_id='a7000000-0000-0000-0000-000000000001' and body like 'Individual Two:%' and type like 'consent.%'),0,'Manager sweep does not expose another home');
insert into notifications(agency_id,user_id,type,title,body,deep_link) values('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','consent.missing','Old manager notice','Legacy notice','/consents');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from notifications where type like 'consent.%'),0,'Auditors cannot receive even a legacy direct consent notice');
select * from finish();
rollback;
