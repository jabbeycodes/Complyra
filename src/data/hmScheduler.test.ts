/**
 * Phase 1, Workstream 2 tests: Sunday HM-checklist scheduler + real late flags.
 *
 * All pure functions from src/data/hmChecklist.ts — no DB, no DOM.
 * Run: node --import tsx --test src/data/hmScheduler.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignedNotificationDedupeKey,
  buildWeeklyChecklistRow,
  computeChecklistStatus,
  dueAtIsoForWeekStart,
  isLate,
  lateNotificationDedupeKey,
  nextMondayIso,
} from "./hmChecklist";

/* ------------------------------------------------------------------ */
/* Week boundaries: the scheduler's Monday week anchor                   */
/* ------------------------------------------------------------------ */

test("nextMondayIso: Sunday run targets tomorrow's Monday", () => {
  assert.equal(nextMondayIso("2026-09-13"), "2026-09-14"); // Sunday
});

test("nextMondayIso: Monday input jumps a full week out (never re-targets current week)", () => {
  assert.equal(nextMondayIso("2026-09-14"), "2026-09-21"); // Monday
});

test("nextMondayIso: mid-week inputs land on the upcoming Monday", () => {
  assert.equal(nextMondayIso("2026-09-16"), "2026-09-21"); // Wednesday
  assert.equal(nextMondayIso("2026-09-18"), "2026-09-21"); // Friday
  assert.equal(nextMondayIso("2026-09-19"), "2026-09-21"); // Saturday
});

test("nextMondayIso: result is always a Monday", () => {
  for (const iso of ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-19", "2026-12-31"]) {
    const [y, m, d] = nextMondayIso(iso).split("-").map(Number);
    assert.equal(
      new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
      1,
      `${iso} -> ${nextMondayIso(iso)}`,
    );
  }
});

test("dueAtIsoForWeekStart: Sunday 23:59 UTC, six days after the Monday anchor", () => {
  assert.equal(dueAtIsoForWeekStart("2026-09-14"), "2026-09-20T23:59:00.000Z");
  assert.equal(dueAtIsoForWeekStart("2026-09-21"), "2026-09-27T23:59:00.000Z");
});

/* ------------------------------------------------------------------ */
/* buildWeeklyChecklistRow: the scheduler's upsert row                   */
/* ------------------------------------------------------------------ */

const ASSIGNMENT = {
  agencyId: "agency-1",
  siteId: "site-1",
  hmUserId: "hm-1",
};

test("buildWeeklyChecklistRow maps the assignment and week anchors", () => {
  const row = buildWeeklyChecklistRow(ASSIGNMENT, "2026-09-14");
  assert.equal(row.agency_id, "agency-1");
  assert.equal(row.site_id, "site-1");
  assert.equal(row.assigned_to_user_id, "hm-1");
  assert.equal(row.assigned_by_user_id, null);
  assert.equal(row.status, "open");
  assert.equal(row.week_start, "2026-09-14");
  assert.equal(row.week_of, "2026-09-13"); // Sunday opening the same week
  assert.equal(row.due_at, "2026-09-20T23:59:00.000Z");
  assert.equal(row.late, false);
  assert.equal(row.late_flagged_at, null);
  assert.equal(row.submitted_at, null);
  assert.ok(Array.isArray(row.items));
  assert.equal((row.items as unknown[]).length, 26);
  assert.deepEqual(row.service_logs, []);
});

test("scheduler upsert is idempotent: running twice creates one row", () => {
  // Simulates INSERT ... ON CONFLICT (site_id, week_start) DO NOTHING by
  // keying a store on the conflict target named in the migration
  // (hm_weekly_checklists_site_week_uniq).
  const store = new Map<string, Record<string, unknown>>();
  const conflictKey = (row: Record<string, unknown>) =>
    `${row.site_id}:${row.week_start}`;

  function upsert(row: Record<string, unknown>): "created" | "already_existed" {
    const key = conflictKey(row);
    if (store.has(key)) return "already_existed";
    store.set(key, row);
    return "created";
  }

  const first = upsert(buildWeeklyChecklistRow(ASSIGNMENT, "2026-09-14"));
  const second = upsert(buildWeeklyChecklistRow(ASSIGNMENT, "2026-09-14"));
  assert.equal(first, "created");
  assert.equal(second, "already_existed");
  assert.equal(store.size, 1);

  // A different week (or site) is a genuinely new row.
  assert.equal(upsert(buildWeeklyChecklistRow(ASSIGNMENT, "2026-09-21")), "created");
  assert.equal(
    upsert(buildWeeklyChecklistRow({ ...ASSIGNMENT, siteId: "site-2" }, "2026-09-14")),
    "created",
  );
  assert.equal(store.size, 3);
});

/* ------------------------------------------------------------------ */
/* isLate / computeChecklistStatus                                       */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-09-15T12:00:00.000Z");
const PAST_DUE = "2026-09-13T23:59:00.000Z";
const FUTURE_DUE = "2026-09-20T23:59:00.000Z";

test("isLate: unsubmitted + past due -> late", () => {
  assert.equal(isLate({ submittedAt: null, dueAt: PAST_DUE, late: false }, NOW), true);
});

test("isLate: submitted checklist is never late, even past due", () => {
  assert.equal(
    isLate({ submittedAt: "2026-09-14T10:00:00.000Z", dueAt: PAST_DUE, late: false }, NOW),
    false,
  );
});

test("isLate: due in the future -> not late", () => {
  assert.equal(isLate({ submittedAt: null, dueAt: FUTURE_DUE, late: false }, NOW), false);
});

test("isLate: scheduler late flag wins even before due_at passes", () => {
  assert.equal(isLate({ submittedAt: null, dueAt: FUTURE_DUE, late: true }, NOW), true);
});

test("isLate: no due info and no flag -> not late", () => {
  assert.equal(isLate({ submittedAt: null, dueAt: null, late: false }, NOW), false);
  assert.equal(isLate({}, NOW), false);
});

test("computeChecklistStatus returns compliant / pending / late", () => {
  assert.equal(
    computeChecklistStatus({ submittedAt: "2026-09-14T10:00:00.000Z", dueAt: PAST_DUE }, NOW),
    "compliant",
  );
  assert.equal(
    computeChecklistStatus({ submittedAt: null, dueAt: FUTURE_DUE, late: false }, NOW),
    "pending",
  );
  assert.equal(
    computeChecklistStatus({ submittedAt: null, dueAt: PAST_DUE, late: false }, NOW),
    "late",
  );
  assert.equal(
    computeChecklistStatus({ submittedAt: null, dueAt: FUTURE_DUE, late: true }, NOW),
    "late",
  );
});

/* ------------------------------------------------------------------ */
/* Notification dedupe keys                                             */
/* ------------------------------------------------------------------ */

test("notification dedupe keys are unique per event and per checklist", () => {
  const assignedA = assignedNotificationDedupeKey("checklist-a");
  const assignedB = assignedNotificationDedupeKey("checklist-b");
  const lateA = lateNotificationDedupeKey("checklist-a");

  assert.notEqual(assignedA, assignedB); // different checklists
  assert.notEqual(assignedA, lateA); // different events, same checklist
  assert.ok(assignedA.startsWith("checklist.assigned:"));
  assert.ok(lateA.startsWith("checklist.late:"));

  // Deterministic: a rerun computes the same key, so the upsert dedupes.
  assert.equal(assignedNotificationDedupeKey("checklist-a"), assignedA);
  assert.equal(lateNotificationDedupeKey("checklist-a"), lateA);
});
