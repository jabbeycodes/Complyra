/**
 * healthTrack.test.ts — health tracker domain rules: titles, validation,
 * clinical-significance alerts, and immunization overdue math.
 *
 * Run: node --import tsx --test src/data/healthTrack.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRecordHealthEntry,
  dailyIntakeTotals,
  glucoseOutOfRange,
  healthAlertTargets,
  healthEntryNeedsAlert,
  healthTrackTitle,
  isImmunizationOverdue,
  lowFluidAlertTargets,
  lowFluidDays,
  validateHealthTrackDraft,
  vitalsConcerns,
  type HealthTrackEntry,
} from "./healthTrack";

function entry(patch: Partial<HealthTrackEntry>): HealthTrackEntry {
  return {
    id: "e1",
    agencyId: "a1",
    individualId: "p1",
    kind: "lab",
    occurredOn: "2026-10-20",
    title: "A1C: 6.1 %",
    details: { testName: "A1C", resultValue: "6.1", unit: "%", referenceRange: "" },
    flaggedAbnormal: false,
    note: "",
    recordedByUserId: "u1",
    createdAt: "2026-10-20T14:00:00Z",
    ...patch,
  };
}

test("health: gates — DSP records, auditor and HR do not", () => {
  assert.equal(canRecordHealthEntry("dsp"), true);
  assert.equal(canRecordHealthEntry("nurse"), true);
  assert.equal(canRecordHealthEntry("auditor"), false);
  assert.equal(canRecordHealthEntry("hr"), false);
});

test("health: titles derive from kind details", () => {
  assert.equal(
    healthTrackTitle("immunization", { vaccineName: "Influenza", doseLabel: "Annual" }),
    "Influenza — Annual",
  );
  assert.equal(
    healthTrackTitle("lab", { testName: "A1C", resultValue: "6.1", unit: "%" }),
    "A1C: 6.1 %",
  );
  assert.equal(
    healthTrackTitle("infection", { infectionType: "Urinary infection", bodySite: "" }),
    "Urinary infection",
  );
  assert.equal(healthTrackTitle("sleep", { hoursSlept: "7.5" }), "Slept 7.5 hours");
});

test("health: validation per kind", () => {
  assert.deepEqual(
    validateHealthTrackDraft({
      kind: "immunization",
      occurredOn: "2026-10-01",
      details: { vaccineName: "Influenza", nextDueOn: "2027-10-01" },
    }),
    [],
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "lab",
      occurredOn: "2026-10-01",
      details: { testName: "", resultValue: "" },
    }).length >= 2,
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "sleep",
      occurredOn: "2026-10-01",
      details: { hoursSlept: "30" },
    }).some((e) => e.includes("between 0 and 24")),
  );
});

test("health: alerts fire for flagged labs and confirmed infections only", () => {
  assert.equal(healthEntryNeedsAlert(entry({ flaggedAbnormal: true })), true);
  assert.equal(healthEntryNeedsAlert(entry({})), false);
  assert.equal(
    healthEntryNeedsAlert(
      entry({ kind: "infection", details: { infectionType: "UTI", confirmedPositive: "yes" } }),
    ),
    true,
  );
  assert.equal(
    healthEntryNeedsAlert(
      entry({ kind: "infection", details: { infectionType: "UTI", confirmedPositive: "no" } }),
    ),
    false,
  );
  assert.equal(
    healthEntryNeedsAlert(entry({ kind: "sleep", details: { hoursSlept: "3" } })),
    false,
  );
});

test("health: immunization overdue derives from the next due date", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(
    isImmunizationOverdue(
      entry({ kind: "immunization", details: { vaccineName: "Flu", nextDueOn: "2026-10-01" } }),
      [],
      now,
    ),
    true,
  );
  assert.equal(
    isImmunizationOverdue(
      entry({ kind: "immunization", details: { vaccineName: "Flu", nextDueOn: "2027-10-01" } }),
      [],
      now,
    ),
    false,
  );
  assert.equal(isImmunizationOverdue(entry({}), [], now), false);
});

test("health: immunization is not overdue once a newer dose is logged", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const older = entry({
    kind: "immunization",
    occurredOn: "2025-10-01",
    details: { vaccineName: "Flu", nextDueOn: "2026-10-01" },
  });
  const newer = entry({
    kind: "immunization",
    occurredOn: "2026-10-05",
    details: { vaccineName: "Flu", nextDueOn: "2027-10-05" },
  });
  assert.equal(isImmunizationOverdue(older, [older, newer], now), false);
  assert.equal(isImmunizationOverdue(newer, [older, newer], now), false);
});

test("health: alert targets are HM direct plus PM/nurse broadcasts", () => {
  const targets = healthAlertTargets({ entryId: "e1", houseManagerUserIds: ["hm-1"] });
  assert.deepEqual(
    targets.map((t) => t.dedupeKey),
    [
      "incident.followup:health:e1:hm:hm-1",
      "incident.followup:health:e1:role:program_manager",
      "incident.followup:health:e1:role:nurse",
    ],
  );
});

// ───────────────────── Batch 2: core trackers ─────────────────────

test("health batch 2: titles for the core trackers", () => {
  assert.equal(
    healthTrackTitle("intake", { entryType: "meal", mealType: "Lunch", portion: "Most" }),
    "Lunch — ate most",
  );
  assert.equal(
    healthTrackTitle("intake", { entryType: "fluid", fluidType: "Water", fluidOz: "8" }),
    "Water — 8 oz",
  );
  assert.equal(
    healthTrackTitle("elimination", {
      entryType: "bowel",
      amount: "Medium",
      consistency: "Formed",
    }),
    "Bowel movement — medium, formed",
  );
  assert.equal(
    healthTrackTitle("elimination", { entryType: "urination", continence: "Continent" }),
    "Urination — continent",
  );
  assert.equal(
    healthTrackTitle("vitals", {
      temperatureF: "101.2",
      systolic: "142",
      diastolic: "88",
      pulse: "104",
      oxygenSaturation: "97",
    }),
    "Temp 101.2°F · BP 142/88 · Pulse 104 · O2 97%",
  );
  assert.equal(
    healthTrackTitle("seizure", { seizureType: "Tonic-clonic seizure", durationMinutes: "2" }),
    "Tonic-clonic seizure — 2 min",
  );
  assert.equal(healthTrackTitle("menses", { flow: "Moderate" }), "Menses — moderate flow");
  assert.equal(
    healthTrackTitle("skin", { bodyLocation: "Left foot", observation: "Open area / breakdown" }),
    "Left foot — open area / breakdown",
  );
  assert.equal(
    healthTrackTitle("glucose", { readingMgDl: "58", context: "Before meal" }),
    "Glucose 58 mg/dL — before meal",
  );
  assert.equal(
    healthTrackTitle("respiratory", { treatmentType: "Nebulizer treatment" }),
    "Nebulizer treatment",
  );
});

test("health batch 2: validation for the core trackers", () => {
  assert.deepEqual(
    validateHealthTrackDraft({
      kind: "intake",
      occurredOn: "2026-10-26",
      details: { entryType: "meal", mealType: "Lunch", portion: "Half" },
    }),
    [],
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "intake",
      occurredOn: "2026-10-26",
      details: { entryType: "fluid", fluidType: "Water", fluidOz: "0" },
    }).some((e) => e.includes("ounces")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "vitals",
      occurredOn: "2026-10-26",
      details: {},
    }).some((e) => e.includes("at least one vital")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "vitals",
      occurredOn: "2026-10-26",
      details: { oxygenSaturation: "140" },
    }).some((e) => e.includes("Oxygen saturation")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "seizure",
      occurredOn: "2026-10-26",
      details: { seizureType: "" },
    }).some((e) => e.includes("seizure type")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "menses",
      occurredOn: "2026-10-26",
      details: { endOn: "2026-10-20" },
    }).some((e) => e.includes("before the start date")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "skin",
      occurredOn: "2026-10-26",
      details: { bodyLocation: "", observation: "" },
    }).length >= 2,
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "glucose",
      occurredOn: "2026-10-26",
      details: { readingMgDl: "" },
    }).some((e) => e.includes("glucose reading")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "respiratory",
      occurredOn: "2026-10-26",
      details: { treatmentType: "" },
    }).some((e) => e.includes("treatment")),
  );
  assert.ok(
    validateHealthTrackDraft({
      kind: "elimination",
      occurredOn: "2026-10-26",
      details: { entryType: "bowel", consistency: "Purple" },
    }).some((e) => e.includes("consistency")),
  );
});

test("health batch 2: alert rules for the core trackers", () => {
  const needs = (kind: HealthTrackEntry["kind"], details: Record<string, string>) =>
    healthEntryNeedsAlert(entry({ kind, details }));
  // Every seizure alerts.
  assert.equal(needs("seizure", { seizureType: "Absence" }), true);
  // Refused meal alerts; a half-eaten meal does not.
  assert.equal(needs("intake", { entryType: "meal", mealType: "Lunch", portion: "Refused" }), true);
  assert.equal(needs("intake", { entryType: "meal", mealType: "Lunch", portion: "Half" }), false);
  assert.equal(needs("intake", { entryType: "fluid", fluidType: "Water", fluidOz: "8" }), false);
  // Blood in the stool alerts; a normal bowel movement does not.
  assert.equal(needs("elimination", { entryType: "bowel", bloodPresent: "yes" }), true);
  assert.equal(needs("elimination", { entryType: "bowel", bloodPresent: "no" }), false);
  // Vitals ranges.
  assert.equal(needs("vitals", { temperatureF: "101.2" }), true);
  assert.equal(needs("vitals", { temperatureF: "94.6" }), true);
  assert.equal(needs("vitals", { systolic: "150", diastolic: "80" }), true);
  assert.equal(needs("vitals", { pulse: "55" }), true);
  assert.equal(needs("vitals", { oxygenSaturation: "90" }), true);
  assert.equal(
    needs("vitals", { temperatureF: "98.6", systolic: "120", diastolic: "80", pulse: "72", oxygenSaturation: "98" }),
    false,
  );
  // Skin breakdown or worsening alerts; redness alone does not.
  assert.equal(needs("skin", { observation: "Open area / breakdown" }), true);
  assert.equal(needs("skin", { observation: "Redness", changeSinceLast: "Worse" }), true);
  assert.equal(needs("skin", { observation: "Redness", changeSinceLast: "New" }), false);
  // Glucose thresholds.
  assert.equal(needs("glucose", { readingMgDl: "58" }), true);
  assert.equal(needs("glucose", { readingMgDl: "310" }), true);
  assert.equal(needs("glucose", { readingMgDl: "110" }), false);
  // Menses and respiratory have no automatic alert.
  assert.equal(needs("menses", { flow: "Heavy" }), false);
  assert.equal(needs("respiratory", { treatmentType: "Inhaler" }), false);
});

test("health batch 2: vitals concerns read in plain language", () => {
  assert.deepEqual(
    vitalsConcerns({ temperatureF: "101.2", oxygenSaturation: "90" }),
    ["Fever", "Low oxygen saturation"],
  );
  assert.deepEqual(vitalsConcerns({ temperatureF: "98.6", pulse: "72" }), []);
  assert.equal(glucoseOutOfRange({ readingMgDl: "69" }), true);
  assert.equal(glucoseOutOfRange({ readingMgDl: "70" }), false);
});

test("health batch 2: daily intake totals and low-fluid days", () => {
  const mk = (
    occurredOn: string,
    details: Record<string, string>,
  ): Pick<HealthTrackEntry, "kind" | "occurredOn" | "details"> => ({
    kind: "intake",
    occurredOn,
    details,
  });
  const entries = [
    mk("2026-10-25", { entryType: "meal", mealType: "Breakfast", portion: "All" }),
    mk("2026-10-25", { entryType: "meal", mealType: "Lunch", portion: "Refused" }),
    mk("2026-10-25", { entryType: "fluid", fluidType: "Water", fluidOz: "8" }),
    mk("2026-10-24", { entryType: "fluid", fluidType: "Water", fluidOz: "40" }),
  ];
  const totals = dailyIntakeTotals(entries);
  assert.deepEqual(totals[0], {
    date: "2026-10-25",
    fluidOz: 8,
    mealCount: 2,
    refusedMeals: 1,
  });
  assert.deepEqual(totals[1], {
    date: "2026-10-24",
    fluidOz: 40,
    mealCount: 0,
    refusedMeals: 0,
  });
  // Only the finished, low-fluid day is flagged; today never is.
  assert.deepEqual(lowFluidDays(entries, "2026-10-26"), [
    { date: "2026-10-25", fluidOz: 8 },
  ]);
  assert.deepEqual(lowFluidDays(entries, "2026-10-25"), []);
});

test("health batch 2: low-fluid alert targets dedupe per person and day", () => {
  const targets = lowFluidAlertTargets({
    individualId: "p1",
    date: "2026-10-25",
    houseManagerUserIds: ["hm-1"],
  });
  assert.deepEqual(
    targets.map((t) => t.dedupeKey),
    [
      "incident.followup:health:low-fluid:p1:2026-10-25:hm:hm-1",
      "incident.followup:health:low-fluid:p1:2026-10-25:role:program_manager",
      "incident.followup:health:low-fluid:p1:2026-10-25:role:nurse",
    ],
  );
});
