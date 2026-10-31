-- Every tenant role must remain outside every operator read/action boundary.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan((select count(*)::int*11 from role_templates));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values('a3200000-0000-0000-0000-000000000001','Operator role boundary','OPBOUND-MO','MO','active');
create temp table op_role_users as select gen_random_uuid() as id,key,capability from role_templates;
insert into auth.users(id,email) select id,key||'@operator-boundary.invalid' from op_role_users;
update profiles set active=true,must_change_password=false where id in(select id from op_role_users);
insert into memberships(agency_id,user_id,role,role_key) select 'a3200000-0000-0000-0000-000000000001',id,capability,key from op_role_users;
grant select on op_role_users to authenticated;
create function pg_temp.check_operator_boundaries() returns setof text language plpgsql as $$
declare u record; q text;
begin
 for u in select * from op_role_users loop
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',u.id)::text,true);
  foreach q in array array[
   'select operator_directory()',
   'select operator_transition_agency(''a3200000-0000-0000-0000-000000000001'',''suspended'',''Test'')',
   'select operator_overview(''2026-09-01'',''2026-09-30'')',
   'select operator_ai_settings(''a3200000-0000-0000-0000-000000000001'')',
   'select operator_save_ai(''a3200000-0000-0000-0000-000000000001'',''model'',true,true)',
   'select operator_audit(''2026-09-01'',''2026-09-30'')',
   'select operator_people()',
   'select operator_health()',
   'select operator_communications(''2026-09-01'',''2026-09-30'')',
   'select operator_save_notice_template(''med.unrecorded'',''{{title}}'',''{{body}}'',''Test'',1)',
   'select operator_job_start(''sweep-operating-reminders'')'
  ] loop
   return next throws_ok(q,'42501',null,u.key||' denied: '||q);
  end loop;
 end loop;
end $$;
set local role authenticated;
select * from pg_temp.check_operator_boundaries();
select * from finish();
rollback;
