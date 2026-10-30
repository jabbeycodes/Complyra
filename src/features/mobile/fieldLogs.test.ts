import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drillMonthStatus,
  drillRowStatus,
  fieldLogAccess,
  gerMonthStatus,
  healthTodayStatus,
  houseCardStatus,
  menuTodayStatus,
  mileageMonthStatus,
  monthLabel,
  newGerDraft,
  notificationsToText,
  parseNotificationsText,
  personDayEntries,
  personalSpendingStatus,
} from "./fieldLogs";
import type { EmergencyDrill } from "../../data/monthlyChecks";
import type { MenuEntryView } from "../../data/menuRecords";
import type { GerReport } from "../../data/ger";
import type { HealthTrackEntry } from "../../data/healthTrack";
import type { MileageTripView } from "../../data/types";
import type { HouseCardEntryView } from "../../data/houseCard";
import type { PersonalSpendingEntryView } from "../../data/personalSpending";

const FULL = {
  "mileage.manage": true,
  "ger.create": true,
  "individuals.view": true,
};

test("field log access mirrors each desktop surface's gate", () => {
  // DSP: records menu (role list), mileage + GER (permissions), drills (role list).
  const dsp = fieldLogAccess("dsp", FULL);
  assert.deepEqual(
    [dsp.menu, dsp.mileage, dsp.drills, dsp.gerCreate, dsp.gerView, dsp.any],
    [true, true, true, true, true, true],
  );
  // Health viewing follows canViewHealthTrack: individuals.view, never HR.
  assert.equal(dsp.healthView, true);
  // The money trackers follow their desktop role lists (canView /
  // canRecord HouseCard + PersonalSpending): DSPs view and record both.
  assert.deepEqual(
    [dsp.houseCardView, dsp.houseCardRecord, dsp.spendingView, dsp.spendingRecord],
    [true, true, true, true],
  );
  // Nurse mirrors desktop too: menu entry, monthly-check completion —
  // and NO money tracker: nurses are absent from every money role list.
  const nurse = fieldLogAccess("nurse", FULL);
  assert.equal(nurse.menu, true);
  assert.equal(nurse.drills, true);
  assert.equal(nurse.healthView, true);
  assert.deepEqual(
    [nurse.houseCardView, nurse.houseCardRecord, nurse.spendingView, nurse.spendingRecord],
    [false, false, false, false],
  );
  // Without the permission keys, mileage and GER recording close even for
  // roles on the menu/drill role lists.
  const bare = fieldLogAccess("house_manager", {});
  assert.equal(bare.menu, true);
  assert.equal(bare.drills, true);
  assert.equal(bare.mileage, false);
  assert.equal(bare.gerCreate, false);
  assert.equal(bare.healthView, false);
  assert.equal(bare.any, true);
  // The money role lists need no permission keys either — a bare house
  // manager views and records both trackers, like the desktop gates.
  assert.deepEqual(
    [bare.houseCardView, bare.houseCardRecord, bare.spendingView, bare.spendingRecord],
    [true, true, true, true],
  );
});

test("an auditor records in no domain, but the tile opens for health and GER reading", () => {
  const auditor = fieldLogAccess("auditor", { "individuals.view": true });
  assert.equal(auditor.menu, false);
  assert.equal(auditor.mileage, false);
  assert.equal(auditor.drills, false);
  assert.equal(auditor.gerCreate, false);
  // The platform rule: auditors see everything, read-only — health
  // statuses and filed GERs are read surfaces, so the tile opens on the
  // health view gate even though the auditor records nothing anywhere.
  assert.equal(auditor.healthView, true);
  assert.equal(auditor.gerView, true);
  assert.equal(auditor.any, true);
  // The money trackers are read surfaces for auditors too — view both,
  // record in neither (the desktop role lists, verbatim).
  assert.deepEqual(
    [auditor.houseCardView, auditor.houseCardRecord, auditor.spendingView, auditor.spendingRecord],
    [true, false, true, false],
  );
  // Without individuals.view the auditor loses the health and GER read
  // rows — but the money rows are pure role-list gates (the desktop
  // House Card page and chart card ask for no permission key), so the
  // tile still opens on the two money read rows alone.
  const bareAuditor = fieldLogAccess("auditor", {});
  assert.equal(bareAuditor.healthView, false);
  assert.equal(bareAuditor.gerView, false);
  assert.equal(bareAuditor.houseCardView, true);
  assert.equal(bareAuditor.spendingView, true);
  assert.equal(bareAuditor.any, true);
});

test("a compliance admin reads both money trackers and records in neither", () => {
  // Money reading alone opens the tile: with no permission keys at
  // all, the compliance admin's only Quick log doors are the two
  // money rows, both read-only (the GER read row stays closed without
  // individuals.view, and compliance admins file nothing here).
  const compliance = fieldLogAccess("compliance_admin", {});
  assert.deepEqual(
    [compliance.houseCardView, compliance.houseCardRecord, compliance.spendingView, compliance.spendingRecord],
    [true, false, true, false],
  );
  assert.equal(compliance.menu, false);
  assert.equal(compliance.gerCreate, false);
  assert.equal(compliance.any, true);
});

test("HR records mileage only, and never reads GERs, health, or money", () => {
  const hr = fieldLogAccess("hr", { "mileage.manage": true, "individuals.view": true });
  assert.equal(hr.mileage, true);
  assert.equal(hr.any, true);
  assert.equal(hr.menu, false);
  assert.equal(hr.drills, false);
  // canViewGerReports excludes HR outright (no clinical permissions).
  assert.equal(hr.gerView, false);
  // canViewHealthTrack excludes HR the same way.
  assert.equal(hr.healthView, false);
  // HR is on no money role list either.
  assert.deepEqual(
    [hr.houseCardView, hr.houseCardRecord, hr.spendingView, hr.spendingRecord],
    [false, false, false, false],
  );
});

function menuEntry(partial: Partial<MenuEntryView>): MenuEntryView {
  return {
    id: "e1",
    agencyId: "a1",
    siteId: "s1",
    individualId: "p1",
    entryDate: "2026-10-30",
    mealSlot: "breakfast",
    foodText: "Oatmeal",
    amountEaten: "all",
    note: "",
    recordedBy: "u1",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: "2026-10-30T13:00:00.000Z",
    updatedAt: "2026-10-30T13:00:00.000Z",
    deletedAt: null,
    voidedBy: null,
    voidReason: "",
    ...partial,
  };
}

test("menu status counts the day's core meals across the whole home", () => {
  const entries = [
    menuEntry({ mealSlot: "breakfast" }),
    menuEntry({ mealSlot: "lunch", individualId: "p2" }),
    menuEntry({ mealSlot: "snack", individualId: "p2" }),
    menuEntry({ mealSlot: "dinner", entryDate: "2026-10-29" }),
    menuEntry({ mealSlot: "dinner", deletedAt: "2026-10-30T15:00:00.000Z" }),
  ];
  const status = menuTodayStatus(entries, "2026-10-30");
  assert.equal(status.recordedCount, 2);
  assert.deepEqual(status.missingLabels, ["Dinner"]);
  assert.equal(
    status.text,
    "2 of 3 meals recorded today · Dinner not yet recorded",
  );
  const full = menuTodayStatus(
    [...entries, menuEntry({ mealSlot: "dinner" })],
    "2026-10-30",
  );
  assert.equal(full.text, "3 of 3 meals recorded today");
});

test("person day entries filter and order by meal slot", () => {
  const entries = [
    menuEntry({ id: "d", mealSlot: "dinner" }),
    menuEntry({ id: "b", mealSlot: "breakfast" }),
    menuEntry({ id: "x", mealSlot: "lunch", individualId: "p2" }),
    menuEntry({ id: "y", mealSlot: "lunch", entryDate: "2026-10-29" }),
  ];
  assert.deepEqual(
    personDayEntries(entries, "p1", "2026-10-30").map((e) => e.id),
    ["b", "d"],
  );
});

function trip(partial: Partial<MileageTripView>): MileageTripView {
  return {
    id: "t1",
    agencyId: "a1",
    siteId: "s1",
    tripDate: "2026-10-30",
    odometerStart: 100,
    odometerEnd: 112,
    miles: 12,
    riderIds: ["p1"],
    reason: "Day program",
    backfilled: false,
    driverName: "Alex Morgan",
    signatureName: "Alex Morgan",
    createdBy: "u1",
    createdAt: "2026-10-30T20:00:00.000Z",
    riderShares: [{ individualId: "p1", miles: 12 }],
    ...partial,
  };
}

test("mileage status totals the month's trips in words", () => {
  assert.equal(
    mileageMonthStatus([], "2026-10").text,
    "No trips logged yet in October 2026",
  );
  const status = mileageMonthStatus(
    [trip({}), trip({ id: "t2", miles: 8.5 })],
    "2026-10",
  );
  assert.equal(status.tripCount, 2);
  assert.equal(status.totalMiles, 20.5);
  assert.equal(status.text, "2 trips · 20.5 miles logged in October 2026");
  assert.equal(monthLabel("2026-01"), "January 2026");
});

function drill(partial: Partial<EmergencyDrill>): EmergencyDrill {
  return {
    id: "d1",
    agencyId: "a1",
    siteId: "s1",
    monthKey: "2026-10",
    drillType: "fire",
    date: null,
    time: null,
    evacTime: null,
    leaderName: null,
    participants: "",
    awakeOrSleep: "",
    ...partial,
  };
}

test("drill status names the next drill still to record this month", () => {
  const drills = [
    drill({ id: "f", drillType: "fire", date: "2026-10-05", time: "14:20", leaderName: "Alex Morgan", participants: "All" }),
    drill({ id: "t", drillType: "tornado" }),
    drill({ id: "m", drillType: "medical_emergency" }),
    drill({ id: "old", drillType: "fire", monthKey: "2026-09" }),
  ];
  const status = drillMonthStatus(drills, "2026-10");
  assert.equal(status.doneCount, 1);
  assert.equal(status.totalCount, 3);
  assert.equal(status.nextLabel, "Tornado");
  assert.equal(
    status.text,
    "Tornado drill still to record this month · 1 of 3 done",
  );
  assert.equal(drillRowStatus(drills[0]), "Recorded 2026-10-05 · led by Alex Morgan");
  assert.equal(drillRowStatus(drills[1]), "Not yet recorded");
  const all = drillMonthStatus(
    drills.slice(0, 3).map((row) => ({
      ...row,
      date: "2026-10-05",
      time: "10:00",
      leaderName: "Alex Morgan",
      participants: "All",
    })),
    "2026-10",
  );
  assert.equal(all.text, "All 3 drills recorded for October 2026");
});

function report(partial: Partial<GerReport>): GerReport {
  return {
    id: "g1",
    agencyId: "a1",
    siteId: "s1",
    individualId: "p1",
    linkedIndividualIds: [],
    eventDate: "2026-10-12",
    eventTime: "09:30",
    location: "Kitchen",
    eventType: "Fall",
    severity: "Moderate",
    description: "Slipped.",
    immediateActions: "First aid.",
    notificationsMade: [],
    witnesses: "",
    reporterName: "Alex Morgan",
    reporterSignature: "Alex Morgan",
    reporterDate: "2026-10-12",
    status: "approved",
    reviewNote: "",
    reviewedByUserId: null,
    reviewedAt: null,
    resolutionStatus: "resolved",
    investigationRequired: false,
    investigationNotes: "",
    assignedManagerUserId: null,
    resolutionDueOn: null,
    closureNote: "",
    resolvedByUserId: null,
    resolvedAt: null,
    createdByUserId: "u1",
    createdAt: "2026-10-12T15:00:00.000Z",
    updatedAt: "2026-10-12T15:00:00.000Z",
    ...partial,
  };
}

test("GER status counts this month's reports by event date", () => {
  const reports = [
    report({}),
    report({ id: "g2", eventDate: "2026-10-28" }),
    report({ id: "g3", eventDate: "2026-09-28" }),
  ];
  assert.equal(gerMonthStatus(reports, "2026-10").monthCount, 2);
  assert.equal(gerMonthStatus(reports, "2026-10").text, "2 reports filed this month");
  assert.equal(gerMonthStatus([], "2026-10").text, "No reports filed this month");
});

test("GER notification lines round-trip in the desktop format", () => {
  const list = [
    { party: "Guardian", name: "Mary Hart", atTime: "3:15 PM" },
    { party: "Physician", name: "Dr. Lee", atTime: "" },
  ];
  const text = notificationsToText(list);
  assert.equal(text, "Guardian — Mary Hart — 3:15 PM\nPhysician — Dr. Lee — ");
  assert.deepEqual(parseNotificationsText(text), list);
  assert.deepEqual(parseNotificationsText("  \n"), []);
});

function healthEntry(
  partial: Partial<HealthTrackEntry> &
    Pick<HealthTrackEntry, "kind" | "occurredOn">,
): HealthTrackEntry {
  return {
    id: `h-${partial.kind}-${partial.occurredOn}-${Math.random()}`,
    agencyId: "a1",
    individualId: "p1",
    title: "Entry",
    details: {},
    flaggedAbnormal: false,
    note: "",
    recordedByUserId: "u1",
    createdAt: `${partial.occurredOn}T12:00:00.000Z`,
    ...partial,
  };
}

test("health status counts today's tracker entries across the whole home", () => {
  const entries = [
    healthEntry({ kind: "vitals", occurredOn: "2026-10-30" }),
    healthEntry({ kind: "intake", occurredOn: "2026-10-30" }),
    // Another Individual at the same home — the chooser counts the house.
    healthEntry({ kind: "intake", occurredOn: "2026-10-30", individualId: "p2" }),
    healthEntry({ kind: "seizure", occurredOn: "2026-10-30", individualId: "p2" }),
    // Yesterday and chart-only kinds never count toward the seven.
    healthEntry({ kind: "vitals", occurredOn: "2026-10-29" }),
    healthEntry({ kind: "immunization", occurredOn: "2026-10-30" }),
  ];
  const status = healthTodayStatus(entries, "2026-10-30");
  assert.equal(status.count, 4);
  assert.equal(status.text, "4 health entries logged today");
  assert.equal(
    healthTodayStatus([entries[0]], "2026-10-30").text,
    "1 health entry logged today",
  );
  assert.equal(
    healthTodayStatus([], "2026-10-30").text,
    "No health entries logged today",
  );
});

test("new GER drafts default to today, now, and the reporter", () => {
  const draft = newGerDraft({
    siteId: "s1",
    individualId: "p1",
    reporterName: "Alex Morgan",
    todayIso: "2026-10-30",
    nowTime: "14:05",
  });
  assert.equal(draft.eventDate, "2026-10-30");
  assert.equal(draft.eventTime, "14:05");
  assert.equal(draft.reporterDate, "2026-10-30");
  assert.equal(draft.reporterName, "Alex Morgan");
  assert.equal(draft.severity, "Moderate");
});

function houseEntry(
  partial: Partial<HouseCardEntryView>,
): HouseCardEntryView {
  return {
    id: "hc1",
    agencyId: "a1",
    siteId: "s1",
    entryDate: "2026-10-30",
    kind: "credit",
    location: "",
    amountCents: 0,
    category: null,
    individualId: null,
    note: "",
    receiptPhoto: null,
    recordedBy: "u1",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: "2026-10-30T13:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    individualName: null,
    voidedByName: null,
    voided: false,
    postCloseCorrection: false,
    ...partial,
  };
}

test("house card status states the live balance, and low balance in words", () => {
  const entries = [
    houseEntry({ id: "c", kind: "credit", amountCents: 61500 }),
    houseEntry({
      id: "p",
      kind: "purchase",
      amountCents: 46132,
      category: "groceries_household",
      location: "Hy-Vee",
    }),
    // A voided purchase never counts toward the balance.
    houseEntry({
      id: "v",
      kind: "purchase",
      amountCents: 5000,
      voidedBy: "u2",
      voidedAt: "2026-10-30T15:00:00.000Z",
      voidReason: "Wrong amount",
      voided: true,
    }),
  ];
  const status = houseCardStatus(entries);
  assert.equal(status.balanceCents, 15368);
  assert.equal(status.lowBalance, false);
  assert.equal(status.text, "Balance $153.68");
  const low = houseCardStatus([
    houseEntry({ id: "c", kind: "credit", amountCents: 9492 }),
  ]);
  assert.equal(low.balanceCents, 9492);
  assert.equal(low.lowBalance, true);
  assert.equal(low.text, "Balance $94.92 · Low balance");
  assert.equal(houseCardStatus([]).text, "Balance $0.00 · Low balance");
});

function spendingEntry(
  partial: Partial<PersonalSpendingEntryView>,
): PersonalSpendingEntryView {
  return {
    id: "ps1",
    agencyId: "a1",
    siteId: "s1",
    individualId: "p1",
    entryDate: "2026-10-30",
    kind: "deposit",
    location: "",
    purpose: "",
    amountCents: 0,
    note: "",
    receiptPhoto: null,
    recordedBy: "u1",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: "2026-10-30T13:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
    voidedByName: null,
    voided: false,
    runningBalanceCents: 0,
    overBalance: false,
    postCloseCorrection: false,
    ...partial,
  };
}

test("personal spending status combines every Individual's balance", () => {
  const ellis = [
    spendingEntry({ id: "d", kind: "deposit", amountCents: 21000 }),
    spendingEntry({
      id: "s",
      kind: "spend",
      amountCents: 2916,
      purpose: "Clothing",
      location: "Walmart",
    }),
  ];
  const morgan = [
    spendingEntry({ id: "d2", individualId: "p2", kind: "deposit", amountCents: 1020 }),
  ];
  const status = personalSpendingStatus([ellis, morgan]);
  assert.equal(status.totalCents, 19104);
  assert.equal(status.personCount, 2);
  assert.equal(status.text, "$191.04 across 2 Individuals");
  const single = personalSpendingStatus([ellis]);
  assert.equal(single.text, "$180.84 across 1 Individual");
  const none = personalSpendingStatus([]);
  assert.equal(none.totalCents, 0);
  assert.equal(none.personCount, 0);
  assert.equal(none.text, "No Individuals at this home");
});
