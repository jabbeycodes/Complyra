-- INTERNAL-MESSAGING RLS: hosted enforcement for staff messaging.
-- Proves the rules the API promises: only thread participants can read a
-- conversation, nobody can forge authorship or post as a "system" note,
-- sent messages are immutable, adding a participant writes the visible
-- system note, and auditors are excluded entirely (messaging is staff
-- communication, not a compliance surface).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(41);
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

-- ── Permission backfill: the DPM merge must not strip messages.use ──
-- The canonical seed lands before 20260916060000, whose frozen pack
-- replaced the program_manager template/matrix rows; the follow-on
-- backfill migration restores the key wherever it is absent.
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select permissions ->> 'messages.use' from public.role_templates
  where key = 'program_manager'), 'true',
  'After the full chain, the program_manager template carries messages.use = true');
select is((select permissions ->> 'messages.use' from public.role_permission_matrix
  where role_key = 'program_manager'), 'true',
  'After the full chain, the program_manager matrix row carries messages.use = true');
select is((select permissions ->> 'messages.use' from public.role_templates
  where key = 'auditor'), 'false',
  'The auditor template carries messages.use = false explicitly, so the exclusion survives provisioning');
select is((select permissions ->> 'messages.use' from public.role_permission_matrix
  where role_key = 'auditor'), 'false',
  'The auditor matrix row carries messages.use = false explicitly');

-- ── Provisioning: a fresh agency inherits the fixed templates ──
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2800000-0000-0000-0000-000000000002','Messaging PM agency','MSGPM-MO','MO','active');
select lives_ok($$select public.provision_agency_roles('a2800000-0000-0000-0000-000000000002')$$,
  'Provisioning roles for a fresh agency runs cleanly');
select is((select permissions ->> 'messages.use' from public.agency_roles
  where agency_id = 'a2800000-0000-0000-0000-000000000002' and template_key = 'program_manager'), 'true',
  'A freshly provisioned agency gives its program_manager row messages.use = true');
select is((select permissions ->> 'messages.use' from public.agency_roles
  where agency_id = 'a2800000-0000-0000-0000-000000000002' and template_key = 'auditor'), 'false',
  'A freshly provisioned agency gives its auditor row messages.use = false (explicit)');
insert into auth.users(id,email) values
 ('d2800000-0000-0000-0000-000000000005','msg-pm@example.invalid'),
 ('d2800000-0000-0000-0000-000000000006','msg-dsp3@example.invalid');
update profiles set must_change_password=false;
update profiles set full_name='Pm One' where id='d2800000-0000-0000-0000-000000000005';
update profiles set full_name='Dsp Three' where id='d2800000-0000-0000-0000-000000000006';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000005','manager','program_manager',null),
 ('a2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000006','dsp','dsp',null);

-- ── The previously broken path: a PM can be added to a thread ──
-- Before the backfill, the participant policy's check of the added
-- person's agency_roles row found no messages.use on the PM row and
-- denied the insert, so no program manager could ever be added.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000006"}',true);
select lives_ok($$insert into message_threads(id,agency_id,subject,created_by)
  values ('f2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000002','Coverage question','d2800000-0000-0000-0000-000000000006')$$,
  'A DSP creates a thread in the freshly provisioned agency');
select lives_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000006',null)$$,
  'The creator seeds their own participant row');
select lives_ok($$insert into messages(thread_id,agency_id,sender_id,kind,body)
  values ('f2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000006','user','Can you cover the Saturday review?')$$,
  'The creator posts the first message');
select lives_ok($$insert into message_participants(thread_id,agency_id,user_id,added_by)
  values ('f2800000-0000-0000-0000-000000000002','a2800000-0000-0000-0000-000000000002','d2800000-0000-0000-0000-000000000005','d2800000-0000-0000-0000-000000000006')$$,
  'A program manager can be added as a thread participant');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2800000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from message_threads),1,
  'The added program manager reads the thread');

select * from finish();
rollback;
