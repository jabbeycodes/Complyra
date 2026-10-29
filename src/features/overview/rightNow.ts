/**
 * rightNow.ts — pure aggregation for the manager "Right Now" strip.
 *
 * The component (RightNowStrip.tsx) fetches raw rows through the existing
 * stores and hands them here; every judgment — who counts as clocked in,
 * who is late, what "out today" means for a partial day — lives in this
 * pure function so it is unit-testable without a store or a clock.
 *
 * Time model (mirrors hr.ts): timestamps are agency wall-clock strings.
 * `today` is the America/Chicago calendar date (YYYY-MM-DD) computed by
 * the caller; a timestamp's agency date is the date written in the stamp
 * for naive strings, or the Chicago date for offset/Z stamps.
 *
 * Scoping rule: the caller passes ONLY the site ids the viewer may see
 * (house manager → their home; program manager / administrator → the
 * Overview focus). Every segment additionally requires the record (or its
 * staff member's home) to sit inside that scope, so a row that arrives
 * over-broad from a store is dropped here rather than displayed.
 */

import type {
  HrMissedPunchReport,
  HrPunch,
  HrPunchCorrection,
  HrShift,
  HrTimeOffRequest,
  LeaveType,
} from "../../data/hr";
import type { HrOpenShift } from "../../data/openShifts";

export const RIGHT_NOW_TIMEZONE = "America/Chicago";

/** Leave-type labels, mirrored from the Employee Hub (LEAVE_TYPE_LABELS). */
export const RIGHT_NOW_LEAVE_LABELS: Record<LeaveType, string> = {
  vacation: "Vacation",
  pto: "Earned Time Off",
  sick: "Sick",
  bereavement: "Bereavement",
  unpaid: "Unpaid",
};

export interface RightNowStaff {
  userId: string;
  fullName: string;
  siteId: string | null;
}

export interface RightNowInputs {
  /** Current instant (ISO). */
  nowIso: string;
  /** America/Chicago calendar date, YYYY-MM-DD. */
  today: string;
  /** Site ids the viewer is scoped to for this render. */
  siteIds: string[];
  /** Agency staff visible to the viewer (names + home sites). */
  staff: RightNowStaff[];
  /** Open "in" punches (store's listOpenPunches) for the scoped sites. */
  openPunches: HrPunch[];
  /** Every punch recorded today for staff who have a shift or an open punch. */
  punchesToday: HrPunch[];
  /** Shifts whose start falls on `today` (any site; helper re-scopes). */
  shiftsToday: HrShift[];
  /** All time-off requests (helper filters by status/scope). */
  timeOff: HrTimeOffRequest[];
  /** All punch corrections (helper filters pending + scope). */
  corrections: HrPunchCorrection[];
  /** All missed-punch reports (helper filters pending + scope). */
  missedReports: HrMissedPunchReport[];
  /** All open-board postings (helper filters open + today + scope). */
  openShifts: HrOpenShift[];
  /** Decision gates — mirror the Employee Hub's own tab permissions. */
  canApproveTimeOff: boolean;
  canReviewTimecards: boolean;
  canViewTeam: boolean;
}

export interface ClockedInEntry {
  staffId: string;
  name: string;
  siteId: string | null;
  /** ISO of the open clock-in punch. */
  clockInAt: string;
  /** Latest punch is an unmatched break_in. */
  onBreak: boolean;
}

export interface NotArrivedEntry {
  staffId: string;
  name: string;
  siteId: string | null;
  shiftId: string;
  /** ISO the shift started. */
  shiftStartAt: string;
}

export interface OutTodayEntry {
  staffId: string;
  name: string;
  leaveLabel: string;
  /** True when today's approved hours cover less than a full day. */
  partial: boolean;
  /** Approved hours for today (0 when the request carries no day rows). */
  hours: number;
}

export interface OpenShiftEntry {
  id: string;
  siteId: string;
  /** "7:00 AM – 3:00 PM" style window for today. */
  windowLabel: string;
  slotsLeft: number;
}

export interface RightNowModel {
  clockedIn: ClockedInEntry[];
  notArrived: NotArrivedEntry[];
  outToday: OutTodayEntry[];
  openShiftsToday: OpenShiftEntry[];
  decisions: {
    timeOff: number;
    corrections: number;
    missedPunches: number;
    total: number;
  };
  /** Every segment empty AND nothing awaiting a decision. */
  allClear: boolean;
}

/** A standard full day of leave, in hours (partial-day threshold). */
export const FULL_DAY_HOURS = 8;

/** The Chicago calendar date (YYYY-MM-DD) for an instant. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RIGHT_NOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The agency calendar date a timestamp belongs to: the written date for
 * naive wall-clock stamps; the Chicago date for stamps with an offset.
 */
export function agencyDateOf(iso: string): string {
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso.trim())) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return chicagoToday(d);
  }
  return iso.slice(0, 10);
}

/** "7:00 AM" style clock label for a wall-clock stamp. */
export function clockLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2:30 PM" style label for an "HH:MM" window bound (open-shift postings). */
export function hhmmLabel(value: string | null): string {
  if (!value || !/^\d{1,2}:\d{2}/.test(value)) return "—";
  const [h, m] = value.split(":").map(Number);
  const mer = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${mer}`;
}

function hoursBetween(startsAt: string, endsAt: string): number {
  const ms = Date.parse(endsAt) - Date.parse(startsAt);
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0;
}

/** Approved hours a request takes on `today`, or null when it doesn't cover today. */
function approvedHoursOn(req: HrTimeOffRequest, today: string): number | null {
  if (req.status !== "approved") return null;
  const day = req.days.find((d) => d.date === today);
  if (day) return day.hours;
  // Requests written before per-day rows existed: fall back to the range.
  if (req.days.length === 0 && req.startsOn <= today && today <= req.endsOn) {
    return FULL_DAY_HOURS;
  }
  return null;
}

/** True when the staffer's latest open-session punch is an unmatched break_in. */
function isOnBreak(staffPunches: HrPunch[]): boolean {
  const sorted = [...staffPunches].sort((a, b) =>
    a.punchedAt < b.punchedAt ? -1 : a.punchedAt > b.punchedAt ? 1 : 0,
  );
  let onBreak = false;
  for (const p of sorted) {
    if (p.kind === "in" || p.kind === "out") onBreak = false;
    else if (p.kind === "break_in") onBreak = true;
    else if (p.kind === "break_out") onBreak = false;
  }
  return onBreak;
}

export function buildRightNowModel(inputs: RightNowInputs): RightNowModel {
  const scope = new Set(inputs.siteIds);
  const staffById = new Map(inputs.staff.map((s) => [s.userId, s]));
  const nameOf = (staffId: string) => staffById.get(staffId)?.fullName ?? null;
  /** Record belongs to scope via its own site or its staffer's home site. */
  const inScope = (siteId: string | null, staffId: string): boolean => {
    if (siteId && scope.has(siteId)) return true;
    const home = staffById.get(staffId)?.siteId ?? null;
    return home !== null && scope.has(home);
  };

  /* ------------------------- Clocked in now ------------------------- */
  const punchesByStaff = new Map<string, HrPunch[]>();
  for (const p of inputs.punchesToday) {
    const list = punchesByStaff.get(p.staffId) ?? [];
    list.push(p);
    punchesByStaff.set(p.staffId, list);
  }
  const clockedIn: ClockedInEntry[] = [];
  const seenClocked = new Set<string>();
  for (const punch of inputs.openPunches) {
    if (punch.kind !== "in") continue;
    if (!punch.siteId || !scope.has(punch.siteId)) continue;
    const name = nameOf(punch.staffId);
    if (!name || seenClocked.has(punch.staffId)) continue;
    seenClocked.add(punch.staffId);
    clockedIn.push({
      staffId: punch.staffId,
      name,
      siteId: punch.siteId,
      clockInAt: punch.punchedAt,
      onBreak: isOnBreak(punchesByStaff.get(punch.staffId) ?? [punch]),
    });
  }
  clockedIn.sort((a, b) => (a.clockInAt < b.clockInAt ? -1 : 1));

  /* --------------------------- Out today ---------------------------- */
  const outToday: OutTodayEntry[] = [];
  const excusedFullDay = new Set<string>();
  for (const req of inputs.timeOff) {
    const hours = approvedHoursOn(req, inputs.today);
    if (hours === null) continue;
    if (!inScope(req.siteId, req.staffId)) continue;
    const name = nameOf(req.staffId);
    if (!name) continue;
    const partial = hours < FULL_DAY_HOURS;
    outToday.push({
      staffId: req.staffId,
      name,
      leaveLabel: RIGHT_NOW_LEAVE_LABELS[req.kind] ?? req.kind,
      partial,
      hours,
    });
    if (!partial) excusedFullDay.add(req.staffId);
  }
  outToday.sort((a, b) => a.name.localeCompare(b.name));

  /* --------------------- Expected, not arrived ---------------------- */
  const arrived = new Set(
    inputs.punchesToday.filter((p) => p.kind === "in").map((p) => p.staffId),
  );
  // Approved partial-day hours per staffer, for the shift-coverage excuse.
  const partialHours = new Map<string, number>();
  for (const entry of outToday) {
    if (entry.partial) partialHours.set(entry.staffId, entry.hours);
  }
  const notArrived: NotArrivedEntry[] = [];
  for (const shift of inputs.shiftsToday) {
    if (!shift.staffId) continue; // unassigned = coverage gap, not a no-show
    if (shift.status === "cancelled") continue;
    if (agencyDateOf(shift.startsAt) !== inputs.today) continue;
    if (!inScope(shift.siteId, shift.staffId)) continue;
    if (Date.parse(shift.startsAt) > Date.parse(inputs.nowIso)) continue; // not started yet
    if (arrived.has(shift.staffId)) continue;
    if (clockedIn.some((c) => c.staffId === shift.staffId)) continue;
    if (excusedFullDay.has(shift.staffId)) continue;
    // Partial-day excuse: per-day hours carry no time range, so a staffer
    // is excused only when the approved hours cover the whole shift.
    const shiftHours = hoursBetween(shift.startsAt, shift.endsAt);
    const partial = partialHours.get(shift.staffId);
    if (partial !== undefined && shiftHours > 0 && partial >= shiftHours) continue;
    const name = nameOf(shift.staffId);
    if (!name) continue;
    notArrived.push({
      staffId: shift.staffId,
      name,
      siteId: shift.siteId,
      shiftId: shift.id,
      shiftStartAt: shift.startsAt,
    });
  }
  notArrived.sort((a, b) => (a.shiftStartAt < b.shiftStartAt ? -1 : 1));

  /* ------------------------ Open shifts today ----------------------- */
  const weekday = (() => {
    // Weekday (0=Sunday) of `today` in Chicago — the date IS Chicago's.
    const d = new Date(`${inputs.today}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? -1 : d.getUTCDay();
  })();
  const openShiftsToday: OpenShiftEntry[] = [];
  for (const shift of inputs.openShifts) {
    if (shift.status !== "open") continue;
    if (!scope.has(shift.siteId)) continue;
    const left = Math.max(0, shift.slots - shift.filledCount);
    if (left <= 0) continue;
    if (shift.kind === "temporary") {
      if (!shift.startsAt || agencyDateOf(shift.startsAt) !== inputs.today) continue;
      openShiftsToday.push({
        id: shift.id,
        siteId: shift.siteId,
        windowLabel: shift.endsAt
          ? `${clockLabel(shift.startsAt)} – ${clockLabel(shift.endsAt)}`
          : clockLabel(shift.startsAt),
        slotsLeft: left,
      });
    } else {
      // Permanent (recurring) posting: runs today when today's weekday is
      // in its day set and its effective date has arrived.
      if (!shift.days.includes(weekday)) continue;
      if (shift.effectiveFrom && shift.effectiveFrom > inputs.today) continue;
      openShiftsToday.push({
        id: shift.id,
        siteId: shift.siteId,
        windowLabel:
          shift.windowStart && shift.windowEnd
            ? `${hhmmLabel(shift.windowStart)} – ${hhmmLabel(shift.windowEnd)}`
            : "All day",
        slotsLeft: left,
      });
    }
  }
  openShiftsToday.sort((a, b) => a.windowLabel.localeCompare(b.windowLabel));

  /* ------------------------- Needs decision ------------------------- */
  const decisions = {
    timeOff: inputs.canApproveTimeOff
      ? inputs.timeOff.filter(
          (r) => r.status === "pending" && inScope(r.siteId, r.staffId),
        ).length
      : 0,
    corrections: inputs.canReviewTimecards
      ? inputs.corrections.filter(
          (c) => c.status === "pending" && inScope(null, c.staffId),
        ).length
      : 0,
    missedPunches: inputs.canViewTeam
      ? inputs.missedReports.filter(
          (r) => r.status === "pending" && inScope(r.siteId, r.staffId),
        ).length
      : 0,
    total: 0,
  };
  decisions.total =
    decisions.timeOff + decisions.corrections + decisions.missedPunches;

  const allClear =
    clockedIn.length === 0 &&
    notArrived.length === 0 &&
    outToday.length === 0 &&
    openShiftsToday.length === 0 &&
    decisions.total === 0;

  return { clockedIn, notArrived, outToday, openShiftsToday, decisions, allClear };
}
