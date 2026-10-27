-- THERAP-CORE-GAPS-1 RLS: hosted enforcement for the batch-1 tables.
-- The PR-review agent asked for hosted RLS tests proving that direct
-- database writes cannot do what the API forbids: cross-user edits and
-- deletes, mutation of an approved event report, forged authorship, and
-- filing a report under the wrong home.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(32);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2700000-0000-0000-0000-000000000001','Gaps agency','GAPS-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','b2700000-0000-0000-0000-000000000001','Home A'),
 ('c2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','b2700000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d2700000-0000-0000-0000-000000000001','gaps-dsp@example.invalid'),
 ('d2700000-0000-0000-0000-000000000002','gaps-dsp2@example.invalid'),
 ('d2700000-0000-0000-0000-000000000003','gaps-hm@example.invalid'),
 ('d2700000-0000-0000-0000-000000000004','gaps-nurse@example.invalid'),
 ('d2700000-0000-0000-0000-000000000005','gaps-auditor@example.invalid');
update profiles set must_change_password=false where id::text like 'd2700000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000001','dsp','dsp','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000002','dsp','dsp','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000003','manager','house_manager','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000004','nurse','nurse',null),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000005','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('e2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','Person B','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001');

-- ── GER: the author files a draft at their Individual's home ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into ger_reports(id,agency_id,site_id,individual_id,event_date,event_type,severity,description,reporter_name,reporter_signature,reporter_date,created_by_user_id)
  values ('f2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','High','Slipped in the kitchen.','Dsp One','Dsp One','2026-10-26','d2700000-0000-0000-0000-000000000001')$$,
  'DSP author inserts their own draft GER');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Wrong home.','d2700000-0000-0000-0000-000000000001')$$,
  '23514', null, 'A GER cannot be filed under a home its Individual does not live at');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000002','2026-10-26','Fall','Low','Other home person.','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A DSP cannot file a GER for an Individual at another home');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Forged author.','d2700000-0000-0000-0000-000000000002')$$,
  '42501', null, 'A GER cannot be authored as someone else');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,status,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Pre-approved.','approved','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A GER cannot be inserted already approved');

-- ── GER: another DSP can neither edit nor delete the draft ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update ger_reports set description='Hacked' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Cross-user update runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001' and description='Hacked'),0,
  'Another DSP cannot edit the author''s draft');
select lives_ok($$delete from ger_reports where id='f2700000-0000-0000-0000-000000000001'$$,
  'Cross-user delete runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001'),1,
  'Another DSP cannot delete the author''s draft');

-- ── GER: lifecycle — submit, review, approve, then the body locks ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update ger_reports set description='Slipped on a wet kitchen floor.' where id='f2700000-0000-0000-0000-000000000001'$$,
  'The author edits their own draft');
select lives_ok($$update ger_reports set status='submitted' where id='f2700000-0000-0000-0000-000000000001'$$,
  'The author submits their draft');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000003"}',true);
select throws_ok($$update ger_reports set description='Rewritten by a manager' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'A submitted report''s body cannot be edited, even by a manager');
select throws_ok($$update ger_reports set status='approved', reviewed_by_user_id='d2700000-0000-0000-0000-000000000001', reviewed_at=now() where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'A review cannot forge a different reviewer');
select lives_ok($$update ger_reports set status='approved', review_note='Reviewed.', reviewed_by_user_id='d2700000-0000-0000-0000-000000000003', reviewed_at=now() where id='f2700000-0000-0000-0000-000000000001'$$,
  'The house manager approves as themselves');
select throws_ok($$update ger_reports set description='Changed after approval' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'An approved report''s body is immutable at the database layer');
select throws_ok($$update ger_reports set review_note='Changed after approval' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'An approved report''s review record is immutable');
select lives_ok($$update ger_reports set resolution_status='in_progress', assigned_manager_user_id='d2700000-0000-0000-0000-000000000003', resolution_due_on='2026-10-30' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Follow-up on an approved report can still be worked');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$delete from ger_reports where id='f2700000-0000-0000-0000-000000000001'$$,
  'Author delete of an approved report runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001'),1,
  'An approved report cannot be deleted by its author');

-- ── Behavior entries: author-owned, manager override ──
select lives_ok($$insert into behavior_entries(id,agency_id,individual_id,occurred_on,behavior,intensity,recorded_by_user_id)
  values ('f2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Verbal outbursts','Moderate','d2700000-0000-0000-0000-000000000001')$$,
  'DSP records a behavior entry');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update behavior_entries set behavior='Hacked' where id='f2700000-0000-0000-0000-000000000002'$$,
  'Cross-user behavior update runs without error but must touch no row');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002' and behavior='Hacked'),0,
  'Another DSP cannot edit a behavior entry');
select lives_ok($$delete from behavior_entries where id='f2700000-0000-0000-0000-000000000002'$$,
  'Cross-user behavior delete runs without error but must touch no row');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002'),1,
  'Another DSP cannot delete a behavior entry');
select throws_ok($$insert into behavior_entries(agency_id,individual_id,occurred_on,behavior,recorded_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Forged','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A behavior entry cannot be recorded as someone else');

-- ── Health entries + nurse scope ──
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into health_track_entries(id,agency_id,individual_id,kind,occurred_on,title,recorded_by_user_id)
values ('f2700000-0000-0000-0000-000000000003','a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000002','lab','2026-10-26','A1C','d2700000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from health_track_entries where individual_id='e2700000-0000-0000-0000-000000000002'),1,
  'A nurse reads health entries agency-wide, across homes');
select throws_ok($$insert into health_track_entries(agency_id,individual_id,kind,occurred_on,title,recorded_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000002','lab','2026-10-26','Nurse entry','d2700000-0000-0000-0000-000000000004')$$,
  '42501', null, 'A nurse cannot add health entries at a home they are not assigned to');
select is((select count(*)::int from ger_reports where individual_id='e2700000-0000-0000-0000-000000000001'),1,
  'A nurse reads event reports agency-wide');

-- ── Behavior plans are manager-owned; auditors are read-only ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select throws_ok($$insert into behavior_plans(agency_id,individual_id,target_behaviors,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','Outbursts','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A DSP cannot create a behavior plan');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from ger_reports),1,
  'An auditor reads event reports (see everything, read-only)');
select lives_ok($$update ger_reports set description='Auditor edit' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Auditor update runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001' and description='Auditor edit'),0,
  'An auditor cannot change an event report');

select * from finish();
rollback;
