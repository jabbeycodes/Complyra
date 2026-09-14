-- ============================================================================
-- Vertex AI switch for the PCSP extraction pipeline
-- supabase/migrations/20260914130000_vertex_ai.sql
--
-- The extraction pipeline now calls Gemini through Vertex AI (Google Cloud)
-- with a service-account OAuth token instead of the Gemini Developer API
-- key (now removed). Vertex AI is the BAA-coverable path for PHI.
--
-- agency_ai_settings changes:
--   1. Adds vertex_project_id (text, nullable) — the GCP project id the
--      extract-pcsp function records when an administrator verifies the
--      service account. Displayed on the admin AI settings screen.
--   2. Renames key_last_verified_at -> service_account_verified_at. The
--      column semantics are unchanged (timestamp of the last successful
--      verify action); only the name reflects that it is a service-account
--      verification now, not an API-key check.
--
-- No credential is ever stored: the service-account JSON, project id, and
-- location remain Supabase function secrets (VERTEX_SERVICE_ACCOUNT_JSON,
-- VERTEX_PROJECT_ID, VERTEX_LOCATION) read from Deno.env by the edge
-- function only. There is deliberately no service-account column.
--
-- NOT YET APPLIED — the ship step applies this migration before deploying
-- the rewritten extract-pcsp function.
-- ============================================================================

alter table public.agency_ai_settings
  add column if not exists vertex_project_id text null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agency_ai_settings'
      and column_name = 'key_last_verified_at'
  ) then
    alter table public.agency_ai_settings
      rename column key_last_verified_at to service_account_verified_at;
  end if;
end
$$;

comment on column public.agency_ai_settings.service_account_verified_at is
  'Timestamp of the last successful Vertex AI service-account verification (admin "Verify service account" on the AI settings screen). Carries no credential material.';

comment on column public.agency_ai_settings.vertex_project_id is
  'GCP project id used for Vertex AI calls, recorded at verification time. Displayed on the admin AI settings screen.';
