begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Agency with Home A (Lawton) and Home B (Cedar).
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2000000-0000-0000-0000-000000000001','Shift agency','SHIFT-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Lawton'),
 ('c2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','Cedar');
insert into auth.users(id,email) values
 ('d2000000-0000-0000-0000-000000000001','shift-hm@example.invalid'),
 ('d2000000-0000-0000-0000-000000000002','shift-dsp1@example.invalid'),
 ('d2000000-0000-0000-0000-000000000003','shift-dsp2@example.invalid'),
 ('d2000000-0000-0000-0000-000000000004','shift-dsp3@example.invalid'),
 ('d2000000-0000-0000-0000-000000000005','shift-hr@example.invalid');
update profiles set must_change_password=false,home_agency_id='a2000000-0000-0000-0000-000000000001'
 where id::text like 'd2000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','manager','house_manager','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','dsp','dsp','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','dsp','dsp','c2000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000004','dsp','dsp','c2000000-0000-0000-0000-000000000002'),
 ('a2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000005','hr','hr',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Maya','1980-01-01');
-- DSP1 and DSP2 finished Lawton's in-home training; DSP3 has not.
insert into training_checklists(agency_id,individual_id,staff_user_id,staff_name,staff_signed_at,hm_signed_at) values
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','DSP One',now(),now()),
 ('a2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','DSP Two',now(),now());

-- Times: the Monday two weeks out, in Missouri time.
create temp table t as
select (date_trunc('week', now() at time zone 'America/Chicago') + interval '14 days') as mon;
create temp table ids(name text primary key, id uuid);
grant select on t to authenticated;
grant all on ids to authenticated;

-- DSP2 already works 36 hours that week (Mon-Thu 9h shifts).
insert into hr_shifts(agency_id,site_id,staff_id,title,starts_at,ends_at,status,created_by)
select 'a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','Day',
       ((select mon from t) + (n || ' days')::interval + time '06:00') at time zone 'America/Chicago',
       ((select mon from t) + (n || ' days')::interval + time '15:00') at time zone 'America/Chicago',
       'published','d2000000-0000-0000-0000-000000000001'
from generate_series(0,3) n;

set local role authenticated;

-- ---------------- HM posts ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into ids select 'temp_fc', post_open_shift('c2000000-0000-0000-0000-000000000001','temporary','Evening 2:30–10:30',
  ((select mon from t) + time '14:30') at time zone 'America/Chicago', ((select mon from t) + time '22:30') at time zone 'America/Chicago',
  '{}',null,null,null,'',1,'first_come','site')$$, 'HM posts a temporary first-come shift in the future');
select lives_ok($$insert into ids select 'temp_fri', post_open_shift('c2000000-0000-0000-0000-000000000001','temporary','Friday evening',
  ((select mon from t) + interval '4 days' + time '14:30') at time zone 'America/Chicago', ((select mon from t) + interval '4 days' + time '22:30') at time zone 'America/Chicago',
  '{}',null,null,null,'',1,'first_come','site')$$, 'HM posts a second temporary shift');
select lives_ok($$insert into ids select 'perm', post_open_shift('c2000000-0000-0000-0000-000000000001','permanent','Weekday evenings',
  null,null,'{1,2,3,4,5}','14:30','22:30',((select mon from t))::date,'',1,'first_come','site')$$, 'HM posts a permanent slot');
select is((select pickup_mode from hr_open_shifts where id=(select id from ids where name='perm')),'approval','Permanent slots are always bids');
select is((select weekly_hours from hr_open_shifts where id=(select id from ids where name='perm')),40.00::numeric,'Permanent weekly hours are computed (5 × 8h)');
select throws_ok($$select post_open_shift('c2000000-0000-0000-0000-000000000002','temporary','Other home',
  now()+interval '2 days', now()+interval '2 days 8 hours','{}',null,null,null,'',1,'first_come','site')$$,
  '42501',null,'HM cannot post for a site they don''t manage');
select throws_ok($$select post_open_shift('c2000000-0000-0000-0000-000000000001','temporary','Past',
  now()-interval '1 day', now()-interval '16 hours','{}',null,null,null,'',1,'first_come','site')$$,
  'P0001',null,'Temporary shifts must be in the future');
select throws_ok($$select post_open_shift('c2000000-0000-0000-0000-000000000001','permanent','Agency-wide',
  null,null,'{1}','06:30','14:30',current_date+7,'',1,'approval','agency')$$,
  '42501',null,'Only HR can post agency-wide openings');

-- ---------------- Visibility ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from hr_open_shifts),0,'Staff not trained at the site don''t see its postings');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from hr_open_shifts),3,'Trained staff see the site''s postings');
select throws_ok($$insert into hr_open_shifts(agency_id,site_id,title,starts_at,ends_at,posted_by)
  values ('a2000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Sneaky',now()+interval '1 day',now()+interval '1 day 8 hours','d2000000-0000-0000-0000-000000000002')$$,
  '42501',null,'Postings can''t be written directly');

-- ---------------- First come, first served ----------------
select is(respond_open_shift((select id from ids where name='temp_fc'),'pick_up'),'picked_up','DSP1 picks up the shift');
select is((select count(*)::int from hr_shifts where staff_id='d2000000-0000-0000-0000-000000000002'),1,'The shift is on DSP1''s schedule');
select is((select status from hr_open_shifts where id=(select id from ids where name='temp_fc')),'filled','The one slot is filled');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000003"}',true);
select throws_ok($$select respond_open_shift((select id from ids where name='temp_fc'),'pick_up')$$,
  'P0001','This shift is no longer open.','A filled shift can''t be picked up again');

-- ---------------- 40-hour limit: over-threshold pickups become bids ----------------
select is(respond_open_shift((select id from ids where name='temp_fri'),'pick_up'),'requested',
  'At 36h, an 8h pickup would pass 40h, so it becomes a bid');
select is((select would_be_overtime from hr_open_shift_responses where staff_id='d2000000-0000-0000-0000-000000000003'),true,
  'The bid is flagged as overtime');
select throws_ok($$select decide_open_shift_request((select id from hr_open_shift_responses where staff_id='d2000000-0000-0000-0000-000000000003'), true)$$,
  '42501',null,'A DSP cannot approve bids');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000002"}',true);
select is(respond_open_shift((select id from ids where name='perm'),'pick_up'),'requested','DSP1 bids on the permanent slot');

-- ---------------- HM approves ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000001"}',true);
select is(decide_open_shift_request((select id from hr_open_shift_responses where staff_id='d2000000-0000-0000-0000-000000000003'), true),'approved',
  'HM approves the overtime bid');
select is(decide_open_shift_request((select id from hr_open_shift_responses where staff_id='d2000000-0000-0000-0000-000000000002'
  and open_shift_id=(select id from ids where name='perm')), true),'approved','HM awards the permanent slot');

reset role;
select is((select count(*)::int from hr_staffing_patterns where staff_id='d2000000-0000-0000-0000-000000000002' and weekly_hours=40),1,
  'The permanent slot becomes DSP1''s recurring schedule');
set local role authenticated;

-- ---------------- HR agency-wide permanent opening ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000005"}',true);
select lives_ok($$insert into ids select 'hr_perm', post_open_shift('c2000000-0000-0000-0000-000000000001','permanent','Weekend days',
  null,null,'{0,6}','06:30','14:30',((select mon from t))::date,'',2,'approval','agency')$$, 'HR posts an agency-wide permanent opening');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2000000-0000-0000-0000-000000000004"}',true);
select is(respond_open_shift((select id from ids where name='hr_perm'),'pick_up'),'requested',
  'Any staff member can apply to an agency-wide opening, even before site training');

select * from finish();
rollback;
