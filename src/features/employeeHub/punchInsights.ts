/**
 * punchInsights.ts — Worker 4's presentation layer over Worker 1's punch
 * analytics in src/data/hr.ts.
 *
 * Worker 1's exports are consumed by their EXACT names and signatures:
 *  - detectPunchExceptions(punches, shifts, patterns, rules, nowIso)
 *      → KioskPunchException[]  ({ staffId, punchId, date, flags[], detail })
 *  - scoreTimecard(punches, shifts, rules, nowIso?) → number (0–100)
 *  - scheduledVsActual(shifts, punches) → ScheduledVsActualDay[]
 *  - findAutoClockoutCandidates(openPunches, shifts, rules, nowIso)
 *      → AutoClockoutCandidate[]
 *
 * This module normalizes Worker 1's per-(staff, day) exception rows into
 * one display row per flag, builds review rows for remote punches (punches
 * from a personal device — reviewable, never scoring demerits), and derives
 * the timecard auto-approval decision (Worker 1 scores only; the app decides).
 */

import {
  DEFAULT_PUNCH_RULES,
  detectPunchExceptions as hrDetectPunchExceptions,
  findAutoClockoutCandidates as hrFindAutoClockoutCandidates,
  scheduledVsActual as hrScheduledVsActual,
  scoreTimecard as hrScoreTimecard,
} from "../../data/hr";
import type {
  HrPunch,
  HrPunchRules,
  HrShift,
  HrStaffingPattern,
  KioskExceptionFlag,
  KioskPunchException,
  ScheduledVsActualDay,
} from "../../data/hr";

export type { HrPunch, HrPunchRules, HrShift };

/* ------------------------------- exceptions ------------------------------ */

/**
 * Display exception kinds: Worker 1's KioskExceptionFlag, plus "overlap"
 * (Worker 1's kiosk detection doesn't flag overlapping punches, so the
 * legacy overlap signal is carried through as an extra display kind) and
 * "remote" (punches from a personal device under a hub.remote_punch grant —
 * reviewable, never a scoring demerit).
 */
export type PunchExceptionKind = KioskExceptionFlag | "overlap" | "remote";

/** One display row per (exception row × flag), or per remote punch. */
export interface PunchException {
  kind: PunchExceptionKind;
  staffId: string;
  detail: string;
  /** ISO timestamp the exception is anchored to. */
  at: string;
  /** Null for system-level exceptions (no single punch to act on). */
  punchId: string | null;
}

export interface DetectPunchExceptionsInput {
  punches: HrPunch[];
  shifts: HrShift[];
  /** Staffing patterns (reserved by Worker 1 for v2 pattern-vs-actual). */
  patterns?: HrStaffingPattern[];
  rules: HrPunchRules | null;
  nowIso: string;
}

const MS_PER_MINUTE = 60_000;

/** Anchor a Worker-1 exception row to a timestamp for display/sorting. */
function anchorAt(row: KioskPunchException, punches: HrPunch[], nowIso: string): string {
  if (row.punchId) {
    const punch = punches.find((p) => p.id === row.punchId);
    if (punch) return punch.punchedAt;
  }
  // Day-level rows carry a YYYY-MM-DD work date; anchor at midday so the
  // row sorts with that day's punches.
  const d = new Date(row.date.length <= 10 ? `${row.date}T12:00:00` : row.date);
  return Number.isNaN(d.getTime()) ? nowIso : d.toISOString();
}

function fmtClockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Build review rows for remote punches (punched from a personal device
 * under a hub.remote_punch grant). These are reviewable by managers but are
 * NEVER scoring demerits — they are not fed into scoreTimecard.
 */
export function remotePunchRows(punches: HrPunch[]): PunchException[] {
  return punches
    .filter((p) => p.remote === true)
    .map((p) => ({
      kind: "remote" as const,
      staffId: p.staffId,
      detail:
        `Punched ${p.kind === "out" ? "out" : "in"} from a personal device ` +
        `at ${fmtClockTime(p.punchedAt)} — reviewable, not a scoring demerit.`,
      at: p.punchedAt,
      punchId: p.id,
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * Run Worker 1's detectPunchExceptions and normalize to display rows.
 * Rules default to DEFAULT_PUNCH_RULES (hr.ts) when the agency has no
 * saved row yet.
 */
export function detectPunchExceptions(input: DetectPunchExceptionsInput): PunchException[] {
  const rules: HrPunchRules = input.rules ?? {
    ...DEFAULT_PUNCH_RULES,
    agencyId: "",
    updatedBy: null,
    updatedAt: "",
  };
  const rows: KioskPunchException[] = hrDetectPunchExceptions(
    input.punches,
    input.shifts,
    input.patterns ?? [],
    rules,
    input.nowIso,
  );
  const out: PunchException[] = [];
  for (const row of rows) {
    for (const flag of row.flags) {
      out.push({
        kind: flag,
        staffId: row.staffId,
        detail: row.detail,
        at: anchorAt(row, input.punches, input.nowIso),
        punchId: row.punchId,
      });
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind < b.kind ? -1 : 1));
  return out;
}

/* ----------------------------- schedule variance -------------------------- */

export interface ScheduleVarianceRow extends ScheduledVsActualDay {
  /** Published shift titles worked that day (presentation only). */
  shiftLabels: string[];
}

export interface ScheduledVsActualInput {
  staffId: string;
  punches: HrPunch[];
  shifts: HrShift[];
}

/**
 * Per-day scheduled vs worked minutes for one staff member. Scheduled
 * counts published shifts only; worked counts paired in/out minutes
 * attributed to the clock-in date (night-shift rule). Days with neither
 * are omitted; callers flag |variance| >= 15 minutes.
 */
export function scheduledVsActual(input: ScheduledVsActualInput): ScheduleVarianceRow[] {
  const { staffId, punches, shifts } = input;
  const mine = punches.filter((p) => p.staffId === staffId);
  const days = hrScheduledVsActual(shifts, mine);
  const labelsByDay = new Map<string, string[]>();
  for (const s of shifts) {
    if (s.staffId !== staffId || s.status !== "published") continue;
    const day = s.startsAt.slice(0, 10);
    const list = labelsByDay.get(day) ?? [];
    list.push(s.title);
    labelsByDay.set(day, list);
  }
  return days
    .filter((d) => d.scheduledMinutes > 0 || d.actualMinutes > 0)
    .map((d) => ({
      date: d.date,
      scheduledMinutes: d.scheduledMinutes,
      actualMinutes: d.actualMinutes,
      varianceMinutes: d.varianceMinutes,
      shiftLabels: labelsByDay.get(d.date) ?? [],
    }));
}

/* ------------------------------- timecard score --------------------------- */

export interface TimecardScore {
  /** 0–100 (Worker 1's score). */
  score: number;
  /**
   * True when the score meets the agency's auto-approval threshold AND no
   * hard flags (missed punch, offline punch, auto clock-out) are present.
   * A threshold of 0 disables auto-approval.
   */
  autoApprovable: boolean;
}

export interface ScoreTimecardInput {
  punches: HrPunch[];
  shifts: HrShift[];
  rules: HrPunchRules | null;
  nowIso?: string;
}

const HARD_FLAGS: ReadonlySet<KioskExceptionFlag> = new Set([
  "missed_punch",
  "offline",
  "auto_clockout",
]);

export function scoreTimecard(input: ScoreTimecardInput): TimecardScore {
  const rules: HrPunchRules = input.rules ?? {
    ...DEFAULT_PUNCH_RULES,
    agencyId: "",
    updatedBy: null,
    updatedAt: "",
  };
  const score = hrScoreTimecard(input.punches, input.shifts, rules, input.nowIso);
  const exceptions = hrDetectPunchExceptions(
    input.punches,
    input.shifts,
    [],
    rules,
    input.nowIso ?? new Date().toISOString(),
  );
  const hardFlags = exceptions.some((row) => row.flags.some((f) => HARD_FLAGS.has(f)));
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    autoApprovable:
      rules.autoApprovalScoreThreshold > 0 &&
      score >= rules.autoApprovalScoreThreshold &&
      !hardFlags,
  };
}

/* ------------------------- auto-clock-out candidates ---------------------- */

export interface FindAutoClockoutCandidatesInput {
  openPunches: HrPunch[];
  shifts: HrShift[];
  rules: Pick<HrPunchRules, "autoClockoutBufferMinutes"> | null;
  nowIso: string;
}

/**
 * Open "in" punches the app should auto-close: the punch's published
 * shift ended more than the auto-clock-out buffer ago. Returns Worker 1's
 * rows ({ punch, shift, clockOutAt }).
 */
export function findAutoClockoutCandidates(input: FindAutoClockoutCandidatesInput) {
  return hrFindAutoClockoutCandidates(
    input.openPunches,
    input.shifts,
    { autoClockoutBufferMinutes: input.rules?.autoClockoutBufferMinutes ?? 30 },
    input.nowIso,
  );
}
