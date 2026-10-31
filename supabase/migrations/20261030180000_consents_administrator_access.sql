-- Consents: agency administrators can view AND manage consents.
--
-- Joshua's decision (2026-10-30): "Administrators can view and manage
-- Consents." The original register build (20261027140000) scoped the
-- consent audience to house_manager / program_manager / nurse / dsp /
-- auditor and simply never put the administrator role on the list; the
-- app predicates (canSeeConsents / canManageConsents in
-- src/data/consents.ts) now include it, and this migration aligns the
-- SQL layer the same way:
--   1. private.can_manage_consent gains 'administrator' — one helper
--      redefinition covers the register guards and write RPCs, the
--      consent-packet write RPCs, and the rights-packet write policies
--      (20261030170000 references the helper by name).
--   2. The six read policies that restate the reader role list are
--      recreated with 'administrator' added (the DSP branch of
--      consents_read is untouched — DSP masking is unchanged).
--   3. Two RPC access gates that restate a role list are redefined:
--      public.get_consent_packet_evidence (reader list) and
--      public.sweep_consent_alerts (caller gate — HostedApi triggers
--      the sweep for every canManageConsents user listing
--      notifications, so the gate must accept administrators or their
--      notification load would throw).
--
-- Alert RECIPIENTS do not change: private.sweep_consents and
-- private.sweep_packet_alerts keep their hardcoded targets (site house
-- manager direct, program_manager role, nurse role for medication), and
-- the consent.packet_signed creator confirmation inside
-- private.complete_consent_packet still lists the original manage
-- roles — that is a notification-routing rule, deliberately left as
-- designed and flagged in the PR rather than widened here.
--
-- UNAPPLIED — production application needs Joshua's explicit go-ahead
-- like every migration. Until it is applied, the app change works in
-- the demo (LocalApi) and hosted consent access for administrators
-- fails contained at these policies.

begin;

create or replace function private.can_manage_consent(p_agency_id uuid,p_individual_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and private.can_read_individual(p_agency_id,p_individual_id)
 and private.role_key_in(p_agency_id,'{house_manager,program_manager,nurse,administrator}');
$$;

drop policy consent_types_read on public.consent_type_settings;
create policy consent_types_read on public.consent_type_settings for select to authenticated
using (private.has_agency(agency_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,dsp,auditor,administrator}'));

drop policy consents_read on public.individual_consents;
create policy consents_read on public.individual_consents for select to authenticated
using (private.can_read_individual(agency_id,individual_id) and (
 private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor,administrator}')
 or (private.role_key_in(agency_id,'{dsp}') and private.consent_current(id))));

drop policy consent_revocations_read on public.consent_revocations;
create policy consent_revocations_read on public.consent_revocations for select to authenticated
using (private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor,administrator}'));

drop policy consent_packets_read on public.consent_packets;
create policy consent_packets_read on public.consent_packets for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor,administrator}'));

drop policy consent_packet_evidence_read on public.consent_packet_evidence;
create policy consent_packet_evidence_read on public.consent_packet_evidence for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor,administrator}'));

drop policy consent_packet_audit_read on public.consent_packet_audit;
create policy consent_packet_audit_read on public.consent_packet_audit for select to authenticated using (
 private.can_read_individual(agency_id,individual_id) and private.role_key_in(agency_id,'{house_manager,program_manager,nurse,auditor,administrator}'));

create or replace function public.get_consent_packet_evidence(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;result jsonb;
begin
 select * into p from public.consent_packets where id=p_id;
 if p.id is null or not private.can_read_individual(p.agency_id,p.individual_id) or not private.role_key_in(p.agency_id,'{house_manager,program_manager,nurse,auditor,administrator}') then raise exception 'Packet access denied.' using errcode='42501'; end if;
 select evidence into result from public.consent_packet_evidence where packet_id=p_id;return result;
end;
$$;

create or replace function public.sweep_consent_alerts(p_agency_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not private.has_agency(p_agency_id) or not private.role_key_in(p_agency_id,'{house_manager,program_manager,nurse,administrator}') then raise exception 'Consent access denied.' using errcode='42501'; end if;
 perform private.sweep_consents(p_agency_id,true);perform private.sweep_packet_alerts(p_agency_id,true);
end;
$$;

commit;
