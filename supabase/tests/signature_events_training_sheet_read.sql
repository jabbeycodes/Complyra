begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Wave 5, Item 2 (migration 20261117090000): the training profile page
-- derives a line's initials state from the sheet's signature_events.
-- Before this policy, only the signer and administrators could read
-- those events, so every other profile viewer (HM, PM, nurse, auditor)
-- derived "Needs re-initialing" from an empty set while the owner saw
-- the true state. The training-sheet policy admits exactly the viewers
-- who may already read the owner's training rows — and nobody else,
-- and only for training_checklist documents.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a1700000-0000-0000-0000-000000000001','Sheet read agency','SHEETRD-MO','MO','active');
select public.provision_agency_roles('a1700000-0000-0000-0000-000000000001');
-- Pin the two permission-driven branches so the test does not drift
-- with template defaults: HM reads via hr.view_staff, auditor via
-- audit.read. PM / nurse / house_manager also hold role branches.
update public.agency_roles set permissions = '{"hr.view_staff":true}'::jsonb
 where agency_id = 'a1700000-0000-0000-0000-000000000001' and template_key = 'house_manager';
update public.agency_roles set permissions = '{"audit.read":true}'::jsonb
 where agency_id = 'a1700000-0000-0000-0000-000000000001' and template_key = 'auditor';
insert into programs (id,agency_id,name) values
 ('b1700000-0000-0000-0000-000000000001','a1700000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c1700000-0000-0000-0000-000000000001','a1700000-0000-0000-0000-000000000001','b1700000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d1700000-0000-0000-0000-000000000001','sheet-admin@example.invalid'),
 ('d1700000-0000-0000-0000-000000000002','sheet-hm@example.invalid'),
 ('d1700000-0000-0000-0000-000000000003','sheet-pm@example.invalid'),
 ('d1700000-0000-0000-0000-000000000004','sheet-nurse@example.invalid'),
 ('d1700000-0000-0000-0000-000000000005','sheet-auditor@example.invalid'),
 ('d1700000-0000-0000-0000-000000000006','sheet-owner@example.invalid'),
 ('d1700000-0000-0000-0000-000000000007','sheet-peer@example.invalid'),
 ('d1700000-0000-0000-0000-000000000008','sheet-outsider@example.invalid');
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000002','manager','house_manager','c1700000-0000-0000-0000-000000000001'),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000003','manager','program_manager',null),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000004','nurse','nurse',null),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000005','auditor','auditor',null),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000006','dsp','dsp','c1700000-0000-0000-0000-000000000001'),
 ('a1700000-0000-0000-0000-000000000001','d1700000-0000-0000-0000-000000000007','dsp','dsp','c1700000-0000-0000-0000-000000000001');
-- The outsider (…008) deliberately holds no membership anywhere.

-- One training line stamp by the owner DSP, plus one NON-training
-- signature event by the same signer (the control: the new policy must
-- not widen reads beyond training_checklist documents).
insert into signature_events(document_type,document_id,field_name,kind,signer_user_id,document_hash,consent_version,agency_id) values
 ('training_checklist','staff:d1700000-0000-0000-0000-000000000006:c1700000-0000-0000-0000-000000000001',
  'line:f1700000-0000-0000-0000-000000000001:v1','initials','d1700000-0000-0000-0000-000000000006','hash-line','v2','a1700000-0000-0000-0000-000000000001'),
 ('consent_form','consent:d1700000-0000-0000-0000-000000000099',
  'signature','signature','d1700000-0000-0000-0000-000000000006','hash-consent','v2','a1700000-0000-0000-0000-000000000001');

-- ---------------- the owner (signer) ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'owner reads her own line stamp (select_own, unchanged)');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 1,
  'owner reads her own non-training event (select_own, unchanged)');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- house manager ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'HM reads the training sheet events (same set the owner derives state from)');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 0,
  'HM still cannot read non-training signature events');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- program manager ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'PM reads the training sheet events');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 0,
  'PM still cannot read non-training signature events');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- nurse ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'nurse reads the training sheet events');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 0,
  'nurse still cannot read non-training signature events');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- auditor ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'auditor reads the training sheet events (auditor read path)');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 0,
  'auditor still cannot read non-training signature events under this policy');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- peer DSP (not the signer) ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000007"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 0,
  'a peer DSP reads none of another staffer''s sheet events');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 0,
  'a peer DSP reads no non-training events either');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- administrator (pre-existing verifier path) ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from signature_events where document_type = 'training_checklist'), 1,
  'administrator still reads the training sheet events');
select is((select count(*)::int from signature_events where document_type = 'consent_form'), 1,
  'administrator still reads non-training events (verifier policy unchanged)');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- outsider (no membership) ----------------
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1700000-0000-0000-0000-000000000008"}',true);
select is((select count(*)::int from signature_events), 0,
  'a user with no membership in the agency reads no signature events at all');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select * from finish();
rollback;
