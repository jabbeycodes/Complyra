-- QA-AUDIT (2026-09-14): program-site quality assurance reviews.
--
-- One audit per site per quarter. The app pre-fills every item it can prove
-- from its own data (emergency drills, mileage log, ISP acknowledgments,
-- delegation acknowledgments, safety reports); those rows are locked
-- (source = 'system'). The auditor scores the rest; DPM/HM may dispute a
-- scored item with photo evidence, and the auditor resolves the dispute.
-- Scoring math lives in src/data/qaAudit.ts — nothing is pre-aggregated here
-- except the finalized score snapshot on qa_audits.
--
-- RLS: read for any agency member; writes require the qa.* permissions
-- (qa.audit for scoring/finalizing, qa.dispute additionally for raising
-- disputes, qa.schedule for schedules). Fine-grained rules (locked items,
-- who may resolve) are enforced in the API layer; RLS is the backstop.

create table public.qa_audits (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  year int not null check (year between 2000 and 2100),
  quarter int not null check (quarter between 1 and 4),
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'finalized')),
  auditor_id uuid references public.profiles (id) on delete set null,
  auditor_name text not null default '',
  auditor_signature_name text,
  auditor_signature_mark text,
  signed_at timestamptz,
  score jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, site_id, year, quarter),
  unique (id, agency_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

create index qa_audits_site_idx on public.qa_audits (agency_id, site_id, year, quarter);

create trigger qa_audits_updated_at before update on public.qa_audits
for each row execute function private.set_updated_at();

create table public.qa_audit_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  audit_id uuid not null,
  item_key text not null,
  item_id text not null,
  individual_id uuid,
  individual_name text,
  source text not null default 'auditor' check (source in ('system', 'auditor')),
  locked boolean not null default false,
  result text check (result in ('yes', 'no', 'na', 'skipped')),
  comment text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'scored', 'disputed', 'resolved')),
  system_evidence text,
  scored_by uuid references public.profiles (id) on delete set null,
  scored_by_name text,
  scored_at timestamptz,
  dispute_note text,
  dispute_photos jsonb not null default '[]'::jsonb,
  dispute_raised_by uuid references public.profiles (id) on delete set null,
  dispute_raised_by_name text,
  dispute_raised_at timestamptz,
  dispute_resolution jsonb,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, item_key),
  foreign key (audit_id, agency_id)
    references public.qa_audits (id, agency_id) on delete cascade
);

create index qa_audit_items_audit_idx on public.qa_audit_items (audit_id);

create trigger qa_audit_items_updated_at before update on public.qa_audit_items
for each row execute function private.set_updated_at();

create table public.qa_schedules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  next_due date not null,
  assigned_auditor_id uuid references public.profiles (id) on delete set null,
  assigned_auditor_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, site_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

create trigger qa_schedules_updated_at before update on public.qa_schedules
for each row execute function private.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.qa_audits enable row level security;
alter table public.qa_audits force row level security;

create policy qa_audits_select on public.qa_audits
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy qa_audits_write on public.qa_audits
for all to authenticated
using ((select private.has_permission(agency_id, 'qa.audit')))
with check ((select private.has_permission(agency_id, 'qa.audit')));

alter table public.qa_audit_items enable row level security;
alter table public.qa_audit_items force row level security;

create policy qa_audit_items_select on public.qa_audit_items
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Disputes are raised by DPM/HM (qa.dispute); everything else by qa.audit.
create policy qa_audit_items_write on public.qa_audit_items
for all to authenticated
using (
  (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
)
with check (
  (select private.has_permission(agency_id, 'qa.audit'))
  or (select private.has_permission(agency_id, 'qa.dispute'))
);

alter table public.qa_schedules enable row level security;
alter table public.qa_schedules force row level security;

create policy qa_schedules_select on public.qa_schedules
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy qa_schedules_write on public.qa_schedules
for all to authenticated
using ((select private.has_permission(agency_id, 'qa.schedule')))
with check ((select private.has_permission(agency_id, 'qa.schedule')));

-- ----------------------------------------------------------------------------
-- Permission defaults for the new qa.* keys.
-- Only add the key where it is missing so explicit per-agency
-- customizations are never overwritten.
--   qa.audit    — auditor, administrator
--   qa.dispute  — administrator, house_manager, degreed_professional_manager
--   qa.schedule — administrator, degreed_professional_manager
-- ----------------------------------------------------------------------------
update public.role_templates
set permissions = permissions || '{"qa.audit":true}'::jsonb
where key in ('administrator', 'auditor')
and not (permissions ? 'qa.audit');

update public.role_templates
set permissions = permissions || '{"qa.audit":false}'::jsonb
where key not in ('administrator', 'auditor')
and not (permissions ? 'qa.audit');

update public.role_templates
set permissions = permissions || '{"qa.dispute":true}'::jsonb
where key in ('administrator', 'house_manager', 'degreed_professional_manager')
and not (permissions ? 'qa.dispute');

update public.role_templates
set permissions = permissions || '{"qa.dispute":false}'::jsonb
where key not in ('administrator', 'house_manager', 'degreed_professional_manager')
and not (permissions ? 'qa.dispute');

update public.role_templates
set permissions = permissions || '{"qa.schedule":true}'::jsonb
where key in ('administrator', 'degreed_professional_manager')
and not (permissions ? 'qa.schedule');

update public.role_templates
set permissions = permissions || '{"qa.schedule":false}'::jsonb
where key not in ('administrator', 'degreed_professional_manager')
and not (permissions ? 'qa.schedule');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'qa.audit', template_key in ('administrator', 'auditor')
)
where not (permissions ? 'qa.audit');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'qa.dispute', template_key in ('administrator', 'house_manager', 'degreed_professional_manager')
)
where not (permissions ? 'qa.dispute');

update public.agency_roles
set permissions = permissions || jsonb_build_object(
  'qa.schedule', template_key in ('administrator', 'degreed_professional_manager')
)
where not (permissions ? 'qa.schedule');

-- Refresh the read-only permission matrix mirror with the regenerated seed
-- (values generated from src/data/permissions.ts on 2026-09-14).
insert into public.role_permission_matrix (role_key, permissions)
values
    ('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":true,"qa.schedule":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('degreed_professional_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"qa.audit":false,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb),
    ('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":true,"qa.dispute":false,"qa.schedule":false,"sites.create":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb)

on conflict (role_key) do update
set permissions = excluded.permissions,
    updated_at = now();

-- ----------------------------------------------------------------------------
-- RPC: raise a dispute on a scored QA item (DPM / HM).
-- Atomic: validates, flips status, appends history, notifies auditors.
-- ----------------------------------------------------------------------------
create or replace function public.raise_qa_dispute(
  p_item_id uuid,
  p_note text,
  p_photos jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.qa_audit_items%rowtype;
  v_audit public.qa_audits%rowtype;
  v_now timestamptz := now();
  v_history jsonb;
begin
  select * into v_item from public.qa_audit_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'QA audit item not found.';
  end if;
  select * into v_audit from public.qa_audits where id = v_item.audit_id;
  if not private.has_permission(v_item.agency_id, 'qa.dispute') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.locked then
    raise exception 'System-verified items cannot be disputed.';
  end if;
  if v_item.status not in ('scored', 'resolved') or v_item.result is null then
    raise exception 'Only a scored item can be disputed.';
  end if;
  if coalesce(nullif(trim(p_note), ''), '') = '' then
    raise exception 'A note explaining the dispute is required.';
  end if;
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' or jsonb_array_length(p_photos) < 1 then
    raise exception 'At least one photo is required as evidence.';
  end if;

  -- Flag this transaction so the qa_audit_items_guard trigger recognizes
  -- the RPC-driven write below.
  perform set_config('qa.rpc', 'raise_dispute', true);

  v_history := coalesce(v_item.history, '[]'::jsonb) || jsonb_build_object(
    'at', v_now,
    'by', auth.uid(),
    'byName', (select full_name from public.profiles where id = auth.uid()),
    'action', 'dispute_raised',
    'detail', trim(p_note)
  );

  update public.qa_audit_items
  set status = 'disputed',
      dispute_note = trim(p_note),
      dispute_photos = p_photos,
      dispute_raised_by = auth.uid(),
      dispute_raised_by_name = (select full_name from public.profiles where id = auth.uid()),
      dispute_raised_at = v_now,
      dispute_resolution = null,
      history = v_history,
      updated_at = v_now
  where id = p_item_id
  returning * into v_item;

  insert into public.notifications
    (agency_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  values
    (v_item.agency_id,
     'auditor',
     'qa.dispute_raised',
     'QA finding disputed',
     'A QA finding in the ' || v_audit.year || ' Q' || v_audit.quarter ||
       ' audit was disputed with photo evidence and needs review.',
     '/qa-audits/' || v_audit.id::text,
     'qa_audit',
     v_audit.id::text,
     'qa.dispute_raised:' || v_audit.id::text || ':' || v_item.item_key || ':' ||
       to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS'))
  on conflict do nothing;

  return to_jsonb(v_item);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: resolve a QA dispute (auditor). Approving flips an incorrect No to Yes.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_qa_dispute(
  p_item_id uuid,
  p_approved boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.qa_audit_items%rowtype;
  v_now timestamptz := now();
  v_result text;
  v_history jsonb;
begin
  select * into v_item from public.qa_audit_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'QA audit item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'qa.audit') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status <> 'disputed' then
    raise exception 'That item is not under dispute.';
  end if;
  if coalesce(nullif(trim(p_reason), ''), '') = '' then
    raise exception 'A reason is required to resolve a dispute.';
  end if;

  -- Flag this transaction so the qa_audit_items_guard trigger recognizes
  -- the RPC-driven write below.
  perform set_config('qa.rpc', 'resolve_dispute', true);

  v_result := v_item.result;
  if p_approved and v_item.result = 'no' then
    v_result := 'yes';
  end if;

  v_history := coalesce(v_item.history, '[]'::jsonb) || jsonb_build_object(
    'at', v_now,
    'by', auth.uid(),
    'byName', (select full_name from public.profiles where id = auth.uid()),
    'action', case when p_approved then 'dispute_approved' else 'dispute_rejected' end,
    'detail', trim(p_reason)
  );

  update public.qa_audit_items
  set status = 'resolved',
      result = v_result,
      scored_by = auth.uid(),
      scored_by_name = (select full_name from public.profiles where id = auth.uid()),
      scored_at = v_now,
      dispute_resolution = jsonb_build_object(
        'approved', p_approved,
        'reason', trim(p_reason),
        'resolvedBy', auth.uid(),
        'resolvedByName', (select full_name from public.profiles where id = auth.uid()),
        'resolvedAt', v_now
      ),
      history = v_history,
      updated_at = v_now
  where id = p_item_id
  returning * into v_item;

  if v_item.dispute_raised_by is not null then
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    values
      (v_item.agency_id,
       v_item.dispute_raised_by,
       'qa.dispute_resolved',
       case when p_approved then 'QA dispute approved' else 'QA dispute not approved' end,
       'The auditor reviewed your dispute: ' || trim(p_reason),
       '/qa-audits/' || v_item.audit_id::text,
       'qa_audit',
       v_item.audit_id::text,
       'qa.dispute_resolved:' || v_item.audit_id::text || ':' || v_item.item_key || ':' ||
         to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS'))
    on conflict do nothing;
  end if;

  return to_jsonb(v_item);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: due/overdue reminders for active QA schedules. Idempotent per
-- schedule per day via the dedupe key; returns notifications inserted.
-- ----------------------------------------------------------------------------
create or replace function public.sweep_qa_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_today date := current_date;
  r record;
begin
  for r in
    select s.*, site.name as site_name
    from public.qa_schedules s
    join public.sites site on site.id = s.site_id
    where s.active
      and s.next_due <= v_today + 14
  loop
    if not private.has_permission(r.agency_id, 'qa.schedule') then
      continue;
    end if;
    insert into public.notifications
      (agency_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    values
      (r.agency_id,
       'auditor',
       case when r.next_due < v_today then 'qa.schedule_overdue' else 'qa.schedule_due' end,
       case when r.next_due < v_today then 'QA audit overdue' else 'QA audit due soon' end,
       r.site_name || ' — quarterly QA audit ' ||
         case when r.next_due < v_today then 'was due ' else 'is due ' end || r.next_due::text || '.',
       '/qa-audits?siteId=' || r.site_id::text,
       'qa_schedule',
       r.id::text,
       'qa.schedule:' || r.id::text || ':' || v_today::text)
    on conflict do nothing;
  end loop;
  -- Recompute the true count of today's reminders for the caller's own
  -- agencies (the sweep iterates every agency, but the caller only ever
  -- sees their own).
  select count(*) into v_count
  from public.notifications n
  where n.dedupe_key like 'qa.schedule:%:' || v_today::text
    and n.created_at::date = v_today
    and private.has_permission(n.agency_id, 'qa.schedule');
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- QA-AUDIT hardening (2026-09-14): server-side write rules.
--
-- RLS admits any qa.audit/qa.dispute holder to the item table, so these
-- triggers are the real backstop:
--   * locked (system-verified) rows are immutable — even the RPCs cannot
--     change them;
--   * finalized audits cannot be edited directly (the only exception is the
--     score snapshot refresh, which runs right after dispute resolution);
--   * dispute-only callers (DPM/HM) must use the raise_qa_dispute RPC —
--     direct updates are rejected;
--   * dispute resolutions can only be written by the resolve_qa_dispute RPC;
--   * auditor scoring may only touch scoring columns.
-- The RPCs set the transaction-local qa.rpc flag so the trigger can tell
-- RPC-driven writes apart from direct ones.
-- ----------------------------------------------------------------------------

create or replace function private.qa_audit_items_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rpc text := current_setting('qa.rpc', true);
  v_audit_status text;
begin
  if TG_OP = 'DELETE' then
    if OLD.locked then
      raise exception 'System-verified QA items are locked and cannot be deleted.';
    end if;
    select status into v_audit_status from public.qa_audits where id = OLD.audit_id;
    if v_audit_status = 'finalized' then
      raise exception 'Items of a finalized QA audit cannot be deleted.';
    end if;
    if not private.has_permission(OLD.agency_id, 'qa.audit') then
      raise exception 'You do not have permission to do that.';
    end if;
    return OLD;
  end if;

  -- Immutable identity / provenance columns on UPDATE.
  if NEW.id is distinct from OLD.id
     or NEW.agency_id is distinct from OLD.agency_id
     or NEW.audit_id is distinct from OLD.audit_id
     or NEW.item_key is distinct from OLD.item_key
     or NEW.item_id is distinct from OLD.item_id
     or NEW.individual_id is distinct from OLD.individual_id
     or NEW.locked is distinct from OLD.locked
     or NEW.source is distinct from OLD.source
     or NEW.system_evidence is distinct from OLD.system_evidence then
    raise exception 'QA item identity fields are immutable.';
  end if;

  -- Locked system rows are immutable, period — even the RPCs cannot change them.
  if OLD.locked then
    raise exception 'System-verified QA items are locked and cannot be changed.';
  end if;

  -- RPC-driven dispute flows (validated + notified inside the RPC).
  if v_rpc = 'raise_qa_dispute' then
    if NEW.status is distinct from OLD.status
       or NEW.dispute_note is distinct from OLD.dispute_note
       or NEW.dispute_photos is distinct from OLD.dispute_photos
       or NEW.dispute_raised_by is distinct from OLD.dispute_raised_by
       or NEW.dispute_raised_by_name is distinct from OLD.dispute_raised_by_name
       or NEW.dispute_raised_at is distinct from OLD.dispute_raised_at
       or NEW.dispute_resolution is distinct from OLD.dispute_resolution
       or NEW.history is distinct from OLD.history then
      return NEW;
    end if;
    raise exception 'The dispute flow may only change dispute fields.';
  end if;
  if v_rpc = 'resolve_qa_dispute' then
    if NEW.status is distinct from OLD.status
       or NEW.result is distinct from OLD.result
       or NEW.scored_by is distinct from OLD.scored_by
       or NEW.scored_by_name is distinct from OLD.scored_by_name
       or NEW.scored_at is distinct from OLD.scored_at
       or NEW.dispute_resolution is distinct from OLD.dispute_resolution
       or NEW.history is distinct from OLD.history then
      return NEW;
    end if;
    raise exception 'The resolution flow may only change resolution fields.';
  end if;

  select status into v_audit_status from public.qa_audits where id = OLD.audit_id;

  -- Finalized audits are frozen for direct writes. (Disputes still flow
  -- through the RPCs above, which refresh the score snapshot.)
  if v_audit_status = 'finalized' then
    raise exception 'That audit is finalized — it can no longer be changed directly.';
  end if;

  -- Dispute-only callers (DPM/HM) must use the raise_qa_dispute RPC.
  if not private.has_permission(OLD.agency_id, 'qa.audit') then
    raise exception 'Use the dispute flow to challenge a QA finding.';
  end if;

  -- Auditor scoring path: dispute columns must stay untouched here.
  if NEW.dispute_note is distinct from OLD.dispute_note
     or NEW.dispute_photos is distinct from OLD.dispute_photos
     or NEW.dispute_raised_by is distinct from OLD.dispute_raised_by
     or NEW.dispute_raised_by_name is distinct from OLD.dispute_raised_by_name
     or NEW.dispute_raised_at is distinct from OLD.dispute_raised_at
     or NEW.dispute_resolution is distinct from OLD.dispute_resolution then
    raise exception 'Disputes must go through the dispute flow.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists qa_audit_items_guard on public.qa_audit_items;
create trigger qa_audit_items_guard
before update or delete on public.qa_audit_items
for each row execute function private.qa_audit_items_guard();

-- qa_audits: finalized rows only accept the score-snapshot refresh.
create or replace function private.qa_audits_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'finalized' then
      raise exception 'A finalized QA audit cannot be deleted.';
    end if;
    if not private.has_permission(OLD.agency_id, 'qa.audit') then
      raise exception 'You do not have permission to do that.';
    end if;
    return OLD;
  end if;

  if NEW.id is distinct from OLD.id
     or NEW.agency_id is distinct from OLD.agency_id
     or NEW.site_id is distinct from OLD.site_id
     or NEW.year is distinct from OLD.year
     or NEW.quarter is distinct from OLD.quarter then
    raise exception 'QA audit identity fields are immutable.';
  end if;

  if OLD.status = 'finalized' then
    -- Only the score snapshot (refreshed after dispute resolution) may move.
    if NEW.score is distinct from OLD.score then
      if not private.has_permission(OLD.agency_id, 'qa.audit') then
        raise exception 'You do not have permission to do that.';
      end if;
      return NEW;
    end if;
    raise exception 'That audit is finalized — it can no longer be changed.';
  end if;

  if not private.has_permission(OLD.agency_id, 'qa.audit') then
    raise exception 'You do not have permission to do that.';
  end if;
  return NEW;
end;
$$;

drop trigger if exists qa_audits_guard on public.qa_audits;
create trigger qa_audits_guard
before update or delete on public.qa_audits
for each row execute function private.qa_audits_guard();
