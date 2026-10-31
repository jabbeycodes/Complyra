begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Med cluster (batches 7/9/10/11): variance evidence on counts, the PRN
-- dose audit record, role-worded stock errors, and Late MAR columns.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2000000-0000-0000-0000-000000000001','Med cluster agency','MEDCLUS-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d2000000-0000-0000-0000-000000000001','med-hm@example.invalid'),
 ('d2000000-0000-0000-0000-000000000002','med-dsp@example.invalid');
update profiles set full_name='Hana HM' where id='d2000000-0000-0000-0000-000000000001';
update profiles set full_name='Dev DSP' where id='d2000000-0000-0000-0000-000000000002';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','manager','house_manager','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','dsp','dsp','c2000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Person One','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001');
insert into medications(id,agency_id,individual_id,name,kind,pills_per_day,remaining_pills,last_delivery_on) values
 ('f2200000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Sched Med','scheduled',2,30,current_date),
 ('f2200000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Prn Med','prn',0,5,current_date),
 ('f2200000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Uncounted Prn','prn',0,0,null),
 ('f2200000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Sched Two','scheduled',2,30,current_date - 2),
 ('f2200000-0000-0000-0000-000000000005','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Prn Three','prn',0,20,current_date - 3);

-- Server-expectation fixtures. Sched Two: a delivery baseline of 30
-- pills recorded two days ago at 2/day over two dose times (1 pill per
-- dose). Since that baseline: two Given marks yesterday burn 2 pills
-- and one Wasted exception burns 1; a Missed mark, a Refused exception,
-- and a future-dated Given mark burn nothing. Server expectation: 27.
insert into med_inventory(agency_id,individual_id,medication_id,dose_times) values
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',array['08:00','20:00']);
insert into medication_deliveries(agency_id,medication_id,counted_on,remaining_pills,pills_per_day,recorded_by,created_at) values
 ('a2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 2,30,2,'d2000000-0000-0000-0000-000000000001',now() - interval '2 days');
insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name) values
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 1,'08:00','given','d2000000-0000-0000-0000-000000000001','Hana HM'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 1,'20:00','given','d2000000-0000-0000-0000-000000000001','Hana HM'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 1,'12:00','missed','d2000000-0000-0000-0000-000000000001','Hana HM'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date + 1,'08:00','given','d2000000-0000-0000-0000-000000000001','Hana HM');
-- Prn Three: maintained count of 20 as of three days ago; since then a
-- 4-pill dose (in window), a 1-pill Wasted and a 2-pill Refused
-- exception (the projection subtracts every kind). A dose logged before
-- the anchor date is out of window. Server expectation: 13.
insert into med_dose_exceptions(agency_id,individual_id,medication_id,occurred_on,kind,pills_affected,reason,created_by,created_at) values
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 1,'wasted',1,'Dropped on the floor','d2000000-0000-0000-0000-000000000001',now() - interval '1 day'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000004',current_date - 1,'refused',2,'Refused both doses','d2000000-0000-0000-0000-000000000001',now() - interval '1 day'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000005',current_date - 2,'wasted',1,'Crumbled','d2000000-0000-0000-0000-000000000001',now() - interval '2 days'),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000005',current_date - 2,'refused',2,'Refused','d2000000-0000-0000-0000-000000000001',now() - interval '2 days');
insert into prn_dose_logs(agency_id,medication_id,logged_on,pills_used,remaining_after,logged_by,logged_by_user_id) values
 ('a2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000005',current_date - 1,4,16,'Hana HM','d2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000005',current_date - 4,3,20,'Hana HM','d2000000-0000-0000-0000-000000000001');

-- Schema: the new evidence columns exist.
select has_column('medication_deliveries','expected_pills','delivery rows store the expected figure');
select has_column('medication_deliveries','variance_reason','delivery rows store the variance note');
select has_column('prn_dose_logs','reason','PRN dose logs store the reason');
select has_column('prn_dose_logs','follow_up','PRN dose logs store the follow-up note');
select has_column('med_dose_marks','late','MAR marks carry the Late stamp');
select has_column('med_dose_marks','late_reason','MAR marks carry the late reason');

-- A mark written without late data defaults to not-late. The mark is
-- dated yesterday so its scheduled moment always precedes the delivery
-- baseline the HM records below — the "matching count" case must not
-- depend on the time of day the suite runs.
select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000001',current_date - 1,'08:00','given','d2000000-0000-0000-0000-000000000001','Hana HM')$$,
  'a plain MAR mark inserts');
select is((select late from med_dose_marks where medication_id='f2200000-0000-0000-0000-000000000001'), false,
  'the Late stamp defaults to false');

set local role authenticated;

-- ---------------- HM: count variance ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000001"}',true);

select throws_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000001', 28, 2, current_date, 30, null)$$,
  'P0001','The count differs from the expected 30 pills on hand. Add a note explaining the variance.',
  'a count that disagrees with the expected figure is refused without a note');
select lives_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000001', 28, 2, current_date, 30, 'recount found two missing')$$,
  'a mismatching count with a note is recorded');
select is((select expected_pills::int from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000001' order by created_at desc limit 1), 30,
  'the delivery row keeps the expected figure as evidence');
select is((select variance_reason from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000001' order by created_at desc limit 1), 'recount found two missing',
  'the delivery row keeps the variance note');
select lives_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000001', 28, 2, current_date, 28, null)$$,
  'a count matching the expected figure needs no note');

-- ---------------- HM: PRN dose record ----------------
select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 1, '', null)$$,
  'P0001','Say why the PRN was given.',
  'a PRN dose without a reason is refused');
select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 99, 'Agitation', null)$$,
  'P0001','The dose exceeds the recorded stock. Reconcile the count first.',
  'a counter over-stock error tells them to reconcile the count');
select lives_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 2, 'Agitation', 'Recheck in 30 minutes')$$,
  'a PRN dose with a reason is recorded');
select is((select reason from prn_dose_logs where medication_id='f2200000-0000-0000-0000-000000000002' order by logged_at desc limit 1), 'Agitation',
  'the dose log keeps the reason');
select is((select follow_up from prn_dose_logs where medication_id='f2200000-0000-0000-0000-000000000002' order by logged_at desc limit 1), 'Recheck in 30 minutes',
  'the dose log keeps the follow-up note');
select is((select remaining_pills::int from medications where id='f2200000-0000-0000-0000-000000000002'), 3,
  'the dose decrements the recorded stock');

-- ---------------- Server-computed expected count (reviewer HOLD) ----------------
-- The RPC derives the expectation itself (Sched Two: 27, Prn Three: 13 —
-- see the fixtures). Caller-supplied figures are advisory only.
select throws_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000004', 25, 2, current_date, null, null)$$,
  'P0001','The count differs from the expected 27 pills on hand. Add a note explaining the variance.',
  'a direct RPC call omitting p_expected cannot skip the variance note');
select is((select count(*)::int from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000004'), 1,
  'the refused count persisted no delivery row');
select is((select remaining_pills::int from medications where id='f2200000-0000-0000-0000-000000000004'), 30,
  'the refused count left the recorded stock untouched');
select throws_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000004', 25, 2, current_date, 25, null)$$,
  'P0001','The expected count changed on the server: 27 pills on hand are now expected. Review the medication and record the count again.',
  'a fabricated matching p_expected/p_remaining pair is rejected');
select throws_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000004', 25, 2, current_date, 99, 'recount done')$$,
  'P0001','The expected count changed on the server: 27 pills on hand are now expected. Review the medication and record the count again.',
  'a variance note cannot launder a spoofed p_expected');
select is((select count(*)::int from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000004'), 1,
  'the spoofed calls persisted no delivery row');
select lives_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000004', 25, 2, current_date, 27, 'Two tablets dropped and wasted')$$,
  'an honest differing count with a note is recorded');
select is((select expected_pills::int from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000004' order by created_at desc limit 1), 27,
  'the delivery row persists the server-computed expected figure');
select is((select variance_reason from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000004' order by created_at desc limit 1), 'Two tablets dropped and wasted',
  'the delivery row keeps the variance note');
select is((select remaining_pills::int from medications where id='f2200000-0000-0000-0000-000000000004'), 25,
  'the recorded stock moved to the counted figure');
select lives_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000004', 25, 2, current_date, null, null)$$,
  'a count equal to the fresh server expectation needs no note');
select throws_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000005', 12, 0, current_date, null, null)$$,
  'P0001','The count differs from the expected 13 pills on hand. Add a note explaining the variance.',
  'a PRN count is checked against the server-projected figure');
select lives_ok($$select public.record_medication_delivery('f2200000-0000-0000-0000-000000000005', 12, 0, current_date, 13, 'One tablet crumbled')$$,
  'a PRN count with a note is recorded');
select is((select expected_pills::int from medication_deliveries where medication_id='f2200000-0000-0000-0000-000000000005' order by created_at desc limit 1), 13,
  'the PRN delivery row persists the server-computed figure');

-- ---------------- DSP: role-worded stock errors ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);

select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 99, 'Agitation', null)$$,
  'P0001','The dose exceeds the recorded stock. Ask your house manager, RN, or PM to record the count first.',
  'a DSP over-stock error names who can record the count');
select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000003', 1, 'Agitation', null)$$,
  'P0001','No count has been recorded for this medication yet. Ask your house manager, RN, or PM to record the first count.',
  'an uncounted PRN tells the DSP to ask for the first count');

-- ---------------- Legacy PRN overload: no end-user execution (reviewer HOLD fix-up #2) ----------------
-- The 2-argument record_prn_dose survives for internal callers only
-- (postgres/service_role). Still running as the DSP (authenticated role,
-- claims set above), a direct call to the reason-free signature must be
-- refused with 42501 before any function logic runs, while the same
-- user can still dose through the reason-bearing 4-argument signature.
-- Prn Med stock is 3 at this point (5 - the HM's 2-pill dose above).
select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 1)$$,
  '42501', null,
  'an authenticated user cannot execute the legacy reason-free PRN signature');
select lives_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 1, 'Agitation', null)$$,
  'the same user can still log a dose with a reason');
select is((select remaining_pills::int from medications where id='f2200000-0000-0000-0000-000000000002'), 2,
  'only the reason-bearing dose decremented the stock');

select * from finish();
rollback;
