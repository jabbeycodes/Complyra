# Operator Console Audit

## Scope, evidence, and limits

Inspected 2026-10-31. Repository: `jabbeycodes/Complyra`; target base `main` at `26aace591ca8db04203ea7f38d249aeb0742d501`. This is an inspect-only source audit: no product changes, migrations applied, agency actions executed, or production data queried.

The cloud checkout is at `888e7a4908c2f7c0720b9cce18facc96d2686362`. Git transport failed (configured proxy unavailable); GitHub connector comparison against the base found seven intervening commits, primarily consent/rights packets, demo seed, and attention/deadline changes. The newer rights-packet migration was inspected through GitHub. Operator components, routing, permission gates, and foundational operator schema cited below are unchanged in that comparison. Hosted/local API differences include rights-packet additions; line numbers are intentionally avoided in favor of file and symbol references. “Live-backed” means a real hosted query/RPC/function exists, **not** that its deployment, credentials, migrations, or results were verified. Without Supabase configuration, `src/data/index.ts:createApi` selects browser-local `LocalApi`; seeded data is not platform telemetry.

## 1. Inventory

### Reachability and scope

This is a single application with hash/page-name navigation, not a separate operator app. `src/App.tsx` handles navigation and renders pages; `src/data/status.ts:pageVisible` gates them. Examples: `#Platform`, `#Settings`, `#Roles%20%26%20access`, `#AI%20settings`, `#Activity%20log`, `#Overview`, `#Staff`, and `#Help`. Registration is an auth-screen state in `src/auth/AuthEntry.tsx`, not a dedicated operator URL.

Platform privilege is `profiles.platform_admin` → `SessionUser.platformAdmin`, separate from agency role `administrator`, `roles.manage`, or `compliance_admin`. `src/data/hostedApi.ts` loads this through login context/profile reads; `supabase/migrations/20260912020000_complyrer_access.sql:private.is_platform_admin` supplies server checks. Do not assume the platform flag grants every tenant permission: many screens/actions still check role keys or permission maps. There is no operator-role assignment editor. Profile identity protection prevents authenticated users from self-editing the flag (`20260913191500_phase0_security.sql`, repaired function in `20260914140000_permissions_site_scope.sql`).

| Surface / action | Location and behavior | Reach / authorization | Data reality |
| --- | --- | --- | --- |
| Self-service agency registration | `src/auth/SetupAgencyScreen.tsx`: name, state, short name/provider code, first admin, username, temporary password; submission/result screens | Public auth entry; server determines self vs platform provisioning | Hosted `supabase/functions/create-agency/index.ts` creates agency, Auth user, profile, membership, and `agency.created` event. Self-service is pending. Local equivalent in `src/data/localApi.ts:createAgency`. |
| Waiting/rejected setup | `src/auth/PendingAgencyScreen.tsx`; `src/App.tsx` and `src/data/DataProvider.tsx` block non-active agency workspace loads for non-operators | Signed-in non-operator with agency status other than active | Session-backed status. Rejected gets distinct copy; no appeal/review ticket workflow. |
| Platform → pending agencies | `src/features/PlatformConsole.tsx`, heading “Agencies”: pending table, Approve and Reject | `pageVisible("Platform")`, `HostedApi.listPendingAgencies/setAgencyStatus`: platformAdmin; agencies update RLS checks `private.is_platform_admin()` | Live-backed agencies select and status update. No review reason, reviewer, approval timestamp, bulk review, or detail/drill-down UI. |
| Platform → provider setup | Same component: create active agency and display first administrator credentials | Server validates caller platform flag before honoring `provisionedBy: "platform"`; otherwise falls back to pending self-service | Live-backed `create-agency`. Temporary password is displayed; first password change required. Creation does not refresh/reset the successful form into another-create workflow. |
| Agency directory / activation / suspension | `PlatformConsole.load` calls `listAgencies`, but filters to active agencies solely for the rules selector. `HostedApi.setAgencyStatus` writes status | Operator API only | Partial: no directory page, active/inactive list, suspend/reactivate action or suspended enum value. Existing `agencies.active` boolean is not exposed here; status is only pending/active/rejected. Rejecting registration is not suspension. |
| Platform → agency rules | `src/features/AgencyRulesPanel.tsx`, `src/data/rules.ts`, `src/data/rulesStore.ts`: choose active agency, edit value, effective time, reason, lock ownership; view history | Operator can set any rule/lock; agency administrator may edit unlocked rules through Settings. Server `set_rule_value` enforces it | Hosted `effective_rules`/`set_rule_value` and `rule_values`; local persistent store mirrors rules. Catalog defaults are code/seed-owned, no global-default editor. See rule catalog below. |
| AI settings (two entry points) | `src/features/documents/AiSettingsPage.tsx`: separate Compliance nav page and embedded below Settings in `src/App.tsx`; save model, read disabled state/project/verification timestamp, Verify service account | Platform flag only, UI + HostedApi + operator-only RPC and edge verify gate | Hosted per-`session.agencyId` `agency_ai_settings`, `set_agency_ai_settings`, `extract-pcsp` verify. Local adapter has simulated state. No agency picker here and no UI enable toggle: adapter preserves existing enabled value. Secrets are provisioned outside UI. |
| Staff / add member / role assignment / password reset | `src/App.tsx` Staff table/modals; `src/features/AssignRoleControl.tsx`; `HostedApi.inviteMember/assignMemberRole/resetMemberPassword` | Staff page: `hr.view_staff` OR `members.invite` OR `members.assign_roles`; actions respectively `members.invite`, `members.assign_roles`, `members.reset_password`, plus role-grant hierarchy | Live-backed memberships/profiles and `invite-member`/`reset-member-password` functions. Current agency scope; no global user search/directory, impersonation, operator grant/revoke, or account disable UI found. |
| Roles & access | `src/features/RolesAccessPage.tsx`: choose agency template, toggle permissions, reset draft to template defaults, save | `roles.manage`; API and agency-role RLS gate writes, with locked admin permissions and last-admin protections | Live-backed `agency_roles` permissions; global defaults in `role_templates` are provisioned by SQL. This is tenant RBAC administration, not platform operator-role management. |
| Settings → provider/workspace/access/report | `src/App.tsx`: provider code read-only, backend-mode badge, current identity and roles/add-member shortcut, compliance PDF export | Settings available to all signed-in users; action gates `roles.manage`, `members.invite`, `audit.export` | Current workspace metadata/exports; backend description is static explanatory copy. No editable platform configuration in these rows. |
| Settings → agency logo | `src/features/AgencyLogoSettings.tsx`; `src/data/branding.ts:canManageAgencyLogo`: upload, replace, remove | Administrator, compliance_admin, program_manager | Live-backed branding/private storage implementation; tenant-specific. |
| Settings → monthly check due dates | `src/features/MonthlyDueSettings.tsx`; `src/data/monthlyChecks.ts:canConfigureMonthlyDue`: equipment, drills, safety day | Administrator, compliance_admin, program_manager | Live-backed `agency_monthly_due`; current agency only. |
| Settings → agency rules | `src/features/AgencyRulesPanel.tsx:AgencyAdminRules` mounted from App | roleKey administrator; unlocked settings editable; server checks remain authoritative | Same rules/history as operator view, intentionally different ownership; not a second independent settings system. |
| Settings → electronic signature methods | `src/features/signatures/SignatureSettingsSection.tsx`: allow drawing, typing, upload; at least one enabled | Read current agency settings; edit roleKey administrator; HostedApi checks | Live-backed `agency_signature_settings`. Tenant signing policy, not platform authentication policy. |
| Settings → Advanced & data | `src/App.tsx`: data-handling preview notice, reset sample workspace | Settings users; reset rendered only without hosted backend | Static preview warning and browser-local destructive reset. Not a production database reset/backup tool. |
| Notification bell/panel | `src/features/notifications/NotificationBell.tsx`, `NotificationsPanel.tsx`, `useWorkspaceNotifications.ts`: unread count, open/deep-link, mark read/all read; polls each minute | Signed-in workspace; agency + user/role-target RLS | Live-backed `notifications` and `notification_reads`; local counterpart. No operator notification channel/template/provider console or broadcast composer. Reminder cadence controls exist within rules. |
| Security / account controls | `src/auth/ChangePasswordScreen.tsx`, profile/account modals in App, `src/security/InactivityGuard.tsx`, `inactivity.ts`; password reset above | Own account; reset permission for others; platform flag is protected | Real Auth update and password-change RPC; fixed 15-minute idle logoff with 60-second warning. No operator security settings page, MFA policy editor, session revocation console, SSO configuration, or configurable idle policy found. |
| Activity log | `src/App.tsx` Activity page; `HostedApi.loadWorkspace` maps events | Nav: `audit.read` OR `individuals.view`; payload additionally uses `canReadAudit` and database RLS | Hosted reads current agency `audit_events`, newest 40; browser-local timeline in local mode. No platform-wide query/filter/export here; hardcoded local-demo disclaimer appears even in hosted mode. |
| Audit center / Audit Me / QA Review / Report Library | `src/App.tsx`, `src/components/CommandCenter.tsx`, `src/features/qa/QaAuditsPage.tsx`, `src/features/reports/ReportLibraryPage.tsx` | Audit center/Me: `audit.read`; QA: qa.audit/dispute/schedule or audit.read; report library: explicit agency role list in `pageVisible`; export separately gated | Agency compliance, care-record and QA evidence tooling. Date filters in Audit center concern requirements, not operator analytics. They are not a platform admin activity/security log. |
| Integration status / diagnostics | AI service-account verification above; backend-mode badge in Settings | Operator verify; Settings badge available to signed-in users | One live-backed integration check (Vertex); Supabase status badge indicates chosen mode, not health. No general integrations registry, webhook administration, or credentials editor found. |
| System health | No dedicated route/component in App/status inventory | No operator health permission/surface found | No platform uptime, job-run, latency, error-rate, or queue-health dashboard found. Scheduled edge jobs exist; file presence is not job health. |
| Help / support | `src/features/help/HelpPage.tsx`: guides, FAQ, support instructions; demo tour restart | Help available to signed-in users | Static guidance; no ticket queue, case assignment, SLA tracking, agency support history, or impersonation tool found. `api/demo-request.js` is lead/demo intake, not support management. |
| Overview / mobile “Platform” naming | `src/Dashboard.tsx`; App Overview; `src/features/mobile/PlatformBottomNav.tsx` is shared mobile navigation | Overview: roleKey other than dsp; other destinations use their own gates | Live-backed current-agency compliance scores, requirements, homes, personal work/activity; local seeded counterpart. No operator KPIs. “PlatformBottomNav” does not implement an operator console. |

### Complete operator rule-setting catalog

All 25 definitions are in `src/data/rules.ts:RULE_CATALOG`, mirrored by `supabase/migrations/20260926120000_rule_settings.sql`. Each has validation/default/lock metadata; the operator panel edits **agency overrides**, not the platform default.

| Group | Keys (prefix omitted after first) |
| --- | --- |
| Documentation | `documentation.note_grace_minutes` |
| Medication | `medication.window_before_minutes`, `window_after_minutes`, `block_early_recording`, `late_recording_after_hours`, `unrecorded_reminder_minutes`, `refusals_before_rn` |
| PRN | `prn.followup_minutes`, `reminder_repeat_minutes`, `frequency_review_count` |
| Accountability | `accountability.points_per_late_item`, `writeup_threshold`, `warning_levels`, `late_clock_in_minutes`, `reset_after_writeup`, `dispute_window_days` |
| Hours & overtime | `overtime.weekly_limit_hours`, `tolerance_hours`, `approaching_hours`, `week_starts_on` |
| Recognition | `recognition.monthly_cap_per_manager` |
| Expirations | `expirations.order_reminder_days`, `certification_reminder_days` |
| Onboarding | `onboarding.cpi_pbs_due_days` |
| Delegations | `delegations.expire` |

The panel header comment claims only overtime is connected; that comment is stale. `src/data/rules.ts:operatingRulesFrom`, `HostedApi.operatingRules`, `LocalApi` rule consumers, and `supabase/functions/sweep-operating-reminders` show wider operational reads. Persistence and consumption are real code paths; a runtime test of each downstream rule is outside this audit. No generic feature-flag rollout/targeting system was found; rule booleans and the AI enable field are narrower domain controls.

## 2. Data reality check

In progress: schema and metric-source reconciliation.

## 3. Gap analysis

In progress: control-set comparison.

## 4. Dashboard assessment

In progress: current/target comparison.

## 5. Reorganization proposal and phased plan

In progress: recommendations.
