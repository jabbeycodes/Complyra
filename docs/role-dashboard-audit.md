# Role dashboard and settings audit — Phase 1

## Authority, baseline, and evidence

Founder release order accepted for this commission. **AUDIT ONLY.** Deliver one draft PR against main adding this document, then stop for Anert's slice order. Never merge. Platform Operator and Agency Administrator implementation programs are excluded. No application, schema, permission, label, route, production data, or other branch changes are authorized here.

Source baseline: main `f3febdb95e1187e143d9dd57bf58782fbb0ce30d`, verified through GitHub's branch endpoint. The supplied checkout was `dd93278`; an isolated scratch copy was brought to the pinned main's file contents using all 18 files from the GitHub compare. The original checkout and the three in-review branches were not changed. Audit begun under the October 31 commission; completed November 4, 2026. Synthetic browser fixtures pin September 12, 2026, matching the seed, rather than pretending the September demo is current production.

Evidence notation: **present** = source implementation exists, not end-to-end certification; **verified** = named execution below; **gap** = missing requested behavior or conflict traced to code; **inherited** = earlier audit/simulation report, not independently reproduced here. All paths are repository relative; symbols are search anchors. L/H means `src/data/localApi.ts` and `src/data/hostedApi.ts`; dedicated stores are named separately. UI guards do not establish database authorization or deployment status.

Inherited material:

- Read `docs/agency-admin-audit.md`, especially A-01 through A-04 and its source inventories. Carry its source and parity caveats forward.
- Located the October 30 audit's provenance in merged [PR #178](https://github.com/jabbeycodes/Complyra/pull/178), which names `role-permission-audit-2026-10-30.md`, reports eight-role desktop/phone coverage, and fixes M1 (administrator Consents admission) and M2 (Kiosk tab offered without a passing gate). The standalone report was not found in current docs or searched recent history. Do not invent its checklist/results. Anert's report reference and batch log were requested in the commission thread; not supplied when this audit was prepared.
- Main already includes #196 staff scope repair, #197 hosted Shift Notes fixes (batch 9 finding 1), #199 delegation/current-recipient and site-scoped corrective actions (batches 7, 10), #200 medication cluster (batches 7/9/10/11/13), #204 medication notice types, and #203 wave 4A including nurse phone scope (batch 17). Batch references here come from repository/PR evidence; the full continuous simulation log remains unavailable. Unnumbered founder-reported observations below must be matched by Anert, not assigned guessed batch numbers.

## Reserved overlap: baseline end-state, not new defects or slices

| Existing owner | Assumed end-state for every role | Audit disposition |
| --- | --- | --- |
| [#208](https://github.com/jabbeycodes/Complyra/pull/208), head `2b296c9` at inspection | Authorized requirement population in scorecard RPC/L/H, active-assignment sites locally, HR aggregate-only access, source-date statuses, invalid hosted response rejected | A-01 pattern for all seven roles is **overlap owned by #208**. Do not propose another scorecard scope repair. |
| [#209](https://github.com/jabbeycodes/Complyra/pull/209), head `8831d0c` | Selected-register population aligns headline/status/site cards; empty or unavailable is not passing; requirements distinguished from weighted Audit Me; GER scope/errors and monthly attention surfaced; HR care population unavailable | A-02 pattern and Overview-versus-Audit Me complaints for PM/HR/compliance/auditor are **overlap owned by #209**, with #208 as relevant. Compare intended measures, never force them to the same denominator. |
| [#211](https://github.com/jabbeycodes/Complyra/pull/211), head `7ad3a93` | Read-only source dialogs for attention/risks/deadlines/actions, score cohorts and chart legends; authorized-loaded-record selection fails closed for unknown IDs; historical trend limitation explained | A-04 pattern for roles using these shared surfaces is **overlap owned by #211**. No duplicate generic drill-down slice. Historical source versioning remains a later shared need. |

These PRs were open drafts at inspection. Their metadata/declared contracts were read to establish ownership, not re-reviewed or certified. None was checked out, modified, merged, or executed as part of this commission. Main-only runtime observations below are not regressions against their assumed end-state. A-03/D-01 (empty-fed readiness inputs) is outside those three contracts and remains open, coordinated with the agency program's later evidence slices.

## Shared navigation, scope, settings, and metric contracts

Navigation uses page state plus encoded hashes (`src/App.tsx`: `navigate`/`applyHash`), `src/data/status.ts`: `pageVisible`/`defaultLandingPage`, and `features/notifications/notify.ts`. Preserve this vocabulary. `permissions.ts` role templates are defaults; saved agency maps can differ. Role-list helpers also exist and must be audited alongside permission keys. A role's declared `defaultScope` is not proof that record scope follows that string.

Scope sources: `data/access.ts` (`canReadIndividual`, `canActAtSite`, `assignmentCoversSite`, `correctiveActionInScope`), `data/dashboard.ts` (`sitesVisibleTo`, `canAccessSite`), `20261031160000_staff_scope_repair.sql`, and module RLS/RPCs. Agency-wide roles currently include PM, compliance, HR and auditor. HM/nurse use membership home plus active assignments; NULL home alone grants no caseload. DSP historical read intentionally ignores assignment end dates for corrections, while new delegation recipients require current assignments. Preserve that deliberate distinction; do not apply one simplistic assignment predicate everywhere.

| Shared surface | Evidence and data source | Current assessment |
| --- | --- | --- |
| Overview | `Dashboard.tsx`, `App.tsx`, workspace requirements/monthly/site reviews; `personalQueue` in `data/dashboard.ts` | Shared care/management presentation, not a tailored daily cockpit for every role. DSP is denied Overview by `pageVisible`. #208–#211 own score/population/drill-down contracts. |
| Audit Me | `components/CommandCenter.tsx`, `complianceScore.ts`, `riskRegistry.ts`, `deadlineTimeline.ts`, `auditReadiness.ts`, `missingRequirements.ts`; L/H certificates/clearance/checklists/actions/inventory/snapshots | Weighted readiness is separate from requirement currentness. Present risks, actions, timelines, sparse real history. DMH/training/policy sources remain incomplete (R-04). |
| Employee readiness | `features/personalCompliance/usePersonalCompliance.ts`, `personalCompliance.ts`, `data/hr.ts` rollups, `hrStore.ts` | Reuse same personal/team computation; binder completion is a distinct measure, not an agency care score. Do not invent another readiness formula. |
| Phone home | `features/mobile/MobileShell.tsx`, `today.ts`, `useTodayTracking.ts`, `tiles.ts`, `bottomNav.ts` | Home selector + gated tiles, ≤5 bottom destinations, shared APIs. `pickMobileScopedSite` fixes arbitrary first-home selection (batch 17). Home-first navigation still burdens HR/agency reviewers (R-08). |
| Settings | `App.tsx` Settings branch | Universal agency summary, provider code, backend diagnostic, access shortcut, gated report, logo/monthly settings, signature methods, advanced/demo reset. This is not a personal preferences/security editor. |
| Agency settings writes | `branding.ts`/`AgencyLogoSettings`, `monthlyChecks.ts`/`MonthlyDueSettings`, `SignatureSettingsSection`, `AgencyRulesPanel` | Logo/monthly controls admit compliance/PM/admin; policy rules and signature-method edits are administrator-only. Read-only signature method display is not a personal preference. Do not automatically expand grants. |
| Profile and security | `App.tsx` profile modal, `features/signatures/ProfileSignatureSection.tsx`, `security/InactivityGuard.tsx`, auth/signature APIs | Identity display, signature adoption, sign out, reauthentication/inactivity exist. No general profile/availability/notification preference/account-security settings hub was found here (R-05). |
| Notifications and ownership | `features/notifications/*`, `data/operatingReminders.ts`, `data/rules.ts`, `supabase/functions/sweep-operating-reminders`, corrective actions, GER, delegation and HR stores | Real recipients/read state/reminders and fixed approvals exist. A workflow-template list does not prove configurable automation or successful cron delivery. Personal channels/preferences are distinct from agency escalation policy. |

## Role-by-role checklist

### 1. Compliance Administrator / QA Director (`compliance_admin`)

| Checklist | Status and evidence |
| --- | --- |
| Dashboard: scores, overdue register, corrective actions, readiness/trends | **Present**: Overview + Audit Me (`audit.read`, `correctiveActions.manage`), L/H source lists and saved snapshots. Score contradiction/drill-down complaints belong to #208–#211. **Gap**: DMH/missing-document/training evidence is incomplete (R-04); no claim of complete readiness. |
| Evidence verification, approvals, deficiency workflow | **Present**: Documents/Extraction review/Review queue, `documents.review`, `requirements.approve`, corrective action APIs; `QA Review` is reachable through `audit.read`. **Gap**: template deliberately excludes all `qa.*`; QA Director cannot score/finalize/schedule by default, while auditor can (R-01). |
| Agency-wide monitoring and consent completeness | **Present**: agency-wide sites/Individuals in `dashboard.ts`/`access.ts`. **Gap**: `status.ts` Consents and `data/consents.ts` `canSeeConsents` exclude compliance administrators (R-06); Overview embeds consent attention. Verify behavior/error before assuming that summary is complete. |
| Settings: rules, monitoring frequency, alerts, escalation, reporting | **Present**: logo/monthly due/report access; Roles & access through `roles.manage`; shared rule values consumed operationally. **Gap**: rule editor is exact administrator; no clinical/compliance preference/routing editor. Separate delegated policy rights from personal preferences (R-05). |
| UI improvement | Show daily deficiency/evidence/action work with explicit source coverage; retain existing audit modules; gated settings discovery instead of a second settings store. Phone agency reviewers should not need an arbitrary home for agency work (R-08). |
| Current-state tests | Local synthetic Omar: 2 sites, 4 Individuals, 11 staff, 24 requirements. Desktop nav/Settings and phone entry exercised; all-role gate/permission unit suites executed. Hosted policy, notification delivery, exports and complete QA lifecycle not executed. |

### 2. Program Manager (`program_manager`)

| Checklist | Status and evidence |
| --- | --- |
| Dashboard: sites/Individuals, staffing, incidents, approvals | **Present**: Overview, Scheduling (`SiteCoverageBoard`, shift accountability), GER sections, Review queue, appointments, Audit Me and corrective actions. L/H plus HrStore/OpenShiftStore. **Gap**: no unified missing Shift Notes/medication-exception/appointment/approval daily worklist; use sources from existing modules (R-07). |
| Review documentation and assign/track corrective work | **Present**: ISP configuration via `canConfigureIspTasks`, `documents.review`, `requirements.approve`, `correctiveActions.manage`, `ger.review/resolve`, QA dispute/schedule, existing action ownership/due/status and histories. Full cross-role handoff not certified. |
| Assigned-site permissions | **Gap/product decision**: `defaultScope: program`, but `AGENCY_WIDE_ROLE_KEYS`/`canAccessSite` grant all agency sites; neither a program label nor dashboard filter constrains access (R-03). Current two-site LocalApi output confirms all sites. Do not narrow until Anert defines program assignment. |
| Settings: site oversight, staff assignment, reporting/notifications | **Present**: site review, ISP config, PM-only agency consent-type configuration, monthly due/logo; hub scheduling/pay/staffing keys. **Gap**: personal preferences/escalation routing absent; exact ownership discovery needed (R-05). PM lacks Staff page by default despite password reset and broad hub authority; clinical assignments and employment role assignment are different workflows. |
| UI improvement | Prioritize at-risk houses and approvals, with exact queue ownership and preserved labels. Any PM scope or permission change requires simulation retests coordinated by Anert. |
| Current-state tests | Melissa: 2 sites, 4 Individuals, 11 staff, 24 requirements; desktop nav/Settings and phone picker exercised. Source-backed scope/coverage/action tests ran. Score findings reserved to #208–#211. Hosted program assignment/notifications/full approval flow untested. |

### 3. House Manager (`house_manager`)

| Checklist | Status and evidence |
| --- | --- |
| Dashboard: shifts, coverage, Individuals, tasks/site compliance | **Present**: Overview, Scheduling/shift accountability, phone home/Your shift/tracking/My Tasks, weekly checklists, GER, appointments and medication supply. **Gap**: structured handover and combined missing-note/medication-count/appointment follow-up queue not established (R-07). Inventory projection is not proof of medication administration. |
| Staff supervision, reviews, escalation | **Present**: `hr.view_staff`, hub team/schedule/timecard/time-off/staffing; `correctiveActions.manage` added by #199 with site/assignee checks and QA action form (batch 7). Requirement approval remains denied by default; do not replace it with HM clinical approval. |
| Another home's staff | **Inherited + source-supported risk**: Local workspace filters membership staff to visible home/self, but Hosted workspace reads agency memberships/profiles and broad select policies remain (R-02). Local Willow output does not reproduce the hosted leak; do not declare production fixed from local success. |
| Settings and assignments | **Present**: permitted staffing patterns and team operations in hub; account/signature display. **Gap**: no site-notification/shift-handover/documentation preference section; agency policy is not a per-house user preference. No new assignment grant inferred. |
| UI improvement | One daily house queue, touch-friendly recording and exact count/evidence links; reuse existing site/shift/GER modules. Preserve the current corrective-action repair. |
| Current-state tests | James: Willow only, 2 Individuals, 3 staff, 12 requirements; desktop/phone entry and settings examined. Staff scope on LocalApi verified. Hosted another-home staff negative test and handover/notification/approval E2E remain required. |

### 4. Direct Support Professional (`dsp`)

| Checklist | Status and evidence |
| --- | --- |
| Simple daily dashboard | **Present**: no Overview; phone home with Your shift/tracking/My Tasks, assigned Individuals, ISP Data, health/Quick log, acknowledgments and own hub. `MobileIsp` saves the shared Shift Notes API; no duplicate note store. **Gap**: desktop defaults to Individuals with many secondary navigation entries (R-09). |
| Daily support, assigned forms/notes/incidents | **Present**: `requirements.complete`, `acknowledgments.sign_own`, `ger.create`, `behavior.record`, `health.record`; shared chart/shift/consent forms and incident notifications. Existing typed money/health/field-log flows should be preserved. |
| Medication within authorization | **Gap/in-flight overlap**: `canLogDoseException` includes DSP and `markMedDose` checks role, Individual scope and timing, but the inspected local path does not call the training clearance gate. Founder reports uncleared new hires recording doses; owner/fix in flight must be identified before scheduling (R-10). Do not treat a visible MAR tile as authorization. Audit scheduled/PRN/correction/exception paths independently in L/H/RPC. |
| Role-only navigation and scope | **Present**: page gates exclude Staff, Roles & access, Review queue, Audit Me and Medication orders. **Gap**: Requirements/Activity log/Delegations/Supply forecast and broad Settings remain admitted; founder's admin-style sidebar complaint matches the crowded operational navigation (R-09). These pages may have valid read tasks; do not remove functionality without mapping it. DSP historical access is deliberate (scope contract above). |
| Profile, notifications, availability, security | **Present**: signature adoption, self hub, sign out/inactivity/reauth. **Gap**: requested personal editor/preferences/availability/account security experience not delivered by current Settings (R-05). Keep availability separate from approved time off and roster assignment. |
| UI improvement | Start with today's assigned work; retain full history by a secondary path; reduce taps without changing labels/routes. Check 44px targets, keyboard/focus, error/retry, unsaved work and 390px overflow in each recording flow. |
| Current-state tests | Alex Morgan: Cedar only, 2 Individuals, 3 staff, 12 requirements; LocalApi scope and page admission verified. Browser run uses the corrected seeded username `alex.morgan`; the initial wrong-username attempt is excluded from coverage. Full authorized-medication and offline/save/retry behavior remain unverified. |

### 5. Nurse / Clinical Supervisor (`nurse`)

| Checklist | Status and evidence |
| --- | --- |
| Clinical dashboard | **Present**: Overview, medication orders/reconciliation, supply, chart MAR/PRN, clinical renewals, appointments, delegations/training, GER/health alerts. `canManageMedicationOrders`, `canSignReconciliation`, `delegation.assign/training.review/training.approve`, L/H. **Gap**: no one clinical queue combining due PRN effectiveness, medication documentation exceptions, expiring orders, appointments and delegation competency (R-07). |
| Caseload/review boundaries | **Present**: explicit home/active assignment scope for Individuals, separate agency-wide clinical review widenings for GER/behavior/health with constrained correction RPCs/history. Preserve review versus ordinary write distinctions; NULL site must not imply all care-record writes. |
| Phone home defaults to house | **Landed inherited fix**: main #203 `pickMobileScopedSite`/`queueItemsForHome`, `today.test.ts`, batch 17. No arbitrary first house when several are visible and no stored/member home; picker instead. Single-home Cameron correctly opens Cedar. Multi-home production replay remains Anert QA, not a new defect or replacement fix. |
| Clinical preferences/workflow settings | **Present**: order-specific and delegation configuration in clinical modules; **gap**: no personal clinical-alert/review/escalation settings area (R-05). Agency MAR timing rules remain agency policy. |
| UI improvement | Clinical exception-first home with source dates/ownership; distinguish supply from adherence, and missing follow-up from zero. Reuse shared task/evidence dialogs; do not duplicate med semantics or widen clinical permissions. |
| Current-state tests | Cameron: Cedar, 2 Individuals, 3 staff, 12 requirements; desktop/phone exercised; main phone-scope helper tests executed. Multi-site clinical-review/correction database tests and complete order → dose → PRN follow-up → alert workflow not run. |

### 6. HR Manager (`hr`)

| Checklist | Status and evidence |
| --- | --- |
| Onboarding, certificates, staff readiness | **Present**: Staff, Training, Certificates, Employee Hub Binder Board/templates/performance, readiness/evidence stores; `hr.view_staff`, `certificates.manage`, `members.invite/assign_roles`. Care records intentionally absent. **Gap**: generic Overview lacks a consolidated HR daily worklist for onboarding/training/certificates/attendance/approvals (R-07). |
| Scheduling/timecards/attendance/payroll | **Gap**: template grants `hub.access`, `hub.manage_staffing`, `hub.manage_pay_settings` but omits `hub.manage_schedule`, `hub.view_team`, `hub.review_timecards`, `hub.approve_time_off`, `hub.approve_payroll`, `hub.manage_documents`. `EmployeeHubPage` manager tabs gate on those keys; Kiosk/pay settings are not equivalent to payroll preparation. Requested HR operations are not delivered by default (R-03). |
| Settings: onboarding, training, templates, policies | **Present**: BinderTemplateEditor, readiness requirements, staffing/pay/punch-rule editors via dedicated stores and module gates. **Gap**: discoverability and notification preferences; validate actual grants for each editor, not presence of its component. Operational overtime vs payroll calculation and accountability grace vs clock rules remain distinct. |
| Permissions | **Verified local**: zero Individuals/requirements while agency aggregate may exist; no Audit Me or care charts. Preserve grant hierarchy so HR cannot grant privileged administrator/compliance roles. Any new HR workflow grant needs UI/API/RLS parity and Anert approval of scope. |
| UI improvement | HR-specific home and staff queues; phone should offer staff work without requiring a care-home choice (R-08). Use existing binder/readiness data, not a fabricated care compliance percentage. |
| Current-state tests | Tanya: 2 sites, 0 Individuals, 11 staff, 0 care requirements; desktop/phone entry checked, LocalApi isolation verified; permission/hub/binder/store unit tests ran. Hosted payroll/attendance correction/approval security and complete onboarding workflow untested. |

### 7. Auditor / Read-Only Reviewer (`auditor`)

| Checklist | Status and evidence |
| --- | --- |
| Readiness/findings/evidence review | **Present**: Overview/Audit Me, QA Review, requirements/documents, Activity log, permitted report catalog/runners. `audit.read/export`, `individuals.view`, `clinical.view`; read-only source dialogs assumed from #211. Missing DMH evidence remains R-04. |
| Strict no editing/approving | **Verified conflict R-01**: default `qa.audit` grants creation, scoring, finalization and dispute decisions in QA UI/APIs/RLS. Isolated LocalApi auditor successfully created a fourth-quarter audit. This is actual write authority, not only visible controls. Compliance role excludes these keys. Resolve reviewer versus audit-author responsibilities explicitly; do not silently transfer grants. |
| Other read-only protections | **Present**: no requirement approval/completion/upload/corrective-action/med recording keys; messaging explicitly excludes auditor even if misgranted. Medication mutation-control fixes already landed #200 (batch references 7/9/10/11/13, exact individual finding mapping pending). Do not claim all mutation surfaces safe from those checks alone. |
| Authorized scope/export | **Present**: agency-wide reader by current model, per-report allowlists in `features/reports/reportLibrary.ts`, source runners and RLS. **Gap/question**: description says time-limited but no engagement-specific site/Individual restriction is established by role name; test expiry and export/read scopes explicitly before claiming engagement-limited review. Do not expand HR employment access for an audit report. |
| Settings: personal/security/report preferences only | **Gap**: shared Settings still contains agency/backend/signature-policy/data-reset chrome; personal/reporting preferences absent (R-05). Demo reset is local-only, not a production agency write, but inappropriate reviewer navigation. |
| UI improvement | Review/search/evidence/history/export first; no change controls. Keep unavailable and missing evidence distinct; preserve permitted source dialogs/exports. |
| Current-state tests | Mark: 2 sites, 4 Individuals, 11 staff, 24 requirements; desktop/phone entry and Settings checked; actual QA creation reproduced in memory only. Full auditor mutation-denial/expired-session/export/notification database matrix remains mandatory. |

## Findings and risk ledger

| ID / priority | Finding, evidence, scope and ownership |
| --- | --- |
| R-01 / critical | Auditor can author/decide QA records despite this commission's strict read-only requirement: `permissions.ts` auditor `qa.audit`; `QaAuditsPage` `canAudit`; L/H `createQaAudit/scoreQaItem/finalizeQaAudit/resolveQaDispute`; `20260915022000_qa_audits.sql` permission-based write policies. Verified LocalApi creation. Compliance/QA Director excludes `qa.*`. Product conflict requiring deliberate role allocation, not a sidebar-only fix. Founder auditor-controls report matches; exact batch unavailable. |
| R-02 / high | Hosted staff cohort is broader than local for site-scoped staff: HostedApi `loadWorkspace` reads all agency memberships/profiles and maps them; foundation `memberships_select` uses `has_agency`, `profiles_select` shared agency, with no replacement found in searched migrations. LocalApi `toWorkspace` filters membership staff by self/visible home. This supports founder HM-other-home-staff report; hosted execution not reproduced. Separate staff-directory/messaging legitimate recipient needs from confidential HR records, hub cohorts and displayed counts; do not globally restrict profiles without dependency analysis. |
| R-03 / high | Role-to-workflow contract mismatches: HR default hub keys omit requested management operations; PM scope is effectively agency-wide despite program/defaultScope language (`permissions.ts`, `dashboard.ts`, hub gates). Local outputs verify both. Decide grants/assignment model with Anert; never solve by broadening care access. |
| R-04 / high / shared overlap | D-01 persists beyond #208–#211: CommandCenter passes `trainings: []`, `providerRecertification: null`, provider/administrator/POC evidence null, `incidents: []`, required certificate/training/Individual-document lists empty. Supported helper inputs do not establish fed panels. Applies compliance/PM/HM/nurse/auditor wherever Audit Me admitted; HR/DSP have no Audit Me. Coordinate later agency-admin evidence slices; no duplicate evidence policy implementation. |
| R-05 / medium | Shared Settings is agency-oriented; personal notification/reporting/security/availability preferences are absent. Profile is mainly display/signature/sign-out. Compliance/PM have some agency edits, HM/DSP/nurse/HR/auditor mostly generic chrome. Agency rules ≠ user preferences ≠ platform configuration. Settings discovery overlaps agency-admin slice 4; personal persistence/auth needs are separate, with explicit permitted fields and L/H parity. |
| R-06 / medium | Compliance administrator absent from Consents role-list gates despite agency oversight needs; PM-only type editor remains deliberate. `status.ts` and `consents.ts` agree on exclusion, so not UI/API drift. Need Anert decision on read oversight and safe summary behavior; no automatic consent-type mutation grant. |
| R-07 / medium | Daily role work is distributed across existing modules rather than joined by role-specific exception queues. `Dashboard.tsx`, Scheduling, `dueItems.ts`, `shiftAccountability.ts`, orders/PRN, appointments, GER, Binder Board and hub stores provide sources. Missing aggregate worklists must reuse them and show population/date/error/owner; no hard-coded feed and no second readiness formula. Worklist overlap with agency-admin later Shift Notes/medication/staff-readiness slices must be coordinated. |
| R-08 / medium | Phone requires multi-home selection even for HR and agency reviewers (`MobileShell`, `sites` initial view); reproduced with Tanya/Omar/Melissa/Mark. Batch 17 arbitrary-home bug is already fixed; role-oriented agency work entry remains distinct usability work. |
| R-09 / medium | DSP desktop sidebar is too broad for fast daily work even while major admin pages are hidden (`pageVisible` and nav rendering). Requirements/Activity log/Delegations/Supply forecast/Settings retain useful functions but need task-oriented discovery. Do not confuse a read link with a backend privilege leak. Founder navigation report matches, batch pending. |
| R-10 / high / in-flight overlap | New-hire medication authorization defect is founder-reported/in flight; local scheduled-dose mutation has role/scope/time gates but no training-clearance check found in `markMedDose`. Training gate exists elsewhere. Confirm fix owner/head with Anert and retest all medication mutation paths; do not open a competing fix or claim deployed resolution. |
| R-11 / medium | Existing tests may validate earlier product intent that contradicts this commission: auditor QA writes are intentional in old tests. Passing suites do not prove read-only compliance. Local/hub/RLS tests, actual negative writes, source cohort equality and synthetic cross-role handoffs are all needed after authorized changes. |

### A-01–A-04 pattern disposition for every role

| Role | A-01 scope | A-02 headline/population | A-03 empty-fed evidence | A-04 drill-down |
| --- | --- | --- | --- | --- |
| Compliance | #208; staff risk R-02 | #209 | R-04 applies | #211 |
| PM | #208; program model R-03 | #209 | R-04 applies | #211; new queues need own links |
| HM | #208; hosted staff R-02 | #209 | R-04 applies | #211; team records still need exact cohort |
| DSP | #208 workspace; historical scope intentional | No Overview; daily tracking has separate real denominator | No Audit Me; medication authorization R-10 | Shared chart/task flows, not claim of #211 daily-flow completeness |
| Nurse | #208; clinical-review widenings preserved | #209; batch 17 landed phone fix | R-04 applies | #211; new clinical queues need links |
| HR | #208 aggregate-only, no care rows | #209 unavailable care text | No Audit Me; binder/readiness not care score | Staff/binder flows; no unauthorized care drill-down |
| Auditor | #208 authorized reads; QA write conflict R-01 | #209 | R-04 applies | #211 read dialogs; other mutation paths R-01 |

## Local/Hosted and cross-role workflow audit

Both API classes implement care work, medication/order/PRN, notes, actions, certificates, delegations and QA; HR/readiness/binder/pay/timekeeping and rules use additional dedicated stores. Method presence alone is not parity. Confirmed or source-supported risks: staff population R-02, local assignment-site input (reserved #208), in-flight clearance gate R-10, silent hosted operating-rule fallback and bounded rule history inherited from agency audit. No live hosted calls or production writes were made.

| Workflow | Existing connection / evidence | Required independent acceptance after an authorized slice |
| --- | --- | --- |
| DSP note → HM/PM review | `saveShiftNote`, approved ISP/tasks, scheduled shift obligations, accountability engine, signature history; #197 batch 9 hosted fix | Assigned shift → save → reopen exact note/signature → missing-note count clears → authorized supervisor sees it; foreign/site users denied. |
| DSP incident → nurse/PM → action | GER create/submit/review/resolve, notification targets, `correctiveActions.manage`, site/QA IDs and owner/due/status | Notification recipient can open exact event; no other-home visibility; assignment/completion and audit trail persist; failed delivery visibly distinguishable. |
| Order → authorized dose → PRN follow-up | Orders/reconciliation, MAR marks, PRN reason/effectiveness, reminder sweep, med cluster migration | Untrained/uncleared actor rejected server-side and locally; scheduled/PRN/exception/correction cannot bypass; nurse follow-up clears alert exactly once. Anert owns in-flight medication fix. |
| HR onboarding → readiness → staffing | Binder templates/evidence, training/certificates, `evaluateInRatioGate`, scheduling/hr stores | Clearance changes real staff readiness; staffing/payroll uses correct permission and population; no care access added; approval and export auditable. |
| Auditor finding → PM/HM correction → reviewer verification | QA items/disputes/actions and signatures/history already connect, but auditor currently writes | Under this commission reader cannot create/score/finalize/decide; explicitly authorized audit author handles those operations. Verify negative API/RPC writes, not only hidden buttons. |

## Proposed implementation slices — recommendations only

Anert supplies the actual order; each row is one PR, separate PR-review agent gate and Anert QA. **Do not begin any row from this audit.** No merges. No blanket redesign across all roles.

| Risk order | PR-sized slice | Acceptance and dependency |
| --- | --- | --- |
| 1 | Strict reviewer QA write boundary | R-01 decision: explicit audit-author ownership, current stored template migration strategy, UI/API/RPC/RLS denial, Local/Hosted parity; viewer cannot create/score/finalize/resolve by guessed IDs or stale sessions. Do not simply hide controls. |
| 2 | Site-scoped staff directory and dashboard cohort | R-02: distinguish directory recipient needs vs HR records; exact permitted staff in workspace/HM summaries/selectors, assignment/ended/NULL cases, two agencies/two homes, L/H parity. Does not duplicate scorecard #208. |
| 3 | HR timecard and attendance review access | R-03: only after approved role decision, grant and implement scoped review/correction/approval gates in all layers; reject care access and unauthorized staff. Separate payroll authority from this PR. |
| 4 | HR payroll preparation access | Approved payroll/document ownership, existing hub/store UI integration, lock/export/audit trail and negative tests; depends on HR role decision, not a new payroll engine. |
| 5 | Program Manager site/program scope contract | Anert decides whether all-agency is intended; if narrower, one explicit assignment model in L/H/RLS and lists, preserving existing routes/keys. Document migration/backfill and negative tests; no inferred new permission. |
| 6 | Compliance consent oversight | Read-only consent completeness/attention scope with source/errors and matching chart links; preserve PM-only type settings until separately authorized. |
| 7 | DSP task-oriented desktop home/navigation | R-09: reuse phone queue/shift/Individual sources; preserve access to necessary records; test clicks/back/keyboard/390px. Flag label/route changes to Anert before any implementation. |
| 8 | Nurse clinical exception queue | Real MAR/PRN/order/appointment/competency sources, owner/date/filter/drill-down, unavailable states; coordinate medication fix and agency-admin med-worklist slice. No parallel medication formula. |
| 9 | PM/HM daily operations worklist | Real shift coverage/missing notes/appointments/incidents/actions; reuse agency-admin note/staff-readiness slices rather than duplicate them. Count equals authorized rows and completed work clears across roles. |
| 10 | HR daily staff worklist | Existing binder/training/certificate/readiness/attendance sources, exact staff cohort and document links; no fabricated percentages, dependency on approved HR workflows. |
| 11 | Agency-work phone entry | R-08: HR/compliance/PM/reviewer can enter authorized agency work without arbitrary house choice; keep explicit home choice for house-scoped work and preserve batch 17 safety. |
| 12 | Personal notification/report preferences | Define only persisted user-owned fields and actual consumers; settings boundaries and L/H parity, separate from agency escalation rules. Coordinate agency settings discovery slice 4. |
| 13 | Personal profile/security/availability essentials | Product-approved editable profile/availability/security scope with real auth/store consumers; preserve signature/reauth and account identity constraints. Split further if auth/security changes exceed one reviewable PR. |

Reserved work, **not additional competing slices**: #208–#211; new-hire med clearance fix (identify owner before any work); agency-admin DMH/training/required-policy evidence and trend provenance; agency settings discovery/threshold ownership/rule observability. Anert must assign one owner and shared source contract for overlapping queues/evidence work.

All UI acceptance: Hallmark `src/tokens.css`, existing shared donut grammar, consistent spacing/type/borders/forms/tables, no gradients, status text/icon beyond color, Individual/Individuals and Shift Notes terminology. Phone checks include touch targets, readable/wrapping totals, focus/errors/retry, no horizontal overflow and minimal taps. No route, permission key or user-facing label rename until flagged to Anert for simulation retests. Unknown metrics stay unavailable with explanation; a legitimate zero requires a loaded authorized population.

## Current-state verification and limits

- `npm run build`: passed on the isolated pinned-main contents. Existing Vite mixed import/chunk-size warnings remain.
- `npm test`: 162 test-file entries, 161 pass, 1 fail (`src/data/medCluster.test.ts`), 0 skipped. A targeted rerun with Node TAP reporter passed that file (1 file, 0 failures). Cause of the full-run failure was not established; do not report the full suite as green. Existing tests cover scope, permissions, QA, actions, shifts, medication, HR/binder, mobile helpers, reports and notifications, but do not assert this commission's entire contract.
- Seven fresh in-memory synthetic sessions verified role keys, default grants, permitted page lists and workspace populations quoted above. A separate fresh auditor session successfully called `createQaAudit`; only fictional in-memory data changed. This substantiates R-01 without writing production records.
- Chromium desktop (1440px) and phone (390px) sign-in/home/navigation smoke used fictional Evergreen accounts. The corrected run successfully signed in all seven roles at both sizes (14 sessions), inspected desktop sidebar/Settings and phone home or home-picker entry, and observed no document-level horizontal overflow on those inspected surfaces. DSP desktop sidebar confirmed the secondary pages in R-09. Phone Settings and full task interactions were not reached by this smoke. The initial incorrect DSP username and server-unavailable retry attempts are excluded from coverage. This is not every-button/form or full workflow certification.
- Source inspection includes schema/RLS/RPC definitions; no hosted database, deployed migration/cron, production notification delivery, real-record exports, expired membership, or full cross-role end-to-end test was executed. Synthetic Northstar production simulation remains Anert's independent evidence source. Its batch log and standalone October 30 report are outstanding evidence, not permission to invent results.
- Phase 1 has identified gaps and proposed ordered slices only. Implement/fix/retest belongs to Phase 2 after Anert's order. Stop after the single draft PR; separate review-agent gate remains mandatory.
