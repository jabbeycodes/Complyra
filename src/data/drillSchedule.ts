import { DRILL_LABELS, type DrillType, type EmergencyDrill } from "./monthlyChecks";

/**
 * Issue #94: the agency's canonical Emergency Drills Schedule, transcribed
 * from the agency sheet (see issue #94). This drives the Drills section of
 * the program-site Checklists tab. The schedule itself is configuration —
 * drill RECORDS stay in the existing EmergencyDrill model, untouched.
 */

export type ScheduleDrillType = DrillType;

export interface DrillScheduleMonth {
  /** 1-12 */
  month: number;
  name: string;
  /** Shift time window during which that month's drills are run. */
  shiftWindow: string;
  /** Drill types that must be completed that month. */
  drills: ScheduleDrillType[];
  /**
   * Months marked with * on the agency sheet: the medical emergency drill
   * that month counts toward the all-staff six-month rule.
   */
  allStaffMedicalMonth?: boolean;
}

export const EMERGENCY_DRILL_SCHEDULE: readonly DrillScheduleMonth[] = [
  { month: 1, name: "January", shiftWindow: "7:00 AM - 3:00 PM", drills: ["fire", "intruder"] },
  { month: 2, name: "February", shiftWindow: "7:00 AM - 3:00 PM", drills: ["fire", "earthquake"] },
  {
    month: 3,
    name: "March",
    shiftWindow: "7:00 AM - 3:00 PM",
    drills: ["fire", "tornado", "severe_weather"],
  },
  {
    month: 4,
    name: "April",
    shiftWindow: "3:00 PM - 11:00 PM",
    drills: ["fire", "tornado", "medical_emergency"],
    allStaffMedicalMonth: true,
  },
  {
    month: 5,
    name: "May",
    shiftWindow: "3:00 PM - 11:00 PM",
    drills: ["fire", "tornado", "earthquake", "intruder"],
  },
  {
    month: 6,
    name: "June",
    shiftWindow: "3:00 PM - 11:00 PM",
    drills: ["fire", "tornado", "severe_weather", "missing_person"],
  },
  {
    month: 7,
    name: "July",
    shiftWindow: "11:00 PM - 7:00 AM",
    drills: ["fire", "tornado", "intruder"],
  },
  {
    month: 8,
    name: "August",
    shiftWindow: "11:00 PM - 7:00 AM",
    drills: ["fire", "tornado", "earthquake"],
  },
  {
    month: 9,
    name: "September",
    shiftWindow: "11:00 PM - 7:00 AM",
    drills: ["fire", "tornado", "severe_weather"],
  },
  {
    month: 10,
    name: "October",
    shiftWindow: "Saturday 7:00 AM - Sunday 11:00 PM",
    drills: ["fire", "tornado", "medical_emergency"],
    allStaffMedicalMonth: true,
  },
  {
    month: 11,
    name: "November",
    shiftWindow: "Saturday 7:00 AM - Sunday 11:00 PM",
    drills: ["fire", "severe_weather"],
  },
  {
    month: 12,
    name: "December",
    shiftWindow: "Saturday 7:00 AM - Sunday 11:00 PM",
    drills: ["fire", "earthquake", "intruder", "missing_person"],
  },
];

export interface DrillQuarterResponsibility {
  label: string;
  months: string;
  responsibility: string;
}

export const DRILL_QUARTER_RESPONSIBILITIES: readonly DrillQuarterResponsibility[] = [
  { label: "1st Quarter", months: "January - March", responsibility: "AM staff responsible for drills" },
  { label: "2nd Quarter", months: "April - June", responsibility: "PM staff responsible for drills" },
  { label: "3rd Quarter", months: "July - September", responsibility: "Overnight staff responsible for drills" },
  { label: "4th Quarter", months: "October - December", responsibility: "Weekend staff responsible for drills" },
];

/** Drills need to be completed by the 7th of each month (agency sheet). */
export const DRILL_DUE_DAY = 7;

export const DRILLS_DUE_RULE = `Drills need to be completed by the ${DRILL_DUE_DAY}th of each month.`;

export const MEDICAL_EMERGENCY_RULE =
  "All staff must participate in a medical emergency drill once every six months.";

export function quarterResponsibilityForMonth(month: number): DrillQuarterResponsibility {
  const quarter = Math.min(3, Math.floor((month - 1) / 3));
  return DRILL_QUARTER_RESPONSIBILITIES[quarter];
}

export function scheduleMonthLabel(type: ScheduleDrillType): string {
  return DRILL_LABELS[type] ?? type;
}

/** A drill recorded after the 7th is still accepted, but flagged late. */
export function isDrillLate(dateIso: string | null | undefined): boolean {
  if (!dateIso || dateIso.length < 10) return false;
  const day = Number(dateIso.slice(8, 10));
  return Number.isFinite(day) && day > DRILL_DUE_DAY;
}

export type ScheduledDrillStatus = "complete" | "not_logged";

export interface ScheduledDrillState {
  type: ScheduleDrillType;
  /** Latest matching record for this month, if any. */
  record: EmergencyDrill | null;
  status: ScheduledDrillStatus;
  late: boolean;
}

function monthKeyFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Completion state for one schedule month, from existing drill records.
 * Records match by monthKey (the drill log's own month anchor); when several
 * records exist for the same type, the latest dated one wins.
 */
export function scheduledDrillStates(
  schedule: DrillScheduleMonth,
  year: number,
  records: EmergencyDrill[],
): ScheduledDrillState[] {
  const key = monthKeyFor(year, schedule.month);
  return schedule.drills.map((type) => {
    const dated = records
      .filter((r) => r.drillType === type && r.monthKey === key && r.date)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const record = dated[0] ?? null;
    const late = record ? isDrillLate(record.date) : false;
    return {
      type,
      record,
      status: record ? "complete" : "not_logged",
      late,
    };
  });
}

export interface ScheduleMonthSummary {
  month: DrillScheduleMonth;
  states: ScheduledDrillState[];
  complete: number;
  required: number;
  allComplete: boolean;
  anyLate: boolean;
}

/** Full-year summary: every schedule month with its completion state. */
export function drillScheduleYearSummary(
  year: number,
  records: EmergencyDrill[],
): ScheduleMonthSummary[] {
  return EMERGENCY_DRILL_SCHEDULE.map((month) => {
    const states = scheduledDrillStates(month, year, records);
    const complete = states.filter((s) => s.status === "complete").length;
    return {
      month,
      states,
      complete,
      required: states.length,
      allComplete: complete === states.length,
      anyLate: states.some((s) => s.late),
    };
  });
}
