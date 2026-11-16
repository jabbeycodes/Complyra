-- consent_notice_admin_read.sql — pgTAP coverage for Wave 4A
-- (migration 20261105110000_consent_notices_administrator_read.sql):
-- the restrictive consent_notification_roles policy must let an
-- administrator read the role-addressed consent alerts the sweep mints
-- for the administrator role, while auditors stay excluded.
-- Before 20261105110000 the administrator count below is 0.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(7);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a8200000-0000-0000-0000-000000000001','Consent admin read agency','CADMIN-MO','MO','active');
insert into programs(id,agency_id,name) values ('b8200000-0000-0000-0000-000000000001','a8200000-0000-0000-0000-000000000001','Admin read program');
insert into sites(id,agency_id,program_id,name) values
 ('c8200000-0000-0000-0000-000000000001','a8200000-0000-0000-0000-000000000001','b8200000-0000-0000-0000-000000000001','Home One');
insert into auth.users(id,email) values
 ('d8200000-0000-0000-0000-000000000001','admin-read-hm@example.invalid'),
 ('d8200000-0000-0000-0000-000000000002','admin-read-admin@example.invalid'),
 ('d8200000-0000-0000-0000-000000000003','admin-read-auditor@example.invalid');
update profiles set must_change_password=false where id in
 ('d8200000-0000-0000-0000-000000000001','d8200000-0000-0000-0000-000000000002','d8200000-0000-0000-0000-000000000003');
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a8200000-0000-0000-0000-000000000001','d8200000-0000-0000-0000-000000000001','manager','house_manager','c8200000-0000-0000-0000-000000000001'),
 ('a8200000-0000-0000-0000-000000000001','d8200000-0000-0000-0000-000000000002','administrator','administrator',null),
 ('a8200000-0000-0000-0000-000000000001','d8200000-0000-0000-0000-000000000003','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e8200000-0000-0000-0000-000000000001','a8200000-0000-0000-0000-000000000001','c8200000-0000-0000-0000-000000000001','Individual One','1980-01-01');

-- No consent record exists: every required type alerts for every recipient.
select lives_ok($$select private.sweep_consents('a8200000-0000-0000-0000-000000000001',false)$$,'Sweep runs');
select ok((select count(*) from notifications where agency_id='a8200000-0000-0000-0000-000000000001' and role_key='administrator' and type='consent.missing') > 0,
 'The sweep mints administrator role alerts (20261104120000)');
-- An auditor-addressed consent row, to prove auditors stay excluded.
insert into notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key) values
 ('a8200000-0000-0000-0000-000000000001',null,'auditor','consent.missing','Consent needs attention','x','/consents','consent','e8200000-0000-0000-0000-000000000001:service','consent.missing:test:role:auditor');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8200000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from notifications where agency_id='a8200000-0000-0000-0000-000000000001' and type like 'consent.%'),
 9,
 'The administrator reads one consent alert per required type (9 default types)');
select is((select count(*)::int from notifications where agency_id='a8200000-0000-0000-0000-000000000001' and type like 'consent.%' and role_key<>'administrator'),0,
 'The administrator reads only administrator-addressed consent rows');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8200000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from notifications where agency_id='a8200000-0000-0000-0000-000000000001' and type like 'consent.%'),9,
 'The house manager still reads her direct consent alerts');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8200000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from notifications where agency_id='a8200000-0000-0000-0000-000000000001' and type like 'consent.%'),0,
 'An auditor never reads consent alerts, even one addressed to the auditor role');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='consent_notification_roles' and permissive='RESTRICTIVE'),
 'consent_notification_roles stays restrictive');
reset role;
select * from finish();
rollback;
