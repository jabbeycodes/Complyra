/**
 * behavior.test.ts — behavior plan/log domain rules and summaries.
 *
 * Run: node --import tsx --test src/data/behavior.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageBehaviorPlan,
  canRecordBehavior,
  summarizeBehaviorEntries,
  targetBehaviorList,
  validateBehaviorEntryDraft,
  validateBehaviorPlanDraft,
  type BehaviorEntry,
} from "./behavior";

function entry(patch: Partial<BehaviorEntry>): BehaviorEntry {
  return {
    id: Math.random().toString(36).slice(2),
    agencyId: "a1",
    individualId: "p1",
    occurredOn: "2026-10-20",
    occurredAtTime: "09:00",
    behavior: "Verbal outburst",
    antecedent: "Asked to stop a preferred activity",
    durationMinutes: 12,
    intensity: "Moderate",
    interventionUsed: "Offered a break",
    outcome: "Calmed and rejoined the group",
    recordedByUserId: "u1",
    createdAt: "2026-10-20T14:00:00Z",
    ...patch,
  };
}

test("behavior: gates — DSP records, managers own the plan", () => {
  assert.equal(canRecordBehavior("dsp"), true);
  assert.equal(canRecordBehavior("auditor"), false);
  assert.equal(canManageBehaviorPlan("house_manager"), true);
  assert.equal(canManageBehaviorPlan("nurse"), true);
  assert.equal(canManageBehaviorPlan("dsp"), false);
});

test("behavior: validation names the missing pieces", () => {
  assert.deepEqual(
    validateBehaviorPlanDraft({
      targetBehaviors: "Verbal outbursts",
      interventions: "Offer a break",
      crisisSteps: "1. Step back",
    }),
    [],
  );
  assert.ok(
    validateBehaviorPlanDraft({
      targetBehaviors: "",
      interventions: "",
      crisisSteps: "",
    }).length === 3,
  );
  assert.deepEqual(
    validateBehaviorEntryDraft({
      occurredOn: "2026-10-20",
      behavior: "Verbal outburst",
      intensity: "High",
    }),
    [],
  );
  const errors = validateBehaviorEntryDraft({
    occurredOn: "20/10/2026",
    behavior: "",
    intensity: "High",
    durationMinutes: -3,
  });
  assert.equal(errors.length, 3);
});

test("behavior: summary counts the range, top behavior, and high intensity", () => {
  const entries = [
    entry({ occurredOn: "2026-10-01" }),
    entry({ occurredOn: "2026-10-05", intensity: "High" }),
    entry({ occurredOn: "2026-10-06", behavior: "Leaving the area" }),
    entry({ occurredOn: "2026-09-01", behavior: "Leaving the area" }),
  ];
  const summary = summarizeBehaviorEntries(entries, "2026-10-01", "2026-10-31");
  assert.equal(summary.totalInRange, 3);
  assert.equal(summary.highIntensity, 1);
  assert.equal(summary.byBehavior[0].behavior, "Verbal outburst");
  assert.equal(summary.byBehavior[0].count, 2);
  assert.equal(summary.topInterventions[0].intervention, "Offered a break");
});

test("behavior: target list splits plan lines", () => {
  assert.deepEqual(
    targetBehaviorList({ targetBehaviors: " Yelling \n\nLeaving the area " }),
    ["Yelling", "Leaving the area"],
  );
});
