/**
 * Behavior supports — two linked records on an Individual's chart:
 *
 *  1. A behavior support plan: the target behaviors the team watches for,
 *     the interventions that help, and the crisis steps to follow when a
 *     behavior escalates. One current plan per Individual.
 *  2. A behavior data log: one row per observed behavior — when it happened,
 *     what led up to it (antecedent), how long it lasted, how intense it
 *     was, which intervention was used, and how it ended (outcome). The log
 *     feeds simple counts so the team can see whether a plan is working.
 *
 * Pure domain module (types, validation, gates, summaries, row mappers),
 * following the same shape as correctiveActions.ts / ger.ts.
 */

import type { SessionUser } from "./types";

export const BEHAVIOR_INTENSITIES = ["Low", "Moderate", "High"] as const;
export type BehaviorIntensity = (typeof BEHAVIOR_INTENSITIES)[number];

export interface BehaviorPlan {
  id: string;
  agencyId: string;
  individualId: string;
  /** What the team watches for, one behavior per line. */
  targetBehaviors: string;
  /** What helps: prevention and de-escalation strategies. */
  interventions: string;
  /** Ordered steps to follow when a behavior escalates. */
  crisisSteps: string;
  active: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BehaviorPlanDraft {
  targetBehaviors: string;
  interventions: string;
  crisisSteps: string;
}

export interface BehaviorEntry {
  id: string;
  agencyId: string;
  individualId: string;
  /** Date of the observation (YYYY-MM-DD). */
  occurredOn: string;
  /** Time of the observation (HH:MM, may be empty). */
  occurredAtTime: string;
  behavior: string;
  antecedent: string;
  durationMinutes: number | null;
  intensity: BehaviorIntensity;
  interventionUsed: string;
  outcome: string;
  recordedByUserId: string;
  createdAt: string;
}

export interface BehaviorEntryDraft {
  occurredOn: string;
  occurredAtTime?: string;
  behavior: string;
  antecedent?: string;
  durationMinutes?: number | null;
  intensity: BehaviorIntensity;
  interventionUsed?: string;
  outcome?: string;
}

// ───────────────────────────── Permission gates ─────────────────────────────

/** DSP/HM/PM/nurse record behavior data. */
export function canRecordBehavior(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "dsp" ||
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** HM/PM/nurse own the plan itself. */
export function canManageBehaviorPlan(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** Read access rides the chart gates; auditors see everything, read-only. */
export function canViewBehavior(session: SessionUser | null): boolean {
  if (!session) return false;
  if (session.permissions["individuals.view"] !== true) return false;
  return session.roleKey !== "hr";
}

// ───────────────────────────── Validation ─────────────────────────────

export function validateBehaviorPlanDraft(draft: BehaviorPlanDraft): string[] {
  const errors: string[] = [];
  if (!draft.targetBehaviors?.trim()) {
    errors.push("List the target behaviors the team watches for.");
  }
  if (!draft.interventions?.trim()) {
    errors.push("Describe the interventions that help.");
  }
  if (!draft.crisisSteps?.trim()) {
    errors.push("Write the crisis steps to follow when a behavior escalates.");
  }
  return errors;
}

export function validateBehaviorEntryDraft(draft: BehaviorEntryDraft): string[] {
  const errors: string[] = [];
  if (!draft.occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) {
    errors.push("The observation date must be a calendar date (YYYY-MM-DD).");
  }
  if (!draft.behavior?.trim()) errors.push("Name the behavior that was observed.");
  if (!BEHAVIOR_INTENSITIES.includes(draft.intensity)) {
    errors.push("Choose an intensity (Low, Moderate, or High).");
  }
  if (
    draft.durationMinutes != null &&
    (Number.isNaN(draft.durationMinutes) || draft.durationMinutes < 0)
  ) {
    errors.push("Duration must be zero or more minutes.");
  }
  return errors;
}

// ───────────────────────────── Summaries ─────────────────────────────

export interface BehaviorSummary {
  totalInRange: number;
  byBehavior: Array<{ behavior: string; count: number }>;
  highIntensity: number;
  /** Most-used interventions in range, most frequent first. */
  topInterventions: Array<{ intervention: string; count: number }>;
}

/** Counts over an inclusive date range (YYYY-MM-DD bounds). */
export function summarizeBehaviorEntries(
  entries: BehaviorEntry[],
  fromOn: string,
  toOn: string,
): BehaviorSummary {
  const inRange = entries.filter(
    (e) => e.occurredOn >= fromOn && e.occurredOn <= toOn,
  );
  const behaviorCounts = new Map<string, number>();
  const interventionCounts = new Map<string, number>();
  let highIntensity = 0;
  for (const entry of inRange) {
    behaviorCounts.set(
      entry.behavior,
      (behaviorCounts.get(entry.behavior) ?? 0) + 1,
    );
    if (entry.intensity === "High") highIntensity += 1;
    const intervention = entry.interventionUsed.trim();
    if (intervention) {
      interventionCounts.set(
        intervention,
        (interventionCounts.get(intervention) ?? 0) + 1,
      );
    }
  }
  const byCount = (a: { count: number }, b: { count: number }) => b.count - a.count;
  return {
    totalInRange: inRange.length,
    byBehavior: [...behaviorCounts.entries()]
      .map(([behavior, count]) => ({ behavior, count }))
      .sort(byCount),
    highIntensity,
    topInterventions: [...interventionCounts.entries()]
      .map(([intervention, count]) => ({ intervention, count }))
      .sort(byCount)
      .slice(0, 5),
  };
}

/** The plan's target behaviors as a list (one per line). */
export function targetBehaviorList(plan: Pick<BehaviorPlan, "targetBehaviors">): string[] {
  return plan.targetBehaviors
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ───────────────────────────── DB row mapping ─────────────────────────────

export function buildBehaviorPlanRow(input: {
  agencyId: string;
  individualId: string;
  createdByUserId: string;
  draft: BehaviorPlanDraft;
}): Record<string, unknown> {
  return {
    agency_id: input.agencyId,
    individual_id: input.individualId,
    target_behaviors: input.draft.targetBehaviors.trim(),
    interventions: input.draft.interventions.trim(),
    crisis_steps: input.draft.crisisSteps.trim(),
    active: true,
    created_by_user_id: input.createdByUserId,
  };
}

export function behaviorPlanFromRow(row: Record<string, unknown>): BehaviorPlan {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    targetBehaviors: (row.target_behaviors as string | null) ?? "",
    interventions: (row.interventions as string | null) ?? "",
    crisisSteps: (row.crisis_steps as string | null) ?? "",
    active: row.active !== false,
    createdByUserId: row.created_by_user_id as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? (row.created_at as string),
  };
}

export function buildBehaviorEntryRow(input: {
  agencyId: string;
  individualId: string;
  recordedByUserId: string;
  draft: BehaviorEntryDraft;
}): Record<string, unknown> {
  const d = input.draft;
  return {
    agency_id: input.agencyId,
    individual_id: input.individualId,
    occurred_on: d.occurredOn,
    occurred_at_time: d.occurredAtTime ?? "",
    behavior: d.behavior.trim(),
    antecedent: (d.antecedent ?? "").trim(),
    duration_minutes: d.durationMinutes ?? null,
    intensity: d.intensity,
    intervention_used: (d.interventionUsed ?? "").trim(),
    outcome: (d.outcome ?? "").trim(),
    recorded_by_user_id: input.recordedByUserId,
  };
}

export function behaviorEntryFromRow(row: Record<string, unknown>): BehaviorEntry {
  const intensity = row.intensity as string;
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    occurredOn: row.occurred_on as string,
    occurredAtTime: (row.occurred_at_time as string | null) ?? "",
    behavior: (row.behavior as string | null) ?? "",
    antecedent: (row.antecedent as string | null) ?? "",
    durationMinutes: (row.duration_minutes as number | null) ?? null,
    intensity:
      intensity === "Low" || intensity === "High" ? intensity : "Moderate",
    interventionUsed: (row.intervention_used as string | null) ?? "",
    outcome: (row.outcome as string | null) ?? "",
    recordedByUserId: row.recorded_by_user_id as string,
    createdAt: row.created_at as string,
  };
}
