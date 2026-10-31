-- QA Review creation gate (migration 20261031230000): starting a review
-- keys on qa.schedule (Program Manager / administrator — the roles that
-- run the QA program), NOT qa.audit (the scoring permission held by the
-- read-only auditor). Scoring writes are unchanged: the auditor can
-- still update item results on a review management started.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a9200000-0000-0000-0000-000000000001','QA gate agency','QAGATE-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b9200000-0000-0000-0000-000000000001','a9200000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c9200000-0000-0000-0000-000000000001','a9200000-0000-0000-0000-000000000001','b9200000-0000-0000-0000-000000000001','Home A'),
 ('c9200000-0000-0000-0000-000000000002','a9200000-0000-0000-0000-000000000001','b9200000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d9200000-0000-0000-0000-000000000001','qa-admin@example.invalid'),
 ('d9200000-0000-0000-0000-000000000002','qa-pm@example.invalid'),
 ('d9200000-0000-0000-0000-000000000003','qa-hm@example.invalid'),
 ('d9200000-0000-0000-0000-000000000004','qa-auditor@example.invalid'),
 ('d9200000-0000-0000-0000-000000000005','qa-compliance@example.invalid');
update profiles set must_change_password = false
 where id::text like 'd9200000-%';
update profiles set home_agency_id = 'a9200000-0000-0000-0000-000000000001'
 where id::text like 'd9200000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a9200000-0000-0000-0000-000000000001','d9200000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a9200000-0000-0000-0000-000000000001','d9200000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a9200000-0000-0000-0000-000000000001','d9200000-0000-0000-0000-000000000003','manager','house_manager','c9200000-0000-0000-0000-000000000001'),
 ('a9200000-0000-0000-0000-000000000001','d9200000-0000-0000-0000-000000000004','auditor','auditor',null),
 ('a9200000-0000-0000-0000-000000000001','d9200000-0000-0000-0000-000000000005','compliance_admin','compliance_admin',null);
-- Agency roles are provisioned from the seeded templates: administrator
-- and program_manager hold qa.schedule; the auditor holds qa.audit but
-- NOT qa.schedule; house_manager holds qa.dispute only; compliance_admin
-- holds no qa.* permission.
select public.provision_agency_roles('a9200000-0000-0000-0000-000000000001');

set local role authenticated;

-- 1–2: the Program Manager starts a review: the audit row and its item
-- rows (the creation expansion) both insert.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000002"}',true);
select lives_ok($$insert into qa_audits(id, agency_id, site_id, year, quarter, status, auditor_id, auditor_name)
  values ('e9200000-0000-0000-0000-000000000001','a9200000-0000-0000-0000-000000000001','c9200000-0000-0000-0000-000000000001',2026,3,'in_progress','d9200000-0000-0000-0000-000000000002','Pat PM')$$,
  'Program Manager (qa.schedule) can insert a QA audit');
select lives_ok($$insert into qa_audit_items(id, agency_id, audit_id, item_key, item_id, source)
  values ('f9200000-0000-0000-0000-000000000001','a9200000-0000-0000-0000-000000000001','e9200000-0000-0000-0000-000000000001','item-1','item-1','auditor')$$,
  'Program Manager can insert the new audit''s item rows');

-- 3: the administrator can also start a review (holds qa.schedule).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into qa_audits(id, agency_id, site_id, year, quarter, status, auditor_id, auditor_name)
  values ('e9200000-0000-0000-0000-000000000002','a9200000-0000-0000-0000-000000000001','c9200000-0000-0000-0000-000000000002',2026,3,'in_progress','d9200000-0000-0000-0000-000000000001','Ann Admin')$$,
  'Administrator can insert a QA audit');

-- 4: the read-only auditor (qa.audit, no qa.schedule) can NOT start one.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000004"}',true);
select throws_ok($$insert into qa_audits(id, agency_id, site_id, year, quarter, status, auditor_id, auditor_name)
  values ('e9200000-0000-0000-0000-000000000003','a9200000-0000-0000-0000-000000000001','c9200000-0000-0000-0000-000000000001',2026,4,'in_progress','d9200000-0000-0000-0000-000000000004','Andy Auditor')$$,
  '42501', null, 'Auditor cannot insert a QA audit (no qa.schedule)');

-- 5: the house manager (qa.dispute only) can NOT start one.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000003"}',true);
select throws_ok($$insert into qa_audits(id, agency_id, site_id, year, quarter, status, auditor_id, auditor_name)
  values ('e9200000-0000-0000-0000-000000000004','a9200000-0000-0000-0000-000000000001','c9200000-0000-0000-0000-000000000001',2026,4,'in_progress','d9200000-0000-0000-0000-000000000003','Harper HM')$$,
  '42501', null, 'House manager cannot insert a QA audit (no qa.schedule)');

-- 6: compliance_admin (no qa.* permissions) can NOT start one.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000005"}',true);
select throws_ok($$insert into qa_audits(id, agency_id, site_id, year, quarter, status, auditor_id, auditor_name)
  values ('e9200000-0000-0000-0000-000000000005','a9200000-0000-0000-0000-000000000001','c9200000-0000-0000-0000-000000000002',2026,4,'in_progress','d9200000-0000-0000-0000-000000000005','Casey Compliance')$$,
  '42501', null, 'Compliance admin cannot insert a QA audit (no qa.schedule)');

-- 7: scoring is unchanged — the auditor can still score an item on a
-- review management started.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000004"}',true);
select lives_ok($$update qa_audit_items set result = 'yes', status = 'scored'
  where id = 'f9200000-0000-0000-0000-000000000001'$$,
  'Auditor can still score items (qa.audit update path unchanged)');

-- 8: the Program Manager still cannot rewrite the audit row itself —
-- finalizing stays on qa.audit, so the PM's update matches no row.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d9200000-0000-0000-0000-000000000002"}',true);
update qa_audits set status = 'finalized' where id = 'e9200000-0000-0000-0000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select status from qa_audits where id = 'e9200000-0000-0000-0000-000000000001'),
  'in_progress', 'Program Manager update of the audit row was refused (still in progress)');

-- 9: exactly the two permitted audits exist.
select is((select count(*)::int from qa_audits where agency_id = 'a9200000-0000-0000-0000-000000000001'),
  2, 'Only the PM and administrator audits were created');

select * from finish();
rollback;
