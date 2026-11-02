begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Training roster PM read (20261031320000): a program manager reads every
-- staffer's training lines; a DSP still reads only their own.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2000000-0000-0000-0000-000000000001','Roster agency','ROSTERA-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d2000000-0000-0000-0000-000000000001','roster-pm@example.invalid'),
 ('d2000000-0000-0000-0000-000000000002','roster-dsp-one@example.invalid'),
 ('d2000000-0000-0000-0000-000000000003','roster-dsp-two@example.invalid');
update profiles set must_change_password=false where id::text like 'd2000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','manager','program_manager',null),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','dsp','dsp','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','dsp','dsp','c2000000-0000-0000-0000-000000000001');
insert into training_requirements(id,agency_id,user_id,topic_id,site_id,source) values
 ('e2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','roster-topic','c2000000-0000-0000-0000-000000000001','checklist'),
 ('e2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','roster-topic','c2000000-0000-0000-0000-000000000001','checklist');
insert into training_countersignatures(agency_id,user_id,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','c2000000-0000-0000-0000-000000000001');

set local role authenticated;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from training_requirements),2,'Program manager reads every staffer''s training lines');
select is((select count(*)::int from training_countersignatures),2,'Program manager reads every staffer''s countersignature rows');
select is((select count(*)::int from memberships where agency_id='a2000000-0000-0000-0000-000000000001'),3,'Program manager reads the agency memberships the roster is built from');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from training_requirements),1,'DSP reads only their own training lines');
select is((select user_id::text from training_requirements),'d2000000-0000-0000-0000-000000000002','DSP''s one visible line is their own');
select is((select count(*)::int from training_countersignatures),1,'DSP reads only their own countersignature row');

select * from finish();
rollback;
