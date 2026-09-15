-- site_facts is keyed by site_id (no id column). The PHI audit trigger
-- wrote record_id from NEW.id, so every site_facts insert failed and hosted
-- Cedar/Willow never received city/zip after the #58 rename.

create or replace function private.phi_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row jsonb;
  v_action text;
  v_agency uuid;
  v_individual uuid;
  v_headers jsonb;
  v_ip text;
  v_ua text;
  v_record uuid;
begin
  if TG_OP = 'INSERT' then
    v_row := row_to_json(NEW);
    v_action := 'create';
  elsif TG_OP = 'UPDATE' then
    v_row := row_to_json(NEW);
    v_action := 'update';
  else
    v_row := row_to_json(OLD);
    v_action := 'delete';
  end if;

  v_agency := (v_row->>'agency_id')::uuid;
  if v_agency is null then
    raise exception 'phi_access_log: % row has no agency_id', TG_TABLE_NAME;
  end if;
  v_individual := nullif(v_row->>'individual_id', '')::uuid;
  v_record := coalesce(
    nullif(v_row->>'id', '')::uuid,
    nullif(v_row->>'site_id', '')::uuid
  );
  if v_record is null then
    raise exception 'phi_access_log: % row has no id or site_id', TG_TABLE_NAME;
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    v_ip := v_headers->>'x-forwarded-for';
    v_ua := v_headers->>'user-agent';
  exception when others then
    v_ip := null;
    v_ua := null;
  end;

  insert into public.phi_access_log (
    agency_id, user_id, action, record_type, record_id, individual_id,
    ip_address, user_agent, details
  ) values (
    v_agency,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_record,
    v_individual,
    v_ip,
    v_ua,
    jsonb_build_object(
      'source', case when auth.uid() is null then 'service' else 'client' end,
      'table', TG_TABLE_NAME
    )
  );
  return coalesce(NEW, OLD);
end;
$$;
