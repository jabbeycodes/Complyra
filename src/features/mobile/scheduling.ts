/**
 * Mobile Scheduling — the week coverage board and shift accountability
 * on a phone.
 *
 * Everything here is a phone layout over the SAME stores and rules the
 * desktop coverage board (features/coverage/SiteCoverageBoard) uses:
 * shifts are read and written through the HR store (listShifts /
 * updateShift), and the accountability line comes from the Phase 2
 * engine (getShiftAccountability — attribution rules live in
 * data/shiftAccountability.ts, nowhere else). Semantics mirrored from
 * the desktop board, deliberately:
 * - "Assign" and "Change" write the assignee of record on the shift
 *   (updateShift with a staffId patch). The engine attributes the whole
 *   window to whoever the shift names when it is read, so the card's
 *   owner and counts follow the new assignee immediately.
 * - "Take off" is the desktop button's own action: it cancels the shift
 *   row (updateShift with status "cancelled"). It does NOT return the
 *   shift to open — the desktop board has no unassign-to-open action,
 *   and this view does not invent one.
 * - There is no publish step: the desktop board writes rows directly in
 *   "published" status, so a phone assignment is published the moment
 *   it saves. No separate publish action exists to mirror.
 * - The staff list follows the board's rule (active staff — an expired
 *   record drops off — sorted by name), narrowed by one phone-first
 *   guard the task adds: a person with APPROVED time off overlapping
 *   the shift is not offered at all. A person already assigned an
 *   overlapping shift is still offered, with the clash stated in text —
 *   the desktop board hard-blocks nothing here, so neither does this.
 *
 * Wording: status always rides in text (never color alone); people in
 * care are "Individuals"; the note a shift owes is the "Shift note".
 */
import type { HrShift, HrTimeOffRequest } from "../../data/hr";
import {
  accountabilityStateLabel,
  type ShiftAccountability,
} from "../../data/shiftAccountability";
import {
  chicagoWallClock,
  dayHeading,
  shiftTouchesDate,
} from "../coverage/coverageWeek";
import { formatDoseTime } from "./mar";

/** The board's staff-choice shape; workspace staff rows satisfy it. */
export interface SchedStaffChoice {
  id: string;
  name: string;
  role: string;
  roleKey?: string;
  siteId: string | null;
  site: string;
  expiresOn: string | null;
}

/** "8:00 AM – 4:00 PM" in Central; an end past midnight says so. */
export function shiftTimeLabel(startsAt: string, endsAt: string): string {
  const start = chicagoWallClock(startsAt);
  const end = chicagoWallClock(endsAt);
  const tail = end.date !== start.date ? " next day" : "";
  return `${formatDoseTime(start.hhmm)} – ${formatDoseTime(end.hhmm)}${tail}`;
}

/**
 * The Central calendar dates a shift touches, first to last. The end is
 * read a minute early so a shift ending at midnight belongs to the day
 * it worked, not the day it merely touches.
 */
export function shiftCentralDateSpan(
  startsAt: string,
  endsAt: string,
): { from: string; to: string } {
  const from = chicagoWallClock(startsAt).date;
  const endInstant = new Date(Date.parse(endsAt) - 60_000).toISOString();
  const to = chicagoWallClock(endInstant).date;
  return { from, to: to < from ? from : to };
}

/** The approved time-off request covering any of [fromDate, toDate], if one exists. */
export function approvedTimeOffCovering(
  requests: readonly HrTimeOffRequest[],
  staffId: string,
  fromDate: string,
  toDate: string,
): HrTimeOffRequest | null {
  return (
    requests.find(
      (row) =>
        row.staffId === staffId &&
        row.status === "approved" &&
        row.startsOn <= toDate &&
        row.endsOn >= fromDate,
    ) ?? null
  );
}

function overlaps(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export interface StaffPick {
  id: string;
  name: string;
  /** "Alex Morgan, DSP" — plus ", other house" / ", agency" off-site. */
  label: string;
  /** Text warning when the person already holds an overlapping shift. */
  overlapWarning: string | null;
}

/**
 * Who may be put on `shift`, in the board's order. Staff with approved
 * time off overlapping the shift are excluded entirely; staff already
 * assigned an overlapping shift stay listed with a text warning.
 */
export function staffPicksForShift(input: {
  staff: readonly SchedStaffChoice[];
  todayIso: string;
  shift: HrShift;
  timeOff: readonly HrTimeOffRequest[];
  allShifts: readonly HrShift[];
}): StaffPick[] {
  const span = shiftCentralDateSpan(input.shift.startsAt, input.shift.endsAt);
  return input.staff
    .filter((person) => !person.expiresOn || person.expiresOn >= input.todayIso)
    .filter(
      (person) =>
        !approvedTimeOffCovering(input.timeOff, person.id, span.from, span.to),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => {
      const clash = input.allShifts.find(
        (row) =>
          row.id !== input.shift.id &&
          row.staffId === person.id &&
          row.status !== "cancelled" &&
          overlaps(row, input.shift),
      );
      const where =
        person.siteId === input.shift.siteId
          ? ""
          : person.siteId
            ? ", other house"
            : ", agency";
      return {
        id: person.id,
        name: person.name,
        label: `${person.name}, ${person.role}${where}`,
        overlapWarning: clash
          ? `Already assigned an overlapping shift (${shiftTimeLabel(clash.startsAt, clash.endsAt)})`
          : null,
      };
    });
}

/**
 * One text line carrying a shift's accountability — the same wording the
 * desktop board prints (owner or "Unowned", the state in words, the
 * done fraction, the first missing obligations by name). Undone work
 * reads "Missing" once the window has ended and "Still to do" while it
 * can still be done.
 */
export function accountabilityLine(
  acc: ShiftAccountability,
  nowIso: string,
): string {
  const counts = `${acc.doneCount} of ${acc.totalDue} done`;
  const head =
    acc.state === "unowned"
      ? "Unowned"
      : `${acc.ownerName ?? "Unassigned"} · ${accountabilityStateLabel(acc.state)}`;
  if (acc.totalDue === 0) return `${head} · Nothing due in this window`;
  if (acc.missingItems.length === 0) return `${head} · ${counts} · All complete`;
  const verb = acc.endsAt <= nowIso ? "Missing" : "Still to do";
  const labels = acc.missingItems.slice(0, 3).map((entry) => entry.label);
  const more =
    acc.missingItems.length > 3 ? ` · and ${acc.missingItems.length - 3} more` : "";
  return `${head} · ${counts} · ${verb}: ${labels.join("; ")}${more}`;
}

export interface DayShifts {
  date: string;
  heading: string;
  isToday: boolean;
  rows: { shift: HrShift; acc: ShiftAccountability | null }[];
}

/** The week's shifts grouped under their days, in day then start order. */
export function weekDayShifts(input: {
  dates: readonly string[];
  shifts: readonly HrShift[];
  accountability: ReadonlyMap<string, ShiftAccountability>;
  todayIso: string;
}): DayShifts[] {
  return input.dates.map((date) => ({
    date,
    heading: dayHeading(date),
    isToday: date === input.todayIso,
    rows: input.shifts
      .filter(
        (row) =>
          row.status !== "cancelled" &&
          shiftTouchesDate(row.startsAt, row.endsAt, date),
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((shift) => ({
        shift,
        acc: input.accountability.get(shift.id) ?? null,
      })),
  }));
}

/**
 * The signed-in person's own shift for the Today strip: one they are in
 * right now (the engine's in-progress state, or a window that contains
 * now with everything done — the engine calls that "complete"), else
 * their next shift starting today. An ended shift never appears: its
 * misses stay attributed to its owner on the board (the engine's
 * has_missing state) without following the person around the home page.
 */
export function pickYourShift(
  rows: readonly ShiftAccountability[],
  userId: string,
  todayIso: string,
  now: Date,
): ShiftAccountability | null {
  const nowIso = now.toISOString();
  const mine = rows
    .filter((row) => row.ownerId === userId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const live = mine.find(
    (row) =>
      row.state === "in_progress" ||
      (row.startsAt <= nowIso && nowIso < row.endsAt && row.state === "complete"),
  );
  if (live) return live;
  return (
    mine.find(
      (row) =>
        row.state === "upcoming" &&
        chicagoWallClock(row.startsAt).date === todayIso,
    ) ?? null
  );
}

/** The Today strip's two lines for the person's own shift. */
export function yourShiftText(acc: ShiftAccountability): {
  title: string;
  detail: string;
} {
  const title = `Your shift · ${shiftTimeLabel(acc.startsAt, acc.endsAt)}`;
  if (acc.totalDue === 0) {
    return { title, detail: "Nothing due in this window" };
  }
  const counts = `${acc.doneCount} of ${acc.totalDue} done`;
  if (acc.missingItems.length === 0) {
    return { title, detail: `${counts} · All complete` };
  }
  const labels = acc.missingItems.slice(0, 2).map((entry) => entry.label);
  const more =
    acc.missingItems.length > 2 ? ` · and ${acc.missingItems.length - 2} more` : "";
  const verb = acc.state === "upcoming" ? "Due on this shift" : "Still to do";
  return { title, detail: `${counts} · ${verb}: ${labels.join("; ")}${more}` };
}
