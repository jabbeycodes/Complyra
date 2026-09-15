-- Preserve signed audit identity even when recalculating its score.
create or replace function private.qa_audits_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not private.has_permission(OLD.agency_id,'qa.audit') then
    raise exception 'You do not have permission to do that.';
  end if;
  if TG_OP='DELETE' then
    if OLD.status='finalized' then raise exception 'A finalized QA audit cannot be deleted.'; end if;
    return OLD;
  end if;
  if NEW.id is distinct from OLD.id or NEW.agency_id is distinct from OLD.agency_id
    or NEW.site_id is distinct from OLD.site_id or NEW.year is distinct from OLD.year
    or NEW.quarter is distinct from OLD.quarter then
    raise exception 'QA audit identity fields are immutable.';
  end if;
  if OLD.status='finalized' then
    if (to_jsonb(NEW)-array['score','updated_at']) is distinct from (to_jsonb(OLD)-array['score','updated_at']) then
      raise exception 'Finalized audit content and signature cannot be changed.';
    end if;
    return NEW;
  end if;
  if NEW.status='finalized' then
    if not exists(select 1 from qa_audit_items where audit_id=OLD.id)
      or exists(select 1 from qa_audit_items where audit_id=OLD.id and (result is null or status='disputed')) then
      raise exception 'Resolve every pending item and dispute before finalizing.';
    end if;
    if nullif(trim(NEW.auditor_signature_name),'') is null or nullif(trim(NEW.auditor_signature_mark),'') is null then
      raise exception 'An auditor signature is required to finalize.';
    end if;
    NEW.auditor_signature_name := (select full_name from profiles where id=auth.uid());
    NEW.auditor_id := auth.uid();
    NEW.signed_at := now();
  end if;
  return NEW;
end $$;
