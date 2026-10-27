-- PM permission backfill for `messages.use` — INTENTIONALLY UNAPPLIED.
--
-- The canonical seed (20260915024000_integrated_permissions.sql, regenerated
-- with the `messages.use` key for PR #121) lands BEFORE the DPM-merge
-- migration (20260916060000_merge_dpm_program_manager.sql), which wholesale
-- replaces the program_manager role_templates + role_permission_matrix rows
-- with its frozen 2026-09-16 pack — a pack that predates this key — and
-- refreshes agency program_manager rows from that pack. The result: after
-- the full chain, program_manager templates/matrix (and every provisioned
-- agency's PM row) lack `messages.use`, so in hosted mode PMs cannot use
-- messaging, and — because the message_participants policy checks the
-- ADDED person's agency_roles row — nobody can add a PM to a thread
-- either. Following the seed's own rule ("missing new capabilities inherit
-- their canonical defaults; existing choices win"), fill the key in
-- wherever it is absent: matrix, templates, and live agency role rows.
-- Values mirror src/data/permissions.ts exactly. The auditor value is an
-- explicit false (as in the seed) so the designed messaging exclusion
-- survives provisioning rather than depending on a missing key.
begin;

update public.role_permission_matrix m
set permissions = m.permissions
  || jsonb_build_object('messages.use', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', true), ('auditor', false)
) as d(role_key, enabled)
where m.role_key = d.role_key
  and not (m.permissions ? 'messages.use');

update public.role_templates t
set permissions = t.permissions
  || jsonb_build_object('messages.use', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', true), ('auditor', false)
) as d(role_key, enabled)
where t.key = d.role_key
  and not (t.permissions ? 'messages.use');

update public.agency_roles a
set permissions = a.permissions
  || jsonb_build_object('messages.use', d.enabled)
from (values
  ('administrator', true), ('compliance_admin', true),
  ('program_manager', true), ('house_manager', true), ('nurse', true),
  ('dsp', true), ('hr', true), ('auditor', false)
) as d(role_key, enabled)
where a.template_key = d.role_key
  and not (a.permissions ? 'messages.use');

commit;
