begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a0000000-0000-0000-0000-000000000001','Audit agency A','AUDITA-MO','MO','active'),
 ('a0000000-0000-0000-0000-000000000002','Audit agency B','AUDITB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Home A'),
 ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d0000000-0000-0000-0000-000000000001','audit-admin@example.invalid'),
 ('d0000000-0000-0000-0000-000000000002','audit-hm@example.invalid'),
 ('d0000000-0000-0000-0000-000000000003','audit-dsp@example.invalid');
update profiles set must_change_password=false,home_agency_id='a0000000-0000-0000-0000-000000000001'
 where id::text like 'd0000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000002','manager','house_manager','c0000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','dsp','dsp','c0000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Assigned person','1980-01-01'),
 ('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Unassigned person','1980-01-01'),
 ('e0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002','Other home','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
insert into documents(id,agency_id,individual_id,title,kind) values
 ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Private other-home plan','pcsp');
insert into requirement_definitions(id,agency_id,individual_id,site_id,title,category,owner_user_id,due_on,status) values
 ('f1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Assigned task','Required forms','d0000000-0000-0000-0000-000000000003',current_date,'due_soon');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from individuals),2,'HM reads only their home');
select is((select count(*)::int from documents),0,'FOR ALL upload policy cannot expose another home plan');
select throws_ok($$insert into documents(agency_id,individual_id,title,kind) values ('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Forbidden','pcsp')$$,'42501',null,'HM cannot write another home plan');
select is((select count(*)::int from agencies where id='a0000000-0000-0000-0000-000000000002'),0,'Other tenant is hidden');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from individuals),1,'DSP reads exactly their assigned person');
select throws_ok($$update requirement_definitions set title='Changed terms' where id='f1000000-0000-0000-0000-000000000001'$$,'P0001',null,'DSP cannot edit assigned requirement terms');
select throws_ok($$update requirement_definitions set status='compliant',evidence_note='' where id='f1000000-0000-0000-0000-000000000001'$$,'P0001',null,'Completion requires evidence');
select lives_ok($$update requirement_definitions set status='compliant',evidence_note='Reviewed and filed' where id='f1000000-0000-0000-0000-000000000001'$$,'DSP completes their approved work');
select ok((select completed_at is not null from requirement_definitions where id='f1000000-0000-0000-0000-000000000001'),'Completion has a server timestamp');
select is((select count(*)::int from audit_events where actor_id <> auth.uid()),0,'DSP cannot read other staff audit details');

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update staff_assignments set ends_on=current_date-1 where user_id='d0000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from individuals),0,'Ended assignments revoke individual access');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update memberships set expires_on=current_date-1 where user_id='d0000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from individuals),0,'Expired manager loses care access');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from individuals),3,'Admin sees all people in their agency');
select throws_ok($$update requirement_definitions set site_id='c0000000-0000-0000-0000-000000000002' where id='f1000000-0000-0000-0000-000000000001'$$,'P0001',null,'Person/site mismatch is rejected');
select throws_ok($$update requirement_definitions set title=' ' where id='f1000000-0000-0000-0000-000000000001'$$,'P0001',null,'Blank requirements are rejected');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update profiles set must_change_password=true where id='d0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from individuals),0,'Temporary password must be replaced before care access');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update profiles set must_change_password=false where id='d0000000-0000-0000-0000-000000000001';
update agencies set status='rejected' where id='a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from individuals),0,'Suspended agency loses care access');
select is((select count(*)::int from documents),0,'Suspended agency loses document access');
select * from finish();
rollback;
