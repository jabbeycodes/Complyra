# Agency administrator settings and dashboard audit — Phase 1

## Scope, baseline, and evidence limits

Inspected `main` at `9d7ade3218e6d1ae1e70374d5dc1a331ded14b27` (2026-10-31), verified against the GitHub branches API. This PR changes only this document. No production writes, settings changes, route/permission/label renames, migrations, or implementation work were performed. No merge is authorized. Separate PR-review agent review and Anert QA are required; Phase 2 must wait for Anert's slice order after Phase 1 lands.

Concurrent-main note: while the audit was being published, main advanced to `c8d4c45fb625174a497e9a0f5b427ff639b93b16` through PR #197 (hosted Shift Notes signature data-URL parity, signature-pad sizing, and close-on-success fixes). The GitHub compare was inspected: it changes signature/chart/Shift Notes code and tests, not the settings catalog, dashboard calculations, billing schema, or scorecard-scope findings. Preserve those landed fixes; validation below is for the pinned `9d7ade3` baseline, not a claim to have executed the updated main suite.

This is a source audit, not a production penetration test or a claim that migrations/functions are deployed. Paths below are relative to the repository root. Function/component names are search anchors at the pinned revision. The production agency simulation was not disturbed. Unit/build results appear at the end. Hosted database/RLS execution and phone/browser interaction remain validation tasks for implementation slices.

The app uses page-name state and encoded hashes, not a conventional pathname router: `App.tsx` `navigate`, `applyHash`, `pageVisible` in `data/status.ts`, and `notificationPage` / `notificationTarget` in `features/notifications/notify.ts`. Thus `Settings` means `#Settings`, `Roles & access` means the encoded page label, and slash links are translated by the notification resolver. Preserve those contracts and flag proposed label/route/key changes to Anert before implementation.

## Executive findings

1. **Build on two existing surfaces.** `Overview` (`Dashboard.tsx`) is the manager's compliance-first home. `Audit Me` (`components/CommandCenter.tsx`) already implements weighted readiness scores, risks, attention, deadlines, corrective actions, and score history. Rebuilding these would duplicate working logic.
2. **Scope and score explanations precede more charts.** The site selector narrows some Overview panels but not its agency scorecard, status mix, personal queue, or GER panels. Requirement-current percentage and Audit Me's weighted score are different measures. Hosted `agency_scorecard` is agency-wide even for site-scoped callers; LocalApi uses scoped requirements except for HR. Counts and their drill-down populations can diverge.
3. **Settings are dispersed, not absent.** Agency settings, roles, site facts, Individual ISP configuration, consent types, delegation templates, binder templates, staffing, pay rules, and clock rules live in different workspaces. Introduce discovery links with existing gates before moving editors.
4. **Some copy is stale, some inputs really are absent.** AgencyRulesPanel's comment says only overtime is connected, but operating-rule consumers now exist in both APIs and reminder code. Conversely Audit Me genuinely supplies empty/null DMH evidence and missing-requirement inputs. Do not mistake either copy or a helper's potential inputs for delivered functionality.
5. **Tenant subscription/billing does not exist in the audited schema or API.** Billing is a product/schema proposal, not an immediately buildable settings slice. Payroll, mileage, House Card, and Personal spending are not SaaS billing.

## Inventory conventions and access boundaries

`L/H` below means both `data/localApi.ts` and `data/hostedApi.ts` unless a dedicated store is named. Local state is agency-filtered in MemoryStore/localStorage; hosted reads/writes use agency IDs plus RLS/RPC/storage policies. Having two methods does **not** establish behavioral parity: differences and execution limits are called out separately.

Canonical permission keys/templates are `data/permissions.ts`; page admission is `data/status.ts`. `data/dashboard.ts` (`sitesVisibleTo`, `canAccessSite`) and `data/access.ts` (`canReadIndividual`) handle scope. Recent staff-scope repair is load-bearing: do not replace it with a simplistic role check. In particular, preserve HR's lack of Individual chart access, compliance administrators' separate HR scope, auditor read-only behavior, assignment/home-site rules, privilege-grant restrictions, last-administrator protection, and locked administrator template permissions. Existing role-specific helpers are listed as such; no new permission key is implied.

`Platform` and `AI settings` require `platformAdmin`; ordinary agency administrators do not gain operator access. `Settings`, `Sites & programs`, and `Help` are admitted for all sessions, with individual actions gated separately. This is not itself evidence of an unauthorized write.

## A. Settings page: every current section/action

| Setting or action | Component / location | Gate | Source / persistence | Assessment |
| --- | --- | --- | --- | --- |
| Agency identity, provider code, site/Individual/staff counts, job title | `App.tsx`, Settings | Session; no settings-wide admin permission | Workspace/session; `Agency` in `data/types.ts`; `agencies`, memberships | Summary, not a profile editor. Provider code explicitly immutable after setup. Counts do not necessarily equal each panel's filtered population. |
| Workspace mode | Same | Session | `usingHostedBackend` / runtime config | Read-only diagnostic; ordinary owners do not configure Supabase here. |
| Access and permissions; Roles & access / Add member | Same; `RolesAccessPage`, `InviteMemberForm` | `roles.manage`, else `members.invite` | L/H role/membership APIs | Useful shortcut to existing editor; not a second role store. |
| Compliance report | Same; compliance PDF export | `audit.export` | Current `scoped` requirements, `metrics`, PDF builder | Duplicates audit/report entry points, not necessarily identical reports. Retain existing exports until equivalence proven. |
| Agency logo: upload/replace/remove | `features/AgencyLogoSettings.tsx` | `canManageAgencyLogo`: administrator, compliance_admin, program_manager | L/H `uploadAgencyLogo`, `removeAgencyLogo`; agency logo path/private storage, local file data | Working setting, shared with reports/sidebar. PNG/JPEG and size constraints. |
| Monthly equipment/drill/safety due day | `features/MonthlyDueSettings.tsx` | `canConfigureMonthlyDue`: administrator, compliance_admin, program_manager | L/H `updateMonthlyDueSettings`; local agency.monthlyDue / hosted `agency_monthly_due` | Three day controls; defaults 7, bounded by monthlyChecks constants. Copy says PM/admin but helper includes compliance_admin. |
| Agency rules: effective values, edits, reasons, effective time, history | `features/AgencyRulesPanel.tsx`, `AgencyAdminRules` | UI exact administrator; agency-unlocked values only; locks reserved to operator | `data/rulesStore.ts` LocalRulesStore / SupabaseRulesStore; `rule_definitions`, `rule_values`, `effective_rules`, `set_rule_value` | 25 rows detailed below. No site picker in agency editor although store supports site overrides. |
| Signature Draw / Type / Upload methods | `features/signatures/SignatureSettingsSection.tsx` | Read session; edit exact administrator | L/H `getSignatureSettings`, `updateSignatureSettings`; `agency_signature_settings` | At least one stays enabled. Personal signature adoption is a different setting, not a duplicate. |
| Advanced & data: data handling | `App.tsx`, Disclosure | Session | Static copy | Fictional-record warning is shown even with hosted backend; review accuracy with deployment owner, not a basis for changing production policy. |
| Reset sample workspace | Same, reset modal | Only rendered when not hosted | Local reset flow | Demo-only destructive action; preserve confirmation and hosted exclusion. |
| AI model and service-account status/verification | `features/documents/AiSettingsPage.tsx`, also separate AI settings page | `canManageAiSettings` / platformAdmin | documents adapter; L/H agency AI methods; `agency_ai_settings`, hosted functions/secrets | Two entry points for operators only. Not an agency-admin integration setting; never expose credentials. |

### Rule inventory (all rows in `data/rules.ts` RULE_CATALOG)

Every row uses the same effective-date/reason/history flow; default locks below can be overridden by the operator. The agency may edit only when effective lock is `agency`. Validation/ranges are in the catalog and mirrored by the SQL catalog and `set_rule_value`.

| Key | Default | Default lock | Operational family |
| --- | --- | --- | --- |
| documentation.note_grace_minutes | 5 minutes | operator | Missing Shift Notes after scheduled shift end |
| medication.window_before_minutes | 60 minutes | operator | MAR early window |
| medication.window_after_minutes | 60 minutes | operator | MAR on-time window |
| medication.block_early_recording | true | operator | MAR entry guard |
| medication.late_recording_after_hours | 8 hours | operator | Late-recording accountability |
| medication.unrecorded_reminder_minutes | 60 minutes | agency | Missing-dose reminders |
| medication.refusals_before_rn | 2 | agency | Consecutive refusal escalation |
| prn.followup_minutes | 60 minutes | agency | Effectiveness follow-up due |
| prn.reminder_repeat_minutes | 15 minutes | agency | Follow-up reminder cadence |
| prn.frequency_review_count | 3 in 7 days | agency | RN review signal |
| accountability.points_per_late_item | 1 | operator | Late-item deduction |
| accountability.writeup_threshold | 10 | operator | Write-up threshold |
| accountability.warning_levels | 5, 8, 9 | agency | Warning balances |
| accountability.late_clock_in_minutes | 15 minutes | operator | Attendance accountability threshold |
| accountability.reset_after_writeup | true | operator | Balance reset with history |
| accountability.dispute_window_days | 7 days | agency | Dispute window |
| overtime.weekly_limit_hours | 40 hours | operator | Operational overtime limit |
| overtime.tolerance_hours | 1 hour | operator | Operational overtime flag tolerance |
| overtime.approaching_hours | 36 hours | agency | Approaching-overtime notice |
| overtime.week_starts_on | sunday | operator | Operational week boundary |
| recognition.monthly_cap_per_manager | 20 points | agency | Award cap |
| expirations.order_reminder_days | 30, 14, 7 days | agency | Medication/physician-order notices |
| expirations.certification_reminder_days | 60, 30, 7 days | agency | Staff/HR expiry notices |
| onboarding.cpi_pbs_due_days | 30 days | agency | CPI/PBS after hire |
| delegations.expire | false | operator | Expiring obligation semantics |

Consumer evidence: `overtimeLinesFrom`, `operatingRulesFrom`, `operatingReminders.ts`, both APIs' operating-rule reads/MAR entry/Shift Notes/accountability/recognition/delegation paths, `features/employeeHub/useOvertimeLines.ts`, and `supabase/functions/sweep-operating-reminders/index.ts`. The scheduled hosted sweep is declared by `20261025120100_sweep_operating_reminders_schedule.sql`; runtime cron/vault/function deployment was not verified. A saved row alone does not prove a background notification was delivered.

## B. Agency-admin-reachable configuration outside Settings

These are configuration editors plus their adjacent record-management surfaces; ordinary record entry is distinguished from agency policy. Paths prefixed `features/` are under `src/`; data paths under `src/data/`.

| Page / nested location | Component / configuration | Permission or role gate | Data source, API/store, and persistence |
| --- | --- | --- | --- |
| Roles & access | `features/RolesAccessPage.tsx`: role template permission maps | `roles.manage`; locked template keys enforced | Workspace roles load + L/H `updateAgencyRole`; agency_roles, role_permission_matrix; `permissions.ts` registry |
| Staff | `App.tsx`, `InviteMemberForm`, `AssignRoleControl`, `ResetPasswordControl`: invite/account details, role/home-site assignment, reset password | `hr.view_staff` / member permissions for page; `members.invite`, `members.assign_roles`, `members.reset_password` per action; `canGrantRole` hierarchy | L/H invite/assign/reset APIs; memberships, profiles, invitations; hosted Auth/edge functions. These are separate from clinical caseload assignments. |
| Individuals / Intake / chart | `AddIndividualForm`, `IndividualChart`, `ChartOverview`: intake, profile/contacts/diagnoses, staff assignments | `individuals.view`, `canCreateIndividual`, profile/contact/diagnosis helpers and assignment API guards | L/H `createIndividual`, `updateIndividualProfile`, `assignStaff`; individuals, individual_profiles, staff_assignments |
| Sites & programs / Site detail | `AddSiteForm`, `sites/SitesList`, `siteDetail/SiteDetailPage`, `SiteReviewPanel`: creation, service/site facts, water tests, contacts/reviews | `sites.create`; `canEditSiteReview` and site access per action | L/H `createSite`, `saveSiteFacts`, site review APIs; sites, programs, site_reviews. No general agency profile/address editor in Settings. |
| Requirements / category pages | `App.tsx`: requirement draft, source page, due date, owner, evidence, approval | Page `individuals.view`; `documents.upload` API draft gate, `requirements.approve`, `requirements.complete` | L/H requirement APIs; requirement_definitions/completions. Six fixed domain categories; no arbitrary agency-wide requirements policy builder. |
| Documents / Review queue / Acknowledgments | Upload, extraction review, plan versions, acknowledgment packets and assigned documents | `documents.view/upload/review`, `requirements.approve`, `acknowledgments.manage/sign_own` | L/H + `features/documents/documents.ts` adapter; documents, versions, trackable obligations, acknowledgment packets/rows, private storage |
| Individual chart → ISP / Shift Notes | `isp/IspConfigSection.tsx`, `ShiftNoteSection`: programs/tasks, schedule, plan year/effectivity, scoring method and levels, approval | `canConfigureIspTasks`: administrator/program_manager; `canSeeShiftNotes`, `canEnterShiftNotes` separately | L/H ISP program/task/scoring/approval/shift-note APIs; `20260917120000_issue80_shift_notes.sql` and scheduled-shift migration. Configuration belongs to a person/plan, not a global notes toggle. |
| Individual chart → care plans/screenings/health/behavior | `CareScreeningSection`, `behavior/BehaviorSection`, `healthTrack/HealthTrackSection` | Individual scope + module role helpers; `behavior.plan/record`, `health.record` | L/H care/screening/behavior/health APIs; structured module tables and care-plan acknowledgements. Record protocols, not a tenant automation editor. |
| Medication orders / chart MAR / Supply forecast | medicationOrders pages/cards, `MarCard`, medInventory components: orders, reconciliation, PRN instructions, supplies | Medication role helpers; `clinical.view`/Individual access on relevant paths; nurse/PM/admin sign-off; auditor read-only | L/H medication order/reconciliation/MAR/PRN/inventory APIs; medication_orders, reconciliation and medication record tables. Agency timing rules are in Settings, not duplicated order settings. |
| Individual chart → event reports | `ger/GerTab.tsx`: report, review/return, follow-up due/resolution | `ger.create`, `ger.review`, `ger.resolve` plus Individual/site scope | L/H GER APIs; report/follow-up persistence. Fixed workflow, no tenant-defined incident state machine. |
| Consents → Configure consent types | `consents/Consents.tsx`: type label, required per Individual, medication classification, add type | **Only agency-wide program_manager** (`!siteId`), in UI and both APIs; ordinary administrator cannot save types | L/H `getConsents`, `saveConsentTypes`; consent_type_settings / local consentTypes; hosted save_consent_types RPC. Both preserve referenced type history. This is a founder-goal gap, not permission to widen roles. |
| Consents → packets / Rights packets | `Packets`, `PacketForm`, `RightsPackets`, `RightsPacketForm`; content/signature/renewal flows | Module role checks and signed-record immutability | L/H packet/right APIs; consent_packets, rights packets, public signing functions. Personal signature adoption differs from agency allowed methods. |
| Training / Delegations / Certificates | `training/StaffCompliancePage`, `AssignTrainingModal`, delegation pages/templates, `CertificateManager` | `hr.view_staff`, training helpers; `delegation.templates.manage/view`, activate/assign/training.review/approve; `certificates.manage` for edits | L/H training/certificate/delegation APIs; templates, activations, assignments, materials, acknowledgments, training/certificate tables. Administrator default intentionally omits certificates.manage; preserve modeled exception. |
| Weekly checklist / Checklist assignments | `HmWeeklyChecklistPage`, `ChecklistAssigner`, Site detail drills schedule | Page-specific role gates in status.ts; checklist/qa schedule guards | L/H weekly checklist and schedule APIs; checklist records/cycles; site drill schedule. Monthly due days remain centralized in Settings. |
| QA Review / Audit center / Audit Me / Report Library | QA scoring/scheduling/disputes, audit exports; corrective action owner/due date/resolve | `qa.audit/dispute/schedule`, `audit.read/export`, `correctiveActions.manage`; report-library role list | L/H QA/action/snapshot/export APIs; qa tables, corrective_actions, compliance_score_snapshots. DMH registry is code-defined, not an editable agency compliance taxonomy. |
| Scheduling / Employee Hub → Team Schedule | `scheduling/SchedulingPage`, `StaffingBoard`, `StaffingConfigForm`, coverage board: recurring patterns, slots, published shifts, open shifts | Scheduling page administrator/program_manager/house_manager; `hub.manage_schedule`, `hub.manage_staffing` for actions | `hrStore.ts` local/hosted + `openShiftStore.ts`; HR shifts, recurring staffing and open-shift tables; shift-derived note obligations |
| Employee Hub → Payroll → Pay settings | `EmployeeHubPage` PaySettingsSection: weekly/daily/seventh-day overtime thresholds and seventh-day switch; leave accrual tenure bands, carryover cap/basis, effective dates, active flag | Payroll tab `hub.approve_payroll`, editor `hub.manage_pay_settings` | `hrStore.ts` local/hosted get/save overtime rules and accrual policy CRUD; hr_overtime_rules, hr_accrual_policies. Separate from operating overtime thresholds. |
| Employee Hub → Payroll → Clock settings | `employeeHub/PunchRulesConfig.tsx`: rounding 0/5/10/15, payroll-only/display scope, grace, auto-clockout buffer, autoapproval threshold | Same nested Payroll + pay-settings gates | `hrStore.ts` get/savePunchRules, `kioskContracts.ts` adapter; hr_punch_rules. Current hosted mapper/writes match schema; adapter's historical mismatch comment is stale. |
| Employee Hub → Kiosk | `KioskAdmin`, `RemotePunchAdmin`: site kiosk issue/rotate/revoke, staff credential/PIN issue/reset/unlock; per-staff remote-punch grant/revoke | Tab `hub.manage_staffing` OR `hub.manage_pay_settings`; nested actions/store/RPC gates | hrStore local/hosted, kiosk store adapter and RPCs; hr_kiosk_tokens, hr_clock_credentials, hr_staff_permission_grants. Device secrets shown only by dedicated flows. |
| Employee Hub → Binder Board → templates | `newHireBinder/BinderBoardPanel`, `BinderTemplateEditor`: agency default and role presets, sections/items/evidence kinds | Binder Board role/permission rules; editor non-auditor administrator/HR or certificates.manage | hrStore list/saveBinderTemplate; hr_binder_templates and binder documents; separate personal New Hire Binder is read/fulfill flow |
| Employee Hub → Documents / Time Off / Timecards / Attendance | HR document assignment, balances/adjustments, approvals, corrections, payroll locks | `hub.manage_documents`, `hub.approve_time_off`, `hub.review_timecards`, `hub.view_team`, `hub.approve_payroll`; own records separate | hrStore local/hosted HR tables and RPCs. Approval flows are modeled operations, not a configurable workflow designer. |
| Notifications bell / Messages / Recognition | Read/mark-read notifications; staff messages; ratings/winners/awards | Recipient scope; `messages.use` plus explicit auditor exclusion; recognition.* gates | L/H notifications and messaging APIs; notify/workflows/rules modules; notification_reads, messages, recognition records. No tenant channel/preferences/escalation editor. |
| Profile / personal signature / security | ProfileSignatureSection, SignatureAdoption, password/reauth flows, InactivityGuard | Self-service; signature/reauth server checks | L/H signature identity APIs; hosted Auth/signature records; security/inactivity constants (15-minute automatic logoff). No agency-configurable MFA/SSO/session-policy screen found. |
| Activity log | `App.tsx` timeline | `audit.read` or `individuals.view` page gate; APIs scope actual events | Local audit records / hosted audit events; signed-record audit hooks. Not interchangeable with rule history. |
| Money records / mileage | House Card, Personal spending, Mileage | Existing role helpers/site or Individual scope; mileage.manage | L/H ledgers/mileage APIs; **not subscription or billing data** |
| Integrations / subscription / billing | No tenant-admin editor found | No tenant billing permission/model found | Runtime Supabase and operator Vertex configuration only; proposals discussed below |

## C. Existing dashboard inventory — preserve and extend

### Overview (`App.tsx` → `Dashboard.tsx`)

| Surface | Existing real inputs and computation | Current navigation / limitations |
| --- | --- | --- |
| Site selector | `sitesVisibleTo`; requirement `scoped` list in App | Selects site by name; not a universal scope control. Prefer IDs for future joins without renaming existing routes. |
| Personal compliance strip/card | personalCompliance helpers/hook; own HR/certificates/training/binder evidence; shared readiness donut grammar | Opens Employee Hub My Compliance. Intentionally independent of site selection. |
| House compliance donuts / team readiness | `houseComplianceRows`, domain.metrics/statusMix, StatusMixDonut; `teamCompliance.ts` HR/certificate/training/binder sources | House-name button focuses Overview. Team count is text, no staff-list drill-down. Preserve people/house donut grammar. |
| Coverage | `coverage/SiteCoverageBoard`, HR shifts/note evidence and operating grace rules | Selected site passed; absent on HM Overview by design. Scheduling separately hosts RightNowStrip. Do not put it back at the top of Overview. |
| Consent attention / care reviews and screenings | `Consents attentionOnly`, `CareScreeningAttention`; consent register and screening/care records | Scoped focused site; care attention opens Individual. Consent management is already implemented. |
| Agency current, needs attention, due next 7 days, pending review | Workspace scorecard; fallback metrics(allItems). `metrics` = compliant / non-pending requirements, rounded; zero active => 100 | Buttons open Requirements/status or Review queue. Headline counts stay agency-wide; target tables retain active site filter, so count/records may disagree. Status label drives due-soon count, not a fresh date-range query here. |
| Status mix | `StatusMixDonut(allItems)` | All visible requirements; no segment-click record filter. Pending/upcoming have separate status bins. |
| Agency compliance / per-site scores | Same requirement metric; site review state + Individual counts | Repeats headline score and house donuts; site cards focus rather than open source lists. Review-in-place uses site-review facts/date. |
| Your work | `personalQueue`: requirements, packets, plan stacks, monthly checks/due rules, site reviews | Opens requirement, person, site/page or review queue; own workload remains independent of site filter. |
| Needs attention / category compliance | `items` filtered by site; overdue/expired; six domain categories and metrics | Requirement rows open source detail; category buttons navigate to category tables. Working drill-down pattern to reuse. |
| GER awaiting review / follow-up | `listAgencyGerReports`, `gerNeedsFollowUp`, resolution display | Role gate `canSeeGerDashboardRows`; opens person chart, not report ID. Does not receive Overview site selection. Fetch error becomes empty list and hides panels. |
| Recent activity / records lookup | Workspace activity, first 3; deterministic lookup over requirement records | Activity log and lookup dialog. Activity is not narrowed by Overview site selector. Snapshot copy always says Sample agency snapshot. |

### Audit Me (`App.tsx` → `components/CommandCenter.tsx`)

This is the **existing** audit command center, not a proposed replacement Overview. Page gate `audit.read`; corrective writes `correctiveActions.manage` (auditor remains read-only). Wrapper loads corrective actions, certificates (36500-day horizon), staff clearance, weekly checklists, 30 snapshots, per-Individual med inventory, rights packets, plus workspace requirements/staff/sites/Individuals/plan stacks. Optional-source failures are listed in `unavailable`; snapshots are suppressed for incomplete loads. Reading may record today's agency snapshot for managers; no write was invoked in this audit.

| Computation already present | Inputs / code | Gaps to retain visibly until repaired |
| --- | --- | --- |
| Agency/site weighted score and breakdown | `buildScoreFactsForData`, `data/complianceScore.ts`: requirements 30%, certificates 25%, checklists 15%, training 15%, medication supply 15%; partial credit 0.5, empty categories excluded and weights renormalized | Different meaning from Overview's requirement-current %. Medication supply is not MAR adherence. No evidence should never silently mean full compliance. |
| Risk registry | `riskRegistry.ts`: expired/expiring certs, missed checklists, incomplete training, low/out medication supply, overdue requirements, overdue corrective actions | Reuse source IDs and severity metadata. Do not duplicate risk math in new cards. |
| Management attention feed | `attentionFeed.ts` merges risk/deadline facts into overdue, due-today, escalation groups | Existing feed, not greenfield. Check duplicate sources and record-specific drill-downs. |
| Due next (5) and all upcoming deadlines | `deadlineTimeline.ts`: certificate expiry, plan renewals, weekly checklist deadlines, med run-out projections, corrective actions, rights packet renewal/unsigned state | Wrapper passes `trainings: []`, `providerRecertification: null`. Those deadline types are supported by helper but not wired here. Medication projections require known supply, not invented refill dates. |
| DMH readiness checklist | `auditReadiness.ts`, `dmhRequirements.ts`; corrective actions real | Wrapper passes providerCertificate/administrator/POC dates null and staffTraining/medAides/incidents empty. Unknown status is honest, but this is not a complete agency readiness audit. Must wire structured evidence or omit unavailable numeric claims (D-01). |
| Missing requirements | `missingRequirements.ts`: staff hires/CPI-PBS rule, certificates, checklists | requiredCertificateKinds, requiredTrainingTopics, trainings, requiredIndividualDocuments, individualDocuments are empty. Cannot claim agency-wide document/training completeness. |
| Corrective actions | list/add/resolve APIs; owner, due date, status derivation | Real source and write gate; link to evidence/QA finding and consistent site filtering need review. |
| Workflow library | `WORKFLOW_TEMPLATES`, `data/workflows.ts` | Code-defined templates; displayed list does not establish editable agency automation or deployed delivery. |
| Score trend | `compliance_score_snapshots`, list/saveComplianceSnapshot | Real history, initially sparse; no fabricated backfill. Need date/site/formula version/provenance and source drill-down before interpreting historical change. |

Deep links are **not uniformly dead**: `notificationPage` maps /certificates, /checklists, /training, /meds, /requirements, /audit/actions, /corrective-actions, /consents and /plans to existing pages. However CommandCenter hash anchors go through `applyHash` → **page resolver only**, not `notificationTarget`'s entity handling. Most links are generic page paths anyway. They do not reliably open the specific underlying certificate, Individual plan, requirement, or action. Distinguish successful page navigation from the required record drill-down.

## D. Duplicates, false doors, and parity findings

| ID / priority | Finding and evidence | Recommendation, without changing behavior in Phase 1 |
| --- | --- | --- |
| A-01 / high | Hosted agency_scorecard (`20260912020000_complyrer_access.sql`) is SECURITY DEFINER, checks membership/operator, and selects all agency requirement statuses. Local `workspaceFor` scopes requirements for non-HR. Site-scoped roles can get different aggregates; agency boundary is checked, site/role reach is broader than Local. | Audit SQL/RPC aggregate authorization first, using current modeled role boundaries; negative cross-agency and same-agency site tests. Do not widen Local to match broader hosted reach. |
| A-02 / high | Overview passes workspace.scorecard + visibleRequirements, but site selection narrows only `items`. Headline, donut, feed, and target table populations differ. GER swallows failures as empty. | Define each scope, align drill-down population, display unavailable/error separately from zero. Preserve intentional self-compliance scope. |
| A-03 / high | Audit Me is source-backed in part, but DMH/missing-requirement/training deadline/provider recertification slots are empty-fed (see C). | Wire real sources in small slices, or omit metric with reason. An Unknown checklist item is preferable to an unsupported compliance percentage. |
| A-04 / high | CommandCenter links mostly land at page level; house/team/status graphics lack record drill-down. | Use resolver/record IDs with existing routes and permission checks. Test actual click-to-record, not merely href strings. |
| A-05 / medium | Three Overview presentations repeat requirement compliance: headline cards, agency/site cards, house donuts; Audit Me adds a second weighted score. | Keep one canonical definition per measure and explain the two measures. Deduplicate display only after Anert flags simulation labels/retests. |
| A-06 / medium | Operational overtime rule catalog and Payroll hr_overtime_rules each own a weekly-hours threshold (work-week start is also an operational rule); clock grace vs accountability late-clock-in are another apparent overlap. | Distinguish pickup/risk tolerance from payroll pay calculation, and attendance flagging from disciplinary deductions. Do not delete or synchronize automatically; document ownership and test boundary examples first. |
| A-07 / medium | AgencyRulesPanel header comment says non-overtime categories only saved; actual consumers exist (B and rule section). | Correct explanatory copy after consumer/delivery verification. Do not classify all rule rows as false doors. |
| A-08 / medium | Consent type configuration is deliberately PM-only in UI, L/H, and RPC. Admin owner has no agency consent-type editor despite broad consent record access. | Product decision for Anert; do not “fix” by expanding roles in a navigation cleanup. |
| A-09 / medium | Kiosk adapter comment claims nonexistent hosted columns; current hrStore get/savePunchRules now uses migration-correct columns. | Historical warning is not a current reproduced defect. Validate current stores/migration instead of rebuilding kiosk settings. |
| A-10 / medium | AI settings duplicated under Settings/separate nav for platformAdmin; export/report entry points overlap; documents/templates spread across care and HR. | Discovery links and ownership map first. Operator-only AI is not an agency-admin dead door, and HR documents must not acquire clinical scope. |
| A-11 / low | Workspace-mode/setup copy and sample-only warnings/snapshot labels shown in hosted UI; provider code is read-only by design. | Review copy with deployment owner. Do not offer fake edit controls for immutable identity or absent billing. |

### Local/Hosted parity ledger

- **Present on both paths:** logo, monthly due, signature methods, role templates/membership operations, site facts, ISP/scoring/tasks, consent types/packets, medication orders/MAR/PRN, training/delegation/certificates, GER, corrective actions, score snapshots. Settings use several dedicated stores in addition to ComplyraApi: RulesStore, HrStore, OpenShiftStore. UI inventory must cover those too.
- **Confirmed divergence:** agency scorecard scope described in A-01. Formula structure agrees on status counts; authorized input populations do not.
- **Rule history divergence:** hosted RulesStore.history caps at 500 rows, local returns all agency rows. Long-lived agency history can be incomplete on hosted. Effective-rule resolution remains separate from display history.
- **Fallback hazard:** HostedApi operating-rule read falls back to defaults on RPC error; LocalRulesStore effectiveNow resolves local values. A permission/network failure can therefore change effective operational behavior on hosted without representing a missing setting. Investigate observability/fail behavior in a dedicated slice.
- **Background delivery differs by environment:** Local runs reminder sweeps during use; hosted includes client sweep plus scheduled function/SQL jobs. Source presence is verified, deployed cron/secrets/job success is not. Prove dedupe, cadence, and recipient scope with controlled hosted fixtures before claiming parity.
- **No evidence of a tenant setting available in exactly one API class** among the directly audited Settings-page controls. “Both methods exist” is not equivalent to parity certification. New billing/security/integration controls are absent on both, not hosted-only gaps.
- Current hrStore punch-rule column implementation matches migration; do not perpetuate the adapter's old mismatch as a confirmed defect. Dedicated-store authorization/RLS must be exercised independently; UI guards alone are insufficient.

## E. Founder-list gap analysis and billing reality

| Founder area | Existing coverage | Remaining gap / disposition |
| --- | --- | --- |
| Agency profile, locations, Individuals, staff | Agency identity/logo; site creation/facts/reviews, Individual intake/chart, staff membership | No full agency contact/address/legal/provider-profile editor; decide minimum schema and edit audit trail. Avoid duplicating site/Individual editors. |
| Accounts, roles, permissions, assignments | Role matrix, invitations, role/home-site and clinical assignments, reset-password flows | Discoverability and aggregate/record scope consistency; protect current grant hierarchy and last-admin safety. |
| Requirements, DMH, policies | Requirement register, extraction approval, policy document kind, DMH registry/readiness | DMH evidence wiring and explicit agency-required document/training policy sets. Code taxonomy is not an editable policy framework. |
| ISP, shifts, medication/PRN, incidents | Structured ISP/tasks/scoring/notes, shift coverage, MAR/orders/reconciliation/PRN, GER review/follow-up | Unified missing-note/medication-exception executive worklists with precise sources/site/time filters and record links. Reuse existing operating rules/reminders rather than invent thresholds. |
| Training, delegations, HR, scheduling, timekeeping | Working modules, readiness, binder presets, HR/pay/accrual/clock/staffing stores | Staff-count drill-down, setting discovery, overlapping threshold explanation and hosted parity evidence. Preserve payroll restrictions. |
| Forms, templates, signatures, approvals | Consent/right/delegation/binder templates, document packets, signature methods/adoption, extraction/requirement and clinical approvals | No generic tenant form/approval-chain designer. Propose only after identifying which fixed workflows actually need configurability. |
| Notifications/reminders/escalations/automation | Recipient notifications, read state, rule thresholds, sweeps, workflow templates | No tenant preference/channel/routing editor or user-authored rule engine; job health/delivery and escalation ownership not proven by UI. |
| Subscription/billing | **No tenant billing source found** | Proposal only: product/pricing decisions and schema/integration before a UI slice. |
| Security | Auth, role/RLS, reauth, immutable signatures, inactivity logoff, credential/kiosk management | No tenant security policy/MFA/SSO/integration admin portal; distinguish platform-managed policies from owner-editable options. |
| Integrations/audit logs | Supabase runtime, operator-only Vertex controls; activity log, signature and rule histories | No tenant integration registry/webhook credential UI; history completeness/export provenance needs definition. Do not present operator setup as agency integration configuration. |
| Dashboard interactivity/trends | Site filters, donuts, source rows, Audit Me snapshots/attention/deadlines | Consistent site/date filtering, record drill-down, honest unavailable states, sourced note/medication exceptions. No fabricated historical series. |

**Billing verdict and search evidence:** `Agency` in `src/data/types.ts` contains id/name/agencyCode/stateCode/provisioning/status/monthlyDue/logoPath, with no plan/customer/subscription/payment fields. Foundation `agencies` and subsequent migrations add tenant/access/branding-related fields, not a billing model. Case-insensitive search across `src` and `supabase/migrations` for subscription, billing, Stripe, invoice, pricing, plan_id found no tenant subscription/payment schema/API; plan_id matches are care-plan acknowledgement keys and invoice.paid appears only in a notification rejection test. No tenant billing page, permission, invoice/customer object, plan entitlement table or processor flow was found. This verdict covers repository evidence, not an assertion about services outside this repository. Do not infer billable usage from HR payroll or money ledgers.

## F. Proposed Phase 2+ slices (recommendation only; Anert orders execution)

Each row is **one PR** with unit tests, build, Local/Hosted behavior checks, role/site/agency negative tests where applicable, and independent Anert QA. No slice starts in this commission until Anert supplies the order. Billing is excluded from executable slices.

| Order | PR-sized slice | Acceptance / dependency |
| --- | --- | --- |
| 1 | Scope-safe agency scorecard parity | Repair aggregate authorization/populations in L/H/RPC; preserve HR/compliance modeled aggregate access, current roles and site assignments. Test two agencies and multiple sites, auditor reads/no writes. No visual redesign. |
| 2 | Overview scope and unavailable-state contract | Align numbers with active filter/drill populations, explicitly retain agency/self scopes, surface GER load failure. Tests count↔record equality and zero vs unavailable. |
| 3 | Record drill-down completion | Wire existing attention/deadline/requirement/certificate/action/plan links to source records via existing route vocabulary and resolver. Permission-denied and stale-record states; no renames. |
| 4 | Settings discovery and threshold ownership | Add gated links to existing care/HR/template settings; explain operational overtime vs payroll and clock vs accountability. Preserve editors and labels; flag any proposed renames to Anert first. No new grants. |
| 5 | Rule observability and history completeness | Remove silent rule-read/default ambiguity and paginate history with local parity; show effective/locked/future state accurately. Unit tests for RPC failure, >500 rows, scheduled changes, audit history. |
| 6 | Missing Shift Notes executive worklist | Reuse scheduled-shift/approved-ISP/note grace obligations and coverage helpers; add shared L/H list only if absent. Count with site/date/staff/source-note drill-down; phone QA. |
| 7 | Medication/PRN exception worklist | Separate missing/late/refused doses, overdue PRN follow-up and supply issues; shared existing rule semantics and real MAR/PRN/order records. No treating inventory as adherence. |
| 8 | Staff readiness drill-down | House team count opens the exact staff/evidence cohort; reuse existing personal/team/binder calculations and protect HR visibility. No new readiness formula. |
| 9 | Training deadlines and required-policy sources | Wire real training due dates plus explicit agency required-training/document policy source (schema/API only as needed). Remove corresponding empty-fed claims. Keep fixed categories until approved. |
| 10 | DMH provider/administrator evidence | Structured dated evidence with provenance for provider recertification and administrator prerequisites, L/H/RLS + deadline/readiness adapters. Leave other unknown DMH categories visibly unknown. |
| 11 | DMH incident/POC evidence | Connect GER and corrective-action evidence; add survey/POC dates only with defined ownership and real records. No invented deadline defaults. |
| 12 | Trend provenance and chart drill-down | Reuse saved snapshots; scope/date filters, formula version/evidence population, sparse-history state and historical drill-down feasibility. If snapshots lack retained source identity, add provenance before promising record reconstruction. Preserve Hallmark tokens and donut grammar. |
| 13 | Agency profile essentials | Only after field requirements agreed: agency contacts/legal/provider essentials with scoped persistence and audit history; preserve immutable provider code. |
| 14 | Notification delivery/automation transparency | Controlled job-health/dedupe/recipient verification, visible delivery limitations and existing rule ownership. Broader channel/routing configuration requires separate product decision. |

Separate proposals, **not ready implementation slices**: subscription/billing/entitlements (commercial model + tenant schema + processor architecture first); MFA/SSO/security policy configurability (ownership/security design first); generic forms/approval-rule builder (workflow requirements first); agency consent-type ownership changes (Anert decision on PM-only contract first).

All UI slices: use `src/tokens.css`, existing spacing and shared donut grammar; no gradients/decorative card edges; text/icon status in addition to color; “Individual/Individuals” and “Shift Notes”; desktop and phone review; money values wrap/remain fully readable. Every displayed number needs a real, authorized source and a matching drill-down. Unsupported metrics stay out with the reason recorded. Preserve working interactions, routes, permission keys, and simulation-sensitive labels until Anert has been notified and retests sequenced.

## G. Verification record

- Source inspection only against the pinned main revision; GitHub connector verified the local checkout matches main. Shell git fetch failed because the environment proxy was unreachable; no credential changes or production access were attempted.
- No application code, API behavior, schemas, or user-facing labels changed. This document is the sole intended PR diff.
- `npm test`: passed, 152 test-file entries, 0 failed, 0 skipped (runner enumerates `.test.ts`/`.test.tsx`; this is not Playwright or database integration testing).
- `npm run build`: passed (`tsc -b && vite build`). Vite reported existing mixed static/dynamic import and large-chunk warnings; no build failure.
- `git diff --check`: passed; only `docs/agency-admin-audit.md` is added.
- Hosted parity/RLS, running cron health, real agency production data, interactive desktop/phone layout and source-record clicks were **not** executed. Findings marked as source-derived must be reproduced/validated by the corresponding implementation PR; existing tests are not a substitute for those checks.
