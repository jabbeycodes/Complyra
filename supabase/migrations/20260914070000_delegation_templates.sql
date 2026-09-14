-- ============================================================================
-- DELEGATION TEMPLATE LIBRARY (2026-09-14)
-- Branch: lifepath/delegation-templates. NOT APPLIED TO HOSTED SUPABASE.
-- Do not apply without Joshua's explicit production approval.
--
-- Workflow:
--   1. Common templates (agency_id NULL) are visible to every agency.
--      Because the library is global, newly provisioned agencies receive it
--      automatically — no per-agency seeding or triggers needed.
--   2. A DPM activates a template for a program site -> visible to site staff
--      as "In preparation". Activation notifies nobody.
--   3. A DPM/RN assigns it to an individual -> an editable training draft is
--      instantiated (draft status). Reviewers are notified.
--   4. A DPM/RN reviews, edits, submits, and approves -> published.
--      Publication notifies every staff member at the site.
--   5. Staff open the published material and sign their own row.
--   6. sweep_delegation_ack_overdue() notifies overdue staff + managers.
--
-- Security model:
--   - Activations and assignments are readable only at the reader's own
--     site(s) (agency-wide memberships see all their agency's sites).
--   - delegation_training_materials is directly readable by reviewers only
--     (delegation.training.review / delegation.training.approve). Ordinary
--     staff NEVER see draft_content: they read published material through
--     get_published_training_material(), which returns published_content
--     only. Drafts stay hidden until publication.
--   - All writes go through SECURITY DEFINER RPCs below; there are no
--     INSERT/UPDATE/DELETE table policies.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Tables
-- --------------------------------------------------------------------------

create table if not exists public.delegation_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid null references public.agencies (id) on delete cascade,
  name text not null,
  category text not null,
  sections jsonb not null default '{"purpose":"","steps":[],"safetyWarnings":[],"documentation":[]}'::jsonb,
  individualization_note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_delegation_activations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  template_id uuid not null references public.delegation_templates (id) on delete restrict,
  site_id uuid not null,
  status text not null default 'active' check (status in ('active', 'deactivated')),
  activated_at timestamptz not null default now(),
  activated_by uuid null references public.profiles (id) on delete set null,
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade
);

create unique index if not exists site_delegation_activations_active_unique
  on public.site_delegation_activations (template_id, site_id)
  where status = 'active';

create table if not exists public.individual_delegation_assignments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  activation_id uuid not null references public.site_delegation_activations (id) on delete cascade,
  template_id uuid not null references public.delegation_templates (id) on delete restrict,
  individual_id uuid not null,
  site_id uuid not null,
  status text not null default 'assigned' check (status in ('assigned', 'ended')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid null references public.profiles (id) on delete set null,
  unique (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id) on delete cascade,
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade
);

create unique index if not exists individual_delegation_assignments_active_unique
  on public.individual_delegation_assignments (activation_id, individual_id)
  where status = 'assigned';

create table if not exists public.delegation_training_materials (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  assignment_id uuid not null,
  site_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published')),
  draft_content jsonb not null,
  published_content jsonb null,
  submitted_at timestamptz null,
  approved_at timestamptz null,
  approved_by uuid null references public.profiles (id) on delete set null,
  unique (id, agency_id),
  foreign key (assignment_id, agency_id)
    references public.individual_delegation_assignments (id, agency_id) on delete cascade,
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade,
  unique (assignment_id)
);

create table if not exists public.delegation_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  assignment_id uuid not null,
  site_id uuid not null,
  staff_id uuid not null references public.profiles (id) on delete cascade,
  opened_at timestamptz null,
  signed_at timestamptz null,
  signature_name text null,
  signature_mark text null,
  unique (id, agency_id),
  foreign key (assignment_id, agency_id)
    references public.individual_delegation_assignments (id, agency_id) on delete cascade,
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade,
  unique (assignment_id, staff_id)
);

create index if not exists delegation_training_materials_site_idx
  on public.delegation_training_materials (site_id, status);
create index if not exists delegation_acknowledgments_assignment_idx
  on public.delegation_acknowledgments (assignment_id);

-- --------------------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------------------

alter table public.delegation_templates enable row level security;
alter table public.site_delegation_activations enable row level security;
alter table public.individual_delegation_assignments enable row level security;
alter table public.delegation_training_materials enable row level security;
alter table public.delegation_acknowledgments enable row level security;

-- Site membership helper: the caller works at the site, or holds an
-- agency-wide membership (site_id null).
create or replace function private.has_site(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and (m.site_id = p_site_id or m.site_id is null)
  );
$$;

-- Common library (agency_id null) is readable by every authenticated user;
-- agency templates only by that agency's members.
drop policy if exists delegation_templates_select on public.delegation_templates;
create policy delegation_templates_select on public.delegation_templates
for select to authenticated
using (
  agency_id is null
  or (select private.has_agency(agency_id))
);

-- Activations: only at the reader's own site(s).
drop policy if exists site_delegation_activations_select on public.site_delegation_activations;
create policy site_delegation_activations_select on public.site_delegation_activations
for select to authenticated
using ((select private.has_site(agency_id, site_id)));

-- Assignments: only at the reader's own site(s).
drop policy if exists individual_delegation_assignments_select on public.individual_delegation_assignments;
create policy individual_delegation_assignments_select on public.individual_delegation_assignments
for select to authenticated
using ((select private.has_site(agency_id, site_id)));

-- Training materials: reviewers only. Ordinary staff must use
-- get_published_training_material(), which strips draft_content, so draft
-- content is never exposed to site staff through this table.
drop policy if exists delegation_training_materials_select on public.delegation_training_materials;
create policy delegation_training_materials_select on public.delegation_training_materials
for select to authenticated
using (
  (select private.has_permission(agency_id, 'delegation.training.review'))
  or (select private.has_permission(agency_id, 'delegation.training.approve'))
);

-- Acknowledgments: own row, or the roster viewers (reviewers / approvers /
-- activators / the site's house manager).
drop policy if exists delegation_acknowledgments_select on public.delegation_acknowledgments;
create policy delegation_acknowledgments_select on public.delegation_acknowledgments
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.has_permission(agency_id, 'delegation.training.review'))
  or (select private.has_permission(agency_id, 'delegation.training.approve'))
  or (select private.has_permission(agency_id, 'delegation.activate'))
  or exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = delegation_acknowledgments.agency_id
      and m.site_id = delegation_acknowledgments.site_id
      and coalesce(m.role_key, m.role::text) = 'house_manager'
      and (m.expires_on is null or m.expires_on >= current_date)
  )
);

-- No INSERT/UPDATE/DELETE policies: every write goes through the
-- SECURITY DEFINER RPCs below.

-- --------------------------------------------------------------------------
-- Write RPCs (SECURITY DEFINER). Each returns a single JSON object.
-- --------------------------------------------------------------------------

create or replace function public.activate_delegation_template(
  p_template_id uuid,
  p_site_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_row public.site_delegation_activations%rowtype;
begin
  select s.agency_id into v_agency from public.sites s where s.id = p_site_id;
  if v_agency is null then
    raise exception 'Site not found.';
  end if;
  if not private.has_permission(v_agency, 'delegation.activate') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not exists (
    select 1 from public.delegation_templates t
    where t.id = p_template_id and t.active
      and (t.agency_id is null or t.agency_id = v_agency)
  ) then
    raise exception 'Template not found or not active.';
  end if;

  -- Reactivate a previously deactivated activation if one exists.
  update public.site_delegation_activations
  set status = 'active', activated_at = now(), activated_by = auth.uid()
  where template_id = p_template_id and site_id = p_site_id and status = 'deactivated'
  returning * into v_row;

  if not found then
    insert into public.site_delegation_activations
      (agency_id, template_id, site_id, status, activated_by)
    values (v_agency, p_template_id, p_site_id, 'active', auth.uid())
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.assign_delegation(
  p_activation_id uuid,
  p_individual_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act public.site_delegation_activations%rowtype;
  v_tpl public.delegation_templates%rowtype;
  v_ind public.individuals%rowtype;
  v_site public.sites%rowtype;
  v_assignment public.individual_delegation_assignments%rowtype;
  v_material public.delegation_training_materials%rowtype;
  v_draft jsonb;
begin
  select * into v_act from public.site_delegation_activations where id = p_activation_id;
  if v_act.id is null then
    raise exception 'Delegation activation not found.';
  end if;
  if v_act.status <> 'active' then
    raise exception 'This activation is no longer active.';
  end if;
  if not private.has_permission(v_act.agency_id, 'delegation.assign') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_act.agency_id, v_act.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;

  select * into v_ind from public.individuals
  where id = p_individual_id and agency_id = v_act.agency_id;
  if v_ind.id is null then
    raise exception 'Individual not found.';
  end if;
  -- The individual must belong to the activated site.
  if v_ind.site_id <> v_act.site_id then
    raise exception 'The individual does not belong to the activated site.';
  end if;

  select * into v_tpl from public.delegation_templates where id = v_act.template_id;
  select * into v_site from public.sites where id = v_act.site_id;

  insert into public.individual_delegation_assignments
    (agency_id, activation_id, template_id, individual_id, site_id, status, assigned_by)
  values
    (v_act.agency_id, v_act.id, v_tpl.id, v_ind.id, v_site.id, 'assigned', auth.uid())
  returning * into v_assignment;

  -- Instantiate the editable draft from the generic template sections.
  v_draft := jsonb_build_object(
    'templateId', v_tpl.id,
    'templateName', v_tpl.name,
    'individualId', v_ind.id,
    'individualName', v_ind.full_name,
    'siteId', v_site.id,
    'siteName', v_site.name,
    'purpose', v_tpl.sections ->> 'purpose',
    'steps', coalesce(v_tpl.sections -> 'steps', '[]'::jsonb),
    'safetyWarnings', coalesce(v_tpl.sections -> 'safetyWarnings', '[]'::jsonb),
    'documentation', coalesce(v_tpl.sections -> 'documentation', '[]'::jsonb),
    'individualNotes', '',
    'individualizationNote', v_tpl.individualization_note,
    'generatedMark', 'Digital record generated by Complyrer.'
  );

  insert into public.delegation_training_materials
    (agency_id, assignment_id, site_id, status, draft_content)
  values
    (v_act.agency_id, v_assignment.id, v_site.id, 'draft', v_draft)
  returning * into v_material;

  -- Notify reviewers (DPM/RN/admins at the site or agency-wide). Activation
  -- itself notifies nobody; assignment notifies reviewers only.
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct
    v_act.agency_id,
    m.user_id,
    'delegation.review_ready',
    'Delegation ready for review',
    v_tpl.name || ' was assigned to ' || v_ind.full_name || ' at ' || v_site.name ||
      '. Review and individualize the training draft.',
    '/delegations/templates',
    'delegation_assignment',
    v_assignment.id::text,
    'delegation.review_ready:' || v_assignment.id::text || ':' || m.user_id::text
  from public.memberships m
  join public.agency_roles ar
    on ar.agency_id = m.agency_id
   and ar.template_key = coalesce(m.role_key, m.role::text)
  where m.agency_id = v_act.agency_id
    and (m.site_id = v_site.id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= current_date)
    and coalesce((ar.permissions ->> 'delegation.training.review')::boolean, false)
  on conflict (agency_id, dedupe_key) do nothing;

  return jsonb_build_object('assignment', to_jsonb(v_assignment), 'material', to_jsonb(v_material));
end;
$$;

create or replace function public.submit_delegation_review(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    raise exception 'Training material not found.';
  end if;
  if not private.has_permission(v_mat.agency_id, 'delegation.training.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status <> 'draft' then
    raise exception 'Only drafts can be submitted for review.';
  end if;
  update public.delegation_training_materials
  set status = 'in_review', submitted_at = now()
  where id = v_mat.id
  returning * into v_mat;
  return to_jsonb(v_mat);
end;
$$;

create or replace function public.approve_delegation_material(
  p_assignment_id uuid,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
  v_asg public.individual_delegation_assignments%rowtype;
  v_content jsonb;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    raise exception 'Training material not found.';
  end if;
  if not private.has_permission(v_mat.agency_id, 'delegation.training.approve') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status = 'published' then
    raise exception 'This material is already published.';
  end if;
  select * into v_asg from public.individual_delegation_assignments where id = p_assignment_id;

  v_content := coalesce(p_content, v_mat.draft_content)
    || '{"generatedMark": "Digital record generated by Complyrer."}'::jsonb;

  update public.delegation_training_materials
  set status = 'published',
      draft_content = v_content,
      published_content = v_content,
      approved_at = now(),
      approved_by = auth.uid()
  where id = v_mat.id
  returning * into v_mat;

  -- Publication notifies every staff member at the site, exactly once.
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct
    v_mat.agency_id,
    m.user_id,
    'delegation.published',
    'New delegation training to review',
    (v_content ->> 'templateName') || ' for ' || (v_content ->> 'individualName') ||
      ' is published. Review it and sign your acknowledgment.',
    '/delegations/templates',
    'delegation_assignment',
    v_asg.id::text,
    'delegation.published:' || v_asg.id::text || ':' || m.user_id::text
  from public.memberships m
  where m.agency_id = v_mat.agency_id
    and (m.site_id = v_mat.site_id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= current_date)
  on conflict (agency_id, dedupe_key) do nothing;

  return to_jsonb(v_mat);
end;
$$;

create or replace function public.open_delegation_material(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
  v_ack public.delegation_acknowledgments%rowtype;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    raise exception 'Training material not found.';
  end if;
  if not private.has_permission(v_mat.agency_id, 'delegation.acknowledge') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_mat.agency_id, v_mat.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status <> 'published' then
    raise exception 'This training material is not published yet.';
  end if;

  insert into public.delegation_acknowledgments
    (agency_id, assignment_id, site_id, staff_id, opened_at)
  values
    (v_mat.agency_id, v_mat.assignment_id, v_mat.site_id, auth.uid(), now())
  on conflict (assignment_id, staff_id) do update
    set opened_at = coalesce(public.delegation_acknowledgments.opened_at, now())
  returning * into v_ack;

  return jsonb_build_object('opened', true, 'openedAt', v_ack.opened_at);
end;
$$;

-- Staff-facing read: published content ONLY. draft_content is never returned.
create or replace function public.get_published_training_material(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
  v_asg public.individual_delegation_assignments%rowtype;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    return null;
  end if;
  if not private.has_site(v_mat.agency_id, v_mat.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status <> 'published' or v_mat.published_content is null then
    return null;
  end if;
  select * into v_asg from public.individual_delegation_assignments where id = p_assignment_id;
  return jsonb_build_object(
    'assignmentId', v_asg.id,
    'templateName', (v_mat.published_content ->> 'templateName'),
    'individualName', (v_mat.published_content ->> 'individualName'),
    'siteName', (v_mat.published_content ->> 'siteName'),
    'status', v_mat.status,
    'approvedAt', v_mat.approved_at,
    'content', v_mat.published_content
  );
end;
$$;

-- Own-signature enforcement: staff sign their own row only, after opening.
create or replace function public.sign_delegation_ack(
  p_assignment_id uuid,
  p_signature_name text,
  p_signature_mark text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
  v_ack public.delegation_acknowledgments%rowtype;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    raise exception 'Training material not found.';
  end if;
  if not private.has_permission(v_mat.agency_id, 'delegation.acknowledge') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_mat.agency_id, v_mat.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status <> 'published' then
    raise exception 'This training material is not published yet.';
  end if;
  if p_signature_name is null or btrim(p_signature_name) = '' then
    raise exception 'A legal name is required to sign.';
  end if;

  select * into v_ack from public.delegation_acknowledgments
  where assignment_id = p_assignment_id and staff_id = auth.uid();
  if v_ack.id is null or v_ack.opened_at is null then
    raise exception 'Open the material before signing.';
  end if;
  if v_ack.signed_at is not null then
    raise exception 'You have already signed this acknowledgment.';
  end if;

  update public.delegation_acknowledgments
  set signed_at = now(),
      signature_name = btrim(p_signature_name),
      signature_mark = nullif(btrim(coalesce(p_signature_mark, '')), '')
  where id = v_ack.id
  returning * into v_ack;

  -- A single JSON object (not an array).
  return to_jsonb(v_ack);
end;
$$;

-- Overdue sweep. Returns the number of notifications ACTUALLY inserted
-- (dedupe-aware: re-runs never double-count). Called by the scheduler /
-- edge function with service role, or by a reviewer.
create or replace function public.sweep_delegation_ack_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- 1) Staff reminders: one per overdue (assignment, staff).
  with overdue as (
    select distinct
      m.agency_id,
      m.assignment_id,
      m.site_id,
      m.approved_at,
      (m.published_content ->> 'templateName') as template_name,
      (m.published_content ->> 'individualName') as individual_name,
      mem.user_id
    from public.delegation_training_materials m
    join public.individual_delegation_assignments a
      on a.id = m.assignment_id and a.status = 'assigned'
    join public.memberships mem
      on mem.agency_id = m.agency_id
     and (mem.site_id = m.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= current_date)
    left join public.delegation_acknowledgments ack
      on ack.assignment_id = m.assignment_id
     and ack.staff_id = mem.user_id
     and ack.signed_at is not null
    where m.status = 'published'
      and m.approved_at < now() - interval '7 days'
      and ack.id is null
  ),
  ins as (
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    select
      agency_id,
      user_id,
      'delegation.ack_overdue',
      'Delegation acknowledgment overdue',
      template_name || ' for ' || individual_name ||
        ' was published ' || extract(day from (now() - approved_at))::int ||
        ' days ago. Review it and sign your acknowledgment.',
      '/delegations/templates',
      'delegation_assignment',
      assignment_id::text,
      'delegation.ack_overdue:' || assignment_id::text || ':' || user_id::text
    from overdue
    on conflict (agency_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_added from ins;
  v_count := v_count + v_added;

  -- 2) Manager summaries: one per overdue assignment per manager
  --    (delegation.activate holders at the site or agency-wide).
  with overdue_assignments as (
    select distinct
      m.agency_id, m.assignment_id, m.site_id,
      (m.published_content ->> 'templateName') as template_name,
      (m.published_content ->> 'individualName') as individual_name,
      count(*) filter (
        where ack.id is null
      ) over (partition by m.assignment_id) as outstanding
    from public.delegation_training_materials m
    join public.individual_delegation_assignments a
      on a.id = m.assignment_id and a.status = 'assigned'
    join public.memberships mem
      on mem.agency_id = m.agency_id
     and (mem.site_id = m.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= current_date)
    left join public.delegation_acknowledgments ack
      on ack.assignment_id = m.assignment_id
     and ack.staff_id = mem.user_id
     and ack.signed_at is not null
    where m.status = 'published'
      and m.approved_at < now() - interval '7 days'
  ),
  managers as (
    select distinct
      oa.agency_id, oa.assignment_id, oa.template_name, oa.individual_name,
      oa.outstanding, mem.user_id
    from overdue_assignments oa
    join public.memberships mem
      on mem.agency_id = oa.agency_id
     and (mem.site_id = oa.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= current_date)
    join public.agency_roles ar
      on ar.agency_id = mem.agency_id
     and ar.template_key = coalesce(mem.role_key, mem.role::text)
    where coalesce((ar.permissions ->> 'delegation.activate')::boolean, false)
  ),
  ins2 as (
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    select
      agency_id,
      user_id,
      'delegation.ack_overdue',
      'Delegation acknowledgments overdue',
      outstanding::int || ' staff still need to sign ' || template_name ||
        ' for ' || individual_name || '.',
      '/delegations/templates',
      'delegation_assignment',
      assignment_id::text,
      'delegation.ack_overdue:mgr:' || assignment_id::text || ':' || user_id::text
    from managers
    on conflict (agency_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_added from ins2;
  v_count := v_count + v_added;

  return v_count;
end;
$$;

-- --------------------------------------------------------------------------
-- Seed: the common template library (agency_id NULL). Visible to every
-- agency, including agencies provisioned after this migration runs.
-- Idempotent: keyed on the template name.
-- --------------------------------------------------------------------------

insert into public.delegation_templates
  (agency_id, name, category, sections, individualization_note, active)
values
  (null, 'Bowel movement (BM) protocol', 'Health monitoring',
   '{"purpose": "Support regular bowel habits for the person by following their individualized bowel routine and noticing changes early.",
     "steps": ["Follow the person''s individualized bowel routine as written in their support plan.",
       "Offer fluids and movement opportunities throughout the day as the plan describes.",
       "Observe and note each bowel movement: time, amount, and consistency in plain words.",
       "Report right away if the person has pain, straining, blood, or no bowel movement for the number of days their plan names.",
       "Keep the bathroom routine calm, private, and respectful of the person''s dignity."],
     "safetyWarnings": ["Never give laxatives, suppositories, enemas, or any bowel medication unless the current physician order and delegation say so.",
       "Do not change the person''s diet, fluids, or routine to ''fix'' constipation on your own — report it instead.",
       "Treat any report of severe abdominal pain, vomiting, or blood as urgent and follow the person''s emergency contacts."],
     "documentation": ["Record each bowel movement on the person''s bowel tracking log the same day.",
       "Note anything unusual (pain, straining, blood, missed days) and who you reported it to."]}'::jsonb,
   'The DPM or RN must fill in this person''s normal pattern, what counts as a missed day for them, and their current physician orders before approval.',
   true),
  (null, 'Seizure protocol', 'Health monitoring',
   '{"purpose": "Keep the person safe during and after a seizure and capture accurate information for their medical team.",
     "steps": ["Stay with the person. Note the exact time the seizure starts.",
       "Ease the person to the floor if they are not already there; place something soft under their head.",
       "Move hard or sharp objects away. Loosen anything tight around the neck.",
       "Do not put anything in the person''s mouth. Do not hold them down.",
       "Time the seizure. When it ends, note the time and place the person on their side if they are sleepy or vomiting.",
       "Stay until the person is fully alert and oriented, then help them rest as their plan describes."],
     "safetyWarnings": ["Call emergency services when the person''s seizure plan says to — for example a seizure lasting longer than the plan''s limit, repeated seizures, trouble breathing afterward, or injury.",
       "Never leave the person alone while they are confused or sleepy after a seizure.",
       "Do not offer food, drink, or medication until the person is fully alert and their plan allows it."],
     "documentation": ["Complete a seizure record the same day: date, start and end times, what you observed before/during/after, and any injury.",
       "Report the seizure to the nurse and house manager per the person''s plan."]}'::jsonb,
   'The DPM or RN must add this person''s seizure type(s), emergency thresholds, rescue medication orders (if any), and who to call before approval.',
   true),
  (null, 'High-fiber/high-protein diet', 'Nutrition',
   '{"purpose": "Serve meals and snacks that match the person''s prescribed high-fiber, high-protein eating pattern.",
     "steps": ["Follow the person''s meal plan or diet guide for what to serve at each meal and snack.",
       "Include the fiber and protein foods the plan lists; keep portions as the plan describes.",
       "Offer water with meals and between meals as the plan directs.",
       "If the person refuses foods or eats very little, offer the plan''s alternatives and note the intake.",
       "Store and reheat food safely; check dates on prepared items."],
     "safetyWarnings": ["Do not change the diet pattern, add supplements, or remove foods because of a preference or a rumor — follow the written plan.",
       "Report ongoing poor intake, vomiting, diarrhea, or sudden weight changes to the nurse.",
       "Follow the person''s choking or swallowing precautions at every meal if they have any."],
     "documentation": ["Record meal intake as the plan requires (for example: full, half, refused).",
       "Note substitutions offered and anything unusual about appetite or tolerance."]}'::jsonb,
   'The DPM or RN must attach this person''s actual meal plan or diet guide, portion sizes, fluid goals, and any swallowing precautions before approval.',
   true),
  (null, 'Calorie intake tracking', 'Nutrition',
   '{"purpose": "Track what the person eats and drinks so the team can see whether their intake meets the plan''s goals.",
     "steps": ["Record every meal, snack, and drink the person has, with the amounts eaten.",
       "Use the same measuring words each time (cups, pieces, bites) so records can be compared.",
       "Note refused or missed meals and what was offered instead.",
       "Add up the day''s intake in the way the person''s tracking sheet describes.",
       "Share the completed log with the nurse or dietitian on the schedule the plan names."],
     "safetyWarnings": ["Do not guess or fill in meals you did not observe — leave them blank and note why.",
       "Report a pattern of refused meals or a sudden drop in intake promptly rather than waiting for the next review."],
     "documentation": ["Complete the intake log daily and keep it where the team can find it.",
       "Flag days that fell well above or below the plan''s target and tell the nurse."]}'::jsonb,
   'The DPM or RN must set this person''s daily targets, what counts as a full portion for them, and the review schedule before approval.',
   true),
  (null, 'Choking/aspiration protocol', 'Safety',
   '{"purpose": "Reduce choking risk at meals and respond correctly if the person chokes or shows signs of aspiration.",
     "steps": ["Seat the person upright for meals as their plan describes and keep mealtimes calm and unhurried.",
       "Serve food in the sizes and textures the person''s plan lists; never ''upgrade'' textures on your own.",
       "Stay with the person while they eat. Watch for coughing, throat clearing, wet voice, or pocketing food.",
       "If the person cannot breathe, cough, or speak, follow your choking-response training and call emergency services.",
       "After any choking episode, keep the person calm, do not offer more food, and report it immediately."],
     "safetyWarnings": ["Never change food textures, liquid thickness, or adaptive equipment without a written order from the qualified professional.",
       "Treat repeated coughing at meals, frequent throat clearing, or chest congestion after eating as warning signs — report them the same day.",
       "Do not perform abdominal thrusts or other emergency techniques unless you are trained and the situation calls for it."],
     "documentation": ["Document every choking or aspiration-sign episode: time, what happened, what you did, and who you notified.",
       "Note ongoing mealtime observations the plan asks you to track."]}'::jsonb,
   'The DPM or RN must specify this person''s diet texture, liquid consistency, positioning, supervision level, and emergency steps before approval.',
   true),
  (null, 'G-tube feeding support', 'Nutrition',
   '{"purpose": "Support the person''s tube feeding routine safely and notice problems early.",
     "steps": ["Wash your hands and prepare the feeding area before you begin.",
       "Follow the person''s written feeding schedule: formula type, amount, rate, and flushes.",
       "Position the person as their plan describes during and after the feeding.",
       "Check the tube site at each feeding for redness, swelling, leakage, or pain and report changes.",
       "Keep the equipment clean per the plan''s cleaning steps and store supplies as directed."],
     "safetyWarnings": ["Only staff trained and delegated for this person''s G-tube care may perform feedings — never hand the task to someone else.",
       "Stop and report immediately for a dislodged tube, vomiting during a feeding, breathing difficulty, or severe pain.",
       "Never change the formula, amount, rate, or schedule without a written physician order."],
     "documentation": ["Log each feeding: time started and finished, amount given, flushes, and tolerance.",
       "Record tube-site checks and anything unusual, with who you reported it to."]}'::jsonb,
   'The DPM or RN must attach this person''s current physician orders (formula, rate, schedule, flushes), positioning, and site-care steps before approval. Only delegated, trained staff may be assigned.',
   true),
  (null, 'Blood sugar monitoring', 'Health monitoring',
   '{"purpose": "Check the person''s blood sugar on the schedule their plan sets and respond to readings as directed.",
     "steps": ["Gather the person''s meter and supplies; check that strips are not expired.",
       "Wash your hands and help the person wash theirs, then follow the meter''s steps to take the reading.",
       "Record the reading right away with the date and time.",
       "Compare the reading to the person''s target range and follow the plan''s instructions for low or high readings.",
       "Report readings outside the target range as the plan directs."],
     "safetyWarnings": ["Never adjust insulin or other diabetes medication on your own — only follow current written orders.",
       "Treat signs of low blood sugar (shakiness, sweating, confusion) as urgent and follow the person''s low-blood-sugar plan immediately.",
       "Do not share meters, lancets, or strips between people."],
     "documentation": ["Log every reading with date, time, and any symptoms the person reported.",
       "Note actions taken for out-of-range readings and who you notified."]}'::jsonb,
   'The DPM or RN must enter this person''s testing schedule, target range, low/high response steps, and current medication orders before approval.',
   true),
  (null, 'Fall prevention', 'Safety',
   '{"purpose": "Reduce the person''s risk of falling during daily routines and respond correctly when a fall happens.",
     "steps": ["Keep the person''s walking paths clear of clutter, cords, and wet spots.",
       "Make sure the person uses their prescribed mobility aids, footwear, and supports as the plan describes.",
       "Give the person enough time to move; offer a steady arm or standby help at the level the plan names.",
       "Check that bed, chair, and bathroom supports are in place before transfers.",
       "If the person falls, do not rush to lift them — check for injury, keep them comfortable, and call for help per the plan."],
     "safetyWarnings": ["Report every fall the same day, even if the person says they feel fine — some injuries appear later.",
       "Do not change mobility aids, transfer techniques, or supervision levels without the qualified professional''s direction.",
       "Treat head strikes, loss of consciousness, or inability to bear weight after a fall as urgent."],
     "documentation": ["Complete a fall report for every fall: time, place, what happened, injuries, and witnesses.",
       "Note near-falls and hazards you fixed so the team can adjust the plan."]}'::jsonb,
   'The DPM or RN must describe this person''s mobility level, aids, transfer method, supervision needs, and post-fall steps before approval.',
   true)
on conflict do nothing;

-- --------------------------------------------------------------------------
-- Permission reseeds for the delegation keys (idempotent jsonb merge).
-- Canonical defaults mirror src/data/permissions.ts:
--   all roles: delegation.templates.view
--   administrator / compliance_admin: full workflow (via ALL-pack; only the
--     view key needs forcing here since the pack already covers the rest,
--     but merging the full set keeps fresh rows correct)
--   DPM: activate, assign, review, approve, acknowledge
--   program_manager: activate, acknowledge
--   RN: assign, review, approve, acknowledge
--   HM / DSP: acknowledge
--   HR / auditor: view only
-- --------------------------------------------------------------------------

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{"delegation.templates.view": true}'::jsonb;

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.templates.manage": true,
  "delegation.activate": true,
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where template_key in ('administrator', 'compliance_admin');

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.activate": true,
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where template_key = 'degreed_professional_manager';

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.activate": true,
  "delegation.acknowledge": true
}'::jsonb
where template_key = 'program_manager';

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where template_key = 'nurse';

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{"delegation.acknowledge": true}'::jsonb
where template_key in ('house_manager', 'dsp');

-- role_templates mirror (the template definitions themselves).
update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{"delegation.templates.view": true}'::jsonb;

update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.templates.manage": true,
  "delegation.activate": true,
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where key in ('administrator', 'compliance_admin');

update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.activate": true,
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where key = 'degreed_professional_manager';

update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.activate": true,
  "delegation.acknowledge": true
}'::jsonb
where key = 'program_manager';

update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{
  "delegation.assign": true,
  "delegation.training.review": true,
  "delegation.training.approve": true,
  "delegation.acknowledge": true
}'::jsonb
where key = 'nurse';

update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{"delegation.acknowledge": true}'::jsonb
where key in ('house_manager', 'dsp');

-- --------------------------------------------------------------------------
-- Lifecycle RPCs appended 2026-09-14 (HostedApi parity). The core migration
-- ships no INSERT/UPDATE/DELETE table policies — every write goes through
-- SECURITY DEFINER RPCs — and it had no write path for deactivating a site
-- activation or ending an assignment. These two close that gap so the
-- hosted client never needs direct table writes.
-- --------------------------------------------------------------------------

create or replace function public.deactivate_delegation_activation(
  p_activation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act public.site_delegation_activations%rowtype;
begin
  select * into v_act from public.site_delegation_activations where id = p_activation_id;
  if v_act.id is null then
    raise exception 'Delegation activation not found.';
  end if;
  if not private.has_permission(v_act.agency_id, 'delegation.activate') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_act.agency_id, v_act.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;

  update public.site_delegation_activations
  set status = 'deactivated'
  where id = v_act.id
  returning * into v_act;

  -- A single JSON object (not an array).
  return to_jsonb(v_act);
end;
$$;

create or replace function public.end_delegation_assignment(
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asg public.individual_delegation_assignments%rowtype;
begin
  select * into v_asg from public.individual_delegation_assignments where id = p_assignment_id;
  if v_asg.id is null then
    raise exception 'Delegation assignment not found.';
  end if;
  if not private.has_permission(v_asg.agency_id, 'delegation.assign') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_asg.agency_id, v_asg.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;

  update public.individual_delegation_assignments
  set status = 'ended'
  where id = v_asg.id
  returning * into v_asg;

  -- A single JSON object (not an array).
  return to_jsonb(v_asg);
end;
$$;
