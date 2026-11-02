-- WAVE 7V — compliance_admin narrowed to READ-AND-AUDIT (founder decision,
-- 2026-11-02; simulation batches 157/158/171/184).
--
-- THE DEFECT: the compliance_admin default template granted nearly every
-- permission key — members.invite / members.assign_roles /
-- members.reset_password (member administration), roles.manage (it could
-- edit the role templates themselves, a privilege-escalation path),
-- certificates.manage, correctiveActions.manage, sites.create, the
-- delegation write family, documents.upload, and the clinical write keys
-- (health.record, behavior.*, ger.create, lifeEvents.record). The
-- oversight role was a second administrator.
--
-- THE DECISION: compliance_admin becomes read-and-audit by default. The
-- canonical keep list (src/data/permissions.ts, ROLE_TEMPLATES) is:
-- audit.read, audit.export, individuals.view, documents.view,
-- documents.review, clinical.view, delegation.templates.view,
-- hub.access, messages.use, mileage.manage, acknowledgments.sign_own,
-- recognition.view_winners, ger.review, ger.resolve,
-- requirements.complete. (The founder list also names isp.view; that key
-- is not part of the canonical 52-key map — no code reads it — and the
-- agency_roles backfill below preserves it wherever an agency stores it.)
--
-- THIS MIGRATION:
--   PART 1 — refreshes public.role_permission_matrix for all eight roles
--     with the canonical maps generated from src/data/permissions.ts
--     (the established seed-refresh pattern; only the compliance_admin
--     map changes substance).
--   PART 2 — sets the platform default template
--     (public.role_templates, key='compliance_admin') to the narrowed
--     map, so agencies provisioned from now on start narrowed.
--   PART 3 — backfills EXISTING agencies: from every agency_roles row
--     with template_key='compliance_admin', deletes ONLY the removed
--     keys listed in PART 3. Every other stored key is preserved
--     byte-for-byte — keys an agency deliberately granted (e.g. qa.audit)
--     and legacy non-canonical keys (isp.*) survive; kept keys an agency
--     deliberately turned OFF stay off. Deleting (rather than setting
--     false) matches the stored-wins merge rule of earlier seed
--     refreshes: if a future canonical refresh re-seeds a removed key,
--     it comes back with the canonical (narrowed, false) value.
--
-- IDEMPOTENT: every statement is a pure overwrite or key deletion;
-- re-running changes nothing. The TS layer carries the matching changes
-- (template pack, canReadAsCompliance read paths for the surfaces the
-- removed keys used to gate, checklist-assigner narrowing, and the
-- clinical write role-lists) — see the wave 7V PR.
begin;

-- PART 1 — canonical matrix refresh (generated from
-- src/data/permissions.ts; only compliance_admin changes substance).
insert into public.role_permission_matrix(role_key,permissions) values
('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":true,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('compliance_admin', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":true,"ger.resolve":true,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb),
('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":true,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":false,"ger.resolve":false,"behavior.record":true,"behavior.plan":false,"health.record":true}'::jsonb),
('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb),
('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":false,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb)
on conflict(role_key) do update set permissions=excluded.permissions,updated_at=now();

-- PART 2 — the platform default template for compliance_admin.
update public.role_templates
set permissions = '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":true,"ger.resolve":true,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb
where key = 'compliance_admin';

-- PART 3 — backfill existing agencies' compliance_admin roles: delete
-- ONLY the removed keys; everything else an agency stores is preserved.
update public.agency_roles
set permissions = permissions - array[
  'acknowledgments.manage',
  'behavior.plan',
  'behavior.record',
  'certificates.manage',
  'correctiveActions.manage',
  'delegation.acknowledge',
  'delegation.activate',
  'delegation.assign',
  'delegation.templates.manage',
  'delegation.training.approve',
  'delegation.training.review',
  'documents.upload',
  'ger.create',
  'health.record',
  'lifeEvents.record',
  'members.assign_roles',
  'members.invite',
  'members.reset_password',
  'recognition.manage',
  'recognition.rate_hm',
  'recognition.review_dsp',
  'requirements.approve',
  'roles.manage',
  'sites.create'
]
where template_key = 'compliance_admin';

commit;
