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
}

export interface ShiftNote {
  id: string;
  agencyId: string;
  individualId: string;
  programId: string;
  noteDate: string;
  shift: string;
  /** "Other" summary: narrative + anything not task-specific. */
  summary: string;
  timeSpentMinutes: number | null;
  staffUserId: string;
  staffName: string;
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

/**
 * Issue #96 — the manager's monthly summary report for an Individual's shift
 * notes in one calendar month. The narrative is a draft until signed; a
 * signed report is locked (a PM/administrator may re-open it). Soft deletes
 * preserved like shift notes.
 */
export interface ShiftNoteMonthlyReport {
  id: string;
  agencyId: string;
  individualId: string;
  programId: string;
  /** Calendar month as "YYYY-MM". */
  month: string;
  /** Manager's narrative summary for the month. */
  narrative: string;
  signedBy: string;
  signedByName: string;
  signedByTitle: string;
  /** ISO timestamp of the signature; "" while unsigned. */
  signedAt: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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

export function normalizeTaskTitle(title: string): string {
  return title.trim().slice(0, 200);
}
