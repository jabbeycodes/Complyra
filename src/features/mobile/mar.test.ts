import { test } from "node:test";
import assert from "node:assert/strict";
import type { MedDoseMark, MedInventoryView } from "../../data/types";
import {
  centralNowHhmm,
  centralTodayIso,
  doseStatusText,
  formatDoseTime,
  frequencyText,
  groupPasses,
  marDayHeading,
  passSummaryText,
  shiftIsoDate,
} from "./mar";

function inventory(partial: Partial<MedInventoryView>): MedInventoryView {
  return {
    id: "inv-1",
    agencyId: "agency",
    individualId: "person-1",
    siteId: "site-1",
    medicationId: "med-1",
    medicationName: "Medication",
    strength: "10 mg",
    kind: "scheduled",
    doseTimes: ["08:00"],
    lowThresholdDays: 7,
    reorderAcknowledgedOn: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    currentCount: 30,
    daysRemaining: 15,
    reorderPointPills: 7,
    status: "ok",
    alertActive: false,
    prnDosesSinceDelivery: 0,
    deliveries: [],
    doseExceptions: [],
    ...partial,
  } as MedInventoryView;
}

function mark(partial: Partial<MedDoseMark>): MedDoseMark {
  return {
    id: "mark-1",
    agencyId: "agency",
    individualId: "person-1",
    medicationId: "med-1",
    doseDate: "2026-09-12",
    doseTime: "08:00",
    status: "given",
    markedBy: "user-1",
    markedByName: "Alex Morgan",
    markedAt: "2026-09-12T13:05:00.000Z",
    ...partial,
  };
}

test("centralTodayIso reads the date in America/Chicago, not UTC or device time", () => {
  // 2026-09-12T04:30Z is still Sep 11 in Central (11:30 PM CDT).
  assert.equal(centralTodayIso(new Date("2026-09-12T04:30:00.000Z")), "2026-09-11");
  // 2026-09-12T05:30Z is Sep 12 in Central (12:30 AM CDT).
  assert.equal(centralTodayIso(new Date("2026-09-12T05:30:00.000Z")), "2026-09-12");
  // Winter (CST, UTC-6): 2026-01-15T05:30Z is Jan 14 in Central.
  assert.equal(centralTodayIso(new Date("2026-01-15T05:30:00.000Z")), "2026-01-14");
});

test("centralNowHhmm reads the wall clock in Central", () => {
  assert.equal(centralNowHhmm(new Date("2026-09-12T13:30:00.000Z")), "08:30");
  assert.equal(centralNowHhmm(new Date("2026-01-15T13:30:00.000Z")), "07:30");
});

test("shiftIsoDate moves whole calendar days without timezone drift", () => {
  assert.equal(shiftIsoDate("2026-09-12", 1), "2026-09-13");
  assert.equal(shiftIsoDate("2026-09-12", -1), "2026-09-11");
  assert.equal(shiftIsoDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftIsoDate("2026-03-01", -1), "2026-02-28");
});

test("formatDoseTime renders 12-hour labels", () => {
  assert.equal(formatDoseTime("08:00"), "8:00 AM");
  assert.equal(formatDoseTime("20:00"), "8:00 PM");
  assert.equal(formatDoseTime("00:30"), "12:30 AM");
  assert.equal(formatDoseTime("12:00"), "12:00 PM");
});

test("marDayHeading labels today, yesterday and tomorrow in words", () => {
  assert.match(marDayHeading("2026-09-12", "2026-09-12"), /^Today · /);
  assert.match(marDayHeading("2026-09-11", "2026-09-12"), /^Yesterday · /);
  assert.match(marDayHeading("2026-09-13", "2026-09-12"), /^Tomorrow · /);
  assert.doesNotMatch(marDayHeading("2026-09-20", "2026-09-12"), /Today/);
});

test("doseStatusText is text-first for every state", () => {
  assert.equal(doseStatusText(null), "Not yet given");
  assert.equal(
    doseStatusText(mark({})),
    "Given by Alex Morgan · 8:05 AM",
  );
  assert.match(doseStatusText(mark({ status: "missed" })), /^Missed by /);
  assert.match(doseStatusText(mark({ status: "on_hold" })), /^On hold by /);
});

test("frequencyText speaks plain words", () => {
  assert.equal(frequencyText(["08:00"]), "Once daily · 8:00 AM");
  assert.equal(
    frequencyText(["20:00", "08:00"]),
    "Twice daily · 8:00 AM, 8:00 PM",
  );
  assert.match(frequencyText(["06:00", "12:00", "18:00"]), /^Three times daily/);
});

test("groupPasses groups scheduled doses by time and skips PRN meds", () => {
  const items = [
    inventory({ medicationId: "med-a", medicationName: "Alpha", doseTimes: ["08:00", "20:00"] }),
    inventory({ medicationId: "med-b", medicationName: "Beta", doseTimes: ["08:00"] }),
    inventory({ medicationId: "med-c", medicationName: "Gamma", kind: "prn", doseTimes: [] }),
  ];
  const passes = groupPasses(items, [
    mark({ medicationId: "med-a", doseTime: "08:00" }),
    mark({ medicationId: "med-b", doseTime: "08:00", status: "missed" }),
  ]);
  assert.equal(passes.length, 2);
  assert.equal(passes[0].doseTime, "08:00");
  assert.equal(passes[0].total, 2);
  assert.equal(passes[0].given, 1);
  assert.equal(passes[0].recorded, 2);
  assert.equal(passes[1].doseTime, "20:00");
  assert.equal(passes[1].given, 0);
  assert.equal(passes[1].recorded, 0);
});

test("passSummaryText counts given, other marks and unrecorded doses in words", () => {
  const items = [
    inventory({ medicationId: "med-a", medicationName: "Alpha", doseTimes: ["08:00"] }),
    inventory({ medicationId: "med-b", medicationName: "Beta", doseTimes: ["08:00"] }),
    inventory({ medicationId: "med-c", medicationName: "Gamma", doseTimes: ["08:00"] }),
  ];
  const [pass] = groupPasses(items, [
    mark({ medicationId: "med-a" }),
    mark({ medicationId: "med-b", status: "missed" }),
  ]);
  assert.equal(passSummaryText(pass), "1 of 3 given · 1 missed · 1 not yet given");
  const [done] = groupPasses(items, [
    mark({ medicationId: "med-a" }),
    mark({ medicationId: "med-b" }),
    mark({ medicationId: "med-c" }),
  ]);
  assert.equal(passSummaryText(done), "3 of 3 given");
});
