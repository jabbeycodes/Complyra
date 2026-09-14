-- ============================================================================
-- PCSP EXTRACTION PIPELINE (2026-09-14)
-- Branch: w/backend. NOT APPLIED TO HOSTED SUPABASE.
-- Do not apply without Joshua's explicit production approval.
--
-- Workflow:
--   1. An administrator or DPM uploads a PCSP (or annual physician order)
--      PDF through the client. The file goes to the `pcsp-documents` storage
--      bucket (private); register_document_upload() records the metadata row
--      (status 'uploaded') and logs the audit event.
--   2. The client invokes the `extract-pcsp` edge function, which calls the
--      Gemini API (key from env ONLY, never stored) with a strict JSON
--      responseSchema, validates the output, and records it through
--      mark_extraction_complete() (service role): one document_extractions
--      row + one document_trackable_items row per proposed item, and the
--      upload moves to 'extracted'.
--   3. A DPM/RN (documents.review) edits proposals with
--      update_trackable_item() ('proposed' -> 'edited'), then approves the
--      whole extraction with approve_extraction(): NOTHING is tracked before
--      this call (status 'approved' on the upload and its items).
--   4. Each approved item is activated individually with
--      activate_trackable_item(). A 'protocol_needs_delegation' item hands
--      off into the delegation system: the function ensures an agency
--      delegation template for the protocol, activates it for the site,
--      assigns it to the individual, and creates the editable training draft
--      (the same draft -> review -> approve -> publish loop as templates).
--      Other item types simply become 'activated' trackable records.
--   5. reject_upload() retires an upload that should never be tracked.
--
-- Security model:
--   - No INSERT/UPDATE/DELETE table policies on the five new tables: every
--     write goes through the SECURITY DEFINER RPCs below.
--   - SELECT policies: reviewers (documents.review) see uploads, extractions,
--     items, and the audit log in their agency scope. Ordinary staff
--     (documents.view) see ONLY approved/activated results for their site(s);
--     they never see raw uploads or extractions.
--   - The Gemini API key lives ONLY as a Supabase function secret
--     (GEMINI_API_KEY). agency_ai_settings stores the enabled flag + model
--     name + key_last_verified_at — there is deliberately no key column.
--   - AI processing is OFF by default (ai_processing_enabled = false). The
--     edge function refuses to call Gemini until an administrator flips the
--     flag, which is the point where a BAA with Google must be in place.
--     See docs/ai-model-settings.md.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Tables
-- --------------------------------------------------------------------------

create table if not exists public.document_uploads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  individual_id uuid not null,
  site_id uuid not null,
  document_type text not null
    check (document_type in ('pcsp', 'annual_physician_order')),
  original_filename text not null,
  mime_type text not null default 'application/pdf',
  storage_path text not null,
  uploaded_by uuid null references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'extracting', 'extracted', 'in_review',
                      'approved', 'activated', 'rejected')),
  unique (id, agency_id),
  foreign key (individual_id, agency_id) references public.individuals (id, agency_id) on delete cascade,
  foreign key (site_id, agency_id) references public.sites (id, agency_id) on delete cascade
);

create index if not exists document_uploads_agency_idx
  on public.document_uploads (agency_id, status);
create index if not exists document_uploads_individual_idx
  on public.document_uploads (individual_id);

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  upload_id uuid not null unique,
  schema_version int not null default 1,
  extracted_data jsonb not null default '{}'::jsonb,
  confidence jsonb not null default '{}'::jsonb,
  model text not null default 'gemini-2.5-flash',
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (upload_id, agency_id)
    references public.document_uploads (id, agency_id) on delete cascade
);

create table if not exists public.document_trackable_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  extraction_id uuid not null,
  item_type text not null
    check (item_type in ('deadline', 'training_requirement',
                        'protocol_needs_delegation', 'physician_order',
                        'missing_signature', 'other')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  due_date date null,
  confidence numeric null check (confidence is null or (confidence >= 0 and confidence <= 1)),
  needs_human_check boolean not null default false,
  status text not null default 'proposed'
    check (status in ('proposed', 'edited', 'approved', 'activated', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (extraction_id, agency_id)
    references public.document_extractions (id, agency_id) on delete cascade
);

create index if not exists document_trackable_items_extraction_idx
  on public.document_trackable_items (extraction_id, status);

create table if not exists public.document_audit_log (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  upload_id uuid null,
  actor uuid null references public.profiles (id) on delete set null,
  action text not null,
  at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  foreign key (upload_id, agency_id)
    references public.document_uploads (id, agency_id) on delete cascade
);

create index if not exists document_audit_log_upload_idx
  on public.document_audit_log (upload_id, at desc);

-- AI settings: enabled flag + model + verification timestamp. There is
-- deliberately NO key column — the key lives only as a function secret.
create table if not exists public.agency_ai_settings (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  ai_processing_enabled boolean not null default false,
  model text not null default 'gemini-2.5-flash',
  key_last_verified_at timestamptz null
);

-- --------------------------------------------------------------------------
-- RLS
-- --------------------------------------------------------------------------

alter table public.document_uploads enable row level security;
alter table public.document_uploads force row level security;
alter table public.document_extractions enable row level security;
alter table public.document_extractions force row level security;
alter table public.document_trackable_items enable row level security;
alter table public.document_trackable_items force row level security;
alter table public.document_audit_log enable row level security;
alter table public.document_audit_log force row level security;
alter table public.agency_ai_settings enable row level security;
alter table public.agency_ai_settings force row level security;

-- Uploads: reviewers see everything in their agency. Ordinary staff see only
-- approved/activated uploads at their own site(s).
drop policy if exists document_uploads_select on public.document_uploads;
create policy document_uploads_select on public.document_uploads
for select to authenticated
using (
  (select private.has_permission(agency_id, 'documents.review'))
  or (
    (select private.has_permission(agency_id, 'documents.view'))
    and status in ('approved', 'activated')
    and (select private.has_site(agency_id, site_id))
  )
);

-- Extractions (raw AI output): reviewers only. Ordinary staff never see
-- raw extraction data — only the approved/activated trackable items.
drop policy if exists document_extractions_select on public.document_extractions;
create policy document_extractions_select on public.document_extractions
for select to authenticated
using ((select private.has_permission(agency_id, 'documents.review')));

-- Trackable items: reviewers see all in agency. Ordinary staff see
-- approved/activated items for their site(s) — looked up through the
-- extraction -> upload chain.
drop policy if exists document_trackable_items_select on public.document_trackable_items;
create policy document_trackable_items_select on public.document_trackable_items
for select to authenticated
using (
  (select private.has_permission(agency_id, 'documents.review'))
  or (
    (select private.has_permission(agency_id, 'documents.view'))
    and document_trackable_items.status in ('approved', 'activated')
    and exists (
      select 1
      from public.document_extractions e
      join public.document_uploads u
        on u.id = e.upload_id and u.agency_id = document_trackable_items.agency_id
      where e.id = document_trackable_items.extraction_id
        and (select private.has_site(document_trackable_items.agency_id, u.site_id))
    )
  )
);

-- Audit log: reviewers only.
drop policy if exists document_audit_log_select on public.document_audit_log;
create policy document_audit_log_select on public.document_audit_log
for select to authenticated
using ((select private.has_permission(agency_id, 'documents.review')));

-- AI settings: agency members may read (it carries no secret); writes are
-- RPC-only through set_agency_ai_settings (roles.manage-gated).
drop policy if exists agency_ai_settings_select on public.agency_ai_settings;
create policy agency_ai_settings_select on public.agency_ai_settings
for select to authenticated
using ((select private.has_agency(agency_id)));

-- No INSERT/UPDATE/DELETE policies: every write goes through the
-- SECURITY DEFINER RPCs below.

-- --------------------------------------------------------------------------
-- Storage bucket (private): pcsp-documents/<agency_id>/<upload_id>/<filename>
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pcsp-documents',
  'pcsp-documents',
  false,
  15728640,
  array['application/pdf', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

-- Read: agency members holding documents.view (covers reviewers, who hold
-- documents.review? no — view is separate, so check both) scoped to the
-- agency prefix in the object path.
drop policy if exists pcsp_documents_storage_select on storage.objects;
create policy pcsp_documents_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'pcsp-documents'
  and (
    select private.has_permission((storage.foldername(name))[1]::uuid, 'documents.view')
  )
);

-- Insert: agency members holding documents.upload.
drop policy if exists pcsp_documents_storage_insert on storage.objects;
create policy pcsp_documents_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'pcsp-documents'
  and (
    select private.has_permission((storage.foldername(name))[1]::uuid, 'documents.upload')
  )
);

-- No update/delete policies: documents are immutable once uploaded. A new
-- upload is a new row + new object (reject_upload() retires the metadata).

-- --------------------------------------------------------------------------
-- Write RPCs (SECURITY DEFINER). Each returns a single JSON object.
-- --------------------------------------------------------------------------

-- Step 1: register the upload after the client stored the file.
-- Notify every active member holding a permission at a site (agency-wide
-- memberships with no site are included). One row per member; idempotent
-- via the per-member dedupe key.
create or replace function private.notify_permission_holders(
  p_agency_id uuid,
  p_site_id uuid,
  p_permission text,
  p_type text,
  p_title text,
  p_body text,
  p_deep_link text,
  p_entity_type text,
  p_entity_id text,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link,
     entity_type, entity_id, dedupe_key)
  select distinct
    p_agency_id,
    m.user_id,
    p_type,
    p_title,
    p_body,
    p_deep_link,
    p_entity_type,
    p_entity_id,
    p_dedupe_key || ':' || m.user_id::text
  from public.memberships m
  join public.agency_roles ar
    on ar.agency_id = m.agency_id
   and ar.template_key = coalesce(m.role_key, m.role::text)
  where m.agency_id = p_agency_id
    and (p_site_id is null or m.site_id = p_site_id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= current_date)
    and coalesce((ar.permissions ->> p_permission)::boolean, false)
  on conflict (agency_id, dedupe_key) do nothing;
end;
$$;

create or replace function public.register_document_upload(
  p_agency_id uuid,
  p_individual_id uuid,
  p_document_type text,
  p_original_filename text,
  p_storage_path text,
  -- Site is optional: when null/omitted the server falls back to the
  -- individual's assigned site. Defaulted parameters are grouped after the
  -- required ones so positional calls remain unambiguous.
  p_site_id uuid default null,
  p_mime_type text default 'application/pdf',
  -- Optional client-generated id so the caller can derive the storage path
  -- (<agency_id>/<upload_id>/<filename>) before uploading the file.
  p_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.document_uploads%rowtype;
  v_site_id uuid;
begin
  if p_document_type not in ('pcsp', 'annual_physician_order') then
    raise exception 'Unknown document type.';
  end if;
  if not private.has_permission(p_agency_id, 'documents.upload') then
    raise exception 'You do not have permission to do that.';
  end if;
  -- The site defaults to the individual's site so upload clients that only
  -- know the individual (e.g. the upload card) don't need a site picker.
  select i.site_id into v_site_id from public.individuals i
  where i.id = p_individual_id and i.agency_id = p_agency_id;
  if v_site_id is null then
    raise exception 'Individual not found.';
  end if;
  if p_site_id is not null then
    if not exists (
      select 1 from public.sites s
      where s.id = p_site_id and s.agency_id = p_agency_id
    ) then
      raise exception 'Site not found.';
    end if;
    v_site_id := p_site_id;
  end if;
  if p_original_filename is null or btrim(p_original_filename) = '' then
    raise exception 'A filename is required.';
  end if;

  insert into public.document_uploads
    (id, agency_id, individual_id, site_id, document_type, original_filename,
     mime_type, storage_path, uploaded_by, status)
  values
    (coalesce(p_id, gen_random_uuid()), p_agency_id, p_individual_id, v_site_id,
     p_document_type,
     btrim(p_original_filename), coalesce(p_mime_type, 'application/pdf'),
     p_storage_path, auth.uid(), 'uploaded')
  returning * into v_row;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    p_agency_id, v_row.id, auth.uid(), 'upload',
    jsonb_build_object('document_type', p_document_type,
                       'filename', p_original_filename)
  );

  return to_jsonb(v_row);
end;
$$;

-- Step 2: record the AI extraction. Called ONLY by the extract-pcsp edge
-- function with the service role — never by client sessions.
create or replace function public.mark_extraction_complete(
  p_upload_id uuid,
  p_extracted_data jsonb,
  p_confidence jsonb,
  p_model text,
  p_items jsonb,
  p_schema_version int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload public.document_uploads%rowtype;
  v_extraction public.document_extractions%rowtype;
  v_item jsonb;
  v_count int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Extraction completion is server-side only.';
  end if;

  select * into v_upload from public.document_uploads where id = p_upload_id;
  if v_upload.id is null then
    raise exception 'Upload not found.';
  end if;

  insert into public.document_extractions
    (agency_id, upload_id, schema_version, extracted_data, confidence, model)
  values
    (v_upload.agency_id, v_upload.id, coalesce(p_schema_version, 1),
     coalesce(p_extracted_data, '{}'::jsonb), coalesce(p_confidence, '{}'::jsonb),
     coalesce(p_model, 'gemini-2.5-flash'))
  returning * into v_extraction;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.document_trackable_items
      (agency_id, extraction_id, item_type, title, detail, due_date,
       confidence, needs_human_check, status)
    values (
      v_upload.agency_id,
      v_extraction.id,
      coalesce(v_item ->> 'item_type', 'other'),
      coalesce(v_item ->> 'title', 'Untitled item'),
      coalesce(v_item -> 'detail', '{}'::jsonb),
      nullif(v_item ->> 'due_date', '')::date,
      nullif(v_item ->> 'confidence', '')::numeric,
      coalesce((v_item ->> 'needs_human_check')::boolean, false),
      'proposed'
    );
    v_count := v_count + 1;
  end loop;

  update public.document_uploads
  set status = 'extracted'
  where id = v_upload.id;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_upload.agency_id, v_upload.id, null, 'extraction_complete',
    jsonb_build_object('model', coalesce(p_model, 'gemini-2.5-flash'),
                       'item_count', v_count,
                       'schema_version', coalesce(p_schema_version, 1))
  );

  -- Reviewers at the site get a bell notification: nothing is tracked yet.
  perform private.notify_permission_holders(
    v_upload.agency_id, v_upload.site_id, 'documents.review',
    'document.extraction_ready',
    'Extraction ready for review',
    v_upload.original_filename || ' for ' ||
      coalesce((select i.full_name from public.individuals i
                where i.id = v_upload.individual_id), 'the individual') ||
      ' finished extraction — review the proposed items before anything is tracked.',
    '/documents/extractions/' || v_upload.id::text,
    'document_upload', v_upload.id::text,
    'document.extraction_ready:' || v_upload.id::text
  );

  return jsonb_build_object(
    'extraction', to_jsonb(v_extraction),
    'item_count', v_count
  );
end;
$$;

-- Step 3: a reviewer edits a proposed item. Nothing becomes tracked by
-- editing — it stays 'edited' until approve_extraction() runs.
create or replace function public.update_trackable_item(
  p_item_id uuid,
  p_title text,
  p_detail jsonb,
  p_due_date date,
  p_needs_human_check boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.document_trackable_items%rowtype;
  v_row public.document_trackable_items%rowtype;
begin
  select * into v_item from public.document_trackable_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Trackable item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status not in ('proposed', 'edited') then
    raise exception 'Only proposed or edited items can be edited.';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A title is required.';
  end if;

  update public.document_trackable_items
  set title = btrim(p_title),
      detail = coalesce(p_detail, '{}'::jsonb),
      due_date = p_due_date,
      needs_human_check = coalesce(p_needs_human_check, false),
      status = 'edited',
      updated_at = now()
  where id = p_item_id
  returning * into v_row;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_item.agency_id,
    (select upload_id from public.document_extractions where id = v_item.extraction_id),
    auth.uid(), 'item_edited',
    jsonb_build_object('item_id', p_item_id, 'title', btrim(p_title))
  );

  return to_jsonb(v_row);
end;
$$;

-- Step 4: approve the whole extraction. This is the gate: NOTHING is tracked
-- before this call. Moves upload 'extracted'/'in_review' -> 'approved' and
-- its proposed/edited items -> 'approved'.
create or replace function public.approve_extraction(
  p_upload_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload public.document_uploads%rowtype;
  v_extraction public.document_extractions%rowtype;
  v_count int;
begin
  select * into v_upload from public.document_uploads where id = p_upload_id;
  if v_upload.id is null then
    raise exception 'Upload not found.';
  end if;
  if not private.has_permission(v_upload.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_upload.status not in ('extracted', 'in_review') then
    raise exception 'Only extracted or in-review uploads can be approved.';
  end if;

  select * into v_extraction
  from public.document_extractions
  where upload_id = v_upload.id;
  if v_extraction.id is null then
    raise exception 'No extraction recorded for this upload.';
  end if;

  update public.document_trackable_items
  set status = 'approved', updated_at = now()
  where extraction_id = v_extraction.id
    and status in ('proposed', 'edited');
  get diagnostics v_count = row_count;

  update public.document_uploads
  set status = 'approved'
  where id = v_upload.id;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_upload.agency_id, v_upload.id, auth.uid(), 'extraction_approved',
    jsonb_build_object('item_count', v_count)
  );

  -- Reviewers at the site get a bell notification: items are now eligible
  -- for one-by-one activation (staff still see nothing until activation).
  perform private.notify_permission_holders(
    v_upload.agency_id, v_upload.site_id, 'documents.review',
    'document.extraction_approved',
    'Extraction approved',
    v_count || ' item(s) from ' || v_upload.original_filename ||
      ' are ready to activate.',
    '/documents/extractions/' || v_upload.id::text,
    'document_upload', v_upload.id::text,
    'document.extraction_approved:' || v_upload.id::text
  );

  return jsonb_build_object(
    'upload_id', v_upload.id,
    'status', 'approved',
    'item_count', v_count
  );
end;
$$;

-- Step 5: activate a single approved item. For protocol_needs_delegation,
-- this hands off into the delegation system: ensure an agency delegation
-- template for the protocol, activate it for the site, assign it to the
-- individual, and create the editable training draft (same draft ->
-- review -> approve -> publish loop as templates). Items that need no
-- delegation simply become 'activated' trackable records.
create or replace function public.activate_trackable_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.document_trackable_items%rowtype;
  v_upload public.document_uploads%rowtype;
  v_extraction public.document_extractions%rowtype;
  v_individual public.individuals%rowtype;
  v_site public.sites%rowtype;
  v_protocol_name text;
  v_template public.delegation_templates%rowtype;
  v_activation public.site_delegation_activations%rowtype;
  v_assignment public.individual_delegation_assignments%rowtype;
  v_material public.delegation_training_materials%rowtype;
  v_draft jsonb;
  v_mark text := 'Digital record generated by Complyrer.';
begin
  select * into v_item from public.document_trackable_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Trackable item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status <> 'approved' then
    raise exception 'Only approved items can be activated.';
  end if;

  select * into v_extraction
  from public.document_extractions where id = v_item.extraction_id;
  select * into v_upload
  from public.document_uploads where id = v_extraction.upload_id;
  select * into v_individual
  from public.individuals
  where id = v_upload.individual_id and agency_id = v_upload.agency_id;
  select * into v_site
  from public.sites
  where id = v_upload.site_id and agency_id = v_upload.agency_id;

  -- Protocol handoff into the delegation system.
  if v_item.item_type = 'protocol_needs_delegation' then
    v_protocol_name := coalesce(
      nullif(btrim(v_item.detail ->> 'protocol_name'), ''),
      nullif(btrim(v_item.title), ''),
      'PCSP protocol'
    );

    -- 1. Ensure an agency delegation template for this protocol (reuse an
    --    existing active one with the same name, or seed a new one from
    --    the extracted detail).
    select * into v_template
    from public.delegation_templates t
    where t.agency_id = v_item.agency_id
      and t.active
      and lower(btrim(t.name)) = lower(btrim(v_protocol_name))
    limit 1;

    if v_template.id is null then
      insert into public.delegation_templates
        (agency_id, name, category, sections, individualization_note, active)
      values (
        v_item.agency_id,
        v_protocol_name,
        coalesce(nullif(btrim(v_item.detail ->> 'category'), ''), 'PCSP'),
        jsonb_build_object(
          'purpose', coalesce(v_item.detail ->> 'description',
                              v_item.detail ->> 'support_strategies', ''),
          'steps', coalesce(v_item.detail -> 'support_strategies', '[]'::jsonb),
          'safetyWarnings', coalesce(v_item.detail -> 'safety_warnings', '[]'::jsonb),
          'documentation', coalesce(v_item.detail -> 'documentation', '[]'::jsonb)
        ),
        'Seeded from PCSP extraction on ' || to_char(now(), 'YYYY-MM-DD') ||
          '. Individualize before publication. ' || v_mark,
        true
      )
      returning * into v_template;
    end if;

    -- 2. Activate for the site (reactivate if previously deactivated).
    update public.site_delegation_activations
    set status = 'active', activated_at = now(), activated_by = auth.uid()
    where template_id = v_template.id
      and site_id = v_site.id
      and status = 'deactivated'
    returning * into v_activation;

    if not found then
      insert into public.site_delegation_activations
        (agency_id, template_id, site_id, status, activated_by)
      values (v_item.agency_id, v_template.id, v_site.id, 'active', auth.uid())
      on conflict do nothing;
      select * into v_activation
      from public.site_delegation_activations
      where template_id = v_template.id
        and site_id = v_site.id
        and status = 'active'
      limit 1;
    end if;

    -- 3. Assign to the individual (reuse an active assignment).
    select * into v_assignment
    from public.individual_delegation_assignments
    where activation_id = v_activation.id
      and individual_id = v_individual.id
      and status = 'assigned'
    limit 1;

    if v_assignment.id is null then
      insert into public.individual_delegation_assignments
        (agency_id, activation_id, template_id, individual_id, site_id,
         status, assigned_by)
      values
        (v_item.agency_id, v_activation.id, v_template.id, v_individual.id,
         v_site.id, 'assigned', auth.uid())
      returning * into v_assignment;
    end if;

    -- 4. Create the editable training draft (reuse an existing one).
    select * into v_material
    from public.delegation_training_materials
    where assignment_id = v_assignment.id
    limit 1;

    if v_material.id is null then
      v_draft := jsonb_build_object(
        'templateId', v_template.id,
        'templateName', v_template.name,
        'individualId', v_individual.id,
        'individualName', v_individual.full_name,
        'siteId', v_site.id,
        'siteName', v_site.name,
        'purpose', v_template.sections ->> 'purpose',
        'steps', coalesce(v_template.sections -> 'steps', '[]'::jsonb),
        'safetyWarnings', coalesce(v_template.sections -> 'safetyWarnings', '[]'::jsonb),
        'documentation', coalesce(v_template.sections -> 'documentation', '[]'::jsonb),
        'individualNotes', '',
        'individualizationNote', v_template.individualization_note,
        'sourceTrackableItemId', v_item.id,
        'generatedMark', v_mark
      );

      insert into public.delegation_training_materials
        (agency_id, assignment_id, site_id, status, draft_content)
      values
        (v_item.agency_id, v_assignment.id, v_site.id, 'draft', v_draft)
      returning * into v_material;

      -- Notify reviewers, as assign_delegation() does.
      insert into public.notifications
        (agency_id, user_id, type, title, body, deep_link,
         entity_type, entity_id, dedupe_key)
      select distinct
        v_item.agency_id,
        m.user_id,
        'delegation.review_ready',
        'Delegation ready for review',
        v_template.name || ' was assigned to ' || v_individual.full_name ||
          ' at ' || v_site.name ||
          ' (from PCSP extraction). Review and individualize the training draft.',
        '/delegations/templates',
        'delegation_assignment',
        v_assignment.id::text,
        'pcsp.delegation:' || v_assignment.id::text || ':' || m.user_id::text
      from public.memberships m
      join public.agency_roles ar
        on ar.agency_id = m.agency_id
       and ar.template_key = coalesce(m.role_key, m.role::text)
      where m.agency_id = v_item.agency_id
        and (m.site_id = v_site.id or m.site_id is null)
        and (m.expires_on is null or m.expires_on >= current_date)
        and coalesce((ar.permissions ->> 'delegation.training.review')::boolean, false)
      on conflict (agency_id, dedupe_key) do nothing;
    end if;
  end if;

  update public.document_trackable_items
  set status = 'activated', updated_at = now()
  where id = p_item_id
  returning * into v_item;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_item.agency_id, v_upload.id, auth.uid(), 'item_activated',
    jsonb_build_object(
      'item_id', p_item_id,
      'item_type', v_item.item_type,
      'delegation_assignment_id',
        case when v_item.item_type = 'protocol_needs_delegation'
             then v_assignment.id else null end
    )
  );

  -- The item is now tracked: reviewers at the site get a bell notification.
  -- (Protocol items already notified training reviewers via the delegation
  -- handoff above; this covers the tracking event itself.)
  perform private.notify_permission_holders(
    v_item.agency_id, v_upload.site_id, 'documents.review',
    'document.item_activated',
    'Trackable item activated',
    v_item.title || ' is now tracked.',
    '/documents/extractions/' || v_upload.id::text,
    'document_trackable_item', v_item.id::text,
    'document.item_activated:' || v_item.id::text
  );

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'delegation_assignment_id',
      case when v_item.item_type = 'protocol_needs_delegation'
           then v_assignment.id else null end
  );
end;
$$;

-- Retire an upload that should never be tracked.
create or replace function public.reject_upload(
  p_upload_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upload public.document_uploads%rowtype;
begin
  select * into v_upload from public.document_uploads where id = p_upload_id;
  if v_upload.id is null then
    raise exception 'Upload not found.';
  end if;
  if not private.has_permission(v_upload.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_upload.status in ('approved', 'activated', 'rejected') then
    raise exception 'This upload can no longer be rejected.';
  end if;

  update public.document_uploads
  set status = 'rejected'
  where id = v_upload.id;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_upload.agency_id, v_upload.id, auth.uid(), 'upload_rejected',
    jsonb_build_object('reason', coalesce(p_reason, ''))
  );

  return jsonb_build_object('upload_id', v_upload.id, 'status', 'rejected');
end;
$$;

-- Agency AI settings: model + enabled flag only. The API key is NEVER stored
-- here — it lives only as a Supabase function secret (see
-- docs/ai-model-settings.md). Administrator / compliance_admin only.
create or replace function public.set_agency_ai_settings(
  p_agency_id uuid,
  p_enabled boolean,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.agency_ai_settings%rowtype;
begin
  if not private.has_permission(p_agency_id, 'roles.manage') then
    raise exception 'You do not have permission to do that.';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'A model name is required.';
  end if;

  insert into public.agency_ai_settings
    (agency_id, ai_processing_enabled, model)
  values
    (p_agency_id, coalesce(p_enabled, false), btrim(p_model))
  on conflict (agency_id) do update
  set ai_processing_enabled = coalesce(p_enabled, false),
      model = btrim(p_model)
  returning * into v_row;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    p_agency_id, null, auth.uid(), 'ai_settings_changed',
    jsonb_build_object('enabled', coalesce(p_enabled, false),
                       'model', btrim(p_model))
  );

  return to_jsonb(v_row);
end;
$$;

-- --------------------------------------------------------------------------
-- Reviewer-added items + removal. Added during the lifepath/pcsp-extraction
-- merge: the review UI needs add-new and remove actions on trackable items.
-- --------------------------------------------------------------------------

create or replace function public.add_trackable_item(
  p_extraction_id uuid,
  p_item_type text,
  p_title text,
  p_detail jsonb,
  p_due_date date,
  p_needs_human_check boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extraction public.document_extractions%rowtype;
  v_row public.document_trackable_items%rowtype;
begin
  select * into v_extraction from public.document_extractions where id = p_extraction_id;
  if v_extraction.id is null then
    raise exception 'Extraction not found.';
  end if;
  if not private.has_permission(v_extraction.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if p_item_type not in ('deadline', 'training_requirement',
                        'protocol_needs_delegation', 'physician_order',
                        'missing_signature', 'other') then
    raise exception 'Unknown item type.';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'A title is required.';
  end if;

  insert into public.document_trackable_items
    (agency_id, extraction_id, item_type, title, detail, due_date,
     needs_human_check, status)
  values
    (v_extraction.agency_id, p_extraction_id, p_item_type, btrim(p_title),
     coalesce(p_detail, '{}'::jsonb), p_due_date,
     coalesce(p_needs_human_check, false), 'proposed')
  returning * into v_row;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_extraction.agency_id, v_extraction.upload_id, auth.uid(), 'item_added',
    jsonb_build_object('item_id', v_row.id, 'title', btrim(p_title))
  );

  return to_jsonb(v_row);
end;
$$;

create or replace function public.remove_trackable_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.document_trackable_items%rowtype;
  v_row public.document_trackable_items%rowtype;
begin
  select * into v_item from public.document_trackable_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Trackable item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status not in ('proposed', 'edited') then
    raise exception 'Only proposed or edited items can be removed.';
  end if;

  update public.document_trackable_items
  set status = 'removed',
      updated_at = now()
  where id = p_item_id
  returning * into v_row;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_item.agency_id,
    (select upload_id from public.document_extractions where id = v_item.extraction_id),
    auth.uid(), 'item_removed',
    jsonb_build_object('item_id', p_item_id)
  );

  return to_jsonb(v_row);
end;
$$;

-- --------------------------------------------------------------------------
-- Permission grants: documents.review.
--
--   administrator / compliance_admin: yes
--   degreed_professional_manager / program_manager: yes
--   nurse: yes
--   house_manager / dsp / hr / auditor: no (documents.view only where held)
-- --------------------------------------------------------------------------

update public.agency_roles
set permissions = coalesce(permissions, '{}'::jsonb) || '{"documents.review": true}'::jsonb
where template_key in ('administrator', 'compliance_admin',
                       'degreed_professional_manager', 'program_manager', 'nurse');

-- role_templates mirror so newly provisioned agencies get the key.
update public.role_templates
set permissions = coalesce(permissions, '{}'::jsonb) || '{"documents.review": true}'::jsonb
where key in ('administrator', 'compliance_admin',
              'degreed_professional_manager', 'program_manager', 'nurse');

-- --------------------------------------------------------------------------
-- role_permission_matrix refresh (regen pattern from
-- 20260914040000_permission_source_of_truth.sql): upsert the full snapshot
-- including documents.review so the matrix stays the canonical mirror of
-- src/data/permissions.ts.
-- --------------------------------------------------------------------------

insert into public.role_permission_matrix (role_key, permissions)
values
    ('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":true,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('degreed_professional_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":true}'::jsonb),
    ('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb),
    ('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb),
    ('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"documents.review":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":false,"delegation.assign":false,"delegation.training.review":false,"delegation.training.approve":false,"delegation.acknowledge":false}'::jsonb)
on conflict (role_key) do update
set permissions = excluded.permissions,
    updated_at = now();
