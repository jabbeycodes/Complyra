begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);
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
create temp table version_values(draft jsonb,original uuid,duplicate uuid,renewal uuid,scheduled_original uuid,scheduled uuid);
grant all on version_values to authenticated;
insert into version_values(draft) values(jsonb_build_object(
 'individualId','e7000000-0000-0000-0000-000000000001','typeId','media','covers','Public media choices.',
 'giver','individual','giverName','Individual One','relationship','Self','outcome','none',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+365)::text,'supersedesId',null));
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
update version_values set original=save_consent(null,draft);
select activate_consent(original) from version_values;
update version_values set duplicate=save_consent(null,draft||'{"outcome":"full"}');
select throws_ok($$select activate_consent(duplicate) from version_values$$,'23514','Another consent covers this period. Renew the existing version or revoke it before the new effective date.','Contradictory standalone activation is denied with a clear error');
select is((select activated_at from individual_consents where id=(select duplicate from version_values)),null::timestamptz,'Rejected duplicate remains an unsigned draft');
update version_values set renewal=save_consent(null,draft||jsonb_build_object('supersedesId',original,'outcome','full'));
select lives_ok($$select activate_consent(renewal) from version_values$$,'Proper linked renewal activates');
select is((select count(*)::int from individual_consents where type_id='media' and private.consent_current(id)),1,'Proper renewal leaves exactly one current version');
select is((select private.consent_current(original) from version_values),false,'Predecessor is no longer current');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from individual_consents where type_id='media'),1,'DSP-scoped read returns exactly one media version');
select is((select id from individual_consents where type_id='media'),(select renewal from version_values),'DSP receives the linked renewal, never both decisions');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
update version_values set scheduled_original=save_consent(null,draft||'{"typeId":"service"}');
select activate_consent(scheduled_original) from version_values;
update version_values set scheduled=save_consent(null,draft||jsonb_build_object('typeId','service','supersedesId',scheduled_original,'effectiveOn',(current_date+10)::text));
select lives_ok($$select activate_consent(scheduled) from version_values$$,'Future linked renewal can be signed now');
select is((select id from individual_consents where type_id='service' and private.consent_current(id)),(select scheduled_original from version_values),'Predecessor remains current before the scheduled effective date');
select throws_ok($$select activate_consent(save_consent(null,draft||jsonb_build_object('typeId','service','effectiveOn',(current_date+20)::text))) from version_values$$,'23514',null,'A standalone future overlap is rejected before it can become current');
reset role;
select is((select count(*)::int from individual_consents where type_id='service' and private.consent_current_at(id,current_date+10)),1,'Exactly one version is current on the scheduled handoff day');
select is((select id from individual_consents where type_id='service' and private.consent_current_at(id,current_date+10)),(select scheduled from version_values),'Scheduled successor becomes the sole current version on its effective date');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select revoke_consent(renewal,current_date,'Permission withdrawn') from version_values;
select lives_ok($$select activate_consent(duplicate) from version_values$$,'Explicit revocation permits a standalone replacement from that date');
select is((select count(*)::int from individual_consents where type_id='media' and private.consent_current(id)),1,'Revocation followed by replacement still leaves one current version');
select throws_ok($$select activate_consent(save_consent(null,draft||jsonb_build_object('typeId','service','supersedesId',scheduled,'effectiveOn',(current_date+9)::text))) from version_values$$,'23514',null,'Renewals cannot backdate before their predecessor and re-expose earlier decisions');
select * from finish();
rollback;
