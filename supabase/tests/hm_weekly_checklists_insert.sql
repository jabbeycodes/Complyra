begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Checklist insert scope (20261031200000, simulation batch 19):
--  * management roles (administrator, compliance_admin, program_manager)
--    create a weekly checklist row for any home in their agency — the
--    assign flow and the oversight rollover;
--  * a house manager creates ONLY the row assigned to themselves at a
--    home they can read — the self-open path the checklist page's
--    rollover needs (batch 19: Juniper HM got a raw RLS error);
--  * a house manager cannot create another home's row, nor a row for
--    someone else at their own home;
--  * a DSP cannot create a row at all, even at their own home.

insert into agencies (id, name, agency_code, state_code, status) values
 ('a6000000-0000-0000-0000-000000000001','Checklist agency','CHKLIST-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c6000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','Home A'),
 ('c6000000-0000-0000-0000-000000000002','a6000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d6000000-0000-0000-0000-000000000001','chk-admin@example.invalid'),
 ('d6000000-0000-0000-0000-000000000002','chk-pm@example.invalid'),
 ('d6000000-0000-0000-0000-000000000003','chk-hm-a@example.invalid'),
 ('d6000000-0000-0000-0000-000000000004','chk-hm-b@example.invalid'),
 ('d6000000-0000-0000-0000-000000000005','chk-dsp-a@example.invalid'),
 ('d6000000-0000-0000-0000-000000000006','chk-compliance@example.invalid');
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000001','administrator','administrator',null),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000002','manager','program_manager',null),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000003','manager','house_manager','c6000000-0000-0000-0000-000000000001'),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000004','manager','house_manager','c6000000-0000-0000-0000-000000000002'),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000005','dsp','dsp','c6000000-0000-0000-0000-000000000001'),
 ('a6000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000006','compliance','compliance_admin',null);

set local role authenticated;

-- Administrator creates a row for Home A (the assign flow).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','2026-10-04','d6000000-0000-0000-0000-000000000003','d6000000-0000-0000-0000-000000000001')$$,
  'Administrator can create a checklist row for a home');

-- Program manager creates a row for Home B (the app assign flow names PM).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000002"}',true);
select lives_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','2026-10-04','d6000000-0000-0000-0000-000000000004','d6000000-0000-0000-0000-000000000002')$$,
  'Program manager can create a checklist row for a home');

-- Compliance admin creates a row for Home A.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000006"}',true);
select lives_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','2026-10-11','d6000000-0000-0000-0000-000000000003','d6000000-0000-0000-0000-000000000006')$$,
  'Compliance admin can create a checklist row for a home');

-- House manager A opens their OWN home's week (the batch-19 rollover path).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000003"}',true);
select lives_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','2026-10-18','d6000000-0000-0000-0000-000000000003',null)$$,
  'House manager can create their own home''s checklist row');

-- House manager A cannot create Home B's row.
select throws_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','2026-10-18','d6000000-0000-0000-0000-000000000004',null)$$,
  '42501',null,'House manager cannot create another home''s checklist row');

-- House manager A cannot create a row at their own home for someone else.
select throws_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','2026-10-25','d6000000-0000-0000-0000-000000000004',null)$$,
  '42501',null,'House manager cannot create a checklist row assigned to someone else');

-- A DSP cannot create a row even at their own home assigned to themselves.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000005"}',true);
select throws_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','2026-10-18','d6000000-0000-0000-0000-000000000005',null)$$,
  '42501',null,'DSP cannot create a checklist row');

-- House manager B opens their own home's week.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6000000-0000-0000-0000-000000000004"}',true);
select lives_ok($$insert into hm_weekly_checklists(agency_id,site_id,week_of,assigned_to_user_id,assigned_by_user_id)
  values ('a6000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002','2026-10-11','d6000000-0000-0000-0000-000000000004',null)$$,
  'Second house manager can create their own home''s checklist row');

-- Exactly the five allowed rows exist.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::int from hm_weekly_checklists),5,
  'Only the five in-scope inserts landed');

select * from finish();
rollback;
