-- Wave 4A (agency simulation retest batches 305-306): consent alerts never
-- reached the administrator's bell.
--
-- Root cause, proven against production 2026-11-05: the alerts ARE minted.
-- private.sweep_consents (20261104120000) inserts one role-addressed
-- consent.missing / consent.expiring row for role_key 'administrator' per
-- gap, and the permissive notifications_select policy matches Sam's
-- membership. But public.notifications also carries a RESTRICTIVE select
-- policy from the original register build (20261027140000):
--
--   consent_notification_roles: type not like 'consent.%'
--     or private.role_key_in(agency_id,'{house_manager,program_manager,nurse}')
--
-- Restrictive policies are ANDed with the permissive ones, so every
-- consent.* row was invisible to an administrator session no matter who it
-- was addressed to. 20261030180000 (administrators view and manage
-- consents) widened the six consent read policies and the sweep gate but
-- missed this one, and 20261104120000 then started addressing alerts to a
-- role that could not read them. Replaying Sam's session under RLS returned
-- 46 notifications and zero consent rows, against 18 unread administrator
-- consent rows in the table.
--
-- Fix: recreate the policy with 'administrator' in the reader list. The
-- list now equals private.can_manage_consent's roles, which is also the set
-- of roles the sweep addresses (house manager direct; program manager,
-- administrator, nurse by role). Auditors and HR stay excluded, as the
-- original comment intended ("Former managers who become auditors/HR
-- cannot keep receiving consent notices"). Recipient rules, dedupe keys,
-- and every sweep / retire function are unchanged.
--
-- UNAPPLIED: production application needs Joshua's explicit go-ahead like
-- every migration.

begin;

drop policy if exists consent_notification_roles on public.notifications;

-- Former managers who become auditors/HR cannot keep receiving consent
-- notices. Administrators manage consents (20261030180000) and are a
-- role-addressed consent alert recipient (20261104120000).
create policy consent_notification_roles on public.notifications as restrictive for select to authenticated
using (type not like 'consent.%' or private.role_key_in(agency_id,'{house_manager,program_manager,nurse,administrator}'));

commit;
