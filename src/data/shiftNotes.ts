/**
 * Issue #80 — Structured ISP Data: shift notes + ISP program config.
 *
 * Model:
 * - An ISP Program is configured per Individual per plan year by a DPM/PM or
 *   administrator: name, dates, schedule, max entries per day, a scoring
 *   method (agency-defined levels), and up to 60 tasks. Status is draft until
 *   approved; only an APPROVED program is visible to staff entering notes.
 * - A Shift note records one staff member's documentation for a date + shift
 *   against the active approved program: per-task scores + comments, plus an
 *   "Other" summary. Who/when is stamped on every save; deletes are soft.
 * - DSPs may edit only their own notes; house managers / PMs / administrators
 *   may edit notes within their individual access scope.
 *
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */

import { roleLabel } from "./status";

export type IspProgramStatus = "draft" | "approved" | "superseded";

export type IspSchedule = "per_shift" | "per_day" | "custom";

/** Shift windows used across residential documentation. */
export const ISP_SHIFTS = ["7a–3p", "3p–11p", "11p–7a"] as const;
export type IspShift = (typeof ISP_SHIFTS)[number] | "other";

export interface IspScoreLevel {
  id: string;
  caption: string;
  /** Short acronym shown in reports. */
  shortLabel: string;
  /** Non-reportable levels are recorded but excluded from progress math. */
  reportable: boolean;
  sortOrder: number;
}

export interface IspScoringMethod {
  id: string;
  agencyId: string;
  name: string;
  levels: IspScoreLevel[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface IspProgramTask {
  id: string;
  programId: string;
  title: string;
  instructions: string;
  sortOrder: number;
}

export interface IspProgram {
  id: string;
  agencyId: string;
  individualId: string;
  /** Plan year this program belongs to, e.g. "2026". */
  planYear: string;
  name: string;
  effectiveOn: string;
  expiresOn: string;
  schedule: IspSchedule;
  maxEntriesPerDay: number;
  scoringMethodId: string;
  status: IspProgramStatus;
  approvedBy: string;
  approvedByName: string;
  approvedAt: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  /** Printed on the clinician report as Goal/Service. */
  goalService?: string;
  /** Printed on the clinician report as Criteria for Completion. */
  completionCriteria?: string;
  /** Printed under Schedule and Frequency Comment. */
  scheduleComment?: string;
}

export interface ShiftNote {
  id: string;
  agencyId: string;
  individualId: string;
  programId: string;
  noteDate: string;
  /** Which site shift this note counts toward. Detection still uses this label. */
  shift: string;
  /** 24-hour "HH:MM". Empty on notes saved before clock times existed. */
  beginTime?: string;
  endTime?: string;
  /** Where the shift was worked. Blank prints as a blank location cell. */
  location?: string;
  /** Job title stamped with the author, e.g. "Direct support professional". */
  staffTitle?: string;
  /** DMH HCBS waiver service this note documents. */
  waiverService?: string;
  /** PNG data URL of the author's signature at the time the note was saved. */
  signatureDataUrl?: string;
  /** What the person did, and how the staff supported a goal in the current PCSP. */
  summary: string;
  timeSpentMinutes: number | null;
  staffUserId: string;
  staffName: string;
  /** Staff shift this note was filed against, when the house had one published. */
  hrShiftId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ShiftNoteTaskScore {
  id: string;
  noteId: string;
  taskId: string;
  levelId: string;
  comment: string;
}

export interface IspProgramView extends IspProgram {
  tasks: IspProgramTask[];
  scoringMethod: IspScoringMethod | null;
}

export interface ShiftNoteScoreView extends ShiftNoteTaskScore {
  taskTitle: string;
}

export interface ShiftNoteView extends ShiftNote {
  programName: string;
  scoringMethodName: string;
  scores: ShiftNoteScoreView[];
}

/** Site-level read view: a shift note with its Individual's name attached. */
export interface SiteShiftNoteView extends ShiftNoteView {
  individualName: string;
}

/** The default scoring levels: Yes / No / Refused. */
export function defaultScoreLevels(): Omit<IspScoreLevel, "id" | "sortOrder">[] {
  return [
    { caption: "Yes", shortLabel: "Y", reportable: true },
    { caption: "No", shortLabel: "N", reportable: true },
    { caption: "Refused", shortLabel: "R", reportable: true },
  ];
}

/**
 * The program staff should note against: the latest approved program for the
 * Individual + plan year whose effective range covers today. Draft programs
 * are never returned here (approve gate).
 */
export function activeIspProgram<TProgram extends IspProgram>(
  programs: TProgram[],
  individualId: string,
  planYear: string,
  today = new Date().toISOString().slice(0, 10),
): TProgram | null {
  const candidates = programs.filter(
    (program) =>
      program.individualId === individualId &&
      program.planYear === planYear &&
      program.status === "approved" &&
      program.effectiveOn.slice(0, 10) <= today &&
      program.expiresOn.slice(0, 10) >= today,
  );
  candidates.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  return candidates[0] ?? null;
}

/** Staff only ever see approved programs; drafts stay with DPM/Admin. */
export function ispProgramVisibleToStaff(program: IspProgram): boolean {
  return program.status === "approved";
}

/**
 * Who may edit a shift note: the author always; house managers, PMs, and
 * administrators may edit notes for Individuals in their access scope
 * (scope itself is enforced by the API layer). DSPs and nurses may edit only
 * their own notes.
 */
export function canEditShiftNoteRow(
  roleKey: string,
  sessionUserId: string,
  note: Pick<ShiftNote, "staffUserId">,
): boolean {
  if (note.staffUserId === sessionUserId) return true;
  return ["house_manager", "program_manager", "administrator"].includes(roleKey);
}

export function ispScheduleLabel(schedule: IspSchedule): string {
  switch (schedule) {
    case "per_shift":
      return "Per shift";
    case "per_day":
      return "Per day";
    case "custom":
      return "Custom";
  }
}

/** The word the clinician report prints. "Per day" is Therap's "Daily". */
export function clinicianScheduleLabel(schedule: IspSchedule): string {
  switch (schedule) {
    case "per_shift":
      return "Each shift";
    case "per_day":
      return "Daily";
    case "custom":
      return "Custom";
  }
}

const LEGACY_SHIFT_CLOCKS: Record<string, readonly [string, string]> = {
  "7a–3p": ["07:00", "15:00"],
  "7a-3p": ["07:00", "15:00"],
  "3p–11p": ["15:00", "23:00"],
  "3p-11p": ["15:00", "23:00"],
  "11p–7a": ["23:00", "07:00"],
  "11p-7a": ["23:00", "07:00"],
};

function meridiemToHhmm(hourText: string, minuteText: string | undefined, mer: string): string | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  if (hour > 12 || minute > 59) return null;
  const afternoon = mer.toLowerCase().startsWith("p");
  if (afternoon && hour < 12) hour += 12;
  if (!afternoon && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Pull a begin and end out of a stored shift label, including the old 7a–3p set. */
export function clocksFromShiftLabel(shift: string): { begin: string; end: string } | null {
  const legacy = LEGACY_SHIFT_CLOCKS[shift.trim().toLowerCase()];
  if (legacy) return { begin: legacy[0], end: legacy[1] };
  const matches = [...shift.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)/gi)];
  if (matches.length < 2) return null;
  const begin = meridiemToHhmm(matches[0][1], matches[0][2], matches[0][3]);
  const end = meridiemToHhmm(matches[1][1], matches[1][2], matches[1][3]);
  if (!begin || !end) return null;
  return { begin, end };
}

/** Minutes from begin to end. Equal clocks are 0. An earlier end crosses midnight. */
export function shiftDurationMinutes(begin: string, end: string): number | null {
  const start = /^(\d{1,2}):(\d{2})$/.exec(begin.trim());
  const finish = /^(\d{1,2}):(\d{2})$/.exec(end.trim());
  if (!start || !finish) return null;
  const startMin = Number(start[1]) * 60 + Number(start[2]);
  const endMin = Number(finish[1]) * 60 + Number(finish[2]);
  if (Number(start[1]) > 23 || Number(finish[1]) > 23 || Number(start[2]) > 59 || Number(finish[2]) > 59) {
    return null;
  }
  return endMin >= startMin ? endMin - startMin : endMin + 1440 - startMin;
}

/** Therap duration cell: 06:30, 00:00, 01:29. */
export function formatDurationHhmm(minutes: number): string {
  const whole = Math.max(0, Math.trunc(minutes));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** Therap clock cell: 06:30 AM, 02:30 PM, 12:00 AM. */
export function formatTherapClock(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  const mer = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${mer}`;
}

/** Therap date cell: 10/05/2026. */
export function formatTherapDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${month}/${day}/${year}`;
}

/**
 * The clocks a report should print. Saved begin/end win. Older notes fall
 * back to the shift label so a 7a–3p row still has a begin and an end.
 */
export function clinicianTimes(note: {
  beginTime?: string;
  endTime?: string;
  shift: string;
  timeSpentMinutes: number | null;
}): { beginLabel: string; endLabel: string; durationLabel: string } {
  const savedBegin = note.beginTime?.trim() ?? "";
  const savedEnd = note.endTime?.trim() ?? "";
  const parsed = savedBegin && savedEnd ? null : clocksFromShiftLabel(note.shift);
  const begin = savedBegin || parsed?.begin || "";
  const end = savedEnd || parsed?.end || "";
  const duration = begin && end ? shiftDurationMinutes(begin, end) : null;
  const minutes = duration ?? (note.timeSpentMinutes == null ? null : note.timeSpentMinutes);
  return {
    beginLabel: formatTherapClock(begin),
    endLabel: formatTherapClock(end),
    durationLabel: minutes == null ? "" : formatDurationHhmm(minutes),
  };
}

/** Minute-of-day for the note's begin time, so 7:00 a.m. sorts before 3:00 p.m. */
export function noteBeginMinutes(note: { beginTime?: string; shift: string }): number {
  const saved = note.beginTime?.trim() ?? "";
  const hhmm = saved || clocksFromShiftLabel(note.shift)?.begin || "";
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return 24 * 60;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function clinicianProvider(note: { staffName: string; staffTitle?: string }): string {
  const title = note.staffTitle?.trim() ?? "";
  return title ? `${note.staffName}, ${title}` : note.staffName;
}

/**
 * Waiver services a progress note may document. Names match the services
 * this product already uses for a site or a kiosk visit. The writeAbout
 * line is the reminder of what the narrative has to describe.
 */
export const WAIVER_SERVICES = [
  {
    name: "Individualized Supported Living",
    writeAbout: "Habilitation, personal care, and supervision in the person's home, including the skills and routines in the current PCSP.",
  },
  {
    name: "Group Home",
    writeAbout: "Habilitation and supervision in the group home, including the skills and routines in the current PCSP.",
  },
  {
    name: "Shared Living",
    writeAbout: "Support in the shared living home, including the skills and routines in the current PCSP.",
  },
  {
    name: "Day Habilitation",
    writeAbout: "Skill-building and meaningful activity during the day, as written in the current PCSP.",
  },
  {
    name: "Community Networking",
    writeAbout: "Support to take part in a community activity the current PCSP names.",
  },
  {
    name: "Individual Skill Development",
    writeAbout: "Teaching or practicing a skill the current PCSP names.",
  },
  {
    name: "Personal Assistance",
    writeAbout: "Hands-on support with daily activities the current PCSP names.",
  },
  {
    name: "In-Home Respite",
    writeAbout: "Relief for the usual caregiver, while supporting the person as the current PCSP describes.",
  },
  {
    name: "Supported Employment",
    writeAbout: "Support on the job or toward a job, as written in the current PCSP.",
  },
] as const;

export function waiverServiceNames(): string[] {
  return WAIVER_SERVICES.map((service) => service.name);
}

export function waiverServiceWriteAbout(name: string): string {
  return WAIVER_SERVICES.find((service) => service.name === name)?.writeAbout ?? "";
}

/** A role key such as "dsp" is not a title. Use the role's display name. */
export function displayStaffTitle(given: string | undefined, roleKey: string): string {
  const title = (given ?? "").trim();
  if (!title || title === roleKey) return roleLabel(roleKey).slice(0, 80);
  return title.slice(0, 80);
}

/**
 * Full name with a middle initial when the legal name has a middle name.
 * A two-part name is left as stored. The date of birth is the other way a
 * note identifies the person, so a missing middle name is not invented.
 */
export function progressNoteName(legalName: string): string {
  const parts = legalName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return legalName.trim();
  const initial = parts[1].replace(/\./g, "").charAt(0);
  if (!initial) return legalName.trim();
  return `${parts[0]} ${initial.toUpperCase()}. ${parts.slice(2).join(" ")}`;
}

/** Why a new progress note is not acceptable yet. Null means it can be saved. */
export function progressNoteProblem(input: {
  goalService: string;
  beginTime: string;
  endTime: string;
  waiverService: string;
  summary: string;
  staffTitle: string;
  signatureDataUrl: string;
}): string | null {
  if (!input.goalService.trim()) {
    return "Add the goal or outcome from the current PCSP before a progress note can be saved.";
  }
  if (!input.beginTime.trim() || !input.endTime.trim()) {
    return "Use a begin time and an end time.";
  }
  if (!waiverServiceNames().includes(input.waiverService.trim())) {
    return "Choose the DMH waiver service this note documents.";
  }
  if (!input.summary.trim()) {
    return "Describe what the person did and how you supported a goal in the current PCSP.";
  }
  if (!input.staffTitle.trim()) {
    return "A progress note needs the staff person's title.";
  }
  if (!input.signatureDataUrl.startsWith("data:image/png;base64,")) {
    return "Adopt your signature before saving a progress note. A printed name is not a signature.";
  }
  return null;
}

export function normalizeTaskTitle(title: string): string {
  return title.trim().slice(0, 200);
}

/** The wall-clock day and minute-of-day in the agency's Central zone. */
function centralDayMinutes(when: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(when);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

/**
 * Why a shift note's date and begin time are not acceptable yet. Null means
 * the timing is fine. A shift note documents work already done, so it cannot
 * be dated after today, and a note dated today cannot begin before the shift
 * has started (simulation batch 37: a 4–5 p.m. note was on the chart at
 * 3 p.m.). The end time may run past the current time — staff document
 * during a shift that is still in progress. Judged on the Central calendar
 * the note subsystem already uses (the mobile form's "Date (Central)" and
 * centralTodayIso), with no grace: the codebase's other future-date checks
 * (house card, care screening, med exceptions) allow none either. Called by
 * both APIs on create and update, so a direct store call is refused the
 * same way the forms refuse.
 */
export function shiftNoteTimingProblem(input: {
  noteDate: string;
  beginTime: string;
  now?: Date;
}): string | null {
  const { date: today, minutes: nowMinutes } = centralDayMinutes(input.now ?? new Date());
  const noteDay = input.noteDate.slice(0, 10);
  if (noteDay > today) {
    return "A shift note cannot be dated in the future.";
  }
  if (noteDay < today) return null;
  const begin = /^(\d{1,2}):(\d{2})$/.exec(input.beginTime.trim());
  if (!begin) return null;
  const hour = Number(begin[1]);
  const minute = Number(begin[2]);
  if (hour > 23 || minute > 59) return null;
  if (hour * 60 + minute > nowMinutes) {
    return "A shift note cannot begin in the future.";
  }
  return null;
}

function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** First and last calendar day of YYYY-MM. Null when the key is not a month. */
export function monthBounds(monthKey: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${monthKey}-01`,
    to: `${monthKey}-${String(last).padStart(2, "0")}`,
  };
}

export function formatMonthLabel(monthKey: string): string {
  const bounds = monthBounds(monthKey);
  if (!bounds) return monthKey;
  return `${MONTH_LABELS[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

/** Newest month first. A month appears only when it has at least one note. */
export function monthsWithNotes<T extends { noteDate: string }>(notes: T[]): string[] {
  return [...new Set(notes.map((note) => note.noteDate.slice(0, 7)).filter((key) => monthBounds(key)))].sort(
    (a, b) => b.localeCompare(a),
  );
}

/**
 * The month's progress notes, unchanged. This is the packet an agency prints
 * for that month. It does not write a narrative.
 */
export function shiftNotesForMonth<T extends { noteDate: string }>(notes: T[], monthKey: string) {
  const bounds = monthBounds(monthKey);
  if (!bounds) return { from: monthKey, to: monthKey, notes: [] as T[] };
  return {
    from: bounds.from,
    to: bounds.to,
    notes: notes.filter((note) => note.noteDate >= bounds.from && note.noteDate <= bounds.to),
  };
}

/**
 * Notes an agency would print: the last 14 days when any exist, otherwise the
 * newest 14 days still on the chart. A saved demo must not go blank just
 * because the calendar moved on.
 */
export function shiftNotesForPrint<T extends { noteDate: string }>(notes: T[], today: string) {
  const calendarFrom = addDays(today, -13);
  const current = notes.filter((note) => note.noteDate >= calendarFrom && note.noteDate <= today);
  if (current.length > 0) {
    return { from: calendarFrom, to: today, notes: current, coversToday: true as const };
  }
  const newest = notes.map((note) => note.noteDate).sort().at(-1);
  if (!newest) {
    return { from: calendarFrom, to: today, notes: [] as T[], coversToday: true as const };
  }
  const from = addDays(newest, -13);
  return {
    from,
    to: newest,
    notes: notes.filter((note) => note.noteDate >= from && note.noteDate <= newest),
    coversToday: false as const,
  };
}
