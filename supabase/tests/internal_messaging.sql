-- INTERNAL-MESSAGING RLS: hosted enforcement for staff messaging.
-- Proves the rules the API promises: only thread participants can read a
-- conversation, nobody can forge authorship or post as a "system" note,
-- sent messages are immutable, adding a participant writes the visible
-- system note, and auditors are excluded entirely (messaging is staff
-- communication, not a compliance surface).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(29);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2800000-0000-0000-0000-000000000001','Messaging agency','MSG-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','b2800000-0000-0000-0000-000000000001','Home A'),
 ('c2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000001','b2800000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d2800000-0000-0000-0000-000000000001','msg-dsp1@example.invalid'),
 ('d2800000-0000-0000-0000-000000000002','msg-dsp2@example.invalid'),
 ('d2800000-0000-0000-0000-000000000003','msg-nurse@example.invalid'),
 ('d2800000-0000-0000-0000-000000000004','msg-auditor@example.invalid');
update profiles set must_change_password=false;
update profiles set full_name='Dsp One' where id='d2800000-0000-0000-0000-000000000001';
update profiles set full_name='Dsp Two' where id='d2800000-0000-0000-0000-000000000002';
update profiles set full_name='Nurse One' where id='d2800000-0000-0000-0000-000000000003';
update profiles set full_name='Auditor One' where id='d2800000-0000-0000-0000-000000000004';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001','dsp','dsp','c2800000-0000-0000-0000-000000000001'),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','dsp','dsp','c2800000-0000-0000-0000-000000000001'),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','nurse','nurse',null),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000004','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('e2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000002','Person B','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001','e2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000001'),
 ('a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','e2800000-0000-0000-0000-000000000001','c2800000-0000-0000-0000-000000000001');

-- ── The creator seeds a thread about an assigned Individual ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into message_threads(id,agency_id,subject,individual_id,created_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','Morning meds','e2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001')$$,
  'A DSP creates a thread linked to an Individual they support');
select lives_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001',null)$$,
  'The creator seeds their own participant row');
select lives_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000001')$$,
  'The creator seeds a recipient participant row');
select lives_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000001','user','Morning meds are ready.')$$,
  'The creator posts the first message');
select is((select count(*)::int from messages where thread_id='f2800000-0000-0000-0000-000000000001'),1,
  'The creator reads the thread messages');
select throws_ok($$insert into message_threads(agency_id,subject,individual_id,created_by)
  values ('a2800000-0000-0000-0000-000000000001','Other home','e2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A DSP cannot link a thread to an Individual at a home they have never worked');

-- ── The recipient reads, replies, and manages only their own read state ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from message_threads),1,
  'A participant sees the thread');
select lives_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','user','Thanks, giving them now.')$$,
  'A participant replies in the thread');
select is((select count(*)::int from messages where thread_id='f2800000-0000-0000-0000-000000000001'),2,
  'The participant reads the full history');
select lives_ok($$update message_participants set last_read_at=now()
  where thread_id='f2800000-0000-0000-0000-000000000001' and user_id='d2800000-0000-0000-0000-000000000002'$$,
  'A participant updates their own read state');
select throws_ok($$update message_participants set added_by='d2800000-0000-0000-0000-000000000002'
  where thread_id='f2800000-0000-0000-0000-000000000001' and user_id='d2800000-0000-0000-0000-000000000002'$$,
  'P0001', null, 'A participant row cannot rewrite who added them');
select lives_ok($$update message_participants set last_read_at=now()
  where thread_id='f2800000-0000-0000-0000-000000000001' and user_id='d2800000-0000-0000-0000-000000000001'$$,
  'Updating another participant row runs without error but must touch no row');
select is((select last_read_at is null from message_participants
  where thread_id='f2800000-0000-0000-0000-000000000001' and user_id='d2800000-0000-0000-0000-000000000001'),true,
  'Another participant''s read state is untouched');

-- ── A non-participant sees nothing and can do nothing ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from message_threads),0,
  'A non-participant sees no threads');
select is((select count(*)::int from messages),0,
  'A non-participant reads no messages');
select throws_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','user','Sneaking in.')$$,
  '42501', null, 'A non-participant cannot post into a thread');
select throws_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','d2800000-0000-0000-0000-000000000003')$$,
  '42501', null, 'A non-participant cannot add themselves to a thread');

-- ── Forgery and immutability (as the creator) ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000001"}',true);
select throws_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000002','user','Forged.')$$,
  '42501', null, 'A message cannot be authored as someone else');
select throws_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001',null,'system','Fake system note.')$$,
  '42501', null, 'A client cannot post a system note');
select throws_ok($$update messages set body='Edited after the fact.'
  where thread_id='f2800000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A sent message cannot be edited');
select throws_ok($$delete from messages where thread_id='f2800000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A sent message cannot be deleted');

-- ── Adding a participant is visible: the system note appears ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000002"}',true);
select lives_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','d2800000-0000-0000-0000-000000000002')$$,
  'An existing participant adds the nurse');
select is((select count(*)::int from messages where thread_id='f2800000-0000-0000-0000-000000000001' and kind='system'),1,
  'Adding a participant writes a system note');
select is((select body from messages where thread_id='f2800000-0000-0000-0000-000000000001' and kind='system'),
  'Dsp Two added Nurse One to this conversation.',
  'The system note names who added whom');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from messages where thread_id='f2800000-0000-0000-0000-000000000001'),3,
  'The added nurse now reads the full history, system note included');
select lives_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000003','user','I will check the MAR too.')$$,
  'The added nurse can post in the thread');

-- ── Auditors are excluded from messaging entirely ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000004"}',true);
select throws_ok($$insert into message_threads(agency_id,subject,created_by)
  values ('a2800000-0000-0000-0000-000000000001','Audit chat','d2800000-0000-0000-0000-000000000004')$$,
  '42501', null, 'An auditor cannot create a thread');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000001"}',true);
select throws_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000001','a2800000-0000-0000-0000-000000000001','d2800000-0000-0000-0000-000000000004','d2800000-0000-0000-0000-000000000001')$$,
  '42501', null, 'An auditor cannot be added to a thread');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from message_threads),0,
  'An auditor sees no threads');

select * from finish();
rollback;
