begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a9000000-0000-0000-0000-000000000001','Consent Central agency','CCENT-MO','MO','active');
insert into programs(id,agency_id,name) values ('b9000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','Central program');
insert into sites(id,agency_id,program_id,name) values
 ('c9000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','b9000000-0000-0000-0000-000000000001','Home One');
insert into auth.users(id,email) values
 ('d9000000-0000-0000-0000-000000000001','central-hm@example.invalid');
update profiles set must_change_password=<redacted>
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a9000000-0000-0000-0000-000000000001','d9000000-0000-0000-0000-000000000001','manager','house_manager','c9000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e9000000-0000-0000-0000-000000000001','a9000000-0000-0000-0000-000000000001','c9000000-0000-0000-0000-000000000001','Individual One','1980-01-01');
create temp table central_test_values(kind text,id uuid);
grant all on central_test_values to authenticated;

-- All fixture dates are relative to the Central day, the calendar the
-- wave-7J selector and sweep judge: ct := (now() at time zone
-- 'America/Chicago')::date. The medication consent's review date IS
-- the Central today — on the database's UTC day this record reads
-- Expired every evening (batch 38's split); on the Central day it is
-- Expiring soon at 0 days, and still current.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9000000-0000-0000-0000-000000000001"}',true);
insert into central_test_values(kind,id) select 'medication', public.save_consent(null,jsonb_build_object(
 'individualId','e9000000-0000-0000-0000-000000000001','typeId','medication',
 'covers','Medication administration.','giver','individual','giverName','Individual One','relationship','Self',
 'signedOn',((now() at time zone 'America/Chicago')::date-30)::text,
 'effectiveOn',((now() at time zone 'America/Chicago')::date-30)::text,
 'reviewOn',((now() at time zone 'America/Chicago')::date)::text,'supersedesId',null,
 'createdBy','d9000000-0000-0000-0000-000000000001','activatedBy','d9000000-0000-0000-0000-000000000001'));
select public.activate_consent(id) from central_test_values where kind='medication';
-- The service consent's review date passed ten Central days ago.
insert into central_test_values(kind,id) select 'service', public.save_consent(null,jsonb_build_object(
 'individualId','e9000000-0000-0000-0000-000000000001','typeId','service',
 'covers','Residential services.','giver','individual','giverName','Individual One','relationship','Self',
 'signedOn',((now() at time zone 'America/Chicago')::date-400)::text,
 'effectiveOn',((now() at time zone 'America/Chicago')::date-400)::text,
 'reviewOn',((now() at time zone 'America/Chicago')::date-10)::text,'supersedesId',null,
 'createdBy','d9000000-0000-0000-0000-000000000001','activatedBy','d9000000-0000-0000-0000-000000000001'));
select public.activate_consent(id) from central_test_values where kind='service';
reset role;

select is((select private.consent_current(id) from central_test_values where kind='medication'),true,
 'A consent on its Central review day is still current (the DSP gate no longer drops it on the UTC day)');
select is((select private.consent_current(id) from central_test_values where kind='service'),false,
 'A consent past its Central review day is not current');

select lives_ok($$select private.sweep_consents('a9000000-0000-0000-0000-000000000001',false)$$,'Sweep runs');
select is((select count(*)::int from notifications n, central_test_values v
  where n.agency_id='a9000000-0000-0000-0000-000000000001' and n.user_id='d9000000-0000-0000-0000-000000000001'
  and n.type='consent.expiring' and n.entity_id=v.id::text and v.kind='medication'),1,
 'HM holds the Expiring alert for the medication consent');
select is((select count(*)::int from notifications n, central_test_values v
  where n.agency_id='a9000000-0000-0000-0000-000000000001' and n.user_id='d9000000-0000-0000-0000-000000000001'
  and n.type='consent.expiring' and n.entity_id=v.id::text and v.kind='medication' and n.body like '%— Expiring soon.'),1,
 'The alert body names the same state the screens show: Expiring soon');
select is((select count(*)::int from notifications n, central_test_values v
  where n.agency_id='a9000000-0000-0000-0000-000000000001'
  and n.type='consent.missing' and n.entity_id=v.id::text and v.kind='medication'),0,
 'No Missing/Expired alert exists for the same consent');
select is((select count(*)::int from notifications
  where agency_id='a9000000-0000-0000-0000-000000000001' and user_id='d9000000-0000-0000-0000-000000000001'
  and type='consent.missing' and body like '%— Expired.'),1,
 'The expired service consent alerts as Expired, matching the register');
select is((select count(*)::int from notifications
  where agency_id='a9000000-0000-0000-0000-000000000001' and role_key='program_manager'
  and type='consent.missing' and entity_id='e9000000-0000-0000-0000-000000000001:information'),1,
 'A type with no record still alerts as a person-form Missing gap');
select is((select count(*)::int from notifications n, central_test_values v
  where n.agency_id='a9000000-0000-0000-0000-000000000001' and n.role_key='nurse'
  and n.type='consent.expiring' and n.entity_id=v.id::text and v.kind='medication'),1,
 'The nurse role holds the same Expiring alert for the medication consent');
select * from finish();
rollback;
