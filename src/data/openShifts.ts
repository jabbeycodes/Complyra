/**
 * Open shifts: coverage postings staff pick up, bid on, or decline.
 *
 * Agency rules (2026-09-25):
 * - HMs/PMs post for their program site, any time in the future, as
 *   TEMPORARY (one dated shift) or PERMANENT (a recurring weekly slot).
 *   Staff trained at that site see it.
 * - HR (and administrators) post PERMANENT openings to the whole agency.
 * - Staff may work up to the agency's weekly threshold (40 hours). A pickup
 *   that would go over is never assigned automatically: it becomes a bid a
 *   manager approves.
 * - Permanent slots are always bids; an approved bid becomes the staff
 *   member's recurring pattern.
 *
 * The database (20260925150000_open_shifts.sql) is the authority; this module
 * mirrors its rules for labels, previews and the local demo store.
 *
 * Wording: "Individual/Individuals" only — never client/patient.
 */

import { computePatternWeeklyHours, STAFFING_DAY_LABELS, type HrShift } from "./hr";

export type OpenShiftKind = "temporary" | "permanent";
export type OpenShiftAudience = "site" | "agency";
export type OpenShiftPickupMode = "first_come" | "approval";
export type OpenShiftStatus = "open" | "filled" | "cancelled";
export type OpenShiftResponseKind = "picked_up" | "requested" | "declined";

export interface HrOpenShift {
  id: string;
  agencyId: string;
  siteId: string;
  kind: OpenShiftKind;
  audience: OpenShiftAudience;
  title: string;
  /** Temporary only. */
  startsAt: string | null;
  endsAt: string | null;
  /** Permanent only: 0 = Sunday. */
  days: number[];
  windowStart: string | null;
  windowEnd: string | null;
  effectiveFrom: string | null;
  weeklyHours: number;
  notes: string;
  slots: number;
  filledCount: number;
  pickupMode: OpenShiftPickupMode;
  status: OpenShiftStatus;
  postedBy: string;
  postedByName: string;
  createdAt: string;
}

export interface HrOpenShiftResponse {
  id: string;
  openShiftId: string;
  staffId: string;
  staffName: string;
  response: OpenShiftResponseKind;
  decision: "approved" | "denied" | null;
  trainedAtSite: boolean;
  wouldBeOvertime: boolean;
  weekHoursBefore: number;
  respondedAt: string;
}

export interface OpenShiftInput {
  siteId: string;
  kind: OpenShiftKind;
  audience: OpenShiftAudience;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  days?: number[];
  windowStart?: string | null;
  windowEnd?: string | null;
  effectiveFrom?: string | null;
  notes?: string;
  slots?: number;
  pickupMode?: OpenShiftPickupMode;
}

/** The agency's weekly limit when no overtime rules are saved. */
export const DEFAULT_WEEKLY_LIMIT_HOURS = 40;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Plain-language problems with a posting before it is sent, or []. */
export function validateOpenShiftInput(input: OpenShiftInput, now = new Date()): string[] {
  const problems: string[] = [];
  if (!input.siteId) problems.push("Choose a program site.");
  if (!input.title.trim()) problems.push('Give the shift a name, e.g. "Evening 2:30–10:30".');
  const slots = input.slots ?? 1;
  if (!Number.isInteger(slots) || slots < 1 || slots > 10) problems.push("Slots must be between 1 and 10.");
  if (input.audience === "agency" && input.kind !== "permanent") {
    problems.push("Agency-wide postings are for permanent shifts.");
  }
  if (input.kind === "temporary") {
    const start = input.startsAt ? Date.parse(input.startsAt) : NaN;
    const end = input.endsAt ? Date.parse(input.endsAt) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      problems.push("Set the shift's start and end.");
    } else {
      if (start <= now.getTime()) problems.push("Temporary shifts must start in the future.");
      if (end <= start) problems.push("The shift must end after it starts.");
      if (end - start > 24 * 60 * 60 * 1000) problems.push("A shift can't be longer than 24 hours.");
    }
  } else {
    if (!input.days?.length) problems.push("Choose at least one day of the week.");
    if (!input.windowStart || !HHMM.test(input.windowStart) || !input.windowEnd || !HHMM.test(input.windowEnd)) {
      problems.push("Set the daily start and end times.");
    }
    if (!input.effectiveFrom) problems.push("Choose the date the permanent shift starts.");
    else if (input.effectiveFrom < localDate(now)) problems.push("Permanent shifts need a start date today or later.");
  }
  return problems;
}

/** Weekly hours a permanent posting adds (overnight windows count fully). */
export function permanentWeeklyHours(days: number[], windowStart: string, windowEnd: string): number {
  return computePatternWeeklyHours([...new Set(days)], [{ start: windowStart, end: windowEnd }]);
}

/** Hours of a dated shift. */
export function shiftHours(startsAt: string, endsAt: string): number {
  return Math.round(((Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000) * 100) / 100;
}

/** Open for responses right now (not filled, cancelled, or already started). */
export function isOpenForResponses(shift: HrOpenShift, now = new Date()): boolean {
  if (shift.status !== "open") return false;
  if (shift.kind === "temporary" && shift.startsAt) return Date.parse(shift.startsAt) > now.getTime();
  return true;
}

export function slotsLeft(shift: HrOpenShift): number {
  return Math.max(0, shift.slots - shift.filledCount);
}

/** "Mon Oct 6, 2:30 p.m.–10:30 p.m." or "Mon–Fri · 2:30 p.m.–10:30 p.m. · from Oct 6". */
export function describeOpenShiftWhen(shift: Pick<HrOpenShift, "kind" | "startsAt" | "endsAt" | "days" | "windowStart" | "windowEnd" | "effectiveFrom">): string {
  if (shift.kind === "temporary" && shift.startsAt && shift.endsAt) {
    const start = new Date(shift.startsAt);
    const end = new Date(shift.endsAt);
    const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return `${day}, ${clock(start)}–${clock(end)}`;
  }
  const days = describeDays(shift.days);
  const from = shift.effectiveFrom
    ? new Date(`${shift.effectiveFrom}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  return `${days} · ${hhmmLabel(shift.windowStart)}–${hhmmLabel(shift.windowEnd)}${from ? ` · from ${from}` : ""}`;
}

/** "Mon–Fri", "Sat, Sun", "Every day". */
export function describeDays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.join() === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.join() === "0,6") return "Sat, Sun";
  return sorted.map((d) => STAFFING_DAY_LABELS[d]).join(", ");
}

export interface PickupEvaluation {
  /** Why the staff member can't take it, or null. */
  blocker: string | null;
  weekHours: number;
  wouldBeOvertime: boolean;
  /** True when the pickup is assigned immediately; false = it becomes a bid. */
  direct: boolean;
}

/**
 * The pickup rule for one staff member (mirrors private.open_shift_blocker
 * and respond_open_shift). `existingShifts` are the staff member's dated
 * shifts; `recurringHours` is their weekly recurring-pattern total.
 */
export function evaluatePickup(input: {
  shift: HrOpenShift;
  trainedAtSite: boolean;
  existingShifts: Pick<HrShift, "startsAt" | "endsAt" | "status">[];
  recurringHours?: number;
  weeklyLimitHours?: number;
}): PickupEvaluation {
  const { shift } = input;
  const limit = input.weeklyLimitHours ?? DEFAULT_WEEKLY_LIMIT_HOURS;
  if (shift.audience === "site" && !input.trainedAtSite) {
    return { blocker: "Not trained at this program site yet.", weekHours: 0, wouldBeOvertime: false, direct: false };
  }
  let weekHours = 0;
  let newHours = shift.weeklyHours;
  if (shift.kind === "temporary" && shift.startsAt && shift.endsAt) {
    const s = Date.parse(shift.startsAt);
    const e = Date.parse(shift.endsAt);
    const live = input.existingShifts.filter((x) => x.status !== "cancelled");
    if (live.some((x) => Date.parse(x.startsAt) < e && Date.parse(x.endsAt) > s)) {
      return { blocker: "Already scheduled during this time.", weekHours: 0, wouldBeOvertime: false, direct: false };
    }
    const weekStart = mondayOf(new Date(s)).getTime();
    const weekEnd = weekStart + 7 * 86_400_000;
    for (const x of live) {
      const a = Math.max(Date.parse(x.startsAt), weekStart);
      const b = Math.min(Date.parse(x.endsAt), weekEnd);
      if (b > a) weekHours += (b - a) / 3_600_000;
    }
    weekHours = Math.round(weekHours * 100) / 100;
    newHours = shiftHours(shift.startsAt, shift.endsAt);
  } else {
    weekHours = input.recurringHours ?? 0;
  }
  const wouldBeOvertime = weekHours + newHours > limit;
  const direct = shift.kind === "temporary" && shift.pickupMode === "first_come" && !wouldBeOvertime;
  return { blocker: null, weekHours, wouldBeOvertime, direct };
}

/** Label for the pick-up button, so the outcome is clear before tapping. */
export function pickupActionLabel(shift: HrOpenShift, evaluation?: PickupEvaluation | null): string {
  if (shift.kind === "permanent") return "Bid on this shift";
  if (shift.pickupMode === "approval") return "Bid on this shift";
  if (evaluation?.wouldBeOvertime) return "Request (over 40 hours)";
  return "Pick up";
}

/* ------------------------------- helpers ------------------------------- */

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clock(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const mer = h < 12 ? "a.m." : "p.m.";
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${mer}`;
}

function hhmmLabel(value: string | null): string {
  if (!value || !HHMM.test(value)) return "?";
  const [h, m] = value.split(":").map(Number);
  const mer = h < 12 ? "a.m." : "p.m.";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${mer}`;
}
