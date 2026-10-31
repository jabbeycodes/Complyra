begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Corrective-action site scope (migration 20261031170000, reviewer
-- HOLD fix-up on PR #199):
--  * an action belongs to a home: house managers and DSPs reach only
--    their own home's actions (read AND write);
--  * site-less (agency-level / legacy) actions are visible to agency
--    management and auditors only;
--  * the identity guard refuses assignees who do not CURRENTLY work
--    at the action's home (membership home or an ACTIVE assignment;
--    ended assignments do not count).

insert into agencies (id, name, agency_code, state_code, status) values
 ('a5000000-0000-0000-0000-000000000001','Corrective scope agency','CASCOPE-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','Home A'),
 ('c5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d5000000-0000-0000-0000-000000000001','ca-admin@example.invalid'),
 ('d5000000-0000-0000-0000-000000000002','ca-pm@example.invalid'),
 ('d5000000-0000-0000-0000-000000000003','ca-hm-a@example.invalid'),
 ('d5000000-0000-0000-0000-000000000004','ca-hm-b@example.invalid'),
 ('d5000000-0000-0000-0000-000000000005','ca-dsp-a@example.invalid'),
 ('d5000000-0000-0000-0000-000000000006','ca-dsp-b@example.invalid'),
 ('d5000000-0000-0000-0000-000000000007','ca-auditor@example.invalid'),
 ('d5000000-0000-0000-0000-000000000008','ca-floater@example.invalid'),
 ('d5000000-0000-0000-0000-000000000009','ca-former@example.invalid');
update profiles set must_change_password=false where id::text like 'd5000000-%';
 where id::text like 'd5000000-%';
update profiles set home_agency_id='a5000000-0000-0000-0000-000000000001'
 where id::text like 'd5000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000003','manager','house_manager','c5000000-0000-0000-0000-000000000001'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000004','manager','house_manager','c5000000-0000-0000-0000-000000000002'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000005','dsp','dsp','c5000000-0000-0000-0000-000000000001'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000006','dsp','dsp','c5000000-0000-0000-0000-000000000002'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000007','auditor','auditor',null),
 ('a5000000-0000-0000-0000-000000000008','d5000000-0000-0000-0000-000000000008','dsp','dsp','c5000000-0000-0000-0000-000000000002'),
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000009','dsp','dsp',null);

-- This fixture agency's administrator has enabled corrective-action
-- management for house managers (the post-migration opt-in state).
select public.provision_agency_roles('a5000000-0000-0000-0000-000000000001');
update agency_roles
   set permissions = permissions || '{"correctiveActions.manage":true}'::jsonb
 where agency_id='a5000000-0000-0000-0000-000000000001'
   and template_key in ('house_manager','program_manager','administrator');

insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000001','Home A person','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id,starts_on,ends_on) values
 -- floater: membership home is B, ACTIVE assignment to the Home A person.
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000008','e5000000-0000-0000-0000-000000000001',null,'2026-01-01',null),
 -- former: assignment to the Home A person ENDED in 2020.
 ('a5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000009','e5000000-0000-0000-0000-000000000001',null,'2020-01-01','2020-06-01');

-- Fixture actions (service role): one per home + one agency-level.
insert into corrective_actions(id,agency_id,title,assigned_to_user_id,site_id,created_by_user_id) values
 ('f5000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','Home A action','d5000000-0000-0000-0000-000000000005','c5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001'),
 ('f5000000-0000-0000-0000-000000000002','a5000000-0000-0000-0000-000000000001','Home B action',null,'c5000000-0000-0000-0000-000000000002','d5000000-0000-0000-0000-000000000001'),
 ('f5000000-0000-0000-0000-000000000003','a5000000-0000-0000-0000-000000000001','Agency-level action',null,null,'d5000000-0000-0000-0000-000000000001');

set local role authenticated;

-- Administrator and PM see every action in the agency.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from corrective_actions),3,
  'administrator sees all corrective actions');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000002"}',true);
select is((select count(*)::int from corrective_actions),3,
  'program manager sees all corrective actions');

-- HM of Home A: only Home A's action; the other home's and the
-- agency-level action are invisible.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000003"}',true);
select is((select count(*)::int from corrective_actions),1,
  'HM-A sees exactly one action: their own home''s');
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000002'),0,
  'HM-A cannot read Home B''s action');
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000003'),0,
  'HM-A cannot read the agency-level action');

-- HM-A can create at their own home, never at another home.
select lives_ok($$insert into corrective_actions(agency_id,title,site_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','HM-A own action','c5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000003')$$,
  'HM-A creates an action at their own home');
select throws_like($$insert into corrective_actions(agency_id,title,site_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','HM-A cross-home action','c5000000-0000-0000-0000-000000000002','d5000000-0000-0000-0000-000000000003')$$,
  '%row-level security%',
  'HM-A cannot create an action at another home');

-- HM-A cannot rewrite Home B's action (RLS silently scopes the update
-- to zero rows); the title survives, verified as service role below.
update corrective_actions set title='Hijacked' where id='f5000000-0000-0000-0000-000000000002';
-- HM-A resolves their own home's action.
select lives_ok($$update corrective_actions set status='resolved'
  where id='f5000000-0000-0000-0000-000000000001'$$,
  'HM-A resolves their own home''s action');
reset role;
select is((select title from corrective_actions where id='f5000000-0000-0000-0000-000000000002'),'Home B action',
  'Home B''s action title survived HM-A''s update attempt');
select is((select status from corrective_actions where id='f5000000-0000-0000-0000-000000000001'),'resolved',
  'HM-A''s resolve of the Home A action persisted');
set local role authenticated;

-- HM of Home B cannot read Home A's action.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000001'),0,
  'HM-B cannot read Home A''s action');

-- DSPs read their own home's actions (house-team visibility), never
-- the other home's; a DSP cannot create (no manage permission).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000001'),1,
  'DSP-A reads Home A''s action');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000006"}',true);
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000001'),0,
  'DSP-B cannot read Home A''s action');
select throws_like($$insert into corrective_actions(agency_id,title,site_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','DSP-B action','c5000000-0000-0000-0000-000000000002','d5000000-0000-0000-0000-000000000006')$$,
  '%row-level security%',
  'DSP cannot create corrective actions (no correctiveActions.manage)');

-- Auditor reads everything, writes nothing.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000007"}',true);
select is((select count(*)::int from corrective_actions
  where id in ('f5000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000002','f5000000-0000-0000-0000-000000000003')),3,
  'auditor reads every action, including agency-level');
update corrective_actions set title='Auditor edit' where id='f5000000-0000-0000-0000-000000000001';
reset role;
select is((select title from corrective_actions where id='f5000000-0000-0000-0000-000000000001'),'Home A action',
  'auditor''s update attempt changed nothing');
set local role authenticated;

-- Assignee placement at the database boundary (as administrator):
-- ended assignments and wrong-home staff are refused; an ACTIVE
-- assignment through an Individual places the assignee at the home.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000001"}',true);
select throws_like($$insert into corrective_actions(agency_id,title,site_id,assigned_to_user_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','Former assignee','c5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000009','d5000000-0000-0000-0000-000000000001')$$,
  '%work at that home%',
  'an assignee whose assignment has ENDED is refused');
select lives_ok($$insert into corrective_actions(agency_id,title,site_id,assigned_to_user_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','Floater assignee','c5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000008','d5000000-0000-0000-0000-000000000001')$$,
  'an assignee with an ACTIVE assignment at the home is accepted');
select throws_like($$insert into corrective_actions(agency_id,title,site_id,assigned_to_user_id,created_by_user_id)
  values ('a5000000-0000-0000-0000-000000000001','Wrong-home assignee','c5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000006','d5000000-0000-0000-0000-000000000001')$$,
  '%work at that home%',
  'an assignee from another home is refused');

-- A site-less action stays management-only even for its assignee.
select lives_ok($$insert into corrective_actions(id,agency_id,title,assigned_to_user_id,site_id,created_by_user_id)
  values ('f5000000-0000-0000-0000-000000000004','a5000000-0000-0000-0000-000000000001','Agency-level, assigned','d5000000-0000-0000-0000-000000000005',null,'d5000000-0000-0000-0000-000000000001')$$,
  'administrator creates a site-less action assigned to a DSP');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d5000000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from corrective_actions where id='f5000000-0000-0000-0000-000000000004'),0,
  'the assignee cannot see a site-less action (agency-level = management only)');

select * from finish();
rollback;
