begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(17);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Wave 7M fix-up (PR #228 reviewer HOLD): the MAR correction
-- compare-and-set is atomic at the database boundary. Two authorized
-- correctors load the same mark (same marked_at base); both attempt a
-- correction through public.correct_med_dose_mark; exactly one wins,
-- the loser gets DOSE_MARK_CONFLICT and writes nothing, and
-- med_dose_mark_history keeps the version chain.
--
-- Transaction note: now() is constant inside one transaction, and the
-- identity-guard trigger re-stamps marked_at := now() on every write,
-- so the fixture mark below carries an explicit pre-transaction base
-- instant (written as service_role, whose auth.uid() is null, so the
-- trigger keeps it). That keeps every base distinct and the CAS
-- comparisons exact; in production each request is its own transaction
-- and marked_at always advances.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2800000-0000-0000-0000-000000000001','CAS agency','MEDCAS-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','b2800000-0000-0000-0000-000000000001','Home A');
insert into auth.users(id,email) values
 ('d2800000-0000-0000-0000-000000000001','cas-hm@example.invalid'),
 ('d2800000-0000-0000-0000-000000000002','cas-dsp@example.invalid'),
 ('d2800000-0000-0000-0000-000000000003','cas-nurse@example.invalid');
update profiles set full_name='Hana HM' where id='d2800000-0000-0000-0000-000000000001';
update profiles set full_name='Dev DSP' where id='d2800000-0000-0000-0000-000000000002';
update profiles set full_name='Nina Nurse' where id='d2800000-0000-0000-0000-000000000003';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001','manager','house_manager','c2800000-0000-0000-0000-000000000001'),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','dsp','dsp','c2800000-0000-0000-0000-000000000001'),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','nurse','nurse','c2800000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000001','Person One','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','e2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000001');
insert into medications(id,agency_id,individual_id,name,kind,pills_per_day,remaining_pills,last_delivery_on) values
 ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','e2800000-0000-0000-0000-000000000001','Sched Med','scheduled',2,30,current_date);

-- The original mark, recorded by the DSP at an explicit instant. Both
-- correctors below "loaded" this version: it is their shared base.
insert into med_dose_marks(id,agency_id,individual_id,medication_id,dose_date,dose_time,status,marked_by,marked_by_name,marked_at,late,late_reason) values
 ('f2800000-0000-0000-0000-0000000000a1','a2800000-0000-0000-0000-000000000001','e2800000-0000-0000-0000-000000000001','f2800000-0000-0000-0000-000000000001',current_date - 1,'08:00','given','d2800000-0000-0000-0000-000000000002','Dev DSP','2026-10-31T03:40:43+00',true,'Entered from the paper MAR');
select set_config('cas.base', (select marked_at::text from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), true);

select has_function('public', 'correct_med_dose_mark',
  ARRAY['uuid','timestamptz','text','boolean','text'],
  'the correction CAS RPC exists with the expected signature');

-- Corrector 1: the house manager corrects from the shared base — wins.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000001"}',true);
select lives_ok(
  $$select public.correct_med_dose_mark('f2800000-0000-0000-0000-0000000000a1', current_setting('cas.base')::timestamptz, 'missed', true, 'Corrected by HM')$$,
  'corrector 1 (HM) corrects from the shared base');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select status from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'missed',
  'the stored row is corrector 1''s version');
select is((select marked_by_name from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'Hana HM',
  'the stored row carries corrector 1 as the giver of record');
select is((select count(*)::int from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 1,
  'history holds exactly the one replaced version');
select is((select status from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 'given',
  'history archived the original status');
select is((select marked_by_name from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 'Dev DSP',
  'history archived the original giver');
select is((select replaced_by from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 'd2800000-0000-0000-0000-000000000001'::uuid,
  'history records corrector 1 as the replacer');
select set_config('cas.winner', (select marked_at::text from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), true);

-- Corrector 2: the nurse attempts the same correction from the SAME
-- (now stale) base. The CAS must refuse and write nothing.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000003"}',true);
select throws_ok(
  $$select public.correct_med_dose_mark('f2800000-0000-0000-0000-0000000000a1', current_setting('cas.base')::timestamptz, 'given', true, 'Corrected by nurse')$$,
  'P0001', 'DOSE_MARK_CONFLICT',
  'corrector 2 (nurse) racing on the stale base is refused with DOSE_MARK_CONFLICT');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select status from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'missed',
  'the lost race left the winner''s status untouched');
select is((select marked_by_name from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'Hana HM',
  'the lost race left the winner as giver of record');
select is((select count(*)::int from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 1,
  'the lost race archived no phantom version');

-- Corrector 2 reloads (fresh base = the winner's stamp) and corrects
-- deliberately: this one lands, and the winner's version joins history.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000003"}',true);
select lives_ok(
  $$select public.correct_med_dose_mark('f2800000-0000-0000-0000-0000000000a1', current_setting('cas.winner')::timestamptz, 'given', true, 'Corrected by nurse after reload')$$,
  'corrector 2 corrects deliberately from the fresh base');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select status from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'given',
  'the deliberate correction landed');
select is((select marked_by_name from med_dose_marks where id='f2800000-0000-0000-0000-0000000000a1'), 'Nina Nurse',
  'the deliberate correction names its corrector');
select is((select count(*)::int from med_dose_mark_history where mark_id='f2800000-0000-0000-0000-0000000000a1'), 2,
  'history now holds both replaced versions');
select ok(exists(select 1 from med_dose_mark_history
  where mark_id='f2800000-0000-0000-0000-0000000000a1'
    and status='missed' and marked_by_name='Hana HM'
    and replaced_by='d2800000-0000-0000-0000-000000000003'::uuid),
  'history archived the race winner''s version when the nurse superseded it');

select * from finish();
rollback;
