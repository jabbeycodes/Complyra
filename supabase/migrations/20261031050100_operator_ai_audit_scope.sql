-- UNAPPLIED: narrow cross-agency operator metadata evidence exception.
begin;
create or replace function private.guard_care_pipeline_scope()
returns trigger language plpgsql security definer set search_path=public as $$
declare allowed boolean := false;
begin
  -- Only operator administrative AI events may be agency-level without a care upload.
  -- No other table/event bypasses individual/site checks.
  if tg_table_name='document_audit_log' then
    if new.upload_id is null and private.is_platform_admin()
      and new.action in ('ai_settings_changed','ai_policy_acknowledged','ai_service_verified') then
      return new;
    end if;
  end if;
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
commit;
