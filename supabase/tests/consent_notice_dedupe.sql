begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a8000000-0000-0000-0000-000000000001','Consent dedupe agency','CDEDUP-MO','MO','active');
insert into programs(id,agency_id,name) values ('b8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','Dedupe program');
insert into sites(id,agency_id,program_id,name) values
 ('c8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','Home One');
insert into auth.users(id,email) values
 ('d8000000-0000-0000-0000-000000000001','dedupe-hm@example.invalid');
update profiles set must_change_password=false where id='d8000000-0000-0000-0000-000000000001';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000001','manager','house_manager','c8000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001','Individual One','1980-01-01');
create temp table dedupe_test_values(id uuid);
grant all on dedupe_test_values to authenticated;

-- Sweep 1: no consent record exists, so the medication gap alerts under
-- the person:type entity form for every recipient.
select lives_ok($$select private.sweep_consents('a8000000-0000-0000-0000-000000000001',false)$$,'Sweep with no record runs');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and user_id='d8000000-0000-0000-0000-000000000001' and type='consent.missing' and entity_id='e8000000-0000-0000-0000-000000000001:medication'),1,'HM holds the person-form Missing alert');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and role_key='program_manager' and type='consent.missing' and entity_id='e8000000-0000-0000-0000-000000000001:medication'),1,'PM role holds the person-form Missing alert');

-- The HM reads her Missing alert; role rows stay unread.
update notifications set read_at=now() where agency_id='a8000000-0000-0000-0000-000000000001' and user_id='d8000000-0000-0000-0000-000000000001' and entity_id='e8000000-0000-0000-0000-000000000001:medication';

-- A medication consent is created and activated inside its 30-day window.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8000000-0000-0000-0000-000000000001"}',true);
insert into dedupe_test_values(id) select public.save_consent(null,jsonb_build_object(
 'individualId','e8000000-0000-0000-0000-000000000001','typeId','medication',
 'covers','Medication administration.','giver','individual','giverName','Individual One','relationship','Self',
 'signedOn',current_date::text,'effectiveOn',current_date::text,'reviewOn',(current_date+15)::text,'supersedesId',null,
 'createdBy','d8000000-0000-0000-0000-000000000001','activatedBy','d8000000-0000-0000-0000-000000000001'));
select lives_ok($$select public.activate_consent(id) from dedupe_test_values$$,'HM activates the medication consent');
reset role;

-- Sweep 2: the gap now alerts as Expiring soon under the consent id.
select lives_ok($$select private.sweep_consents('a8000000-0000-0000-0000-000000000001',false)$$,'Sweep with an expiring record runs');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and user_id='d8000000-0000-0000-0000-000000000001' and type='consent.missing' and entity_id='e8000000-0000-0000-0000-000000000001:medication'),1,'The READ Missing alert is preserved as history');
select is((select count(*)::int from notifications n, dedupe_test_values v where n.agency_id='a8000000-0000-0000-0000-000000000001' and n.user_id='d8000000-0000-0000-0000-000000000001' and n.type='consent.expiring' and n.entity_id=v.id::text),1,'HM now holds the Expiring alert');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and role_key='program_manager' and type='consent.missing' and entity_id='e8000000-0000-0000-0000-000000000001:medication'),0,'The UNREAD PM Missing alert is retired');
select is((select count(*)::int from notifications n, dedupe_test_values v where n.agency_id='a8000000-0000-0000-0000-000000000001' and n.role_key='program_manager' and n.type='consent.expiring' and n.entity_id=v.id::text),1,'PM now holds only the Expiring alert');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and role_key='nurse' and type='consent.missing' and entity_id='e8000000-0000-0000-0000-000000000001:medication'),0,'The UNREAD nurse Missing alert is retired');
select is((select count(*)::int from notifications n, dedupe_test_values v where n.agency_id='a8000000-0000-0000-0000-000000000001' and n.role_key='nurse' and n.type='consent.expiring' and n.entity_id=v.id::text),1,'Nurse now holds the Expiring alert');

-- Sweep 3 changes nothing: the live alert is never its own sibling.
select lives_ok($$select private.sweep_consents('a8000000-0000-0000-0000-000000000001',false)$$,'Repeat sweep runs');
select is((select count(*)::int from notifications where agency_id='a8000000-0000-0000-0000-000000000001' and role_key='program_manager' and type like 'consent.%' and (entity_id='e8000000-0000-0000-0000-000000000001:medication' or entity_id in (select id::text from dedupe_test_values))),1,'PM still holds exactly one alert for the gap after a repeat sweep');
select * from finish();
rollback;
