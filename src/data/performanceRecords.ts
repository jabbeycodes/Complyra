/**
 * performanceRecords.ts — Performance Reviews + Corrective Actions
 * (New Hire Binder build 3, founder commission 2026-10-30).
 *
 * The paper binder's last two sections — "Performance Review" and
 * "Corrective Action" — digitized as first-class HR records in the
 * employee file. Both are APPEND-ONLY history: once filed, a record's
 * content never changes. The only fields that move after filing are the
 * state fields named on each type (the employee's acknowledgment, the
 * one response note on a review, a corrective action's outcome). A
 * correction is a NEW record that supersedes the earlier one
 * (supersedesId) — the earlier record stays readable forever.
 *
 * Visibility mirrors the Employee Hub's team-management scoping (the
 * time-off chain rule): the staff member themselves; HR and agency
 * administrators agency-wide; hub.view_team holders in the subject's
 * management chain (program managers agency-wide; house managers for
 * their own home's staff); auditors READ-ONLY (the platform rule —
 * auditors see everything, change nothing). Peers never see these
 * records. Filing belongs to the same chain (never the subject, never
 * an auditor).
 *
 * This module is pure: record shapes, labels, validation, the gate
 * helpers the UI and store share, and the binder-evidence summary.
 * Persistence lives on HrStore (local + hosted), like the binder.
 */

/* ------------------------------------------------------------------ */
/* Performance reviews                                                 */
/* ------------------------------------------------------------------ */

export const PERFORMANCE_RATINGS = [
  "Exceeds expectations",
  "Meets expectations",
  "Developing",
  "Unsatisfactory",
] as const;

export type PerformanceRating = (typeof PERFORMANCE_RATINGS)[number];

export type PerformanceReviewState = "filed" | "acknowledged";

export const PERFORMANCE_REVIEW_STATE_LABELS: Record<PerformanceReviewState, string> = {
  filed: "Filed — awaiting acknowledgment",
  acknowledged: "Acknowledged",
};

export interface PerformanceReview {
  id: string;
  agencyId: string;
  staffId: string;
  reviewDate: string;
  periodStart: string;
  periodEnd: string;
  reviewerId: string;
  reviewerName: string;
  rating: PerformanceRating;
  strengths: string;
  growthAreas: string;
  goals: string;
  state: PerformanceReviewState;
  /** The employee's typed signature; null until they acknowledge. */
  ackSignatureName: string | null;
  ackAt: string | null;
  /** The employee's ONE response note, appended after acknowledging. */
  responseNote: string | null;
  responseAt: string | null;
  /** A correction files a new review pointing at the one it replaces. */
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceReviewInput {
  staffId: string;
  reviewDate: string;
  periodStart: string;
  periodEnd: string;
  reviewerName: string;
  rating: PerformanceRating;
  strengths: string;
  growthAreas: string;
  goals: string;
  supersedesId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Corrective actions (HR discipline — NOT the QA corrective actions   */
/* in correctiveActions.ts, which track audit findings to resolution)  */
/* ------------------------------------------------------------------ */

export const CORRECTIVE_ACTION_LEVELS = [
  "Verbal warning",
  "Written warning",
  "Performance improvement plan",
  "Suspension",
  "Final warning",
] as const;

export type CorrectiveActionLevel = (typeof CORRECTIVE_ACTION_LEVELS)[number];

export type CorrectiveActionAckState = "pending" | "signed" | "declined";

export const CORRECTIVE_ACTION_ACK_LABELS: Record<CorrectiveActionAckState, string> = {
  pending: "Awaiting acknowledgment",
  signed: "Signed by the staff member",
  declined: "Declined to sign — witnessed",
};

export const CORRECTIVE_ACTION_OUTCOMES = [
  "open",
  "resolved",
  "extended",
  "escalated",
] as const;

export type CorrectiveActionOutcome = (typeof CORRECTIVE_ACTION_OUTCOMES)[number];

export const CORRECTIVE_ACTION_OUTCOME_LABELS: Record<CorrectiveActionOutcome, string> = {
  open: "Open",
  resolved: "Resolved",
  extended: "Extended",
  escalated: "Escalated",
};

export interface StaffCorrectiveAction {
  id: string;
  agencyId: string;
  staffId: string;
  actionDate: string;
  issuerId: string;
  issuerName: string;
  level: CorrectiveActionLevel;
  /** What happened. */
  description: string;
  /** What must change. */
  expectations: string;
  followUpDate: string | null;
  ackState: CorrectiveActionAckState;
  /** Typed signature when ackState is "signed". */
  ackSignatureName: string | null;
  ackAt: string | null;
  /** Named witness when ackState is "declined" (both are terminal). */
  witnessName: string | null;
  outcome: CorrectiveActionOutcome;
  outcomeNote: string | null;
  outcomeAt: string | null;
  outcomeByName: string | null;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffCorrectiveActionInput {
  staffId: string;
  actionDate: string;
  issuerName: string;
  level: CorrectiveActionLevel;
  description: string;
  expectations: string;
  followUpDate?: string | null;
  supersedesId?: string | null;
}

/** How the staff member answers a corrective action: sign it, or
 *  decline to sign in front of a named witness. */
export type CorrectiveActionAckInput =
  | { kind: "signed"; signatureName: string }
  | { kind: "declined"; witnessName: string };

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function requireText(value: string, message: string): void {
  if (!value || !value.trim()) throw new Error(message);
}

function requireDate(value: string, message: string): void {
  if (!isDate(value)) throw new Error(message);
}

export function validatePerformanceReviewInput(input: PerformanceReviewInput): void {
  requireDate(input.reviewDate, "Enter the review date.");
  requireDate(input.periodStart, "Enter the review period start.");
  requireDate(input.periodEnd, "Enter the review period end.");
  if (input.periodEnd < input.periodStart) {
    throw new Error("The review period ends before it starts.");
  }
  if (!PERFORMANCE_RATINGS.includes(input.rating)) {
    throw new Error("Choose the review rating.");
  }
  requireText(input.reviewerName, "The reviewer's name is required.");
  requireText(input.strengths, "Record the staff member's strengths.");
  requireText(input.growthAreas, "Record the growth areas.");
  requireText(input.goals, "Record the goals for the next period.");
}

export function validateStaffCorrectiveActionInput(
  input: StaffCorrectiveActionInput,
): void {
  requireDate(input.actionDate, "Enter the action date.");
  if (!CORRECTIVE_ACTION_LEVELS.includes(input.level)) {
    throw new Error("Choose the corrective action level.");
  }
  requireText(input.issuerName, "The issuer's name is required.");
  requireText(input.description, "Describe what happened.");
  requireText(input.expectations, "Record what must change.");
  if (input.followUpDate != null && input.followUpDate !== "") {
    requireDate(input.followUpDate, "Enter a valid follow-up date.");
  }
  if (input.level === "Performance improvement plan" && !input.followUpDate) {
    throw new Error("A performance improvement plan needs a follow-up date.");
  }
}

export function validateAcknowledgmentSignature(signatureName: string): void {
  requireText(signatureName, "Type your full name to sign.");
}

export function validateCorrectiveActionAck(input: CorrectiveActionAckInput): void {
  if (input.kind === "signed") {
    requireText(input.signatureName, "Type your full name to sign.");
  } else {
    requireText(input.witnessName, "Name the staff member who witnessed the decline.");
  }
}

export function validateReviewResponse(note: string): void {
  requireText(note, "Write your response before saving it.");
}

export function validateCorrectiveActionOutcome(note: string): void {
  requireText(note, "Add a note saying how the outcome was reached.");
}

/* ------------------------------------------------------------------ */
/* Visibility + filing gates (shared by the Hub UI)                    */
/* ------------------------------------------------------------------ */

export interface PerformanceViewer {
  userId: string;
  roleKey: string;
  /** The viewer's home site (SessionUser.siteId); null = agency-wide. */
  siteId: string | null;
  /** hub.view_team — the hub's team-management permission. */
  canViewTeam: boolean;
}

export interface PerformanceSubject {
  userId: string;
  siteId: string | null;
}

const AGENCY_WIDE_READ_ROLES = ["administrator", "hr", "auditor"];
const FILING_ROLES = ["administrator", "hr"];

/**
 * The management-chain rule, mirroring how the hub scopes team
 * management (and the hosted time-off visibility rule): a hub.view_team
 * holder reaches a subject when they are a program manager (agency-wide
 * chain), or their home matches the subject's home. A viewer or subject
 * with no home site reads as program-level and matches.
 */
export function inManagementChain(
  viewer: PerformanceViewer,
  subject: PerformanceSubject,
): boolean {
  if (!viewer.canViewTeam) return false;
  if (viewer.roleKey === "program_manager") return true;
  // The agency-wide read roles, when they also hold the team permission.
  if (AGENCY_WIDE_READ_ROLES.includes(viewer.roleKey)) return true;
  // Everyone else in the chain (house managers above all) is scoped to
  // their home, the hosted time-off rule exactly: the subject must HAVE
  // a home, and it must be the viewer's (a viewer with no home site is
  // program-level and matches any home).
  if (subject.siteId === null) return false;
  return viewer.siteId === null || viewer.siteId === subject.siteId;
}

/** Who may OPEN a staff member's performance file. Peers: never. */
export function canViewPerformanceRecords(
  viewer: PerformanceViewer,
  subject: PerformanceSubject,
): boolean {
  if (viewer.userId === subject.userId) return true;
  if (AGENCY_WIDE_READ_ROLES.includes(viewer.roleKey)) return true;
  return inManagementChain(viewer, subject);
}

/**
 * Who may FILE on a staff member: HR/administrators, plus the subject's
 * HM/PM chain. Never the subject themselves; never an auditor (read is
 * their whole grant); never a peer.
 */
export function canFilePerformanceRecords(
  viewer: PerformanceViewer,
  subject: PerformanceSubject,
): boolean {
  if (viewer.userId === subject.userId) return false;
  if (viewer.roleKey === "auditor") return false;
  if (FILING_ROLES.includes(viewer.roleKey)) return true;
  return inManagementChain(viewer, subject);
}

/** Outcomes are set by the action's issuer, or by HR/administrators. */
export function canSetCorrectiveActionOutcome(
  viewer: PerformanceViewer,
  action: Pick<StaffCorrectiveAction, "issuerId">,
): boolean {
  if (viewer.roleKey === "auditor") return false;
  if (viewer.userId === action.issuerId) return true;
  return FILING_ROLES.includes(viewer.roleKey);
}

/* ------------------------------------------------------------------ */
/* Timeline + binder evidence                                          */
/* ------------------------------------------------------------------ */

export type PerformanceTimelineEntry =
  | { kind: "review"; date: string; review: PerformanceReview }
  | { kind: "action"; date: string; action: StaffCorrectiveAction };

/** Reviews and actions interleaved newest-first — one employee file. */
export function performanceTimeline(
  reviews: PerformanceReview[],
  actions: StaffCorrectiveAction[],
): PerformanceTimelineEntry[] {
  const entries: PerformanceTimelineEntry[] = [
    ...reviews.map(
      (review): PerformanceTimelineEntry => ({
        kind: "review",
        date: review.reviewDate,
        review,
      }),
    ),
    ...actions.map(
      (action): PerformanceTimelineEntry => ({
        kind: "action",
        date: action.actionDate,
        action,
      }),
    ),
  ];
  return entries.sort((a, b) =>
    a.date === b.date
      ? a.kind === b.kind
        ? 0
        : a.kind === "review"
          ? -1
          : 1
      : a.date < b.date
        ? 1
        : -1,
  );
}

export interface PerformanceRecordsSummary {
  reviewCount: number;
  latestReviewOn: string | null;
  actionCount: number;
  latestActionOn: string | null;
}

/** The binder's "records" evidence: counts + latest dates, nothing more. */
export function summarizePerformanceRecords(
  reviews: PerformanceReview[],
  actions: StaffCorrectiveAction[],
): PerformanceRecordsSummary {
  const latest = (dates: string[]): string | null =>
    dates.length ? dates.slice().sort().at(-1) ?? null : null;
  return {
    reviewCount: reviews.length,
    latestReviewOn: latest(reviews.map((r) => r.reviewDate)),
    actionCount: actions.length,
    latestActionOn: latest(actions.map((a) => a.actionDate)),
  };
}
