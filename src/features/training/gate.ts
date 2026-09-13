/**
 * LIFEPATH-P2 pure logic: the in-ratio gate and requirement status resolution.
 *
 * The form rule: "Staff must have a minimum of 20 hours of training, with a
 * minimum of 8 hours with the House Manager, before being allowed to work
 * in-ratio." Plus: every required (non-N/A) line complete and the checklist
 * countersigned by staff and the House Manager.
 */
import type { TrainingRequirementStatus } from "../../data/types";

export const IN_RATIO_MIN_HOURS = 20;
export const IN_RATIO_MIN_HM_HOURS = 8;

export interface GateSignoff {
  hoursTotal: number;
  hoursWithHm: number;
  na: boolean;
}

export interface GateInputs {
  /** Non-waived signoffs (N/A lines count toward completion but not hours). */
  signoffs: GateSignoff[];
  /** Lines that must be completed or N/A'd (non-waived). */
  requiredTotal: number;
  completeCount: number;
  pendingCount: number;
  overdueCount: number;
  staffCountersigned: boolean;
  hmCountersigned: boolean;
}

export interface GateResult {
  cleared: boolean;
  reasons: string[];
  hoursTotal: number;
  hoursWithHm: number;
}

/** N/A lines satisfy "no blanks" but do not count as training hours. */
export function sumHours(signoffs: GateSignoff[]): { hoursTotal: number; hoursWithHm: number } {
  let hoursTotal = 0;
  let hoursWithHm = 0;
  for (const signoff of signoffs) {
    if (signoff.na) continue;
    hoursTotal += Math.max(0, signoff.hoursTotal);
    hoursWithHm += Math.max(0, signoff.hoursWithHm);
  }
  return { hoursTotal, hoursWithHm };
}

export function evaluateInRatioGate(input: GateInputs): GateResult {
  const { hoursTotal, hoursWithHm } = sumHours(input.signoffs);
  const reasons: string[] = [];
  if (hoursTotal < IN_RATIO_MIN_HOURS) {
    reasons.push(
      `Training hours: ${hoursTotal.toFixed(1)} of ${IN_RATIO_MIN_HOURS} required`,
    );
  }
  if (hoursWithHm < IN_RATIO_MIN_HM_HOURS) {
    reasons.push(
      `Hours with the house manager: ${hoursWithHm.toFixed(1)} of ${IN_RATIO_MIN_HM_HOURS} required`,
    );
  }
  if (input.overdueCount > 0) {
    reasons.push(`${input.overdueCount} training line${input.overdueCount === 1 ? " is" : "s are"} overdue`);
  }
  if (input.pendingCount > 0) {
    reasons.push(
      `${input.pendingCount} of ${input.requiredTotal} required lines not yet initialed`,
    );
  }
  if (!input.staffCountersigned) reasons.push("Staff signature missing on the training checklist");
  if (!input.hmCountersigned) reasons.push("House manager countersignature missing");
  return { cleared: reasons.length === 0, reasons, hoursTotal, hoursWithHm };
}

/**
 * Resolve the display status of a requirement.
 * "overdue" is derived when a due date passes; everything else is stored.
 */
export function resolveRequirementStatus(
  stored: TrainingRequirementStatus,
  dueOn: string | null,
  today = new Date().toISOString().slice(0, 10),
): TrainingRequirementStatus {
  if (stored === "complete" || stored === "waived_na") return stored;
  if (dueOn && dueOn < today) return "overdue";
  return stored;
}

/** Compute the next-due date for simple renewal rules like "annual" or "6-month". */
export function computeNextDueOn(renewalRule: string | null, signedOn: string): string | null {
  if (!renewalRule) return null;
  const rule = renewalRule.trim().toLowerCase();
  const months = rule.includes("annual") ? 12 : rule.includes("6") ? 6 : rule.includes("quarter") ? 3 : null;
  if (months === null) return null;
  const [year, month, day] = signedOn.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + months, day));
  return next.toISOString().slice(0, 10);
}
