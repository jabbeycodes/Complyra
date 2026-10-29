-- PM PERMISSION BACKFILL — therap-core-gaps-1 keys (PR #117 follow-on).
-- INTENTIONALLY UNAPPLIED (ships with PR #117; production migrations are
-- applied only on the founder's explicit go-ahead).
--
-- THE DEFECT: the six batch-1 permission keys (ger.create, ger.review,
-- ger.resolve, behavior.record, behavior.plan, health.record) enter the
-- database only through the regenerated canonical seed
-- (20260915024000_integrated_permissions.sql). The DPM-merge migration
-- (20260916060000_merge_dpm_program_manager.sql) runs AFTER the seed and
-- wholesale replaces the program_manager rows of role_templates and
-- role_permission_matrix with its frozen 2026-09-16 permission pack — a
-- pack that predates these keys. Agencies provisioned afterwards copy
-- their program_manager agency_roles row from that stripped template, so
-- in hosted mode Program Managers hold NONE of the six keys: they cannot
-- create, review, or resolve event reports, record behavior data, manage
-- behavior plans, or record health entries (private.has_permission gates
-- the RLS policies; there is no UI workaround). Local mode masks the
-- defect because the TypeScript packs in src/data/permissions.ts are
-- correct.
--
-- THE CURE (the PR #131 backfill pattern): following the seed's own rule
-- ("missing new capabilities inherit their canonical defaults; existing
-- choices win"), merge each key into role_permission_matrix,
-- role_templates, and live agency_roles ONLY where the key is absent
-- (`and not (permissions ? '<key>')`), so an agency's explicit choice for
-- a key is never overwritten. Values mirror src/data/permissions.ts and
-- the regenerated seed exactly, false values written explicitly.
begin;

-- ── ger.create ───────────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('ger.create', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'ger.create');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('ger.create', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'ger.create');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('ger.create', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'ger.create');

-- ── ger.review ───────────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('ger.review', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'ger.review');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('ger.review', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'ger.review');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('ger.review', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'ger.review');

-- ── ger.resolve ──────────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('ger.resolve', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'ger.resolve');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('ger.resolve', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'ger.resolve');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('ger.resolve', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'ger.resolve');

-- ── behavior.record ──────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('behavior.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'behavior.record');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('behavior.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'behavior.record');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('behavior.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'behavior.record');

-- ── behavior.plan ────────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('behavior.plan', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'behavior.plan');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('behavior.plan', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'behavior.plan');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('behavior.plan', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', false), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'behavior.plan');

-- ── health.record ────────────────────────────────────────────────────────
update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('health.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'health.record');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('health.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'health.record');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('health.record', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', false), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'health.record');

commit;
