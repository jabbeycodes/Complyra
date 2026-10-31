begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(13);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Medication-administration clearance gate (20261031240000; simulation
-- batches 40 + 50): a DSP whose training is not cleared — including a
-- DSP with no training record at all — cannot record doses at the
-- database layer (record_prn_dose RPC + med_dose_marks /
-- med_dose_exceptions RLS), while a cleared DSP records normally and
-- oversight roles (here: house manager) are never gated. The clearance
-- computation is private.med_admin_cleared, the SQL mirror of
-- evaluateInRatioGate / getStaffTrainingProfile().clearedForInRatio.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a7000000-0000-0000-0000-000000000001','Clearance agency','MEDCLR-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','b7000000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d7000000-0000-0000-0000-000000000001','clr-hm@example.invalid'),
 ('d7000000-0000-0000-0000-000000000002','clr-uncleared@example.invalid'),
 ('d7000000-0000-0000-0000-000000000003','clr-cleared@example.invalid'),
 ('d7000000-0000-0000-0000-000000000004','clr-norecord@example.invalid');
update profiles set full_name='Hana HM' where id='d7000000-0000-0000-0000-000000000001';
update profiles set full_name='Uma Uncleared' where id='d7000000-0000-0000-0000-000000000002';
update profiles set full_name='Cleo Cleared' where id='d7000000-0000-0000-0000-000000000003';
update profiles set full_name='Ned Norecord' where id='d7000000-0000-0000-0000-000000000004';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','manager','house_manager','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','dsp','dsp','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','dsp','dsp','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000004','dsp','dsp','c7000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e7000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','Person One','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','e7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001'),
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000004','e7000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001');
insert into medications(id,agency_id,individual_id,name,kind,pills_per_day,remaining_pills,last_delivery_on) values
 ('f7200000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','Sched Med','scheduled',2,30,current_date),
 ('f7200000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','Prn Med','prn',0,10,current_date);

-- Uncleared DSP: one completed line at 4 hours and no countersignature —
-- short on hours AND unsigned, so not cleared.
insert into training_requirements(id,agency_id,user_id,topic_id,site_id,source,status) values
 ('f7300000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','chk-1-01','c7000000-0000-0000-0000-000000000001','checklist','complete');
insert into training_signoffs(agency_id,requirement_id,initials,signed_on,trainer_name,hours_total,hours_with_hm) values
 ('a7000000-0000-0000-0000-000000000001','f7300000-0000-0000-0000-000000000001','UU',current_date - 2,'Hana HM',4,0);

-- Cleared DSP: three completed lines (22 hours total, 10 with the HM)
-- plus the staff + HM countersignature for the site.
insert into training_requirements(id,agency_id,user_id,topic_id,site_id,source,status) values
 ('f7300000-0000-0000-0000-000000000011','a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','chk-2-02','c7000000-0000-0000-0000-000000000001','checklist','complete'),
 ('f7300000-0000-0000-0000-000000000012','a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','chk-2-03','c7000000-0000-0000-0000-000000000001','checklist','complete'),
 ('f7300000-0000-0000-0000-000000000013','a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','chk-1-01','c7000000-0000-0000-0000-000000000001','checklist','complete');
insert into training_signoffs(agency_id,requirement_id,initials,signed_on,trainer_name,hours_total,hours_with_hm) values
 ('a7000000-0000-0000-0000-000000000001','f7300000-0000-0000-0000-000000000011','CC',current_date - 10,'Hana HM',8,8),
 ('a7000000-0000-0000-0000-000000000001','f7300000-0000-0000-0000-000000000012','CC',current_date - 10,'Hana HM',8,0),
 ('a7000000-0000-0000-0000-000000000001','f7300000-0000-0000-0000-000000000013','CC',current_date - 10,'Hana HM',6,2);
insert into training_countersignatures(agency_id,user_id,site_id,staff_signature_name,staff_signed_at,hm_signature_name,hm_signed_at) values
 ('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003','c7000000-0000-0000-0000-000000000001','Cleo Cleared',now(),'Hana HM',now());

-- No-record DSP (…0004) intentionally gets no training rows at all.

set local role authenticated;

-- ---------------- Clearance truth table ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000003"}',true);
select is(private.med_admin_cleared('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000003'), true,
  'a DSP with 22 signed hours (10 with HM) and both signatures is cleared');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000002"}',true);
select is(private.med_admin_cleared('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002'), false,
  'a DSP short on hours with no countersignature is not cleared');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select is(private.med_admin_cleared('a7000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000004'), false,
  'a DSP with no training record at all is not cleared');

-- ---------------- Uncleared DSP: every dose write refused ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000002"}',true);
select throws_ok($$select public.record_prn_dose('f7200000-0000-0000-0000-000000000002', 1, 'Agitation', null)$$,
  'P0001','Medication actions unlock when your training is cleared.',
  'an uncleared DSP cannot record a PRN dose');
select throws_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000001',current_date,'08:00','given','d7000000-0000-0000-0000-000000000002','Uma Uncleared')$$,
  '42501', null,
  'an uncleared DSP cannot insert a dose mark');
select throws_ok($$insert into med_dose_exceptions(agency_id,individual_id,medication_id,occurred_on,kind,pills_affected,reason,created_by)
  values ('a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000001',current_date,'refused',1,'Refused the dose','d7000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'an uncleared DSP cannot log a dose exception');

-- ---------------- No-record DSP: refused the same way ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select public.record_prn_dose('f7200000-0000-0000-0000-000000000002', 1, 'Agitation', null)$$,
  'P0001','Medication actions unlock when your training is cleared.',
  'a DSP with no training record cannot record a PRN dose');

-- ---------------- Cleared DSP: records normally ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000003"}',true);
select lives_ok($$select public.record_prn_dose('f7200000-0000-0000-0000-000000000002', 2, 'Agitation', null)$$,
  'a cleared DSP records a PRN dose');
select is((select remaining_pills::int from medications where id='f7200000-0000-0000-0000-000000000002'), 8,
  'the cleared DSP dose decremented the recorded stock');
select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000001',current_date,'08:00','given','d7000000-0000-0000-0000-000000000003','Cleo Cleared')$$,
  'a cleared DSP inserts a dose mark');
select lives_ok($$insert into med_dose_exceptions(agency_id,individual_id,medication_id,occurred_on,kind,pills_affected,reason,created_by)
  values ('a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000001',current_date,'wasted',1,'Tablet dropped','d7000000-0000-0000-0000-000000000003')$$,
  'a cleared DSP logs a dose exception');

-- ---------------- House manager: never gated ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d7000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$select public.record_prn_dose('f7200000-0000-0000-0000-000000000002', 1, 'Agitation', null)$$,
  'a house manager with no training record still records a PRN dose');
select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a7000000-0000-0000-0000-000000000001','e7000000-0000-0000-0000-000000000001','f7200000-0000-0000-0000-000000000001',current_date,'20:00','given','d7000000-0000-0000-0000-000000000001','Hana HM')$$,
  'a house manager inserts a dose mark');

select * from finish();
rollback;
