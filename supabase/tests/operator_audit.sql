begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(8);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into agencies(id,name,agency_code,state_code,status) values('a3100000-0000-0000-0000-000000000001','Operator test','OPTEST-MO','MO','pending');
insert into auth.users(id,email) values('d3100000-0000-0000-0000-000000000001','optest-admin@example.invalid'),('d3100000-0000-0000-0000-000000000002','optest-operator@example.invalid');
update profiles set must_change_password=false,active=true where id in ('d3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000002');
update profiles set platform_admin=true where id='d3100000-0000-0000-0000-000000000002';
insert into memberships(agency_id,user_id,role,role_key) values('a3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000001','administrator','administrator');
insert into operator_agency_lifecycle(agency_id,actor_id,from_status,to_status,reason,created_at)
values('a3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000002','pending','active','LIFECYCLE_SENSITIVE_7f1b_patient_diagnosis_DO_NOT_EXPORT','2026-09-15T00:00:00Z');
insert into rule_values(agency_id,key,value,reason,set_by,set_by_name,set_as_operator,created_at)
values('a3100000-0000-0000-0000-000000000001','overtime.weekly_limit_hours','40','LIFECYCLE_SENSITIVE_7f1b_patient_diagnosis_DO_NOT_EXPORT','d3100000-0000-0000-0000-000000000002','Operator',true,'2026-09-15T00:00:00Z');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3100000-0000-0000-0000-000000000001"}',true);
select throws_ok($$select operator_audit('2026-09-01','2026-09-30')$$,'42501','Operator access required.','agency admin denied operator evidence');
select throws_ok($$select operator_record_ai_verification('a3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000001','project')$$,'42501',null,'authenticated callers cannot forge verification');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3100000-0000-0000-0000-000000000002"}',true);
select lives_ok($$select operator_audit('2026-09-01','2026-09-30')$$,'operator queries evidence');
select throws_ok($$select operator_audit('2026-09-01','2026-09-30','all',null,null,'','all',-1)$$,'P0001',null,'negative pages rejected');
select is((select e->>'summary' from jsonb_array_elements(operator_audit('2026-09-01','2026-09-30')->'rows') e where e->>'source'='lifecycle'),'pending → active','lifecycle summary contains the transition only');
select ok(position('LIFECYCLE_SENSITIVE_7f1b_patient_diagnosis_DO_NOT_EXPORT' in operator_audit('2026-09-01','2026-09-30')::text)=0,'sensitive lifecycle and rule reasons appear nowhere in RPC output');
select is((select e->>'summary' from jsonb_array_elements(operator_audit('2026-09-01','2026-09-30')->'rows') e where e->>'source'='rules'),'overtime.weekly_limit_hours','rule summary contains the key only');
select is((select reason from operator_agency_lifecycle where agency_id='a3100000-0000-0000-0000-000000000001'),'LIFECYCLE_SENSITIVE_7f1b_patient_diagnosis_DO_NOT_EXPORT','redaction preserves stored lifecycle evidence');
select * from finish(); rollback;
