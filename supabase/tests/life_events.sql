-- LIFE-EVENTS RLS: hosted enforcement for the per-Individual timeline.
-- Proves the rules the API promises: anyone who can read the Individual
-- reads the timeline (DSPs on their Individuals, auditors read-only),
-- only the editor roles (administrator, compliance_admin, program
-- manager, house manager, nurse) can add/edit within their Individual
-- scope, HR has no access path, authorship binds to auth.uid(), and
-- removal is a reasoned soft void — never a delete — that hides the row
-- from the standard read path while retaining it for editors.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(39);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2900000-0000-0000-0000-000000000001','Life agency','LIFE-MO','MO','active'),
 ('a2900000-0000-0000-0000-000000000002','Other agency','OTHER-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2900000-0000-0000-0000-000000000001','a2900000-0000-0000-0000-000000000001','Program'),
 ('b2900000-0000-0000-0000-000000000002','a2900000-0000-0000-0000-000000000002','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2900000-0000-0000-0000-000000000001','a2900000-0000-0000-0000-000000000001','b2900000-0000-0000-0000-000000000001','Home A'),
 ('c2900000-0000-0000-0000-000000000002','a2900000-0000-0000-0000-000000000001','b2900000-0000-0000-0000-000000000001','Home B'),
 ('c2900000-0000-0000-0000-000000000003','a2900000-0000-0000-0000-000000000002','b2900000-0000-0000-0000-000000000002','Other home');
insert into auth.users(id,email) values
 ('d2900000-0000-0000-0000-000000000001','life-hm@example.invalid'),
 ('d2900000-0000-0000-0000-000000000002','life-pm@example.invalid'),
 ('d2900000-0000-0000-0000-000000000003','life-nurse@example.invalid'),
 ('d2900000-0000-0000-0000-000000000004','life-dsp1@example.invalid'),
 ('d2900000-0000-0000-0000-000000000005','life-dsp2@example.invalid'),
 ('d2900000-0000-0000-0000-000000000006','life-auditor@example.invalid'),
 ('d2900000-0000-0000-0000-000000000007','life-hr@example.invalid'),
 ('d2900000-0000-0000-0000-000000000008','life-adminb@example.invalid');
update profiles set must_change_password=false;
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000001','manager','house_manager','c2900000-0000-0000-0000-000000000001'),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000003','nurse','nurse','c2900000-0000-0000-0000-000000000001'),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000004','dsp','dsp','c2900000-0000-0000-0000-000000000001'),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000005','dsp','dsp','c2900000-0000-0000-0000-000000000002'),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000006','auditor','auditor',null),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000007','hr','hr',null),
 ('a2900000-0000-0000-0000-000000000002','d2900000-0000-0000-0000-000000000008','administrator','administrator',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2900000-0000-0000-0000-000000000001','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('e2900000-0000-0000-0000-000000000002','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000002','Person B','1980-01-01'),
 ('e2900000-0000-0000-0000-000000000003','a2900000-0000-0000-0000-000000000002','c2900000-0000-0000-0000-000000000003','Person C','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000004','e2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001'),
 ('a2900000-0000-0000-0000-000000000001','d2900000-0000-0000-0000-000000000005','e2900000-0000-0000-0000-000000000002','c2900000-0000-0000-0000-000000000002');

-- ── Editors record entries, each inside their own scope ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into life_events(id,agency_id,site_id,individual_id,event_date,category,title,note,recorded_by)
  values ('f2900000-0000-0000-0000-000000000001','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-03-14','hospital_er_stay','ER visit in March','Taken to the ER after a fall.','d2900000-0000-0000-0000-000000000002')$$,
  'A house manager records a life event for their home (recorded_by deliberately forged in the payload)');
select is((select recorded_by from life_events where id='f2900000-0000-0000-0000-000000000001'),'d2900000-0000-0000-0000-000000000001'::uuid,
  'Insert binds recorded_by to auth.uid(), not the payload');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-03-15','vacation','Beach trip','d2900000-0000-0000-0000-000000000001')$$,
  '23514', null, 'A category outside the fixed list is rejected');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000002','e2900000-0000-0000-0000-000000000002','2026-03-15','milestone','Other home event','d2900000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A house manager cannot record an event for an Individual at another home');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000002"}',true);
select lives_ok($$insert into life_events(id,agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('f2900000-0000-0000-0000-000000000002','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-06-01','milestone','First full week at the day program','d2900000-0000-0000-0000-000000000002')$$,
  'A program manager records a life event');
select lives_ok($$insert into life_events(id,agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('f2900000-0000-0000-0000-000000000004','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000002','e2900000-0000-0000-0000-000000000002','2026-01-05','admission_move_in','Moved in','d2900000-0000-0000-0000-000000000002')$$,
  'A program manager records an event at the second home (agency-wide scope)');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000003"}',true);
select lives_ok($$insert into life_events(id,agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('f2900000-0000-0000-0000-000000000003','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2025-11-20','family_change','Sister moved to Kansas City','d2900000-0000-0000-0000-000000000003')$$,
  'A nurse records a life event for an Individual at her home');
select lives_ok($$update life_events set title='Rewritten by the nurse' where id='f2900000-0000-0000-0000-000000000004'$$,
  'A nurse update attempt on another home''s event runs without error but must touch no row');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000002"}',true);
select is((select title from life_events where id='f2900000-0000-0000-0000-000000000004' limit 1),'Moved in',
  'An out-of-scope nurse cannot edit the other home''s event');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),3,
  'Person A has three timeline entries');

-- ── DSPs read their Individuals' timelines but cannot write ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),3,
  'An assigned DSP reads the timeline');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-04-01','milestone','DSP entry','d2900000-0000-0000-0000-000000000004')$$,
  '42501', null, 'A DSP cannot add a life event');
select lives_ok($$update life_events set title='Edited by a DSP' where id='f2900000-0000-0000-0000-000000000001'$$,
  'A DSP update attempt runs without error but must touch no row');
select is((select title from life_events where id='f2900000-0000-0000-0000-000000000001'),'ER visit in March',
  'The DSP edit changed nothing');
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000002'),0,
  'A DSP reads nothing about an Individual at another home');

-- ── The other home's DSP is fully out of scope ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),0,
  'Cross-home read is denied: the other home''s DSP sees none of Person A''s events');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-04-01','milestone','Cross-home entry','d2900000-0000-0000-0000-000000000005')$$,
  '42501', null, 'Cross-home write is denied');

-- ── Auditors read the record, and only read ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),3,
  'An auditor reads the timeline (it is part of the person''s record)');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-04-01','other','Auditor entry','d2900000-0000-0000-0000-000000000006')$$,
  '42501', null, 'An auditor cannot add a life event');
select lives_ok($$update life_events set title='Edited by an auditor' where id='f2900000-0000-0000-0000-000000000001'$$,
  'An auditor update attempt runs without error but must touch no row');
select is((select title from life_events where id='f2900000-0000-0000-0000-000000000001'),'ER visit in March',
  'The auditor edit changed nothing');

-- ── HR has no access path ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000007"}',true);
select is((select count(*)::int from life_events),0,
  'HR reads no life events at all');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-04-01','other','HR entry','d2900000-0000-0000-0000-000000000007')$$,
  '42501', null, 'HR cannot add a life event');

-- ── Another agency is fully walled off ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000008"}',true);
select is((select count(*)::int from life_events),0,
  'An administrator of another agency reads no life events here');
select throws_ok($$insert into life_events(agency_id,site_id,individual_id,event_date,category,title,recorded_by)
  values ('a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-04-01','other','Cross-agency entry','d2900000-0000-0000-0000-000000000008')$$,
  '42501', null, 'Cross-agency write is denied');

-- ── Edits stamp the editor; identity never moves ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update life_events set title='ER visit in March (updated)' where id='f2900000-0000-0000-0000-000000000001'$$,
  'An editor corrects an entry');
select is((select updated_by from life_events where id='f2900000-0000-0000-0000-000000000001'),'d2900000-0000-0000-0000-000000000001'::uuid,
  'The edit is stamped with the editor server-side');
select throws_ok($$update life_events set individual_id='e2900000-0000-0000-0000-000000000002' where id='f2900000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'An entry cannot be moved to a different Individual');

-- ── Voiding: reasoned, the caller's own, content frozen, then immutable ──
select throws_ok($$update life_events set voided_at=now(), voided_by='d2900000-0000-0000-0000-000000000001' where id='f2900000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A void without a reason is refused');
select throws_ok($$update life_events set voided_at=now(), voided_by='d2900000-0000-0000-0000-000000000002', void_reason='Not mine to void' where id='f2900000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A void cannot be recorded under someone else''s name');
select throws_ok($$update life_events set voided_at=now(), voided_by='d2900000-0000-0000-0000-000000000001', void_reason='Wrong chart', title='Changed while voiding' where id='f2900000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'Voiding cannot change the entry''s content in the same update');
select lives_ok($$update life_events set voided_at=now(), voided_by='d2900000-0000-0000-0000-000000000001', void_reason='Recorded on the wrong chart.' where id='f2900000-0000-0000-0000-000000000001'$$,
  'A reasoned void by an editor succeeds');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),2,
  'The voided entry leaves the DSP''s read path');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),2,
  'The voided entry leaves the auditor''s read path');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),3,
  'The voided entry is retained and still visible to editors');
select throws_ok($$update life_events set title='Editing a voided entry' where id='f2900000-0000-0000-0000-000000000001'$$,
  'P0001', null, 'A voided entry cannot be changed');
select throws_ok($$delete from life_events where id='f2900000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A life event can never be hard-deleted');

-- ── The related event-report link is stored data (no FK until PR #117) ──
select lives_ok($$insert into life_events(id,agency_id,site_id,individual_id,event_date,category,title,related_ger_id,recorded_by)
  values ('f2900000-0000-0000-0000-000000000005','a2900000-0000-0000-0000-000000000001','c2900000-0000-0000-0000-000000000001','e2900000-0000-0000-0000-000000000001','2026-03-14','hospital_er_stay','ER visit — event report filed','f2900000-0000-0000-0000-000000000099','d2900000-0000-0000-0000-000000000001')$$,
  'An entry can carry a related event-report id');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2900000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from life_events where individual_id='e2900000-0000-0000-0000-000000000001'),4,
  'Editors see all four rows for Person A, the voided one retained');

select * from finish();
rollback;
