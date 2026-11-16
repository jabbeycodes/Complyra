begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- PR #259 review HOLD (20261105120000): saving a training sign-off completes
-- the line's STATUS column (trigger), but server-side clearance must wait
-- for the OWNER's e-initials event at the CURRENT signoff version
-- (field line:<requirement_id>:v<signoff_version>, kind 'initials',
-- sheet staff:<user>:<site>). The stamp is written after the save and can
-- be missing (manager save, failed / timed-out stamp, dropped connection).
--
-- One DSP walks the whole path:
--   (a) three lines saved (22 h, 10 h with the HM) + both countersignature
--       marks, NO initials events -> status reads 'complete' yet the lines
--       are not initialed, still count open, med_admin_cleared is false
--       and a PRN dose is refused;
--       stamps that do not qualify (HM-authored, kind 'signature') change
--       nothing;
--   (b) the owner's initials at the current version -> cleared, PRN dose
--       records;
--   (c) a correction edit bumps one line to v2 -> the v1 stamp is stale,
--       the line counts open again and clearance is withdrawn; the owner
--       re-initials v2 -> cleared again.
-- The open-line count asserted here is the SQL twin of the apply-signature
-- staff_sign / hm_countersign count (trainingLines.ts, unit-tested in
-- supabase/functions/apply-signature/trainingLines.test.ts).
insert into agencies (id, name, agency_code, state_code, status) values
 ('a8000000-0000-0000-0000-000000000001','Initials clearance agency','LINEINIT-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d8000000-0000-0000-0000-000000000001','init-hm@example.invalid'),
 ('d8000000-0000-0000-0000-000000000002','init-dsp@example.invalid');
update profiles set full_name='Hana HM' where id='d8000000-0000-0000-0000-000000000001';
update profiles set full_name='Ivy Initials' where id='d8000000-0000-0000-0000-000000000002';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000001','manager','house_manager','c8000000-0000-0000-0000-000000000001'),
 ('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','dsp','dsp','c8000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e8000000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001','Person One','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','e8000000-0000-0000-0000-000000000001','c8000000-0000-0000-0000-000000000001');
insert into medications(id,agency_id,individual_id,name,kind,pills_per_day,remaining_pills,last_delivery_on) values
 ('f8200000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','e8000000-0000-0000-0000-000000000001','Prn Med','prn',0,10,current_date);

-- Lines start pending, exactly as assigned; the sign-off insert is what
-- completes the status column (the 20261105120000 trigger).
insert into training_requirements(id,agency_id,user_id,topic_id,site_id,source,status) values
 ('f8300000-0000-0000-0000-000000000001','a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','chk-2-02','c8000000-0000-0000-0000-000000000001','checklist','pending'),
 ('f8300000-0000-0000-0000-000000000002','a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','chk-2-03','c8000000-0000-0000-0000-000000000001','checklist','pending'),
 ('f8300000-0000-0000-0000-000000000003','a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','chk-1-01','c8000000-0000-0000-0000-000000000001','checklist','pending');
insert into training_signoffs(agency_id,requirement_id,initials,signed_on,trainer_name,hours_total,hours_with_hm,signoff_version) values
 ('a8000000-0000-0000-0000-000000000001','f8300000-0000-0000-0000-000000000001','II',current_date - 10,'Hana HM',8,8,1),
 ('a8000000-0000-0000-0000-000000000001','f8300000-0000-0000-0000-000000000002','II',current_date - 10,'Hana HM',8,0,1),
 ('a8000000-0000-0000-0000-000000000001','f8300000-0000-0000-0000-000000000003','II',current_date - 10,'Hana HM',6,2,1);
-- The rest of the gate is satisfied so the e-initials are the only variable.
insert into training_countersignatures(agency_id,user_id,site_id,staff_signature_name,staff_signed_at,hm_signature_name,hm_signed_at) values
 ('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','c8000000-0000-0000-0000-000000000001','Ivy Initials',now(),'Hana HM',now());

-- ---------------- (a) saved, no initials event ----------------
select is((select count(*)::int from training_requirements
            where user_id='d8000000-0000-0000-0000-000000000002' and status='complete'), 3,
  '(a) the sign-off write completes the status column of all three lines');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000001'), false,
  '(a) a saved line with no e-initials event is not initialed');
select is((select count(*)::int from training_requirements r
            where r.user_id='d8000000-0000-0000-0000-000000000002'
              and r.site_id='c8000000-0000-0000-0000-000000000001'
              and r.status <> 'waived_na'
              and not private.training_line_initialed(r.id)), 3,
  '(a) the open-line count still counts every unstamped line open');
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), false,
  '(a) status complete + hours + countersignatures but no initials: NOT cleared');

-- Stamps that do not qualify: the HM's initials on the owner's line, and a
-- full signature (not initials) by the owner on a line field.
insert into signature_events(document_type,document_id,field_name,kind,signer_user_id,document_hash,consent_version,agency_id) values
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000001:v1','initials','d8000000-0000-0000-0000-000000000001','hash-hm','v2','a8000000-0000-0000-0000-000000000001'),
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000002:v1','signature','d8000000-0000-0000-0000-000000000002','hash-sig','v2','a8000000-0000-0000-0000-000000000001');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000001'), false,
  '(a) initials authored by someone other than the line owner do not count');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000002'), false,
  '(a) a non-initials event on the line field does not count');
delete from signature_events
 where document_id='staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8000000-0000-0000-0000-000000000002"}',true);
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), false,
  '(a) the DSP is not cleared when asking as themselves');
select throws_ok($$select public.record_prn_dose('f8200000-0000-0000-0000-000000000001', 1, 'Agitation', null)$$,
  'P0001','Medication actions unlock when your training is cleared.',
  '(a) the unstamped DSP cannot record a PRN dose');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- (b) owner initials at the current version ----------------
-- (signature_events rows are written only by apply-signature with the
-- service role; the fixture writes them the same shape directly.)
insert into signature_events(document_type,document_id,field_name,kind,signer_user_id,document_hash,consent_version,agency_id) values
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000001:v1','initials','d8000000-0000-0000-0000-000000000002','hash-1','v2','a8000000-0000-0000-0000-000000000001'),
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000002:v1','initials','d8000000-0000-0000-0000-000000000002','hash-2','v2','a8000000-0000-0000-0000-000000000001');
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), false,
  '(b) two of three lines stamped: still NOT cleared');
insert into signature_events(document_type,document_id,field_name,kind,signer_user_id,document_hash,consent_version,agency_id) values
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000003:v1','initials','d8000000-0000-0000-0000-000000000002','hash-3','v2','a8000000-0000-0000-0000-000000000001');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000003'), true,
  '(b) the owner''s initials at the current version make the line initialed');
select is((select count(*)::int from training_requirements r
            where r.user_id='d8000000-0000-0000-0000-000000000002'
              and r.status <> 'waived_na'
              and not private.training_line_initialed(r.id)), 0,
  '(b) no lines remain open once every current version is stamped');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8000000-0000-0000-0000-000000000002"}',true);
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), true,
  '(b) every line stamped by its owner (rest of the gate met): cleared');
select lives_ok($$select public.record_prn_dose('f8200000-0000-0000-0000-000000000001', 1, 'Agitation', null)$$,
  '(b) the stamped DSP records a PRN dose');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------------- (c) stale version after a correction edit ----------------
update training_signoffs set hours_total = 7, signoff_version = 2
 where requirement_id = 'f8300000-0000-0000-0000-000000000003';
select is((select status from training_requirements where id='f8300000-0000-0000-0000-000000000003'), 'complete',
  '(c) the corrected line''s status column still reads complete');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000003'), false,
  '(c) the v1 stamp does not initial the v2 sign-off');
select is((select count(*)::int from training_requirements r
            where r.user_id='d8000000-0000-0000-0000-000000000002'
              and r.status <> 'waived_na'
              and not private.training_line_initialed(r.id)), 1,
  '(c) the re-versioned line counts open again');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8000000-0000-0000-0000-000000000002"}',true);
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), false,
  '(c) a stale-version stamp withdraws clearance');
select throws_ok($$select public.record_prn_dose('f8200000-0000-0000-0000-000000000001', 1, 'Agitation', null)$$,
  'P0001','Medication actions unlock when your training is cleared.',
  '(c) PRN dose refused again until the owner re-initials');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into signature_events(document_type,document_id,field_name,kind,signer_user_id,document_hash,consent_version,agency_id) values
 ('training_checklist','staff:d8000000-0000-0000-0000-000000000002:c8000000-0000-0000-0000-000000000001',
  'line:f8300000-0000-0000-0000-000000000003:v2','initials','d8000000-0000-0000-0000-000000000002','hash-3b','v2','a8000000-0000-0000-0000-000000000001');
select is(private.training_line_initialed('f8300000-0000-0000-0000-000000000003'), true,
  '(c) the owner''s v2 re-initial counts');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d8000000-0000-0000-0000-000000000002"}',true);
select is(private.med_admin_cleared('a8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002'), true,
  '(c) re-initialed at the current version: cleared again');

select * from finish();
rollback;
