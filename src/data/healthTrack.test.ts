/**
 * healthTrack.test.ts — pure domain logic for Health Track.
 *
 * Run: node --import tsx --test src/data/healthTrack.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOWEL_CONSISTENCIES,
  HEALTH_TRACK_KINDS,
  HEALTH_TRACK_SECTIONS,
  MEAL_TYPES,
  PORTIONS_EATEN,
  canRecordHealthTrack,
  canReviewHealthTrack,
  canSeeHealthTrack,
  dayKeyOf,
  detectDailyIntakeAlert,
  detectHealthAlert,
  healthEntryMatches,
  healthTrackAlertTargets,
  isHealthTrackKind,
  isMeaningfulNote,
  aggregateAlertStatus,
  sectionForKind,
  sortHealthEntriesDesc,
  summarizeHealthDay,
  summarizeHealthWeek,
  validateHealthTrackInput,
  type HealthTrackEntry,
} from "./healthTrack";

function entry(partial: Partial<HealthTrackEntry> = {}): HealthTrackEntry {
  return {
    id: "e1",
    agencyId: "a1",
    individualId: "i1",
    siteId: "s1",
    kind: "meal",
    occurredAt: "2026-09-18T12:00:00",
    details: { mealType: "lunch", portion: "most", items: "Chicken and rice" },
    recordedByUserId: "u1",
    recordedByName: "Sam Dsp",
    flagForNurse: false,
    flagReason: null,
    nurseReviewedAt: null,
    nurseReviewedBy: null,
    nurseNote: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    alertDelivery: null,
    alertDeliveryError: null,
    createdAt: "2026-09-18T12:05:00",
    updatedAt: "2026-09-18T12:05:00",
    ...partial,
  };
}

test("kinds: every kind has a label and a left-panel section", () => {
  for (const kind of HEALTH_TRACK_KINDS) {
    assert.ok(isHealthTrackKind(kind));
    const section = HEALTH_TRACK_SECTIONS.find((s) =>
      (s.kinds as readonly string[]).includes(kind),
    );
    assert.ok(section, `${kind} must sit under a Health Track section`);
    assert.equal(sectionForKind(kind), section.key);
  }
  assert.equal(isHealthTrackKind("t-log"), false);
});

test("validation: meal requires meal type, portion, and items", () => {
  assert.deepEqual(
    validateHealthTrackInput("meal", { mealType: "lunch", portion: "most", items: "Soup" }),
    [],
  );
  const errors = validateHealthTrackInput("meal", { mealType: "lunch", portion: "most", items: " " });
  assert.ok(errors.length > 0);
  assert.ok(validateHealthTrackInput("meal", {}).length >= 3);
  assert.ok(MEAL_TYPES.includes("breakfast"));
  assert.ok(PORTIONS_EATEN.includes("refused"));
});

test("validation: fluid ounces must be a sane number", () => {
  assert.deepEqual(validateHealthTrackInput("fluid", { fluidType: "Water", ounces: 8 }), []);
  assert.ok(validateHealthTrackInput("fluid", { fluidType: "Water", ounces: 0 }).length > 0);
  assert.ok(validateHealthTrackInput("fluid", { fluidType: "", ounces: 8 }).length > 0);
});

test("validation: bowel requires amount, consistency, color", () => {
  assert.deepEqual(
    validateHealthTrackInput("bowel", {
      amount: "moderate",
      consistency: "formed",
      color: "brown",
      blood: false,
      pain: false,
    }),
    [],
  );
  assert.ok(validateHealthTrackInput("bowel", { amount: "moderate" }).length > 0);
  assert.ok(BOWEL_CONSISTENCIES.includes("watery"));
});

test("validation: skin requires location, observation, description, worsening flag", () => {
  assert.deepEqual(
    validateHealthTrackInput("skin", {
      bodyLocation: "Left heel",
      observation: "redness",
      description: "Pink area, skin intact",
      worsening: false,
    }),
    [],
  );
  assert.ok(
    validateHealthTrackInput("skin", { bodyLocation: "Left heel" }).length > 0,
  );
});

test("validation: vitals needs at least one reading; ranges are sanity-checked", () => {
  assert.deepEqual(validateHealthTrackInput("vitals", { tempF: 98.6 }), []);
  assert.ok(validateHealthTrackInput("vitals", {}).length > 0);
  assert.ok(validateHealthTrackInput("vitals", { tempF: 200 }).length > 0);
  assert.ok(validateHealthTrackInput("vitals", { o2Sat: 40 }).length > 0);
});

test("validation: seizure, menses, blood sugar", () => {
  assert.deepEqual(
    validateHealthTrackInput("seizure", { description: "Full-body shaking, 2 minutes" }),
    [],
  );
  assert.ok(validateHealthTrackInput("seizure", {}).length > 0);
  assert.deepEqual(
    validateHealthTrackInput("menses", { startDate: "2026-09-01", flow: "moderate" }),
    [],
  );
  assert.deepEqual(
    validateHealthTrackInput("blood_sugar", { readingMgDl: 110, context: "before_meal" }),
    [],
  );
  assert.ok(
    validateHealthTrackInput("blood_sugar", { readingMgDl: 5, context: "before_meal" }).length > 0,
  );
});

test("alerts: fever, low temp, blood pressure, pulse, low O2 flag vitals", () => {
  assert.equal(detectHealthAlert("vitals", { tempF: 101.2 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { tempF: 94 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { bpSystolic: 185, bpDiastolic: 95 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { bpSystolic: 85, bpDiastolic: 55 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { bpSystolic: 120, bpDiastolic: 115 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { pulse: 130 }).flagged, true);
  assert.equal(detectHealthAlert("vitals", { o2Sat: 89 }).flagged, true);
  const normal = detectHealthAlert("vitals", {
    tempF: 98.6,
    bpSystolic: 118,
    bpDiastolic: 76,
    pulse: 72,
    o2Sat: 98,
  });
  assert.equal(normal.flagged, false);
  assert.equal(normal.reason, null);
});

test("alerts: blood in stool, skin breakdown, seizure, refused meal, sugar extremes", () => {
  const blood = detectHealthAlert("bowel", {
    amount: "small",
    consistency: "loose",
    color: "dark",
    blood: true,
    pain: false,
  });
  assert.equal(blood.flagged, true);
  assert.match(blood.reason ?? "", /blood/i);

  const skin = detectHealthAlert("skin", {
    bodyLocation: "Left heel",
    observation: "open_area",
    description: "Open area",
    worsening: false,
  });
  assert.equal(skin.flagged, true);

  const worsening = detectHealthAlert("skin", {
    bodyLocation: "Right elbow",
    observation: "redness",
    description: "Larger than yesterday",
    worsening: true,
  });
  assert.equal(worsening.flagged, true);

  assert.equal(
    detectHealthAlert("seizure", { description: "Tonic-clonic, 90 seconds" }).flagged,
    true,
  );
  assert.equal(
    detectHealthAlert("meal", { mealType: "dinner", portion: "refused", items: "Pasta" }).flagged,
    true,
  );
  assert.equal(
    detectHealthAlert("meal", { mealType: "dinner", portion: "half", items: "Pasta" }).flagged,
    false,
  );
  assert.equal(
    detectHealthAlert("blood_sugar", { readingMgDl: 55, context: "before_meal" }).flagged,
    true,
  );
  assert.equal(
    detectHealthAlert("blood_sugar", { readingMgDl: 350, context: "after_meal" }).flagged,
    true,
  );
  assert.equal(
    detectHealthAlert("blood_sugar", { readingMgDl: 120, context: "before_meal" }).flagged,
    false,
  );
});

test("summaries: daily totals count meals, fluids, BMs, flags", () => {
  const entries = [
    entry({ id: "m1", kind: "meal", occurredAt: "2026-09-18T08:00:00", details: { mealType: "breakfast", portion: "all", items: "Oatmeal" } }),
    entry({ id: "m2", kind: "meal", occurredAt: "2026-09-18T12:00:00", flagForNurse: true, flagReason: "Meal refused", details: { mealType: "lunch", portion: "refused", items: "Sandwich" } }),
    entry({ id: "f1", kind: "fluid", occurredAt: "2026-09-18T09:00:00", details: { fluidType: "Water", ounces: 8 } }),
    entry({ id: "f2", kind: "fluid", occurredAt: "2026-09-18T15:00:00", details: { fluidType: "Juice", ounces: 4 } }),
    entry({ id: "b1", kind: "bowel", occurredAt: "2026-09-18T10:00:00", details: { amount: "moderate", consistency: "formed", color: "brown", blood: false, pain: false } }),
    entry({ id: "v1", kind: "vitals", occurredAt: "2026-09-17T08:00:00", details: { tempF: 98.6 } }),
  ];
  const summary = summarizeHealthDay(entries, "2026-09-18");
  assert.equal(summary.mealsLogged, 2);
  assert.equal(summary.mealsRefused, 1);
  assert.equal(summary.fluidsOz, 12);
  assert.equal(summary.bmCount, 1);
  assert.equal(summary.flaggedCount, 1);
  assert.equal(summary.entriesCount, 5);
});

test("summaries: weekly returns seven days starting at the given Monday", () => {
  const week = summarizeHealthWeek([], "2026-09-14");
  assert.equal(week.length, 7);
  assert.equal(week[0].date, "2026-09-14");
  assert.equal(week[6].date, "2026-09-20");
});

test("filtering: kinds, dates, flags, nurse review", () => {
  const rows = [
    entry({ id: "a", kind: "meal", occurredAt: "2026-09-18T08:00:00" }),
    entry({ id: "b", kind: "bowel", occurredAt: "2026-09-17T08:00:00", flagForNurse: true, flagReason: "Blood seen in stool" }),
    entry({ id: "c", kind: "skin", occurredAt: "2026-09-18T09:00:00", flagForNurse: true, flagReason: "Open skin area", nurseReviewedAt: "2026-09-18T10:00:00", nurseReviewedBy: "u2" }),
  ];
  assert.equal(rows.filter((r) => healthEntryMatches(r, { kinds: ["meal"] })).length, 1);
  assert.equal(rows.filter((r) => healthEntryMatches(r, { from: "2026-09-18", to: "2026-09-18" })).length, 2);
  assert.equal(rows.filter((r) => healthEntryMatches(r, { flaggedOnly: true })).length, 2);
  assert.equal(rows.filter((r) => healthEntryMatches(r, { needsNurseReview: true })).length, 1);
  assert.equal(rows.filter((r) => healthEntryMatches(r, { individualId: "nope" })).length, 0);
});

test("sorting: newest first", () => {
  const sorted = sortHealthEntriesDesc([
    entry({ id: "old", occurredAt: "2026-09-16T08:00:00" }),
    entry({ id: "new", occurredAt: "2026-09-18T08:00:00" }),
  ]);
  assert.equal(sorted[0].id, "new");
});

test("gates: auditors read everything read-only; HR stays out; DSP/HM record; nurse reviews", () => {
  // canSeeHealthTrack follows the customizable permissions, not a
  // hard-coded role list.
  for (const role of ["administrator", "compliance_admin", "program_manager", "house_manager", "dsp", "nurse"]) {
    assert.equal(canSeeHealthTrack({ role }), true, role);
  }
  // Auditors see everything read-only (health.view), never write or review.
  assert.equal(canSeeHealthTrack({ role: "auditor" }), true);
  assert.equal(canRecordHealthTrack({ role: "auditor" }), false);
  assert.equal(canReviewHealthTrack({ role: "auditor" }), false);
  assert.equal(canSeeHealthTrack({ role: "hr" }), false);
  // An agency that customized health.record away from DSPs hides the page
  // from them too.
  assert.equal(
    canSeeHealthTrack({ role: "dsp", permissions: { "health.record": false } }),
    false,
  );
  // health.view alone grants visibility without record/review power.
  assert.equal(
    canSeeHealthTrack({ role: "hr", permissions: { "health.view": true } }),
    true,
  );
  assert.equal(
    canRecordHealthTrack({ role: "hr", permissions: { "health.view": true } }),
    false,
  );

  assert.equal(canRecordHealthTrack({ role: "dsp" }), true);
  assert.equal(canRecordHealthTrack({ role: "house_manager" }), true);
  assert.equal(canRecordHealthTrack({ role: "nurse" }), true);
  assert.equal(canRecordHealthTrack({ role: "auditor" }), false);
  assert.equal(canRecordHealthTrack({ role: "hr" }), false);

  assert.equal(canReviewHealthTrack({ role: "nurse" }), true);
  assert.equal(canReviewHealthTrack({ role: "program_manager" }), true);
  assert.equal(canReviewHealthTrack({ role: "house_manager" }), true);
  assert.equal(canReviewHealthTrack({ role: "dsp" }), false);
});

test("isMeaningfulNote: review notes and correction reasons cannot be empty", () => {
  assert.equal(isMeaningfulNote("Will monitor temperature."), true);
  assert.equal(isMeaningfulNote("  ok  "), false);
  assert.equal(isMeaningfulNote(""), false);
  assert.equal(isMeaningfulNote("   "), false);
  assert.equal(isMeaningfulNote(null), false);
  assert.equal(isMeaningfulNote(undefined), false);
});

test("aggregateAlertStatus: per-target outcomes roll up to one status", () => {
  assert.equal(aggregateAlertStatus([]), "pending");
  assert.equal(aggregateAlertStatus([{ ok: true }, { ok: true }]), "ok");
  assert.equal(aggregateAlertStatus([{ ok: false }]), "failed");
  assert.equal(aggregateAlertStatus([{ ok: true }, { ok: false }]), "partial");
  assert.equal(aggregateAlertStatus([{ ok: false }, { ok: false }]), "failed");
});

test("dayKeyOf: takes the date portion of an ISO datetime", () => {
  assert.equal(dayKeyOf("2026-09-18T23:59:59"), "2026-09-18");
});

test("alert targets: home HM(s) direct + PM and nurse broadcasts, deduped per target", () => {
  const targets = healthTrackAlertTargets({
    agencyId: "a1",
    entryId: "e9",
    individualName: "Sam",
    siteName: "Evergreen",
    kind: "seizure",
    reason: "Seizure recorded",
    occurredAt: "2026-09-18T14:00:00",
    hmUserIds: ["hm-1", "hm-2"],
  });
  assert.equal(targets.length, 4);
  const direct = targets.filter((t) => t.userId != null);
  assert.deepEqual(
    direct.map((t) => t.userId).sort(),
    ["hm-1", "hm-2"],
  );
  assert.ok(direct.every((t) => t.roleKey == null));
  const broadcasts = targets.filter((t) => t.userId == null);
  assert.deepEqual(
    broadcasts.map((t) => t.roleKey).sort(),
    ["nurse", "program_manager"],
  );
  for (const t of targets) {
    assert.equal(t.type, "incident.followup");
    assert.equal(t.entityType, "health_entry");
    assert.equal(t.entityId, "e9");
    assert.ok((t.dedupeKey ?? "").includes("e9"));
    assert.ok(t.deepLink.startsWith("/health/"));
    assert.match(t.body, /Sam/);
  }
  // Dedupe keys are unique per target so the queue never double-sends.
  const keys = targets.map((t) => t.dedupeKey);
  assert.equal(new Set(keys).size, targets.length);
});

test("alert targets: dedupe keys are deterministic across calls", () => {
  const input = {
    agencyId: "a1",
    entryId: "e9",
    individualName: "Sam",
    siteName: "Evergreen",
    kind: "vitals" as const,
    reason: "Fever",
    occurredAt: "2026-09-18T08:00:00",
    hmUserIds: ["hm-1"],
  };
  const first = healthTrackAlertTargets(input).map((t) => t.dedupeKey);
  const second = healthTrackAlertTargets(input).map((t) => t.dedupeKey);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
});

test("daily intake alert: all meals refused across two or more meals", () => {
  const refused = (id: string): HealthTrackEntry =>
    entry({
      id,
      kind: "meal",
      occurredAt: "2026-09-18T08:00:00",
      details: { mealType: "breakfast", portion: "refused", items: "Oatmeal" },
    });
  // One refused meal alone is not a day-level alert.
  assert.equal(detectDailyIntakeAlert([refused("a")]), null);
  // Two refused meals on the same day is a very-low-intake alert.
  const reason = detectDailyIntakeAlert([refused("a"), refused("b")]);
  assert.ok(reason);
  assert.match(reason as string, /all 2 meals refused/);
  // Mixed intake clears it.
  const mixed = [
    refused("a"),
    entry({
      id: "c",
      kind: "meal",
      occurredAt: "2026-09-18T12:00:00",
      details: { mealType: "lunch", portion: "most", items: "Soup" },
    }),
  ];
  assert.equal(detectDailyIntakeAlert(mixed), null);
});
