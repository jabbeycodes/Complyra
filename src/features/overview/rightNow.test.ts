/**
 * RIGHT-NOW strip aggregation tests: the pure model behind the manager
 * strip — clocked-in/break detection, expected-not-arrived rules
 * (including the time-off excuses and the partial-day limit), out-today
 * full vs partial days, open shifts occurring today, decision counts
 * behind their permission gates, and site scoping on every segment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRightNowModel,
  type RightNowInputs,
} from "./rightNow";
import type {
  HrMissedPunchReport,
  HrPunch,
  HrPunchCorrection,
  HrShift,
  HrTimeOffRequest,
} from "../../data/hr";
import type { HrOpenShift } from "../../data/openShifts";

const CEDAR = "site-cedar";
const WILLOW = "site-willow";
const TODAY = "2026-09-12"; // a Saturday
const NOW = "2026-09-12T12:00:00";

const STAFF = [
  { userId: "u-alex", fullName: "Alex Morgan", siteId: CEDAR },
  { userId: "u-taylor", fullName: "Taylor Reed", siteId: CEDAR },
  { userId: "u-jordan", fullName: "Jordan Lee", siteId: WILLOW },
  { userId: "u-casey", fullName: "Casey Adams", siteId: WILLOW },
];

function punch(partial: Partial<HrPunch>): HrPunch {
  return {
    id: `p-${Math.random()}`,
    agencyId: "agency",
    siteId: CEDAR,
    staffId: "u-alex",
    kind: "in",
    punchedAt: `${TODAY}T07:00:00`,
    source: "web",
    note: null,
    shiftId: null,
    ...partial,
  };
}

function shift(partial: Partial<HrShift>): HrShift {
  return {
    id: `s-${Math.random()}`,
    agencyId: "agency",
    siteId: CEDAR,
    staffId: "u-taylor",
    title: "Day shift",
    startsAt: `${TODAY}T07:00:00`,
    endsAt: `${TODAY}T15:00:00`,
    status: "published",
    notes: null,
    createdBy: "u-mgr",
    ...partial,
  };
}

function timeOff(partial: Partial<HrTimeOffRequest>): HrTimeOffRequest {
  return {
    id: `t-${Math.random()}`,
    agencyId: "agency",
    siteId: CEDAR,
    staffId: "u-alex",
    kind: "pto",
    startsOn: TODAY,
    endsOn: TODAY,
    status: "approved",
    reason: "",
    days: [{ date: TODAY, hours: 8 }],
    totalHours: 8,
    decidedBy: "u-mgr",
    decidedAt: `${TODAY}T06:00:00`,
    decisionNote: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: `${TODAY}T05:00:00`,
    updatedAt: `${TODAY}T06:00:00`,
    ...partial,
  };
}

function correction(partial: Partial<HrPunchCorrection>): HrPunchCorrection {
  return {
    id: `c-${Math.random()}`,
    punchId: "p-1",
    staffId: "u-alex",
    requestedKind: "in",
    requestedAt: `${TODAY}T07:05:00`,
    reason: "Forgot to punch",
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    ...partial,
  };
}

function missed(partial: Partial<HrMissedPunchReport>): HrMissedPunchReport {
  return {
    id: `m-${Math.random()}`,
    agencyId: "agency",
    staffId: "u-taylor",
    siteId: CEDAR,
    workDate: TODAY,
    claimedInAt: `${TODAY}T07:00:00`,
    claimedOutAt: null,
    reason: "Kiosk was down",
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: `${TODAY}T09:00:00`,
    ...partial,
  };
}

function openShift(partial: Partial<HrOpenShift>): HrOpenShift {
  return {
    id: `o-${Math.random()}`,
    agencyId: "agency",
    siteId: CEDAR,
    kind: "temporary",
    audience: "site",
    title: "Coverage needed",
    startsAt: `${TODAY}T15:00:00`,
    endsAt: `${TODAY}T23:00:00`,
    days: [],
    windowStart: null,
    windowEnd: null,
    effectiveFrom: null,
    weeklyHours: 8,
    notes: "",
    slots: 1,
    filledCount: 0,
    pickupMode: "first_come",
    status: "open",
    postedBy: "u-mgr",
    postedByName: "Manager",
    createdAt: `${TODAY}T06:00:00`,
    ...partial,
  };
}

function inputs(partial: Partial<RightNowInputs>): RightNowInputs {
  return {
    nowIso: NOW,
    today: TODAY,
    siteIds: [CEDAR],
    staff: STAFF,
    openPunches: [],
    punchesToday: [],
    shiftsToday: [],
    timeOff: [],
    corrections: [],
    missedReports: [],
    openShifts: [],
    canApproveTimeOff: true,
    canReviewTimecards: true,
    canViewTeam: true,
    ...partial,
  };
}

test("clocked in: open punches in scope, with break detection", () => {
  const inPunch = punch({ staffId: "u-alex", punchedAt: `${TODAY}T07:02:00` });
  const model = buildRightNowModel(
    inputs({
      openPunches: [
        inPunch,
        punch({ staffId: "u-jordan", siteId: WILLOW }), // out of scope
        punch({ staffId: "u-taylor", kind: "out" }), // not an open "in"
      ],
      punchesToday: [
        inPunch,
        punch({ staffId: "u-alex", kind: "break_in", punchedAt: `${TODAY}T10:00:00` }),
      ],
    }),
  );
  assert.equal(model.clockedIn.length, 1);
  assert.equal(model.clockedIn[0].name, "Alex Morgan");
  assert.equal(model.clockedIn[0].clockInAt, `${TODAY}T07:02:00`);
  assert.equal(model.clockedIn[0].onBreak, true);
});

test("not arrived: started shift, no punch, not excused", () => {
  const model = buildRightNowModel(
    inputs({
      shiftsToday: [
        shift({ staffId: "u-taylor" }),
        shift({ staffId: "u-alex", startsAt: `${TODAY}T19:00:00`, endsAt: `${TODAY}T23:00:00` }), // not started
        shift({ staffId: "u-jordan", siteId: WILLOW }), // out of scope
        shift({ staffId: null }), // unassigned gap — not a no-show
        shift({ staffId: "u-casey", siteId: WILLOW, status: "cancelled" }),
      ],
      punchesToday: [],
    }),
  );
  assert.equal(model.notArrived.length, 1);
  assert.equal(model.notArrived[0].name, "Taylor Reed");
  assert.equal(model.notArrived[0].shiftStartAt, `${TODAY}T07:00:00`);
});

test("not arrived: a staffer who clocked in (even late) is not listed", () => {
  const model = buildRightNowModel(
    inputs({
      shiftsToday: [shift({ staffId: "u-taylor" })],
      punchesToday: [punch({ staffId: "u-taylor", punchedAt: `${TODAY}T07:20:00` })],
    }),
  );
  assert.equal(model.notArrived.length, 0);
});

test("not arrived: full-day approved leave excuses the shift", () => {
  const model = buildRightNowModel(
    inputs({
      shiftsToday: [shift({ staffId: "u-taylor" })],
      timeOff: [timeOff({ staffId: "u-taylor", days: [{ date: TODAY, hours: 8 }] })],
    }),
  );
  assert.equal(model.notArrived.length, 0);
  assert.equal(model.outToday.length, 1);
  assert.equal(model.outToday[0].partial, false);
  assert.equal(model.outToday[0].leaveLabel, "Earned Time Off");
});

test("out today: partial-day leave reads partial with hours; short shift excused only when hours cover it", () => {
  const partial = buildRightNowModel(
    inputs({
      shiftsToday: [shift({ staffId: "u-taylor" })], // 8h shift
      timeOff: [timeOff({ staffId: "u-taylor", kind: "sick", days: [{ date: TODAY, hours: 4 }] })],
    }),
  );
  assert.equal(partial.outToday[0].partial, true);
  assert.equal(partial.outToday[0].hours, 4);
  assert.equal(partial.outToday[0].leaveLabel, "Sick");
  // 4 approved hours do not cover an 8-hour shift — still expected.
  assert.equal(partial.notArrived.length, 1);

  const covered = buildRightNowModel(
    inputs({
      shiftsToday: [
        shift({ staffId: "u-taylor", startsAt: `${TODAY}T07:00:00`, endsAt: `${TODAY}T10:00:00` }), // 3h shift
      ],
      timeOff: [timeOff({ staffId: "u-taylor", kind: "sick", days: [{ date: TODAY, hours: 4 }] })],
    }),
  );
  assert.equal(covered.notArrived.length, 0);
});

test("out today: pending or out-of-scope requests do not count", () => {
  const model = buildRightNowModel(
    inputs({
      timeOff: [
        timeOff({ staffId: "u-alex", status: "pending" }),
        timeOff({ staffId: "u-jordan", siteId: WILLOW }),
        timeOff({ staffId: "u-taylor", days: [{ date: "2026-09-13", hours: 8 }], startsOn: "2026-09-13", endsOn: "2026-09-13" }),
      ],
    }),
  );
  assert.equal(model.outToday.length, 0);
});

test("open shifts today: temporary today counts, tomorrow and filled do not", () => {
  const model = buildRightNowModel(
    inputs({
      openShifts: [
        openShift({}),
        openShift({ startsAt: "2026-09-13T07:00:00", endsAt: "2026-09-13T15:00:00" }),
        openShift({ filledCount: 1 }),
        openShift({ siteId: WILLOW }),
        openShift({ status: "filled" }),
      ],
    }),
  );
  assert.equal(model.openShiftsToday.length, 1);
  assert.equal(model.openShiftsToday[0].windowLabel, "3:00 PM – 11:00 PM");
  assert.equal(model.openShiftsToday[0].slotsLeft, 1);
});

test("open shifts today: permanent posting runs on its weekday", () => {
  // 2026-09-12 is a Saturday (weekday 6).
  const runs = buildRightNowModel(
    inputs({
      openShifts: [
        openShift({
          kind: "permanent",
          startsAt: null,
          endsAt: null,
          days: [6],
          windowStart: "07:00",
          windowEnd: "15:00",
          effectiveFrom: "2026-09-01",
        }),
      ],
    }),
  );
  assert.equal(runs.openShiftsToday.length, 1);
  assert.equal(runs.openShiftsToday[0].windowLabel, "7:00 AM – 3:00 PM");

  const notToday = buildRightNowModel(
    inputs({
      openShifts: [
        openShift({
          kind: "permanent",
          startsAt: null,
          endsAt: null,
          days: [1, 2, 3, 4, 5],
          windowStart: "07:00",
          windowEnd: "15:00",
          effectiveFrom: "2026-09-01",
        }),
      ],
    }),
  );
  assert.equal(notToday.openShiftsToday.length, 0);
});

test("decisions: counts are pending-only, in-scope, and permission-gated", () => {
  const base = inputs({
    timeOff: [
      timeOff({ staffId: "u-alex", status: "pending" }),
      timeOff({ staffId: "u-jordan", siteId: WILLOW, status: "pending" }),
      timeOff({ staffId: "u-taylor", status: "approved" }),
    ],
    corrections: [correction({}), correction({ staffId: "u-jordan" })],
    missedReports: [missed({}), missed({ status: "approved" })],
  });
  const model = buildRightNowModel(base);
  assert.deepEqual(model.decisions, {
    timeOff: 1,
    corrections: 1,
    missedPunches: 1,
    total: 3,
  });

  const gated = buildRightNowModel({
    ...base,
    canApproveTimeOff: false,
    canReviewTimecards: false,
    canViewTeam: false,
  });
  assert.deepEqual(gated.decisions, {
    timeOff: 0,
    corrections: 0,
    missedPunches: 0,
    total: 0,
  });
});

test("all clear only when every segment is empty", () => {
  assert.equal(buildRightNowModel(inputs({})).allClear, true);
  const busy = buildRightNowModel(
    inputs({ openPunches: [punch({})] }),
  );
  assert.equal(busy.allClear, false);
});
