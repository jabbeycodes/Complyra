/**
 * TIME-OFF tests: the request lifecycle domain rules, the local store's
 * end-to-end flow (submit → decide → ledger debit; cancel paths and the
 * restoring adjustment), and the open-shift coverage release/restore.
 * Local stores run against an in-memory localStorage shim, so two store
 * instances (employee + manager) share one "browser" like the demo does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  approvedTimeOffHours,
  assertCanCancelTimeOff,
  assertCanDecideTimeOff,
  buildRequestDays,
  currentLeaveBalance,
  datesInRange,
  isLeaveType,
  normalizeLeaveKind,
  pendingTimeOffHours,
  sumRequestDayHours,
  timeOffBalanceView,
  validateTimeOffRequest,
  type HrAccrualLedgerEntry,
  type HrTimeOffRequest,
} from "./hr";
import { createHrStore, type HrStore } from "./hrStore";
import { createOpenShiftStore } from "./openShiftStore";
import {
  releaseShiftsForApprovedTimeOff,
  restoreShiftsForCancelledTimeOff,
  shiftsForTimeOffRequest,
  timeOffReleaseMarker,
} from "./timeOffCoverage";

/* ------------------------------ localStorage ----------------------------- */

function installLocalStorageShim(): Map<string, string> {
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: (key: string, value: string) => saved.set(key, value),
      getItem: (key: string) => saved.get(key) ?? null,
      removeItem: (key: string) => saved.delete(key),
    },
  });
  return saved;
}

function removeLocalStorageShim(): void {
  Reflect.deleteProperty(globalThis, "localStorage");
}

/* -------------------------------- fixtures ------------------------------- */

function requestFixture(overrides: Partial<HrTimeOffRequest> = {}): HrTimeOffRequest {
  const startsOn = overrides.startsOn ?? "2027-01-04";
  const endsOn = overrides.endsOn ?? "2027-01-05";
  const days = overrides.days ?? buildRequestDays(startsOn, endsOn, 8);
  return {
    id: "req-1",
    agencyId: "agency-1",
    siteId: "site-1",
    staffId: "emp-1",
    kind: "pto",
    startsOn,
    endsOn,
    status: "pending",
    reason: "",
    days,
    totalHours: overrides.totalHours ?? sumRequestDayHours(days),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: "2026-12-01T09:00:00.000Z",
    updatedAt: "2026-12-01T09:00:00.000Z",
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<HrAccrualLedgerEntry> = {}): HrAccrualLedgerEntry {
  return {
    id: `led-${Math.random().toString(36).slice(2, 8)}`,
    agencyId: "agency-1",
    staffId: "emp-1",
    payPeriodId: null,
    periodStart: "2026-12-01",
    leaveType: "pto",
    accrued: 0,
    used: 0,
    adjustment: 0,
    balance: 0,
    note: null,
    createdAt: "2026-12-01T09:00:00.000Z",
    ...overrides,
  };
}

/* ------------------------------ domain rules ----------------------------- */

test("time-off domain: leave kinds normalize (legacy other → unpaid)", () => {
  assert.equal(normalizeLeaveKind("other"), "unpaid");
  assert.equal(normalizeLeaveKind("pto"), "pto");
  assert.equal(normalizeLeaveKind("bereavement"), "bereavement");
  assert.equal(normalizeLeaveKind("nonsense"), "unpaid");
  assert.equal(isLeaveType("vacation"), true);
  assert.equal(isLeaveType("other"), false);
});

test("time-off domain: day math — ranges, overrides, totals", () => {
  assert.deepEqual(datesInRange("2027-01-04", "2027-01-06"), [
    "2027-01-04",
    "2027-01-05",
    "2027-01-06",
  ]);
  assert.deepEqual(datesInRange("2027-01-06", "2027-01-04"), []);
  const days = buildRequestDays("2027-01-04", "2027-01-06", 8, { "2027-01-05": 4 });
  assert.deepEqual(days, [
    { date: "2027-01-04", hours: 8 },
    { date: "2027-01-05", hours: 4 },
    { date: "2027-01-06", hours: 8 },
  ]);
  assert.equal(sumRequestDayHours(days), 20);
});

test("time-off domain: request validation catches bad days and long notes", () => {
  const base = {
    kind: "pto" as const,
    startsOn: "2027-01-04",
    endsOn: "2027-01-05",
    reason: "",
    days: buildRequestDays("2027-01-04", "2027-01-05", 8),
  };
  assert.deepEqual(validateTimeOffRequest(base), []);
  assert.ok(validateTimeOffRequest({ ...base, reason: "x".repeat(501) }).length > 0);
  assert.ok(
    validateTimeOffRequest({ ...base, days: [{ date: "2027-01-04", hours: 0 }] }).length > 0,
  );
  assert.ok(
    validateTimeOffRequest({ ...base, days: [{ date: "2027-01-04", hours: 25 }] }).length > 0,
  );
  assert.ok(
    validateTimeOffRequest({ ...base, days: [{ date: "2027-01-09", hours: 8 }] }).length > 0,
  );
  assert.ok(validateTimeOffRequest({ ...base, days: [] }).length > 0);
  assert.ok(
    validateTimeOffRequest({ ...base, startsOn: "2027-01-05", endsOn: "2027-01-04" }).length > 0,
  );
});

test("time-off domain: balance view = ledger − pending, projected after this request", () => {
  const ledger = [
    ledgerEntry({ accrued: 80, balance: 80, periodStart: "2026-12-01" }),
    ledgerEntry({ used: 16, balance: 64, periodStart: "2026-12-15", createdAt: "2026-12-15T09:00:00.000Z" }),
  ];
  const requests = [
    requestFixture({ id: "pending-1", status: "pending", totalHours: 16 }),
    requestFixture({ id: "approved-1", status: "approved", totalHours: 8 }),
    requestFixture({ id: "denied-1", status: "denied", totalHours: 40 }),
  ];
  assert.equal(currentLeaveBalance(ledger, "pto"), 64);
  assert.equal(pendingTimeOffHours(requests, "emp-1", "pto"), 16);
  assert.equal(approvedTimeOffHours(requests, "emp-1", "pto"), 8);
  const view = timeOffBalanceView(ledger, requests, "emp-1", "pto", 8);
  assert.deepEqual(view, {
    balance: 64,
    pendingHours: 16,
    availableHours: 48,
    projectedHours: 40,
  });
});

test("time-off domain: transition guards", () => {
  const pending = requestFixture({ status: "pending" });
  const approved = requestFixture({ status: "approved", startsOn: "2027-01-04" });
  const denied = requestFixture({ status: "denied" });

  assert.doesNotThrow(() => assertCanDecideTimeOff(pending));
  assert.throws(() => assertCanDecideTimeOff(approved), /already been decided/);
  assert.throws(() => assertCanDecideTimeOff(denied), /already been decided/);

  // Owner cancels own pending — fine. Owner cannot cancel an approval.
  assert.doesNotThrow(() =>
    assertCanCancelTimeOff(pending, { byManager: false, today: "2026-12-20" }),
  );
  assert.throws(
    () => assertCanCancelTimeOff(approved, { byManager: false, today: "2026-12-20" }),
    /only a manager/,
  );
  // Manager cancels approved before start — needs a reason.
  assert.throws(
    () => assertCanCancelTimeOff(approved, { byManager: true, today: "2026-12-20" }),
    /reason/,
  );
  assert.doesNotThrow(() =>
    assertCanCancelTimeOff(approved, {
      byManager: true,
      today: "2026-12-20",
      reason: "Coverage fell through",
    }),
  );
  // After the start date, nobody cancels.
  assert.throws(
    () =>
      assertCanCancelTimeOff(approved, {
        byManager: true,
        today: "2027-01-04",
        reason: "Too late",
      }),
    /already started/,
  );
  // Closed requests never move.
  assert.throws(
    () => assertCanCancelTimeOff(denied, { byManager: true, today: "2026-12-20", reason: "x" }),
    /already closed/,
  );
});

/* ---------------------------- local store flow --------------------------- */

const AGENCY = "agency-timeoff-test";
const EMP = "emp-1";
const MGR = "mgr-1";

async function seedBank(employee: HrStore, mgr: HrStore): Promise<void> {
  // Local buckets are per user: seed the policy into both handles' buckets
  // (the balance gate reads the acting user's bucket in local mode).
  for (const store of [mgr, employee]) {
    await store.createAccrualPolicy({
      leaveType: "pto",
      tenureBands: [{ minYears: 0, maxYears: null, hoursPerPeriod: 0 }],
      carryoverCapHours: 40,
      carryoverBasis: "calendar_year",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    });
  }
  // Local buckets are per user: the opening accrual lands in the employee's
  // bucket when posted through their store handle (same-browser demo).
  await employee.postLedgerEntry({
    staffId: EMP,
    leaveType: "pto",
    accrued: 80,
    periodStart: "2026-01-05",
    note: "opening balance",
  });
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

test("time-off local store: submit → approve debits the ledger; history is kept", async () => {
  installLocalStorageShim();
  try {
    const employee = createHrStore({ agencyId: AGENCY, userId: EMP });
    const manager = createHrStore({ agencyId: AGENCY, userId: MGR });
    await seedBank(employee, manager);

    const startsOn = futureDate(14);
    const endsOn = futureDate(15);
    const created = await employee.createTimeOffRequest({
      kind: "pto",
      startsOn,
      endsOn,
      reason: "Family trip",
      days: buildRequestDays(startsOn, endsOn, 8, { [endsOn]: 4 }),
      siteId: "site-1",
    });
    assert.equal(created.status, "pending");
    assert.equal(created.totalHours, 12);
    assert.equal(created.siteId, "site-1");

    // The manager sees it in the team list; totals derive from the days.
    const team = await manager.listTimeOffRequests({});
    assert.equal(team.length, 1);
    assert.equal(team[0].totalHours, 12);

    const decided = await manager.decideTimeOffRequest(created.id, true, "Coverage arranged");
    assert.equal(decided.status, "approved");
    assert.equal(decided.decidedBy, MGR);

    // Fresh employee handle (a page reload): balance dropped by 12h.
    const employeeReloaded = createHrStore({ agencyId: AGENCY, userId: EMP });
    const entries = await employeeReloaded.listLedgerEntries(EMP, { leaveType: "pto" });
    assert.equal(currentLeaveBalance(entries, "pto"), 68);

    const events = await employeeReloaded.listTimeOffEvents(created.id);
    assert.deepEqual(
      events.map((e) => e.event),
      ["submitted", "approved"],
    );
    assert.equal(events[1].actorId, MGR);
    assert.equal(events[1].note, "Coverage arranged");

    // Decisions are final: a second decide throws and posts nothing.
    await assert.rejects(
      () => manager.decideTimeOffRequest(created.id, false),
      /already been decided/,
    );
    const entriesAfter = await employeeReloaded.listLedgerEntries(EMP, { leaveType: "pto" });
    assert.equal(currentLeaveBalance(entriesAfter, "pto"), 68);
  } finally {
    removeLocalStorageShim();
  }
});

test("time-off local store: pending hours reserve the balance at submit", async () => {
  installLocalStorageShim();
  try {
    const employee = createHrStore({ agencyId: AGENCY, userId: EMP });
    const manager = createHrStore({ agencyId: AGENCY, userId: MGR });
    await seedBank(employee, manager);

    const first = await employee.createTimeOffRequest({
      kind: "pto",
      startsOn: futureDate(20),
      endsOn: futureDate(24),
      reason: "Week off",
      days: buildRequestDays(futureDate(20), futureDate(24), 8),
    });
    assert.equal(first.totalHours, 40);
    // 80 accrued − 40 pending leaves 40: a 48h request must be refused.
    await assert.rejects(
      () =>
        employee.createTimeOffRequest({
          kind: "pto",
          startsOn: futureDate(30),
          endsOn: futureDate(35),
          reason: "Too much",
          days: buildRequestDays(futureDate(30), futureDate(35), 8),
        }),
      /Not enough pto balance/,
    );
    // Unpaid never touches the balance gate.
    const unpaid = await employee.createTimeOffRequest({
      kind: "unpaid",
      startsOn: futureDate(30),
      endsOn: futureDate(35),
      reason: "",
      days: buildRequestDays(futureDate(30), futureDate(35), 8),
    });
    assert.equal(unpaid.status, "pending");
    assert.equal(unpaid.totalHours, 48);
  } finally {
    removeLocalStorageShim();
  }
});

test("time-off local store: cancels — owner pending, manager approved restores hours", async () => {
  installLocalStorageShim();
  try {
    const employee = createHrStore({ agencyId: AGENCY, userId: EMP });
    const manager = createHrStore({ agencyId: AGENCY, userId: MGR });
    await seedBank(employee, manager);

    // Owner cancels a pending request.
    const pendingReq = await employee.createTimeOffRequest({
      kind: "pto",
      startsOn: futureDate(10),
      endsOn: futureDate(10),
      reason: "",
      days: buildRequestDays(futureDate(10), futureDate(10), 8),
    });
    const cancelledPending = await employee.cancelTimeOffRequest(pendingReq.id);
    assert.equal(cancelledPending.status, "cancelled");
    assert.equal(cancelledPending.cancelledBy, EMP);

    // Approved request: the owner cannot cancel it…
    const approvedReq = await employee.createTimeOffRequest({
      kind: "pto",
      startsOn: futureDate(12),
      endsOn: futureDate(13),
      reason: "Break",
      days: buildRequestDays(futureDate(12), futureDate(13), 8),
    });
    await manager.decideTimeOffRequest(approvedReq.id, true);
    await assert.rejects(
      () => employee.cancelTimeOffRequest(approvedReq.id, { reason: "Changed my mind" }),
      /only a manager/,
    );
    // …but a manager can, with a reason, and the ledger is restored.
    const cancelledApproved = await manager.cancelTimeOffRequest(approvedReq.id, {
      reason: "Coverage fell through",
    });
    assert.equal(cancelledApproved.status, "cancelled");
    assert.equal(cancelledApproved.cancelReason, "Coverage fell through");

    const employeeReloaded = createHrStore({ agencyId: AGENCY, userId: EMP });
    const entries = await employeeReloaded.listLedgerEntries(EMP, { leaveType: "pto" });
    assert.equal(currentLeaveBalance(entries, "pto"), 80);
    const events = await employeeReloaded.listTimeOffEvents(approvedReq.id);
    assert.deepEqual(
      events.map((e) => e.event),
      ["submitted", "approved", "cancelled"],
    );
  } finally {
    removeLocalStorageShim();
  }
});

/* ------------------------------ coverage flow ---------------------------- */

test("time-off coverage: approval releases shifts; cancellation restores them", async () => {
  installLocalStorageShim();
  try {
    const employee = createHrStore({ agencyId: AGENCY, userId: EMP });
    const manager = createHrStore({ agencyId: AGENCY, userId: MGR });
    await seedBank(employee, manager);

    const day1 = futureDate(14);
    const day2 = futureDate(15);
    // Two shifts on the requested days, plus one outside the window.
    const shiftA = await manager.createShift({
      siteId: "site-1",
      staffId: EMP,
      title: "Day shift",
      startsAt: `${day1}T07:00:00`,
      endsAt: `${day1}T15:00:00`,
      status: "published",
      notes: null,
    });
    const shiftB = await manager.createShift({
      siteId: "site-1",
      staffId: EMP,
      title: "Day shift",
      startsAt: `${day2}T07:00:00`,
      endsAt: `${day2}T15:00:00`,
      status: "published",
      notes: null,
    });
    await manager.createShift({
      siteId: "site-1",
      staffId: EMP,
      title: "Day shift",
      startsAt: `${futureDate(21)}T07:00:00`,
      endsAt: `${futureDate(21)}T15:00:00`,
      status: "published",
      notes: null,
    });

    const request = await employee.createTimeOffRequest({
      kind: "pto",
      startsOn: day1,
      endsOn: day2,
      reason: "Trip",
      days: buildRequestDays(day1, day2, 8),
      siteId: "site-1",
    });
    const approved = await manager.decideTimeOffRequest(request.id, true);

    const openStore = createOpenShiftStore({
      agencyId: AGENCY,
      userId: MGR,
      fullName: "Mgr",
      canManageSchedule: true,
      canPostAgencyWide: false,
    });
    const outcome = await releaseShiftsForApprovedTimeOff({
      hrStore: manager,
      openShiftStore: openStore,
      request: approved,
      staffName: "Emp One",
    });
    assert.equal(outcome.released, 2);
    assert.equal(outcome.flagged, 0);
    assert.deepEqual(outcome.failures, []);

    // The board has two coverage postings carrying the marker…
    const postings = (await openStore.listOpenShifts()).filter((p) =>
      p.notes?.includes(timeOffReleaseMarker(request.id)),
    );
    assert.equal(postings.length, 2);
    assert.ok(postings.every((p) => p.status === "open"));

    // …and the originals are cancelled with the assignment preserved.
    const shifts = await manager.listShifts(`${day1}T00:00:00`, `${day2}T23:59:59.999`);
    const originals = shifts.filter((s) => s.id === shiftA.id || s.id === shiftB.id);
    assert.ok(originals.every((s) => s.status === "cancelled"));
    assert.ok(originals.every((s) => s.notes?.includes("Originally assigned to Emp One")));

    // Cancelling the approved request reverses the release.
    const cancelled = await manager.cancelTimeOffRequest(request.id, {
      reason: "Trip postponed",
    });
    const restored = await restoreShiftsForCancelledTimeOff({
      hrStore: manager,
      openShiftStore: openStore,
      request: cancelled,
    });
    assert.equal(restored.restored, 2);
    assert.equal(restored.postingsCancelled, 2);
    const shiftsAfter = await manager.listShifts(`${day1}T00:00:00`, `${day2}T23:59:59.999`);
    const originalsAfter = shiftsAfter.filter((s) => s.id === shiftA.id || s.id === shiftB.id);
    assert.ok(originalsAfter.every((s) => s.status === "published"));
    const postingsAfter = (await openStore.listOpenShifts()).filter((p) =>
      p.notes?.includes(timeOffReleaseMarker(request.id)),
    );
    assert.ok(postingsAfter.every((p) => p.status === "cancelled"));

    // The preview helper agrees with the release set.
    const previewSet = shiftsForTimeOffRequest(
      originalsAfter.map((s) => ({ ...s, status: "published" as const })),
      approved,
    );
    assert.equal(previewSet.length, 2);
  } finally {
    removeLocalStorageShim();
  }
});
