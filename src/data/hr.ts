/**
 * hr.ts — Employee Hub domain logic (pure functions).
 *
 * This module is the single home for the HR / Employee Hub's timekeeping,
 * exception, compliance roll-up, and payroll-export math. It is intentionally
 * pure: no imports from API layers (localApi/hostedApi), no I/O, no clock
 * reads — every function takes its inputs (including "now") as arguments so
 * the UI workstream, the API workstream, and tests all share one contract.
 *
 * Design choices (documented here so callers don't have to guess):
 *  - Timestamps are ISO-8601 strings. Date bucketing uses the calendar date
 *    written in the timestamp by default ("local date parts"), because the
 *    API layer stores punch/shift times as agency wall-clock time. Callers
 *    that store UTC stamps can pass an IANA timeZone to convert instead.
 *  - A work segment is attributed to the calendar date its CLOCK-IN falls
 *    on (night-shift rule): a 22:00–06:00 shift counts toward the day it
 *    started, so daily totals never split one shift across two days.
 *  - Punch pairing is FIFO per staff member: each "out" closes the earliest
 *    still-open "in". An "in" that arrives while another is still open is
 *    kept as its own open segment AND flagged as an overlapping_punch
 *    exception — the data is anomalous, so both segments stay visible.
 *  - summarizeTimecard treats the supplied punches as ONE work week and
 *    computes overtime as minutes beyond 40h for that week. Pay-period
 *    rollups sum weekly summaries; the API layer groups by week.
 *  - rollupCompliance never invents evidence: requirements with no matching
 *    evidence are missing_or_expired, expired evidence is missing_or_expired
 *    (never due_soon), and role-scoped requirements the staff member's role
 *    doesn't hold are filtered OUT of the results entirely.
 *  - The CSV exporter is a serializer, not a calculator: totals math lives
 *    in summarizeTimecard; the exporter only escapes and formats.
 */

/* ------------------------------------------------------------------ */
/* Entity interfaces — the UI workstream codes against this contract.  */
/* Field names are frozen: do not rename without coordinating.         */
/* ------------------------------------------------------------------ */

export interface HrShift {
  id: string;
  agencyId: string;
  siteId: string | null;
  staffId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "published" | "cancelled";
  notes: string | null;
  createdBy: string;
}

export interface HrPunch {
  id: string;
  agencyId: string;
  siteId: string | null;
  staffId: string;
  kind: "in" | "out" | "break_in" | "break_out" | "transfer";
  punchedAt: string;
  source: string;
  note: string | null;
  shiftId: string | null;
  /* KIOSK (2026-09-16): optional — existing rows/queries omit them. */
  /** Individual-service context (ISD) when the punch served someone. */
  serviceType?: string | null;
  individualId?: string | null;
  /** DB check: web | mobile | kiosk_pin | qr | nfc. */
  verificationMethod?: string | null;
  /** Recorded while the device was offline; queued for manager review. */
  offline?: boolean;
  /** True when punched from a personal device under a hub.remote_punch grant. */
  remote?: boolean;
  roundedPunchedAt?: string | null;
  /** jsonb attestation payload, e.g. {"meal_break_taken": true}. */
  attestation?: unknown;
  /** Groups the out->in pair that is a transfer between sites/individuals. */
  transferGroup?: string | null;
  /** True when the app auto-closed this punch after the auto-clockout buffer. */
  autoClockout?: boolean | null;
  exceptionFlags?: string[];
}

export interface HrPunchCorrection {
  id: string;
  punchId: string;
  staffId: string;
  requestedKind: "in" | "out" | null;
  requestedAt: string | null;
  reason: string;
  status: "pending" | "approved" | "denied";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface HrPayPeriod {
  id: string;
  agencyId: string;
  startsOn: string;
  endsOn: string;
  status: "open" | "locked" | "exported";
  lockedBy: string | null;
  lockedAt: string | null;
}

export interface HrTimecardApproval {
  id: string;
  payPeriodId: string;
  staffId: string;
  status: "pending" | "submitted" | "approved" | "changes_requested";
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface HrDocument {
  id: string;
  agencyId: string;
  title: string;
  category: "handbook" | "policy" | "form" | "notice";
  body: string | null;
  fileUrl: string | null;
  requiresAck: boolean;
  active: boolean;
}

export interface HrDocumentAck {
  id: string;
  docId: string;
  staffId: string;
  ackedAt: string;
  signatureName: string;
}

export interface HrTimeOffRequest {
  id: string;
  agencyId: string;
  siteId: string | null;
  staffId: string;
  kind: "pto" | "sick" | "unpaid" | "other";
  startsOn: string;
  endsOn: string;
  status: "pending" | "approved" | "denied";
  reason: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface HrReadinessRequirement {
  id: string;
  agencyId: string;
  key: string;
  label: string;
  kind: "certificate" | "training" | "document" | "acknowledgment";
  dueEveryDays: number | null;
  requiredRoleKeys: string[];
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Compliance roll-up evidence (read-only projections from elsewhere). */
/* ------------------------------------------------------------------ */

export interface CertEvidence {
  key: string;
  name: string;
  expiresOn: string;
} // from staff_certificates (user_id, cert_name, expires_on)

export interface TrainingEvidence {
  key: string;
  label: string;
  completedOn: string;
  nextDueOn: string | null;
}

export interface DelegationEvidence {
  key: string;
  label: string;
  completedOn: string;
  nextDueOn: string | null;
}

export type ReadinessStatus = "complete" | "due_soon" | "missing_or_expired";

export interface ReadinessResult {
  requirement: HrReadinessRequirement;
  status: ReadinessStatus;
  evidenceNote: string | null;
  dueOn: string | null;
}

/* ------------------------------------------------------------------ */
/* Configurable constants — policy knobs in one place.                 */
/* ------------------------------------------------------------------ */

/** Weekly hours before overtime accrues (FLSA standard). */
export const OVERTIME_WEEKLY_HOURS = 40;
/** Days before a due date that a requirement flips to "due soon". */
export const DUE_SOON_DAYS = 30;
/** Clock-in may be this many minutes after shift start without flagging late. */
export const LATE_GRACE_MINUTES = 5;
/** Minutes after a published shift's end before an open clock-in is a miss. */
export const MISSED_PUNCH_GRACE_MINUTES = 15;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Small date/time helpers (documented, no external deps).             */
/* ------------------------------------------------------------------ */

/** Whole minutes between two ISO timestamps, rounded, never negative. */
function minutesBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.round(ms / MS_PER_MINUTE));
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MS_PER_MINUTE).toISOString();
}

function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * Calendar-date key ("YYYY-MM-DD") for a timestamp.
 * Default (no timeZone): uses the date parts written in the ISO string —
 * the API stores punch/shift times as agency wall-clock time, so no
 * conversion is needed or wanted. With timeZone (IANA name): converts the
 * instant into that zone first — use this when timestamps are stored as UTC
 * ("Z") instants rather than wall-clock strings.
 */
function dateKeyOf(iso: string, timeZone?: string): string {
  if (!timeZone) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Parses an ISO date/datetime to epoch ms; NaN when unparseable. */
function parseTime(iso: string): number {
  return new Date(iso).getTime();
}

/* ------------------------------------------------------------------ */
/* Punch pairing                                                        */
/* ------------------------------------------------------------------ */

export interface WorkSegment {
  staffId: string;
  clockIn: string;
  clockOut: string | null;
  minutes: number;
}

interface PairedPunch {
  in: HrPunch;
  out: HrPunch | null;
}

/**
 * Core punch analysis shared by pairPunches and detectExceptions.
 * Groups by staff, sorts by time, and walks a FIFO queue of open "in"s:
 * each "out" closes the earliest still-open "in"; an "out" with nothing open
 * is orphan data and is ignored (the clock-out guard prevents new ones).
 * An "in" that arrives while the queue is non-empty is recorded as an
 * overlap AND kept as its own open segment — the anomaly stays visible in
 * both the segments list and the exception feed.
 * Non-pairable kinds ("break_in", "break_out", "transfer") are timeline
 * events, never segment boundaries: they neither open nor close segments,
 * so a transfer logged between an "in" and an "out" never breaks pairing.
 */
function analyzePunches(punches: HrPunch[]): {
  segments: PairedPunch[];
  overlaps: HrPunch[];
} {
  const byStaff = new Map<string, HrPunch[]>();
  for (const punch of punches) {
    const list = byStaff.get(punch.staffId);
    if (list) list.push(punch);
    else byStaff.set(punch.staffId, [punch]);
  }
  const segments: PairedPunch[] = [];
  const overlaps: HrPunch[] = [];
  for (const list of byStaff.values()) {
    const sorted = [...list].sort((a, b) =>
      a.punchedAt < b.punchedAt ? -1 : a.punchedAt > b.punchedAt ? 1 : 0,
    );
    const open: HrPunch[] = [];
    for (const punch of sorted) {
      if (punch.kind === "in") {
        if (open.length > 0) overlaps.push(punch);
        open.push(punch);
      } else if (punch.kind === "out") {
        const match = open.shift(); // FIFO: earliest open "in" closes first
        if (match) segments.push({ in: match, out: punch });
        // else: orphan "out" — ignored; validateClockOut prevents new ones.
      }
      // break_in / break_out / transfer: timeline events, not pairable.
    }
    for (const remaining of open) segments.push({ in: remaining, out: null });
  }
  segments.sort((a, b) =>
    a.in.punchedAt < b.in.punchedAt
      ? -1
      : a.in.punchedAt > b.in.punchedAt
        ? 1
        : a.in.staffId < b.in.staffId
          ? -1
          : 1,
  );
  return { segments, overlaps };
}

/**
 * Pairs each "in" with the next "out" into work segments.
 * Open segments (no "out" yet) carry clockOut: null and minutes: 0 — the
 * duration is unknown until the shift closes, and detectExceptions decides
 * whether the open punch is a problem.
 */
export function pairPunches(punches: HrPunch[]): WorkSegment[] {
  return analyzePunches(punches).segments.map((segment) => ({
    staffId: segment.in.staffId,
    clockIn: segment.in.punchedAt,
    clockOut: segment.out ? segment.out.punchedAt : null,
    minutes: segment.out
      ? minutesBetween(segment.in.punchedAt, segment.out.punchedAt)
      : 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Totals                                                               */
/* ------------------------------------------------------------------ */

/**
 * Minutes per calendar day ("YYYY-MM-DD" -> minutes).
 * Night-shift rule: a segment is attributed to the date its clock-in falls
 * on, so a 22:00–06:00 shift counts wholly toward the day it started.
 * Open segments contribute 0 minutes (unknown duration).
 */
export function dailyTotals(
  punches: HrPunch[],
  timeZone?: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const segment of pairPunches(punches)) {
    const day = dateKeyOf(segment.clockIn, timeZone);
    totals[day] = (totals[day] ?? 0) + segment.minutes;
  }
  return totals;
}

/**
 * Total minutes for the 7-day week starting on weekStart ("YYYY-MM-DD",
 * inclusive). Segments are attributed by clock-in date (night-shift rule).
 * weekStart is a plain date string, so the plain date-key path is used —
 * pass pre-converted wall-clock punches, as with dailyTotals.
 */
export function weeklyTotals(punches: HrPunch[], weekStart: string): number {
  const windowEnd = addDaysIso(`${weekStart}T00:00:00.000Z`, 7).slice(0, 10);
  let total = 0;
  for (const segment of pairPunches(punches)) {
    const day = dateKeyOf(segment.clockIn);
    if (day >= weekStart && day < windowEnd) total += segment.minutes;
  }
  return total;
}

export interface TimecardSummary {
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
}

/**
 * Summarizes ONE work week's punches into regular/overtime minutes.
 * Unpaid breaks are deducted per distinct day worked (floored at 0 per day).
 *
 * Without `overtimeRules` the legacy behavior applies: overtime is the weekly
 * net beyond OVERTIME_WEEKLY_HOURS (40h). With rules, overtime is layered so
 * the same minute is never counted twice:
 *  - daily OT: minutes beyond dailyThresholdHours, summed per day;
 *  - seventh-consecutive-day OT: for maximal runs of consecutive calendar
 *    days with net > 0 minutes, the 7th, 14th, ... day contributes
 *    max(0, net - seventhDayThresholdHours*60);
 *  - weekly OT: remaining minutes beyond weeklyThresholdHours.
 *
 * Conventions (documented so callers don't guess):
 *  - Overnight segments attribute to the CLOCK-IN day (night-shift rule),
 *    so daily thresholds always see the whole shift on the day it started.
 *  - The 7th-day detector only sees the punch set passed in: the store/UI
 *    passes one week at a time, so a streak that crosses the week boundary
 *    restarts here. Cross-week streaks are a documented limitation — the
 *    API layer must pass a wider window if California-style 7th-day pay
 *    needs to span pay periods.
 */
export function summarizeTimecard(
  punches: HrPunch[],
  options: {
    unpaidBreakMinutesPerDay: number;
    overtimeRules?: HrOvertimeRules;
  },
): TimecardSummary {
  const byDay: Record<string, number> = {};
  for (const segment of pairPunches(punches)) {
    const day = dateKeyOf(segment.clockIn);
    byDay[day] = (byDay[day] ?? 0) + segment.minutes;
  }
  const netByDay: Record<string, number> = {};
  let totalNetMinutes = 0;
  for (const [day, dayMinutes] of Object.entries(byDay)) {
    const net = Math.max(0, dayMinutes - options.unpaidBreakMinutesPerDay);
    netByDay[day] = net;
    totalNetMinutes += net;
  }
  const rules = options.overtimeRules;

  // Daily overtime: minutes beyond the daily threshold, summed per day.
  let dailyOtMinutes = 0;
  if (rules?.dailyThresholdHours != null && rules.dailyThresholdHours > 0) {
    const threshold = rules.dailyThresholdHours * 60;
    for (const net of Object.values(netByDay)) {
      dailyOtMinutes += Math.max(0, net - threshold);
    }
  }

  // Seventh-consecutive-day overtime: maximal runs of consecutive calendar
  // days with net > 0; the 7th, 14th, ... day of each run contributes
  // minutes beyond the 7th-day threshold.
  let seventhDayOtMinutes = 0;
  if (rules?.seventhConsecutiveDay) {
    const seventhThreshold = rules.seventhDayThresholdHours * 60;
    const runs: string[][] = [];
    let run: string[] = [];
    let prevDay: string | null = null;
    for (const day of Object.keys(netByDay).sort()) {
      const consecutive =
        prevDay !== null &&
        day === addDaysIso(`${prevDay}T00:00:00.000Z`, 1).slice(0, 10);
      if (netByDay[day] > 0 && (run.length === 0 || consecutive)) {
        run.push(day);
      } else {
        if (run.length > 0) runs.push(run);
        run = netByDay[day] > 0 ? [day] : [];
      }
      prevDay = day;
    }
    if (run.length > 0) runs.push(run);
    for (const runDays of runs) {
      for (let i = 6; i < runDays.length; i += 7) {
        seventhDayOtMinutes += Math.max(0, netByDay[runDays[i]] - seventhThreshold);
      }
    }
  }

  // Weekly overtime applies only to what's left after daily + 7th-day OT.
  const weeklyThreshold = (rules?.weeklyThresholdHours ?? OVERTIME_WEEKLY_HOURS) * 60;
  const weeklyOtMinutes = Math.max(
    0,
    totalNetMinutes - weeklyThreshold - dailyOtMinutes - seventhDayOtMinutes,
  );
  const overtimeMinutes = dailyOtMinutes + seventhDayOtMinutes + weeklyOtMinutes;
  return {
    regularMinutes: totalNetMinutes - overtimeMinutes,
    overtimeMinutes,
    totalMinutes: totalNetMinutes,
  };
}

/* ------------------------------------------------------------------ */
/* Punch guards                                                         */
/* ------------------------------------------------------------------ */

/**
 * The currently open "in" punch, if any. Only punches at or before nowIso
 * count — a future-dated "in" is out-of-band data, not an open session.
 * Callers pass ONE staff member's punches; the helpers don't filter by staff.
 */
function openInPunch(punches: HrPunch[], nowIso?: string): HrPunch | null {
  const cutoff = nowIso === undefined ? null : parseTime(nowIso);
  const relevant =
    cutoff === null
      ? punches
      : punches.filter((p) => parseTime(p.punchedAt) <= cutoff);
  const stack: HrPunch[] = [];
  const sorted = [...relevant].sort((a, b) =>
    a.punchedAt < b.punchedAt ? -1 : a.punchedAt > b.punchedAt ? 1 : 0,
  );
  for (const punch of sorted) {
    if (punch.kind === "in") stack.push(punch);
    else if (punch.kind === "out" && stack.length > 0) stack.pop();
    // break_in / break_out / transfer never open or close a session.
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/**
 * Throws when the staff member already has an open clock-in.
 * Message is user-facing (shown on the kiosk "already clocked in" state).
 */
export function validateClockIn(punches: HrPunch[], nowIso: string): void {
  if (openInPunch(punches, nowIso) !== null) {
    throw new Error("Already clocked in — clock out first.");
  }
}

/**
 * Throws when there is no open clock-in to close.
 * Message is user-facing (shown on the kiosk "nothing to close" state).
 */
export function validateClockOut(punches: HrPunch[]): void {
  if (openInPunch(punches) === null) {
    throw new Error("No open clock-in to close.");
  }
}

/* ------------------------------------------------------------------ */
/* Exception detection                                                  */
/* ------------------------------------------------------------------ */

export type ExceptionKind =
  | "missed_punch"
  | "late_clock_in"
  | "early_clock_out"
  | "overlapping_punch"
  | "timecard_unapproved_at_lock";

export interface Exception {
  kind: ExceptionKind;
  staffId: string;
  detail: string;
  /** ISO timestamp the exception is anchored to (shift end, punch time…). */
  at: string;
}

export interface DetectExceptionsInput {
  punches: HrPunch[];
  shifts: HrShift[];
  timecardApprovals: HrTimecardApproval[];
  payPeriods: HrPayPeriod[];
  nowIso: string;
}

/**
 * Attributes a punch to a published shift: the shift must be published, the
 * staff must match (or the shift is unassigned and the site matches), and the
 * punch time must fall within [startsAt, endsAt + 60min] so late clock-ins
 * still land on their shift. Most-recently-started candidate wins.
 * Only published shifts anchor exceptions — draft ("scheduled") and
 * cancelled shifts are not commitments the system enforces.
 */
function findPublishedShiftForPunch(
  punch: HrPunch,
  shifts: HrShift[],
): HrShift | null {
  const punchTime = parseTime(punch.punchedAt);
  let best: HrShift | null = null;
  for (const shift of shifts) {
    if (shift.status !== "published") continue;
    const staffMatches =
      shift.staffId === punch.staffId ||
      (shift.staffId === null &&
        (shift.siteId === punch.siteId || shift.siteId === null));
    if (!staffMatches) continue;
    const windowEnd = parseTime(shift.endsAt) + 60 * MS_PER_MINUTE;
    if (punchTime < parseTime(shift.startsAt) || punchTime > windowEnd) continue;
    if (best === null || shift.startsAt > best.startsAt) best = shift;
  }
  return best;
}

function fmtTime(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * Scans punches, shifts, and timecard approvals for the five exception
 * kinds. Rules:
 *  - missed_punch: an "in" with no "out" whose published shift ended more
 *    than MISSED_PUNCH_GRACE_MINUTES (15) ago. Needs a published shift —
 *    an open punch with no matching shift is left for manual review.
 *  - late_clock_in: clock-in later than shift start + LATE_GRACE_MINUTES (5).
 *  - early_clock_out: clock-out earlier than shift end − LATE_GRACE_MINUTES.
 *  - overlapping_punch: an "in" recorded while a previous "in" is open.
 *  - timecard_unapproved_at_lock: pay period is locked/exported but the
 *    staff member's approval is anything other than "approved".
 * One punch can raise more than one kind (e.g. late AND missed) — kinds are
 * independent signals, not exclusive states.
 */
export function detectExceptions(input: DetectExceptionsInput): Exception[] {
  const { punches, shifts, timecardApprovals, payPeriods, nowIso } = input;
  const exceptions: Exception[] = [];
  const { segments, overlaps } = analyzePunches(punches);
  const now = parseTime(nowIso);

  for (const segment of segments) {
    const shift = findPublishedShiftForPunch(segment.in, shifts);
    const staffId = segment.in.staffId;
    const clockedInLate =
      shift !== null &&
      parseTime(segment.in.punchedAt) >
        parseTime(shift.startsAt) + LATE_GRACE_MINUTES * MS_PER_MINUTE;
    if (clockedInLate && shift !== null) {
      exceptions.push({
        kind: "late_clock_in",
        staffId,
        detail: `Clocked in at ${fmtTime(segment.in.punchedAt)}, ${LATE_GRACE_MINUTES} minutes after the ${fmtTime(shift.startsAt)} shift start.`,
        at: segment.in.punchedAt,
      });
    }
    if (segment.out === null) {
      // Open punch: the missed-punch check needs a published shift whose end
      // plus the 15-minute grace has already passed.
      if (
        shift !== null &&
        now > parseTime(shift.endsAt) + MISSED_PUNCH_GRACE_MINUTES * MS_PER_MINUTE
      ) {
        exceptions.push({
          kind: "missed_punch",
          staffId,
          detail: `Clocked in at ${fmtTime(segment.in.punchedAt)} for the shift ending ${fmtTime(shift.endsAt)} but never clocked out.`,
          at: shift.endsAt,
        });
      }
    } else if (
      shift !== null &&
      parseTime(segment.out.punchedAt) <
        parseTime(shift.endsAt) - LATE_GRACE_MINUTES * MS_PER_MINUTE
    ) {
      exceptions.push({
        kind: "early_clock_out",
        staffId,
        detail: `Clocked out at ${fmtTime(segment.out.punchedAt)}, before the ${fmtTime(shift.endsAt)} shift end.`,
        at: segment.out.punchedAt,
      });
    }
  }

  for (const punch of overlaps) {
    exceptions.push({
      kind: "overlapping_punch",
      staffId: punch.staffId,
      detail: `Clocked in at ${fmtTime(punch.punchedAt)} while a previous clock-in was still open.`,
      at: punch.punchedAt,
    });
  }

  for (const period of payPeriods) {
    if (period.status !== "locked" && period.status !== "exported") continue;
    for (const approval of timecardApprovals) {
      if (approval.payPeriodId !== period.id) continue;
      if (approval.status === "approved") continue;
      exceptions.push({
        kind: "timecard_unapproved_at_lock",
        staffId: approval.staffId,
        detail: `Pay period ${period.startsOn} to ${period.endsOn} is ${period.status} but the timecard is "${approval.status.replace("_", " ")}".`,
        at: period.lockedAt ?? period.endsOn,
      });
    }
  }

  exceptions.sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind < b.kind ? -1 : 1,
  );
  return exceptions;
}

/* ------------------------------------------------------------------ */
/* Compliance roll-up                                                   */
/* ------------------------------------------------------------------ */

export interface ComplianceEvidence {
  certs: CertEvidence[];
  trainings: TrainingEvidence[];
  delegations: DelegationEvidence[];
  docAcks: { docKey: string; ackedAt: string }[];
}

/**
 * Case-insensitive contains-match between a requirement key and an evidence
 * key/label. Matches either direction so "cpr" matches "CPR Certification"
 * and "cpr-certification" matches "CPR".
 */
function evidenceMatches(requirementKey: string, evidenceKey: string): boolean {
  const want = requirementKey.toLowerCase().trim();
  const have = evidenceKey.toLowerCase().trim();
  return want.length > 0 && have.length > 0 && (have.includes(want) || want.includes(have));
}

interface CandidateEvidence {
  label: string;
  dueOn: string | null;
  note: string;
}

/**
 * Collects the evidence candidates for one requirement, routed by kind:
 *  - certificate  -> staff certificate records (expiry = expiresOn)
 *  - training     -> training completions AND delegation training completions
 *                    (a delegation course satisfies a training requirement)
 *  - document / acknowledgment -> document acknowledgments
 * dueEveryDays backfills a missing next-due date from the completion date
 * (completedOn + dueEveryDays); for document acks the completion is ackedAt.
 * An unparseable due date is treated as "no due date" rather than failing
 * the whole roll-up.
 */
function candidatesForRequirement(
  requirement: HrReadinessRequirement,
  evidence: ComplianceEvidence,
): CandidateEvidence[] {
  const out: CandidateEvidence[] = [];
  const key = requirement.key;
  if (requirement.kind === "certificate") {
    for (const cert of evidence.certs) {
      if (!evidenceMatches(key, cert.key) && !evidenceMatches(key, cert.name)) continue;
      const dueOn = Number.isNaN(parseTime(cert.expiresOn)) ? null : cert.expiresOn;
      out.push({ label: cert.name, dueOn, note: cert.name });
    }
  } else if (requirement.kind === "training") {
    const dated = [...evidence.trainings, ...evidence.delegations];
    for (const training of dated) {
      if (!evidenceMatches(key, training.key) && !evidenceMatches(key, training.label)) continue;
      let dueOn = training.nextDueOn;
      if (!dueOn && requirement.dueEveryDays !== null) {
        dueOn = addDaysIso(training.completedOn, requirement.dueEveryDays);
      }
      if (dueOn !== null && Number.isNaN(parseTime(dueOn))) dueOn = null;
      out.push({ label: training.label, dueOn, note: training.label });
    }
  } else {
    // "document" and "acknowledgment": satisfied by a document acknowledgment.
    for (const ack of evidence.docAcks) {
      if (!evidenceMatches(key, ack.docKey)) continue;
      let dueOn: string | null = null;
      if (requirement.dueEveryDays !== null) {
        dueOn = addDaysIso(ack.ackedAt, requirement.dueEveryDays);
      }
      out.push({ label: ack.docKey, dueOn, note: ack.docKey });
    }
  }
  return out;
}

/**
 * Rolls a staff member's readiness requirements up to per-requirement status.
 * staffId identifies the person whose (pre-filtered) evidence was passed in;
 * the function itself doesn't re-filter by staff — the API layer scopes the
 * evidence query.
 *
 *  - Requirements whose requiredRoleKeys is non-empty and doesn't include
 *    staffRoleKey are FILTERED OUT (not returned at all).
 *  - Status: complete when evidence exists and there is no due date, or the
 *    due date is more than DUE_SOON_DAYS (30) out. due_soon when the due
 *    date is within (now, now+30d]. missing_or_expired when there is no
 *    evidence, or the due date is at or before now. Boundaries: due exactly
 *    at now+30d counts as due_soon; due exactly at now counts as expired.
 *  - When several evidence rows match, the one with the latest due date wins
 *    (evidence with no due date outranks any dated evidence).
 */
export function rollupCompliance(
  staffId: string,
  staffRoleKey: string,
  requirements: HrReadinessRequirement[],
  evidence: ComplianceEvidence,
  nowIso: string,
): ReadinessResult[] {
  void staffId; // identity only — evidence is pre-filtered per staff by the caller
  const now = parseTime(nowIso);
  const soonCutoff = now + DUE_SOON_DAYS * MS_PER_DAY;
  const results: ReadinessResult[] = [];

  for (const requirement of requirements) {
    if (
      requirement.requiredRoleKeys.length > 0 &&
      !requirement.requiredRoleKeys.includes(staffRoleKey)
    ) {
      continue; // not applicable to this role — excluded, not "missing"
    }
    const candidates = candidatesForRequirement(requirement, evidence);
    if (candidates.length === 0) {
      results.push({
        requirement,
        status: "missing_or_expired",
        evidenceNote: "No evidence on file",
        dueOn: null,
      });
      continue;
    }
    // Latest due date wins; no-due-date evidence outranks dated evidence.
    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      const bestDue = best.dueOn === null ? Infinity : parseTime(best.dueOn);
      const candDue = candidate.dueOn === null ? Infinity : parseTime(candidate.dueOn);
      if (candDue > bestDue) best = candidate;
    }
    if (best.dueOn === null) {
      results.push({
        requirement,
        status: "complete",
        evidenceNote: `${best.note} — on file`,
        dueOn: null,
      });
      continue;
    }
    const due = parseTime(best.dueOn);
    if (due <= now) {
      results.push({
        requirement,
        status: "missing_or_expired",
        evidenceNote: `${best.note} — expired ${best.dueOn.slice(0, 10)}`,
        dueOn: best.dueOn,
      });
    } else if (due <= soonCutoff) {
      results.push({
        requirement,
        status: "due_soon",
        evidenceNote: `${best.note} — due ${best.dueOn.slice(0, 10)}`,
        dueOn: best.dueOn,
      });
    } else {
      results.push({
        requirement,
        status: "complete",
        evidenceNote: `${best.note} — current through ${best.dueOn.slice(0, 10)}`,
        dueOn: best.dueOn,
      });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Payroll CSV export                                                   */
/* ------------------------------------------------------------------ */

export interface PayrollRow {
  employeeId: string;
  employeeEmail: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  regularHours: number;
  overtimeHours: number;
  ptoHours: number;
  sickHours: number;
  totalHours: number;
}

const PAYROLL_CSV_HEADERS = [
  "employee_id",
  "employee_email",
  "employee_name",
  "period_start",
  "period_end",
  "regular_hours",
  "overtime_hours",
  "pto_hours",
  "sick_hours",
  "total_hours",
] as const;

/**
 * Serializes payroll rows to CSV. The hours are passed in as already-computed
 * decimals (regular/overtime from summarizeTimecard minutes ÷ 60, PTO/sick
 * from approved time-off requests) — this function only escapes and formats.
 * Hours print trimmed ("40", "37.5") rather than forced to two decimals so
 * imports don't choke on "40.00" vs "40" mismatches.
 */
function csvEscapeCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

/**
 * Builds the payroll export CSV.
 *
 * Vendor mapping (why these columns): Paycor, ADP, and Gusto all offer a
 * generic "hours import" shaped as one row per employee per pay period with
 * an employee identifier plus hour buckets — that shape is the common
 * denominator captured here, so the same file works as the starting point
 * for any of the three:
 *  - employee_id / employee_email: the stable employee identifier. Paycor
 *    matches on employee ID (email as fallback); ADP's batch import keys on
 *    the employee/company code; Gusto matches on email. Keep employee_id as
 *    the payroll system's ID once assigned, email as the human fallback.
 *  - period_start / period_end: the pay period the hours belong to (maps to
 *    the pay-period selector in each vendor's import; all three reject rows
 *    outside an open period).
 *  - regular_hours / overtime_hours: map to the vendor's REG and OT earnings
 *    codes. Overtime here is weekly-FLSA overtime from summarizeTimecard.
 *  - pto_hours / sick_hours: map to PTO/SICK earnings codes; source is
 *    approved time-off requests, not punches.
 *  - total_hours: informational checksum (regular + overtime + pto + sick);
 *    vendors recompute from the buckets, but the column lets payroll spot a
 *    bad row before importing.
 * Verify the column mapping against the vendor's import template on first
 * use — earnings-code names differ per tenant.
 */
export function buildPayrollCsvExport(rows: PayrollRow[]): string {
  const lines = [PAYROLL_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscapeCell(row.employeeId),
        csvEscapeCell(row.employeeEmail),
        csvEscapeCell(row.employeeName),
        csvEscapeCell(row.periodStart),
        csvEscapeCell(row.periodEnd),
        formatHours(row.regularHours),
        formatHours(row.overtimeHours),
        formatHours(row.ptoHours),
        formatHours(row.sickHours),
        formatHours(row.totalHours),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/**
 * ============================================================================
 * HR-STAFFING (2026-09-16): recurring staffing patterns.
 * ============================================================================
 *
 * Replaces the free-text staffing spreadsheet. One pattern = one staff
 * member's recurring weekly assignment: a set of weekdays plus one or more
 * time windows per day ("HH:MM" 24-hour), an optional house (site) or served
 * individual, service tags (e.g. "In-Home Respite"), and flags.
 *
 * Overnight attribution decision: a window whose end is earlier than (or
 * equal to) its start spans midnight (e.g. 23:00-07:00 = 8 hours). Hours are
 * counted in full on the day the window STARTS, matching how the spreadsheet
 * records overnight shifts ("Thu OVN 10:30p-6:30a" counts Thursday's row).
 * Dated hr_shifts remain the source of truth for actual coverage; patterns
 * describe the recurring plan.
 */

/** One daily time window, 24-hour "HH:MM". end <= start means overnight. */
export interface StaffingWindow {
  start: string;
  end: string;
}

export interface HrStaffingPattern {
  id: string;
  agencyId: string;
  siteId: string | null;
  staffId: string;
  /** Display hint populated by the store (join to profiles); not a column. */
  staffName?: string | null;
  individualId: string | null;
  /** Display hint for the served individual or program; not a column. */
  individualName?: string | null;
  /** Display hint for the house/site name; not a column. */
  siteName?: string | null;
  shiftLabel: string | null;
  /** 0 = Sunday .. 6 = Saturday. */
  days: number[];
  windows: StaffingWindow[];
  weeklyHours: number;
  serviceTags: string[];
  requiresIsdTraining: boolean;
  onCall: boolean;
  notes: string | null;
  /** YYYY-MM-DD */
  effectiveFrom: string;
  /** YYYY-MM-DD, null = open-ended */
  effectiveTo: string | null;
  active: boolean;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutesOfDay(hhmm: string): number {
  const m = TIME_RE.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Duration of one window in minutes. Overnight (end <= start) spans midnight. */
export function staffingWindowMinutes(window: StaffingWindow): number {
  const start = minutesOfDay(window.start);
  const end = minutesOfDay(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return NaN;
  if (end === start) return 0;
  return end > start ? end - start : end - start + 24 * 60;
}

/** Weekly hours implied by days x windows. Rounds to 2 decimals. */
export function computePatternWeeklyHours(
  days: number[],
  windows: StaffingWindow[],
): number {
  const perDay = windows.reduce((sum, w) => {
    const mins = staffingWindowMinutes(w);
    return sum + (Number.isFinite(mins) ? mins : 0);
  }, 0);
  return Math.round(((perDay / 60) * days.length + Number.EPSILON) * 100) / 100;
}

function windowsOverlap(a: StaffingWindow, b: StaffingWindow): boolean {
  // Expand each window into [start, end) minute ranges on a 48h line so
  // overnight windows compare correctly; overlap if ranges intersect.
  const ranges = (w: StaffingWindow): Array<[number, number]> => {
    const s = minutesOfDay(w.start);
    const e = minutesOfDay(w.end);
    if (e > s) return [[s, e]];
    return [
      [s, s + (e - s + 24 * 60)],
      [s - 24 * 60, e],
    ];
  };
  for (const [s1, e1] of ranges(a)) {
    for (const [s2, e2] of ranges(b)) {
      if (s1 < e2 && s2 < e1) return true;
    }
  }
  return false;
}

export interface StaffingPatternInput {
  staffId: string;
  days: number[];
  windows: StaffingWindow[];
  weeklyHours: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Validate a staffing pattern form. Returns error messages; empty = valid.
 * Checks: staff chosen, >=1 day, >=1 well-formed window, no zero-length or
 * overlapping windows, stored weekly_hours matches days x windows (within
 * 0.01), effective dates sane.
 */
export function validateStaffingPattern(input: StaffingPatternInput): string[] {
  const errors: string[] = [];
  if (!input.staffId) errors.push("Choose a staff member.");
  if (input.days.length === 0) {
    errors.push("Choose at least one day of the week.");
  } else if (input.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    errors.push("Days must be 0 (Sunday) through 6 (Saturday).");
  }
  if (input.windows.length === 0) {
    errors.push("Add at least one time window.");
  }
  input.windows.forEach((w, i) => {
    const label = `Window ${i + 1}`;
    if (!TIME_RE.test(w.start) || !TIME_RE.test(w.end)) {
      errors.push(`${label}: use 24-hour HH:MM times.`);
      return;
    }
    if (staffingWindowMinutes(w) === 0) {
      errors.push(`${label}: start and end cannot be the same time.`);
    }
  });
  for (let i = 0; i < input.windows.length; i++) {
    for (let j = i + 1; j < input.windows.length; j++) {
      if (windowsOverlap(input.windows[i], input.windows[j])) {
        errors.push(`Windows ${i + 1} and ${j + 1} overlap.`);
      }
    }
  }
  const expected = computePatternWeeklyHours(input.days, input.windows);
  if (Math.abs(expected - input.weeklyHours) > 0.011) {
    errors.push(
      `Weekly hours should be ${expected} for the days and windows chosen.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    errors.push("Choose a valid effective-from date.");
  }
  if (
    input.effectiveTo !== null &&
    input.effectiveTo !== "" &&
    input.effectiveTo < input.effectiveFrom
  ) {
    errors.push("The end date cannot be before the start date.");
  }
  return errors;
}

/** Is the pattern in effect on the given YYYY-MM-DD date? */
export function patternCoversDate(
  pattern: Pick<HrStaffingPattern, "effectiveFrom" | "effectiveTo" | "active">,
  dateIso: string,
): boolean {
  if (!pattern.active) return false;
  if (dateIso < pattern.effectiveFrom) return false;
  if (pattern.effectiveTo && dateIso > pattern.effectiveTo) return false;
  return true;
}

/**
 * Expand a pattern into concrete per-day occurrences for a date range.
 * Each occurrence: { date, dayOfWeek, windows }. Useful for rendering the
 * schedule board and for comparing recurring coverage against dated shifts.
 */
export interface PatternOccurrence {
  date: string;
  dayOfWeek: number;
  windows: StaffingWindow[];
}

export function expandStaffingPattern(
  pattern: Pick<
    HrStaffingPattern,
    "days" | "windows" | "effectiveFrom" | "effectiveTo" | "active"
  >,
  fromIso: string,
  toIso: string,
): PatternOccurrence[] {
  const out: PatternOccurrence[] = [];
  const start = new Date(`${fromIso}T00:00:00`);
  const end = new Date(`${toIso}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!patternCoversDate(pattern, iso)) continue;
    if (!pattern.days.includes(d.getDay())) continue;
    out.push({ date: iso, dayOfWeek: d.getDay(), windows: pattern.windows });
  }
  return out;
}

/** Format "HH:MM" 24h as a friendly pill label, e.g. "7:30a" / "4:30p". */
export function formatWindowLabel(window: StaffingWindow): string {
  const fmt = (hhmm: string): string => {
    const m = TIME_RE.exec(hhmm);
    if (!m) return hhmm;
    let h = Number(m[1]);
    const min = m[2];
    const suffix = h < 12 ? "a" : "p";
    h = h % 12 === 0 ? 12 : h % 12;
    return `${h}:${min}${suffix}`;
  };
  return `${fmt(window.start)}\u2013${fmt(window.end)}`;
}

export const STAFFING_DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/* ------------------------------------------------------------------ */
/* HR-PHASE2 (2026-09-16): PTO accruals, overtime rules, shift swaps.  */
/*                                                                      */
/* Accruals: an HrAccrualPolicy grants hoursPerPeriod per pay period to  */
/* staff whose tenure falls in a band; the hr_accrual_ledger records     */
/* accruals/usage/adjustments as running-balance entries, so the         */
/* current balance is always the latest entry — no recomputation from   */
/* history is ever needed. Time-off requests for pto/sick debit the     */
/* ledger on approval and post a restoring adjustment when an approval   */
/* is later reversed.                                                   */
/*                                                                      */
/* Overtime rules are per-agency (one row). summarizeTimecard layers     */
/* daily, 7th-day, and weekly OT without double-counting; see its docs.  */
/*                                                                      */
/* Shift swaps: a requester posts an offered shift, optionally aimed at  */
/* one staffer (targetStaffId) or open; a claimer claims it, optionally  */
/* counter-offering one of their own shifts. Approving reassigns the     */
/* shifts through the store's shift-update path.                         */
/* ------------------------------------------------------------------ */

export type LeaveType = "vacation" | "pto" | "sick";

export interface AccrualTenureBand {
  minYears: number;
  /** null = no upper bound. */
  maxYears: number | null;
  hoursPerPeriod: number;
}

export interface HrAccrualPolicy {
  id: string;
  agencyId: string;
  leaveType: LeaveType;
  tenureBands: AccrualTenureBand[];
  carryoverCapHours: number;
  carryoverBasis: "calendar_year" | "anniversary";
  effectiveFrom: string;
  /** null = open-ended. */
  effectiveTo: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AccrualPolicyInput = Pick<
  HrAccrualPolicy,
  | "leaveType"
  | "tenureBands"
  | "carryoverCapHours"
  | "carryoverBasis"
  | "effectiveFrom"
  | "effectiveTo"
>;

export interface HrAccrualLedgerEntry {
  id: string;
  agencyId: string;
  staffId: string;
  payPeriodId: string | null;
  /** YYYY-MM-DD the entry belongs to. */
  periodStart: string;
  leaveType: LeaveType;
  accrued: number;
  used: number;
  adjustment: number;
  /** Running balance AFTER this entry: prev + accrued - used + adjustment. */
  balance: number;
  note: string | null;
  createdAt: string;
}

export type LedgerEntryInput = Pick<HrAccrualLedgerEntry, "staffId" | "leaveType"> &
  Partial<
    Pick<
      HrAccrualLedgerEntry,
      "payPeriodId" | "periodStart" | "accrued" | "used" | "adjustment" | "note"
    >
  >;

export interface HrOvertimeRules {
  agencyId: string;
  weeklyThresholdHours: number;
  /** null = no daily overtime rule. */
  dailyThresholdHours: number | null;
  seventhConsecutiveDay: boolean;
  seventhDayThresholdHours: number;
  updatedBy: string | null;
  updatedAt: string;
}

export type OvertimeRulesInput = Pick<
  HrOvertimeRules,
  | "weeklyThresholdHours"
  | "dailyThresholdHours"
  | "seventhConsecutiveDay"
  | "seventhDayThresholdHours"
>;

/** Agency default when no overtime-rules row exists (FLSA weekly standard). */
export const DEFAULT_OVERTIME_RULES: Omit<
  HrOvertimeRules,
  "agencyId" | "updatedBy" | "updatedAt"
> = {
  weeklyThresholdHours: 40,
  dailyThresholdHours: null,
  seventhConsecutiveDay: false,
  seventhDayThresholdHours: 8,
};

export type ShiftSwapStatus = "pending" | "approved" | "denied" | "cancelled";

export interface HrShiftSwap {
  id: string;
  agencyId: string;
  requesterId: string;
  offeredShiftId: string;
  /** Counter-offered shift, or null for an open claim. */
  requestedShiftId: string | null;
  /** The claimer once claimed, or the direct target when created. */
  targetStaffId: string | null;
  status: ShiftSwapStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ShiftSwapInput = Pick<HrShiftSwap, "offeredShiftId"> &
  Partial<Pick<HrShiftSwap, "requestedShiftId" | "targetStaffId">>;

/**
 * Completed full years of service as of a YYYY-MM-DD date. Floors to whole
 * years (anniversary not yet reached doesn't count); never negative.
 * Unparseable dates yield 0 rather than NaN.
 */
export function yearsOfService(hireDate: string, asOf: string): number {
  const hire = hireDate.slice(0, 10).split("-").map(Number);
  const ref = asOf.slice(0, 10).split("-").map(Number);
  if (
    hire.length !== 3 ||
    ref.length !== 3 ||
    hire.some((n) => !Number.isFinite(n)) ||
    ref.some((n) => !Number.isFinite(n))
  ) {
    return 0;
  }
  let years = ref[0] - hire[0];
  if (ref[1] < hire[1] || (ref[1] === hire[1] && ref[2] < hire[2])) {
    years -= 1;
  }
  return Math.max(0, years);
}

/**
 * Validate an accrual-policy form. Returns error messages; empty = valid.
 * Bands must be sorted by minYears, non-overlapping (a band's interval is
 * [minYears, maxYears), null max = infinity), minYears >= 0,
 * hoursPerPeriod >= 0.
 */
export function validateAccrualPolicy(input: AccrualPolicyInput): string[] {
  const errors: string[] = [];
  if (!["vacation", "pto", "sick"].includes(input.leaveType)) {
    errors.push("Choose a leave type (vacation, pto, or sick).");
  }
  if (input.tenureBands.length === 0) {
    errors.push("Add at least one tenure band.");
  }
  input.tenureBands.forEach((band, i) => {
    const label = `Band ${i + 1}`;
    if (!Number.isFinite(band.minYears) || band.minYears < 0) {
      errors.push(`${label}: minimum years must be 0 or more.`);
    }
    if (!Number.isFinite(band.hoursPerPeriod) || band.hoursPerPeriod < 0) {
      errors.push(`${label}: hours per period must be 0 or more.`);
    }
    if (
      band.maxYears !== null &&
      (!Number.isFinite(band.maxYears) || band.maxYears <= band.minYears)
    ) {
      errors.push(`${label}: maximum years must be above minimum years.`);
    }
  });
  for (let i = 1; i < input.tenureBands.length; i++) {
    if (input.tenureBands[i].minYears < input.tenureBands[i - 1].minYears) {
      errors.push("Tenure bands must be sorted by minimum years.");
      break;
    }
  }
  for (let i = 1; i < input.tenureBands.length; i++) {
    const prev = input.tenureBands[i - 1];
    if (prev.maxYears === null || prev.maxYears > input.tenureBands[i].minYears) {
      errors.push(`Band ${i} overlaps band ${i + 1}.`);
    }
  }
  if (!Number.isFinite(input.carryoverCapHours) || input.carryoverCapHours < 0) {
    errors.push("Carryover cap must be 0 hours or more.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
    errors.push("Choose a valid effective-from date.");
  }
  if (
    input.effectiveTo !== null &&
    input.effectiveTo !== "" &&
    input.effectiveTo < input.effectiveFrom
  ) {
    errors.push("The end date cannot be before the start date.");
  }
  return errors;
}

/**
 * Hours-per-period for a staff member with the given completed years of
 * service. First band whose [minYears, maxYears) contains the tenure wins;
 * 0 when no band matches.
 */
export function accrualRateForTenure(
  policy: Pick<HrAccrualPolicy, "tenureBands">,
  years: number,
): number {
  for (const band of policy.tenureBands) {
    if (years >= band.minYears && (band.maxYears === null || years < band.maxYears)) {
      return band.hoursPerPeriod;
    }
  }
  return 0;
}

/**
 * Hours accrued for one pay period under a policy. One rate per pay period:
 * the rate for the staff member's tenure band, earned in full each period.
 */
export function accruedHoursForPeriod(
  policy: Pick<HrAccrualPolicy, "tenureBands">,
  years: number,
): number {
  return accrualRateForTenure(policy, years);
}

/**
 * Split a year-end balance into carried and forfeited hours under a
 * carryover cap. Negative balances carry nothing and forfeit nothing.
 */
export function applyCarryover(
  balance: number,
  capHours: number,
): { carried: number; forfeited: number } {
  const positive = Math.max(0, balance);
  const carried = Math.min(positive, Math.max(0, capHours));
  return { carried, forfeited: positive - carried };
}

/**
 * Current leave balance = the balance of the latest ledger entry for that
 * leave type (ordered by periodStart, then createdAt); 0 when no entries.
 */
export function currentLeaveBalance(
  entries: HrAccrualLedgerEntry[],
  leaveType: LeaveType,
): number {
  let latest: HrAccrualLedgerEntry | null = null;
  for (const entry of entries) {
    if (entry.leaveType !== leaveType) continue;
    if (
      latest === null ||
      entry.periodStart > latest.periodStart ||
      (entry.periodStart === latest.periodStart &&
        entry.createdAt > latest.createdAt)
    ) {
      latest = entry;
    }
  }
  return latest ? latest.balance : 0;
}

/**
 * Hours a time-off request consumes: inclusive calendar days × hoursPerDay
 * (default 8). Throws on an unparseable or inverted date range.
 */
export function timeOffRequestHours(
  startsOn: string,
  endsOn: string,
  hoursPerDay = 8,
): number {
  const start = new Date(`${startsOn}T00:00:00`);
  const end = new Date(`${endsOn}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid time-off date range.");
  }
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (days < 1) {
    throw new Error("The end date cannot be before the start date.");
  }
  return days * hoursPerDay;
}

/**
 * Check a time-off request against the leave balance. Blocks (ok: false)
 * when the request exceeds the balance; warns when the request would leave
 * fewer than 8 hours. Messages are user-facing.
 */
export function validateTimeOffBalance(
  requestHours: number,
  balance: number,
  leaveType: LeaveType,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (requestHours - balance > 1e-9) {
    errors.push(
      `Not enough ${leaveType} balance: this request needs ${requestHours}h but only ${balance}h is available.`,
    );
  } else {
    const remaining = Math.round((balance - requestHours) * 100) / 100;
    if (remaining < 8) {
      warnings.push(
        `Only ${remaining}h of ${leaveType} will remain after this request.`,
      );
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------ shift swaps ----------------------------- */

function shiftsOverlap(a: HrShift, b: HrShift): boolean {
  return (
    parseTime(a.startsAt) < parseTime(b.endsAt) &&
    parseTime(b.startsAt) < parseTime(a.endsAt)
  );
}

export interface ValidateShiftSwapInput {
  offeredShift: HrShift;
  requesterId: string;
  /** The requester's other shifts (the offered shift is skipped by id). */
  requesterShifts: HrShift[];
  claimerId: string;
  claimerShifts: HrShift[];
  /** The shift the claimer counter-offers, when this is a two-shift swap. */
  claimedShift?: HrShift | null;
  nowIso: string;
}

/**
 * Guard a shift swap. Returns error messages; empty = the swap may proceed.
 * Errors when the offered shift has already started, the claimer is the
 * requester themselves, the offered shift overlaps any of the claimer's
 * shifts, or the counter-offered shift overlaps any of the requester's other
 * shifts. Messages are user-facing.
 */
export function validateShiftSwap(input: ValidateShiftSwapInput): string[] {
  const errors: string[] = [];
  if (parseTime(input.offeredShift.startsAt) <= parseTime(input.nowIso)) {
    errors.push("This shift has already started and can no longer be swapped.");
  }
  if (input.claimerId === input.requesterId) {
    errors.push("You can't claim your own shift-swap posting.");
  }
  for (const shift of input.claimerShifts) {
    if (shift.id !== input.offeredShift.id && shiftsOverlap(input.offeredShift, shift)) {
      errors.push("The offered shift overlaps a shift the other person is already working.");
      break;
    }
  }
  if (input.claimedShift) {
    for (const shift of input.requesterShifts) {
      if (shift.id === input.claimedShift.id || shift.id === input.offeredShift.id) {
        continue;
      }
      if (shiftsOverlap(input.claimedShift, shift)) {
        errors.push("The counter-offered shift overlaps a shift you're already working.");
        break;
      }
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* HR-KIOSK (2026-09-16): kiosk time clock.                            */
/*                                                                      */
/* Entities map 1:1 to the 20260916140000_hr_kiosk_timeclock migration. */
/* Interface contracts mirror the DB columns minus secrets: kiosk       */
/* tokens carry neither the raw token nor its hash; credentials carry   */
/* no PIN hash (PINs are verified server-side through                   */
/* public.verify_kiosk_pin only).                                       */
/*                                                                      */
/* Pairing note: "break_in", "break_out", and "transfer" punches are    */
/* timeline events. analyzePunches (above) skips them entirely, so a    */
/* transfer logged between an "in" and an "out" never breaks pairing.   */
/* ------------------------------------------------------------------ */

export interface HrKioskToken {
  id: string;
  agencyId: string;
  siteId: string;
  label: string | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface HrClockCredential {
  staffId: string;
  agencyId: string;
  employeeIdNumber: string;
  failedAttempts: number;
  lockedUntil: string | null;
  pinUpdatedAt: string | null;
  updatedBy: string | null;
}

export interface HrPunchRules {
  agencyId: string;
  /** 0 = rounding off. */
  roundingMinutes: number;
  roundingApplies: "payroll" | "display_and_payroll";
  graceMinutes: number;
  autoClockoutBufferMinutes: number;
  autoApprovalScoreThreshold: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface HrMissedPunchReport {
  id: string;
  agencyId: string;
  staffId: string;
  siteId: string | null;
  workDate: string;
  claimedInAt: string | null;
  claimedOutAt: string | null;
  reason: string;
  status: "pending" | "approved" | "denied";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

/** Mirrors the jsonb returned by public.verify_kiosk_pin. */
export interface KioskVerifyResult {
  ok: boolean;
  reason?: "bad_token" | "bad_pin" | "locked";
  staffId?: string;
  displayName?: string | null;
  attemptsLeft?: number | null;
  lockedUntil?: string | null;
}

/** Agency defaults when no hr_punch_rules row exists. */
export const DEFAULT_PUNCH_RULES: Omit<
  HrPunchRules,
  "agencyId" | "updatedBy" | "updatedAt"
> = {
  roundingMinutes: 0,
  roundingApplies: "payroll",
  graceMinutes: 5,
  autoClockoutBufferMinutes: 30,
  autoApprovalScoreThreshold: 90,
};

/**
 * Round a punch timestamp to the nearest rounding_minutes bucket.
 * A rounding_minutes of 0 (or missing/invalid) means rounding is OFF: the
 * input is returned unchanged. Ties round up (half-up on the minute grid).
 * Returns an ISO instant; invalid input is returned unchanged rather than
 * throwing, so a bad row can't break a timecard summary.
 */
export function applyPunchRounding(
  punchedAt: string,
  rules: Pick<HrPunchRules, "roundingMinutes">,
): string {
  const minutes = rules?.roundingMinutes ?? 0;
  if (!Number.isFinite(minutes) || minutes <= 0) return punchedAt;
  const ms = parseTime(punchedAt);
  if (Number.isNaN(ms)) return punchedAt;
  const roundedMs = Math.round(ms / (minutes * MS_PER_MINUTE)) * minutes * MS_PER_MINUTE;
  return new Date(roundedMs).toISOString();
}

/**
 * True when a punch falls within +/- graceMinutes of the scheduled instant.
 * Boundary: exactly at the grace edge counts as within grace (grace is a
 * tolerance, not a cliff). NaN inputs yield false.
 */
export function isWithinGrace(
  punchedAt: string,
  scheduledAt: string,
  graceMinutes: number,
): boolean {
  if (!Number.isFinite(graceMinutes) || graceMinutes < 0) return false;
  const delta = parseTime(punchedAt) - parseTime(scheduledAt);
  return Number.isFinite(delta) && Math.abs(delta) <= graceMinutes * MS_PER_MINUTE;
}

/* ------------------------- kiosk exception detection ------------------------ */

export type KioskExceptionFlag =
  | "late"
  | "early"
  | "missed_punch"
  | "offline"
  | "overtime_trending"
  | "auto_clockout";

export interface KioskPunchException {
  staffId: string;
  /** The flagged punch; null for day-level flags (overtime_trending). */
  punchId: string | null;
  /** YYYY-MM-DD work date (clock-in date, or the shift's date for day rows). */
  date: string;
  flags: KioskExceptionFlag[];
  detail: string;
}

/**
 * Schedule vs actual minutes per staff-day, attributing each segment to the
 * published shift findPublishedShiftForPunch matched to its clock-in (the
 * same attribution detectPunchExceptions uses for late/early flags).
 * Only CLOSED segments participate: open punches have no known duration,
 * so they contribute no actual minutes and no variance signal.
 * Unmatched shifts/segments are skipped.
 */
function staffDayScheduleVsActual(
  punches: HrPunch[],
  shifts: HrShift[],
): Map<string, { scheduled: number; actual: number }> {
  const byStaffDay = new Map<string, { scheduled: number; actual: number }>();
  const cell = (key: string): { scheduled: number; actual: number } => {
    let row = byStaffDay.get(key);
    if (!row) {
      row = { scheduled: 0, actual: 0 };
      byStaffDay.set(key, row);
    }
    return row;
  };
  for (const segment of analyzePunches(punches).segments) {
    // Open segments carry no actual minutes AND no variance signal: with the
    // clock-out unknown, |actual - scheduled| would punish every missed
    // punch twice (the missed_punch / auto_clockout flags already cover it).
    if (segment.out === null) continue;
    const shift = findPublishedShiftForPunch(segment.in, shifts);
    if (shift !== null) {
      const minutes = Math.max(
        0,
        Math.round(
          (parseTime(shift.endsAt) - parseTime(shift.startsAt)) / MS_PER_MINUTE,
        ),
      );
      cell(`${segment.in.staffId}|${dateKeyOf(shift.startsAt)}`).scheduled += minutes;
    }
    cell(`${segment.in.staffId}|${dateKeyOf(segment.in.punchedAt)}`).actual +=
      minutesBetween(segment.in.punchedAt, segment.out.punchedAt);
  }
  return byStaffDay;
}

/**
 * Kiosk-era exception scan. Rows are keyed per punch (punchId set) or per
 * staff-day (punchId null); one punch can carry several flags — flags are
 * independent signals, not exclusive states.
 *
 * Rules (all pure/deterministic on the inputs):
 *  - offline: punch.offline is true (any kind) — recorded off-network,
 *    queued for manager review.
 *  - late: clock-in after shift start + rules.graceMinutes, anchored to the
 *    published shift that findPublishedShiftForPunch attributes the punch
 *    to. Draft/cancelled shifts never anchor (same rule as
 *    detectExceptions).
 *  - early: clock-out before shift end - rules.graceMinutes.
 *  - missed_punch: open "in" whose published shift ended more than
 *    MISSED_PUNCH_GRACE_MINUTES (15) ago — needs the published shift; an
 *    open punch with no matching shift is left for manual review.
 *  - auto_clockout: open "in" still open past shift end +
 *    rules.autoClockoutBufferMinutes — the app would auto-close it there.
 *    (A punch past the buffer also carries missed_punch: one is the
 *    policy signal, the other the pending automation.)
 *  - overtime_trending: day-level. Actual paired minutes for the staff-day
 *    exceed the published scheduled minutes for that staff-day — the shift
 *    is running into overtime territory. Open segments contribute 0.
 *
 * patterns is accepted for API parity with the kiosk workstream and is
 * reserved for future pattern-vs-actual detection; it is not read here.
 */
export function detectPunchExceptions(
  punches: HrPunch[],
  shifts: HrShift[],
  patterns: HrStaffingPattern[],
  rules: HrPunchRules,
  nowIso: string,
): KioskPunchException[] {
  void patterns; // reserved: expected-time windows come from patterns in v2
  const graceMs = Math.max(0, rules.graceMinutes ?? 0) * MS_PER_MINUTE;
  const now = parseTime(nowIso);
  const rows = new Map<string, KioskPunchException>();

  const flag = (
    staffId: string,
    punchId: string | null,
    date: string,
    kind: KioskExceptionFlag,
    detail: string,
  ): void => {
    const key = punchId ?? `day:${staffId}:${date}`;
    const existing = rows.get(key);
    if (existing) {
      if (!existing.flags.includes(kind)) existing.flags.push(kind);
      return;
    }
    rows.set(key, { staffId, punchId, date, flags: [kind], detail });
  };

  // Per-punch flags (independent of pairing).
  for (const punch of punches) {
    const date = dateKeyOf(punch.punchedAt);
    if (punch.offline === true) {
      flag(
        punch.staffId,
        punch.id,
        date,
        "offline",
        `Punch at ${fmtTime(punch.punchedAt)} was recorded offline — queued for manager review.`,
      );
    }
  }

  const { segments } = analyzePunches(punches);

  for (const segment of segments) {
    const staffId = segment.in.staffId;
    const shift = findPublishedShiftForPunch(segment.in, shifts);
    if (shift !== null) {
      const startMs = parseTime(shift.startsAt);
      const endMs = parseTime(shift.endsAt);
      const inMs = parseTime(segment.in.punchedAt);
      if (inMs > startMs + graceMs) {
        const lateMin = Math.round((inMs - startMs) / MS_PER_MINUTE);
        flag(
          staffId,
          segment.in.id,
          dateKeyOf(segment.in.punchedAt),
          "late",
          `Clocked in ${lateMin} minute${lateMin === 1 ? "" : "s"} after the ${fmtTime(shift.startsAt)} shift start (grace ${rules.graceMinutes}).`,
        );
      }
      if (segment.out !== null) {
        const outMs = parseTime(segment.out.punchedAt);
        if (outMs < endMs - graceMs) {
          const earlyMin = Math.round((endMs - outMs) / MS_PER_MINUTE);
          flag(
            staffId,
            segment.out.id,
            dateKeyOf(segment.out.punchedAt),
            "early",
            `Clocked out ${earlyMin} minute${earlyMin === 1 ? "" : "s"} before the ${fmtTime(shift.endsAt)} shift end (grace ${rules.graceMinutes}).`,
          );
        }
      } else {
        if (now > endMs + MISSED_PUNCH_GRACE_MINUTES * MS_PER_MINUTE) {
          flag(
            staffId,
            segment.in.id,
            dateKeyOf(segment.in.punchedAt),
            "missed_punch",
            `Clocked in at ${fmtTime(segment.in.punchedAt)} for the shift ending ${fmtTime(shift.endsAt)} but never clocked out.`,
          );
        }
        const bufferMs =
          Math.max(0, rules.autoClockoutBufferMinutes ?? 0) * MS_PER_MINUTE;
        if (now > endMs + bufferMs) {
          flag(
            staffId,
            segment.in.id,
            dateKeyOf(segment.in.punchedAt),
            "auto_clockout",
            `Still clocked in past the ${fmtTime(shift.endsAt)} shift end plus the ${rules.autoClockoutBufferMinutes}-minute auto clock-out buffer.`,
          );
        }
      }
    }
  }

  // Day-level: overtime trending — worked more than scheduled. Same
  // attribution helper as scoreTimecard's variance so both agree.
  for (const [key, row] of staffDayScheduleVsActual(punches, shifts)) {
    if (row.actual > row.scheduled) {
      const [overtimeStaffId, overtimeDate] = key.split("|");
      flag(
        overtimeStaffId,
        null,
        overtimeDate,
        "overtime_trending",
        `Worked ${row.actual} minutes on ${overtimeDate} against ${row.scheduled} scheduled — into overtime territory.`,
      );
    }
  }

  return [...rows.values()].sort((a, b) =>
    a.date < b.date
      ? -1
      : a.date > b.date
        ? 1
        : (a.punchId ?? "") < (b.punchId ?? "")
          ? -1
          : 1,
  );
}

/* ------------------------------ timecard score ----------------------------- */

/** Penalty per kiosk exception flag; missed punches cost the most. */
const KIOSK_FLAG_PENALTIES: Record<KioskExceptionFlag, number> = {
  missed_punch: 15,
  auto_clockout: 10,
  late: 5,
  early: 5,
  overtime_trending: 8,
  offline: 3,
};

const KIOSK_VARIANCE_CAP_PER_DAY = 15;

/**
 * 0–100 timecard score. Formula:
 *   score = clamp(100 - flag penalties - variance penalty, 0, 100)
 * where flag penalties are the KIOSK_FLAG_PENALTIES above (summed over every
 * flag row from detectPunchExceptions — a punch with two flags pays twice),
 * and the variance penalty is per staff-day: |actual - scheduled| minutes
 * beyond rules.graceMinutes cost 1 point per full 10 minutes, capped at
 * KIOSK_VARIANCE_CAP_PER_DAY (15) per staff-day.
 *
 * A score >= rules.autoApprovalScoreThreshold is eligible for auto-approval
 * (the app decides; this function only scores). Without nowIso, "now" is
 * the latest punch time — open-punch checks (missed/auto-clockout) only
 * fire relative to data the caller actually passed in.
 */
export function scoreTimecard(
  punches: HrPunch[],
  shifts: HrShift[],
  rules: HrPunchRules,
  nowIso?: string,
): number {
  const effectiveNow =
    nowIso ??
    (punches.length === 0
      ? "1970-01-01T00:00:00.000Z"
      : punches.reduce((a, b) => (a.punchedAt > b.punchedAt ? a : b)).punchedAt);
  let penalty = 0;

  for (const row of detectPunchExceptions(punches, shifts, [], rules, effectiveNow)) {
    for (const kind of row.flags) penalty += KIOSK_FLAG_PENALTIES[kind];
  }

  // Schedule variance per staff-day (published shifts only; paired minutes
  // by clock-in date — the night-shift rule). Same attribution as the
  // overtime_trending flag so the score and the exception feed agree.
  for (const [, row] of staffDayScheduleVsActual(punches, shifts)) {
    const overage = Math.max(
      0,
      Math.abs(row.actual - row.scheduled) - (rules.graceMinutes ?? 0),
    );
    penalty += Math.min(KIOSK_VARIANCE_CAP_PER_DAY, Math.floor(overage / 10));
  }

  return Math.max(0, Math.min(100, 100 - penalty));
}

/* --------------------------- scheduled vs actual --------------------------- */

export interface ScheduledVsActualDay {
  /** YYYY-MM-DD. */
  date: string;
  scheduledMinutes: number;
  actualMinutes: number;
  /** actual - scheduled (negative = under-scheduled hours worked). */
  varianceMinutes: number;
}

/**
 * Per-day scheduled vs worked minutes. Scheduled counts published shifts
 * only (draft/cancelled shifts are not commitments); worked counts paired
 * in/out minutes attributed to the clock-in date (night-shift rule). Open
 * segments contribute 0. Dates are the union of shift-start dates and
 * clock-in dates, sorted ascending.
 */
export function scheduledVsActual(
  shifts: HrShift[],
  punches: HrPunch[],
): ScheduledVsActualDay[] {
  const byDate = new Map<string, { scheduled: number; actual: number }>();
  const cell = (date: string): { scheduled: number; actual: number } => {
    let row = byDate.get(date);
    if (!row) {
      row = { scheduled: 0, actual: 0 };
      byDate.set(date, row);
    }
    return row;
  };

  for (const shift of shifts) {
    if (shift.status !== "published") continue;
    cell(dateKeyOf(shift.startsAt)).scheduled += Math.max(
      0,
      Math.round((parseTime(shift.endsAt) - parseTime(shift.startsAt)) / MS_PER_MINUTE),
    );
  }
  for (const segment of pairPunches(punches)) {
    cell(dateKeyOf(segment.clockIn)).actual += segment.minutes;
  }

  return [...byDate.entries()]
    .map(([date, row]) => ({
      date,
      scheduledMinutes: row.scheduled,
      actualMinutes: row.actual,
      varianceMinutes: row.actual - row.scheduled,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* --------------------------- auto clock-out -------------------------------- */

export interface AutoClockoutCandidate {
  punch: HrPunch;
  shift: HrShift;
  /** The time the app would auto-clock the staff out (the shift end). */
  clockOutAt: string;
}

/**
 * Open "in" punches the app should auto-clock out: the punch's published
 * shift ended more than rules.autoClockoutBufferMinutes ago. The caller
 * passes only the still-open "in" punches (via openInPunch-style filtering).
 * Punches with no matching published shift are skipped — the app leaves
 * them for manual review rather than guessing the shift.
 */
export function findAutoClockoutCandidates(
  openPunches: HrPunch[],
  shifts: HrShift[],
  rules: Pick<HrPunchRules, "autoClockoutBufferMinutes">,
  nowIso: string,
): AutoClockoutCandidate[] {
  const now = parseTime(nowIso);
  const bufferMs =
    Math.max(0, rules.autoClockoutBufferMinutes ?? 0) * MS_PER_MINUTE;
  const candidates: AutoClockoutCandidate[] = [];
  for (const punch of openPunches) {
    if (punch.kind !== "in") continue;
    const shift = findPublishedShiftForPunch(punch, shifts);
    if (shift === null) continue;
    if (now > parseTime(shift.endsAt) + bufferMs) {
      candidates.push({ punch, shift, clockOutAt: shift.endsAt });
    }
  }
  candidates.sort((a, b) =>
    a.punch.punchedAt < b.punch.punchedAt
      ? -1
      : a.punch.punchedAt > b.punch.punchedAt
        ? 1
        : 0,
  );
  return candidates;
}

/* ------------------------- missed-punch validation ------------------------- */

export interface MissedPunchReportInput {
  /** YYYY-MM-DD the missed punch belongs to. */
  workDate: string;
  claimedInAt: string | null;
  claimedOutAt: string | null;
  reason: string;
  nowIso: string;
}

/**
 * Validate a staff-submitted missed-punch report. Returns error messages;
 * empty = the report may be filed. Rules:
 *  - a clock-in time, a clock-out time, or both must be present;
 *  - the reason must not be empty;
 *  - claimed times must parse, must not be in the future, and must fall on
 *    the work date (the clock-out may roll to the next day for night
 *    shifts);
 *  - when both are present, the clock-out must be after the clock-in.
 * Messages are user-facing.
 */
export function validateMissedPunchReport(
  input: MissedPunchReportInput,
): string[] {
  const errors: string[] = [];
  if (input.claimedInAt === null && input.claimedOutAt === null) {
    errors.push("Enter a clock-in time, a clock-out time, or both.");
  }
  if (input.reason.trim().length === 0) {
    errors.push("Tell us what happened so the manager can review it.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) {
    errors.push("Choose a valid work date.");
    return errors; // without a valid work date the day checks can't run
  }
  const now = parseTime(input.nowIso);
  const nextDay = addDaysIso(`${input.workDate}T00:00:00`, 1).slice(0, 10);

  const checkClaimed = (
    label: string,
    iso: string | null,
    allowNextDay: boolean,
  ): void => {
    if (iso === null) return;
    const ms = parseTime(iso);
    if (Number.isNaN(ms)) {
      errors.push(`${label} is not a valid time.`);
      return;
    }
    if (ms > now) {
      errors.push(`${label} is in the future — claim the time you actually worked.`);
      return;
    }
    const day = dateKeyOf(iso);
    const onWorkDate = day === input.workDate;
    const onNextDay = allowNextDay && day === nextDay;
    if (!onWorkDate && !onNextDay) {
      errors.push(`${label} must fall on ${input.workDate}${allowNextDay ? " (or the following day for a night shift)" : ""}.`);
    }
  };

  checkClaimed("The clock-in", input.claimedInAt, false);
  checkClaimed("The clock-out", input.claimedOutAt, true);

  if (input.claimedInAt !== null && input.claimedOutAt !== null) {
    const inMs = parseTime(input.claimedInAt);
    const outMs = parseTime(input.claimedOutAt);
    if (Number.isFinite(inMs) && Number.isFinite(outMs) && outMs <= inMs) {
      errors.push("The clock-out must be after the clock-in.");
    }
  }
  return errors;
}
