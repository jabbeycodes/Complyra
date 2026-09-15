begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);
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


insert into medications(id,agency_id,individual_id,name,strength,kind,remaining_pills,pills_per_day) values
 ('a1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Test PRN','Test','prn',10,0),
 ('a1000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000003','Other home PRN','Test','prn',10,0);
insert into qa_audits(id,agency_id,site_id,year,quarter) values
 ('a2000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',2026,3),
 ('a2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',2026,3);
insert into qa_audit_items(id,agency_id,audit_id,item_key,item_id) values
 ('a3000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','fixture','fixture'),
 ('a3000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000002','fixture','fixture');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select record_medication_delivery('a1000000-0000-0000-0000-000000000001',10,0,current_date)$$,'Admin records medication count');
select throws_ok($$select record_medication_delivery('a1000000-0000-0000-0000-000000000001','NaN'::numeric,0,current_date)$$,'P0001',null,'Database rejects nonfinite stock');
select is((select count(*)::int from medication_deliveries where medication_id='a1000000-0000-0000-0000-000000000001'),1,'Rejected count adds no evidence row');
select throws_ok($$update qa_audits set status='finalized',auditor_signature_name='Admin',auditor_signature_mark='mark' where id='a2000000-0000-0000-0000-000000000001'$$,'P0001',null,'Incomplete QA cannot finalize through direct API');
update qa_audit_items set result='no',status='scored' where id='a3000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from qa_audit_items),1,'Site-wide QA items inherit their parent site boundary');
select throws_ok($$update qa_audit_items set result='yes' where id='a3000000-0000-0000-0000-000000000001'$$,'P0001',null,'HM cannot overwrite audit scoring');
select lives_ok($$select raise_qa_dispute('a3000000-0000-0000-0000-000000000001','Evidence corrected','[{"id":"photo","dataUrl":"data:image/png;base64,test"}]'::jsonb)$$,'HM can submit evidence through dispute flow');
select throws_ok($$select raise_qa_dispute('a3000000-0000-0000-0000-000000000002','Evidence','[{}]'::jsonb)$$,'P0001',null,'Dispute RPC rejects another site');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select resolve_qa_dispute('a3000000-0000-0000-0000-000000000001',true,'Evidence reviewed')$$,'Auditor resolves the dispute');
select throws_ok($$update qa_audits set status='finalized' where id='a2000000-0000-0000-0000-000000000001'$$,'P0001',null,'Finalizing needs a signature');
select lives_ok($$update qa_audits set status='finalized',auditor_signature_name='Admin',auditor_signature_mark='mark' where id='a2000000-0000-0000-0000-000000000001'$$,'Fully reviewed QA can finalize');
select throws_ok($$update qa_audits set score='{}',auditor_signature_name='Forged signer' where id='a2000000-0000-0000-0000-000000000001'$$,'P0001',null,'Changing score cannot smuggle a signature edit');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d0000000-0000-0000-0000-000000000003"}',true);
select lives_ok($$select record_prn_dose('a1000000-0000-0000-0000-000000000001',2)$$,'Assigned DSP records a PRN dose');
select is((select remaining_pills::int from medications where id='a1000000-0000-0000-0000-000000000001'),8,'Successful dose reduces stock');
select throws_ok($$select record_prn_dose('a1000000-0000-0000-0000-000000000001',99)$$,'P0001',null,'Database rejects overdraw');
select throws_ok($$select record_prn_dose('a1000000-0000-0000-0000-000000000002',1)$$,'P0001',null,'Dose RPC rejects another home');
update medications set remaining_pills=100 where id='a1000000-0000-0000-0000-000000000001';
select is((select remaining_pills::int from medications where id='a1000000-0000-0000-0000-000000000001'),8,'DSP cannot directly replace stock counts');
select * from finish();
rollback;
