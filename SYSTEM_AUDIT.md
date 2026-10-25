# Complyrer system audit

Living record. Last updated 15 Oct 2026.

**Readiness: NOT FULLY COMPLETE.**

The row-by-row evidence lives in the production-audit canvas. This file records what was verified, what was fixed in the working tree, and what still blocks a production release. Status words mean:

- PASS — behavior is implemented and covered by a test or a browser check.
- FIXED — a gap found in this audit series now behaves as specified, with a test.
- PARTIAL — the path exists, and a named piece is still missing or unverified.
- NOT IMPLEMENTED — there is no product behavior for this. It is not described as done.
- NOT APPLICABLE — the item does not belong in this build.

Do not treat a rendered screen as complete. Do not treat this file as a HIPAA certification, a backup proof, or a payroll-vendor integration.

## Shift clocks (15 Oct 2026)

A program site sets the start and end of the day, evening, and overnight shifts. Those windows may overlap, and a Shift note covers only the shift it is filed under. Houses with no saved times stay on 6:00 a.m.–2:00 p.m., 2:00–10:00 p.m., and 10:00 p.m.–6:00 a.m. A program manager, house manager, or administrator saves the times on the site review. A DSP cannot. A shift shorter than an hour or longer than 16 hours is rejected. An unusable clock falls back to the default if it is already stored.

Verified by the due-item unit test "uses a site's own shift starts for the missing-note window" and the API test "a house manager clock changes the missing-note window". Typecheck passed.

Browser check on 15 Oct 2026, signed in as Sarah Mitchell on Sites & programs, Cedar House selected. Setting the day end to 3:00 p.m. while evening still started at 2:00 p.m. saved, and the summary showed both windows. Ellis Hart's new Shift note then offered "Day 6:00 a.m.–3:00 p.m.", "Evening 2:00–10:00 p.m.", and "Overnight 10:00 p.m.–6:00 a.m." The note was not saved. Cedar's day end was set back to 2:00 p.m.

## Clinician report (15 Oct 2026)

A Shift note prints as a clinician report: report description, individual, date range, form id, status, time zone (US/Central), ISP program, scoring method, frequency, schedule, schedule comment, goal, and completion criteria. Each note is its own block with date, begin, end, duration (hh:mm), location, and service provider, then a Task / Score / Scoring comments table and the comment. Equal clocks print as 00:00. An end earlier than the begin crosses midnight. Notes on the same date stay separate and sort by begin time, so 7:00 a.m. comes before 3:00 p.m. A blank location prints the house name. A blank title prints the staff member's role, which is "Direct support professional" for a DSP.

Older notes that only have a label such as 7a–3p still print as 07:00 AM–03:00 PM, duration 08:00. The showcase revision was not bumped, and no note was saved on Ellis.

`20261015120000_clinician_report_fields.sql` adds the new note and program columns. It was applied to the local disposable database on 15 Oct 2026 and to the Complyra project on 24 Oct 2026.

Verified by `src/data/shiftNotes.test.ts` and `src/pdf/shiftNotesPdf.test.ts` and `tsc -b`. The rendered pages show the time row on one line and a separate location / provider row. On the signed-in chart, Ellis's existing cards show 07:00 AM–03:00 PM, the duration, the provider title, Cedar House, and the scoring table. Print last 14 days produced a 7-page PDF with those same fields. Goal and criteria stay blank until someone saves the report header. They were not filled.

## Progress notes (15 Oct 2026)

A new Shift note is a progress note. It can be saved only when the approved ISP program has a goal or outcome, the note has a begin time and an end time, the waiver service is one of the nine DMH-aligned services already used in the product, the narrative says what the person did and how staff supported that goal, the staff title is a display title, and the adopted signature is stored as a PNG snapshot. A typed name is not a signature. The form shows the legal name, the date of birth when it is on the chart, and a middle initial only when the stored legal name has a middle name. Ellis Hart stays "Ellis Hart". His date of birth on the demo chart is 1978-01-01.

Older notes are not rewritten. They print "Signature not on this note". Editing one does not require a new signature. Ellis's program still has no goal, so a new note on Ellis cannot be saved until someone saves that goal. It was not saved, and the goal was not filled.

`20261015140000_progress_note_fields.sql` adds `waiver_service` and `signature_data_url`. It was applied to the local disposable database on 15 Oct 2026 and to the Complyra project on 24 Oct 2026.

The chart can also print one calendar month of the notes already on file. October 2026 on Ellis showed 23 notes, all dated in October, and September 2026 showed the two September notes. The packet is those notes in the clinician-report layout. It does not write a findings narrative. The goal field on Ellis's ISP opened because it is blank. It was not filled, and no note was saved.

## What this pass changed

Opening Notifications now tells the person who owes a missing Shift note, and tells that home's house managers and administrators, once per note per day. A second open the same day does not add another copy. The note stays missing until someone writes it. Morgan Pruitt's Day note from Alex Morgan is still the intentional demo gap.

The notice type is `documentation.missing_note`. The hosted bell now runs the same sweep and queues through `queue_operating_notice`. A missing note is stored as a shift note, not a medication. A repeated dedupe key does not insert a second row. `supabase/tests/operating_notices.sql` passed on the local disposable database (8 tests) after `20261013120000_operating_notices.sql` was applied there. That migration was applied to the Complyra project on 24 Oct 2026.

Verified by `src/data/dueItems.localApi.test.ts` ("a missing Shift note notifies the writer and the administrator once per day") and the notification catalog test. Typecheck of the canvas passed. A full `npm test` was not re-run after this change.

Browser check on 15 Oct 2026, signed in as Sarah Mitchell: Notifications listed one "Missing Shift note" per owed note, including Cedar House: Morgan · Day · Needed from Alex Morgan. The same panel also listed Day, Evening, and Overnight gaps for Ellis, Morgan, Reese, and Harper. That matches the due-item detector after the filled showcase dates aged past 13 Oct. The notes were not written, and Ellis's levetiracetam doses were not marked. A fresh seed still produces exactly one missing-note notice.

## Product inventory

The app is a Vite/React client. The local demo and the unit tests run through `LocalApi` against an in-memory store that can persist to `localStorage`. `HostedApi` talks to Supabase. Those two paths are not equal. A behavior proven on the local demo is not proven on a hosted project.

Navigation for an administrator includes Overview, Individuals, Appointments, Sites, Intake, Staff, Roles, Requirements, Documents, Review queue, Audit center, Audit Me, QA Review, Acknowledgments, Activity log, Training, Delegations, Certificates, Weekly checklist, Checklist assignments, Supply forecast, Mileage, Employee Hub, Recognition, Records, Settings, and Help.

There is no separate incident/GER module with create, classify, evidence, and close. Incident follow-up exists as a workflow template fed by `incidentsNeedingFollowup`, and the command center currently passes an empty incident list. There is no custom form designer, no live Paycor/ADP/Gusto post, no monthly findings-and-recommendations narrative, and no phone push.

## Connected rules already in force

Saved agency settings drive medication windows, the block on early recording, note grace, lateness points and write-up reset, recognition monthly cap, order and certificate reminder bands, and CPI/PBS due dates for a newly hired member. Delegation review dates do not expire a form unless `delegations.expire` is on. Weekly overtime flags use the rule settings. Timecard pay still uses `hr_overtime_rules`. Those two calculations are separate on purpose.

A local kiosk clock-in past the saved lateness minutes adds the same point as the Employee Hub clock. The kiosk's own grace only flags the punch. A hosted kiosk clock-in now uses `note_kiosk_late_clock_in`, which records the point only when the kiosk token is valid and that clock-in punch is already stored. A clock-in inside the saved minutes does not. The same punch does not record a second point. That function passed on the local disposable database and was applied to the Complyra project on 24 Oct 2026. No kiosk punch was made in the browser.

## Release blockers

1. The notice functions, rule settings, clinician-report columns, progress-note columns, and the kiosk lateness function are on the Complyra project as of 24 Oct 2026. A hosted sign-in was not used to open the bell, so the sweep is proven in code and in the database function, not through a hosted browser session.
2. `sweep-operating-reminders` is deployed on Complyra. It uses the same notice list as the signed-in bell. Both judge yesterday and the dose clock in America/Chicago. Inserts go through `queue_system_notice`. Nothing schedules the function, so it does not run by itself. A failed insert is still swallowed. Nothing is pushed to a phone.
3. Shift notes store a date and a shift label. They are not a foreign key to a scheduled shift, so an approved schedule change does not automatically clear the missing-note row.
4. Backup, recovery, monitoring, and deployment rollback have not been exercised. HIPAA safeguards exist as access checks and an activity log. That is not a certification.
5. Payroll export is a CSV. Nothing posts to a payroll vendor.
6. A monthly individual progress narrative is not generated from shift notes.
7. Medication count entry is still a typed quantity. A discrepancy is rejected; there is no separate discrepancy queue that was verified open.
8. The main bundle is large. Phone layouts have a Playwright spec that was not run in this pass.
9. origin/main and this branch both edit `src/App.tsx`. They have not been merged.
10. Clinician-report columns, the progress-note columns (`waiver_service`, `signature_data_url`), `note_kiosk_late_clock_in`, and `queue_system_notice` are on the Complyra project as of 24 Oct 2026. The app code that sends those columns is still only in this working tree.

## Assumptions

- "Individual" is the only word for the person receiving support.
- Demo gaps stay on purpose: Ellis Hart's 8:00 a.m. levetiracetam stays unmarked, Morgan Pruitt's ISP stays a draft, and Alex Morgan still owes Morgan's Day note.
- Clinical schedules and doses come from stored orders. This audit does not invent administration instructions.
- Delegation forms do not gain an expiration date from a review date.

## How to resume

```bash
node --import tsx --import ./src/testSupport/cssStub.mts --test src/data/dueItems.localApi.test.ts src/features/notifications/notifications.test.ts
npx tsc -b --pretty false
npm test
```

## Resolved reminders (15 Oct 2026)

Saving a Shift note marks that shift's missing-note notices read for the writer and for the managers who were told. A note filed as Other does not clear a shift. Morgan Pruitt's Day note from Alex Morgan is still the intentional gap, and Morgan's ISP was not approved.

Verified by `src/data/dueItems.localApi.test.ts` ("saving the Shift note stops that shift's missing-note reminder"). `resolve_missing_note_notices` and `note_kiosk_late_clock_in` passed 8 tests in `supabase/tests/kiosk_lateness_and_resolved_notices.sql` on the local disposable database. Both functions were applied to the Complyra project on 24 Oct 2026.

Clicking a missing Shift note opens that person's chart at the Shift notes section. A notice stored before this change still does that from the person id on the row. A new notice also stores `/plans/{id}#chart-shift-notes`. On 15 Oct 2026, signed in as Sarah Mitchell, the Morgan · Day notice opened Morgan Pruitt's chart with Shift notes in view. That note was not written, and Morgan's ISP was not approved. Opening the notice marks that one row read.

The closed-app reminder uses that same list. `noticesForAgency` names yesterday's missing note for the writer and the house managers, and an unmarked dose, on the Central day. The signed-in bell uses that same Central day. `queue_system_notice` passed 4 tests in `supabase/tests/system_notices.sql` on the local disposable database. A signed-in member cannot call it. `sweep-operating-reminders` was deployed to Complyra on 24 Oct 2026. Nothing schedules it. There is still no phone push.

Do not unify timecard pay with the weekly overtime flag.
