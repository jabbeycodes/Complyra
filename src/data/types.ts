import type { Category, Status } from "../domain";

export type AppRole =
  | "administrator"
  | "compliance_admin"
  | "manager"
  | "dsp"
  | "nurse"
  | "hr"
  | "auditor";

export type DocumentKind =
  | "pcsp"
  | "isp"
  | "policy"
  | "consultation"
  | "doctor_notes"
  | "physician_orders"
  | "other";
export type ReviewStatus = "pending_review" | "active" | "archived";
export type PacketStatus = "open" | "archived";

export type AgencyProvisionedBy = "self" | "platform";
export type AgencyStatus = "pending" | "active" | "rejected";

export interface Agency {
  id: string;
  name: string;
  agencyCode: string;
  stateCode: string;
  provisionedBy?: AgencyProvisionedBy;
  status: AgencyStatus;
  monthlyDue?: import("./monthlyChecks").MonthlyDueSettings;
  logoPath?: string | null;
}

export interface Program {
  id: string;
  agencyId: string;
  name: string;
}

export type SiteServiceType = "ISL" | "GH" | "SL" | "DH" | "CN" | "ISD";

export interface SiteRecord {
  id: string;
  agencyId: string;
  programId: string;
  name: string;
  address: string;
  serviceType?: SiteServiceType;
  staffed24h?: boolean;
  overnightSleepStaff?: boolean;
  wellWater?: boolean;
  lastWaterTestOn?: string;
  sitePhone?: string;
  contactName?: string;
  contactPhone?: string;
  city?: string;
  county?: string;
  zip?: string;
}

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string;
  username: string;
  homeAgencyId: string;
  mustChangePassword: boolean;
  platformAdmin?: boolean;
}

export interface Membership {
  id: string;
  agencyId: string;
  userId: string;
  role: AppRole;
  roleKey: string;
  siteId: string | null;
  expiresOn: string | null;
}

export interface IndividualRecord {
  id: string;
  agencyId: string;
  siteId: string;
  fullName: string;
  dateOfBirth: string;
  profile?: import("./planStack").IndividualProfile;
}

export interface StaffAssignment {
  id: string;
  agencyId: string;
  userId: string;
  individualId: string | null;
  siteId: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface DocumentRecord {
  id: string;
  agencyId: string;
  individualId: string;
  title: string;
  kind: DocumentKind;
}

export interface DocumentVersion {
  id: string;
  agencyId: string;
  documentId: string;
  versionLabel: string;
  status: ReviewStatus;
  storagePath: string | null;
  contentHash: string | null;
  pageCount: number;
  effectiveOn: string;
  expiresOn: string | null;
  createdBy: string | null;
}

export interface RequirementRecord {
  id: string;
  agencyId: string;
  documentVersionId: string | null;
  individualId: string | null;
  siteId: string;
  title: string;
  category: Category;
  ownerUserId: string | null;
  dueOn: string;
  frequency: string;
  sourcePage: number;
  status: Status;
  evidenceNote: string;
  completedAt?: string;
}

export interface AcknowledgmentPacket {
  id: string;
  agencyId: string;
  individualId: string;
  documentVersionId: string;
  whatAcknowledging: string;
  startsOn: string;
  endsOn: string | null;
  status: PacketStatus;
}

export interface AcknowledgmentRow {
  id: string;
  agencyId: string;
  packetId: string;
  userId: string;
  staffName: string;
  addedManually: boolean;
  addReason: string | null;
  openedAt: string | null;
  signedAt: string | null;
  signatureName: string | null;
  signatureMark: string | null;
}

export interface AuditEvent {
  id: string;
  agencyId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  createdAt: string;
}

export interface SessionUser {
  userId: string;
  email: string;
  username: string;
  fullName: string;
  jobTitle: string;
  role: AppRole;
  roleKey: string;
  agencyId: string;
  agencyName: string;
  agencyCode: string;
  siteId: string | null;
  mustChangePassword: boolean;
  expiresOn: string | null;
  permissions: Record<string, boolean>;
  platformAdmin: boolean;
  agencyStatus: AgencyStatus;
}

export interface LoginInput {
  agencyCode: string;
  username: string;
  password: string;
}

export interface InviteMemberInput {
  fullName: string;
  username: string;
  tempPassword: string;
  roleKey: string;
  jobTitle?: string;
  siteId?: string | null;
  expiresOn?: string | null;
}

export interface InviteMemberResult {
  username: string;
  agencyCode: string;
  fullName: string;
  role: AppRole;
}

export interface CreateAgencyInput {
  name: string;
  stateCode: string;
  slug: string;
  adminFullName: string;
  adminUsername: string;
  adminTempPassword: string;
  provisionedBy?: AgencyProvisionedBy;
}

export interface CreateAgencyResult {
  agencyCode: string;
  username: string;
  fullName: string;
  status: AgencyStatus;
}

export interface PendingAgency {
  id: string;
  name: string;
  agencyCode: string;
  stateCode: string;
  provisionedBy: AgencyProvisionedBy;
  status: AgencyStatus;
}

export interface PacketDetail {
  packet: AcknowledgmentPacket;
  individual: IndividualRecord;
  site: SiteRecord;
  version: DocumentVersion;
  document: DocumentRecord;
  rows: AcknowledgmentRow[];
}

export interface UploadDocumentInput {
  individualId: string;
  title?: string;
  kind?: DocumentKind;
  file: File;
  pageCount: number;
  effectiveOn: string;
  expiresOn?: string;
  requirementTitle?: string;
  category?: Category;
  ownerUserId?: string;
  dueOn?: string;
  frequency?: string;
  sourcePage?: number;
}

export const DEMO_PASSWORD = "Evergreen!demo1";

export const USERNAME_PATTERN = /^[a-z0-9.]{3,40}$/;

export const LOGIN_FAILED_MESSAGE =
  "That agency code, username, or password is not recognized.";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export { normalizeAgencyCode } from "./agencyCode";

// ===== LIFEPATH-P2 TYPES (training engine) =====
/** Section numbers of the LifePath in-home training checklist (section 6 repeats per individual). */
export type TrainingSectionNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type TrainingTopicScope = "agency" | "site";
/** "checklist" = the ~65 verbatim checklist topics; "supplemental" = A1-A6 sets from extraction notes. */
export type TrainingTopicSourceKind = "checklist" | "supplemental";
export interface TrainingTopic {
  /** Stable seed id, e.g. "chk-1-03", "chk-6-11", "gt-07", "law-04", "cor-02". */
  id: string;
  section: TrainingSectionNumber;
  /** Verbatim from the source document (checklist transcription or extraction notes). */
  title: string;
  /** True only for section 6 and per-individual supplemental sets (G-tube, acknowledgments). */
  perIndividual: boolean;
  scope: TrainingTopicScope;
  /** True for reusable sets like the G-tube competency template (per Joshua's build decision). */
  reusableTemplate: boolean;
  source: TrainingTopicSourceKind;
  /** Display set name, e.g. "In-home training checklist", "G-tube competency template". */
  setName: string;
}
export type TrainingRequirementSource = "checklist" | "plan_version" | "corrective" | "delegation";
export type TrainingRequirementStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "overdue"
  | "waived_na";
export type TrainingMethod = "shadowing" | "classroom" | "video" | "hands-on" | "reading";
export interface TrainingRequirement {
  id: string;
  agencyId: string;
  /** Staff member the requirement belongs to. */
  userId: string;
  topicId: string;
  /** Set only for section-6 / per-individual topics. */
  individualId: string | null;
  siteId: string | null;
  source: TrainingRequirementSource;
  planVersionId: string | null;
  delegationId: string | null;
  /** "overdue" is derived on read when dueOn passes; the rest are stored. */
  status: TrainingRequirementStatus;
  dueOn: string | null;
  createdAt: string;
}
export interface TrainingSignoff {
  id: string;
  requirementId: string;
  /** Typed initials, NOT a checkmark. */
  initials: string;
  signedOn: string;
  /** N/A allowed; no blanks — every line must be initialed or N/A. */
  na: boolean;
  naReason: string | null;
  trainerName: string;
  method: TrainingMethod | null;
  hoursTotal: number;
  hoursWithHm: number;
  competencyText: string | null;
  observerName: string | null;
  observerSignature: string | null;
  evidenceRef: string | null;
  /** e.g. "annual" */
  renewalRule: string | null;
  nextDueOn: string | null;
  createdAt: string;
}
export interface TrainingCountersignature {
  id: string;
  agencyId: string;
  userId: string;
  siteId: string;
  staffSignatureName: string | null;
  staffSignatureMark: string | null;
  staffSignedAt: string | null;
  hmSignatureName: string | null;
  hmSignatureMark: string | null;
  hmSignedAt: string | null;
}
/** Full per-line sign-off payload for a training requirement line. */
export interface RequirementLineSignoffInput {
  initials: string;
  signedOn?: string;
  trainerName: string;
  method?: TrainingMethod;
  hoursTotal?: number;
  hoursWithHm?: number;
  competencyText?: string;
  observerName?: string;
  observerSignature?: string;
  evidenceRef?: string;
  renewalRule?: string;
  nextDueOn?: string;
}
/** Optional extra sign-off detail accepted by the legacy initialTrainingLine (backward compat). */
export interface LegacyLineSignoffInput {
  initials?: string;
  trainerName?: string;
  method?: TrainingMethod;
  hoursTotal?: number;
  hoursWithHm?: number;
  notes?: string;
}
export interface AssignTrainingInput {
  userId: string;
  siteId?: string | null;
  individualId?: string | null;
  source: TrainingRequirementSource;
  planVersionId?: string | null;
  delegationId?: string | null;
  /** Topic ids to generate; defaults to the full in-home checklist when source is "checklist". */
  topicIds?: string[];
  dueOn?: string | null;
}
export interface TrainingRequirementView extends TrainingRequirement {
  topicTitle: string;
  section: TrainingSectionNumber;
  perIndividual: boolean;
  individualName: string | null;
  signoff: TrainingSignoff | null;
  resolvedStatus: TrainingRequirementStatus;
}
export interface StaffTrainingProfile {
  userId: string;
  fullName: string;
  siteNames: string[];
  individualNames: { id: string; fullName: string }[];
  requirements: TrainingRequirementView[];
  countersignatures: TrainingCountersignature[];
  hoursTotal: number;
  hoursWithHm: number;
  counts: { required: number; complete: number; pending: number; overdue: number; waived: number };
  clearedForInRatio: boolean;
  gateReasons: string[];
  /** Extension point for Phase 4 (certificate tracking). */
  certificates: never[];
}
export interface StaffClearanceRow {
  userId: string;
  fullName: string;
  siteName: string;
  clearedForInRatio: boolean;
  gateReasons: string[];
  pendingCount: number;
  overdueCount: number;
  hoursTotal: number;
  hoursWithHm: number;
}
// ===== LIFEPATH-P3 TYPES (delegation forms) =====

/**
 * Which rendering template produced a delegation record. The detail view's
 * template toggle switches RENDERING only — one underlying delegation record.
 */
export type DelegationTemplateVersion = "lifepath_exact" | "complyrer_improved";

export type DelegationRescindReason = "health_status_change" | "other";

/** One row of the 12-row employee roster on the RN delegation form. */
export interface DelegationRosterRow {
  printName: string;
  title: string;
  staffSignature: string | null;
  signatureName: string | null;
  signedAt: string | null;
  /** Per-row rescinded date from the paper form's roster table. */
  rescindedDate: string | null;
  initials: string | null;
  /** Complyrer improved template: competency checklist selections. */
  competency: string[];
}

export interface DelegationInstructingProfessional {
  name: string;
  title: string;
  signedAt: string | null;
  contactNumber: string;
}

export interface DelegationDelegatingRn {
  name: string;
  signatureName: string | null;
  dateSigned: string | null;
  contactNumber: string;
}

/**
 * Full "LifePath RN Delegation of Specified Nursing Task Form" (extraction
 * notes B4), stored as one jsonb object on the delegation obligation. One
 * form per individual per task; delegation is non-transferable.
 */
export interface DelegationForm {
  templateVersion: DelegationTemplateVersion;
  purpose: string;
  /** PROCEDURES / steps to follow to perform the task. */
  procedures: string;
  /** What to OBSERVE for and REPORT, what to DO and WHOM to CONTACT. */
  observeReportDo: string;
  nonTransferableAcknowledged: boolean;
  /** Free text; the paper form leaves this "as determined by the delegating RN". */
  inspectionInterval: string;
  /** Improved template only: explicit review/expiry date (the paper form prints none). */
  reviewDate: string | null;
  /** Improved template only: structured inspection cadence with reminders. */
  inspectionCadence: string | null;
  instructingProfessional: DelegationInstructingProfessional;
  delegatingRn: DelegationDelegatingRn;
  rescindReason: DelegationRescindReason | null;
  rescindExplanation: string;
  /** 12 rows, like the paper form. */
  roster: DelegationRosterRow[];
}

export const DELEGATION_ROSTER_ROWS = 12;

/** Patch shape accepted by updateDelegationForm (local + hosted). */
export type DelegationFormPatch = Partial<
  Omit<DelegationForm, "roster" | "instructingProfessional" | "delegatingRn" | "templateVersion">
> & {
  instructingProfessional?: Partial<DelegationInstructingProfessional>;
  delegatingRn?: Partial<DelegationDelegatingRn>;
  roster?: DelegationRosterRow[];
};

/** Verbatim from the LifePath paper form — reproduce word-for-word. */
export const DELEGATION_NON_TRANSFERABILITY_CLAUSE =
  "The following agency employees have been trained by a licensed person, demonstrate competency in all instructed procedures and are being delegated the task indicated above. This delegation and individualized instruction is specific to this individual and may not be transferred to other individuals with similar needs within this or other agencies";

/** Verbatim from the LifePath paper form — reproduce word-for-word. */
export const DELEGATION_RN_RESPONSIBILITY_CLAUSE =
  "The delegating RN is responsible for the provision of guidance and ongoing evaluation for the delegated nursing task, including periodic inspection based at intervals determined by the delegating RN. The delegating RN maintains authority to require corrective action or rescind delegation of this task.";

/** Complyrer improved template: competency checklist offered per roster row. */
export const DELEGATION_COMPETENCY_ITEMS = [
  "Demonstrates all instructed procedures",
  "Knows what to observe and report",
  "Knows whom to contact and when",
  "Understands documentation requirements",
] as const;

/** Complyrer improved template: structured inspection cadence options. */
export const DELEGATION_INSPECTION_CADENCES = [
  "Weekly",
  "Every 2 weeks",
  "Monthly",
  "Quarterly",
] as const;

export function blankDelegationRoster(): DelegationRosterRow[] {
  return Array.from({ length: DELEGATION_ROSTER_ROWS }, () => ({
    printName: "",
    title: "",
    staffSignature: null,
    signatureName: null,
    signedAt: null,
    rescindedDate: null,
    initials: null,
    competency: [],
  }));
}

export function blankDelegationForm(
  templateVersion: DelegationTemplateVersion = "lifepath_exact",
): DelegationForm {
  return {
    templateVersion,
    purpose: "",
    procedures: "",
    observeReportDo: "",
    nonTransferableAcknowledged: false,
    inspectionInterval: "As determined by the delegating RN",
    reviewDate: null,
    inspectionCadence: null,
    instructingProfessional: {
      name: "",
      title: "",
      signedAt: null,
      contactNumber: "",
    },
    delegatingRn: { name: "", signatureName: null, dateSigned: null, contactNumber: "" },
    rescindReason: null,
    rescindExplanation: "",
    roster: blankDelegationRoster(),
  };
}

/** Pure summary used by the UI and unit tests. */
export function delegationFormStatus(form: DelegationForm): {
  rowsNamed: number;
  rowsSigned: number;
  rowsRescinded: number;
  fullySigned: boolean;
  rescinded: boolean;
} {
  const named = form.roster.filter((row) => row.printName.trim().length > 0);
  const signed = named.filter((row) => row.signedAt);
  const rescindedRows = named.filter((row) => row.rescindedDate);
  return {
    rowsNamed: named.length,
    rowsSigned: signed.length,
    rowsRescinded: rescindedRows.length,
    fullySigned: named.length > 0 && signed.length === named.length,
    rescinded: form.rescindReason !== null,
  };
}

/**
 * Improved-template review reminder state. Returns null when the exact
 * template is in use without a review date set.
 */
export function delegationReviewState(
  form: DelegationForm,
  today = new Date().toISOString().slice(0, 10),
): { label: string; overdue: boolean; dueSoon: boolean } | null {
  if (!form.reviewDate) return null;
  const days = Math.round(
    (new Date(form.reviewDate).getTime() - new Date(today).getTime()) / 86400000,
  );
  if (days < 0) return { label: `Review overdue by ${-days} day${-days === 1 ? "" : "s"}`, overdue: true, dueSoon: true };
  if (days === 0) return { label: "Review due today", overdue: false, dueSoon: true };
  if (days <= 30)
    return { label: `Review due in ${days} day${days === 1 ? "" : "s"}`, overdue: false, dueSoon: true };
  return { label: `Review due ${form.reviewDate}`, overdue: false, dueSoon: false };
}
// ===== LIFEPATH-P4 TYPES (certificates) =====
// LIFEPATH-P4 (certificates): staff certificate tracking for HR.

/** A staff certificate record (CPR, CPI, PBS, L1MA, or free text). */
export interface StaffCertificate {
  id: string;
  agencyId: string;
  userId: string;
  certName: string;
  issuedOn: string; // ISO yyyy-mm-dd
  expiresOn: string; // ISO yyyy-mm-dd (renewal date)
  filePath: string | null; // Supabase Storage path (bucket: staff-certificates)
  fileName: string | null;
  enteredBy: string; // userId of the HR member who recorded it
  createdAt: string; // ISO timestamp
}

export interface AddCertificateInput {
  userId: string;
  certName: string;
  issuedOn: string;
  expiresOn: string;
}

export interface UpdateCertificateInput {
  certName?: string;
  issuedOn?: string;
  expiresOn?: string;
}

export interface UploadCertificateFileInput {
  userId: string;
  file: File;
  certName: string;
  issuedOn: string;
  expiresOn: string;
}

/** A certificate enriched for HR views: staff name + live days-remaining countdown. */
export interface ExpiringCertificate extends StaffCertificate {
  staffName: string;
  daysRemaining: number;
}
// ===== LIFEPATH-P5 TYPES (HM weekly checklist) =====
export type ChecklistAnswer = "Y" | "N" | "N/A";

export interface ChecklistItem {
  key: string;
  prompt: string;
  answer: ChecklistAnswer | null;
  note: string;
  /** Item 21 is auto-computed from training data and cannot be answered by hand. */
  autoComputed?: boolean;
}

export type ServiceLogKind =
  | "class_reminder"
  | "call_in"
  | "direct_care"
  | "off_shift"
  | "issue";

export interface ServiceLogEntry {
  id: string;
  kind: ServiceLogKind;
  detail: string;
  staffName?: string | null;
  dateTime?: string | null;
  createdAt: string;
}

export interface ChecklistAttestation {
  signedBy: string;
  signedAt: string;
  signatureMark: string;
}

export type WeeklyChecklistStatus = "open" | "submitted" | "overdue" | "locked";

export interface HmWeeklyChecklist {
  id: string;
  agencyId: string;
  siteId: string;
  /** ISO date of the Sunday that opens the week. */
  weekOf: string;
  /** The HM this instance is assigned to. */
  assignedToUserId: string;
  /** The DPM (or system rollover) that created the assignment. */
  assignedByUserId: string | null;
  status: WeeklyChecklistStatus;
  submittedAt: string | null;
  items: ChecklistItem[];
  serviceLogs: ServiceLogEntry[];
  attestation: ChecklistAttestation | null;
  createdAt: string;
  updatedAt: string;
}
// ===== LIFEPATH-P6 TYPES (med inventory) =====
