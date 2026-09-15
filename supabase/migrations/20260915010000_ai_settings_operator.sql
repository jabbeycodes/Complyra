-- AI settings writes are platform-operator only.
-- Agency admins (roles.manage) must not change model/enable or verify Vertex.
-- private.is_platform_admin() reads profiles.platform_admin for auth.uid().

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
  if not private.is_platform_admin() then
    raise exception 'Only the Complyrer operator can manage AI settings.';
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

comment on function public.set_agency_ai_settings(uuid, boolean, text) is
  'Upsert agency AI model/enabled flag. Platform operator only. Never stores credentials.';
