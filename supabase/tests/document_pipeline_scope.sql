begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
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

insert into document_uploads(id,agency_id,individual_id,site_id,document_type,original_filename,storage_path,status) values
 ('a4000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','pcsp','assigned.pdf','fixture/assigned.pdf','approved'),
 ('a4000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','pcsp','unassigned.pdf','fixture/unassigned.pdf','approved'),
 ('a4000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002','pcsp','other.pdf','fixture/other.pdf','approved');
insert into document_extractions(id,agency_id,upload_id) select
 replace(id::text,'a400','a500')::uuid,agency_id,id from document_uploads where id::text like 'a400%';
insert into document_trackable_items(id,agency_id,extraction_id,item_type,title,status) select
 replace(id::text,'a500','a600')::uuid,agency_id,id,'deadline','Approved task','approved' from document_extractions where id::text like 'a500%';
insert into storage.objects(bucket_id,name) values('pcsp-documents','fixture/assigned.pdf'),('pcsp-documents','fixture/unassigned.pdf'),('pcsp-documents','fixture/other.pdf');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from document_uploads),1,'DSP sees only assigned individual uploads');
select is((select count(*)::int from document_extractions),0,'DSP cannot see raw AI extraction');
select is((select count(*)::int from document_trackable_items),1,'DSP can see assigned approved tasks without raw extraction access');
select is((select count(*)::int from storage.objects where bucket_id='pcsp-documents'),0,'DSP cannot download raw PCSPs by path');
select ok((select count(*)>0 from delegation_templates where agency_id is null),'Common delegation library remains readable');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000002"}',true);
select throws_ok($$select register_document_upload('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','pcsp','bad.pdf','fixture/bad.pdf')$$,'P0001',null,'Upload RPC rejects another home');
select throws_ok($$select register_document_upload('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','pcsp','bad.pdf','fixture/bad.pdf','c0000000-0000-0000-0000-000000000002')$$,'P0001',null,'Upload rejects mismatched individual and site');
select lives_ok($$select register_document_upload('a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','pcsp','good.pdf','fixture/good.pdf')$$,'HM uploads for their own individual');
reset role;
-- Explicitly granting review must not silently widen a house manager's scope.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update agency_roles set permissions=permissions || '{"documents.review":true}'::jsonb where agency_id='a0000000-0000-0000-0000-000000000001' and template_key='house_manager';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000002"}',true);
set local role authenticated;
select is((select count(*)::int from document_extractions),2,'Site-scoped reviewer sees only own-home extractions');
select is((select count(*)::int from storage.objects where bucket_id='pcsp-documents'),2,'Downloads follow the individual access boundary');
select throws_ok($$select add_trackable_item('a5000000-0000-0000-0000-000000000003','deadline','Changed','{}',null,false)$$,'P0001',null,'Reviewer RPC cannot change another home item');
select throws_ok($$select reject_upload('a4000000-0000-0000-0000-000000000003','Wrong home')$$,'P0001',null,'Reviewer RPC cannot reject another home upload');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from document_extractions),3,'Agency administrator retains agency-wide review');
select * from finish();
rollback;
