-- HM CORRECTIVE ACTIONS + SITE SCOPE (simulation batch 7; reviewer
-- HOLD fix-up on PR #199, 2026-10-31).
--
-- PART 1 — the house_manager pack gains correctiveActions.manage.
-- THE DEFECT: correctiveActions.manage shipped in the audit-readiness
-- build (20260915021000) for administrator / compliance_admin /
-- program_manager, but the house_manager pack never received it — in
-- src/data/permissions.ts, in the regenerated seed
-- (20260915024000_integrated_permissions.sql), or in live agency_roles
-- copies. The house manager owns QA follow-up at their home, yet could
-- only VIEW corrective actions: no role at the house could start one,
-- and QA Review offered no creation path at all.
--
-- THE SEED RULE (reviewer requirement): the canonical matrix is
-- refreshed and MISSING keys merge into role_templates / agency_roles
-- (m.permissions || stored — the stored side wins per key). A stored
-- value is NEVER overwritten: an agency that deliberately set this key
-- (true or false) in Roles & access keeps its choice. Only copies
-- where the key is absent inherit the canonical default.
--
-- CONSEQUENCE, stated plainly: the 20260915024000 seed merged an
-- explicit correctiveActions.manage:false into every house_manager
-- template and agency role, so under this rule those copies stay OFF
-- after this migration — the capability reaches an existing agency
-- when its administrator enables "Manage corrective actions" for
-- House Manager in Roles & access. The canonical default going
-- forward (permissions.ts + the matrix below) is true, so any copy
-- where the key is genuinely absent — and any future role seeded from
-- permissions.ts — starts with the capability on. The original draft
-- of this migration flipped the stored false to true; the PR reviewer
-- required the conservative rule above instead.
--
-- PART 2 — corrective actions are SITE-SCOPED (reviewer requirement).
-- Granting house managers correctiveActions.manage against the old
-- agency-wide rows would have let one home's manager create, assign,
-- and resolve free-text actions for every home: corrective_actions
-- carried no site, and the 20260915028000 visibility rule keys off
-- creator/assignee alone. Now:
--   * corrective_actions.site_id names the home the action belongs
--     to; qa_audit_id names the QA audit that raised it, when it came
--     from one. Backfill: the linked audit's site first, then the
--     creator's membership home site; rows that match neither stay
--     NULL — agency-level actions, visible to agency management only.
--   * private.corrective_action_in_scope(agency, site) is the single
--     scope rule, used by every policy on the table: agency
--     management roles reach every row; anyone else reaches a row
--     only through its site (private.can_read_site — membership home
--     or an active staff assignment). Auditors keep read-everything
--     via the restrictive policy (their writes stay blocked by the
--     correctiveActions.manage permission policy).
--   * The identity guard additionally enforces the placement rules
--     at the database boundary: a sited action's home must be in the
--     same agency, its QA link must name an audit of that home, and
--     its assignee must currently work at that home (membership home
--     or an ACTIVE assignment — ended/future assignments do not
--     count). Enforced on insert and on site/assignee changes only,
--     so resolving a legacy row is never re-judged.
-- Mirrors src/data/access.ts (correctiveActionInScope /
-- staffActiveAtSite) and the corrective-action sections of both APIs.
begin;

-- ---------------------------------------------------------------------
-- Part 1: canonical permission seed (missing keys only; stored wins)
-- ---------------------------------------------------------------------
insert into public.role_permission_matrix(role_key,permissions) values
('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":true,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":true,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":true,"hub.review_timecards":true,"hub.approve_time_off":true,"hub.view_team":true,"hub.approve_payroll":true,"hub.manage_documents":true,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":false,"ger.resolve":false,"behavior.record":true,"behavior.plan":false,"health.record":true}'::jsonb),
('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":true,"ger.create":true,"ger.review":true,"ger.resolve":true,"behavior.record":true,"behavior.plan":true,"health.record":true}'::jsonb),
('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":true,"hub.manage_pay_settings":true,"hub.remote_punch":false,"messages.use":true,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb),
('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"correctiveActions.manage":false,"lifeEvents.record":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false,"hub.access":true,"hub.manage_schedule":false,"hub.review_timecards":false,"hub.approve_time_off":false,"hub.view_team":false,"hub.approve_payroll":false,"hub.manage_documents":false,"hub.manage_staffing":false,"hub.manage_pay_settings":false,"hub.remote_punch":false,"messages.use":false,"ger.create":false,"ger.review":false,"ger.resolve":false,"behavior.record":false,"behavior.plan":false,"health.record":false}'::jsonb)
on conflict(role_key) do update set permissions=excluded.permissions,updated_at=now();

-- Missing new capabilities inherit their canonical defaults. Existing choices win.
update public.role_templates t set permissions=m.permissions || t.permissions
from public.role_permission_matrix m where m.role_key=t.key;
update public.agency_roles a set permissions=m.permissions || a.permissions
from public.role_permission_matrix m where m.role_key=a.template_key;
-- ---------------------------------------------------------------------
-- Part 2: corrective_actions site scope
-- ---------------------------------------------------------------------
alter table public.corrective_actions
  add column if not exists site_id uuid null
    references public.sites (id) on delete set null,
  add column if not exists qa_audit_id uuid null
    references public.qa_audits (id) on delete set null;

comment on column public.corrective_actions.site_id is
  'The home this action belongs to; visibility and management are '
  'scoped to it (private.corrective_action_in_scope). Null = '
  'agency-level action, agency management only.';

create index if not exists corrective_actions_agency_site
  on public.corrective_actions (agency_id, site_id);

-- Backfill (runs under the pre-existing identity guard, which does not
-- judge placements): the originating QA audit's site first, then the
-- creator's membership home site. Anything else stays NULL.
update public.corrective_actions ca
set site_id = qa.site_id
from public.qa_audits qa
where ca.site_id is null
  and ca.qa_audit_id = qa.id
  and qa.agency_id = ca.agency_id;

update public.corrective_actions ca
set site_id = m.site_id
from public.memberships m
where ca.site_id is null
  and m.agency_id = ca.agency_id
  and m.user_id = ca.created_by_user_id
  and m.site_id is not null;

-- The one scope rule for corrective actions: agency management reaches
-- every row; everyone else reaches a row only through its site.
create or replace function private.corrective_action_in_scope(
  p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select private.has_agency(p_agency_id) and (
    private.role_key_in(p_agency_id, array[
      'administrator', 'compliance_admin',
      'degreed_professional_manager', 'program_manager'])
    or (p_site_id is not null
        and private.can_read_site(p_agency_id, p_site_id))
  );
$$;

revoke all on function private.corrective_action_in_scope(uuid, uuid) from public;
grant execute on function private.corrective_action_in_scope(uuid, uuid) to authenticated;

drop policy if exists corrective_actions_select on public.corrective_actions;
create policy corrective_actions_select on public.corrective_actions
for select to authenticated
using (
  (select private.corrective_action_in_scope(agency_id, site_id))
  or (select private.role_key_in(agency_id, array['auditor']))
);

drop policy if exists corrective_actions_write on public.corrective_actions;
create policy corrective_actions_write on public.corrective_actions
for all to authenticated
using (
  (select private.has_permission(agency_id, 'correctiveActions.manage'))
  and (select private.corrective_action_in_scope(agency_id, site_id))
)
with check (
  (select private.has_permission(agency_id, 'correctiveActions.manage'))
  and (select private.corrective_action_in_scope(agency_id, site_id))
);

-- The 20260915028000 restrictive visibility rule (management roles or
-- creator/assignee, agency-wide) is replaced by the site scope:
-- creator/assignee alone no longer opens another home's records.
drop policy if exists corrective_actions_visible on public.corrective_actions;
create policy corrective_actions_visible on public.corrective_actions
as restrictive
for all to authenticated
using (
  (select private.corrective_action_in_scope(agency_id, site_id))
  or (select private.role_key_in(agency_id, array['auditor']))
)
with check (
  (select private.corrective_action_in_scope(agency_id, site_id))
  or (select private.role_key_in(agency_id, array['auditor']))
);

-- Placement enforcement at the database boundary (extends the
-- 20260915028000 identity guard; title / active-member / identity
-- rules unchanged). Placement is judged on insert and whenever the
-- site, assignee, or QA link changes — never on status-only updates.
create or replace function private.corrective_action_identity_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  placement_changed boolean := TG_OP = 'INSERT';
begin
  if TG_OP = 'UPDATE' then
    placement_changed :=
      new.site_id is distinct from old.site_id
      or new.assigned_to_user_id is distinct from old.assigned_to_user_id
      or new.qa_audit_id is distinct from old.qa_audit_id;
  end if;
  if new.title is null or trim(new.title) = '' then
    raise exception 'Give the corrective action a title.';
  end if;
  if new.assigned_to_user_id is not null and not exists (
    select 1 from memberships m
    where m.agency_id = new.agency_id and m.user_id = new.assigned_to_user_id
      and (m.expires_on is null or m.expires_on >= current_date)
  ) then raise exception 'Assign an active member of this agency.'; end if;
  if placement_changed then
    if new.site_id is not null and not exists (
      select 1 from sites s
      where s.id = new.site_id and s.agency_id = new.agency_id
    ) then raise exception 'Choose a home in this agency.'; end if;
    if new.qa_audit_id is not null and not exists (
      select 1 from qa_audits qa
      where qa.id = new.qa_audit_id and qa.agency_id = new.agency_id
        and (new.site_id is null or qa.site_id = new.site_id)
    ) then raise exception 'The corrective action''s home must match its QA review.'; end if;
    if new.site_id is not null and new.assigned_to_user_id is not null
      and not exists (
        select 1 from memberships m
        where m.agency_id = new.agency_id and m.user_id = new.assigned_to_user_id
          and m.site_id = new.site_id
          and (m.expires_on is null or m.expires_on >= current_date)
      )
      and not exists (
        select 1 from staff_assignments a
        left join individuals ai
          on ai.id = a.individual_id and ai.agency_id = a.agency_id
        where a.agency_id = new.agency_id and a.user_id = new.assigned_to_user_id
          and a.starts_on <= current_date
          and (a.ends_on is null or a.ends_on >= current_date)
          and coalesce(a.site_id, ai.site_id) = new.site_id
      )
    then raise exception 'Assign corrective actions to staff who work at that home.'; end if;
  end if;
  if TG_OP = 'INSERT' and auth.role() = 'authenticated' then
    new.created_by_user_id := auth.uid();
  elsif TG_OP = 'UPDATE' and (
    new.agency_id <> old.agency_id
    or new.created_by_user_id <> old.created_by_user_id
    or new.id <> old.id
  ) then
    raise exception 'Corrective action identity cannot be changed.';
  end if;
  return new;
end $$;

commit;
