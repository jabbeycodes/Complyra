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
  createdByName: string;
  createdAt: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  deletedBy: string;
  deletedByName: string;
  deletedAt: string | null;
  completedBy: string;
  completedByName: string;
  completedAt: string | null;
  visitComments: string;
  consultationFileId: string | null;
}

/** UI and filters use Scheduled vs Completed — never "upcoming". */
export type AppointmentStatus = "scheduled" | "completed";

export type CaseloadAppointment = Appointment & {
  individualName: string;
  siteId: string;
  siteName: string;
  programName: string;
};

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

export type HealthActor = {
  userId: string;
  fullName: string;
};

/** Chart viewers (including assigned DSP) can see Health / packets. */
export function canSeeAppointments(roleKey: string) {
  return canSeeMeds(roleKey);
}

/**
 * Create / edit / soft-delete appointments and edit allergies.
 * DSP and auditor cannot. Matches the #45 H1 brief: RN + HM, plus Admin / DPM / PM.
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

export function canEditAllergies(roleKey: string) {
  return canManageAppointments(roleKey);
}

/** RN/HM/admin complete, and assigned DSP may upload/complete. DSP cannot create. */
export function canCompleteAppointments(roleKey: string) {
  return canManageAppointments(roleKey) || roleKey === "dsp";
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

export function isAppointmentRemoved(row: Pick<Appointment, "deletedAt">) {
  return Boolean(row.deletedAt);
}

export function appointmentStatus(row: Pick<Appointment, "completedAt" | "deletedAt">): AppointmentStatus {
  return row.completedAt ? "completed" : "scheduled";
}

export function appointmentStatusLabel(status: AppointmentStatus) {
  return status === "completed" ? "Completed" : "Scheduled";
}

export function addCalendarDays(isoDate: string, days: number) {
  const parsed = Date.parse(`${isoDate.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDate.slice(0, 10);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

export function thirtyDayRange(today: string) {
  return { from: today.slice(0, 10), to: addCalendarDays(today, 29) };
}

export function monthStart(isoDate: string) {
  return `${isoDate.slice(0, 7)}-01`;
}

export function shiftMonth(monthIso: string, delta: number) {
  const [year, month] = monthIso.slice(0, 7).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthLabel(monthIso: string) {
  const parsed = Date.parse(`${monthStart(monthIso)}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return monthIso;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    parsed,
  );
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthCells(monthIso: string) {
  const start = monthStart(monthIso);
  const [year, month] = start.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: { date: string | null }[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push({ date: null });
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: `${start.slice(0, 8)}${String(day).padStart(2, "0")}` });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return cells;
}

/**
 * Workspace Appointments filters AND together. Callers already scoped `rows`
 * to caseload; this does not widen visibility.
 */
export function filterCaseloadAppointments(
  rows: CaseloadAppointment[],
  filters: {
    name?: string;
    individualId?: string;
    from?: string;
    to?: string;
    status?: AppointmentStatus | "all";
    siteId?: string;
    programName?: string;
    createdBy?: string;
  },
) {
  const name = filters.name?.trim().toLowerCase() ?? "";
  const program = filters.programName?.trim().toLowerCase() ?? "";
  const filtered = rows.filter((row) => {
    if (isAppointmentRemoved(row)) return false;
    if (filters.individualId && row.individualId !== filters.individualId) return false;
    if (name && !row.individualName.toLowerCase().includes(name)) return false;
    if (filters.from && row.startsOn < filters.from) return false;
    if (filters.to && row.startsOn > filters.to) return false;
    if (filters.status && filters.status !== "all" && appointmentStatus(row) !== filters.status) {
      return false;
    }
    if (filters.siteId && row.siteId !== filters.siteId) return false;
    if (program && row.programName.trim().toLowerCase() !== program) return false;
    if (filters.createdBy && row.createdBy !== filters.createdBy) return false;
    return true;
  });
  return sortAppointments(filtered) as CaseloadAppointment[];
}

export function formatAppointmentDate(isoDate: string) {
  return formatLongDate(isoDate);
}

export function caseloadAppointmentsFromWorkspace(
  stacks: { individualId: string; appointments: Appointment[] }[],
  people: { id: string; name: string; siteId: string; site: string }[],
  sites: { id: string; program: string }[] = [],
): CaseloadAppointment[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const programBySite = new Map(sites.map((site) => [site.id, site.program]));
  const rows: CaseloadAppointment[] = [];
  for (const stack of stacks) {
    const person = byId.get(stack.individualId);
    if (!person) continue;
    for (const appointment of stack.appointments) {
      rows.push({
        ...appointment,
        individualName: person.name,
        siteId: person.siteId,
        siteName: person.site,
        programName: programBySite.get(person.siteId) ?? "",
      });
    }
  }
  return sortAppointments(rows) as CaseloadAppointment[];
}

export function uniqueProgramNames(sites: { program: string }[]) {
  return [...new Set(sites.map((site) => site.program.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

const CONSULTATION_NAME_RE = /\.(pdf|png|jpe?g)$/i;

/** Consultation form: PDF or a photo of the signed visit sheet. */
export function assertConsultationUpload(file: File) {
  const mime = (file.type || "").toLowerCase();
  const allowedMime =
    mime === "application/pdf" || mime === "image/png" || mime === "image/jpeg";
  if (allowedMime || CONSULTATION_NAME_RE.test(file.name)) return;
  throw new Error("Upload the consultation form as a PDF, PNG, or JPG.");
}

export function formatCompletedBy(name: string, at: string) {
  return `Completed by ${name} · ${formatHealthDateTime(at)}`;
}

/** DSP sees live rows only. RN/HM/admin still see removed appointments. */
export function visibleAppointments(rows: Appointment[], includeRemoved: boolean) {
  const filtered = includeRemoved ? rows : rows.filter((row) => !isAppointmentRemoved(row));
  return sortAppointments(filtered);
}

export function medicaidStatusLabel(value: string) {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "ida") return "IDA";
  if (value === "cd_only") return "CD only";
  return "";
}

export function actorDisplayName(actor: HealthActor) {
  return actor.fullName.trim() || "Unknown";
}

/** Clinical who/when line. Pinned to Central so demo/hosted stamps match. */
export function formatHealthDateTime(iso: string, timeZone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).formatToParts(new Date(parsed));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

export function formatLoggedBy(name: string, at: string) {
  return `Logged by ${name} · ${formatHealthDateTime(at)}`;
}

export function formatUpdatedBy(name: string, at: string) {
  return `Updated by ${name} · ${formatHealthDateTime(at)}`;
}

export function formatRemovedBy(name: string, at: string) {
  return `Removed by ${name} · ${formatHealthDateTime(at)}`;
}

export function formatGeneratedBy(name: string, at: string) {
  return `Generated by ${name} · ${formatHealthDateTime(at)}`;
}

const APPOINTMENT_FIELDS: { key: keyof AppointmentDraft; label: string }[] = [
  { key: "startsOn", label: "Date" },
  { key: "startTime", label: "Start" },
  { key: "endTime", label: "End" },
  { key: "timezone", label: "Timezone" },
  { key: "consultant", label: "Consultant" },
  { key: "specialty", label: "Specialty" },
  { key: "reason", label: "Reason" },
  { key: "visitAddress", label: "Address of visit" },
];

function fieldValue(row: Appointment | AppointmentDraft, key: keyof AppointmentDraft) {
  const value = row[key];
  return (value ?? "").toString();
}

/** Field-level from → to for AuditEvent.detail. */
export function appointmentChangeDetail(before: Appointment, after: AppointmentDraft) {
  const changes = APPOINTMENT_FIELDS.flatMap(({ key, label }) => {
    const from = fieldValue(before, key);
    const to = fieldValue(after, key);
    if (from === to) return [];
    return [`${label}: ${from || "(blank)"} → ${to || "(blank)"}`];
  });
  return changes.length ? changes.join("; ") : "Appointment updated";
}

export function blankAppointmentStamps(
  actor: HealthActor,
  at: string,
): Pick<
  Appointment,
  | "createdBy"
  | "createdByName"
  | "createdAt"
  | "updatedBy"
  | "updatedByName"
  | "updatedAt"
  | "deletedBy"
  | "deletedByName"
  | "deletedAt"
  | "completedBy"
  | "completedByName"
  | "completedAt"
  | "visitComments"
  | "consultationFileId"
> {
  return {
    createdBy: actor.userId,
    createdByName: actorDisplayName(actor),
    createdAt: at,
    updatedBy: "",
    updatedByName: "",
    updatedAt: at,
    deletedBy: "",
    deletedByName: "",
    deletedAt: null,
    completedBy: "",
    completedByName: "",
    completedAt: null,
    visitComments: "",
    consultationFileId: null,
  };
}
