-- REMOVE COMPLIANCE ROLE (migration 20261031310000, founder decision
-- 2026-11-02): the compliance_admin role is retired; its members become
-- administrators. Proves:
--   * post-chain state: no compliance_admin row in role_templates or
--     role_permission_matrix; the seven surviving templates are present
--     and the canonical administrator / program_manager packs are intact;
--   * the migration's conversion semantics, replayed verbatim against
--     retired-state fixtures (the harness builds the DB from the full
--     migration chain, so the fixtures are inserted in the retired state
--     and the migration's own statements are re-applied to them):
--     memberships convert (role_key AND the legacy role enum), agency
--     compliance rows merge true-wins into an existing administrator row
--     or rename into it, other roles are untouched;
--   * the compatibility normalization: historical key lists naming
--     compliance_admin keep evaluating (as administrator) through
--     private.role_key_in / private.can_grant_role_key.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(19);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ── Post-chain state ──
select is((select count(*)::int from public.role_templates where key = 'compliance_admin'), 0,
  'No compliance_admin row remains in role_templates');
select is((select count(*)::int from public.role_permission_matrix where role_key = 'compliance_admin'), 0,
  'No compliance_admin row remains in role_permission_matrix');
select is((select count(*)::int from public.role_templates
           where key in ('administrator','house_manager','program_manager','dsp','nurse','hr','auditor')), 7,
  'All seven surviving role templates are present');
select is((select permissions -> 'roles.manage' from public.role_templates where key = 'administrator'), 'true'::jsonb,
  'Administrator template still carries roles.manage after the chain');
select is((select permissions -> 'qa.schedule' from public.role_templates where key = 'program_manager'), 'true'::jsonb,
  'Program Manager template is untouched (qa.schedule still granted)');

-- ── Retired-state fixtures ──
insert into agencies (id, name, agency_code, state_code, status) values
 ('a3100000-0000-0000-0000-000000000001','Merge agency','MERGEA-MO','MO','active'),
 ('a3100000-0000-0000-0000-000000000002','Rename agency','RENAMEB-MO','MO','active');
insert into auth.users(id,email) values
 ('d3100000-0000-0000-0000-000000000001','former-compliance-a@example.invalid'),
 ('d3100000-0000-0000-0000-000000000002','former-compliance-b@example.invalid'),
 ('d3100000-0000-0000-0000-000000000003','plain-dsp@example.invalid');
update profiles set must_change_password=false where id::text like 'd3100000-%';
-- The retired template row, as it existed before the migration.
insert into public.role_templates (key, name, short_code, description, default_scope, capability, permissions) values
 ('compliance_admin','Compliance administrator','CA','Retired fixture template.','agency','compliance_admin','{"ger.create":true}'::jsonb);
-- Agency A: a customized administrator row PLUS a compliance row (merge path).
update public.agency_roles set permissions = '{"members.invite":true,"qa.audit":true}'::jsonb
 where agency_id = 'a3100000-0000-0000-0000-000000000001' and template_key = 'administrator';
insert into public.agency_roles (agency_id, template_key, name, short_code, scope, permissions) values
 ('a3100000-0000-0000-0000-000000000001','compliance_admin','Compliance administrator','CA','agency','{"ger.create":true,"members.invite":false}'::jsonb);
-- Agency B: compliance row only (rename path) — drop the provisioned admin row.
delete from public.agency_roles
 where agency_id = 'a3100000-0000-0000-0000-000000000002' and template_key = 'administrator';
insert into public.agency_roles (agency_id, template_key, name, short_code, scope, permissions) values
 ('a3100000-0000-0000-0000-000000000002','compliance_admin','Compliance administrator','CA','agency','{"ger.create":true}'::jsonb);
insert into memberships(agency_id,user_id,role,role_key,site_id) values
 ('a3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000001','compliance_admin','compliance_admin',null),
 ('a3100000-0000-0000-0000-000000000002','d3100000-0000-0000-0000-000000000002','compliance_admin','compliance_admin',null),
 ('a3100000-0000-0000-0000-000000000001','d3100000-0000-0000-0000-000000000003','dsp','dsp',null);

-- ── Replay the migration's conversion statements verbatim ──
update public.agency_roles adm
set permissions = (
      select jsonb_object_agg(
        key,
        (adm.permissions -> key) is not distinct from to_jsonb(true)
        or (ca.permissions -> key) is not distinct from to_jsonb(true)
      )
      from (
        select distinct key
        from jsonb_each(coalesce(adm.permissions, '{}'::jsonb))
        union
        select distinct key
        from jsonb_each(coalesce(ca.permissions, '{}'::jsonb))
      ) keys
    )
from public.agency_roles ca
where ca.agency_id = adm.agency_id
  and ca.template_key = 'compliance_admin'
  and adm.template_key = 'administrator';

delete from public.agency_roles
where template_key = 'compliance_admin'
  and exists (
    select 1 from public.agency_roles adm2
    where adm2.agency_id = agency_roles.agency_id
      and adm2.template_key = 'administrator'
  );

update public.agency_roles
set template_key = 'administrator',
    name = 'Agency administrator',
    short_code = 'ADMIN'
where template_key = 'compliance_admin';

update public.memberships
set role_key = 'administrator'
where role_key = 'compliance_admin';

update public.memberships
set role = 'administrator'
where role = 'compliance_admin';

delete from public.role_permission_matrix where role_key = 'compliance_admin';
delete from public.role_templates where key = 'compliance_admin';

-- ── Conversion outcomes ──
select is((select role_key from memberships where user_id = 'd3100000-0000-0000-0000-000000000001'), 'administrator',
  'Agency A compliance member becomes administrator (role_key)');
select is((select role::text from memberships where user_id = 'd3100000-0000-0000-0000-000000000001'), 'administrator',
  'Agency A compliance member becomes administrator (legacy role enum)');
select is((select role_key from memberships where user_id = 'd3100000-0000-0000-0000-000000000002'), 'administrator',
  'Agency B compliance member becomes administrator');
select is((select role_key from memberships where user_id = 'd3100000-0000-0000-0000-000000000003'), 'dsp',
  'A DSP membership is untouched by the conversion');
select is((select count(*)::int from public.agency_roles
           where agency_id = 'a3100000-0000-0000-0000-000000000001' and template_key = 'compliance_admin'), 0,
  'Agency A compliance agency_roles row is gone after the merge');
select is((select permissions -> 'ger.create' from public.agency_roles
           where agency_id = 'a3100000-0000-0000-0000-000000000001' and template_key = 'administrator'), 'true'::jsonb,
  'Agency A administrator row inherits the compliance row grant (true-wins merge)');
select is((select permissions -> 'qa.audit' from public.agency_roles
           where agency_id = 'a3100000-0000-0000-0000-000000000001' and template_key = 'administrator'), 'true'::jsonb,
  'Agency A administrator row keeps its own customized grants through the merge');
select is((select count(*)::int from public.agency_roles
           where agency_id = 'a3100000-0000-0000-0000-000000000002' and template_key = 'compliance_admin'), 0,
  'Agency B compliance agency_roles row is gone after the rename');
select is((select name from public.agency_roles
           where agency_id = 'a3100000-0000-0000-0000-000000000002' and template_key = 'administrator'), 'Agency administrator',
  'Agency B compliance-only row renames into the administrator row');
select is((select count(*)::int from public.role_templates where key = 'compliance_admin'), 0,
  'The retired template row is deleted by the conversion');

-- ── Compatibility normalization for historical key lists ──
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3100000-0000-0000-0000-000000000001"}',true);
select ok(private.role_key_in('a3100000-0000-0000-0000-000000000001', array['compliance_admin']),
  'A historical policy list naming compliance_admin still matches the migrated administrator');
select ok(private.can_grant_role_key('a3100000-0000-0000-0000-000000000001', 'compliance_admin'),
  'Granting the retired key evaluates as granting administrator — allowed for an administrator');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d3100000-0000-0000-0000-000000000003"}',true);
select ok(not private.can_grant_role_key('a3100000-0000-0000-0000-000000000001', 'compliance_admin'),
  'A DSP still cannot grant the retired key (evaluated as administrator)');
select ok(private.can_grant_role_key('a3100000-0000-0000-0000-000000000001', 'dsp'),
  'Operational role grants are unaffected');
reset role;

select * from finish();
rollback;
