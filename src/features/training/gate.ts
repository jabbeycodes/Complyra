/**
 * LIFEPATH-P2 pure logic: the in-ratio gate and requirement status resolution.
 *
 * The form rule: "Staff must have a minimum of 20 hours of training, with a
 * minimum of 8 hours with the House Manager, before being allowed to work
 * in-ratio." Plus: every required (non-N/A) line complete and the checklist
 * countersigned by staff and the House Manager.
 */
import type { RequirementLineSignoffInput, TrainingRequirementStatus } from "../../data/types";

export const IN_RATIO_MIN_HOURS = 20;
export const IN_RATIO_MIN_HM_HOURS = 8;

/**
 * Per-line training cap: 8 hours — one full training day per dated line.
 * Longer training must be split across separately dated lines, which keeps
 * signedOn dates honest (a line dated one day cannot claim 12 hours) and
 * matches how LifePath logs training-day attendance.
 */
export const TRAINING_LINE_MAX_HOURS = 8;

export interface ValidatedTrainingLineInput {
  initials: string;
  signedOn: string;
  trainerUserId: string;
  hoursTotal: number;
  hoursWithHm: number;
}

/**
 * Shared validator for requirement-line sign-offs (local + hosted APIs and
 * unit tests). Throws a human-readable Error on the first problem.
 */
export function validateTrainingLineInput(
  input: RequirementLineSignoffInput,
  today = new Date().toISOString().slice(0, 10),
): ValidatedTrainingLineInput {
  const initials = input.initials.trim();
  if (!initials) throw new Error("Type your initials — checkmarks are not allowed.");
  const trainerUserId =
    typeof input.trainerUserId === "string" ? input.trainerUserId.trim() : "";
  if (!trainerUserId) throw new Error("Choose the trainer from the staff roster.");
  const signedOn = (input.signedOn ?? today).slice(0, 10);
  if (signedOn > today) throw new Error("The training date cannot be in the future.");
  const hoursTotal = input.hoursTotal ?? 0;
  const hoursWithHm = input.hoursWithHm ?? 0;
  if (!Number.isFinite(hoursTotal) || !Number.isFinite(hoursWithHm)) {
    throw new Error("Training hours must be numbers.");
  }
  if (hoursTotal < 0 || hoursTotal > TRAINING_LINE_MAX_HOURS) {
    throw new Error(
      `One line covers at most ${TRAINING_LINE_MAX_HOURS} hours — split longer training across dated lines.`,
    );
  }
  if (hoursWithHm < 0) throw new Error("Hours with the house manager cannot be negative.");
  if (hoursWithHm > hoursTotal) {
    throw new Error("Hours with the house manager cannot exceed total hours.");
  }
  return { initials, signedOn, trainerUserId, hoursTotal, hoursWithHm };
}

/** Error surfaced when a write targets a sheet locked by an HM countersignature. */
export const LOCKED_TRAINING_SHEET_MESSAGE =
  "This training sheet is locked by the house manager's countersignature — request a correction to edit it.";

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
