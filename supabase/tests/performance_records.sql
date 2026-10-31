begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(31);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency A + B. Users: DSP subject (…001), DSP peer (…002), HM of the
-- subject's home (…003), HM of another home (…010), PM (…004),
-- HR (…006), admin (…009), auditor (…007), outsider in agency B (…008).
insert into agencies (id, name, agency_code, state_code, status) values
 ('a4000000-0000-0000-0000-000000000001','Performance agency A','PERFA-MO','MO','active'),
 ('a4000000-0000-0000-0000-000000000002','Performance agency B','PERFB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home A'),
 ('c4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d4000000-0000-0000-0000-000000000001','perf-dsp@example.invalid'),
 ('d4000000-0000-0000-0000-000000000002','perf-peer@example.invalid'),
 ('d4000000-0000-0000-0000-000000000003','perf-hm@example.invalid'),
 ('d4000000-0000-0000-0000-000000000010','perf-hm2@example.invalid'),
 ('d4000000-0000-0000-0000-000000000004','perf-pm@example.invalid'),
 ('d4000000-0000-0000-0000-000000000006','perf-hr@example.invalid'),
 ('d4000000-0000-0000-0000-000000000009','perf-admin@example.invalid'),
 ('d4000000-0000-0000-0000-000000000007','perf-auditor@example.invalid'),
 ('d4000000-0000-0000-0000-000000000008','perf-outsider@example.invalid');
update profiles set must_change_password=false
 where id::text like 'd4000000-%';
update profiles set home_agency_id='a4000000-0000-0000-0000-000000000001'
 where id::text like 'd4000000-%' and id <> 'd4000000-0000-0000-0000-000000000008';
update profiles set home_agency_id='a4000000-0000-0000-0000-000000000002'
 where id='d4000000-0000-0000-0000-000000000008';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','dsp','dsp','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','dsp','dsp','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000003','manager','house_manager','c4000000-0000-0000-0000-000000000001'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000010','manager','house_manager','c4000000-0000-0000-0000-000000000002'),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000004','manager','program_manager',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000006','hr','hr',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000009','administrator','administrator',null),
 ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000007','auditor','auditor',null),
 ('a4000000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000008','dsp','dsp',null);

-- Fixtures (service role): a review for the subject (by HR) and one for
-- the peer (by HR); two corrective actions for the subject (HM-issued,
-- HR-issued) and one pending action for the peer (HR-issued).
insert into hr_performance_reviews(id,agency_id,staff_id,review_date,period_start,period_end,reviewer_id,reviewer_name,rating,strengths,growth_areas,goals) values
 ('f4000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-20','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000006','Harriet HR','Meets expectations','Reliable.','Documentation timing.','Same-shift notes.'),
 ('f4000000-0000-0000-0000-000000000002','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','2026-10-18','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000006','Harriet HR','Developing','Willing.','Punctuality.','On time, every shift.');
insert into hr_staff_corrective_actions(id,agency_id,staff_id,action_date,issuer_id,issuer_name,level,description,expectations,follow_up_date) values
 ('f4000000-0000-0000-0000-000000000011','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-21','d4000000-0000-0000-0000-000000000003','Hannah HM','Written warning','Late shift notes.','Notes before shift end.','2026-11-21'),
 ('f4000000-0000-0000-0000-000000000012','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-22','d4000000-0000-0000-0000-000000000006','Harriet HR','Verbal warning','Missed a med-count double-check.','Always two-person count.','2026-11-05'),
 ('f4000000-0000-0000-0000-000000000013','a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','2026-10-19','d4000000-0000-0000-0000-000000000006','Harriet HR','Verbal warning','Late arrival.','Arrive by shift start.',null);

-- Shape checks reject impossible rows outright.
select throws_ok($$insert into hr_performance_reviews(agency_id,staff_id,review_date,period_start,period_end,reviewer_id,rating,state)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-20','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000006','Developing','acknowledged')$$,
  '23514',null,'An acknowledged review without a signature is rejected by the shape check');
select throws_ok($$insert into hr_staff_corrective_actions(agency_id,staff_id,action_date,issuer_id,level,ack_state,ack_at)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-20','d4000000-0000-0000-0000-000000000006','Verbal warning','declined',now())$$,
  '23514',null,'A declined action without a witness is rejected by the shape check');
select throws_ok($$insert into hr_staff_corrective_actions(agency_id,staff_id,action_date,issuer_id,level,description,expectations)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-20','d4000000-0000-0000-0000-000000000006','Performance improvement plan','Missed goals.','Meet the plan.')$$,
  '23514',null,'A performance improvement plan without a follow-up date is rejected');

set local role authenticated;

-- ---------------- Subject (self) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),1,
  'A staff member reads their own reviews');
select is((select count(*)::int from hr_staff_corrective_actions where staff_id='d4000000-0000-0000-0000-000000000001'),2,
  'A staff member reads their own corrective actions');
select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000002'),0,
  'A staff member cannot read a peer''s reviews');
select lives_ok($$update hr_performance_reviews set state='acknowledged', ack_signature_name='Dana DSP'
  where id='f4000000-0000-0000-0000-000000000001'$$,
  'The subject acknowledges their own review');
select lives_ok($$update hr_performance_reviews set response_note='Working on it.'
  where id='f4000000-0000-0000-0000-000000000001'$$,
  'The subject adds their one response note');
select throws_ok($$update hr_performance_reviews set response_note='A second note.'
  where id='f4000000-0000-0000-0000-000000000001'$$,
  'P0001',null,'A second response note is refused — one response per review');
select throws_ok($$update hr_performance_reviews set rating='Developing'
  where id='f4000000-0000-0000-0000-000000000001'$$,
  'P0001',null,'Filed content is frozen: the rating cannot be edited');
select lives_ok($$update hr_staff_corrective_actions set ack_state='signed', ack_signature_name='Dana DSP'
  where id='f4000000-0000-0000-0000-000000000011'$$,
  'The subject signs a corrective action');
select throws_ok($$update hr_staff_corrective_actions set ack_state='declined', ack_signature_name=null
  where id='f4000000-0000-0000-0000-000000000012'$$,
  'P0001',null,'Declining without a witness is refused by the guard');
select lives_ok($$update hr_staff_corrective_actions set ack_state='declined', witness_name='Pete Peer'
  where id='f4000000-0000-0000-0000-000000000012'$$,
  'The subject declines to sign before a named witness');
select throws_ok($$insert into hr_performance_reviews(agency_id,staff_id,review_date,period_start,period_end,reviewer_id,rating)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','2026-10-20','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000001','Developing')$$,
  '42501',null,'A staff member cannot file a review on a peer');

-- ---------------- Peer ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000002"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),0,
  'A peer reads none of the subject''s reviews');
select is((select count(*)::int from hr_staff_corrective_actions where staff_id='d4000000-0000-0000-0000-000000000001'),0,
  'A peer reads none of the subject''s corrective actions');

-- ---------------- House manager, subject's home ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000003"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),1,
  'The home''s house manager reads the subject''s reviews');
select lives_ok($$update hr_staff_corrective_actions set outcome='resolved',
  outcome_note='Four clean weeks.', outcome_by_name='Hannah HM'
  where id='f4000000-0000-0000-0000-000000000011'$$,
  'The issuer sets the outcome with a note');
select throws_ok($$update hr_staff_corrective_actions set ack_state='signed', ack_signature_name='Hannah HM'
  where id='f4000000-0000-0000-0000-000000000013'$$,
  'P0001',null,'A manager cannot acknowledge on the staff member''s behalf');

-- ---------------- House manager, another home ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000010"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),0,
  'A house manager of another home reads nothing — the chain is site-scoped');

-- ---------------- Program manager ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000004"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),1,
  'A program manager reads agency-wide through the chain');

-- ---------------- HR ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000006"}',true);

select lives_ok($$insert into hr_performance_reviews(agency_id,staff_id,review_date,period_start,period_end,reviewer_id,reviewer_name,rating,strengths,growth_areas,goals)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000002','2026-10-25','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000001','Harriet HR','Meets expectations','Steady.','None noted.','Keep pace.')$$,
  'HR files a review');
select is((select reviewer_id::text from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000002' and review_date='2026-10-25'),'d4000000-0000-0000-0000-000000000006',
  'The reviewer is forced to the signed-in user (no impersonation)');
select is((select state from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000002' and review_date='2026-10-25'),'filed',
  'A freshly filed review always starts in the filed state');
select lives_ok($$update hr_staff_corrective_actions set outcome='extended',
  outcome_note='Two more weeks of checks.', outcome_by_name='Harriet HR'
  where id='f4000000-0000-0000-0000-000000000012'$$,
  'HR can set an outcome on an action they did not issue');

-- ---------------- Auditor (read-only) ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000007"}',true);

select is((select count(*)::int from hr_performance_reviews where staff_id='d4000000-0000-0000-0000-000000000001'),1,
  'An auditor reads the subject''s reviews');
select throws_ok($$insert into hr_performance_reviews(agency_id,staff_id,review_date,period_start,period_end,reviewer_id,rating)
  values ('a4000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','2026-10-20','2026-07-01','2026-09-30','d4000000-0000-0000-0000-000000000007','Developing')$$,
  '42501',null,'An auditor cannot file a review');
select throws_ok($$update hr_staff_corrective_actions set ack_state='signed', ack_signature_name='Ann Auditor'
  where id='f4000000-0000-0000-0000-000000000013'$$,
  'P0001',null,'An auditor cannot acknowledge for the staff member');

-- ---------------- Administrator ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000009"}',true);

select is((select count(*)::int from hr_staff_corrective_actions where staff_id='d4000000-0000-0000-0000-000000000001'),2,
  'An administrator reads the subject''s corrective actions');

-- ---------------- No deletion ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000001"}',true);
delete from hr_performance_reviews where id='f4000000-0000-0000-0000-000000000001';
select is((select count(*)::int from hr_performance_reviews where id='f4000000-0000-0000-0000-000000000001'),1,
  'Performance records cannot be deleted');

-- ---------------- Outsider ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d4000000-0000-0000-0000-000000000008"}',true);

select is((select count(*)::int from hr_performance_reviews),0,
  'An outsider from another agency reads nothing');

select * from finish();
rollback;
