begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);
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
 ('f2200000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','Uncounted Prn','prn',0,0,null);

-- Schema: the new evidence columns exist.
select has_column('medication_deliveries','expected_pills','delivery rows store the expected figure');
select has_column('medication_deliveries','variance_reason','delivery rows store the variance note');
select has_column('prn_dose_logs','reason','PRN dose logs store the reason');
select has_column('prn_dose_logs','follow_up','PRN dose logs store the follow-up note');
select has_column('med_dose_marks','late','MAR marks carry the Late stamp');
select has_column('med_dose_marks','late_reason','MAR marks carry the late reason');

-- A mark written without late data defaults to not-late.
select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','f2200000-0000-0000-0000-000000000001',current_date,'08:00','given','d2000000-0000-0000-0000-000000000001','Hana HM')$$,
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

-- ---------------- DSP: role-worded stock errors ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);

select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000002', 99, 'Agitation', null)$$,
  'P0001','The dose exceeds the recorded stock. Ask your house manager, RN, or PM to record the count first.',
  'a DSP over-stock error names who can record the count');
select throws_ok($$select public.record_prn_dose('f2200000-0000-0000-0000-000000000003', 1, 'Agitation', null)$$,
  'P0001','No count has been recorded for this medication yet. Ask your house manager, RN, or PM to record the first count.',
  'an uncounted PRN tells the DSP to ask for the first count');

select * from finish();
rollback;
