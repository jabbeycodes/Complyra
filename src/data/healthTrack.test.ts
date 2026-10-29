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
  healthAlertTargets,
  healthEntryNeedsAlert,
  healthTrackTitle,
  isImmunizationOverdue,
  validateHealthTrackDraft,
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
