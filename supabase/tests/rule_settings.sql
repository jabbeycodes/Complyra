begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a3000000-0000-0000-0000-000000000001','Rules agency A','RULESA-MO','MO','active'),
 ('a3000000-0000-0000-0000-000000000002','Rules agency B','RULESB-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c3000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Lawton');
insert into auth.users(id,email) values
 ('d3000000-0000-0000-0000-000000000001','rules-admin@example.invalid'),
 ('d3000000-0000-0000-0000-000000000002','rules-dsp@example.invalid'),
 ('d3000000-0000-0000-0000-000000000003','rules-operator@example.invalid'),
 ('d3000000-0000-0000-0000-000000000004','rules-admin-b@example.invalid');
update profiles set must_change_password=false,home_agency_id='a3000000-0000-0000-0000-000000000001'
 where id in ('d3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000003');
update profiles set must_change_password=false,home_agency_id='a3000000-0000-0000-0000-000000000002'
 where id='d3000000-0000-0000-0000-000000000004';
update profiles set platform_admin=true where id='d3000000-0000-0000-0000-000000000003';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000002','dsp','dsp','c3000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000004','administrator','administrator',null);

select is(private.rule_number('a3000000-0000-0000-0000-000000000001', null, 'overtime.weekly_limit_hours'), 40::numeric,
  'Platform default applies until an agency changes it');

set local role authenticated;

-- ---------------- Agency administrator ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000001"}',true);
select is((select count(*)::int from effective_rules('a3000000-0000-0000-0000-000000000001')),
  (select count(*)::int from rule_definitions), 'Admin reads every setting for their agency');
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.weekly_limit_hours','45','Policy change')$$,
  '42501','This setting is locked by Complyrer.','Admin cannot change an operator-locked setting');
select lives_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','35','Earlier heads-up')$$,
  'Admin changes an unlocked setting');
select is((select value from effective_rules('a3000000-0000-0000-0000-000000000001') where key='overtime.approaching_hours'),'35'::jsonb,
  'The new value is in force');
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','200','Too high')$$,
  'P0001',null,'Values outside the allowed range are rejected');
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','34',' ')$$,
  'P0001','Add a reason for the change.','A reason is required');
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours',null,'Lock it','00000000-0000-0000-0000-000000000000'::uuid,now(),'operator')$$,
  null,null,'Admin cannot lock settings or target a site on an agency-wide setting');
select throws_ok($$insert into rule_values(agency_id,key,value,reason) values ('a3000000-0000-0000-0000-000000000001','overtime.weekly_limit_hours','60','sneaky')$$,
  '42501',null,'Settings cannot be written directly');

-- ---------------- DSP and another agency ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000002"}',true);
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','30','Mine')$$,
  '42501',null,'Staff cannot change settings');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000004"}',true);
select throws_ok($$select * from effective_rules('a3000000-0000-0000-0000-000000000001')$$,
  '42501',null,'Another agency cannot read these settings');

-- ---------------- Operator ----------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3000000-0000-0000-0000-000000000003"}',true);
select lives_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.weekly_limit_hours','45','Agency contract allows 45')$$,
  'Operator changes a locked setting');
select is((select (value #>> '{}')::numeric from effective_rules('a3000000-0000-0000-0000-000000000001') where key='overtime.weekly_limit_hours'), 45::numeric,
  'The agency now resolves to 45');
select is((select (value #>> '{}')::numeric from effective_rules('a3000000-0000-0000-0000-000000000002') where key='overtime.weekly_limit_hours'), 40::numeric,
  'Other agencies keep the default');
select lives_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','30','Starts next week',null,now() + interval '7 days')$$,
  'Operator schedules a future change');
select is((select (value #>> '{}')::numeric from effective_rules('a3000000-0000-0000-0000-000000000001') where key='overtime.approaching_hours'), 35::numeric,
  'A future change is not in force yet (never retroactive)');
select throws_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.approaching_hours','30','Backdated',null,now() - interval '1 day')$$,
  'P0001',null,'Changes cannot be backdated');
select lives_ok($$select set_rule_value('a3000000-0000-0000-0000-000000000001','overtime.weekly_limit_hours',null,'Let the agency decide',null,now(),'agency')$$,
  'Operator unlocks a setting for the agency');

select * from finish();
rollback;
