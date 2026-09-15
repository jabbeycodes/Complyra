import { assertCalendarDate } from "./access";
import { canSeeMeds } from "./chart";

/** IANA zone printed on consultation packets. Missouri agencies default Central. */
export const DEFAULT_APPOINTMENT_TIMEZONE = "America/Chicago";

export const APPOINTMENT_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "UTC",
] as const;

export interface Appointment {
  id: string;
  agencyId: string;
  individualId: string;
  startsOn: string;
  startTime: string;
  endTime: string;
  timezone: string;
  consultant: string;
  specialty: string;
  reason: string;
  visitAddress: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentDraft = {
  startsOn: string;
  startTime: string;
  endTime: string;
  timezone: string;
  consultant: string;
  specialty?: string;
  reason?: string;
  visitAddress?: string;
};

/** Chart viewers (including assigned DSP) can see Health / packets. */
export function canSeeAppointments(roleKey: string) {
  return canSeeMeds(roleKey);
}

/**
 * Create / edit / delete appointments. DSP and auditor cannot.
 * Matches the #45 P0 brief: RN + HM, plus Admin / DPM / PM.
 */
export function canManageAppointments(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
    "program_manager",
    "nurse",
  ].includes(roleKey);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function normalizeClock(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value.trim();
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function parseMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function validateAppointmentDraft(input: AppointmentDraft): AppointmentDraft {
  assertCalendarDate(input.startsOn, "Enter a valid appointment date.");
  const startTime = normalizeClock(input.startTime);
  const endTime = normalizeClock(input.endTime);
  if (!TIME_RE.test(startTime)) throw new Error("Enter a valid start time.");
  if (!TIME_RE.test(endTime)) throw new Error("Enter a valid end time.");
  if (parseMinutes(endTime) <= parseMinutes(startTime)) {
    throw new Error("End time must be after start time.");
  }
  const timezone = input.timezone.trim() || DEFAULT_APPOINTMENT_TIMEZONE;
  if (timezone.length > 64) throw new Error("Choose a valid timezone.");
  const consultant = input.consultant.trim();
  if (!consultant) throw new Error("Enter the consultant’s name.");
  return {
    startsOn: input.startsOn,
    startTime,
    endTime,
    timezone,
    consultant,
    specialty: input.specialty?.trim() ?? "",
    reason: input.reason?.trim() ?? "",
    visitAddress: input.visitAddress?.trim() ?? "",
  };
}

function formatClock(value: string) {
  const [hoursRaw, minutes] = value.split(":");
  const hours = Number(hoursRaw);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

function formatLongDate(isoDate: string) {
  const parsed = Date.parse(`${isoDate}T12:00:00`);
  if (!Number.isFinite(parsed)) return isoDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function formatAppointmentWhen(row: Pick<Appointment, "startsOn" | "startTime" | "endTime" | "timezone">) {
  return `${formatLongDate(row.startsOn)} · ${formatClock(row.startTime)}–${formatClock(row.endTime)} · ${row.timezone}`;
}

export function sortAppointments(rows: Appointment[]) {
  return [...rows].sort((a, b) => {
    const byStart = `${a.startsOn}T${a.startTime}`.localeCompare(`${b.startsOn}T${b.startTime}`);
    if (byStart !== 0) return byStart;
    return a.id.localeCompare(b.id);
  });
}

export function medicaidStatusLabel(value: string) {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "ida") return "IDA";
  if (value === "cd_only") return "CD only";
  return "";
}
