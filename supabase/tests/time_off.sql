-- TIME-OFF RLS + lifecycle: hosted enforcement for the Employee Hub
-- time-off workflow built on the HR-PHASE2 accrual ledger.
-- Proves: employees create/read only their own requests; per-day hours
-- validate (0 < hours <= 24, inside the range) and the stored total is
-- recomputed from the days; house managers are site-scoped (another
-- site's HM can neither see nor decide a request); decisions are final
-- (no decide-twice, no editing a decided request); an employee cannot
-- cancel an approved request, a manager can — before the start date,
-- with a reason — and cannot after it starts; HR reads agency-wide and
-- posts ledger adjustments but cannot decide; auditors have no path at
-- all; tenants are isolated; and the hub.approve_time_off permission the
-- workflow gates on survives the full migration chain in the templates
-- and in a provisioned agency (no new permission keys were introduced).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(61);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a3000000-0000-0000-0000-000000000001','Time-off agency','TOFF-MO','MO','active'),
 ('a3000000-0000-0000-0000-000000000002','Other agency','TOFB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Home A'),
 ('c3000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d3000000-0000-0000-0000-000000000001','to-emp@example.invalid'),
 ('d3000000-0000-0000-0000-000000000002','to-emp2@example.invalid'),
 ('d3000000-0000-0000-0000-000000000003','to-hm1@example.invalid'),
 ('d3000000-0000-0000-0000-000000000004','to-hm2@example.invalid'),
 ('d3000000-0000-0000-0000-000000000005','to-pm@example.invalid'),
 ('d3000000-0000-0000-0000-000000000006','to-hr@example.invalid'),
 ('d3000000-0000-0000-0000-000000000007','to-auditor@example.invalid'),
 ('d3000000-0000-0000-0000-000000000008','to-outsider@example.invalid');
update profiles set must_change_password=false
 where id::text like 'd3000000-%';
update profiles set home_agency_id='a3000000-0000-0000-0000-000000000001'
 where id::text like 'd3000000-%' and id <> 'd3000000-0000-0000-0000-000000000008';
update profiles set home_agency_id='a3000000-0000-0000-0000-000000000002'
 where id='d3000000-0000-0000-0000-000000000008';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','dsp','dsp','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','dsp','dsp','c3000000-0000-0000-0000-000000000002'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000003','manager','house_manager','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000004','manager','house_manager','c3000000-0000-0000-0000-000000000002'),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000005','manager','program_manager',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000006','hr','hr',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000007','auditor','auditor',null),
 ('a3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000008','dsp','dsp',null);

-- The leave bank: an active PTO policy and an 80h opening balance for EMP.
insert into hr_accrual_policies(agency_id,leave_type,tenure_bands,carryover_cap_hours,carryover_basis,effective_from,created_by)
values ('a3000000-0000-0000-0000-000000000001','pto','[]'::jsonb,40,'calendar_year','2026-01-01','d3000000-0000-0000-0000-000000000005');
insert into hr_accrual_ledger(agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note)
values ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','2026-01-05','pto',80,0,0,80,'Opening balance');

-- Seeded requests in decided/pending states. The transition guards are
-- disabled while fixtures are built (a decided request's day rows and
-- stamps cannot be produced through the guarded paths), then re-enabled
-- for every assertion below.
alter table public.hr_time_off_requests disable trigger hr_time_off_requests_guard;
alter table public.hr_time_off_request_days disable trigger hr_time_off_request_days_guard;
insert into hr_time_off_requests(id,agency_id,site_id,staff_id,kind,starts_on,ends_on,reason,status,decided_by,decided_at) values
 ('f3000000-0000-0000-0000-000000000102','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002','pto','2027-03-05','2027-03-06','', 'pending',null,null),
 ('f3000000-0000-0000-0000-000000000103','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','pto','2027-02-01','2027-02-02','', 'denied','d3000000-0000-0000-0000-000000000003',now()),
 ('f3000000-0000-0000-0000-000000000104','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','pto','2027-03-01','2027-03-02','', 'approved','d3000000-0000-0000-0000-000000000003',now()),
 ('f3000000-0000-0000-0000-000000000105','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','sick','2026-01-05','2026-01-06','', 'approved','d3000000-0000-0000-0000-000000000003',now()),
 ('f3000000-0000-0000-0000-000000000106','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','pto','2027-04-12','2027-04-13','', 'pending',null,null),
 ('f3000000-0000-0000-0000-000000000107','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','pto','2027-03-08','2027-03-08','', 'approved','d3000000-0000-0000-0000-000000000003',now()),
 ('f3000000-0000-0000-0000-000000000108','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002','pto','2027-05-03','2027-05-04','', 'pending',null,null);
insert into hr_time_off_request_days(agency_id,request_id,day_date,hours) values
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000102','2027-03-05',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000102','2027-03-06',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000103','2027-02-01',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000103','2027-02-02',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000104','2027-03-01',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000104','2027-03-02',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000105','2026-01-05',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000105','2026-01-06',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000106','2027-04-12',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000106','2027-04-13',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000107','2027-03-08',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000108','2027-05-03',8),
 ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000108','2027-05-04',8);
alter table public.hr_time_off_request_days enable trigger hr_time_off_request_days_guard;
alter table public.hr_time_off_requests enable trigger hr_time_off_requests_guard;

-- ── Permission survival: hub.approve_time_off post-chain ──
select is((select (permissions->>'hub.approve_time_off')::boolean from role_templates where key='program_manager'), true,
  'Template: the program-manager template carries hub.approve_time_off after the full chain');
select is((select (permissions->>'hub.approve_time_off')::boolean from agency_roles where agency_id='a3000000-0000-0000-0000-000000000001' and template_key='program_manager'), true,
  'Provisioning: a provisioned agency''s program-manager row carries hub.approve_time_off');
select is((select (permissions->>'hub.approve_time_off')::boolean from agency_roles where agency_id='a3000000-0000-0000-0000-000000000001' and template_key='house_manager'), true,
  'Provisioning: a provisioned agency''s house-manager row carries hub.approve_time_off');
select is((select coalesce((permissions->>'hub.approve_time_off')::boolean, false) from agency_roles where agency_id='a3000000-0000-0000-0000-000000000001' and template_key='hr'), false,
  'Provisioning: HR does NOT hold hub.approve_time_off (view + adjust only)');
select is((select (permissions->>'hub.manage_pay_settings')::boolean from agency_roles where agency_id='a3000000-0000-0000-0000-000000000001' and template_key='hr'), true,
  'Provisioning: HR holds hub.manage_pay_settings (the adjustment path)');

-- ── The employee builds a request with per-day hours ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into hr_time_off_requests(id,agency_id,site_id,staff_id,kind,starts_on,ends_on,reason)
  values ('f3000000-0000-0000-0000-000000000101','a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','pto','2027-04-05','2027-04-06','Family trip')$$,
  'An employee creates their own request');
select lives_ok($$insert into hr_time_off_request_days(agency_id,request_id,day_date,hours)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','2027-04-05',8)$$,
  'Day one at 8h');
select lives_ok($$insert into hr_time_off_request_days(agency_id,request_id,day_date,hours)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','2027-04-06',4)$$,
  'Day two as a partial day at 4h');
select is((select total_hours from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 12::numeric,
  'The stored total is recomputed from the day rows (8 + 4 = 12), never trusted from the client');
select throws_ok($$insert into hr_time_off_requests(agency_id,site_id,staff_id,kind,starts_on,ends_on,reason)
  values ('a3000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002','pto','2027-04-05','2027-04-06','Forged')$$,
  '42501', null, 'An employee cannot create a request for someone else');
select throws_ok($$insert into hr_time_off_request_days(agency_id,request_id,day_date,hours)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','2027-04-05',0)$$,
  '23514', null, 'A day at 0 hours is rejected');
select throws_ok($$insert into hr_time_off_request_days(agency_id,request_id,day_date,hours)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','2027-04-05',25)$$,
  '23514', null, 'A day over 24 hours is rejected');
select throws_ok($$insert into hr_time_off_request_days(agency_id,request_id,day_date,hours)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','2027-04-09',8)$$,
  '23514', null, 'A day outside the requested range is rejected');
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 1,
  'The employee reads their own request');
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000102'), 0,
  'The employee cannot read a colleague''s request');
select lives_ok($$update hr_time_off_requests set reason='Family trip (updated)'
  where id='f3000000-0000-0000-0000-000000000101'$$,
  'The employee can still edit their pending request');
select throws_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000001', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000101'$$,
  '42501', null, 'An employee cannot approve their own request');
select lives_ok($$insert into hr_time_off_events(agency_id,request_id,actor_id,event)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','d3000000-0000-0000-0000-000000000001','submitted')$$,
  'The submission lands in the request history');
select throws_ok($$delete from hr_time_off_request_days
  where request_id='f3000000-0000-0000-0000-000000000101'$$,
  '42501', null, 'Day rows cannot be deleted at all (no DELETE grant, no policy)');
select is((select count(*)::int from hr_time_off_request_days where request_id='f3000000-0000-0000-0000-000000000101'), 2,
  'Both day rows survive the delete attempt');
select throws_ok($$insert into hr_time_off_events(agency_id,request_id,actor_id,event)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','d3000000-0000-0000-0000-000000000003','submitted')$$,
  '42501', null, 'History entries cannot be forged under another actor');

-- ── The second employee: isolation, and the owner-cancel path ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 0,
  'A colleague cannot read the first employee''s request');
select lives_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000002', cancelled_at=now(), cancel_reason='Plans changed'
  where id='f3000000-0000-0000-0000-000000000102'$$,
  'An employee cancels their own pending request');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000102'), 'cancelled',
  'The owner-cancel landed');

-- ── The other site's house manager: no sight, no decision ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 0,
  'A house manager of another site cannot see the request');
select lives_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000004', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000101'$$,
  'The other site''s HM approve attempt runs without error but must touch no row');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 'pending',
  'The request is still pending after the cross-site attempt (verified as its owner)');

-- ── The home site's house manager: decide, finality, manager cancels ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 1,
  'The home site''s house manager sees the request');
select lives_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000003', decided_at=now(), decision_note='Coverage arranged'
  where id='f3000000-0000-0000-0000-000000000101'$$,
  'The home site''s house manager approves');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 'approved',
  'The approval landed');
select lives_ok($$insert into hr_time_off_events(agency_id,request_id,actor_id,event,note)
  values ('a3000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000101','d3000000-0000-0000-0000-000000000003','approved','Coverage arranged')$$,
  'The decision lands in the request history');
select throws_ok($$update hr_time_off_requests
  set status='denied', decided_by='d3000000-0000-0000-0000-000000000003', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000101'$$,
  '23514', null, 'Decisions are final: an approved request cannot be flipped to denied');
select throws_ok($$update hr_time_off_requests set decision_note='Rewriting history'
  where id='f3000000-0000-0000-0000-000000000103'$$,
  '23514', null, 'A denied request is immutable');
select lives_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000003', cancelled_at=now(), cancel_reason='Coverage fell through'
  where id='f3000000-0000-0000-0000-000000000104'$$,
  'A manager cancels an approved request before its start, with a reason');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000104'), 'cancelled',
  'The manager-cancel landed');
select throws_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000003', cancelled_at=now(), cancel_reason='Too late'
  where id='f3000000-0000-0000-0000-000000000105'$$,
  '23514', null, 'Approved time off that has already started cannot be cancelled');

-- ── The employee cannot cancel an approved request ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000001', cancelled_at=now(), cancel_reason='Changed my mind'
  where id='f3000000-0000-0000-0000-000000000107'$$,
  'The employee''s cancel of an approved request runs without error but must touch no row');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000107'), 'approved',
  'The approved request stands');

-- ── The program manager: agency-wide, and the reason rule ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000106'), 1,
  'The program manager sees requests agency-wide');
select lives_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000005', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000106'$$,
  'The program manager approves');
select throws_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000005', cancelled_at=now(), cancel_reason=null
  where id='f3000000-0000-0000-0000-000000000106'$$,
  '23514', null, 'Cancelling approved time off without a reason is rejected');
select lives_ok($$update hr_time_off_requests
  set status='cancelled', cancelled_by='d3000000-0000-0000-0000-000000000005', cancelled_at=now(), cancel_reason='Plans changed'
  where id='f3000000-0000-0000-0000-000000000106'$$,
  'The program manager cancels with a reason');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000106'), 'cancelled',
  'The cancellation landed');
select throws_ok($$update hr_time_off_requests set reason='Rewriting a closed request'
  where id='f3000000-0000-0000-0000-000000000106'$$,
  '23514', null, 'A cancelled request is immutable');

-- ── HR: agency-wide read + adjustments, never a decision ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 1,
  'HR reads requests agency-wide');
select lives_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000006', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000108'$$,
  'HR''s approve attempt runs without error but must touch no row');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000108'), 'pending',
  'HR cannot decide: the request is still pending');
select lives_ok($$insert into hr_accrual_ledger(agency_id,staff_id,period_start,leave_type,accrued,used,adjustment,balance,note)
  values ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','2026-02-02','pto',0,0,8,88,'Annual allowance correction')$$,
  'HR posts a balance adjustment to the ledger (hub.manage_pay_settings)');
select ok((select count(*)::int from hr_time_off_events where request_id='f3000000-0000-0000-0000-000000000101') >= 1,
  'HR reads the request history');

-- ── The auditor: no path at all ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000007"}',true);
select is((select count(*)::int from hr_time_off_requests where agency_id='a3000000-0000-0000-0000-000000000001'), 0,
  'The auditor sees no time-off requests');
select throws_ok($$insert into hr_time_off_requests(agency_id,site_id,staff_id,kind,starts_on,ends_on,reason)
  values ('a3000000-0000-0000-0000-000000000001',null,'d3000000-0000-0000-0000-000000000007','pto','2027-06-01','2027-06-02','Auditor request')$$,
  '42501', null, 'The auditor cannot create even their own request');
select is((select count(*)::int from hr_time_off_request_days where request_id='f3000000-0000-0000-0000-000000000101'), 0,
  'The auditor sees no day rows');
select is((select count(*)::int from hr_time_off_events where request_id='f3000000-0000-0000-0000-000000000101'), 0,
  'The auditor sees no history');
select lives_ok($$update hr_time_off_requests
  set status='approved', decided_by='d3000000-0000-0000-0000-000000000007', decided_at=now()
  where id='f3000000-0000-0000-0000-000000000108'$$,
  'The auditor''s decide attempt runs without error but must touch no row');

-- ── Cross-agency isolation ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000008"}',true);
select is((select count(*)::int from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000101'), 0,
  'A member of another agency sees nothing here');
select throws_ok($$insert into hr_time_off_requests(agency_id,site_id,staff_id,kind,starts_on,ends_on,reason)
  values ('a3000000-0000-0000-0000-000000000001',null,'d3000000-0000-0000-0000-000000000008','pto','2027-06-01','2027-06-02','Cross-tenant')$$,
  '23503', null, 'A request cannot be planted in another agency');
select lives_ok($$insert into hr_time_off_requests(agency_id,site_id,staff_id,kind,starts_on,ends_on,reason)
  values ('a3000000-0000-0000-0000-000000000002',null,'d3000000-0000-0000-0000-000000000008','unpaid','2027-06-01','2027-06-02','Own agency')$$,
  'The same employee can request in their own agency (new unpaid type works)');

-- ── Balance math at the database level ──
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role postgres;
select is((select balance from hr_accrual_ledger
  where staff_id='d3000000-0000-0000-0000-000000000001' and leave_type='pto'
  order by period_start desc, created_at desc limit 1), 88::numeric,
  'Balance = opening 80 + HR adjustment 8 (the ledger is the source of truth)');
select is((select coalesce(sum(total_hours),0) from hr_time_off_requests
  where staff_id='d3000000-0000-0000-0000-000000000002' and status='pending'), 16::numeric,
  'Pending hours for the second employee = their one open request (8 + 8)');
select is((select total_hours from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000106'), 16::numeric,
  'A seeded request''s total matches its day rows after the recompute trigger');
select is((select status from hr_time_off_requests where id='f3000000-0000-0000-0000-000000000108'), 'pending',
  'The request HR and the auditor tried to decide is untouched');

select * from finish();
rollback;
