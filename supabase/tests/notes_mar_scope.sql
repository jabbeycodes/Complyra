begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(28);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A: Home A (p1, p2), Home B (p3). Agency B for tenant isolation.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a1000000-0000-0000-0000-000000000001','Scope agency A','SCOPEA-MO','MO','active'),
 ('a1000000-0000-0000-0000-000000000002','Scope agency B','SCOPEB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Home A'),
 ('c1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d1000000-0000-0000-0000-000000000001','scope-hm@example.invalid'),
 ('d1000000-0000-0000-0000-000000000002','scope-dsp1@example.invalid'),
 ('d1000000-0000-0000-0000-000000000003','scope-dsp2@example.invalid');
update profiles set must_change_password=false,home_agency_id='a1000000-0000-0000-0000-000000000001'
 where id::text like 'd1000000-%';
update profiles set full_name='Dana HM' where id='d1000000-0000-0000-0000-000000000001';
update profiles set full_name='Alex DSP' where id='d1000000-0000-0000-0000-000000000002';
update profiles set full_name='Sam DSP' where id='d1000000-0000-0000-0000-000000000003';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','manager','house_manager','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','dsp','dsp','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000003','dsp','dsp','c1000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Person One','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Person Two','1980-01-01'),
 ('e1000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','Person Three','1980-01-01');
-- DSP1 supports Person One; DSP2 supports Person Two.
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001'),
 ('a1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001');
insert into isp_programs(id,agency_id,individual_id,plan_year,name,effective_on,expires_on,status) values
 ('f1100000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','2026','Program 1',current_date - 30,current_date + 300,'approved'),
 ('f1100000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','2026','Program 3',current_date - 30,current_date + 300,'approved');
insert into medications(id,agency_id,individual_id,name,kind) values
 ('f1200000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Med One','scheduled'),
 ('f1200000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','Med Three','scheduled');
-- Existing records at Home B that Home A staff must never see.
insert into shift_notes(agency_id,individual_id,program_id,note_date,shift,summary,staff_user_id,staff_name) values
 ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','f1100000-0000-0000-0000-000000000003',current_date,'day','Home B note','d1000000-0000-0000-0000-000000000001','Dana HM');
insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name) values
 ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','f1200000-0000-0000-0000-000000000003',current_date,'08:00','given','d1000000-0000-0000-0000-000000000001','Dana HM');

set local role authenticated;

-- ---------------- DSP1 (assigned to Person One) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000002"}',true);

select is((select count(*)::int from shift_notes),0,'DSP cannot read another home''s notes');
select is((select count(*)::int from med_dose_marks),0,'DSP cannot read another home''s MAR');

select lives_ok($$insert into shift_notes(agency_id,individual_id,program_id,note_date,shift,summary,staff_user_id,staff_name)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','f1100000-0000-0000-0000-000000000001',current_date,'day','Own note','d1000000-0000-0000-0000-000000000003','Sam DSP')$$,
  'DSP can write a note for their assigned Individual');
select is((select staff_user_id::text from shift_notes where summary='Own note'),'d1000000-0000-0000-0000-000000000002',
  'Note author is forced to the signed-in user (no impersonation)');
select is((select staff_name from shift_notes where summary='Own note'),'Alex DSP','Note author name comes from the profile');

select throws_ok($$insert into shift_notes(agency_id,individual_id,program_id,note_date,shift,summary,staff_user_id,staff_name)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','f1100000-0000-0000-0000-000000000003',current_date,'day','Forbidden','d1000000-0000-0000-0000-000000000002','Alex DSP')$$,
  '42501',null,'DSP cannot write a note for an Individual they are not assigned to');

select throws_ok($$update shift_notes set individual_id='e1000000-0000-0000-0000-000000000002' where summary='Own note'$$,
  'P0001',null,'A note cannot be moved to another Individual');

select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','f1200000-0000-0000-0000-000000000001',current_date,'08:00','given','d1000000-0000-0000-0000-000000000003','Sam DSP')$$,
  'DSP can record a dose for their assigned Individual');
select is((select marked_by::text from med_dose_marks where medication_id='f1200000-0000-0000-0000-000000000001'),'d1000000-0000-0000-0000-000000000002',
  'MAR recorder is forced to the signed-in user');

select lives_ok($$update med_dose_marks set status='missed' where medication_id='f1200000-0000-0000-0000-000000000001'$$,
  'DSP can correct a mark');
select is((select count(*)::int from med_dose_mark_history where medication_id='f1200000-0000-0000-0000-000000000001' and status='given'),1,
  'The corrected mark keeps its previous version in history');

select throws_ok($$delete from med_dose_marks where medication_id='f1200000-0000-0000-0000-000000000001'$$,
  '42501',null,'MAR marks cannot be deleted');
select throws_ok($$insert into med_dose_mark_history(mark_id,agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_at)
  select id,agency_id,individual_id,medication_id,dose_date,dose_time,'given',now() from med_dose_marks limit 1$$,
  '42501',null,'Nobody can write MAR history directly');

select throws_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000003','f1200000-0000-0000-0000-000000000003',current_date,'20:00','given')$$,
  '42501',null,'DSP cannot record a dose for another home');
select throws_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','f1200000-0000-0000-0000-000000000003',current_date,'20:00','given')$$,
  'P0001',null,'A mark cannot pair an Individual with someone else''s medication');

-- ---------------- DSP2 (assigned to Person Two, same home) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from shift_notes),1,'A DSP reads notes for every Individual at their home (covering a housemate)');
select lives_ok($$insert into shift_notes(agency_id,individual_id,program_id,note_date,shift,summary,staff_user_id,staff_name)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','f1100000-0000-0000-0000-000000000001',current_date,'evening','Covering note','d1000000-0000-0000-0000-000000000002','Alex DSP')$$,
  'A DSP can write a note for a housemate they are not assigned to');
select is((select staff_user_id::text from shift_notes where summary='Covering note'),'d1000000-0000-0000-0000-000000000003',
  'The covering note is recorded under the DSP who wrote it');
select lives_ok($$insert into med_dose_marks(agency_id,individual_id,medication_id,dose_date,dose_time,status)
  values ('a1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','f1200000-0000-0000-0000-000000000001',current_date,'20:00','given')$$,
  'A DSP can record MAR for a housemate they are not assigned to');
-- DSP2 tries to change DSP1's 08:00 entry: no row is theirs, so nothing changes.
update med_dose_marks set status='given' where medication_id='f1200000-0000-0000-0000-000000000001' and dose_time='08:00';
-- DSP2 tries to edit DSP1's note: nothing changes.
update shift_notes set summary='Rewritten by someone else' where summary='Own note';

-- ---------------- DSP1 again: corrects their own records ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update shift_notes set summary='Own note (corrected)' where summary='Own note'$$,
  'A DSP can go back and edit their own note');
select is((select count(*)::int from shift_note_history where summary='Own note'),1,
  'The note''s previous wording is kept in history');

-- ---------------- HM at Home A ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-0000-0000-000000000001"}',true);
select is((select status from med_dose_marks where medication_id='f1200000-0000-0000-0000-000000000001' and dose_time='08:00'),'missed',
  'A DSP cannot change another staff member''s MAR entry');
select is((select count(*)::int from shift_notes where summary='Rewritten by someone else'),0,
  'A DSP cannot edit another staff member''s note');
select is((select marked_by::text from med_dose_marks where medication_id='f1200000-0000-0000-0000-000000000001' and dose_time='20:00'),'d1000000-0000-0000-0000-000000000003',
  'The MAR shows the covering DSP as the recorder');
select lives_ok($$update med_dose_marks set status='given' where medication_id='f1200000-0000-0000-0000-000000000001' and dose_time='08:00'$$,
  'A house manager can correct any MAR entry at their home');
select is((select count(*)::int from shift_notes),2,'HM reads notes for their home only');
select is((select count(*)::int from med_dose_mark_history),2,'Every MAR change is kept in history');
select is((select count(*)::int from med_dose_marks where individual_id='e1000000-0000-0000-0000-000000000003'),0,
  'HM at Home A cannot read Home B''s MAR');

select * from finish();
rollback;
