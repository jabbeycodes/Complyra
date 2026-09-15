-- Child records and definer RPCs inherit the individual's access boundary.
create or replace function private.can_read_document_upload(p_agency uuid, p_upload uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from document_uploads u where u.id=p_upload and u.agency_id=p_agency
    and private.can_read_individual(u.agency_id,u.individual_id));
$$;
create or replace function private.can_read_extraction(p_agency uuid, p_extraction uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from document_extractions e where e.id=p_extraction and e.agency_id=p_agency
    and private.can_read_document_upload(e.agency_id,e.upload_id));
$$;
create or replace function private.can_read_delegation(p_agency uuid, p_assignment uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from individual_delegation_assignments a where a.id=p_assignment and a.agency_id=p_agency
    and private.can_read_individual(a.agency_id,a.individual_id));
$$;
create policy extraction_parent_scope on public.document_extractions as restrictive for select to authenticated
using(private.can_read_document_upload(agency_id,upload_id));
create policy trackable_parent_scope on public.document_trackable_items as restrictive for select to authenticated
using(private.can_read_extraction(agency_id,extraction_id));
create policy document_log_parent_scope on public.document_audit_log as restrictive for select to authenticated
using(upload_id is null or private.can_read_document_upload(agency_id,upload_id));
create policy delegation_material_parent_scope on public.delegation_training_materials as restrictive for select to authenticated
using(private.can_read_delegation(agency_id,assignment_id));
create policy delegation_ack_parent_scope on public.delegation_acknowledgments as restrictive for select to authenticated
using(private.can_read_delegation(agency_id,assignment_id));

-- Common templates have no tenant; retain their intended read access.
drop policy audit_active_membership on public.delegation_templates;
create policy audit_active_membership on public.delegation_templates as restrictive for all to authenticated
using(agency_id is null or private.has_agency(agency_id))
with check(agency_id is null or private.has_agency(agency_id));

-- Staff can see approved tasks without gaining access to the raw extraction.
drop policy document_trackable_items_select on public.document_trackable_items;
create policy document_trackable_items_select on public.document_trackable_items for select to authenticated
using(private.has_permission(agency_id,'documents.review') or
 (private.has_permission(agency_id,'documents.view') and status in ('approved','activated')
  and private.can_read_extraction(agency_id,extraction_id)));

-- A storage path alone must never grant access to another person's raw plan.
drop policy pcsp_documents_storage_select on storage.objects;
create policy pcsp_documents_storage_select on storage.objects for select to authenticated
using(bucket_id='pcsp-documents' and exists(
 select 1 from public.document_uploads u where u.storage_path=name
  and private.has_permission(u.agency_id,'documents.review')
  and private.can_read_individual(u.agency_id,u.individual_id)
));

create or replace function private.guard_care_pipeline_scope()
returns trigger language plpgsql security definer set search_path=public as $$
declare allowed boolean := false;
begin
  if tg_table_name in ('document_uploads','individual_delegation_assignments') then
    if not exists(select 1 from individuals i where i.id=new.individual_id
      and i.agency_id=new.agency_id and i.site_id=new.site_id) then
      raise exception 'The individual does not belong to this site.';
    end if;
    allowed := private.can_read_individual(new.agency_id,new.individual_id);
  elsif tg_table_name in ('delegation_training_materials','delegation_acknowledgments') then
    allowed := private.can_read_delegation(new.agency_id,new.assignment_id);
  elsif tg_table_name='site_delegation_activations' then
    allowed := private.can_read_site(new.agency_id,new.site_id);
  elsif tg_table_name in ('document_extractions','document_audit_log') then
    allowed := (new.upload_id is null and private.has_agency(new.agency_id)) or
      private.can_read_document_upload(new.agency_id,new.upload_id);
  elsif tg_table_name='document_trackable_items' then
    allowed := private.can_read_extraction(new.agency_id,new.extraction_id);
  end if;
  if auth.role()='authenticated' and not coalesce(allowed,false) then
    raise exception 'This record is outside your assigned access.';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['document_uploads','document_extractions','document_trackable_items','document_audit_log',
    'site_delegation_activations','individual_delegation_assignments','delegation_training_materials','delegation_acknowledgments'] loop
    execute format('create trigger care_pipeline_scope before insert or update on public.%I for each row execute function private.guard_care_pipeline_scope()',t);
  end loop;
end;
$$;

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
  if not private.can_read_delegation(v_mat.agency_id, v_mat.assignment_id) then
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
