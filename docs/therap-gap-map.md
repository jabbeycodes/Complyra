# Core-operations gap map — ComplyRer vs. the established EHR functional taxonomy

Internal planning document. Written 2026-10-27 against `main` at `2d96fea`
(merge of PR #116). Every status below is backed by code evidence in this
repository; wording is ComplyRer's own throughout.

Status key: **Present** = a working surface exists · **Partial** = some pieces
exist but the workflow is incomplete · **Missing** = no surface exists.

Priority is judged for residential-provider core operations (the homes, the
people who live in them, and the staff who support them day to day).

---

## 1. Work queues, messaging, scheduling

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Priority work queue (personal to-do by urgency) | Present | Overview dashboard personal queue + priorities panel (`src/Dashboard.tsx`, `src/data/dashboard.ts`, `src/data/attentionFeed.ts`) |
| Due/overdue item detection across modules | Present | `src/data/dueItems.ts` (shift-note and medication due detectors), `src/data/deadlineTimeline.ts` |
| Internal staff messaging | **Missing → built in this batch** | Staff inbox with participant-only threads, per-participant read state, optional link to one Individual (chart card lists linked threads for participants only), visible "added" system notes, and a deduped `message.received` bell notification (`src/features/messaging/`, `src/data/messaging.ts`, migration `20261027150000_internal_messaging.sql`). Auditors are excluded by design — messaging is staff communication, not a compliance record surface |
| Appointments / scheduling (per Individual) | Present | `src/data/appointments.ts`, Health card appointments tab, agency Appointments page |

## 2. Per-person record

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Daily / shift logs | Present | Shift notes (`src/features/isp/ShiftNoteSection.tsx`, `src/data/shiftNotes.ts`, migration `20260917120000_issue80_shift_notes.sql`) |
| ISP data collection against plan objectives | Present | `src/features/isp/IspConfigSection.tsx`, `src/data/planStack.ts` obligations |
| Behavior data + behavior plans | **Missing → built in this batch** | Only a free-text `behaviorSupports` profile field (`src/data/planStack.ts`); no plan structure, no behavior log |
| Consents / authorizations | Partial | E-signature packets and acknowledgments exist (`src/data/types.ts` packets, `src/features/signatures/`); no per-person consent register with expiry |
| Documents on the chart | Present | Assigned documents panel + document uploads/extractions (`src/features/AssignedDocsPanel.tsx`, `src/data/documents.ts`) |
| Demographics / contacts / coverage | Present | `IndividualProfile` in `src/data/planStack.ts` (guardians, provider contacts, Medicaid status, waiver, language) |
| Significant life events | **Missing → built in this batch** | Per-Individual timeline on the chart (`src/features/lifeEvents/LifeEventsCard.tsx`, `src/data/lifeEvents.ts`, migration `20261027190000_life_events.sql`): fixed category list, optional link to one event report, editor-recorded (HM/PM/nurse/admin/compliance), DSP + auditor read, void-with-reason instead of delete, no alerts by design |

## 3. Events and incident reporting

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| General event reports (GER) | **Missing → built in this batch** | No GER module, tab, or table on main (an earlier GER build lived on an unmerged branch only) |
| Resolution / investigation follow-up lifecycle | **Missing → built in this batch** | Corrective actions (`src/data/correctiveActions.ts`) track audit findings open → in progress → resolved, but nothing tracks an event report to resolution |
| Multi-individual events | **Missing → built in this batch (linked individuals on a report)** | n/a until GER exists |
| Event summaries / counts | **Missing → built in this batch (dashboard section)** | n/a until GER exists |

## 4. Plans

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| ISP programs + data (objectives, scoring) | Present | `src/features/isp/`, plan stack obligations, monthly data-collection report |
| Plan approval + acknowledgement | Present | Acknowledgment packets/rows with signatures (`src/data/types.ts`) |
| Plan templates | Partial | Delegation templates exist (`src/delegation/`); ISP objective templates are per-plan configuration, not a reusable library |
| Individual support plans (whole-plan document) | Partial | Care plan section on the chart (`src/features/IndividualChart.tsx`) renders profile + obligations; no versioned whole-plan document with review dates |

## 5. Intake

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Intake creates the Individual + site placement | Present | Intake page (`src/App.tsx`), `AddIndividualForm` |
| Priority / waiting list | Missing | Intake is a direct create-and-place form; no waitlist or priority ranking |
| Admission pipeline (referral → review → admitted) | Missing | No pipeline states |

## 6. Personal finance

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Individual accounts / transactions / reconciliation | Missing | No personal-finance module; `src/data/hr.ts` covers staff payroll/time only |

## 7. Scheduling, time, attendance (staff)

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Staff scheduling + open shifts | Present | Employee Hub (`src/features/employeeHub/`), `src/data/openShifts.ts`, staffing board |
| Time clock / attendance / timecards | Present | Kiosk punches, timecard approval, exceptions (`src/data/hr.ts`, `src/data/hrStore.ts`) |

## 8. Health

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Health appointments | Present | `src/data/appointments.ts`, Health card (`src/features/HealthCard.tsx`) |
| Allergies | Present | Structured allergy list on the profile (`src/data/planStack.ts`) |
| Diagnoses | Partial | Single free-text `diagnosis` profile field; no coded diagnosis list |
| Advance directives | Missing | No directive record |
| Care plans (clinical) | Partial | Chart "Care plan" section is profile/obligations; no nurse-owned care plan with interventions and review dates |
| Comprehensive health assessment / health passport | Missing | No assessment instrument or portable summary |
| Health screening (due / overdue tracking) | Partial | Clinical renewals tracker (`ClinicalRenewal` in `src/data/planStack.ts`) covers renewal due dates; no screening schedule per Individual |
| Health tracking — intake/elimination, vitals, seizures, menses, skin, glucose, height/weight, respiratory, sleep, labs, infection, immunization | **Present** (immunizations, lab results, infection, sleep built in batch 1; intake, elimination, vitals, seizures, menses, skin, blood glucose, respiratory built in batch 2, stacked on batch 1) | `src/data/healthTrack.ts`, `src/features/healthTrack/HealthTrackSection.tsx`; height/weight ride the vitals tracker; the bowel tracking log delegation text promises is the elimination tracker's bowel log |
| MAR (medication administration record) | Present | Medication board + dose marks + exceptions (`src/features/MarCard.tsx`, `src/data/types.ts`, `src/data/medInventory.ts`) |
| Medication profile / history | Partial | Current medication list + deliveries exist; no discontinued-medication history view |
| Medication orders (approval, expiration) | Missing | No order workflow; medications are maintained as chart records |
| Medication reconciliation | Missing | No reconciliation workflow |

## 9. Employment (supported employment)

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Agency employer directory | Missing | No employer records |
| Person employment plans / milestones | Missing | No employment plan surface |

## 10. Reporting

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Agency dashboard + per-module dashboards | Present | Overview dashboard, QA Review, audit readiness (`src/data/auditReadiness.ts`), compliance scores |
| Report library (saved/canned report catalog) | Missing | Reports are generated per surface (PDF/print); no catalog |
| Event / health summary reports | **Partial → dashboard sections built in this batch** | — |

## 11. Administration

| Capability | Status | ComplyRer evidence |
| --- | --- | --- |
| Users / roles / privileges | Present | `src/data/permissions.ts` (source of truth), Roles & access page, memberships |
| Caseloads / assignments | Present | Staff assignments + caseload appointment views (`src/data/chart.ts`, `src/data/appointments.ts`) |
| Module configuration | Partial | Agency rules panel + operator rule settings (`src/features/AgencyRulesPanel.tsx`, PR #116); not a per-module config console |
| Service directory (services, rates, waivers) | Partial | Waiver is a profile field; programs/sites exist; no rate table |

---

## Counts

- Taxonomy rows assessed: 37
- Present: 16 · Partial: 10 · Missing: 11

## Top remaining gaps after this batch (residential-core priority order)

1. **Medication orders + reconciliation** — order approval/expiration and a
   reconciliation pass on admission/transfer.
2. **Clinical care plans + health screening schedule** — nurse-owned care
   plans and per-Individual screening due/overdue.
3. **Personal finance** — Individual accounts, transactions, reconciliation.
4. **Intake pipeline + waiting list** — referral states and priority ranking.
5. **Internal messaging** — staff-to-staff messages tied to Individuals/sites.
6. **Consents register** — per-person consents with expiry and renewal.
7. **Significant life events** log on the chart.
8. **Employment** — employer directory + person employment plans.
9. **Report library** — a catalog over the existing per-surface reports.

*Update (batch 2, stacked on batch 1): the former #1 gap — health tracking
core kinds (intake/elimination incl. the bowel log, vitals, seizures,
menses, skin, glucose, height/weight, respiratory) — is built. Batch 1
added immunizations, labs, infection, and sleep on the same framework.
Abnormal findings on the core trackers alert the home's HM + PM + nurse,
deduped, exactly like batch 1.*

*Update (internal messaging): priority #5 above is built — see the
"Internal staff messaging" row in section 1. This file originates in
PR #117 and is carried forward here so the row update lands with the
feature; the rest of the map is unchanged.*

*Update (life events): priority #7 above is built — see the "Significant
life events" row in section 2. Life events are chart context, not
incident paperwork: they raise no alerts, editors record/correct/void
them, and anyone who can read the Individual (DSPs, auditors included)
can view the timeline.*
