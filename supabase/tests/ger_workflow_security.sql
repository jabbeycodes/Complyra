begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id,name,agency_code,state_code,status) values
 ('61000000-0000-0000-0000-000000000001','GER test agency','GER-MO','MO','active');
insert into programs (id,agency_id,name) values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','ISL');
insert into sites (id,agency_id,program_id,name) values
 ('63000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Home A'),
 ('63000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','Home B');
insert into auth.users (id,email) values
 ('64000000-0000-0000-0000-000000000001','ger-admin@example.invalid'),
 ('64000000-0000-0000-0000-000000000002','ger-hm@example.invalid');
update profiles set must_change_password=false,home_agency_id='61000000-0000-0000-0000-000000000001' where id::text like '64000000-%';
insert into memberships (agency_id,user_id,role,role_key,site_id) values
 ('61000000-0000-0000-0000-000000000001','64000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('61000000-0000-0000-0000-000000000001','64000000-0000-0000-0000-000000000002','manager','house_manager','63000000-0000-0000-0000-000000000001');
insert into individuals (id,agency_id,site_id,full_name,date_of_birth) values
 ('65000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('65000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000002','Person B','1980-01-01');
insert into ger_reports (id,agency_id,site_id,individual_id,event_date,event_type,severity,description,actions_taken,location,reported_by_name,signature_name,status,created_by_user_id,created_by_name) values
 ('66000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000001','65000000-0000-0000-0000-000000000001',current_date,'other','low','Home A event','Action','Home A','Admin','Admin','draft','64000000-0000-0000-0000-000000000001','Admin'),
 ('66000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000001','63000000-0000-0000-0000-000000000002','65000000-0000-0000-0000-000000000002',current_date,'other','low','Home B event','Action','Home B','Admin','Admin','approved','64000000-0000-0000-0000-000000000001','Admin');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"64000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from ger_reports),1,'House manager cannot read another home’s GER records');
select throws_ok($$update ger_reports set status='approved' where id='66000000-0000-0000-0000-000000000001'$$,'P0001',null,'Direct PostgREST approval cannot bypass the review workflow');
select throws_ok($$select update_ger_report_body('66000000-0000-0000-0000-000000000002','{}'::jsonb)$$,'P0001',null,'Workflow RPC rejects another home');
select lives_ok($$select update_ger_report_body('66000000-0000-0000-0000-000000000001',jsonb_build_object('individual_id','65000000-0000-0000-0000-000000000001','event_date',current_date::text,'event_type','other','severity','low','description','Updated','actions_taken','Action','location','Home A','reported_by_name','HM','signature_name','HM'))$$,'Author-site manager can edit through the controlled RPC');
select lives_ok($$select submit_ger_report('66000000-0000-0000-0000-000000000001')$$,'Controlled RPC submits a complete report');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"64000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select review_ger_report('66000000-0000-0000-0000-000000000001','approve','Reviewed and approved')$$,'Administrator approves through the review RPC');
select throws_ok($$select update_ger_report_body('66000000-0000-0000-0000-000000000001','{}'::jsonb)$$,'P0001',null,'Approved report is final even for an administrator');
select throws_ok($$delete from ger_reports where id='66000000-0000-0000-0000-000000000001'$$,'42501',null,'GER records cannot be deleted through PostgREST');
select * from finish();
rollback;
