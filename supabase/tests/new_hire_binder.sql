begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A + B. Users: DSP subject (…001), DSP peer (…002), HM (…003),
-- HR (…006), auditor (…007), outsider in agency B (…008).
insert into agencies (id, name, agency_code, state_code, status) values
 ('a3000000-0000-0000-0000-000000000001','Binder agency A','BINDERA-MO','MO','active'),
 ('a3000000-0000-0000-0000-000000000002','Binder agency B','BINDERB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d3000000-0000-0000-0000-000000000001','binder-dsp@example.invalid'),
 ('d3000000-0000-0000-0000-000000000002','binder-peer@example.invalid'),
 ('d3000000-0000-0000-0000-000000000003','binder-hm@example.invalid'),
 ('d3000000-0000-0000-0000-000000000006','binder-hr@example.invalid'),
 ('d3000000-0000-0000-0000-000000000009','binder-admin@example.invalid'),
 ('d3000000-0000-0000-0000-000000000007','binder-auditor@example.invalid'),
 ('d3000000-0000-0000-0000-000000000008','binder-outsider@example.invalid');
update profiles set must_change_password = false
 where id::text like 'd3000000-%';
update profiles set home_agency_id='a3000000-0000-0000-0000-000000000001'
 where id::text like 'd3000000-%' and id <> 'd3000000-0000-0000-0000-000000000008';
update profiles set home_agency_id='a3000000-0000-0000-0000-000000000002'
 where id='d3000000-0000-0000-0000-000000000008';
update profiles set full_name='Dana DSP' where id='d3000000-0000-0000-0000-000000000001';
update profiles set full_name='Pete Peer' where id='d3000000-0000-0000-0000-000000000002';
update profiles set full_name='Hannah HM' where id='d3000000-0000-0000-0000-000000000003';
update profiles set full_name='Harriet HR' where id='d3000000-0000-0000-0000-000000000006';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','dsp','dsp','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','dsp','dsp','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000003','manager','house_manager','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000006','hr','hr',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000009','administrator','administrator',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000007','auditor','auditor',null),
 ('a3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000008','dsp','dsp',null);

-- Fixtures (service role): one binder per DSP, one wallet document each.
insert into hr_binders(id,agency_id,staff_id,sections) values
 ('f3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','[]'::jsonb),
 ('f3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','[]'::jsonb);
insert into hr_binder_documents(id,agency_id,binder_id,staff_id,item_key,file_name,status,uploaded_by,uploaded_by_name) values
 ('f3000000-0000-0000-0000-000000000011','a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','resume','resume.pdf','on_file','d3000000-0000-0000-0000-000000000001','Dana DSP'),
 ('f3000000-0000-0000-0000-000000000012','a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','offer-letter','offer.pdf','on_file','d3000000-0000-0000-0000-000000000001','Dana DSP');

select ok(exists(select 1 from storage.buckets where id='binder-documents'),
  'The binder-documents storage bucket exists');
select throws_ok($$insert into hr_binder_documents(agency_id,binder_id,staff_id,item_key,file_name,status,uploaded_by)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','mvr','mvr.pdf','verified','d3000000-0000-0000-0000-000000000001')$$,
  '23514',null,'A verified row without a verifier stamp is rejected by the shape check');

set local role authenticated;

-- ---------------- DSP subject (self) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);

select is((select count(*)::int from hr_binders where staff_id='d3000000-0000-0000-0000-000000000001'),1,
  'A staff member reads their own binder');
select is((select count(*)::int from hr_binders where staff_id='d3000000-0000-0000-0000-000000000002'),0,
  'A staff member cannot read a peer''s binder');
select is((select count(*)::int from hr_binder_documents where staff_id='d3000000-0000-0000-0000-000000000002'),0,
  'A staff member cannot read a peer''s wallet documents');
select lives_ok($$insert into hr_binder_documents(agency_id,binder_id,staff_id,item_key,file_name,status,uploaded_by,uploaded_by_name)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','federal-w4','w4.pdf','verified','d3000000-0000-0000-0000-000000000006','Harriet HR')$$,
  'A staff member can upload a wallet document for their own binder');
select is((select uploaded_by::text from hr_binder_documents where item_key='federal-w4'),'d3000000-0000-0000-0000-000000000001',
  'The uploader is forced to the signed-in user (no impersonation)');
select is((select status from hr_binder_documents where item_key='federal-w4'),'on_file',
  'A fresh upload always lands on_file awaiting verification, whatever the client claimed');
select throws_ok($$update hr_binder_documents set status='verified' where item_key='resume'$$,
  'P0001',null,'A staff member cannot verify their own document');
select lives_ok($$insert into hr_emergency_contacts(agency_id,staff_id,contact_name,relationship,phone,updated_by)
  values ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','Jamie DSP','Sibling','573-555-0101','d3000000-0000-0000-0000-000000000001')$$,
  'A staff member can save their own emergency contact');

-- ---------------- DSP peer ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from hr_emergency_contacts where staff_id='d3000000-0000-0000-0000-000000000001'),0,
  'A peer cannot read another staff member''s emergency contact');

-- ---------------- House manager (hub.view_team, no certificates.manage) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from hr_binders where staff_id='d3000000-0000-0000-0000-000000000001'),1,
  'A house manager with team view reads a team member''s binder');
select is((select count(*)::int from hr_binder_documents where staff_id='d3000000-0000-0000-0000-000000000001'),3,
  'A house manager reads the team member''s wallet documents');
select throws_ok($$update hr_binder_documents set status='verified' where item_key='resume'$$,
  'P0001',null,'A house manager without certificates.manage cannot verify a document');

-- ---------------- HR (certificates.manage) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from hr_binders where staff_id='d3000000-0000-0000-0000-000000000001'),1,
  'HR reads any staff binder');
select lives_ok($$update hr_binder_documents set status='verified', verified_by='d3000000-0000-0000-0000-000000000001', verified_by_name='Dana DSP' where item_key='resume'$$,
  'HR can verify a document');
select is((select verified_by::text from hr_binder_documents where item_key='resume'),'d3000000-0000-0000-0000-000000000006',
  'The verifier stamp is forced to the actual verifier');
select is((select status from hr_binder_documents where item_key='resume'),'verified',
  'The document is verified after HR review');
select throws_ok($$update hr_binder_documents set status='returned', return_note='   ' where item_key='offer-letter'$$,
  'P0001',null,'Returning a document without a reason is rejected');
select lives_ok($$update hr_binder_documents set status='returned', return_note='Please upload the signed copy' where item_key='offer-letter'$$,
  'HR can return a document with a note');
select is((select status from hr_binder_documents where item_key='offer-letter'),'returned',
  'The returned document carries its return state');

-- ---------------- DSP subject re-uploads the returned document ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update hr_binder_documents set file_name='offer-signed.pdf', file_size=99000 where item_key='offer-letter'$$,
  'The staff member can re-upload a returned document');
select is((select status from hr_binder_documents where item_key='offer-letter'),'on_file',
  'A re-upload resets the document to awaiting verification');
select is((select return_note from hr_binder_documents where item_key='offer-letter'),null,
  'A re-upload clears the return note');

-- ---------------- Administrator (verify allowed by role) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000009"}',true);
select lives_ok($$update hr_binder_documents set status='verified' where item_key='federal-w4'$$,
  'An agency administrator can verify a document');
select is((select status from hr_binder_documents where item_key='federal-w4'),'verified',
  'The administrator verification lands');

-- ---------------- Auditor (read-only) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000007"}',true);
select is((select count(*)::int from hr_binders where staff_id='d3000000-0000-0000-0000-000000000001'),1,
  'An auditor reads any staff binder');
select is((select count(*)::int from hr_emergency_contacts where staff_id='d3000000-0000-0000-0000-000000000001'),1,
  'An auditor reads the emergency contact');
select throws_ok($$insert into hr_binder_documents(agency_id,binder_id,staff_id,item_key,file_name,uploaded_by)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','mvr','mvr.pdf','d3000000-0000-0000-0000-000000000007')$$,
  '42501',null,'An auditor cannot upload wallet documents');
select lives_ok($$update hr_binder_documents set status='verified' where item_key='offer-letter'$$,
  'An auditor''s verify attempt touches no rows (no update policy names them)');
select is((select status from hr_binder_documents where item_key='offer-letter'),'on_file',
  'The document stays unverified after the auditor''s attempt');

-- ---------------- Outsider (agency B) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000008"}',true);
select is((select count(*)::int from hr_binders),0,
  'A member of another agency reads no binders');

select * from finish();
rollback;
