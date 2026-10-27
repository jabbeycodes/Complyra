-- THERAP-CORE-GAPS-1 RLS: hosted enforcement for the batch-1 tables.
-- The PR-review agent asked for hosted RLS tests proving that direct
-- database writes cannot do what the API forbids: cross-user edits and
-- deletes, mutation of an approved event report, forged authorship, and
-- filing a report under the wrong home.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(66);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into agencies (id, name, agency_code, state_code, status) values
 ('a2700000-0000-0000-0000-000000000001','Gaps agency','GAPS-MO','MO','active');
insert into programs (id,agency_id,name) values
 ('b2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','Program');
insert into sites(id,agency_id,program_id,name) values
 ('c2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','b2700000-0000-0000-0000-000000000001','Home A'),
 ('c2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','b2700000-0000-0000-0000-000000000001','Home B');
insert into auth.users(id,email) values
 ('d2700000-0000-0000-0000-000000000001','gaps-dsp@example.invalid'),
 ('d2700000-0000-0000-0000-000000000002','gaps-dsp2@example.invalid'),
 ('d2700000-0000-0000-0000-000000000003','gaps-hm@example.invalid'),
 ('d2700000-0000-0000-0000-000000000004','gaps-nurse@example.invalid'),
 ('d2700000-0000-0000-0000-000000000005','gaps-auditor@example.invalid');
update profiles set must_change_password=false where id::text like 'd2700000-%';
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000001','dsp','dsp','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000002','dsp','dsp','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000003','manager','house_manager','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000004','nurse','nurse',null),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000005','auditor','auditor',null);
insert into individuals(id,agency_id,site_id,full_name,date_of_birth) values
 ('e2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','Person A','1980-01-01'),
 ('e2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','Person B','1980-01-01');
insert into staff_assignments(agency_id,user_id,individual_id,site_id) values
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001'),
 ('a2700000-0000-0000-0000-000000000001','d2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001');

-- ── GER: the author files a draft at their Individual's home ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$insert into ger_reports(id,agency_id,site_id,individual_id,event_date,event_type,severity,description,reporter_name,reporter_signature,reporter_date,created_by_user_id)
  values ('f2700000-0000-0000-0000-000000000001','a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','High','Slipped in the kitchen.','Dsp One','Dsp One','2026-10-26','d2700000-0000-0000-0000-000000000001')$$,
  'DSP author inserts their own draft GER');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Wrong home.','d2700000-0000-0000-0000-000000000001')$$,
  '23514', null, 'A GER cannot be filed under a home its Individual does not live at');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000002','e2700000-0000-0000-0000-000000000002','2026-10-26','Fall','Low','Other home person.','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A DSP cannot file a GER for an Individual at another home');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Forged author.','d2700000-0000-0000-0000-000000000002')$$,
  '42501', null, 'A GER cannot be authored as someone else');
select throws_ok($$insert into ger_reports(agency_id,site_id,individual_id,event_date,event_type,severity,description,status,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','c2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Fall','Low','Pre-approved.','approved','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A GER cannot be inserted already approved');

-- ── GER: another DSP can neither edit nor delete the draft ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update ger_reports set description='Hacked' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Cross-user update runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001' and description='Hacked'),0,
  'Another DSP cannot edit the author''s draft');
select lives_ok($$delete from ger_reports where id='f2700000-0000-0000-0000-000000000001'$$,
  'Cross-user delete runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001'),1,
  'Another DSP cannot delete the author''s draft');

-- ── GER: lifecycle — submit, review, approve, then the body locks ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$update ger_reports set description='Slipped on a wet kitchen floor.' where id='f2700000-0000-0000-0000-000000000001'$$,
  'The author edits their own draft');
select lives_ok($$update ger_reports set status='submitted' where id='f2700000-0000-0000-0000-000000000001'$$,
  'The author submits their draft');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000003"}',true);
select throws_ok($$update ger_reports set description='Rewritten by a manager' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'A submitted report''s body cannot be edited, even by a manager');
select throws_ok($$update ger_reports set status='approved', reviewed_by_user_id='d2700000-0000-0000-0000-000000000001', reviewed_at=now() where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'A review cannot forge a different reviewer');
select lives_ok($$update ger_reports set status='approved', review_note='Reviewed.', reviewed_by_user_id='d2700000-0000-0000-0000-000000000003', reviewed_at=now() where id='f2700000-0000-0000-0000-000000000001'$$,
  'The house manager approves as themselves');
select throws_ok($$update ger_reports set description='Changed after approval' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'An approved report''s body is immutable at the database layer');
select throws_ok($$update ger_reports set review_note='Changed after approval' where id='f2700000-0000-0000-0000-000000000001'$$,
  '23514', null, 'An approved report''s review record is immutable');
select lives_ok($$update ger_reports set resolution_status='in_progress', assigned_manager_user_id='d2700000-0000-0000-0000-000000000003', resolution_due_on='2026-10-30' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Follow-up on an approved report can still be worked');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select lives_ok($$delete from ger_reports where id='f2700000-0000-0000-0000-000000000001'$$,
  'Author delete of an approved report runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001'),1,
  'An approved report cannot be deleted by its author');

-- ── Behavior entries: author-owned, manager override ──
select lives_ok($$insert into behavior_entries(id,agency_id,individual_id,occurred_on,behavior,intensity,recorded_by_user_id)
  values ('f2700000-0000-0000-0000-000000000002','a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Verbal outbursts','Moderate','d2700000-0000-0000-0000-000000000001')$$,
  'DSP records a behavior entry');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000002"}',true);
select lives_ok($$update behavior_entries set behavior='Hacked' where id='f2700000-0000-0000-0000-000000000002'$$,
  'Cross-user behavior update runs without error but must touch no row');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002' and behavior='Hacked'),0,
  'Another DSP cannot edit a behavior entry');
select lives_ok($$delete from behavior_entries where id='f2700000-0000-0000-0000-000000000002'$$,
  'Cross-user behavior delete runs without error but must touch no row');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002'),1,
  'Another DSP cannot delete a behavior entry');
select throws_ok($$insert into behavior_entries(agency_id,individual_id,occurred_on,behavior,recorded_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','2026-10-26','Forged','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A behavior entry cannot be recorded as someone else');

-- ── Health entries + nurse scope ──
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into health_track_entries(id,agency_id,individual_id,kind,occurred_on,title,recorded_by_user_id)
values ('f2700000-0000-0000-0000-000000000003','a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000002','lab','2026-10-26','A1C','d2700000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000004"}',true);
select is((select count(*)::int from health_track_entries where individual_id='e2700000-0000-0000-0000-000000000002'),1,
  'A nurse reads health entries agency-wide, across homes');
select throws_ok($$insert into health_track_entries(agency_id,individual_id,kind,occurred_on,title,recorded_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000002','lab','2026-10-26','Nurse entry','d2700000-0000-0000-0000-000000000004')$$,
  '42501', null, 'A nurse cannot add health entries at a home they are not assigned to');
select is((select count(*)::int from ger_reports where individual_id='e2700000-0000-0000-0000-000000000001'),1,
  'A nurse reads event reports agency-wide');

-- ── Nurse cross-home scope, behavior + health entries (adjudication of the
--    PR #117 re-review dispute): UPDATE is agency-wide for nurses, while
--    INSERT and DELETE stay limited to Individuals at their own sites ──
select lives_ok($$update behavior_entries set outcome='De-escalated after nurse review' where id='f2700000-0000-0000-0000-000000000002'$$,
  'A nurse update of a behavior entry at another home runs');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002' and outcome='De-escalated after nurse review'),1,
  'A nurse can update a behavior entry at a home they are not assigned to');
select lives_ok($$update health_track_entries set note='Reviewed by nurse' where id='f2700000-0000-0000-0000-000000000003'$$,
  'A nurse update of a health entry at another home runs');
select is((select count(*)::int from health_track_entries where id='f2700000-0000-0000-0000-000000000003' and note='Reviewed by nurse'),1,
  'A nurse can update a health entry at a home they are not assigned to');
select throws_ok($$insert into behavior_entries(agency_id,individual_id,occurred_on,behavior,recorded_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000002','2026-10-26','Nurse entry','d2700000-0000-0000-0000-000000000004')$$,
  '42501', null, 'A nurse cannot add behavior entries at a home they are not assigned to');
select lives_ok($$delete from behavior_entries where id='f2700000-0000-0000-0000-000000000002'$$,
  'A nurse delete of a behavior entry at another home runs but must touch no row');
select is((select count(*)::int from behavior_entries where id='f2700000-0000-0000-0000-000000000002'),1,
  'A nurse cannot delete a behavior entry at a home they are not assigned to');
select lives_ok($$delete from health_track_entries where id='f2700000-0000-0000-0000-000000000003'$$,
  'A nurse delete of a health entry at another home runs but must touch no row');
select is((select count(*)::int from health_track_entries where id='f2700000-0000-0000-0000-000000000003'),1,
  'A nurse cannot delete a health entry at a home they are not assigned to');

-- ── Behavior plans are manager-owned; auditors are read-only ──
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000001"}',true);
select throws_ok($$insert into behavior_plans(agency_id,individual_id,target_behaviors,created_by_user_id)
  values ('a2700000-0000-0000-0000-000000000001','e2700000-0000-0000-0000-000000000001','Outbursts','d2700000-0000-0000-0000-000000000001')$$,
  '42501', null, 'A DSP cannot create a behavior plan');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d2700000-0000-0000-0000-000000000005"}',true);
select is((select count(*)::int from ger_reports),1,
  'An auditor reads event reports (see everything, read-only)');
select lives_ok($$update ger_reports set description='Auditor edit' where id='f2700000-0000-0000-0000-000000000001'$$,
  'Auditor update runs without error but must touch no row');
select is((select count(*)::int from ger_reports where id='f2700000-0000-0000-0000-000000000001' and description='Auditor edit'),0,
  'An auditor cannot change an event report');

-- ── PM permission backfill: the DPM merge must not strip the batch-1 keys ──
-- The DPM-merge migration (20260916060000) runs after the permission seed
-- and replaces the program_manager template/matrix rows with its frozen
-- 2026-09-16 pack, which predates the six batch-1 keys. The follow-on
-- backfill migration (20261027201000) must restore them at the template
-- level so every agency provisioned from the templates carries them.
reset role;

select is((select permissions->'ger.create' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries ger.create after the full chain');
select is((select permissions->'ger.review' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries ger.review after the full chain');
select is((select permissions->'ger.resolve' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries ger.resolve after the full chain');
select is((select permissions->'behavior.record' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries behavior.record after the full chain');
select is((select permissions->'behavior.plan' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries behavior.plan after the full chain');
select is((select permissions->'health.record' from public.role_templates where key='program_manager'),'true'::jsonb,
  'Program Manager template carries health.record after the full chain');

select is((select permissions->'ger.create' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries ger.create after the full chain');
select is((select permissions->'ger.review' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries ger.review after the full chain');
select is((select permissions->'ger.resolve' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries ger.resolve after the full chain');
select is((select permissions->'behavior.record' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries behavior.record after the full chain');
select is((select permissions->'behavior.plan' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries behavior.plan after the full chain');
select is((select permissions->'health.record' from public.role_permission_matrix where role_key='program_manager'),'true'::jsonb,
  'Program Manager permission matrix carries health.record after the full chain');

select is((select (permissions->>'ger.create')::boolean and (permissions->>'ger.review')::boolean
    and (permissions->>'ger.resolve')::boolean and (permissions->>'behavior.record')::boolean
    and (permissions->>'behavior.plan')::boolean and (permissions->>'health.record')::boolean
    from public.role_templates where key='house_manager'), true,
  'House Manager template keeps all six batch-1 keys enabled');

-- Provisioning: a fresh agency copies the cured templates.
insert into agencies (id, name, agency_code, state_code, status) values
 ('a2700000-0000-0000-0000-000000000099','Backfill agency','PMBK-MO','MO','active');
select public.provision_agency_roles('a2700000-0000-0000-0000-000000000099');

select is((select permissions->'ger.create' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries ger.create');
select is((select permissions->'ger.review' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries ger.review');
select is((select permissions->'ger.resolve' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries ger.resolve');
select is((select permissions->'behavior.record' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries behavior.record');
select is((select permissions->'behavior.plan' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries behavior.plan');
select is((select permissions->'health.record' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'),'true'::jsonb,
  'A newly provisioned agency''s Program Manager role carries health.record');

select is((select (permissions->>'ger.create')::boolean and (permissions->>'ger.review')::boolean
    and (permissions->>'ger.resolve')::boolean and (permissions->>'behavior.record')::boolean
    and (permissions->>'behavior.plan')::boolean and (permissions->>'health.record')::boolean
    from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='house_manager'), true,
  'A newly provisioned agency''s House Manager role keeps all six keys enabled');
select is((select (permissions->>'ger.create')::boolean and not (permissions->>'ger.review')::boolean
    and not (permissions->>'ger.resolve')::boolean and (permissions->>'behavior.record')::boolean
    and not (permissions->>'behavior.plan')::boolean and (permissions->>'health.record')::boolean
    from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='dsp'), true,
  'A newly provisioned agency''s DSP role carries the designed batch-1 values');
select is((select count(*)::int from public.agency_roles
    where agency_id='a2700000-0000-0000-0000-000000000099' and template_key in ('auditor','hr')
      and ((permissions->>'ger.create')::boolean or (permissions->>'ger.review')::boolean
        or (permissions->>'ger.resolve')::boolean or (permissions->>'behavior.record')::boolean
        or (permissions->>'behavior.plan')::boolean or (permissions->>'health.record')::boolean)), 0,
  'Auditor and HR roles hold none of the six batch-1 keys');

-- Guard: recreate the pre-fix state on this agency's rows, with one
-- explicit agency choice that must win, then re-apply the backfill's
-- agency_roles updates verbatim — absent keys are filled with the
-- canonical values, the explicit choice is left untouched.
update public.agency_roles
set permissions = permissions - 'ger.create' - 'ger.review' - 'ger.resolve'
  - 'behavior.record' - 'behavior.plan' - 'health.record'
where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager';
update public.agency_roles
set permissions = (permissions - 'ger.resolve') || '{"ger.review": true}'::jsonb
where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='dsp';

update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('ger.create', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'ger.create');
update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('ger.review', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'ger.review');
update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('ger.resolve', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'ger.resolve');
update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('behavior.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'behavior.record');
update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('behavior.plan', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'behavior.plan');
update public.agency_roles a
set permissions = a.permissions || jsonb_build_object('health.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key and not (a.permissions ? 'health.record');

select is((select (permissions->>'ger.create')::boolean and (permissions->>'ger.review')::boolean
    and (permissions->>'ger.resolve')::boolean and (permissions->>'behavior.record')::boolean
    and (permissions->>'behavior.plan')::boolean and (permissions->>'health.record')::boolean
    from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='program_manager'), true,
  'Re-applying the backfill restores all six keys on a stripped Program Manager role row');
select is((select permissions->'ger.review' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='dsp'),'true'::jsonb,
  'An explicit agency choice (DSP ger.review enabled) survives the backfill');
select is((select permissions->'ger.resolve' from public.agency_roles where agency_id='a2700000-0000-0000-0000-000000000099' and template_key='dsp'),'false'::jsonb,
  'An absent key (DSP ger.resolve) is filled with its canonical value');

select * from finish();
rollback;
