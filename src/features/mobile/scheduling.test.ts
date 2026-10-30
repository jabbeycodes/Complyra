import { test } from "node:test";
import assert from "node:assert/strict";
import type { HrShift, HrTimeOffRequest } from "../../data/hr";
import type { ShiftAccountability } from "../../data/shiftAccountability";
import {
  accountabilityLine,
  approvedTimeOffCovering,
  pickYourShift,
  shiftCentralDateSpan,
  shiftTimeLabel,
  staffPicksForShift,
  weekDayShifts,
  yourShiftText,
  type SchedStaffChoice,
} from "./scheduling";

const CEDAR = "site-cedar";
const WILLOW = "site-willow";
// Friday 2026-10-30, 3:00 PM – 11:00 PM Central (CDT, UTC-5).
const FRI_START = "2026-10-30T20:00:00.000Z";
const FRI_END = "2026-10-31T04:00:00.000Z";

function shift(partial: Partial<HrShift>): HrShift {
  return {
    id: "shift-1",
    agencyId: "agency-1",
    siteId: CEDAR,
    staffId: null,
    title: "Evening shift",
    startsAt: FRI_START,
    endsAt: FRI_END,
    status: "published",
    notes: null,
    createdBy: "sarah",
    ...partial,
  };
}

function person(partial: Partial<SchedStaffChoice>): SchedStaffChoice {
  return {
    id: "p1",
    name: "Alex Morgan",
    role: "DSP",
    roleKey: "dsp",
    siteId: CEDAR,
    site: "Cedar House",
    expiresOn: null,
    ...partial,
  };
}

function timeOff(partial: Partial<HrTimeOffRequest>): HrTimeOffRequest {
  return {
    id: "to-1",
    agencyId: "agency-1",
    siteId: WILLOW,
    staffId: "jordan",
    kind: "pto",
    startsOn: "2026-10-31",
    endsOn: "2026-11-03",
    status: "approved",
    reason: "",
    days: [],
    totalHours: 16,
    decidedBy: "james",
    decidedAt: "2026-10-28T15:00:00.000Z",
    decisionNote: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-10-25T14:00:00.000Z",
    updatedAt: "2026-10-28T15:00:00.000Z",
    ...partial,
  };
}

function acc(partial: Partial<ShiftAccountability>): ShiftAccountability {
  return {
    shiftId: "shift-1",
    ownerId: "alex",
    ownerName: "Alex Morgan",
    startsAt: FRI_START,
    endsAt: FRI_END,
    totalDue: 0,
    doneCount: 0,
    missingItems: [],
    state: "upcoming",
    ...partial,
  };
}

test("shift times read in Central, with a next-day end called out", () => {
  assert.equal(shiftTimeLabel(FRI_START, FRI_END), "3:00 PM – 11:00 PM");
  // 10:00 PM Friday to 6:00 AM Saturday Central.
  assert.equal(
    shiftTimeLabel("2026-10-31T03:00:00.000Z", "2026-10-31T11:00:00.000Z"),
    "10:00 PM – 6:00 AM next day",
  );
});

test("a shift's Central date span stays on the day it worked", () => {
  assert.deepEqual(shiftCentralDateSpan(FRI_START, FRI_END), {
    from: "2026-10-30",
    to: "2026-10-30",
  });
  assert.deepEqual(
    shiftCentralDateSpan("2026-10-31T03:00:00.000Z", "2026-10-31T11:00:00.000Z"),
    { from: "2026-10-30", to: "2026-10-31" },
  );
});

test("only APPROVED time off covering the span counts", () => {
  const approved = timeOff({});
  assert.equal(
    approvedTimeOffCovering([approved], "jordan", "2026-10-30", "2026-10-31")?.id,
    "to-1",
  );
  assert.equal(
    approvedTimeOffCovering([approved], "jordan", "2026-11-04", "2026-11-05"),
    null,
  );
  assert.equal(
    approvedTimeOffCovering([timeOff({ status: "pending" })], "jordan", "2026-10-31", "2026-10-31"),
    null,
  );
  assert.equal(
    approvedTimeOffCovering([timeOff({ status: "denied" })], "jordan", "2026-10-31", "2026-10-31"),
    null,
  );
  assert.equal(
    approvedTimeOffCovering([approved], "someone-else", "2026-10-31", "2026-10-31"),
    null,
  );
});

test("the picker excludes approved time off, keeps everyone else, sorted", () => {
  const saturday = shift({
    id: "shift-sat",
    startsAt: "2026-10-31T13:00:00.000Z",
    endsAt: "2026-10-31T21:00:00.000Z",
  });
  const picks = staffPicksForShift({
    staff: [
      person({ id: "jordan", name: "Jordan Lee", siteId: WILLOW, site: "Willow House" }),
      person({ id: "taylor", name: "Taylor Reed" }),
      person({ id: "alex", name: "Alex Morgan" }),
      person({ id: "gone", name: "Gone Person", expiresOn: "2026-10-01" }),
    ],
    todayIso: "2026-10-30",
    shift: saturday,
    // Jordan is approved off Sat–Tue; Taylor's request is only pending.
    timeOff: [timeOff({}), timeOff({ id: "to-2", staffId: "taylor", status: "pending" })],
    allShifts: [saturday],
  });
  assert.deepEqual(
    picks.map((pick) => pick.id),
    ["alex", "taylor"],
  );
  assert.equal(picks[0].label, "Alex Morgan, DSP");
  assert.equal(picks[0].overlapWarning, null);
});

test("an overlapping assignment warns in text; a touching one does not", () => {
  const target = shift({ id: "shift-target" });
  const overlapping = shift({
    id: "shift-other",
    staffId: "alex",
    startsAt: "2026-10-30T18:00:00.000Z",
    endsAt: "2026-10-31T02:00:00.000Z",
  });
  const touching = shift({
    id: "shift-before",
    staffId: "taylor",
    startsAt: "2026-10-30T12:00:00.000Z",
    endsAt: FRI_START, // ends exactly when the target starts — no overlap
  });
  const picks = staffPicksForShift({
    staff: [person({ id: "alex" }), person({ id: "taylor", name: "Taylor Reed" })],
    todayIso: "2026-10-30",
    shift: target,
    timeOff: [],
    allShifts: [target, overlapping, touching],
  });
  const alex = picks.find((pick) => pick.id === "alex");
  const taylor = picks.find((pick) => pick.id === "taylor");
  assert.match(alex?.overlapWarning ?? "", /Already assigned an overlapping shift/);
  assert.equal(taylor?.overlapWarning, null);
  // Being picked for the target shift itself never warns against itself.
  const selfPicks = staffPicksForShift({
    staff: [person({ id: "alex" })],
    todayIso: "2026-10-30",
    shift: shift({ id: "shift-self", staffId: "alex" }),
    timeOff: [],
    allShifts: [shift({ id: "shift-self", staffId: "alex" })],
  });
  assert.equal(selfPicks[0].overlapWarning, null);
});

test("off-site staff are labeled with where they belong", () => {
  const picks = staffPicksForShift({
    staff: [
      person({ id: "w1", name: "Casey Adams", siteId: WILLOW, site: "Willow House" }),
      person({ id: "a1", name: "Sam Agency", siteId: null, site: "" }),
    ],
    todayIso: "2026-10-30",
    shift: shift({}),
    timeOff: [],
    allShifts: [],
  });
  assert.equal(picks.find((p) => p.id === "w1")?.label, "Casey Adams, DSP, other house");
  assert.equal(picks.find((p) => p.id === "a1")?.label, "Sam Agency, DSP, agency");
});

test("the accountability line carries owner, state, counts, and names", () => {
  const missing = [
    { id: "m1", kind: "menu" as const, label: "Breakfast record — Morgan Pruitt", dueAt: FRI_START, done: false },
    { id: "m2", kind: "medication" as const, label: "Levetiracetam 500 mg — Ellis Hart", dueAt: FRI_START, done: false },
    { id: "m3", kind: "shift_note" as const, label: "Shift note — Ellis Hart", dueAt: FRI_END, done: false },
    { id: "m4", kind: "checklist" as const, label: "Checklist — Fire drill log", dueAt: FRI_END, done: false },
  ];
  const line = accountabilityLine(
    acc({ state: "in_progress", totalDue: 9, doneCount: 4, missingItems: missing }),
    "2026-10-30T21:00:00.000Z",
  );
  assert.equal(
    line,
    "Alex Morgan · In progress · 4 of 9 done · Still to do: Breakfast record — Morgan Pruitt; Levetiracetam 500 mg — Ellis Hart; Shift note — Ellis Hart · and 1 more",
  );
  // After the window ends the same undone work reads as missing.
  const ended = accountabilityLine(
    acc({ state: "has_missing", totalDue: 2, doneCount: 1, missingItems: [missing[2]] }),
    "2026-10-31T12:00:00.000Z",
  );
  assert.equal(ended, "Alex Morgan · Has missing items · 1 of 2 done · Missing: Shift note — Ellis Hart");
  // Unowned and complete forms.
  assert.equal(
    accountabilityLine(acc({ ownerId: null, ownerName: null, state: "unowned", totalDue: 10, doneCount: 2, missingItems: missing.slice(0, 2) }), "2026-10-30T21:00:00.000Z"),
    "Unowned · 2 of 10 done · Still to do: Breakfast record — Morgan Pruitt; Levetiracetam 500 mg — Ellis Hart",
  );
  assert.equal(
    accountabilityLine(acc({ state: "complete", totalDue: 3, doneCount: 3 }), FRI_START),
    "Alex Morgan · Complete · 3 of 3 done · All complete",
  );
  assert.equal(
    accountabilityLine(acc({ state: "upcoming", totalDue: 0 }), FRI_START),
    "Alex Morgan · Upcoming · Nothing due in this window",
  );
});

test("week days group shifts by the dates they touch, cancelled excluded", () => {
  const overnight = shift({
    id: "shift-night",
    staffId: "alex",
    startsAt: "2026-10-31T03:00:00.000Z",
    endsAt: "2026-10-31T11:00:00.000Z",
  });
  const cancelled = shift({ id: "shift-x", status: "cancelled" });
  const days = weekDayShifts({
    dates: ["2026-10-30", "2026-10-31"],
    shifts: [shift({}), overnight, cancelled],
    accountability: new Map([["shift-1", acc({})]]),
    todayIso: "2026-10-30",
  });
  assert.equal(days[0].isToday, true);
  assert.deepEqual(days[0].rows.map((row) => row.shift.id), ["shift-1", "shift-night"]);
  assert.deepEqual(days[1].rows.map((row) => row.shift.id), ["shift-night"]);
  assert.equal(days[0].rows[0].acc?.shiftId, "shift-1");
  assert.equal(days[0].rows[1].acc, null);
});

test("your shift: live beats upcoming; ended misses never follow you home", () => {
  const now = new Date("2026-10-30T17:00:00.000Z"); // noon Central, Friday
  const upcoming = acc({ shiftId: "s-up", state: "upcoming", startsAt: "2026-10-30T20:00:00.000Z", endsAt: FRI_END });
  const live = acc({ shiftId: "s-live", state: "in_progress", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T21:00:00.000Z" });
  assert.equal(pickYourShift([upcoming, live], "alex", "2026-10-30", now)?.shiftId, "s-live");
  assert.equal(pickYourShift([upcoming], "alex", "2026-10-30", now)?.shiftId, "s-up");
  // Someone else's shift is not yours.
  assert.equal(pickYourShift([live], "taylor", "2026-10-30", now), null);
  // Yesterday's ended shift with misses stays on the board, not the strip.
  const ended = acc({
    shiftId: "s-ended",
    state: "has_missing",
    startsAt: "2026-10-29T13:00:00.000Z",
    endsAt: "2026-10-29T21:00:00.000Z",
    totalDue: 5,
    doneCount: 3,
  });
  assert.equal(pickYourShift([ended], "alex", "2026-10-30", now), null);
  // A fully-done shift whose window contains now is still yours.
  const doneLive = acc({ shiftId: "s-done", state: "complete", startsAt: "2026-10-30T13:00:00.000Z", endsAt: "2026-10-30T21:00:00.000Z", totalDue: 4, doneCount: 4 });
  assert.equal(pickYourShift([doneLive], "alex", "2026-10-30", now)?.shiftId, "s-done");
});

test("the strip text caps the still-to-do names and counts the rest", () => {
  const text = yourShiftText(
    acc({
      state: "in_progress",
      totalDue: 9,
      doneCount: 4,
      missingItems: [
        { id: "m1", kind: "shift_note", label: "Shift note — Ellis Hart", dueAt: FRI_END, done: false },
        { id: "m2", kind: "menu", label: "Dinner record — Morgan Pruitt", dueAt: FRI_START, done: false },
        { id: "m3", kind: "menu", label: "Snack record — Morgan Pruitt", dueAt: FRI_START, done: false },
      ],
    }),
  );
  assert.equal(text.title, "Your shift · 3:00 PM – 11:00 PM");
  assert.equal(
    text.detail,
    "4 of 9 done · Still to do: Shift note — Ellis Hart; Dinner record — Morgan Pruitt · and 1 more",
  );
  const upcoming = yourShiftText(
    acc({ state: "upcoming", totalDue: 2, doneCount: 0, missingItems: [{ id: "m1", kind: "menu", label: "Dinner record — Morgan Pruitt", dueAt: FRI_START, done: false }] }),
  );
  assert.match(upcoming.detail, /^0 of 2 done · Due on this shift: /);
});
