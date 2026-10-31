# Operator Console Audit

## Scope, evidence, and limits

Inspected 2026-10-31. Repository: `jabbeycodes/Complyra`; target PR base `main` at `343bb36b42e707194a24ac49abf0f9048c3bcaf6`. This is an inspect-only source audit: no product changes, migrations applied, agency actions executed, or production data queried.

The cloud checkout is at `888e7a4908c2f7c0720b9cce18facc96d2686362`. Git transport failed (configured proxy unavailable); GitHub connector comparison against the initially inspected source snapshot (`26aace591ca8db04203ea7f38d249aeb0742d501`) found seven intervening commits, primarily consent/rights packets, demo seed, and attention/deadline changes. The newer rights-packet migration was inspected through GitHub. Operator components, routing, permission gates, and foundational operator schema cited below are unchanged in that comparison. Hosted/local API differences include rights-packet additions; line numbers are intentionally avoided in favor of file and symbol references. “Live-backed” means a real hosted query/RPC/function exists, **not** that its deployment, credentials, migrations, or results were verified. Without Supabase configuration, `src/data/index.ts:createApi` selects browser-local `LocalApi`; seeded data is not platform telemetry.

Base reconciliation: the PR base is `343bb36b42e707194a24ac49abf0f9048c3bcaf6`; `26aace591ca8db04203ea7f38d249aeb0742d501` was the initially inspected source snapshot, not the final PR base. GitHub comparison from that snapshot to the actual base contains one intervening commit changing only `src/features/siteDetail/DrillScheduleVisual.css`. No operator surface, authorization, API, or schema evidence changed, so the findings below remain applicable to the actual PR base.

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

The panel header comment claims only overtime is connected; that comment is stale. `src/data/rules.ts:operatingRulesFrom`, `HostedApi.loadOperatingRules`, `LocalApi` rule consumers, and `supabase/functions/sweep-operating-reminders` show wider operational reads. Persistence and consumption are real code paths; a runtime test of each downstream rule is outside this audit. No generic feature-flag rollout/targeting system was found; rule booleans and the AI enable field are narrower domain controls.

## 2. Data reality check

### Schema-backed sources

Evidence below is repository DDL, not proof those migrations are applied. Table grain and timestamps matter: current state cannot reconstruct historical state.

| Source and grain | Fields relevant to operator reporting | Evidence / limitations |
| --- | --- | --- |
| `agencies`: one agency | `id, name, created_at, updated_at, agency_code, state_code, provisioned_by, active, status` | `supabase/migrations/20260911120000_complyra_foundation.sql`, `20260911233000_agency_invites.sql`, `20260911234800_agency_code_state.sql`, `20260912020000_complyrer_access.sql`. Status pending/active/rejected; independent active boolean. No approval/rejection/suspension timestamps or reason fields. `updated_at` is not an approval date. Includes platform/demo agencies; define exclusions before reporting customers. |
| `profiles`: one Auth-linked person | `id, full_name, email, job_title, created_at, updated_at, username, home_agency_id, must_change_password, active, platform_admin` | Foundation + agency_invites + complyrer_access migrations above. Linked to `auth.users`; do not count profiles as agencies or memberships as unique humans. No operator user lifecycle UI. Auth internals are not exposed as a general analytics feed. |
| `memberships`: agency/user association | `id, agency_id, user_id, role, site_id, created_at, role_key, expires_on`; unique `(agency_id,user_id)` | Foundation + `20260912000000_role_templates.sql`. Count distinct users for people; rows for agency seats. Expiry is not subscription cancellation. Current rows lack role-change history/last-seen timestamps. |
| `role_templates` / `agency_roles` | Template `key,name,short_code,description,default_scope,capability,permissions`; agency override `id,agency_id,template_key,name,short_code,scope,permissions` | `20260912000000_role_templates.sql`; later permission migrations change defaults and guards. No platform-role hierarchy or commercial plan entitlements. |
| `audit_events`: recorded application action | `id,agency_id,actor_id,action,target_type,target_id,detail,metadata,created_at` | Foundation; append-only trigger and scoped RLS. Not exhaustive page/session telemetry. `create-agency` records `agency.created` with the created admin as actor, not necessarily the operator caller. Hosted status updates do not insert an event; local `setAgencyStatus` logs `agency.status`. No agencies status-audit trigger found. Agency-role changes also have a server audit trigger (`20260913191500_phase0_security.sql`); reconcile API/server events before counting activity. |
| `rule_definitions` / `rule_values`: catalog / append-only setting change | Catalog `key,category,platform_default,default_lock,value_type,min_value,max_value,allowed_values,site_adjustable`; history `id,agency_id,site_id,key,value,lock,effective_from,reason,set_by,set_by_name,set_as_operator,created_at` | `20260926120000_rule_settings.sql`. Suitable for settings-change reporting and historical effective values, not customer lifecycle/billing history. |
| `agency_ai_settings`: per agency | `agency_id,ai_processing_enabled,model,service_account_verified_at,vertex_project_id` | `20260914120000_pcsp_extraction.sql`, `20260914130000_vertex_ai.sql` (renames old `key_last_verified_at`), `20260915010000_ai_settings_operator.sql`. Verification timestamp is not continuous uptime. |
| `document_uploads`, `document_extractions`, `document_audit_log` | Upload `id,agency_id,uploaded_at,status,uploaded_by`; extraction `id,agency_id,upload_id,model,created_at`; log `id,agency_id,upload_id,actor,action,at,detail` | `20260914120000_pcsp_extraction.sql`. Can support extraction volume and recorded workflow events. No comprehensive latency/cost/failure measurement guaranteed; contains sensitive workflow context. AI settings changes are logged here by RPC. |
| `signature_audit_log` / `signature_events` | Audit `id,user_id,agency_id,action,document_type,document_id,field_name,created_at,device_id,ip_address,user_agent,details`; signature-event evidence | `20260913200000_esignature_capture.sql`, `20260913230000_esignature_hardening.sql`. Allowed audit actions include login/logout/reauth/sign/view, but enum support does not prove complete login coverage. No ready-made platform active-user or retention model. |
| `notifications` / `notification_reads` | Notice `id,agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key,read_at,created_at`; per-user read receipts | `20260914010000_notifications.sql`; operating/system notice migrations extend producers. Supports notice volume/read state, not email deliverability, provider status, channel preferences or campaign conversion. |
| `programs,sites,individuals,requirement_definitions` | `agency_id`, IDs, creation timestamps; requirements status/due/completed timestamps | Foundation. Support tenant operational counts/compliance; `agency_scorecard` is a compliance score, not platform adoption/revenue. Do not pull care records merely to render aggregate operator KPIs. |
| Domain audit/history families | `hr_kiosk_audit`, `consent_packet_audit`, `shift_note_history`, `med_dose_mark_history`, `behavior_entry_history`, `health_track_entry_history`, `menu_entry_history`, `hr_time_off_events`, recognition rating/review histories | Respectively migrations `20260916140000_hr_kiosk_timeclock.sql`, `20261027180000_consent_packets.sql`, `20260925140000_own_record_corrections.sql`, `20260925120000_phase0_notes_mar_scope.sql`, `20261027202000_clinical_correction_path.sql`, `20261027230000_menu_records.sql`, `20261027210000_time_off.sql`, `20260914060000_recognition.sql`. Specialized evidence, not a unified platform event stream. `qa_audits/qa_audit_items` are compliance review records, not operator access logs. |

**No commercial data source today:** inspection of migration declarations/alterations and API/types found no subscription, subscription-plan catalog, invoice/payment, customer billing account, recurring price/currency, trial start/end/conversion, cancellation/churn, or subscription lifecycle tables/fields. “Plans” in care/behavior/document features are clinical/service plans; house-card/personal-spending ledgers are client petty cash, not SaaS revenue. “Retention” in signature DDL is record retention, not customer retention. Newer base migrations `20261030170000_rights_packets.sql` and `20261030180000_consents_administrator_access.sql` add consent evidence/access, not commercial data.

### Metric availability and definitions

| Metric | Available today? | Honest derivation / required plumbing |
| --- | --- | --- |
| Total agencies | Yes, current persisted rows | Count agencies after explicit platform/demo/test exclusions; include rejected/pending only if labeled “registered agencies.” New operator aggregate query needed. |
| New registrations / signup trend | Yes, agency creation proxy | Bucket `agencies.created_at` over a selected range; split self vs platform provisioned. This measures persisted agency setups, not signup attempts, unique prospects, or approvals. |
| Pending approvals | Yes, current snapshot | `status='pending'`; add age from created_at. Cannot compute historical queue size or approval turnaround reliably without lifecycle events. |
| Active/inactive agencies | Partial | Define operationally active as `status='active' AND active=true`; distinguish rejected/pending and disabled boolean. Inactivity from lack of usage and “suspended” are different concepts with no canonical lifecycle today. No active-state history. |
| Agency growth | Partial | Cumulative created agencies from timestamps is possible for surviving rows. Net historical growth, deletions, and active customer growth need lifecycle history; never imply creation curve equals paying customers. |
| Users / seats / role distribution | Yes, current state | Distinct profiles/users vs membership rows; expiry/profile activity filters explicit. Cross-agency aggregate access/query needed. |
| Subscription counts / plan distribution | **NO source** | Add plan catalog, subscriptions, statuses, effective dates, billing-customer linkage and entitlement semantics. Agency role or active flag is not a plan. |
| Revenue / MRR / ARR / ARPA | **NO source** | Add validated billing events/invoices/payments/credits, currency, recurring interval, refunds and reconciliation; define cash vs recurring/booked revenue first. Do not show fabricated zeroes. |
| Trials / conversion | **NO source** | Add trial start/end/status and conversion events linked to agency/subscription. Pending registration is not a trial. |
| Retention / churn | **NO reliable source for requested customer/subscription retention** | Define cohort, eligible denominator, retained event/window, cancellation/reactivation. Instrument subscription lifecycle and/or a validated usage event stream. Existing audit timestamps could support explicitly labeled recorded-action cohorts after coverage validation, not an assumed retention KPI. |
| Platform activity | Partial | Aggregate selected `audit_events` actions/time/agency with coverage caveat; union specialized logs only after event taxonomy/deduplication. Current 40-event tenant payload cannot be extrapolated to platform totals. |
| System availability/job health | **NO complete source** | Add job runs/heartbeats, execution outcomes, endpoint probes/error/latency telemetry. Vertex last verification is a single check, not availability history. |

## 3. Gap analysis against required controls

“Exists” means the required capability is represented by working source paths; deployment remains unverified. “Partial” includes tenant-only or incomplete operator capability. Duplicate findings do not imply removing a valid tenant feature.

| Required control | Verdict | Evidence / gap |
| --- | --- | --- |
| Agency registration and approvals | **Exists** | Self pending + operator active provisioning + approve/reject in PlatformConsole/create-agency. Review details/reasons, reliable error feedback, lifecycle auditing and history remain gaps. |
| Account activation/suspension | **Partial** | Pending→active exists; agency/profile active booleans exist. No suspend/reactivate UI, canonical suspended status, or guarded lifecycle transition workflow. |
| Subscription plans and billing | **Missing** | No commercial schema, billing integration, plan settings or operator screen found. |
| Trials | **Missing** | No trial schema or controls found. |
| User management | **Partial** | Tenant staff provisioning, roles, password reset exist; no global directory, agency-context support workflow or account disable controls. |
| Roles/permissions | **Partial** | Tenant role templates/permissions editor and guards exist; no operator privilege administration or global template editor. |
| Platform-wide configurations | **Partial** | Per-agency rules and read-only platform defaults; current-agency AI settings and tenant Settings. No global configuration editor/registry. |
| Feature controls | **Partial** | AI enable RPC and rule booleans exist, but model UI cannot change enable state. No rollout targeting, environment separation or general feature flag system. |
| Notifications | **Partial** | Real inbox/read receipts and reminder rules/producers; no platform template/channel/provider/delivery controls or broadcast management. |
| Security | **Partial** | Auth, RLS, password-reset/change, fixed inactivity guard, signing audit exist; no operator policy/session/MFA/SSO administration. |
| Audit logs | **Partial** | Multiple real logs, current-agency activity page; no unified operator audit explorer. Hosted status-action attribution/history incomplete. |
| Integrations | **Partial** | Vertex config/status/verify and Supabase backend exist; no general registry/config/status history or webhook console. |
| System health | **Missing** | No operator health dashboard or complete monitoring store. Edge jobs are implementations, not observed status. |
| Support management | **Missing** | Static help and tenant staff tools; no support cases/ownership/SLA workflow. |
| Duplicate/unnecessary surfaces (cross-cutting) | **Duplicate-or-unnecessary** | AI settings rendered separately and embedded in Settings; “Platform” nav opens “Agencies”; Activity disclaimer always describes local demo. Merge/rename/rewrite recommendations below. Tenant care audit screens remain useful and separate. |

## 4. Dashboard assessment

The default desktop landing is `Overview` for most roles (`src/data/status.ts:CANONICAL_PAGE_ORDER/defaultLandingPage`; App starts at Overview). There is no platformAdmin-specific landing. A platform user with a different agency role still follows the ordinary role visibility rules. `src/Dashboard.tsx` receives the selected session agency's scorecard, requirements, sites, individuals and activity; compliance status donuts, coverage and personal work are tenant operational views. They are not platform customer analytics.

`PlatformConsole` is the nearest operator entry: it shows pending agencies, a create-active-agency form and active-agency rule selection. It has no total/new/active/subscription/revenue cards, platform activity aggregate, date-range filter or customer analytics chart. `listAgencies` currently omits `created_at` and `active`; even buildable metrics require an expanded, permission-checked read model. It swallows list-all failures as an empty array, allowing failed rules loading to look like “No agencies yet.” Approve/reject handlers lack local busy/error handling; a rejected promise does not set the component error state. No browser action was executed to validate resulting UX.

| Target dashboard element | Build on existing data | Needs additional source data |
| --- | --- | --- |
| Total agencies; new signups; pending approvals | Operator aggregate over agencies, explicit exclusions and date definition; cards drill to filtered agency lists | No new entity for these basics; approval history needed for elapsed-review metrics and historical queue charts |
| Active/inactive agencies | Show status + active-boolean breakdown with clear labels | Canonical suspension and lifecycle events for historical active/inactive trends |
| Signup trends | Date-bucketed agency.created_at, self/platform series; click bucket → registrations | Signup funnel/failed attempts need instrumentation |
| Agency growth | Cumulative persisted registrations, labeled as such | Net/customer-active growth needs deletion/state history and baseline policy |
| Subscriptions / subscription distribution | Cannot honestly build now | Plan/subscription schema + ingestion, historical effective state |
| Revenue | Cannot honestly build now | Billing integration and revenue model/reconciliation |
| Platform activity | Aggregate supported action families over full date range, drill to authorized events | Unified taxonomy, missing operator events, dedupe and validated coverage |
| Retention chart | No validated customer retention measure | Cohort and activity/cancellation definitions + corresponding events/subscription lifecycle |

Proposed interaction contract: one explicit date range/timezone/granularity shared by applicable cards and charts; snapshot cards labeled “current” rather than pretending to be historical. Agency/status/source filters should survive drill-down and Back. Signup/growth use line or column charts; subscription distribution only after a real denominator exists; retention uses cohort table/heatmap only after cohort validation. Include labeled axes, counts/denominators, keyboard-accessible drill links and a table alternative. Distinguish loading, empty, failed, and “not yet measured”; never substitute sample values or $0 for missing sources. Aggregation should run server-side behind operator authorization, not download cross-tenant care data to the browser.

## 5. Reorganization proposal and phased plan

### Proposed Operator Control Center information architecture

These are proposed destinations, **not existing routes/features**. Use a distinct operator navigation group and agency context that cannot be confused with ordinary tenant Settings.

| Group / destination | Contents and purpose |
| --- | --- |
| **Overview** | Current agency counts, registration trend, pending-review workload, supported activity; explicit measurement limits. Make this the operator landing after authorization. |
| **Agencies → Directory / Approvals / Agency detail** | Search/filter all statuses; approval queue; registration and lifecycle history; scoped tabs for members, rules and integrations. Create agency is a directory action, not half the landing page. |
| **Access → People / Agency roles / Operator access** | Global account lookup; explicit tenant context for existing role editor; separately protected platform privilege workflow. Preserve tenant last-admin and grant-hierarchy rules. |
| **Policies & controls → Agency rules / Feature controls** | Existing rule overrides, defaults/source, effective dates, reasons and locks. Keep platform defaults read-only until a separately designed audited edit workflow exists; do not mix product rollouts with clinical rule booleans. |
| **Integrations → AI extraction / Other connections** | Consolidated model, processing-enabled state and verification with agency scope. Future registry only as providers are actually integrated. Never add credential material to client forms. |
| **Operations → Activity & audit / System health / Support** | Unified operator action explorer; measured job/endpoint health; future support cases. Keep tenant clinical Audit center and QA in the agency workspace. |
| **Communications** | Reminder policy links now; provider/templates/delivery and announcements only once persistence, scope and authorization exist. |
| **Commercial → Plans & subscriptions / Trials / Billing** | Add only with source-backed commercial model; not empty pseudo-functional settings at launch. |

### Remove, merge, or rename

| Existing item | Recommendation and reason |
| --- | --- |
| Standalone AI settings + Settings embed | One canonical operator integration destination, with a link from tenant Settings if useful. Removes two independently mounted instances of the same current-agency form and clarifies scope. |
| “Platform” nav vs “Agencies” page title | Rename/group under Operator Control Center → Agencies. Today the broad label promises more than the page implements. |
| Rules embedded in provisioning page | Move to agency detail → Rules and a shared operator rules view; retain agency administrator's unlocked subset. This is one settings system with two authorized audiences, not duplication to delete. |
| “Access and permissions” Settings row | Keep a concise link to Roles & access / People, rather than another editor. Preserve tenant controls in their current tenant context. |
| Workspace mode + preview data-handling/reset rows | Group under clearly scoped workspace diagnostics/demo tools; render preview/reset notices only when applicable. They are not operator platform policy settings. |
| Activity log's unconditional local-demo disclaimer | Make backend-specific; hosted audit persistence exists, although coverage is incomplete. Avoid falsely presenting hosted events as editable browser data. |
| Rules panel's overtime-only comment/copy | Update documentation to reflect demonstrated consumers and show connection/coverage limits accurately; do not remove persisted rules based on stale comments. |
| Agency branding, monthly due dates, signature methods | Keep under agency Settings or agency-detail scoped links. These are useful tenant settings; do not promote them to global platform configuration. |
| Audit center / Audit Me / QA Review | Keep in tenant compliance navigation. Do not merge into the operator security/activity explorer merely because all use “audit.” |
| Prospective revenue/subscription/retention cards | Omit until sourced, or label unavailable. Static demos of these metrics would misrepresent current data. |

### PR-sized phases, ordered by value

Each row is an independent proposed PR; none is implemented by this audit.

| Phase / proposed PR | Scope and completion evidence |
| --- | --- |
| **1. Reliable agency review** | Add pending/error states to approve/reject and propagate list-all failures. Add operator-gated status transition RPC with actor, reason, before/after and timestamp in a lifecycle log; preserve pending/active/rejected semantics. Verify unauthorized rejection, valid approval and event attribution in hosted/local paths. |
| **2. Agency directory** | Add searchable/filterable list including active boolean/status, created date and provision source, with detail and existing rule links. Show pending/rejected/disabled separately. Verify operator-only reads and tenant non-access; include platform/demo exclusion policy. |
| **3. Activation and suspension** | Define one canonical lifecycle, migrate compatible state, implement suspend/reactivate with reason/history and session/access enforcement; do not overload rejected. Verify existing sessions and tenant isolation, plus last-admin/account implications. Depends on phase 1 lifecycle log. |
| **4. First operator overview** | Add count/registration aggregate endpoint and separate operator landing, date filters, signup/growth charts and directory drill-downs. Reconcile sums to source queries; explicitly label current snapshots and cumulative registration limitations. No commercial metrics. |
| **5. Consolidate settings and AI scope** | Single operator AI destination with explicit agency picker and model/verification state; expose enable only with appropriate policy acknowledgment and audited authorization. Move rules out of provisioning; preserve unlocked tenant edits and history. Remove duplicated embed and misleading diagnostics copy. |
| **6. Operator audit explorer** | Query full authorized action history with agency/actor/action/date filters and pagination; include phase 1 lifecycle records, rule history and AI changes with source labels/deduplication. Verify cross-tenant authorization and exports without unnecessary clinical details. |
| **7. People lookup and support context** | Operator-only account/agency membership search and an explicit, read-only support context view linking existing tenant controls. No implicit impersonation or arbitrary privilege elevation; verify existing role hierarchy/last-admin protections. |
| **8. Health instrumentation** | Add bounded job-run/heartbeat records for reminder/other scheduled functions and endpoint probe/error summaries; then show measured health with last-success/failure age. Verify stale/missing telemetry is reported as unknown. |
| **9. Notification operations** | Introduce channel/provider/template/delivery state for supported delivery mechanisms and an operator status page; reuse reminder rules. Verify targeted delivery/read scopes and failures. Do not assume inbox rows mean delivered email. |
| **10. Commercial foundation** | Establish plan/subscription/trial schema, agency linkage, lifecycle dates and entitlements with an agreed billing source; seed no invented customers. Verify state transitions and idempotent event ingestion separately from money reporting. |
| **11. Billing and commercial dashboard** | Implement real billing-event/invoice/payment reconciliation and source-backed subscription/trial distribution, then revenue with documented currency/interval/refund treatment. Reconcile metrics to provider records; dependent on phase 10. |
| **12. Retention and remaining administration** | First PR: define and instrument one retention measure/cohort and validate its chart. Subsequent separate PRs: support-case persistence/queue, operator privilege administration, and individual security-policy controls as requirements are approved. Each requires its own authorization tests and audit evidence; do not bundle them into a dashboard redesign. |

### Verification and remaining uncertainty

Inspection covered App/hash navigation, permission gates, operator and adjacent Settings components, hosted/local API methods, edge functions, foundational and later migrations, and the GitHub base comparison. Source searches included platform privilege, registration/status writes, subscription/billing/trial/revenue terms, audit/history declarations, notification producers and rule consumers. Absence claims apply to the inspected repository/base, not externally managed services.

No app mutation or migration execution was used to prove functionality, and no runtime/deployment health claim is made. The existing `tests/ai-settings-operator.spec.ts`, `src/data/aiSettingsGate.test.ts`, `supabase/tests/access_boundaries.sql` and `supabase/tests/rule_settings.sql` are useful future verification entry points; their presence is not a claimed test pass. Documentation-only validation checks section/control coverage, cited paths, whitespace and a PR diff containing this single new Markdown file. Product test suites are not needed to validate an inspect-only documentation change.
