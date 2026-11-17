begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(12);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into agencies(id,name,agency_code,state_code,status) values
 ('a6000000-0000-0000-0000-000000000001','Score A','SCOREA-MO','MO','active'),
 ('a6000000-0000-0000-0000-000000000002','Score B','SCOREB-MO','MO','active');
insert into programs(id,agency_id,name) values ('b6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','Home A'),
 ('c6000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d6000000-0000-0000-0000-000000000001','score-hm@example.invalid'),
 ('d6000000-0000-0000-0000-000000000002','score-hr@example.invalid'),
 ('d6000000-0000-0000-0000-000000000003','score-auditor@example.invalid');
update profiles set must_change_password=false,home_agency_id='a6000000-0000-0000-0000-000000000001' where id::text like 'd6000000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000001','manager','house_manager','c6000000-0000-0000-0000-000000000001'),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000002','hr','hr',null),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000003','auditor','auditor',null);
select provision_agency_roles('a6000000-0000-0000-0000-000000000001');
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','Person A','1980-01-01');
insert into requirement_definitions(id,agency_id,site_id,individual_id,title,category,due_on,status) values
 ('f6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','e6000000-0000-0000-0000-000000000001','Overdue source','Emergency drills',current_date-20,'upcoming'),
 ('f6000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002',null,'Other home','Emergency drills',current_date,'compliant');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d6000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((agency_scorecard('a6000000-0000-0000-0000-000000000001')->>'total')::int,1,'HM excludes other home');
select is((agency_scorecard('a6000000-0000-0000-0000-000000000001')->>'overdue')::int,1,'due date rederived rather than stale stored upcoming');
select is((agency_scorecard('a6000000-0000-0000-0000-000000000001')->>'score')::int,0,'overdue home cannot inherit other home pass');
select throws_ok($$select agency_scorecard('a6000000-0000-0000-0000-000000000002')$$,'42501','Agency outside your access','another agency aggregate rejected');
select set_config('request.jwt.claims','{"sub":"d6000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((agency_scorecard('a6000000-0000-0000-0000-000000000001')->>'total')::int,2,'HR keeps agency aggregate');
select is((select count(*)::int from individuals),0,'HR still has no Individual records');
select set_config('request.jwt.claims','{"sub":"d6000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is((agency_scorecard('a6000000-0000-0000-0000-000000000001')->>'total')::int,2,'auditor reads agency aggregate');
with changed as (update requirement_definitions set title='Forbidden' where id='f6000000-0000-0000-0000-000000000001' returning id)
select is(count(*)::int,0,'auditor cannot mutate source') from changed;
-- Reproduce the fixture mechanics against PostgreSQL: RESET ROLE alone does
-- not reset the auditor JWT, so the identity guard preserves the active flag.
reset role;
update profiles set active=false where id='d6000000-0000-0000-0000-000000000001';
select is((select active from profiles where id='d6000000-0000-0000-0000-000000000001'),true,'auditor JWT cannot deactivate fixture profile');
-- Perform the intended setup with the service-role JWT and prove it persisted.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update profiles set active=false where id='d6000000-0000-0000-0000-000000000001';
select is((select active from profiles where id='d6000000-0000-0000-0000-000000000001'),false,'fixture profile is inactive before the scorecard call');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d6000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select agency_scorecard('a6000000-0000-0000-0000-000000000001')$$,'42501','Agency outside your access','inactive profile rejected');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select agency_scorecard('a6000000-0000-0000-0000-000000000001')$$,'42501','Agency outside your access','missing actor rejected');
select * from finish();
rollback;
