-- HR-ROLES (2026-09-13): HR can add staff members and assign roles.
--
-- 1. Existing agencies: grant members.assign_roles to the HR role template
--    (previously HR could only invite, not reassign roles).
-- 2. New roles.manage permission (editing the role templates themselves on the
--    Roles & access page): grant to administrator and compliance_admin so the
--    page keeps working for them, while HR stays out of it. HR assigning roles
--    to people can therefore never escalate into redefining the roles.
--
-- Idempotent: jsonb || merge, safe to re-run.

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{"members.assign_roles": true}'::jsonb
where template_key = 'hr';

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{"roles.manage": true}'::jsonb
where template_key in ('administrator', 'compliance_admin');
