-- UNAPPLIED: explicit operator agency scope; no credential material.
begin;
create or replace function public.operator_ai_settings(p_agency_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s agency_ai_settings%rowtype;
begin
 perform private.require_operator();
 if not exists(select 1 from agencies where id=p_agency_id) then raise exception 'Agency not found.'; end if;
 select * into s from agency_ai_settings where agency_id=p_agency_id;
 return jsonb_build_object('agencyId',p_agency_id,'aiProcessingEnabled',coalesce(s.ai_processing_enabled,false),'model',coalesce(s.model,'gemini-2.5-flash'),'serviceAccountVerifiedAt',s.service_account_verified_at,'vertexProjectId',s.vertex_project_id);
end $$;
create or replace function public.operator_save_ai(p_agency_id uuid,p_model text,p_enabled boolean,p_acknowledged boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 if not exists(select 1 from agencies where id=p_agency_id) then raise exception 'Agency not found.'; end if;
 if p_model is null or length(trim(p_model)) not between 1 and 120 then raise exception 'Enter a model name of at most 120 characters.'; end if;
 if p_enabled and not coalesce(p_acknowledged,false) then raise exception 'Confirm authorization and required agreements before enabling AI processing.'; end if;
 perform public.set_agency_ai_settings(p_agency_id,coalesce(p_enabled,false),trim(p_model));
 insert into document_audit_log(agency_id,actor,action,detail) values(p_agency_id,auth.uid(),'ai_policy_acknowledged',jsonb_build_object('enabled',coalesce(p_enabled,false),'acknowledged',coalesce(p_acknowledged,false)));
end $$;
revoke all on function public.operator_ai_settings(uuid) from public,anon;
revoke all on function public.operator_save_ai(uuid,text,boolean,boolean) from public,anon;
grant execute on function public.operator_ai_settings(uuid),public.operator_save_ai(uuid,text,boolean,boolean) to authenticated;
commit;
