-- Consents: administrator rights-packet read policies, forward-only.
--
-- WHY THIS EXISTS — forward-safety for PR #171 (administrator Consents
-- access). PR #171's migration
-- (20261030180000_consents_administrator_access.sql) added
-- 'administrator' to private.can_manage_consent and recreated the six
-- consent-family read policies the forward way. The two RIGHTS PACKET
-- read policies, however, got 'administrator' by EDITING the
-- already-merged migration 20261030170000_rights_packets.sql in place.
-- Editing a merged migration is not deterministic: any environment
-- that applied 20261030170000 BEFORE the edit and never re-ran it
-- keeps the pre-edit policies (house_manager / program_manager /
-- nurse / auditor — no administrator). The PR review flagged this as
-- a blocker: policy changes must ship forward-only so every
-- environment converges to the same definitions.
--
-- This migration closes the gap by recreating both read policies
-- with the exact administrator-inclusive definitions that
-- 20261030170000 carries as merged (policy bodies copied verbatim
-- from that file — same USING expressions, same reader role list,
-- same scope helpers; nothing else changes). It touches nothing
-- else: no function, no other policy, no app code.
--
-- IDEMPOTENT — DROP POLICY IF EXISTS + CREATE POLICY, so it is safe
-- on an environment that already has the administrator-inclusive
-- policies (it recreates them identically) and on one still carrying
-- the pre-edit text (it upgrades them).
--
-- PRODUCTION STATE — production already carries these exact policies:
-- when 20261030170000 was applied there (2026-10-31) the
-- administrator-inclusive text was used and the live policies were
-- verified. Applying this file to production later is therefore a
-- no-op-safe formality — and it still waits for Joshua's explicit
-- go-ahead like every migration batch. Its real audience is every
-- OTHER environment (fresh installs, restored backups, CI, staging)
-- that applied the pre-edit 20261030170000.

begin;

drop policy if exists rights_packets_read on public.rights_packets;
create policy rights_packets_read on public.rights_packets for select to authenticated using (
 private.can_read_individual(agency_id, individual_id) and private.role_key_in(agency_id, '{house_manager,program_manager,nurse,auditor,administrator}'));

drop policy if exists rights_packet_evidence_read on public.rights_packet_evidence;
create policy rights_packet_evidence_read on public.rights_packet_evidence for select to authenticated using (
 private.can_read_individual(agency_id, individual_id) and private.role_key_in(agency_id, '{house_manager,program_manager,nurse,auditor,administrator}'));

commit;
