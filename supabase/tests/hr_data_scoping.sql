-- HR DATA SCOPING: the database layer must keep a house manager inside
-- their own homes on every HR table. Proves: a site-bound house manager
-- can neither read nor write another home's punches, corrections,
-- shifts, kiosk tokens, timecard approvals, document acks, accrual
-- ledger, shift swaps, missed-punch reports, staffing patterns, or
-- binder records; assignments widen a manager to the homes they are
-- actively assigned to (and a staff member's assignments make them one
-- of that manager's people); administrator / program_manager keep
-- agency-wide reach; HR keeps exactly its current reach (pay-settings
-- ledger writes, staffing, binders — but NOT the team-visibility reads);
-- DSPs keep their own-rows-only view. The binder-documents STORAGE
-- policies are covered too: the same manager can neither list/download
-- nor upload/replace another home's wallet files by object path, while
-- the subject themselves and certificates.manage holders keep their
-- object access.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(60);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a4000000-0000-0000-0000-000000000001','Scoping agency','HRSC-MO','MO','active'),
 ('a4000000-0000-0000-0000-000000000002','Other agency','HRSB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home A'),
 ('c4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d4000000-0000-0000-0000-000000000001','hs-dspa@example.invalid'),
 ('d4000000-0000-0000-0000-000000000002','hs-dspb@example.invalid'),
 ('d4000000-0000-0000-0000-000000000003','hs-hma@example.invalid'),
 ('d4000000-0000-0000-0000-000000000004','hs-hmb@example.invalid'),
 ('d4000000-0000-0000-0000-000000000005','hs-pm@example.invalid'),
 ('d4000000-0000-0000-0000-000000000006','hs-hr@example.invalid'),
 ('d4000000-0000-0000-0000-000000000007','hs-admin@example.invalid'),
 ('d4000000-0000-0000-0000-000000000008','hs-outsider@example.invalid');
update profiles set home_agency_id='a4000000-0000-0000-0000-000000000001'
 where id::text like 'd4000000-%' and id <> 'd4000000-0000-0000-0000-000000000008';
update profiles set home_agency_id='a4000000-0000-0000-0000-000000000002'
 where id='d4000000-0000-0000-0000-000000000008';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','dsp','dsp','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','dsp','dsp','c4000000-0000-0000-0000-000000000002'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000003','manager','house_manager','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000004','manager','house_manager','c4000000-0000-0000-0000-000000000002'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000005','manager','program_manager',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000006','hr','hr',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000007','administrator','administrator',null),
 ('a4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000008','dsp','dsp',null);
-- Active assignments: HM-A also works at Home B; DSP-B also works at Home A.
insert into staff_assignments(agency_id,user_id,site_id,starts_on,ends_on) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000003','c4000000-0000-0000-0000-000000000002','2026-01-01',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','c4000000-0000-0000-0000-000000000001','2026-01-01',null);

-- Fixture rows: an "A" row and a "B" row per scoped table.
insert into hr_pay_periods(id,agency_id,starts_on,ends_on,status) values
 ('e4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','2026-11-02','2026-11-15','open');
insert into hr_timecard_approvals(id,pay_period_id,staff_id,status) values
 ('e4000000-0000-0000-0000-000000000011','e4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','submitted'),
 ('e4000000-0000-0000-0000-000000000012','e4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','submitted');
insert into hr_documents(id,agency_id,title,created_by,active) values
 ('e4000000-0000-0000-0000-000000000021','a4000000-0000-0000-0000-000000000001','Handbook','d4000000-0000-0000-0000-000000000007',true);
insert into hr_document_acks(doc_id,staff_id,signature_name) values
 ('e4000000-0000-0000-0000-000000000021','d4000000-0000-0000-0000-000000000001','DSP A'),
 ('e4000000-0000-0000-0000-000000000021','d4000000-0000-0000-0000-000000000002','DSP B');
insert into hr_punches(id,agency_id,site_id,staff_id,kind,created_by,verification_method,note) values
 ('e4000000-0000-0000-0000-000000000031','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','in','d4000000-0000-0000-0000-000000000001','web','punch-a'),
 ('e4000000-0000-0000-0000-000000000032','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002','in','d4000000-0000-0000-0000-000000000002','web','punch-b'),
 ('e4000000-0000-0000-0000-000000000033','a4000000-0000-0000-0000-000000000001',null,'d4000000-0000-0000-0000-000000000001','in','d4000000-0000-0000-0000-000000000001','web','punch-a-remote');
insert into hr_punch_corrections(id,punch_id,staff_id,reason,status) values
 ('e4000000-0000-0000-0000-000000000041','e4000000-0000-0000-0000-000000000031','d4000000-0000-0000-0000-000000000001','Forgot to clock in','pending'),
 ('e4000000-0000-0000-0000-000000000042','e4000000-0000-0000-0000-000000000032','d4000000-0000-0000-0000-000000000002','Forgot to clock in','pending');
insert into hr_shifts(id,agency_id,site_id,staff_id,title,starts_at,ends_at,status,created_by) values
 ('e4000000-0000-0000-0000-000000000051','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','Shift A','2026-11-16T07:00:00Z','2026-11-16T15:00:00Z','scheduled','d4000000-0000-0000-0000-000000000003'),
 ('e4000000-0000-0000-0000-000000000052','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002','Shift B','2026-11-16T07:00:00Z','2026-11-16T15:00:00Z','scheduled','d4000000-0000-0000-0000-000000000004');
insert into hr_shift_swaps(id,agency_id,requester_id,offered_shift_id,target_staff_id,status) values
 ('e4000000-0000-0000-0000-000000000061','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000051','d4000000-0000-0000-0000-000000000002','pending');
insert into hr_accrual_ledger(id,agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note) values
 ('e4000000-0000-0000-0000-000000000071','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-01-05','pto',80,0,0,80,'Opening A'),
 ('e4000000-0000-0000-0000-000000000072','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','2026-01-05','pto',80,0,0,80,'Opening B');
insert into hr_missed_punch_reports(id,agency_id,staff_id,site_id,work_date,claimed_in_at,reason,status) values
 ('e4000000-0000-0000-0000-000000000081','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','2026-11-10','2026-11-10T07:00:00Z','Kiosk down','pending'),
 ('e4000000-0000-0000-0000-000000000082','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','c4000000-0000-0000-0000-000000000002','2026-11-10','2026-11-10T07:00:00Z','Kiosk down','pending');
insert into hr_staffing_patterns(id,agency_id,site_id,staff_id,weekly_hours,effective_from,created_by) values
 ('e4000000-0000-0000-0000-000000000091','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',40,'2026-01-01','d4000000-0000-0000-0000-000000000007'),
 ('e4000000-0000-0000-0000-000000000092','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002',40,'2026-01-01','d4000000-0000-0000-0000-000000000007');
insert into hr_kiosk_tokens(id,agency_id,site_id,token_hash,label,created_by) values
 ('e4000000-0000-0000-0000-000000000101','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','hash-a','Token A','d4000000-0000-0000-0000-000000000007'),
 ('e4000000-0000-0000-0000-000000000102','a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','hash-b','Token B','d4000000-0000-0000-0000-000000000007');
insert into hr_binders(id,agency_id,staff_id,sections) values
 ('e4000000-0000-0000-0000-000000000111','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','{}'::jsonb),
 ('e4000000-0000-0000-0000-000000000112','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','{}'::jsonb);
insert into hr_binder_documents(id,agency_id,binder_id,staff_id,item_key,uploaded_by) values
 ('e4000000-0000-0000-0000-000000000121','a4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000111','d4000000-0000-0000-0000-000000000001','id_card','d4000000-0000-0000-0000-000000000001'),
 ('e4000000-0000-0000-0000-000000000122','a4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000112','d4000000-0000-0000-0000-000000000002','id_card','d4000000-0000-0000-0000-000000000002');
insert into hr_emergency_contacts(id,agency_id,staff_id,contact_name,updated_by) values
 ('e4000000-0000-0000-0000-000000000131','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','Contact A','d4000000-0000-0000-0000-000000000001'),
 ('e4000000-0000-0000-0000-000000000132','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','Contact B','d4000000-0000-0000-0000-000000000002');

-- ── HM-B (Home B): punches ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000031'), 0,
  'HM-B cannot read a Home A punch');
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000032'), 1,
  'HM-B reads a Home B punch');
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000033'), 0,
  'HM-B cannot read a site-less punch of Home A staff');
update hr_punches set note='tampered' where id='e4000000-0000-0000-0000-000000000031';
select throws_ok($$insert into hr_punches(agency_id,site_id,staff_id,kind,created_by,verification_method)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','in','d4000000-0000-0000-0000-000000000004','web')$$,
  '42501', null, 'HM-B cannot insert a reviewer punch for Home A staff');
reset role;

-- ── HM-A (Home A + assignment to B): punches ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000032'), 1,
  'HM-A reads a Home B punch through an active assignment');
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000033'), 1,
  'HM-A reads a site-less punch of own-home staff (subject fallback)');
update hr_punches set note='reviewed-a' where id='e4000000-0000-0000-0000-000000000031';
reset role;
set local role service_role;
select is((select note from hr_punches where id='e4000000-0000-0000-0000-000000000031'), 'reviewed-a',
  'HM-A reviewer update lands; HM-B attempt before it did not');
reset role;

-- ── Administrator + DSP + HR punch reads ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000007"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punches), 3,
  'Administrator reads every punch agency-wide');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punches), 2,
  'DSP reads only their own punches (unchanged)');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punches where id='e4000000-0000-0000-0000-000000000031'), 0,
  'HR still has no team read of punches (deliberate, unchanged)');
select lives_ok($$insert into hr_punches(agency_id,site_id,staff_id,kind,created_by,verification_method)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002','in','d4000000-0000-0000-0000-000000000006','web')$$,
  'HR keeps its reviewer-punch insert path (hub.review_timecards)');
reset role;

-- ── Corrections ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punch_corrections where id='e4000000-0000-0000-0000-000000000041'), 0,
  'HM-B cannot read a Home A punch correction');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_punch_corrections where id='e4000000-0000-0000-0000-000000000041'), 1,
  'HM-A reads a Home A punch correction');
reset role;

-- ── Shift + kiosk token writes ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
update hr_shifts set title='tampered' where id='e4000000-0000-0000-0000-000000000051';
update hr_kiosk_tokens set label='tampered' where id='e4000000-0000-0000-0000-000000000101';
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
update hr_kiosk_tokens set label='Token B (HM-A)' where id='e4000000-0000-0000-0000-000000000102';
select lives_ok($$insert into hr_shifts(agency_id,site_id,staff_id,title,starts_at,ends_at,status,created_by)
  values ('a4000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002','Cover B','2026-11-17T07:00:00Z','2026-11-17T15:00:00Z','scheduled','d4000000-0000-0000-0000-000000000003')$$,
  'HM-A can write a Home B shift through an active assignment');
reset role;
set local role service_role;
select is((select title from hr_shifts where id='e4000000-0000-0000-0000-000000000051'), 'Shift A',
  'HM-B shift write on Home A did not land');
select is((select label from hr_kiosk_tokens where id='e4000000-0000-0000-0000-000000000101'), 'Token A',
  'HM-B kiosk token write on Home A did not land');
select is((select label from hr_kiosk_tokens where id='e4000000-0000-0000-0000-000000000102'), 'Token B (HM-A)',
  'HM-A kiosk token write on Home B lands through the assignment');
reset role;

-- ── Timecard approvals ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_timecard_approvals where id='e4000000-0000-0000-0000-000000000011'), 0,
  'HM-B cannot read a Home A timecard approval');
update hr_timecard_approvals set status='approved', decided_by='d4000000-0000-0000-0000-000000000004', decided_at=now()
 where id='e4000000-0000-0000-0000-000000000011';
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_timecard_approvals where id='e4000000-0000-0000-0000-000000000011'), 1,
  'HM-A reads a Home A timecard approval');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from hr_timecard_approvals where id='e4000000-0000-0000-0000-000000000011'), 0,
  'HR still has no team read of timecard approvals (unchanged)');
reset role;
set local role service_role;
select is((select status from hr_timecard_approvals where id='e4000000-0000-0000-0000-000000000011'), 'submitted',
  'HM-B timecard decision on Home A staff did not land');
reset role;

-- ── Document acks ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_document_acks where staff_id='d4000000-0000-0000-0000-000000000001'), 0,
  'HM-B cannot read document acks of Home A staff');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000005"}',true);
set local role authenticated;
select is((select count(*)::int from hr_document_acks where staff_id='d4000000-0000-0000-0000-000000000002'), 1,
  'Program manager reads document acks agency-wide');
reset role;

-- ── Accrual ledger ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_accrual_ledger where id='e4000000-0000-0000-0000-000000000071'), 0,
  'HM-B cannot read the accrual ledger of Home A staff');
select throws_ok($$insert into hr_accrual_ledger(agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-02-02','pto',0,8,0,72,'HM-B debit')$$,
  '42501', null, 'HM-B cannot post a ledger entry for Home A staff');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_accrual_ledger where id='e4000000-0000-0000-0000-000000000072'), 1,
  'HM-A reads the ledger of Home B staff assigned to Home A (subject scope)');
select lives_ok($$insert into hr_accrual_ledger(agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-02-02','pto',0,8,0,72,'HM-A debit')$$,
  'HM-A posts a ledger entry for own-home staff (approve_time_off path)');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from hr_accrual_ledger where id='e4000000-0000-0000-0000-000000000071'), 0,
  'HR still has no team read of the accrual ledger (unchanged)');
select lives_ok($$insert into hr_accrual_ledger(agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-03-02','pto',0,0,4,76,'HR adjustment')$$,
  'HR keeps its agency-wide ledger write (hub.manage_pay_settings path)');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000002"}',true);
set local role authenticated;
select is((select count(*)::int from hr_accrual_ledger), 1,
  'DSP reads only their own ledger rows (unchanged)');
reset role;

-- ── Shift swaps ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_shift_swaps where id='e4000000-0000-0000-0000-000000000061'), 0,
  'HM-B cannot team-read a targeted swap for a Home A shift');
update hr_shift_swaps set status='denied', decided_by='d4000000-0000-0000-0000-000000000004', decided_at=now()
 where id='e4000000-0000-0000-0000-000000000061';
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
update hr_shift_swaps set status='denied', decided_by='d4000000-0000-0000-0000-000000000003', decided_at=now()
 where id='e4000000-0000-0000-0000-000000000061';
reset role;
set local role service_role;
select is((select decided_by::text from hr_shift_swaps where id='e4000000-0000-0000-0000-000000000061'), 'd4000000-0000-0000-0000-000000000003',
  'Only HM-A could decide the Home A swap; HM-B attempt did not land');
reset role;

-- ── Missed-punch reports ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_missed_punch_reports where id='e4000000-0000-0000-0000-000000000081'), 0,
  'HM-B cannot read a Home A missed-punch report');
update hr_missed_punch_reports set status='approved', reviewed_by='d4000000-0000-0000-0000-000000000004', reviewed_at=now()
 where id='e4000000-0000-0000-0000-000000000081';
reset role;
set local role service_role;
select is((select status from hr_missed_punch_reports where id='e4000000-0000-0000-0000-000000000081'), 'pending',
  'HM-B missed-punch decision on Home A did not land');
reset role;

-- ── Staffing patterns ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_staffing_patterns where id='e4000000-0000-0000-0000-000000000091'), 0,
  'HM-B cannot read a Home A staffing pattern');
update hr_staffing_patterns set weekly_hours=1 where id='e4000000-0000-0000-0000-000000000091';
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_staffing_patterns where id='e4000000-0000-0000-0000-000000000091'), 1,
  'HM-A reads a Home A staffing pattern');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from hr_staffing_patterns where id='e4000000-0000-0000-0000-000000000092'), 1,
  'HR keeps agency-wide staffing pattern read');
reset role;
set local role service_role;
select is((select weekly_hours::int from hr_staffing_patterns where id='e4000000-0000-0000-0000-000000000091'), 40,
  'HM-B staffing pattern write on Home A did not land');
reset role;

-- ── Binders, wallet documents, emergency contacts ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from hr_binders where id='e4000000-0000-0000-0000-000000000111'), 0,
  'HM-B cannot read the binder of Home A staff');
select is((select count(*)::int from hr_binder_documents where id='e4000000-0000-0000-0000-000000000121'), 0,
  'HM-B cannot read wallet documents of Home A staff');
select is((select count(*)::int from hr_emergency_contacts where id='e4000000-0000-0000-0000-000000000131'), 0,
  'HM-B cannot read emergency contacts of Home A staff');
select throws_ok($$insert into hr_binder_documents(agency_id,binder_id,staff_id,item_key,uploaded_by)
  values ('a4000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000111','d4000000-0000-0000-0000-000000000001','passport','d4000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'HM-B cannot add a wallet document to a Home A binder');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from hr_binders where id='e4000000-0000-0000-0000-000000000112'), 1,
  'HR keeps agency-wide binder read');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from hr_binder_documents where id='e4000000-0000-0000-0000-000000000122'), 1,
  'HM-A reads wallet documents of Home B staff assigned to Home A (subject scope)');
reset role;

-- ── binder-documents storage policies ──
-- The hosted platform grants authenticated table access to
-- storage.objects and lets the bucket policies gate it; mirror that
-- platform grant here (the policies are the gate under test).
grant select, insert, update, delete on storage.objects to authenticated, service_role;
insert into storage.objects(id, bucket_id, name, owner) values
 ('f4000000-0000-0000-0000-000000000001','binder-documents',
  'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/id_card/id-a.pdf',
  'd4000000-0000-0000-0000-000000000001'),
 ('f4000000-0000-0000-0000-000000000002','binder-documents',
  'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000002/id_card/id-b.pdf',
  'd4000000-0000-0000-0000-000000000002');

-- The replaced policies carry the scoped predicates.
select ok(exists(select 1 from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='binder_documents_storage_select'
    and qual like '%binder_subject_visible%'),
  'Storage select policy reads via binder_subject_visible');
select ok(exists(select 1 from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='binder_documents_storage_insert'
    and with_check like '%hr_scope_subject%'),
  'Storage insert policy scopes the manager path with hr_scope_subject');
select ok(exists(select 1 from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname='binder_documents_storage_update'
    and qual like '%hr_scope_subject%'),
  'Storage update policy scopes the manager path with hr_scope_subject');

-- ── HM-B (Home B): storage objects ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000001'), 0,
  'HM-B cannot list/download a Home A wallet file from storage');
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000002'), 1,
  'HM-B can read a Home B wallet file from storage');
select throws_ok($$insert into storage.objects(bucket_id, name, owner)
  values ('binder-documents',
    'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/passport/pass-a.pdf',
    'd4000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'HM-B cannot upload a wallet file into a Home A binder path');
select lives_ok($$insert into storage.objects(bucket_id, name, owner)
  values ('binder-documents',
    'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000002/passport/pass-b.pdf',
    'd4000000-0000-0000-0000-000000000004')$$,
  'HM-B can upload a wallet file into a Home B binder path');
update storage.objects
  set name='agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/id_card/tampered.pdf'
  where id='f4000000-0000-0000-0000-000000000001';
update storage.objects
  set name='agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000002/id_card/id-b-renamed.pdf'
  where id='f4000000-0000-0000-0000-000000000002';
reset role;

-- ── HM-A (Home A + assignment to B): storage objects ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000002'), 1,
  'HM-A reads a Home B wallet file from storage (subject scope)');
reset role;
set local role service_role;
select is((select name from storage.objects where id='f4000000-0000-0000-0000-000000000001'),
  'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/id_card/id-a.pdf',
  'HM-B storage update on a Home A wallet file did not land');
select is((select name from storage.objects where id='f4000000-0000-0000-0000-000000000002'),
  'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000002/id_card/id-b-renamed.pdf',
  'HM-B storage update on a Home B wallet file lands');
reset role;

-- ── DSP-A: storage self access ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000001'), 1,
  'DSP reads their own wallet file from storage (self access kept)');
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000002'), 0,
  'DSP cannot read another staff member''s wallet file from storage');
select lives_ok($$insert into storage.objects(bucket_id, name, owner)
  values ('binder-documents',
    'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/passport/own-pass.pdf',
    'd4000000-0000-0000-0000-000000000001')$$,
  'DSP can upload a wallet file into their own binder path (self access kept)');
reset role;

-- ── HR: storage agency-wide paths (certificates.manage) ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);
set local role authenticated;
select is((select count(*)::int from storage.objects where id='f4000000-0000-0000-0000-000000000001'), 1,
  'HR keeps agency-wide wallet file read from storage');
select lives_ok($$insert into storage.objects(bucket_id, name, owner)
  values ('binder-documents',
    'agency/a4000000-0000-0000-0000-000000000001/binder/d4000000-0000-0000-0000-000000000001/diploma/dip-a.pdf',
    'd4000000-0000-0000-0000-000000000006')$$,
  'HR can upload a wallet file into any binder path (certificates.manage path kept)');
update storage.objects set metadata='{"verified_copy":true}'::jsonb
  where id='f4000000-0000-0000-0000-000000000001';
reset role;
set local role service_role;
select is((select metadata->>'verified_copy' from storage.objects where id='f4000000-0000-0000-0000-000000000001'), 'true',
  'HR storage update on a wallet file lands (certificates.manage path kept)');
reset role;

select * from finish();
rollback;
