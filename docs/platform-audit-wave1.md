# Platform audit — wave 1 (audit, fixes, navigation)

Started 2026-11-03 on top of `integration/all-open-2026-11-03` (the 50 open
PRs merged into one base, see that PR). Execution order for every item:
inspect → map → reorganize → implement → test → fix → retest.

Status key: **Done** (in this wave's PR, tested) · **Next** (found and scoped,
not yet changed) · **Needs a decision** (a product or compliance call for the
founder before code changes).

## Completed in wave 1

| # | Area | What was wrong | What changed | Proof |
| --- | --- | --- | --- | --- |
| 1 | Dates (every module) | "Today" was computed five ways. Three of them used the UTC date, so after 6 PM Central (7 PM in summer) the app lived in tomorrow: today's doses showed "not open yet," expiries were judged a day early, and tomorrow's date was stamped on signatures. | `src/data/agencyDay.ts` is the one agency day (America/Chicago). Every legacy helper (`todayIso`, `todayStamp`, both `centralTodayIso`, the private hrStore and Open Shifts helpers) delegates to it, and the 54 inline `new Date().toISOString().slice(0, 10)` "now" dates were replaced. | `agencyDay.test.ts` pins the 6 PM and midnight boundaries. The MAR, med-clearance and rights-packet tests that failed every evening now pass at night. |
| 2 | Time clock | Clock-out loaded "today's" punches with zone-less local-midnight bounds. Any clock-in after 6 PM Central, and every overnight shift, got "No open clock-in to close." | Open-session checks use an absolute 24-hour lookback (`punchLookbackWindow`), on both the hosted and local stores. | `hrKioskStore.test.ts`: an overnight shift (11:30 PM → 6:30 AM) and an evening clock-in. |
| 3 | MAR corrections | In the local demo, a correction in the same millisecond as the mark it replaced reused the version token, so two racing correctors could both win. | The re-stamp is always strictly later than the previous stamp. Hosted was already safe (microsecond `now()`). | `marFreshness.test.ts`: the race test is now deterministic (3/3 runs). |
| 4 | Navigation | The sidebar mixed unrelated work. "Programs" held Scheduling, Staff and Roles. A group named after the agency held Training, Delegations, the checklists, meds and Mileage. The breadcrumb always said "Programs." | Five groups that follow how an agency runs: **Programs** (Overview, Sites & programs, Individuals, Intake, Appointments, Consents), **Daily operations** (Weekly checklist, Checklist assignments, Supply forecast, Medication orders, Scheduling), **Compliance** (Requirements, Review queue, Acknowledgments, Delegations, Documents, Audit Me, Audit center, QA Review), **Workforce** (Staff, Training, Certificates, Employee Hub, Messages, Recognition, Mileage), and **Reports & admin** (Report Library, Activity log, Roles & access, AI settings, Platform). All 31 pages are kept, each in one group. Role gates are unchanged. The breadcrumb names the page's real group. | `tsc`; `programs-nav.spec.ts` (first group is still Programs). |
| 5 | Ownership map | No single place answered "what does this house owe, who does it, how often, and where is the proof?" | `src/data/obligations.ts`: a register of 21 recurring duties, each with frequency, owner and reviewer roles, the page it's done on, where its signed history lives, and its basis (a verified `DMH_REQUIREMENTS` id or labelled agency policy). | `obligations.test.ts` pins every page, role and DMH id. |
| 6 | Site review placement | The site review / pre-survey pack was reachable only from Sites & programs with one home picked in the filter. | It also renders on the home's own Overview tab. | `tsc`; panel keeps its own gates. |

## Outstanding — found in the audit, scheduled next

| Priority | Area | Finding | Planned change | Status |
| --- | --- | --- | --- | --- |
| P1 | Drills | Drill **recording** exists only on Sites & programs → "This month's checks." The home's Checklists tab shows the drill schedule read-only, because issue #94 hid the logging block to avoid a duplicate section. | Put recording into the home's Checklists tab, under the schedule as one section, then retire the filtered-list copy. Needs the `monthly-checks` and `site-review` e2e specs moved to the home page. | Next |
| P1 | Monthly home checks | The same equipment and safety block renders in two places (filtered Sites list and the home's Checklists tab). | Keep the home's tab as the single place; the Sites list links to it. | Next |
| P1 | Dashboards | The register is data only; no screen shows "who owns what is due." | Wave 2: an agency-wide obligations view and a per-home command center, both read from `OBLIGATIONS` with live status from the existing engines (`personalQueue`, `dueItems`, `auditReadiness`, compliance scores). | Next (wave 2) |
| P2 | Dates | The legacy helper names still exist as aliases. | Move callers to `agencyToday` / `agencyDayOf` and delete the aliases. | Next |
| P2 | Landing order | `CANONICAL_PAGE_ORDER` (the first page a role lands on) doesn't follow the new nav order, and doesn't list Consents. | Align once the landing page for each role is confirmed, since this changes where DSPs land. | Needs a decision |
| P2 | HR hub times | The date-time input helpers in the hub format device-local time. That's correct on Missouri devices, but wrong for anyone opening the hub from another zone. | Format in the agency zone. | Next |
| P3 | Open drafts | The operator console stack (#176–#192) and the agency-admin slices (#208, #209, #211) are still drafts. | Merge when marked ready. | Needs a decision |

## Compliance logic — what is and isn't regulation

- Only duties that map to a **verified** entry in `src/data/dmhRequirements.ts` are labelled regulation:
  - abuse/neglect training (annual)
  - first aid/CPR (every two years)
  - HIPAA training (annual)
  - background screening on hire
  - the 16-hour medication-aide course
  - event-reporting timelines
  - corrective-action tracking
- Everything else on the register is labelled **agency policy**. That includes drill frequency, delegation renewals, order review cadence, weekly and monthly house checks, and consent and rights cycles. Some of these may well be required. Their Missouri citations are simply not verified in the catalog yet, under the catalog's own rule: never add an entry without a citation that has actually been read.
- **Needs a decision:** confirm against the agency's certification and current 9 CSR text before any of these move from "agency policy" to "regulation":
  - drill frequency
  - RN delegation rules
  - the ISP cycle
  - record retention
  - survey cadence

## Test results

| Check | `main` (f3febdb) | Integration base | Wave 1 |
| --- | --- | --- | --- |
| `tsc -b` | pass | pass | pass |
| `npm run build` | pass | pass | WAVE1_BUILD |
| Unit tests | 1698 / 1704 (6 fail, evening) | 2169 / 2180 (11 fail, evening) → fixes → 5 evening-only | WAVE1_UNIT |
| Playwright e2e (failing specs re-run) | E2E_MAIN | E2E_INT | E2E_W1 |
