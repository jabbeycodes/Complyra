import { recheckQaItemForScoring } from "./qaAudit";
import type { Activity, Plan, Requirement } from "../domain";
import { AGENCY_ID, createEvergreenSeed, type LocalDatabase } from "./seed";
import type {
  LocalAgencyAiSettings,
  LocalDocumentAuditEntry,
  LocalDocumentExtraction,
} from "./seed";
import type {
  DocumentStatus,
  DocumentType,
  DocumentUpload,
  PcspExtraction,
  TrackableItem,
  TrackableItemType,
} from "./documents";
import {
  canTransitionTrackableItem,
  canTransitionUpload,
  DOCUMENT_DIGITAL_MARK,
  DOCUMENT_TYPES,
  validateExtraction,
} from "./documents";
import {
  agencyLogoPath,
  blobToDataUrl,
  canManageAgencyLogo,
  evergreenDemoLogoBytes,
  evergreenDemoLogoDataUrl,
  validateLogoFile,
} from "./branding";
import { metrics } from "../domain";
import {
  computeRequirementStatus,
  isPrivileged,
  requirementStatusFromDb,
  reviewStatusLabel,
  roleLabel,
} from "./status";
import {
  PLAN_SIGNER_ROLE_KEYS,
  ROLE_TEMPLATES,
  canCreateIndividual,
  canCreateSite,
  capabilityForRoleKey,
  canGrantRole,
  checkRoleTemplateUpdate,
  defaultPermissions,
  hasPermission,
  isRoleKey,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";
import { generateTempPassword } from "./agencyCode";
import { canAccessSite, isAgencyWideViewer } from "./dashboard";
import { canReadIndividual, assertCalendarDate } from "./access";
import type {
  AcknowledgmentPacket,
  AddCertificateInput,
  AddMedDoseExceptionInput,
  AppRole,
  AssignTrainingInput,
  ChecklistAnswer,
  DelegationFormPatch,
  DelegationTemplateVersion,
  DocumentVersion,
  DoseExceptionKind,
  ExpiringCertificate,
  HmWeeklyChecklist,
  IndividualRecord,
  CreateAgencyInput,
  CreateAgencyResult,
  AgencyStatus,
  InviteMemberInput,
  InviteMemberResult,
  LegacyLineSignoffInput,
  LoginInput,
  MedDoseException,
  PacketDetail,
  PendingAgency,
  RequestTrainingCorrectionInput,
  RequirementLineSignoffInput,
  RequirementRecord,
  ServiceLogEntry,
  ServiceLogKind,
  SessionUser,
  StaffCertificate,
  StaffClearanceRow,
  StaffTrainingProfile,
  TrainingCountersignature,
  TrainingRequirement,
  TrainingRequirementView,
  TrainingSignoff,
  TrainingTopic,
  UpdateCertificateInput,
  UploadCertificateFileInput,
  UploadDocumentInput,
  AdoptedSignature,
  AdoptSignatureInput,
  ApplySignatureInput,
  ApplySignatureResult,
  LogSignatureAuditInput,
  SignableDocumentType,
  SignatureAuditRecord,
  SignatureEvent,
  SignatureSettings,
  UserSignature,
} from "./types";
import { blankDelegationForm } from "./types";
import { DEFAULT_MONTHLY_DUE } from "./monthlyChecks";
import {
  dspRatingChangedPayload,
  dspWinnerBroadcastPayload,
  dspWinnerSelfPayload,
  hmReviewChangedPayload,
  hmWinnerBroadcastPayload,
  hmWinnerSelfPayload,
  delegationReviewReadyPayload,
  delegationPublishedPayload,
  delegationAckOverduePayload,
} from "../features/notifications/notify";
import {
  addDaysIso,
  buildHighlights,
  checklistDeadlineUtc,
  defaultRecognitionWeekStart,
  isValidRating,
  pickWinner,
  ratingLabel,
  rollingAverage,
  scoreDspWeek,
  scoreHmWeek,
} from "../recognition/scoring";
import {
  applyRenewalUpload,
  blankRnFields,
  canEditCover,
  canEditExtraction,
  canSeeRenewals,
  canSignAsDelegatingRn,
  canToggleDelegation,
  canUploadRenewal,
  defaultRenewals,
  emptyProfile,
  normalizeProfile,
  isObligationActive,
  proposeFromPcsp,
  requiredForSigning,
  renewalStatus,
  sortObligations,
  staffCanSignDelegation,
  type ClinicalEvidenceKind,
  type IndividualProfile,
  type ObligationItem,
  type PlanStackView,
} from "./planStack";
import {
  DIGITAL_RECORD_MARK,
  acknowledgmentDueAt,
  instantiateDraft,
  isAcknowledgmentOverdue,
  visibleMaterialForStaff,
  type DelegationAcknowledgment,
  type DelegationAckStatusRow,
  type DelegationTemplate,
  type DelegationTemplateCategory,
  type IndividualDelegationAssignment,
  type DelegationTrainingMaterial,
  type SiteDelegationActivation,
  type TemplateSections,
  type TrainingMaterialContent,
} from "../delegation/delegation";
// QA-AUDIT (2026-09-14): pure checklist/scoring module + API helpers.
import {
  QA_ITEM_MAP,
  nextQaDueDate,
  qaQuarterMonths,
  qaUndecidedItems,
  raiseQaDisputeState,
  rankQaSites,
  resolveQaDisputeState,
  scoreQaAudit,
  scoreQaItemState,
  type QaAudit,
  type QaAuditItemState,
  type QaAuditSchedule,
  type StoredQaAuditItem,
  type QaAutoVerifyContext,
  type QaRankedSite,
  type QaPhotoInput,
} from "./qaAudit";
import { expandAndVerifyQaItems } from "./qaAuditApi";
// LIFEPATH-P2: training engine seeds + pure gate logic (supporting import for the P2 markers).
import {
  TRAINING_TOPICS,
  TRAINING_TOPIC_BY_ID,
  individualChecklistTopics,
  planUpdateRetrainingTopicIds,
  renderTopicTitle,
  siteChecklistTopics,
} from "../features/training/topics";
import {
  computeNextDueOn,
  evaluateInRatioGate,
  LOCKED_TRAINING_SHEET_MESSAGE,
  resolveRequirementStatus,
  sumHours,
  validateTrainingLineInput,
} from "../features/training/gate";
import {
  allLinesInitialed,
  applyDailyMedDrop,
  canEditTrainingLine,
  canLogDoseException,
  canLogPrnDose,
  canRecordDelivery,
  canRequestTrainingCorrection,
  canSeeMeds,
  canSignTrainingAsHm,
  mergeTrainingLines,
  toMedicationView,
  todayIso,
  trainingLinesFromObligations,
  trainingStatus,
  type ChartFileKind,
} from "./chart";
import {
  daysRemaining,
  validateCertificateDates,
  validateCertificateFile,
} from "./certificates";
import {
  deriveCorrectiveActionStatus,
  sortCorrectiveActions,
  validateCorrectiveActionInput,
  type AddCorrectiveActionInput,
  type CorrectiveAction,
  type UpdateCorrectiveActionInput,
} from "./correctiveActions";
import {
  sortSnapshotsOldestFirst,
  type ComplianceScore,
  type ScoreSnapshot,
} from "./complianceScore";
import {
  canCompleteMonthly,
  canConfigureMonthlyDue,
  canManageEquipment,
  drillComplete,
  ensureMonthlyCycles,
  equipmentViewForPerson,
  monthKeyFrom,
  safetyComplete,
  siteSafetyView,
  drillDateConflict,
  drillDateConflictMessage,
  normalizeMonthlyDue,
  type AdaptiveEquipment,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
  type SafetyLine,
} from "./monthlyChecks";
import {
  applyItem21,
  applyItemAnswer,
  blankItemNumbers,
  buildChecklistItems,
  computeItem21,
  weekOfSundayIso,
  ITEM_21_KEY,
  type TrainingReadiness,
} from "./hmChecklist";
import {
  buildWeeklyChecklistPdf,
  buildWeeklyServiceLogPdf,
  weeklyChecklistPdfName,
  weeklyServiceLogPdfName,
} from "../pdf/hmChecklistPdf";
import {
  buildDrillsMonthPdf,
  buildEquipmentMonthPdf,
  buildSafetyMonthPdf,
  drillsFileName,
  equipmentFileName,
  safetyFileName,
} from "../pdf/monthlyChecksPdf";
import {
  applyWellWaterDefault,
  blankSiteReview,
  buildPreSurveyRow,
  canEditSiteReview,
  ensureSiteReviews,
  monthlySafetyOnFile,
  normalizeSiteFacts,
  normalizeSiteReview,
  siteFactsFrom,
  type SiteFacts,
  type SiteReview,
  type SiteReviewLineStatus,
} from "./siteReview";
import {
  buildPreSurveyPdf,
  buildSiteReviewPdf,
  preSurveyFileName,
  siteReviewFileName,
} from "../pdf/siteReviewPdf";
import {
  LOGIN_FAILED_MESSAGE,
  LOGIN_NO_MEMBERSHIP_MESSAGE,
  USERNAME_PATTERN,
  normalizeAgencyCode,
  normalizeUsername,
} from "./types";
import {
  buildAgencyCode,
  validateAgencyCodeParts,
} from "./agencyCode";
import {
  ADOPTED_SIGNATURE_MARK,
  assertAdoptableSignature,
  dataUrlToBlob,
  delegationRosterRowKey,
  formatSignatureDate,
  getDeviceId,
  REAUTH_WINDOW_MS,
  ReauthRequiredError,
  signatureDocumentHash,
  suggestInitials,
} from "../features/signatures/signatureUtils";
import {
  legacyTrainingDocId,
  trainingChecklistDocId,
} from "../features/signatures/documentPayloads";

const META_KEY = "complyra-v2-meta";
const FILE_PREFIX = "complyra-v2-file:";

export interface ComplyraApi {
  listNotifications(): Promise<import("../features/notifications/notify").NotificationRow[]>;
  markNotificationsRead(ids: string[]): Promise<void>;
  getSession(): Promise<SessionUser | null>;
  signIn(input: LoginInput): Promise<SessionUser>;
  signOut(): Promise<void>;
  changePassword(currentPassword: string, nextPassword: string): Promise<void>;
  createAgency(input: CreateAgencyInput): Promise<CreateAgencyResult>;
  inviteMember(input: InviteMemberInput): Promise<InviteMemberResult>;
  assignMemberRole(
    userId: string,
    roleKey: string,
    siteId?: string | null,
    expiresOn?: string | null,
  ): Promise<void>;
  updateAgencyRole(roleKey: string, permissions: PermissionMap): Promise<void>;
  resetMemberPassword(userId: string): Promise<{ tempPassword: string }>;
  listPendingAgencies(): Promise<PendingAgency[]>;
  setAgencyStatus(agencyId: string, status: AgencyStatus): Promise<void>;
  loadWorkspace(session: SessionUser): Promise<WorkspaceView>;
  createRequirementDraft(input: {
    individualId: string;
    title: string;
    category: Requirement["category"];
    ownerUserId: string;
    source: string;
    sourcePage: number;
    dueOn: string;
    frequency: string;
  }): Promise<void>;
  approveRequirement(id: string): Promise<void>;
  completeRequirement(id: string, evidence: string): Promise<void>;
  reassignRequirement(id: string, ownerUserId: string): Promise<void>;
  updateRequirement(
    id: string,
    patch: {
      title?: string;
      dueOn?: string;
      frequency?: string;
      ownerUserId?: string;
    },
  ): Promise<void>;
  uploadDocument(input: UploadDocumentInput): Promise<void>;
  getDocumentFile(versionId: string): Promise<Blob | null>;
  assignStaff(individualId: string, userId: string): Promise<void>;
  addPacketSigner(
    packetId: string,
    userId: string,
    reason: string,
  ): Promise<void>;
  markOpened(rowId: string): Promise<void>;
  signRow(
    rowId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<void>;
  updateIndividualProfile(
    individualId: string,
    profile: IndividualProfile,
  ): Promise<void>;
  updateObligation(
    obligationId: string,
    patch: Partial<
      Pick<
        ObligationItem,
        | "title"
        | "detail"
        | "mode"
        | "enabled"
        | "frequency"
        | "shiftPeriods"
        | "inventoryState"
        | "proposed"
      >
    >,
  ): Promise<void>;
  addProtocol(individualId: string, title: string, detail?: string): Promise<void>;
  promoteToShiftTask(
    obligationId: string,
    shiftPeriods: string[],
  ): Promise<void>;
  markObligationOpened(signatureId: string): Promise<void>;
  signObligation(
    signatureId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<void>;
  submitPlanPacket(individualId: string): Promise<void>;
  signDelegationRn(
    obligationId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<void>;
  uploadRenewalEvidence(input: {
    renewalId: string;
    evidenceKind: ClinicalEvidenceKind;
    documentTitle: string;
    uploadedOn?: string;
    file?: File;
  }): Promise<void>;
  discontinueDelegation(input: {
    obligationId: string;
    title: string;
    file: File;
  }): Promise<void>;
  getChartFile(input: {
    type: "renewal" | "discontinue" | "training" | "version";
    id: string;
  }): Promise<{ blob: Blob; name: string } | null>;
  recordMedDelivery(input: {
    medicationId: string;
    remainingPills: number;
    pillsPerDay: number;
    countedOn?: string;
  }): Promise<void>;
  logPrnDose(medicationId: string, pills?: number): Promise<void>;
  signTrainingChecklist(
    checklistId: string,
    role: "staff" | "hm",
    signatureName: string,
    // LIFEPATH-P2: optional signature mark captured by the SignaturePad pattern (backward compat).
    opts?: { signatureMark?: string },
  ): Promise<void>;
  initialTrainingLine(
    checklistId: string,
    lineId: string,
    // LIFEPATH-P2: optional full sign-off detail for the line (backward compat).
    signoff?: LegacyLineSignoffInput,
  ): Promise<void>;
  addAdaptiveEquipment(individualId: string, name: string): Promise<void>;
  removeAdaptiveEquipment(equipmentId: string): Promise<void>;
  checkEquipmentLog(input: {
    equipmentId: string;
    monthKey: string;
    checkedOn: string;
    initials: string;
    comments?: string;
  }): Promise<void>;
  recordEmergencyDrill(input: {
    id: string;
    date: string;
    time: string;
    evacTime?: string;
    leaderName: string;
    participants: string;
    awakeOrSleep?: "awake" | "sleep" | "";
  }): Promise<void>;
  recordHomeSafety(input: { id: string; lines: SafetyLine[] }): Promise<void>;
  updateMonthlyDueSettings(input: {
    equipmentDay: number;
    drillDay: number;
    safetyDay: number;
  }): Promise<void>;
  downloadMonthlyCheck(input: {
    kind: "equipment" | "drills" | "safety";
    id: string;
    monthKey: string;
  }): Promise<{ blob: Blob; name: string }>;
  saveSiteFacts(siteId: string, facts: Partial<SiteFacts>): Promise<void>;
  saveSiteReview(input: {
    id: string;
    reviewerName: string;
    supportCoordinator: string;
    reviewedOn: string;
    providerOwnedControlled: boolean | null;
    heightenedScrutiny: boolean | null;
    meetsIndividualNeeds: boolean | null;
    part2Verified: boolean;
    lines: Array<{ id: string; status: SiteReviewLineStatus; comment: string }>;
  }): Promise<void>;
  downloadSiteReviewPdf(siteId: string): Promise<{ blob: Blob; name: string }>;
  downloadPreSurveyPdf(siteId: string): Promise<{ blob: Blob; name: string }>;
  uploadAgencyLogo(file: File): Promise<void>;
  removeAgencyLogo(): Promise<void>;
  resetWorkspace(): Promise<void>;
  createSite(input: {
    name: string;
    address: string;
    programName: string;
    managerUserId?: string | null;
  }): Promise<{ id: string }>;
  createIndividual(input: {
    fullName: string;
    dateOfBirth: string;
    siteId: string;
    goesBy?: string;
    dmhId?: string;
    file?: File;
    pageCount?: number;
    effectiveOn?: string;
  }): Promise<{ id: string; name: string }>;
  // ===== LIFEPATH-P2 API (training engine) =====
  /** All training topics (checklist verbatim + A1–A6 supplemental sets). */
  listTrainingTopics(scope?: "agency" | "site"): Promise<TrainingTopic[]>;
  /**
   * Bulk-generate training requirements for a staff member (checklist per site,
   * section 6 per individual, plan-version retraining, corrective or delegation sets).
   * Idempotent: existing open requirements for the same topic/user/individual are skipped.
   */
  assignTraining(input: AssignTrainingInput): Promise<TrainingRequirement[]>;
  /** Per-staff compliance profile incl. hours, gate status, and countersignatures. */
  getStaffTrainingProfile(userId: string): Promise<StaffTrainingProfile>;
  /** "Not cleared to work alone" list across the agency (optionally filtered to a site). */
  listStaffNeedingClearance(siteId?: string): Promise<StaffClearanceRow[]>;
  /** Initial a single requirement line with the full sign-off payload (typed initials, not a checkmark). */
  initialRequirementLine(requirementId: string, input: RequirementLineSignoffInput): Promise<void>;
  /** Mark a requirement line N/A with a written reason (no blanks allowed). */
  waiveRequirementLine(requirementId: string, reason: string): Promise<void>;
  /**
   * Correction flow: an administrator, compliance admin, or DPM deletes the
   * house manager's countersignature (with a written reason) to unlock a
   * signed sheet so bad lines can be fixed. The reason is written to the
   * audit trail. The sheet must be re-signed and re-countersigned after.
   */
  requestTrainingCorrection(input: RequestTrainingCorrectionInput): Promise<void>;
  /** Whole-checklist countersignature: staff signs own sheet, then the house manager countersigns. */
  signStaffChecklist(input: {
    userId: string;
    siteId: string;
    role: "staff" | "hm";
    signatureName: string;
    signatureMark?: string;
  }): Promise<void>;
  // ===== LIFEPATH-P3 API (delegation forms) =====
  /** Create a new RN delegation of a specified nursing task (one form per individual per task). */
  createDelegation(input: {
    individualId: string;
    taskTitle: string;
    purpose: string;
    /** Optional for data compat; new forms default to the Complyrer version. */
    templateVersion?: DelegationTemplateVersion;
    procedures?: string;
    observeReportDo?: string;
  }): Promise<{ id: string }>;
  /** Patch fields on the delegation form (purpose, procedures, instructing RN, rescind state, …). */
  updateDelegationForm(input: {
    obligationId: string;
    patch: DelegationFormPatch;
  }): Promise<void>;
  /** A rostered staff member signs their row. The delegating RN must sign first. */
  signDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    signatureName: string;
    signatureMark: string;
    initials: string;
  }): Promise<void>;
  /** Record a per-row rescinded date on the employee roster. */
  rescindDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    rescindedDate: string;
  }): Promise<void>;
  /** Render the delegation form to PDF (Complyrer view). */
  getDelegationPdf(input: {
    obligationId: string;
  }): Promise<{ blob: Blob; name: string }>;
  // ===== LIFEPATH-P4 API (certificates) =====
  // LIFEPATH-P4 (certificates): HR certificate tracking.
  listCertificates(userId: string): Promise<StaffCertificate[]>;
  addCertificate(input: AddCertificateInput): Promise<StaffCertificate>;
  uploadCertificateFile(
    input: UploadCertificateFileInput,
  ): Promise<StaffCertificate>;
  updateCertificate(
    id: string,
    input: UpdateCertificateInput,
  ): Promise<StaffCertificate>;
  deleteCertificate(id: string): Promise<void>;
  certificatesExpiringSoon(days: number): Promise<ExpiringCertificate[]>;
  certificateFileUrl(id: string): Promise<string>;
  // ===== AUDIT-READINESS API (corrective actions) =====
  /** List the agency's corrective actions (any agency member may read). */
  listCorrectiveActions(input?: {
    status?: "open" | "in_progress" | "resolved" | "overdue";
    assignedToUserId?: string;
  }): Promise<CorrectiveAction[]>;
  /** Create a corrective action (correctiveActions.manage). */
  addCorrectiveAction(input: AddCorrectiveActionInput): Promise<CorrectiveAction>;
  /** Update title/owner/due date/status (correctiveActions.manage). */
  updateCorrectiveAction(
    id: string,
    input: UpdateCorrectiveActionInput,
  ): Promise<CorrectiveAction>;
  /** Resolve an action: stamps resolved_at (correctiveActions.manage). */
  resolveCorrectiveAction(id: string): Promise<CorrectiveAction>;
  // ===== AUDIT-READINESS API (compliance score snapshots) =====
  /**
   * Record today's compliance score snapshot (agency-wide when siteId is
   * null). One snapshot per day per scope — re-saving replaces today's.
   */
  saveComplianceSnapshot(input: {
    siteId?: string | null;
    result: ComplianceScore;
  }): Promise<ScoreSnapshot>;
  /** Newest-first snapshots for the trend chart. */
  listComplianceSnapshots(
    siteId?: string | null,
    limit?: number,
  ): Promise<ScoreSnapshot[]>;
  // ===== LIFEPATH-P5 API (HM weekly checklist) =====
  /**
   * DPM-only: assign this week's checklist to an HM for a home.
   * weekOf is normalized to the Sunday that opens the week.
   */
  assignWeeklyChecklist(input: {
    siteId: string;
    hmUserId: string;
    weekOf: string;
  }): Promise<HmWeeklyChecklist>;
  listWeeklyChecklists(input?: {
    siteId?: string;
    weekOf?: string;
  }): Promise<HmWeeklyChecklist[]>;
  answerChecklistItem(
    checklistId: string,
    itemKey: string,
    answer: ChecklistAnswer,
    note?: string,
  ): Promise<void>;
  addServiceLogEntry(
    checklistId: string,
    input: {
      kind: ServiceLogKind;
      detail: string;
      staffName?: string;
      dateTime?: string;
    },
  ): Promise<ServiceLogEntry>;
  removeServiceLogEntry(checklistId: string, entryId: string): Promise<void>;
  /** Recompute item 21 from training data. Called on load so the HM sees a live check. */
  refreshChecklistItem21(checklistId: string): Promise<ChecklistAnswer>;
  /** HM-only: sign the attestation and turn the checklist in (no blank items). */
  submitWeeklyChecklist(
    checklistId: string,
    signatureName: string,
  ): Promise<void>;
  /**
   * Idempotent Sunday rollover: lock prior open weeks as overdue and open a
   * fresh instance for each active HM↔site assignment. Safe to run on app
   * load (no backend cron exists); DPMs can also trigger it manually.
   */
  rolloverWeeklyChecklists(): Promise<{ created: number; locked: number }>;
  exportWeeklyChecklistPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }>;
  exportWeeklyServiceLogPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }>;
  // ===== LIFEPATH-P6 API (med inventory) =====
  getMedInventory(
    individualId: string,
  ): Promise<import("./types").MedInventoryView[]>;
  getMedicationSupplyStatus(
    siteId: string,
  ): Promise<import("./types").MedSupplyStatus>;
  adjustMedInventory(input: {
    medicationId: string;
    quantityDelta: number;
    reason: string;
    countedOn?: string;
  }): Promise<void>;
  setReorderThreshold(input: {
    medicationId: string;
    lowThresholdDays: number;
  }): Promise<void>;
  acknowledgeReorderAlert(medicationId: string): Promise<void>;
  /**
   * Log a refused / held / wasted dose exception during the med pass. The
   * forecast subtracts the affected pills; the row is insert-only (corrections
   * are new rows, never edits) and the reason is written to the audit trail.
   */
  addMedDoseException(input: AddMedDoseExceptionInput): Promise<void>;
  // ===== LIFEPATH-P7 API (mileage tracking) =====
  /** Monthly mileage log for one house (month as "YYYY-MM"). */
  listMileageTrips(
    siteId: string,
    month: string,
  ): Promise<import("./types").MileageTripView[]>;
  /** Monthly totals: total miles + per-individual equal-share totals. */
  getMileageMonthlySummary(
    siteId: string,
    month: string,
    individualIds: string[],
  ): Promise<import("./mileage").MileageMonthlySummary>;
  addMileageTrip(
    input: import("./types").AddMileageTripInput,
  ): Promise<import("./types").MileageTrip>;
  updateMileageTrip(
    tripId: string,
    patch: import("./types").UpdateMileageTripInput,
  ): Promise<import("./types").MileageTrip>;
  deleteMileageTrip(tripId: string): Promise<void>;
  /** Odometer end of the most recent trip for a home (continuity prefill); null when no trips exist. */
  getLastMileageOdometerEnd(siteId: string): Promise<number | null>;
  /** Odometer end of the trip just before this one in log order; null when none (for edit validation). */
  getPreviousMileageOdometerEnd(
    siteId: string,
    tripId: string,
  ): Promise<number | null>;
  /** Yearly administrator summary: per-individual Jan–Dec totals + grand total row. */
  getMileageYearlySummary(
    siteId: string,
    year: number,
    individualIds: string[],
  ): Promise<import("./mileage").MileageYearlySummary>;
  /**
   * Agency-wide yearly summary: every program site in one table, grouped by
   * site. Same role gate as the per-site yearly summary (administrator, DPM,
   * platform owner only).
   */
  getMileageYearlySummaryAllSites(
    year: number,
    sites: Array<{ siteId: string; siteName: string; individualIds: string[] }>,
  ): Promise<import("./mileage").MileageAgencyYearlySummary>;
  // ===== SITE DETAIL API (program-site detail view, read-focused) =====
  /**
   * QA audit history for one program site (newest first). Read-only: the
   * full audit workflow lives elsewhere; the detail view shows past audits
   * and their score snapshots.
   */
  listQaAuditHistory(siteId: string): Promise<QaAuditSummary[]>;
  // ===== E-SIGNATURE API (adopt-once signatures, DocuSign-style) =====
  /**
   * The session user's adopted signature + ESIGN/UETA consent, if any.
   * The signer is ALWAYS the session user — impersonation is structurally
   * impossible because no name is ever accepted from the client at signing.
   */
  getMySignature(): Promise<AdoptedSignature | null>;
  /**
   * Adopt the session user's signature + initials. Rejects when consent is
   * not confirmed (defense in depth; the DB NOT NULL is the real gate),
   * when either image is missing, not a PNG, or over 200 KB.
   */
  adoptSignature(input: AdoptSignatureInput): Promise<AdoptedSignature>;
  /**
   * Sign one field of a document as the session user. Records a
   * tamper-evident event (hash of the canonical document content) and
   * applies the domain state change. Rejects double-signs of the same field.
   */
  applySignature(input: ApplySignatureInput): Promise<ApplySignatureResult>;
  /** Signature events recorded for one document (agency-scoped). */
  getSignatureEvents(
    documentType: SignableDocumentType,
    documentId: string,
  ): Promise<SignatureEvent[]>;
  /** Signed URL (hosted) or data URL (local) for an adopted signature image. */
  getSignatureImageUrl(path: string): Promise<string>;
  /** Which adoption methods the agency allows (default: all on). */
  getSignatureSettings(): Promise<SignatureSettings>;
  /** Administrator-only: persist the agency's adoption-method toggles. */
  updateSignatureSettings(input: SignatureSettings): Promise<SignatureSettings>;
  /**
   * 13 CSR 65-3.050 second identification component: verify the session user's
   * password and record a fresh re-auth covering REAUTH_WINDOW_MS of signing.
   * The password is verified server-side (never trusted from a client claim)
   * and never stored.
   */
  verifySigningPassword(password: string): Promise<{ reauthAt: string }>;
  /**
   * Record a client-observed 13 CSR 65-3.050 audit event (login, logout, or a
   * signed-document view). Re-auth outcomes and applied signatures are logged
   * automatically; the client only reports what it alone can observe.
   */
  logSignatureAudit(input: LogSignatureAuditInput): Promise<void>;
  /**
   * 13 CSR 65-3.050 audit rows visible to the session user (their own rows;
   * hosted additionally exposes them to administrator/compliance_admin
   * verifiers via RLS).
   */
  getSignatureAuditLog(input?: {
    documentType?: SignableDocumentType;
    documentId?: string;
  }): Promise<SignatureAuditRecord[]>;
  /**
   * RECOGNITION (winners-only). Bidirectional 1–5 ratings/reviews: exactly
   * one current record per reviewer/subject pair and direction, append-only
   * history, and the reviewed person is notified on every change.
   */
  /** DSP rates an HM (1–5). Creates or updates the single current rating. */
  submitDspHmRating(input: {
    hmUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").DspHmRating>;
  /** The session DSP's current rating of one HM, if any. */
  getMyDspHmRating(
    hmUserId: string,
  ): Promise<import("../recognition/recognition").DspHmRating | null>;
  /** Ratings about the session HM, each with its full change history. */
  listDspHmRatingsAboutMe(): Promise<
    import("../recognition/recognition").DspHmRatingWithHistory[]
  >;
  /** HM reviews a DSP (1–5). Creates or updates the single current review. */
  submitHmDspReview(input: {
    dspUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").HmDspReview>;
  /** The session HM's current review of one DSP, if any. */
  getMyHmDspReview(
    dspUserId: string,
  ): Promise<import("../recognition/recognition").HmDspReview | null>;
  /** Reviews about the session DSP, each with its full change history. */
  listHmDspReviewsAboutMe(): Promise<
    import("../recognition/recognition").HmDspReviewWithHistory[]
  >;
  /**
   * The session user's recognition partners: for a DSP, the HMs at their
   * shared active sites; for a house manager, the DSPs at theirs. These are
   * the only people the user can rate or review. Empty for other roles.
   */
  listRecognitionPartners(): Promise<
    Array<{ userId: string; fullName: string; roleKey: string }>
  >;
  /**
   * Managers/admins: every current rating/review pair in the agency
   * (current values only — history stays with the pair).
   */
  listRecognitionFeedback(): Promise<
    import("../recognition/recognition").RecognitionFeedback
  >;
  /** Public celebration surface: winners + highlights only. No rankings. */
  listRecognitionWinners(input?: {
    limit?: number;
  }): Promise<import("../recognition/recognition").PublicRecognitionWinner[]>;
  /**
   * Run the weekly winner selection now (idempotent; skips already-decided
   * weeks). Managers/admins only.
   */
  runWeeklyRecognition(input?: {
    weekStart?: string;
  }): Promise<import("../recognition/recognition").WeeklyRecognitionResult>;
  /* ------------------------------------------------------------------ */
  /* Delegation template workflow (local): templates → site activation →  */
  /* assignment → training review → publish → staff acknowledgment.      */
  /* ------------------------------------------------------------------ */
  /** All active common templates (+ agency-specific, if any). */
  listDelegationTemplates(): Promise<DelegationTemplate[]>;
  /** Create an agency-specific template (starts active). */
  createDelegationTemplate(input: {
    name: string;
    category: DelegationTemplateCategory;
    sections: TemplateSections;
    individualizationNote: string;
  }): Promise<DelegationTemplate>;
  /** Rename / recategorize / activate-deactivate a template. */
  updateDelegationTemplate(
    id: string,
    patch: { name?: string; category?: DelegationTemplateCategory; active?: boolean },
  ): Promise<DelegationTemplate>;
  /** Activate a template for one site. Sends no notifications. */
  activateDelegationTemplate(templateId: string, siteId: string): Promise<SiteDelegationActivation>;
  /** Deactivate a site activation (status -> "deactivated"). */
  deactivateDelegationActivation(id: string): Promise<SiteDelegationActivation>;
  /** Activations at the session user's sites (admins see all). */
  listSiteDelegationActivations(filter?: { siteId?: string }): Promise<SiteDelegationActivation[]>;
  /**
   * Assign an activation to an individual. The individual must belong to the
   * activation's site. Creates the assignment plus a draft training
   * material and notifies reviewers at the site (not all staff).
   */
  assignDelegationToIndividual(
    activationId: string,
    individualId: string,
  ): Promise<IndividualDelegationAssignment>;
  /** End an assignment (status -> "ended"). */
  endDelegationAssignment(id: string): Promise<IndividualDelegationAssignment>;
  /** Assignments at the session user's sites (admins see all). */
  listDelegationAssignments(filter?: { siteId?: string }): Promise<IndividualDelegationAssignment[]>;
  /**
   * The training material for an assignment. Reviewers see the draft at any
   * status; ordinary site staff see it only once published — null otherwise.
   */
  getDelegationTrainingMaterial(assignmentId: string): Promise<DelegationTrainingMaterial | null>;
  /** Replace the draft content (draft / in_review only). No notifications. */
  updateDelegationTrainingDraft(
    assignmentId: string,
    draft: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial>;
  /** Move a draft to in_review (sets submittedAt). No notifications. */
  submitDelegationForReview(assignmentId: string): Promise<DelegationTrainingMaterial>;
  /**
   * Publish the training material (status -> "published"). Notifies every
   * site staff member exactly once and writes an audit entry.
   */
  approveDelegationTrainingMaterial(
    assignmentId: string,
    content: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial>;
  /** Staff: open the published material (records openedAt). */
  openDelegationMaterial(assignmentId: string): Promise<DelegationAcknowledgment>;
  /** The caller's own acknowledgment row, or null. */
  getMyDelegationAck(assignmentId: string): Promise<DelegationAcknowledgment | null>;
  /**
   * Staff: sign their OWN acknowledgment (openedAt required; one signature
   * only). Writes an audit entry.
   */
  signDelegationAcknowledgment(
    assignmentId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<DelegationAcknowledgment>;
  /** Per-staff acknowledgment roster with overdue flags (HM/DPM/RN/admin). */
  listDelegationAckStatus(assignmentId: string): Promise<DelegationAckStatusRow[]>;
  /**
   * Notify unsigned staff and site managers about past-due acknowledgments.
   * Idempotent. Returns the number of notifications actually inserted.
   */
  sweepDelegationAckOverdue(): Promise<number>;
  /* ------------------------------------------------------------------ */
  /* QA-AUDIT (2026-09-14): quarterly program-site quality assurance.   */
  /* Items the system can prove from its own records are pre-filled and */
  /* locked; the auditor scores the rest, DPM/HM dispute with photo    */
  /* evidence, and the auditor resolves disputes.                       */
  /* ------------------------------------------------------------------ */
  /** Start (or reopen) a draft audit for a site + quarter (qa.audit). */
  createQaAudit(
    siteId: string,
    year: number,
    quarter: number,
  ): Promise<QaAudit>;
  /** Audits visible to the session user (qa.audit / audit.read / audit.export). */
  listQaAudits(filter?: {
    siteId?: string;
    year?: number;
    quarter?: number;
  }): Promise<QaAudit[]>;
  /** One audit, or null. */
  getQaAudit(id: string): Promise<QaAudit | null>;
  /** All item states for an audit (locked system items included). */
  getQaAuditItems(auditId: string): Promise<QaAuditItemState[]>;
  /**
   * Score one auditor-scored item (yes / no / na / skipped). qa.audit.
   * Throws on locked system items or while a dispute is open.
   */
  scoreQaItem(
    auditId: string,
    itemKey: string,
    result: "yes" | "no" | "na" | "skipped",
    comment: string,
  ): Promise<QaAuditItemState>;
  /**
   * Finalize the audit with the auditor's adopted signature. qa.audit.
   * Throws while any item is undecided.
   */
  finalizeQaAudit(
    auditId: string,
    signature: { name: string; mark: string },
  ): Promise<QaAudit>;
  /**
   * Challenge a scored item with a note + at least one photo. qa.dispute
   * (DPM / HM). Locked system items cannot be disputed.
   */
  raiseQaDispute(
    auditId: string,
    itemKey: string,
    note: string,
    photos: QaPhotoInput[],
  ): Promise<QaAuditItemState>;
  /**
   * Approve or reject a dispute with a recorded reason. qa.audit.
   * Approving flips an incorrect No to Yes.
   */
  resolveQaDispute(
    auditId: string,
    itemKey: string,
    approved: boolean,
    reason: string,
  ): Promise<QaAuditItemState>;
  /** Schedules visible to the session user. */
  listQaSchedules(filter?: { siteId?: string }): Promise<QaAuditSchedule[]>;
  /** Create/update a site's QA schedule (qa.schedule). */
  upsertQaSchedule(input: {
    siteId: string;
    nextDue: string;
    assignedAuditorId?: string | null;
    assignedAuditorName?: string | null;
  }): Promise<QaAuditSchedule>;
  /** Program-site ranking by latest QA score, with trend tie-breaks. */
  getQaSiteRanking(): Promise<QaRankedSite[]>;
  /** Finalized audits for one site, newest first. */
  getQaSiteHistory(siteId: string): Promise<QaAudit[]>;
  /** Queue due/overdue schedule reminders once per day (qa.schedule). */
  sweepQaScheduleReminders(today?: string): Promise<number>;
  /* ------------------------------------------------------------------ */
  /* PCSP document-extraction pipeline: upload → extract → edit →       */
  /* approve → activate. NOTHING is tracked before approveDocument-     */
  /* Extraction(); activation hands protocol items into the delegation  */
  /* system (template → site activation → assignment → training draft). */
  /* ------------------------------------------------------------------ */
  /** Register a document upload (documents.upload). */
  registerDocumentUpload(input: {
    individualId: string;
    /** Optional — the server falls back to the individual's site when omitted. */
    siteId?: string;
    documentType: DocumentType;
    originalFilename: string;
    mimeType?: string;
    file?: Blob | null;
  }): Promise<DocumentUpload>;
  /** Uploads visible to the session user (reviewers: agency; staff: approved/activated at own sites). */
  listDocumentUploads(filter?: {
    individualId?: string;
    status?: DocumentStatus;
  }): Promise<DocumentUpload[]>;
  /** The recorded extraction + its proposed items for an upload (documents.review). */
  getDocumentExtraction(uploadId: string): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  } | null>;
  /**
   * LOCAL DEMO ONLY: deterministically simulate AI extraction from a
   * built-in fixture (no network call, clearly marked simulated). Hosted
   * runs the real extract-pcsp edge function via extractDocumentUpload().
   */
  simulatePcspExtraction(uploadId: string): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  }>;
  /** HOSTED ONLY: invoke the extract-pcsp edge function for real AI extraction. */
  extractDocumentUpload(
    uploadId: string,
    documentText: string,
  ): Promise<{ ok: boolean; fallbackUsed: boolean }>;
  /** Edit a proposed/edited item (documents.review; status → "edited"). */
  updateTrackableItem(
    itemId: string,
    patch: {
      title: string;
      detail?: Record<string, unknown>;
      dueDate?: string | null;
      needsHumanCheck?: boolean;
    },
  ): Promise<TrackableItem>;
  /**
   * Approve the whole extraction (documents.review). THE gate: items become
   * "approved" and the upload "approved" — nothing is tracked before this.
   */
  approveDocumentExtraction(uploadId: string): Promise<void>;
  /**
   * Activate one approved item (documents.review). protocol_needs_delegation
   * items hand off into the delegation system (template → activation →
   * assignment → training draft); other types just become "activated".
   */
  activateTrackableItem(itemId: string): Promise<TrackableItem>;
  /** Retire an upload that should never be tracked (documents.review). */
  rejectDocumentUpload(uploadId: string, reason?: string): Promise<void>;
  /** Per-agency AI settings read (any agency member; carries no secrets). */
  getAgencyAiSettings(): Promise<LocalAgencyAiSettings>;
  /** Set the AI enabled flag + model only (roles.manage; no credential is ever stored). */
  setAgencyAiSettings(input: {
    enabled: boolean;
    model: string;
  }): Promise<LocalAgencyAiSettings>;
  /**
   * Minimal Vertex AI service-account check via the extract-pcsp verify
   * action (roles.manage; hosted only — local returns a demo result).
   */
  verifyAiServiceAccount(): Promise<{
    ok: boolean;
    projectId?: string;
    error?: string;
  }>;
  /** Add a reviewer-created trackable item (documents.review; status "proposed"). */
  addTrackableItem(input: {
    extractionId: string;
    itemType: TrackableItemType;
    title: string;
    detail?: Record<string, unknown>;
    dueDate?: string | null;
    needsHumanCheck?: boolean;
  }): Promise<TrackableItem>;
  /** Remove a proposed/edited item (documents.review; status → "removed"). */
  removeTrackableItem(itemId: string): Promise<TrackableItem>;
}

/**
 * Read-only summary of one QA audit for the program-site detail view.
 * `scoreJson` carries the finalized score snapshot when present; its exact
 * shape is owned by the audit workflow, so callers must read it defensively.
 */
export interface QaAuditSummary {
  id: string;
  year: number;
  quarter: number;
  status: "draft" | "in_progress" | "finalized";
  auditorName: string;
  signedAt: string | null;
  createdAt: string;
  scoreJson: unknown;
}

export type WorkspaceSite = {
  id: string;
  name: string;
  address: string;
  program: string;
  manager: string;  color: string;
  initials: string;
} & SiteFacts;

export interface WorkspaceView {
  session: SessionUser;
  sites: WorkspaceSite[];
  individuals: {
    id: string;
    name: string;
    site: string;
    siteId: string;
    dateOfBirth: string;
    manager: string;
    initials: string;
    color: string;
    profile: IndividualProfile | null;
    photoUrl?: string | null;
  }[];
  staff: {
    id: string;
    name: string;
    role: string;
    site: string;
    siteId: string | null;
    email: string;
    username: string;
    appRole: AppRole;
    roleKey: string;
    expiresOn: string | null;
  }[];
  roles: AgencyRole[];
  requirements: Requirement[];
  plans: Plan[];
  activity: Activity[];
  packets: PacketDetail[];
  planStacks: PlanStackView[];
  scorecard: {
    score: number;
    total: number;
    done: number;
    overdue: number;
    dueSoon: number;
    review: number;
  };
  monthly: {
    equipment: AdaptiveEquipment[];
    equipmentLogs: EquipmentMonthLog[];
    drills: EmergencyDrill[];
    safetyReports: HomeSafetyReport[];
  };
  monthlyDue: import("./monthlyChecks").MonthlyDueSettings;
  siteReviews: SiteReview[];
  branding: { logoUrl: string | null };
}

function cloneSeed(): LocalDatabase {
  return structuredClone(createEvergreenSeed());
}

export class MemoryStore {
  db: LocalDatabase;
  files = new Map<string, { mime: string; bytes: ArrayBuffer }>();
  sessionUserId: string | null = null;
  /**
   * 13 CSR 65-3.050 second-ID-component state (local/demo path): userId ->
   * ISO timestamp of the last password re-entry for the signing ceremony.
   * Deliberately NOT persisted (not part of db): a fresh browser session
   * always starts with no re-auth, so a stolen device cannot sign on old
   * re-entry. The hosted path keeps this server-side in signature_reauth.
   */
  signingReauthAt = new Map<string, string>();

  constructor(db?: LocalDatabase) {
    this.db = db ?? cloneSeed();
  }
}

const browserStore = new MemoryStore();
let hydrated = false;

async function persistMeta(store: MemoryStore) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ db: store.db, sessionUserId: store.sessionUserId }),
  );
}

async function persistFile(path: string, file: File) {
  if (typeof indexedDB === "undefined") {
    browserStore.files.set(path, {
      mime: file.type || "application/pdf",
      bytes: await file.arrayBuffer(),
    });
    return;
  }
  const bytes = await file.arrayBuffer();
  browserStore.files.set(path, {
    mime: file.type || "application/pdf",
    bytes,
  });
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("complyra-files", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) {
        req.result.createObjectStore("files");
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("files", "readwrite");
      tx.objectStore("files").put({ mime: file.type || "application/pdf", bytes }, path);
      tx.oncomplete = () => {
        req.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function seedDemoLogoPath(store: MemoryStore) {
  const agency = store.db.agencies.find((row) => row.id === AGENCY_ID);
  if (!agency || agency.logoPath === null) return;
  if (!agency.logoPath) agency.logoPath = agencyLogoPath(AGENCY_ID);
}

async function readStoredFile(store: MemoryStore, path: string) {
  const memory = store.files.get(path);
  if (memory) return new Blob([memory.bytes], { type: memory.mime });
  return readFile(path);
}

async function logoDataUrlFor(store: MemoryStore, agencyId: string) {
  seedDemoLogoPath(store);
  const agency = store.db.agencies.find((row) => row.id === agencyId);
  if (!agency?.logoPath) return null;
  const blob = await readStoredFile(store, agency.logoPath);
  if (blob && blob.size > 0) return blobToDataUrl(blob);
  if (agency.id === AGENCY_ID && agency.logoPath === agencyLogoPath(AGENCY_ID)) {
    const bytes = evergreenDemoLogoBytes();
    store.files.set(agency.logoPath, {
      mime: "image/png",
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    return evergreenDemoLogoDataUrl();
  }
  return null;
}

async function readFile(path: string): Promise<Blob | null> {
  const memory = browserStore.files.get(path);
  if (memory) return new Blob([memory.bytes], { type: memory.mime });
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("complyra-files", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("files")) {
        req.result.createObjectStore("files");
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction("files", "readonly");
      const get = tx.objectStore("files").get(path);
      get.onsuccess = () => {
        const row = get.result as { mime: string; bytes: ArrayBuffer } | undefined;
        req.result.close();
        resolve(row ? new Blob([row.bytes], { type: row.mime }) : null);
      };
      get.onerror = () => reject(get.error);
    };
  });
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      db: LocalDatabase;
      sessionUserId: string | null;
    };
    if (parsed?.db?.agencies?.length) {
      browserStore.db = parsed.db;
      browserStore.sessionUserId = parsed.sessionUserId;
      for (const membership of browserStore.db.memberships) {
        membership.roleKey = membership.roleKey ?? membership.role;
        membership.expiresOn = membership.expiresOn ?? null;
      }
      for (const agency of browserStore.db.agencies) {
        agency.status = agency.status ?? "active";
        agency.agencyCode = normalizeAgencyCode(agency.agencyCode);
        agency.monthlyDue = normalizeMonthlyDue(agency.monthlyDue);
      }
      if (!browserStore.db.agencyRoles?.length) {
        browserStore.db.agencyRoles = browserStore.db.agencies.flatMap((agency) =>
          ROLE_TEMPLATES.map((template) => ({ ...template, agencyId: agency.id })),
        );
      }
      browserStore.db.obligations = browserStore.db.obligations ?? [];
      browserStore.db.obligationSignatures =
        browserStore.db.obligationSignatures ?? [];
      browserStore.db.packetSubmissions = browserStore.db.packetSubmissions ?? [];
      browserStore.db.clinicalRenewals = browserStore.db.clinicalRenewals ?? [];
      browserStore.db.delegationTemplates = browserStore.db.delegationTemplates ?? [];
      browserStore.db.siteDelegationActivations = browserStore.db.siteDelegationActivations ?? [];
      browserStore.db.individualDelegationAssignments = browserStore.db.individualDelegationAssignments ?? [];
      browserStore.db.delegationTrainingMaterials = browserStore.db.delegationTrainingMaterials ?? [];
      browserStore.db.delegationAcknowledgments = browserStore.db.delegationAcknowledgments ?? [];
      browserStore.db.chartFiles = browserStore.db.chartFiles ?? [];
      browserStore.db.medications = browserStore.db.medications ?? [];
      browserStore.db.medicationDeliveries = browserStore.db.medicationDeliveries ?? [];
      browserStore.db.trainingChecklists = browserStore.db.trainingChecklists ?? [];
      browserStore.db.adaptiveEquipment = browserStore.db.adaptiveEquipment ?? [];
      browserStore.db.equipmentMonthLogs = browserStore.db.equipmentMonthLogs ?? [];
      browserStore.db.emergencyDrills = browserStore.db.emergencyDrills ?? [];
      browserStore.db.homeSafetyReports = browserStore.db.homeSafetyReports ?? [];
      browserStore.db.siteReviews = browserStore.db.siteReviews ?? [];
      // AUDIT-READINESS (2026-09-14): new collections for older stored DBs.
      browserStore.db.correctiveActions = browserStore.db.correctiveActions ?? [];
      browserStore.db.complianceSnapshots = browserStore.db.complianceSnapshots ?? [];
      seedDemoLogoPath(browserStore);
      for (const item of browserStore.db.obligations) {
        item.delegatingRnUserId = item.delegatingRnUserId ?? null;
        item.rnSignedAt = item.rnSignedAt ?? null;
        item.rnSignatureName = item.rnSignatureName ?? null;
        item.rnSignatureMark = item.rnSignatureMark ?? null;
        item.discontinuedAt = item.discontinuedAt ?? null;
        item.discontinueFileId = item.discontinueFileId ?? null;
        item.discontinueTitle = item.discontinueTitle ?? null;
      }
      for (const row of browserStore.db.clinicalRenewals) {
        row.fileId = row.fileId ?? null;
      }
    }
  } catch {
    /* Keep the fictional seed if stored state cannot be read. */
  }
}

function currentSession(store: MemoryStore): SessionUser | null {
  if (!store.sessionUserId) return null;
  const profile = store.db.profiles.find((p) => p.id === store.sessionUserId);
  const membership = store.db.memberships.find(
    (m) => m.userId === store.sessionUserId,
  );
  if (!profile || !membership) return null;
  if (membership.expiresOn && membership.expiresOn < todayIso()) return null;
  const agency = store.db.agencies.find((row) => row.id === membership.agencyId);
  if (!agency) return null;
  return {
    userId: profile.id,
    email: profile.email,
    username: profile.username,
    fullName: profile.fullName,
    jobTitle: profile.jobTitle,
    role: membership.role,
    roleKey: membership.roleKey ?? membership.role,
    agencyId: agency.id,
    agencyName: agency.name,
    agencyCode: agency.agencyCode,
    siteId: membership.siteId,
    mustChangePassword: profile.mustChangePassword,
    expiresOn: membership.expiresOn ?? null,
    permissions: permissionsFor(store, membership.agencyId, membership.roleKey ?? membership.role),
    platformAdmin: Boolean(profile.platformAdmin),
    agencyStatus: agency.status ?? "active",
  };
}

function permissionsFor(store: MemoryStore, agencyId: string, roleKey: string): PermissionMap {
  const configured = (store.db.agencyRoles ?? []).find(
    (row) => row.agencyId === agencyId && row.key === roleKey,
  );
  return {
    ...defaultPermissions(roleKey),
    ...(configured?.permissions ?? {}),
  };
}

function rolesFor(store: MemoryStore, agencyId: string): AgencyRole[] {
  const existing = (store.db.agencyRoles ?? []).filter((row) => row.agencyId === agencyId);
  if (existing.length) return existing;
  return ROLE_TEMPLATES.map((template) => ({ ...template, agencyId }));
}

function assertSession(store: MemoryStore): SessionUser {
  const session = currentSession(store);
  if (!session) throw new Error("Sign in to continue.");
  return session;
}

function assertPrivileged(session: SessionUser) {
  if (!isPrivileged(session.role)) {
    throw new Error("You do not have permission to do that.");
  }
}

function assertCan(session: SessionUser, key: PermissionKey) {
  if (!hasPermission(session, key)) {
    throw new Error("You do not have permission to do that.");
  }
}

function assertPlatformOperator(session: SessionUser) {
  if (!session.platformAdmin) {
    throw new Error("Only the Complyrer operator can manage AI settings.");
  }
}

/**
 * DELEGATION — site scoping for the delegation workflow.
 *
 * Agency administrators (and the platform operator) see every agency site.
 * Everyone else sees their own sites: a fixed siteId narrows to that site;
 * program-scoped roles (DPM / program manager) without a fixed site cover
 * the agency's sites, which are their program's sites in this demo data.
 * Returns null for "all sites".
 */
function delegationSiteScope(session: SessionUser): string[] | null {
  if (isAgencyWideViewer(session)) return null;
  return session.siteId ? [session.siteId] : [];
}

function accessibleIndividual(store: MemoryStore, session: SessionUser, id: string) {
  const person = store.db.individuals.find((row) => row.id === id);
  if (!person || !canReadIndividual(session, person, store.db.assignments)) {
    throw new Error("Individual not found or outside your assigned access.");
  }
  return person;
}

function accessibleRequirement(store: MemoryStore, session: SessionUser, id: string) {
  const row = store.db.requirements.find((item) => item.id === id && item.agencyId === session.agencyId);
  if (!row || !canAccessSite(session, row.siteId)) throw new Error("Requirement not found or outside your assigned access.");
  if (row.individualId) accessibleIndividual(store, session, row.individualId);
  return row;
}

function assertRequirementOwner(store: MemoryStore, session: SessionUser, userId: string) {
  if (!store.db.memberships.some((m) => m.agencyId === session.agencyId && m.userId === userId &&
    (!m.expiresOn || m.expiresOn >= todayIso()))) throw new Error("Choose an active staff member in this agency.");
}

/** Throw unless the session user may touch delegation data at this site. */
function assertDelegationSite(session: SessionUser, siteId: string) {
  const scope = delegationSiteScope(session);
  if (scope !== null && !scope.includes(siteId)) {
    throw new Error("You do not have permission to do that.");
  }
}

/** Backfill delegation collections when an older persisted db lacks them. */
function ensureDelegationCollections(store: MemoryStore) {
  const db = store.db;
  db.delegationTemplates = db.delegationTemplates ?? [];
  db.siteDelegationActivations = db.siteDelegationActivations ?? [];
  db.individualDelegationAssignments = db.individualDelegationAssignments ?? [];
  db.delegationTrainingMaterials = db.delegationTrainingMaterials ?? [];
  db.delegationAcknowledgments = db.delegationAcknowledgments ?? [];
}

/** QA-AUDIT (2026-09-14): local store shapes (item states gain their row ids). */
type StoredQaAudit = QaAudit;
type StoredQaAuditSchedule = QaAuditSchedule;

/** Backfill QA collections when an older persisted db lacks them. */
function ensureQaCollections(store: MemoryStore) {
  const db = store.db;
  db.qaAudits = db.qaAudits ?? [];
  db.qaAuditItems = db.qaAuditItems ?? [];
  db.qaSchedules = db.qaSchedules ?? [];
}

/** Backfill document-extraction collections when an older db lacks them. */
function ensureDocumentCollections(store: MemoryStore) {
  const db = store.db;
  db.documentUploads = db.documentUploads ?? [];
  db.documentExtractions = db.documentExtractions ?? [];
  db.documentTrackableItems = db.documentTrackableItems ?? [];
  db.documentAuditLog = db.documentAuditLog ?? [];
  db.agencyAiSettings = db.agencyAiSettings ?? [];
}

function logDocumentAudit(
  store: MemoryStore,
  input: Omit<LocalDocumentAuditEntry, "id" | "at">,
) {
  store.db.documentAuditLog.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...input,
  });
}

/**
 * LOCAL DEMO fixture: a deterministic "AI extraction" for a PCSP. Clearly
 * marked simulated — the hosted path never uses this; it runs Gemini.
 */
function simulatedPcspFixture(
  individualName: string,
): PcspExtraction {
  const reviewDue = "2027-09-14";
  const expiry = "2027-09-14";
  return {
    individual: {
      full_name: individualName,
      date_of_birth: "1990-01-01",
      medicaid_id: "SIM-000000",
      confidence: 0.9,
    },
    plan: {
      effective_date: "2026-09-14",
      expiry_date: expiry,
      annual_review_due_date: reviewDue,
      confidence: 0.95,
    },
    outcomes: [
      {
        title: "Community participation",
        description: "Attend two community activities per week.",
        support_strategies: [
          "Staff assist with transportation scheduling.",
          "Staff support social interaction at events.",
        ],
        confidence: 0.85,
      },
    ],
    protocols_referenced: [
      { name: "Seizure protocol", category: "Health", confidence: 0.7 },
      { name: "High fiber diet", category: "Dietary", confidence: 0.75 },
    ],
    dietary: { description: "High fiber diet as prescribed.", confidence: 0.8 },
    behavioral_supports: { description: null, confidence: null },
    staff_training_requirements: [
      { topic: "Seizure protocol", due_date: "2026-10-14", confidence: 0.7 },
      { topic: "CPR", due_date: null, confidence: 0.55 },
    ],
    physician_orders: [],
    signatures: [
      { role: "DPM", name: individualName, signed: true, date: "2026-09-14" },
      { role: "RN", name: null, signed: false, date: null },
    ],
  };
}

function simulatedItemsFor(
  extraction: PcspExtraction,
  extractionId: string,
  agencyId: string,
): TrackableItem[] {
  const items: TrackableItem[] = [];
  const push = (
    itemType: TrackableItemType,
    title: string,
    detail: Record<string, unknown>,
    dueDate: string | null,
    confidence: number | null,
  ) => {
    const conf =
      confidence === null || confidence === undefined ? null : confidence;
    items.push({
      id: crypto.randomUUID(),
      agencyId,
      extractionId,
      itemType,
      title,
      detail,
      dueDate,
      confidence: conf,
      needsHumanCheck: conf === null || conf < 0.6,
      status: "proposed",
    });
  };
  const plan = extraction.plan;
  if (plan?.annual_review_due_date) {
    push(
      "deadline",
      "PCSP annual review due",
      { description: "Annual review date stated in the PCSP. [SIMULATED EXTRACTION]" },
      plan.annual_review_due_date,
      plan.confidence ?? null,
    );
  }
  if (plan?.expiry_date) {
    push(
      "deadline",
      "PCSP plan expiry",
      { description: "Plan expiry date stated in the PCSP. [SIMULATED EXTRACTION]" },
      plan.expiry_date,
      plan.confidence ?? null,
    );
  }
  for (const t of extraction.staff_training_requirements ?? []) {
    if (!t?.topic) continue;
    push(
      "training_requirement",
      `Staff training: ${t.topic.slice(0, 120)}`,
      { topic: t.topic, simulated: true },
      t.due_date,
      t.confidence ?? null,
    );
  }
  for (const p of extraction.protocols_referenced ?? []) {
    if (!p?.name) continue;
    push(
      "protocol_needs_delegation",
      `Protocol needs delegation: ${p.name.slice(0, 120)}`,
      {
        protocol_name: p.name,
        category: p.category ?? null,
        description: `Protocol referenced in the PCSP: ${p.name}. [SIMULATED EXTRACTION]`,
      },
      null,
      p.confidence ?? null,
    );
  }
  for (const s of extraction.signatures ?? []) {
    if (s?.signed === false) {
      push(
        "missing_signature",
        `Missing signature — ${s.role ?? "unknown role"}`,
        { role: s.role ?? null, name: s.name ?? null, signed: false },
        null,
        null,
      );
    }
  }
  return items;
}

/** Throw unless the session user may review document data at this site. */
function assertDocumentSite(session: SessionUser, siteId: string) {
  const scope = delegationSiteScope(session);
  if (scope !== null && !scope.includes(siteId)) {
    throw new Error("You do not have permission to do that.");
  }
}

function siteName(store: MemoryStore, siteId: string) {
  return store.db.sites.find((s) => s.id === siteId)?.name ?? "Unknown site";
}

function personName(store: MemoryStore, individualId: string | null) {
  if (!individualId) return "Site-wide";
  return (
    store.db.individuals.find((p) => p.id === individualId)?.fullName ??
    "Unknown"
  );
}

function ownerName(store: MemoryStore, userId: string | null) {
  return store.db.profiles.find((p) => p.id === userId)?.fullName ?? "Unassigned";
}

function sourceLabel(store: MemoryStore, versionId: string | null) {
  if (!versionId) return "Agency requirement";
  const version = store.db.versions.find((v) => v.id === versionId);
  const document = store.db.documents.find((d) => d.id === version?.documentId);
  if (!version || !document) return "Unknown source";
  return `${document.title} · ${version.versionLabel}`;
}

function mapRequirement(store: MemoryStore, row: RequirementRecord): Requirement {
  const owner = store.db.profiles.find((p) => p.id === row.ownerUserId);
  const membership = store.db.memberships.find((m) => m.userId === row.ownerUserId);
  return {
    id: row.id,
    title: row.title,
    person: personName(store, row.individualId),
    site: siteName(store, row.siteId),
    category: row.category,
    owner: ownerName(store, row.ownerUserId),
    role: roleLabel(membership?.role ?? "dsp", owner?.jobTitle),
    due: row.dueOn,
    status: row.status === "Compliant" || row.status === "Pending review" ? row.status : computeRequirementStatus(row.dueOn, row.category),
    source: sourceLabel(store, row.documentVersionId),
    page: row.sourcePage,
    frequency: row.frequency,
    evidence: row.evidenceNote,
    completedAt: row.completedAt,
  };
}

function mapPlan(store: MemoryStore, version: DocumentVersion): Plan {
  const document = store.db.documents.find((d) => d.id === version.documentId)!;
  const individual = store.db.individuals.find(
    (p) => p.id === document.individualId,
  )!;
  return {
    id: version.id,
    name: document.title,
    person: individual.fullName,
    site: siteName(store, individual.siteId),
    version: version.versionLabel,
    effective: version.effectiveOn,
    status: reviewStatusLabel(version.status),
    pages: version.pageCount,
  };
}

function log(
  store: MemoryStore,
  session: SessionUser,
  action: string,
  detail: string,
  targetType: string,
  targetId?: string,
) {
  store.db.audit.unshift({
    id: crypto.randomUUID(),
    agencyId: session.agencyId,
    actorId: session.userId,
    action,
    targetType,
    targetId: targetId ?? null,
    detail,
    createdAt: new Date().toISOString(),
  });
}

function assignedUserIds(store: MemoryStore, individual: IndividualRecord) {
  const ids = new Set<string>();
  for (const assignment of store.db.assignments) {
    const active =
      assignment.startsOn <= new Date().toISOString().slice(0, 10) &&
      (!assignment.endsOn || assignment.endsOn >= new Date().toISOString().slice(0, 10));
    if (!active) continue;
    if (assignment.individualId === individual.id) {
      ids.add(assignment.userId);
    }
  }
  for (const membership of store.db.memberships) {
    if (membership.agencyId !== individual.agencyId) continue;
    const roleKey = membership.roleKey ?? membership.role;
    if (!PLAN_SIGNER_ROLE_KEYS.includes(roleKey as (typeof PLAN_SIGNER_ROLE_KEYS)[number])) {
      continue;
    }
    if (membership.siteId && membership.siteId !== individual.siteId) continue;
    ids.add(membership.userId);
  }
  return [...ids];
}

function ensurePlanCollections(store: MemoryStore) {
  store.db.obligations = store.db.obligations ?? [];
  store.db.obligationSignatures = store.db.obligationSignatures ?? [];
  store.db.packetSubmissions = store.db.packetSubmissions ?? [];
  store.db.clinicalRenewals = store.db.clinicalRenewals ?? [];
  store.db.chartFiles = store.db.chartFiles ?? [];
  store.db.medications = store.db.medications ?? [];
  store.db.medicationDeliveries = store.db.medicationDeliveries ?? [];
  store.db.trainingChecklists = store.db.trainingChecklists ?? [];
  store.db.adaptiveEquipment = store.db.adaptiveEquipment ?? [];
  store.db.equipmentMonthLogs = store.db.equipmentMonthLogs ?? [];
  store.db.emergencyDrills = store.db.emergencyDrills ?? [];
  store.db.homeSafetyReports = store.db.homeSafetyReports ?? [];
  store.db.siteReviews = store.db.siteReviews ?? [];
}

function ensureClinicalRenewals(store: MemoryStore) {
  ensurePlanCollections(store);
  const existing = new Set(
    store.db.clinicalRenewals.map((row) => `${row.individualId}:${row.kind}`),
  );
  for (const person of store.db.individuals) {
    for (const row of defaultRenewals(person.agencyId, person.id)) {
      if (!existing.has(`${row.individualId}:${row.kind}`)) {
        store.db.clinicalRenewals.push(row);
      }
    }
  }
}

async function saveChartFile(
  store: MemoryStore,
  input: {
    agencyId: string;
    individualId: string;
    kind: ChartFileKind;
    file: File;
  },
) {
  const id = crypto.randomUUID();
  const storagePath = `${input.agencyId}/${input.individualId}/chart/${id}/${input.file.name}`;
  await persistFile(storagePath, input.file);
  store.db.chartFiles.push({
    id,
    agencyId: input.agencyId,
    individualId: input.individualId,
    kind: input.kind,
    name: input.file.name,
    mime: input.file.type || "application/pdf",
    storagePath,
  });
  return id;
}

function siteTrainingRoster(store: MemoryStore, person: IndividualRecord) {
  const ids = new Set<string>();
  const today = todayIso();
  for (const assignment of store.db.assignments) {
    const active =
      assignment.startsOn <= today &&
      (!assignment.endsOn || assignment.endsOn >= today);
    if (!active) continue;
    if (
      assignment.individualId === person.id ||
      assignment.siteId === person.siteId
    ) {
      ids.add(assignment.userId);
    }
  }
  for (const membership of store.db.memberships) {
    if (membership.agencyId !== person.agencyId) continue;
    if (membership.siteId === person.siteId) ids.add(membership.userId);
  }
  return [...ids];
}

function ensureTrainingChecklists(store: MemoryStore) {
  ensurePlanCollections(store);
  for (const person of store.db.individuals) {
    const pcsp = store.db.obligations.find(
      (item) =>
        item.individualId === person.id &&
        item.kind === "pcsp" &&
        item.enabled,
    );
    const lines = trainingLinesFromObligations(
      store.db.obligations.filter((item) => item.individualId === person.id),
    );
    for (const userId of siteTrainingRoster(store, person)) {
      const profile = store.db.profiles.find((row) => row.id === userId);
      if (!profile) continue;
      const existing = store.db.trainingChecklists.find(
        (row) =>
          row.individualId === person.id &&
          row.staffUserId === userId &&
          row.documentVersionId === (pcsp?.documentVersionId ?? null),
      );
      if (existing) {
        existing.items = mergeTrainingLines(existing.items, lines);
        continue;
      }
      store.db.trainingChecklists.push({
        id: crypto.randomUUID(),
        agencyId: person.agencyId,
        individualId: person.id,
        staffUserId: userId,
        staffName: profile.fullName,
        documentVersionId: pcsp?.documentVersionId ?? null,
        items: lines,
        staffSignedAt: null,
        staffSignatureName: null,
        hmSignedAt: null,
        hmSignatureName: null,
      });
    }
  }
}

function applyMedicationCountdowns(store: MemoryStore) {
  store.db.medications = store.db.medications.map((row) => applyDailyMedDrop(row));
}

function syncObligationRoster(store: MemoryStore, item: ObligationItem) {
  if (item.mode !== "required" || !isObligationActive(item)) return;
  const individual = store.db.individuals.find((p) => p.id === item.individualId);
  if (!individual) return;
  const existing = new Set(
    store.db.obligationSignatures
      .filter((row) => row.obligationId === item.id)
      .map((row) => row.userId),
  );
  for (const userId of assignedUserIds(store, individual)) {
    if (existing.has(userId)) continue;
    const profile = store.db.profiles.find((p) => p.id === userId);
    if (!profile) continue;
    store.db.obligationSignatures.push({
      id: crypto.randomUUID(),
      agencyId: item.agencyId,
      obligationId: item.id,
      userId,
      staffName: profile.fullName,
      openedAt: null,
      signedAt: null,
      signatureName: null,
      signatureMark: null,
    });
  }
}

function mapPlanStack(
  store: MemoryStore,
  session: SessionUser,
  person: IndividualRecord,
): PlanStackView {
  const items = (store.db.obligations ?? []).filter(
    (item) => item.individualId === person.id,
  );
  const views = sortObligations(items).map((item) => {
    const rows = store.db.obligationSignatures.filter(
      (row) => row.obligationId === item.id,
    );
    return {
      item,
      mySignature: rows.find((row) => row.userId === session.userId) ?? null,
      signedCount: rows.filter((row) => row.signedAt).length,
      assignedCount: rows.length,
    };
  });
  const required = views.filter((view) => view.item.mode === "required");
  const checked = views.filter((view) => view.item.mode === "checked");
  const mustSign = requiredForSigning(items);
  const myRequired = mustSign.map((item) =>
    store.db.obligationSignatures.find(
      (row) => row.obligationId === item.id && row.userId === session.userId,
    ),
  );
  const submission =
    store.db.packetSubmissions.find(
      (row) => row.individualId === person.id && row.userId === session.userId,
    ) ?? null;
  return {
    individualId: person.id,
    individualName: person.fullName,
    profile: normalizeProfile(person, person.profile),
    required,
    checked,
    renewals: canSeeRenewals(session.roleKey)
      ? (store.db.clinicalRenewals ?? [])
          .filter((row) => row.individualId === person.id)
          .map((row) => ({ ...row, status: renewalStatus(row.nextDueOn) }))
          .sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn))
      : [],
    carePlan: (() => {
      const pcsp = required.find((view) => view.item.kind === "pcsp" && view.item.enabled);
      if (!pcsp) return null;
      const version = pcsp.item.documentVersionId
        ? store.db.versions.find((row) => row.id === pcsp.item.documentVersionId)
        : null;
      return {
        title: pcsp.item.title,
        versionLabel: version?.versionLabel ?? null,
        documentVersionId: pcsp.item.documentVersionId,
        signedCount: pcsp.signedCount,
        assignedCount: pcsp.assignedCount,
      };
    })(),
    medications: canSeeMeds(session.roleKey)
      ? store.db.medications
          .filter((row) => row.individualId === person.id)
          .map((row) => toMedicationView(row))
      : [],
    staffTraining: store.db.trainingChecklists
      .filter((row) => row.individualId === person.id)
      .filter((row) => canSeeRenewals(session.roleKey) || row.staffUserId === session.userId)
      .map((checklist) => ({ checklist, status: trainingStatus(checklist) })),
    myTraining: (() => {
      const checklist = store.db.trainingChecklists.find(
        (row) =>
          row.individualId === person.id && row.staffUserId === session.userId,
      );
      return checklist ? { checklist, status: trainingStatus(checklist) } : null;
    })(),
    mySubmissionAt: submission?.submittedAt ?? null,
    canSubmit:
      mustSign.length > 0 &&
      myRequired.every((row) => row?.signedAt) &&
      !submission &&
      (() => {
        const checklist = store.db.trainingChecklists.find(
          (row) =>
            row.individualId === person.id && row.staffUserId === session.userId,
        );
        if (!checklist) return true;
        return allLinesInitialed(checklist) && Boolean(checklist.staffSignedAt);
      })(),
  };
}

function syncPacketRoster(store: MemoryStore, packet: AcknowledgmentPacket) {
  const individual = store.db.individuals.find((p) => p.id === packet.individualId)!;
  const existing = new Set(
    store.db.rows.filter((r) => r.packetId === packet.id).map((r) => r.userId),
  );
  for (const userId of assignedUserIds(store, individual)) {
    if (existing.has(userId)) continue;
    const profile = store.db.profiles.find((p) => p.id === userId)!;
    store.db.rows.push({
      id: crypto.randomUUID(),
      agencyId: packet.agencyId,
      packetId: packet.id,
      userId,
      staffName: profile.fullName,
      addedManually: false,
      addReason: null,
      openedAt: null,
      signedAt: null,
      signatureName: null,
      signatureMark: null,
    });
  }
}

function activateVersion(
  store: MemoryStore,
  session: SessionUser,
  version: DocumentVersion,
) {
  const document = store.db.documents.find((d) => d.id === version.documentId)!;
  for (const other of store.db.versions) {
    if (other.documentId === version.documentId && other.status === "active") {
      other.status = "archived";
    }
  }
  version.status = "active";
  version.versionLabel = version.versionLabel.replace(" draft", "");
  for (const req of store.db.requirements) {
    if (req.documentVersionId === version.id) {
      req.documentVersionId = version.id;
    }
  }
  const previous = store.db.packets.find(
    (p) =>
      p.individualId === document.individualId &&
      p.status === "open" &&
      p.documentVersionId !== version.id,
  );
  if (previous) previous.status = "archived";
  let packet = store.db.packets.find((p) => p.documentVersionId === version.id);
  if (!packet) {
    packet = {
      id: crypto.randomUUID(),
      agencyId: version.agencyId,
      individualId: document.individualId,
      documentVersionId: version.id,
      whatAcknowledging: `${document.title} · ${version.versionLabel}`,
      startsOn: version.effectiveOn,
      endsOn: version.expiresOn,
      status: "open",
    };
    store.db.packets.unshift(packet);
  }
  syncPacketRoster(store, packet);
  ensurePlanCollections(store);
  const existingPcsp = store.db.obligations.filter(
    (item) =>
      item.individualId === document.individualId && item.kind === "pcsp",
  );
  const firstStack = existingPcsp.length === 0;
  for (const item of existingPcsp) {
    if (item.documentVersionId !== version.id) {
      item.expiresOn = version.effectiveOn;
    }
  }
  if (firstStack) {
    const proposed = proposeFromPcsp({
      agencyId: version.agencyId,
      individualId: document.individualId,
      documentVersionId: version.id,
      expiresOn: version.expiresOn,
      personName: personName(store, document.individualId),
      effectiveOn: version.effectiveOn,
    });
    store.db.obligations.push(...proposed);
  } else if (!existingPcsp.some((item) => item.documentVersionId === version.id)) {
    store.db.obligations.push({
      id: crypto.randomUUID(),
      agencyId: version.agencyId,
      individualId: document.individualId,
      kind: "pcsp",
      mode: "required",
      title: `PCSP for ${personName(store, document.individualId)}`,
      detail: `I have read and understood the PCSP that started on ${version.effectiveOn}. I had the opportunity to ask questions.`,
      sourcePage: 1,
      documentVersionId: version.id,
      enabled: true,
      frequency: "On plan update",
      shiftPeriods: [],
      expiresOn: version.expiresOn,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      ...blankRnFields,
    });
  }
  for (const item of store.db.obligations.filter(
    (row) => row.individualId === document.individualId,
  )) {
    syncObligationRoster(store, item);
  }
  log(
    store,
    session,
    "document.activated",
    `${document.title} · ${version.versionLabel} activated. Earlier versions retained.`,
    "document_version",
    version.id,
  );
}

function packetDetail(store: MemoryStore, packet: AcknowledgmentPacket): PacketDetail {
  const individual = store.db.individuals.find((p) => p.id === packet.individualId)!;
  const site = store.db.sites.find((s) => s.id === individual.siteId)!;
  const version = store.db.versions.find((v) => v.id === packet.documentVersionId)!;
  const document = store.db.documents.find((d) => d.id === version.documentId)!;
  const rows = store.db.rows
    .filter((r) => r.packetId === packet.id)
    .sort((a, b) => {
      if (a.signedAt && b.signedAt) return a.signedAt.localeCompare(b.signedAt);
      if (a.signedAt) return -1;
      if (b.signedAt) return 1;
      return a.staffName.localeCompare(b.staffName);
    });
  return { packet, individual, site, version, document, rows };
}

function toWorkspace(store: MemoryStore, session: SessionUser): WorkspaceView {
  ensurePlanCollections(store);
  ensureClinicalRenewals(store);
  ensureTrainingChecklists(store);
  ensureMonthlyCycles(store.db, todayIso());
  ensureSiteReviews(store.db);
  applyMedicationCountdowns(store);
  const canViewPeople = hasPermission(session, "individuals.view");
  const canReadAudit = hasPermission(session, "audit.read") && isAgencyWideViewer(session);
  const sites = store.db.sites.filter((row) => row.agencyId === session.agencyId && canAccessSite(session, row.id));
  const individuals = canViewPeople
    ? store.db.individuals.filter((row) => canReadIndividual(session, row, store.db.assignments))
    : [];
  const personIds = new Set(individuals.map((row) => row.id));
  const siteIds = new Set(sites.map((row) => row.id));
  const memberships = store.db.memberships.filter((row) => row.agencyId === session.agencyId &&
    (isAgencyWideViewer(session) || row.userId === session.userId || (row.siteId && siteIds.has(row.siteId))));
  const allRequirements = store.db.requirements.filter(
    (row) => row.agencyId === session.agencyId && canViewPeople &&
      (row.individualId ? personIds.has(row.individualId) : siteIds.has(row.siteId)),
  );
  const scorecard = metrics((session.roleKey === "hr"
    ? store.db.requirements.filter((row) => row.agencyId === session.agencyId)
    : allRequirements).map((row) => mapRequirement(store, row)));
  const requirements = canViewPeople ? allRequirements : [];
  const versions = canViewPeople
    ? store.db.versions.filter((row) => row.agencyId === session.agencyId && hasPermission(session, "documents.view") &&
        store.db.documents.some((doc) => doc.id === row.documentId && personIds.has(doc.individualId)))
    : [];
  const packets = canViewPeople
    ? store.db.packets.filter((row) => row.agencyId === session.agencyId && personIds.has(row.individualId))
    : [];
  const audit = canReadAudit
    ? store.db.audit.filter((row) => row.agencyId === session.agencyId)
    : store.db.audit.filter(
        (row) => row.agencyId === session.agencyId && row.actorId === session.userId,
      );
  const managerBySite = Object.fromEntries(
    memberships
      .filter((m) => m.role === "manager" && m.siteId)
      .map((m) => {
        const profile = store.db.profiles.find((p) => p.id === m.userId)!;
        return [m.siteId as string, profile.fullName];
      }),
  );
  const fallbackManager =
    store.db.profiles.find(
      (p) => memberships.find((m) => m.userId === p.id)?.role === "administrator",
    )?.fullName ?? session.fullName;
  const colors = ["purple", "green", "peach", "blue"];
  return {
    session,
    sites: sites.map((site, i) => ({
      id: site.id,
      name: site.name,
      address: site.address,
      program: store.db.programs.find((p) => p.id === site.programId)?.name ?? "",
      manager: managerBySite[site.id] ?? fallbackManager,
      color: ["purple", "green", "peach", "blue", "pink", "green"][i % 6],
      initials: (managerBySite[site.id] ?? fallbackManager)
        .split(" ")
        .map((part) => part[0])
        .join(""),
      ...normalizeSiteFacts(site),
    })),
    individuals: individuals.map((person, i) => {
      const site = sites.find((s) => s.id === person.siteId)!;
      return {
        id: person.id,
        name: person.fullName,
        site: site?.name ?? "Unknown site",
        siteId: person.siteId,
        dateOfBirth: person.dateOfBirth,
        manager: managerBySite[person.siteId] ?? fallbackManager,
        initials: person.fullName
          .split(" ")
          .map((part) => part[0])
          .join(""),
        color: colors[i % 4],
        profile: normalizeProfile(person, person.profile),
        photoUrl: person.photoUrl ?? null,
      };
    }),
    staff: memberships.map((membership) => {
      const profile = store.db.profiles.find((p) => p.id === membership.userId)!;
      const site = membership.siteId
        ? sites.find((s) => s.id === membership.siteId)
        : undefined;
      return {
        id: profile.id,
        name: profile.fullName,
        role: roleLabel(membership.roleKey ?? membership.role, profile.jobTitle),
        site: site?.name ?? "Agency-wide",
        siteId: membership.siteId,
        email: profile.email,
        username: profile.username,
        appRole: membership.role,
        roleKey: membership.roleKey ?? membership.role,
        expiresOn: membership.expiresOn ?? null,
      };
    }),
    requirements: requirements.map((row) => mapRequirement(store, row)),
    plans: versions.map((version) => mapPlan(store, version)),
    activity: audit.map((event) => ({
      id: event.id,
      text: event.action.replaceAll(".", " "),
      detail: event.detail,
      time: event.createdAt,
      kind:
        event.action.includes("complete") || event.action.includes("signed")
          ? "complete"
          : event.action.includes("review") || event.action.includes("approved")
            ? "review"
            : event.action.includes("overdue")
              ? "alert"
              : "document",
    })),
    packets: packets.map((packet) => packetDetail(store, packet)),
    planStacks: individuals.map((person) => mapPlanStack(store, session, person)),
    roles: rolesFor(store, session.agencyId),
    scorecard,
    monthly: {
      equipment: store.db.adaptiveEquipment.filter((row) => row.agencyId === session.agencyId && personIds.has(row.individualId)),
      equipmentLogs: store.db.equipmentMonthLogs.filter((log) =>
        store.db.adaptiveEquipment.some(
          (item) => item.id === log.equipmentId && item.agencyId === session.agencyId && personIds.has(item.individualId),
        ),
      ),
      drills: store.db.emergencyDrills.filter((row) => row.agencyId === session.agencyId && siteIds.has(row.siteId)),
      safetyReports: store.db.homeSafetyReports.filter((row) => row.agencyId === session.agencyId && siteIds.has(row.siteId)),
    },
    monthlyDue: normalizeMonthlyDue(
      store.db.agencies.find((row) => row.id === session.agencyId)?.monthlyDue,
    ),
    siteReviews: (store.db.siteReviews ?? [])
      .filter((row) => row.agencyId === session.agencyId && siteIds.has(row.siteId))
      .map((row) => normalizeSiteReview(applyWellWaterDefault(row, siteFactsFrom(
        sites.find((site) => site.id === row.siteId) ?? {
          id: row.siteId,
          agencyId: row.agencyId,
          programId: "",
          name: "",
          address: "",
        },
      )))),
    branding: { logoUrl: null },
  };
}

export class LocalApi implements ComplyraApi {
  constructor(private store: MemoryStore = browserStore) {}

  async listNotifications() {
    const session = assertSession(this.store);
    return (this.store.db.notifications ?? []).filter((row) => row.agencyId === session.agencyId &&
      (row.userId === session.userId || (!row.userId && row.roleKey === session.roleKey)))
      .map((row) => ({
        id: row.id, agency_id: row.agencyId, user_id: row.userId, role_key: row.roleKey,
        type: row.type as import("../features/notifications/notify").NotificationType,
        title: row.title, body: row.body, deep_link: row.deepLink, entity_type: row.entityType,
        entity_id: row.entityId, dedupe_key: row.dedupeKey, created_at: row.createdAt,
        read_at: row.userId ? row.readAt : this.store.db.notificationReads?.[`${session.userId}:${row.id}`] ?? null,
      })).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
  }

  async markNotificationsRead(ids: string[]) {
    const session = assertSession(this.store);
    const visible = new Set((await this.listNotifications()).map((row) => row.id));
    const now = new Date().toISOString();
    this.store.db.notificationReads ??= {};
    for (const row of this.store.db.notifications ?? []) {
      if (!ids.includes(row.id) || !visible.has(row.id)) continue;
      if (row.userId === session.userId) row.readAt ??= now;
      else this.store.db.notificationReads[`${session.userId}:${row.id}`] ??= now;
    }
    await persistMeta(this.store);
  }

  async getSession() {
    await hydrate();
    return currentSession(this.store);
  }

  async signIn(input: LoginInput) {
    await hydrate();
    const agencyCode = normalizeAgencyCode(input.agencyCode);
    const username = normalizeUsername(input.username);
    const agency = this.store.db.agencies.find(
      (row) => row.agencyCode === agencyCode,
    );
    const profile = this.store.db.profiles.find(
      (row) =>
        row.homeAgencyId === agency?.id &&
        normalizeUsername(row.username) === username,
    );
    const credential = profile
      ? this.store.db.credentials.find((row) => row.userId === profile.id)
      : undefined;
    if (!agency || !profile || !credential) {
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    if (credential.password !== input.password) {
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    const membership = this.store.db.memberships.find(
      (row) => row.userId === profile.id && row.agencyId === agency.id,
    );
    if (!membership || (membership.expiresOn && membership.expiresOn < todayIso())) {
      throw new Error(LOGIN_NO_MEMBERSHIP_MESSAGE);
    }
    this.store.sessionUserId = credential.userId;
    const session = currentSession(this.store)!;
    // 13 CSR 65-3.050: track user log-in.
    this.pushSignatureAudit(session, "login", {});
    await persistMeta(this.store);
    return session;
  }

  async signOut() {
    const session = this.store.sessionUserId
      ? currentSession(this.store)
      : null;
    this.store.sessionUserId = null;
    this.store.signingReauthAt.clear();
    if (session) {
      // 13 CSR 65-3.050: track user log-out. Re-auth state is cleared so a
      // later session cannot sign on this session's password re-entry.
      this.pushSignatureAudit(session, "logout", {});
    }
    await persistMeta(this.store);
  }

  async changePassword(currentPassword: string, nextPassword: string) {
    const session = assertSession(this.store);
    const credential = this.store.db.credentials.find(
      (row) => row.userId === session.userId,
    );
    if (!credential || credential.password !== currentPassword) {
      throw new Error("Current password is not correct.");
    }
    if (nextPassword.length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (nextPassword === currentPassword) {
      throw new Error("Choose a new password that is different from the temporary one.");
    }
    credential.password = nextPassword;
    const profile = this.store.db.profiles.find((row) => row.id === session.userId);
    if (profile) profile.mustChangePassword = false;
    await persistMeta(this.store);
  }

  async createAgency(input: CreateAgencyInput): Promise<CreateAgencyResult> {
    await hydrate();
    const name = input.name.trim();
    if (!name) throw new Error("Enter the agency name.");
    const invalid = validateAgencyCodeParts(input.slug, input.stateCode);
    if (invalid) throw new Error(invalid);
    const agencyCode = buildAgencyCode(input.slug, input.stateCode);
    if (this.store.db.agencies.some((row) => row.agencyCode === agencyCode)) {
      throw new Error("That agency code is already in use. Try a different short name.");
    }
    const username = normalizeUsername(input.adminUsername);
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error("Username must be 3–40 characters: letters, numbers, or dots.");
    }
    if (input.adminTempPassword.length < 8) {
      throw new Error("Temporary password must be at least 8 characters.");
    }
    if (!input.adminFullName.trim()) {
      throw new Error("Enter the first administrator’s name.");
    }
    const agencyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const email = `${username}@${agencyCode.toLowerCase()}.complyrer.user`;
    const provisionedBy =
      input.provisionedBy === "platform" && currentSession(this.store)?.platformAdmin
        ? "platform"
        : "self";
    const status = provisionedBy === "platform" ? "active" : "pending";
    this.store.db.agencies.push({
      id: agencyId,
      name,
      agencyCode,
      stateCode: input.stateCode.trim().toUpperCase(),
      provisionedBy,
      status,
      monthlyDue: normalizeMonthlyDue(),
    });
    this.store.db.profiles.push({
      id: userId,
      fullName: input.adminFullName.trim(),
      email,
      jobTitle: "Agency administrator",
      username,
      homeAgencyId: agencyId,
      mustChangePassword: true,
    });
    this.store.db.agencyRoles = [
      ...(this.store.db.agencyRoles ?? []),
      ...ROLE_TEMPLATES.map((template) => ({ ...template, agencyId })),
    ];
    this.store.db.memberships.push({
      id: crypto.randomUUID(),
      agencyId,
      userId,
      role: "administrator",
      roleKey: "administrator",
      siteId: null,
      expiresOn: null,
    });
    this.store.db.credentials.push({
      userId,
      email,
      password: input.adminTempPassword,
    });
    await persistMeta(this.store);
    return {
      agencyCode,
      username,
      fullName: input.adminFullName.trim(),
      status,
    };
  }

  async inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
    const session = assertSession(this.store);
    if (!hasPermission(session, "members.invite")) {
      throw new Error("You do not have permission to add members.");
    }
    // HR-ROLES (2026-09-13): HR may invite staff, but only an administrator
    // may invite another administrator.
    if (!canGrantRole(session.roleKey, input.roleKey)) {
      throw new Error("Only an administrator can invite someone to that role.");
    }
    const username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error("Username must be 3–40 characters: letters, numbers, or dots.");
    }
    if (input.tempPassword.length < 8) {
      throw new Error("Temporary password must be at least 8 characters.");
    }
    if (!input.fullName.trim()) {
      throw new Error("Enter the staff member’s name.");
    }
    if (!isRoleKey(input.roleKey)) throw new Error("Choose a valid role.");
    const taken = this.store.db.profiles.some(
      (row) =>
        row.homeAgencyId === session.agencyId &&
        normalizeUsername(row.username) === username,
    );
    if (taken) {
      throw new Error("That username is already used in this agency.");
    }
    const agency = this.store.db.agencies.find((row) => row.id === session.agencyId);
    if (!agency) throw new Error("Agency not found.");
    const userId = crypto.randomUUID();
    const email = `${username}@${agency.agencyCode.toLowerCase()}.complyrer.user`;
    const capability = capabilityForRoleKey(input.roleKey);
    this.store.db.profiles.push({
      id: userId,
      fullName: input.fullName.trim(),
      email,
      jobTitle: input.jobTitle?.trim() || roleLabel(input.roleKey),
      username,
      homeAgencyId: session.agencyId,
      mustChangePassword: true,
    });
    this.store.db.memberships.push({
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      userId,
      role: capability,
      roleKey: input.roleKey,
      siteId: input.siteId ?? null,
      expiresOn: input.expiresOn ?? null,
    });
    this.store.db.credentials.push({
      userId,
      email,
      password: input.tempPassword,
    });
    log(
      this.store,
      session,
      "member.invited",
      `${input.fullName.trim()} invited as ${input.roleKey} · username ${username}`,
      "profile",
      userId,
    );
    await persistMeta(this.store);
    return {
      username,
      agencyCode: agency.agencyCode,
      fullName: input.fullName.trim(),
      role: capability,
    };
  }

  async assignMemberRole(
    userId: string,
    roleKey: string,
    siteId?: string | null,
    expiresOn?: string | null,
  ) {
    const session = assertSession(this.store);
    if (!hasPermission(session, "members.assign_roles")) {
      throw new Error("You do not have permission to assign roles.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    // HR-ROLES (2026-09-13): HR can assign operational roles, but granting
    // administrator / compliance-administrator stays with administrators.
    if (!canGrantRole(session.roleKey, roleKey)) {
      throw new Error("Only an administrator can grant that role.");
    }
    const membership = this.store.db.memberships.find(
      (row) => row.userId === userId && row.agencyId === session.agencyId,
    );
    if (!membership) throw new Error("Staff member not found.");
    if (
      membership.roleKey === "administrator" &&
      roleKey !== "administrator" &&
      this.store.db.memberships.filter(
        (row) => row.agencyId === session.agencyId && row.roleKey === "administrator",
      ).length < 2
    ) {
      throw new Error("Keep at least one agency administrator.");
    }
    membership.role = capabilityForRoleKey(roleKey);
    membership.roleKey = roleKey;
    membership.siteId = siteId ?? membership.siteId;
    membership.expiresOn = expiresOn ?? null;
    log(
      this.store,
      session,
      "member.role_assigned",
      `${roleLabel(roleKey)} assigned`,
      "membership",
      membership.id,
    );
    await persistMeta(this.store);
  }

  async updateAgencyRole(roleKey: string, permissions: PermissionMap) {
    const session = assertSession(this.store);
    // HR-ROLES (2026-09-13): editing the role templates themselves is a
    // separate permission from assigning roles to people, so HR cannot use
    // role assignment to escalate its own access. Guard via the canonical
    // module (src/data/permissions.ts) — do not re-add ad-hoc checks here.
    if (!hasPermission(session, "roles.manage")) {
      throw new Error("Only administrators can edit role access.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    const templateGuardError = checkRoleTemplateUpdate(roleKey, permissions);
    if (templateGuardError) throw new Error(templateGuardError);
    this.store.db.agencyRoles = rolesFor(this.store, session.agencyId).map((row) =>
      row.key === roleKey ? { ...row, permissions: { ...permissions } } : row,
    );
    log(
      this.store,
      session,
      "role.updated",
      `${roleLabel(roleKey)} access levels updated`,
      "agency_role",
    );
    await persistMeta(this.store);
  }

  async resetMemberPassword(userId: string) {
    const session = assertSession(this.store);
    assertCan(session, "members.reset_password");
    const membership = this.store.db.memberships.find(
      (row) => row.userId === userId && row.agencyId === session.agencyId,
    );
    if (!membership) throw new Error("Staff member not found.");
    const profile = this.store.db.profiles.find((row) => row.id === userId);
    const credential = this.store.db.credentials.find((row) => row.userId === userId);
    if (!profile || !credential) throw new Error("Staff member not found.");
    const tempPassword = generateTempPassword();
    credential.password = tempPassword;
    profile.mustChangePassword = true;
    log(
      this.store,
      session,
      "member.password_reset",
      `Temporary password issued for ${profile.fullName}`,
      "profile",
      userId,
    );
    await persistMeta(this.store);
    return { tempPassword };
  }

  async listPendingAgencies(): Promise<PendingAgency[]> {
    const session = assertSession(this.store);
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can review agency setups.");
    }
    return this.store.db.agencies
      .filter((row) => row.status === "pending")
      .map((row) => ({
        id: row.id,
        name: row.name,
        agencyCode: row.agencyCode,
        stateCode: row.stateCode,
        provisionedBy: row.provisionedBy ?? "self",
        status: row.status,
      }));
  }

  async setAgencyStatus(agencyId: string, status: AgencyStatus) {
    const session = assertSession(this.store);
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can approve agency setups.");
    }
    const agency = this.store.db.agencies.find((row) => row.id === agencyId);
    if (!agency) throw new Error("Agency not found.");
    agency.status = status;
    log(
      this.store,
      session,
      "agency.status",
      `${agency.name} marked ${status}`,
      "agency",
      agency.id,
    );
    await persistMeta(this.store);
  }

  async loadWorkspace(session: SessionUser) {
    await hydrate();
    const active = assertSession(this.store);
    if (active.userId !== session.userId || active.agencyId !== session.agencyId) {
      throw new Error("Sign in to this workspace to continue.");
    }
    session = active;
    seedDemoLogoPath(this.store);
    const view = toWorkspace(this.store, session);
    view.branding = {
      logoUrl: await logoDataUrlFor(this.store, session.agencyId),
    };
    return view;
  }

  async createRequirementDraft(input: Parameters<ComplyraApi["createRequirementDraft"]>[0]) {
    const session = assertSession(this.store);
    assertCan(session, "documents.upload");
    const individual = accessibleIndividual(this.store, session, input.individualId);
    if (!input.title.trim()) throw new Error("Enter a title for the requirement.");
    assertCalendarDate(input.dueOn, "Use a valid due date.");
    if (!Number.isInteger(input.sourcePage) || input.sourcePage < 1) throw new Error("Source page must be a positive whole number.");
    assertRequirementOwner(this.store, session, input.ownerUserId);
    const version = this.store.db.versions.find((v) => {
      const document = this.store.db.documents.find((d) => d.id === v.documentId);
      return document?.individualId === individual.id && v.agencyId === session.agencyId && `${document?.title} · ${v.versionLabel}` === input.source;
    });
    this.store.db.requirements.unshift({
      id: `REQ-${crypto.randomUUID().slice(0, 8)}`,
      agencyId: session.agencyId,
      documentVersionId: version?.id ?? null,
      individualId: individual.id,
      siteId: individual.siteId,
      title: input.title.trim(),
      category: input.category,
      ownerUserId: input.ownerUserId,
      dueOn: input.dueOn,
      frequency: input.frequency,
      sourcePage: input.sourcePage,
      status: "Pending review",
      evidenceNote: "",
    });
    log(
      this.store,
      session,
      "requirement.drafted",
      `${input.title} · ${individual.fullName} · Pending manager approval`,
      "requirement",
    );
    await persistMeta(this.store);
  }

  async approveRequirement(id: string) {
    const session = assertSession(this.store);
    assertCan(session, "requirements.approve");
    const item = accessibleRequirement(this.store, session, id);
    if (!item || item.status !== "Pending review") {
      throw new Error("Only draft requirements can be approved.");
    }
    item.status = computeRequirementStatus(item.dueOn, item.category);
    const version = item.documentVersionId
      ? this.store.db.versions.find((v) => v.id === item.documentVersionId)
      : undefined;
    const stillPending = this.store.db.requirements.some(
      (r) =>
        r.documentVersionId === item.documentVersionId &&
        r.status === "Pending review" &&
        r.id !== item.id,
    );
    if (version && version.status === "pending_review" && !stillPending) {
      activateVersion(this.store, session, version);
      // LIFEPATH-P2 hook: targeted retraining for staff assigned to this individual.
      const individual = this.store.db.individuals.find(
        (row) => row.id === item.individualId,
      );
      if (individual) await this.p2GeneratePlanRetraining(session, individual, version);
    }
    log(
      this.store,
      session,
      "requirement.approved",
      `${item.title} · Approved by ${session.fullName} · Assigned to ${ownerName(this.store, item.ownerUserId)}`,
      "requirement",
      item.id,
    );
    await persistMeta(this.store);
  }

  async completeRequirement(id: string, evidence: string) {
    const session = assertSession(this.store);
    assertCan(session, "requirements.complete");
    if (!evidence.trim()) throw new Error("A completion record is required.");
    const item = accessibleRequirement(this.store, session, id);
    if (!item) throw new Error("Requirement not found.");
    if (item.status === "Pending review") {
      throw new Error("Approve this requirement before recording completion.");
    }
    if (
      session.role === "dsp" &&
      item.ownerUserId !== session.userId
    ) {
      throw new Error("You can only complete requirements assigned to you.");
    }
    item.status = "Compliant";
    item.evidenceNote = evidence.trim();
    item.completedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "requirement.completed",
      `${session.fullName} · ${item.title} · ${siteName(this.store, item.siteId)}`,
      "requirement",
      item.id,
    );
    await persistMeta(this.store);
  }

  async reassignRequirement(id: string, ownerUserId: string) {
    await this.updateRequirement(id, { ownerUserId });
  }

  async updateRequirement(
    id: string,
    patch: {
      title?: string;
      dueOn?: string;
      frequency?: string;
      ownerUserId?: string;
    },
  ) {
    const session = assertSession(this.store);
    assertCan(session, "requirements.approve");
    const item = accessibleRequirement(this.store, session, id);
    if (!item) throw new Error("Requirement not found.");
    // Validate the entire edit before changing the stored record.
    if (patch.title !== undefined && !patch.title.trim()) throw new Error("Enter a title for the requirement.");
    if (patch.dueOn !== undefined) assertCalendarDate(patch.dueOn, "Use a valid due date.");
    if (patch.ownerUserId !== undefined) assertRequirementOwner(this.store, session, patch.ownerUserId);
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("Enter a title for the requirement.");
      if (title !== item.title) {
        changes.push(`title \u2192 "${title}"`);
        item.title = title;
      }
    }
    if (patch.dueOn !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.dueOn)) {
        throw new Error("Use a valid due date.");
      }
      if (patch.dueOn !== item.dueOn) {
        changes.push(`due ${item.dueOn} \u2192 ${patch.dueOn}`);
        item.dueOn = patch.dueOn;
      }
    }
    if (patch.frequency !== undefined && patch.frequency !== item.frequency) {
      changes.push(`frequency \u2192 ${patch.frequency}`);
      item.frequency = patch.frequency;
    }
    if (
      patch.ownerUserId !== undefined &&
      patch.ownerUserId !== item.ownerUserId
    ) {
      changes.push(`owner \u2192 ${ownerName(this.store, patch.ownerUserId)}`);
      item.ownerUserId = patch.ownerUserId;
    }
    if (!changes.length) return;
    if (item.status !== "Pending review" && item.status !== "Compliant") {
      item.status = computeRequirementStatus(item.dueOn, item.category);
    }
    log(
      this.store,
      session,
      "requirement.corrected",
      `${session.fullName} corrected ${item.title} \u00b7 ${changes.join(" \u00b7 ")}`,
      "requirement",
      item.id,
    );
    await persistMeta(this.store);
  }

  async uploadDocument(input: UploadDocumentInput) {
    const session = assertSession(this.store);
    assertCan(session, "documents.upload");
    if (!input.file.name.toLowerCase().endsWith(".pdf") || input.file.size > 10 * 1024 * 1024) {
      throw new Error("Choose a PDF smaller than 10 MB.");
    }
    const individual = this.store.db.individuals.find((p) => p.id === input.individualId);
    if (!individual) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, individual.id);
    const title = input.title || `${individual.fullName} · PCSP 2026`;
    let document = this.store.db.documents.find(
      (d) => d.individualId === individual.id && d.title === title,
    );
    if (!document) {
      document = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        individualId: individual.id,
        title,
        kind: input.kind ?? "pcsp",
      };
      this.store.db.documents.unshift(document);
    }
    const nextNumber =
      Math.max(
        0,
        ...this.store.db.versions
          .filter((v) => v.documentId === document.id)
          .map((v) => parseInt(v.versionLabel.replace("v", ""), 10) || 0),
      ) + 1;
    const versionLabel = `v${nextNumber} draft`;
    const versionId = crypto.randomUUID();
    const storagePath = `${session.agencyId}/${individual.id}/${versionId}/source.pdf`;
    const bytes = await input.file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = [...new Uint8Array(hashBuffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    await persistFile(storagePath, input.file);
    const version: DocumentVersion = {
      id: versionId,
      agencyId: session.agencyId,
      documentId: document.id,
      versionLabel,
      status: "pending_review",
      storagePath,
      contentHash,
      pageCount: input.pageCount,
      effectiveOn: input.effectiveOn,
      expiresOn: input.expiresOn ?? null,
      createdBy: session.userId,
    };
    this.store.db.versions.unshift(version);
    if (input.requirementTitle?.trim()) {
      if ((input.sourcePage ?? 1) > input.pageCount) {
        throw new Error("The source page cannot exceed the document’s page count.");
      }
      this.store.db.requirements.unshift({
        id: `REQ-${crypto.randomUUID().slice(0, 8)}`,
        agencyId: session.agencyId,
        documentVersionId: version.id,
        individualId: individual.id,
        siteId: individual.siteId,
        title: input.requirementTitle.trim(),
        category: input.category ?? "PCSP acknowledgments",
        ownerUserId: input.ownerUserId ?? session.userId,
        dueOn: input.dueOn ?? input.effectiveOn,
        frequency: input.frequency ?? "On plan update",
        sourcePage: input.sourcePage ?? 1,
        status: "Pending review",
        evidenceNote: "",
      });
    }
    log(
      this.store,
      session,
      "document.uploaded",
      `${title} · ${versionLabel} · File retained (${input.file.name})`,
      "document_version",
      version.id,
    );
    await persistMeta(this.store);
  }

  async getDocumentFile(versionId: string) {
    const session = assertSession(this.store);
    assertCan(session, "documents.view");
    const version = this.store.db.versions.find((v) => v.id === versionId);
    if (!version) return null;
    const document = this.store.db.documents.find((row) => row.id === version.documentId);
    if (!document) return null;
    accessibleIndividual(this.store, session, document.individualId);
    if (!version.storagePath) return null;
    return readFile(version.storagePath);
  }

  async assignStaff(individualId: string, userId: string) {
    const session = assertSession(this.store);
    assertPrivileged(session);
    const individual = this.store.db.individuals.find((p) => p.id === individualId);
    if (!individual) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, individual.id);
    this.store.db.assignments.push({
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      userId,
      individualId,
      siteId: individual.siteId,
      startsOn: new Date().toISOString().slice(0, 10),
      endsOn: null,
    });
    for (const packet of this.store.db.packets.filter(
      (p) => p.individualId === individualId && p.status === "open",
    )) {
      syncPacketRoster(this.store, packet);
    }
    // LIFEPATH-P2 hook: auto-generate the full in-home checklist for the newly assigned staff.
    await this.p2GenerateForNewAssignment(session, userId, individual);
    ensurePlanCollections(this.store);
    for (const item of this.store.db.obligations.filter(
      (row) => row.individualId === individualId,
    )) {
      syncObligationRoster(this.store, item);
    }
    ensureTrainingChecklists(this.store);
    log(
      this.store,
      session,
      "staff.assigned",
      `${ownerName(this.store, userId)} assigned to ${individual.fullName}`,
      "staff_assignment",
    );
    await persistMeta(this.store);
  }

  async addPacketSigner(packetId: string, userId: string, reason: string) {
    const session = assertSession(this.store);
    assertCan(session, "acknowledgments.manage");
    if (!reason.trim()) throw new Error("Add a reason for this one-off signer.");
    const packet = this.store.db.packets.find((p) => p.id === packetId);
    if (!packet || packet.status !== "open") throw new Error("Packet not found.");
    if (this.store.db.rows.some((r) => r.packetId === packetId && r.userId === userId)) {
      throw new Error("That staff member is already on this sheet.");
    }
    const profile = this.store.db.profiles.find((p) => p.id === userId);
    if (!profile) throw new Error("Staff member not found.");
    this.store.db.rows.push({
      id: crypto.randomUUID(),
      agencyId: packet.agencyId,
      packetId,
      userId,
      staffName: profile.fullName,
      addedManually: true,
      addReason: reason.trim(),
      openedAt: null,
      signedAt: null,
      signatureName: null,
      signatureMark: null,
    });
    log(
      this.store,
      session,
      "acknowledgment.signer_added",
      `${profile.fullName} added to acknowledgment sheet · ${reason.trim()}`,
      "acknowledgment_row",
    );
    await persistMeta(this.store);
  }

  async markOpened(rowId: string) {
    const session = assertSession(this.store);
    const row = this.store.db.rows.find((r) => r.id === rowId);
    if (!row) throw new Error("Acknowledgment row not found.");
    if (row.userId !== session.userId && !isPrivileged(session.role)) {
      throw new Error("You can only open your assigned acknowledgments.");
    }
    if (!row.openedAt) row.openedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "document.opened",
      `${session.fullName} opened the source document for acknowledgment`,
      "acknowledgment_row",
      row.id,
    );
    await persistMeta(this.store);
  }

  async signRow(rowId: string, signatureName: string, signatureMark: string) {
    const session = assertSession(this.store);
    const row = this.store.db.rows.find((r) => r.id === rowId);
    if (!row) throw new Error("Acknowledgment row not found.");
    if (row.userId !== session.userId) {
      throw new Error("Staff must sign their own acknowledgment row.");
    }
    const packet = this.store.db.packets.find((p) => p.id === row.packetId);
    if (!packet || packet.status !== "open") {
      throw new Error("This acknowledgment sheet is locked.");
    }
    if (!row.openedAt) {
      throw new Error("Open and review the PCSP before signing.");
    }
    if (row.signedAt) throw new Error("This row is already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    row.signatureName = signatureName.trim();
    row.signatureMark = signatureMark;
    row.signedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "acknowledgment.signed",
      `${session.fullName} signed ${packet.whatAcknowledging}`,
      "acknowledgment_row",
      row.id,
    );
    await persistMeta(this.store);
  }

  async updateIndividualProfile(individualId: string, profile: IndividualProfile) {
    const session = assertSession(this.store);
    if (!canEditCover(session.roleKey)) {
      throw new Error("Only a DPM or compliance admin can edit cover-page fields.");
    }
    const person = this.store.db.individuals.find((p) => p.id === individualId);
    if (!person) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, person.id);
    person.profile = normalizeProfile(person, profile);
    if (profile.legalName.trim()) person.fullName = profile.legalName.trim();
    await persistMeta(this.store);
  }

  async updateObligation(
    obligationId: string,
    patch: Parameters<ComplyraApi["updateObligation"]>[1],
  ) {
    const session = assertSession(this.store);
    const item = this.store.db.obligations.find((row) => row.id === obligationId);
    if (!item) throw new Error("Item not found.");
    accessibleIndividual(this.store, session, item.individualId);
    const turningOnDelegation = item.kind === "delegation" && patch.enabled === true;
    const turningOffDelegation = item.kind === "delegation" && patch.enabled === false;
    if (turningOffDelegation) {
      throw new Error(
        "Upload a discontinuation order before turning a delegation off.",
      );
    }
    if (turningOnDelegation) {
      if (!canToggleDelegation(session.roleKey, session.role, hasPermission(session, "requirements.approve"))) {
        throw new Error("Only a DPM or nurse can turn a delegation on.");
      }
    } else if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a DPM can edit extracted items.");
    }
    Object.assign(item, patch);
    if (turningOnDelegation) {
      // DPM can create/turn on the form. The delegating RN still signs first.
      Object.assign(item, blankRnFields);
    }
    if (item.enabled && item.mode === "required") {
      item.proposed = false;
      syncObligationRoster(this.store, item);
    }
    await persistMeta(this.store);
  }

  async addProtocol(individualId: string, title: string, detail = "") {
    const session = assertSession(this.store);
    if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a DPM can add a protocol.");
    }
    if (!title.trim()) throw new Error("Name the protocol.");
    const person = this.store.db.individuals.find((p) => p.id === individualId);
    if (!person) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, person.id);
    const item: ObligationItem = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId,
      kind: "protocol",
      mode: "required",
      title: title.trim(),
      detail: detail.trim() || "Staff acknowledge this protocol.",
      sourcePage: null,
      documentVersionId: null,
      enabled: true,
      frequency: "On protocol update",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "manual",
      inventoryState: "present",
      proposed: false,
      ...blankRnFields,
    };
    this.store.db.obligations.push(item);
    syncObligationRoster(this.store, item);
    await persistMeta(this.store);
  }

  async promoteToShiftTask(obligationId: string, shiftPeriods: string[]) {
    const session = assertSession(this.store);
    if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a DPM can add a daily shift requirement.");
    }
    const item = this.store.db.obligations.find((row) => row.id === obligationId);
    if (!item) throw new Error("Item not found.");
    accessibleIndividual(this.store, session, item.individualId);
    item.kind = "shift_task";
    item.mode = "required";
    item.enabled = true;
    item.proposed = false;
    item.frequency = "Daily";
    item.shiftPeriods = shiftPeriods.map((part) => part.trim()).filter(Boolean);
    syncObligationRoster(this.store, item);
    await persistMeta(this.store);
  }

  async markObligationOpened(signatureId: string) {
    const session = assertSession(this.store);
    const row = this.store.db.obligationSignatures.find((r) => r.id === signatureId);
    if (!row) throw new Error("Signature row not found.");
    if (row.userId !== session.userId && !isPrivileged(session.role)) {
      throw new Error("You can only open your assigned documents.");
    }
    if (!row.openedAt) row.openedAt = new Date().toISOString();
    await persistMeta(this.store);
  }

  async signObligation(
    signatureId: string,
    signatureName: string,
    signatureMark: string,
  ) {
    const session = assertSession(this.store);
    assertCan(session, "acknowledgments.sign_own");
    const row = this.store.db.obligationSignatures.find((r) => r.id === signatureId);
    if (!row) throw new Error("Signature row not found.");
    if (row.userId !== session.userId) {
      throw new Error("Staff must sign their own row.");
    }
    const item = this.store.db.obligations.find((r) => r.id === row.obligationId);
    if (!item || !isObligationActive(item)) {
      throw new Error("This document is not open for signature.");
    }
    if (!staffCanSignDelegation(item)) {
      throw new Error(
        "The delegating RN must sign this form before staff can sign.",
      );
    }
    if (!row.openedAt) {
      throw new Error("Open and review the document before signing.");
    }
    if (row.signedAt) throw new Error("Already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    row.signatureName = signatureName.trim();
    row.signatureMark = signatureMark;
    row.signedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "obligation.signed",
      `${session.fullName} signed ${item.title}`,
      "obligation_signature",
      row.id,
    );
    await persistMeta(this.store);
  }

  async signDelegationRn(
    obligationId: string,
    signatureName: string,
    signatureMark: string,
  ) {
    const session = assertSession(this.store);
    if (!canSignAsDelegatingRn(session.roleKey, session.role)) {
      throw new Error("Only the delegating RN can sign this first.");
    }
    const item = this.store.db.obligations.find((row) => row.id === obligationId);
    if (!item || item.kind !== "delegation" || !item.enabled) {
      throw new Error("Turn the delegation on before the RN signs.");
    }
    accessibleIndividual(this.store, session, item.individualId);
    if (item.rnSignedAt) throw new Error("Delegating RN already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    item.delegatingRnUserId = session.userId;
    item.rnSignedAt = new Date().toISOString();
    item.rnSignatureName = signatureName.trim();
    item.rnSignatureMark = signatureMark;
    if (item.delegationForm) {
      item.delegationForm.delegatingRn.signatureName = signatureName.trim();
      item.delegationForm.delegatingRn.dateSigned = new Date()
        .toISOString()
        .slice(0, 10);
      if (!item.delegationForm.delegatingRn.name.trim()) {
        item.delegationForm.delegatingRn.name = signatureName.trim();
      }
    }
    log(
      this.store,
      session,
      "delegation.rn_signed",
      `${session.fullName} signed as delegating RN on ${item.title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  async uploadRenewalEvidence(input: {
    renewalId: string;
    evidenceKind: ClinicalEvidenceKind;
    documentTitle: string;
    uploadedOn?: string;
    file?: File;
  }) {
    const session = assertSession(this.store);
    if (!canUploadRenewal(session.roleKey)) {
      throw new Error("RN, DPM, or House Manager can upload renewal evidence.");
    }
    const renewal = this.store.db.clinicalRenewals.find((row) => row.id === input.renewalId);
    if (!renewal) throw new Error("Renewal not found.");
    accessibleIndividual(this.store, session, renewal.individualId);
    const title =
      input.documentTitle.trim() ||
      input.file?.name ||
      "Clinical evidence";
    const uploadedOn = (input.uploadedOn ?? new Date().toISOString()).slice(0, 10);
    let fileId = renewal.fileId;
    if (input.file) {
      fileId = await saveChartFile(this.store, {
        agencyId: session.agencyId,
        individualId: renewal.individualId,
        kind: "renewal",
        file: input.file,
      });
    }
    const next = applyRenewalUpload(renewal, {
      uploadedOn,
      documentTitle: title,
      evidenceKind: input.evidenceKind,
      fileId,
    });
    this.store.db.clinicalRenewals = this.store.db.clinicalRenewals.map((row) =>
      row.id === renewal.id ? next : row,
    );
    log(
      this.store,
      session,
      "renewal.evidence_uploaded",
      `${session.fullName} uploaded ${title} for ${renewal.title}`,
      "clinical_renewal",
      renewal.id,
    );
    await persistMeta(this.store);
  }

  async discontinueDelegation(input: {
    obligationId: string;
    title: string;
    file: File;
  }) {
    const session = assertSession(this.store);
    const item = this.store.db.obligations.find((row) => row.id === input.obligationId);
    if (!item || item.kind !== "delegation") {
      throw new Error("Delegation not found.");
    }
    if (
      !canToggleDelegation(
        session.roleKey,
        session.role,
        hasPermission(session, "requirements.approve"),
      )
    ) {
      throw new Error("Only a DPM or nurse can discontinue a delegation.");
    }
    if (!input.file) {
      throw new Error("Upload the discontinuation order first.");
    }
    const title = input.title.trim() || input.file.name;
    const fileId = await saveChartFile(this.store, {
      agencyId: session.agencyId,
      individualId: item.individualId,
      kind: "discontinue",
      file: input.file,
    });
    item.enabled = false;
    item.discontinuedAt = new Date().toISOString();
    item.discontinueFileId = fileId;
    item.discontinueTitle = title;
    log(
      this.store,
      session,
      "delegation.discontinued",
      `${session.fullName} discontinued ${item.title} · ${title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  async getChartFile(input: {
    type: "renewal" | "discontinue" | "training" | "version";
    id: string;
  }) {
    const session = assertSession(this.store);
    if (input.type === "training") {
      const checklist = this.store.db.trainingChecklists.find((row) => row.id === input.id);
      if (!checklist) return null;
      if (
        !canSeeRenewals(session.roleKey) &&
        checklist.staffUserId !== session.userId
      ) {
        throw new Error("You can only open your own training sheet.");
      }
      const person = this.store.db.individuals.find(
        (row) => row.id === checklist.individualId,
      );
      if (!person) return null;
      accessibleIndividual(this.store, session, person.id);
      const site = this.store.db.sites.find((row) => row.id === person.siteId);
      // Collect actual initials per line from the sign-off records.
      const lineInitials: Record<string, string> = {};
      const signoffs = this.p2Collections().trainingLegacyLineSignoffs;
      for (const line of checklist.items) {
        const signoff = signoffs[`${checklist.id}:${line.id}`];
        if (signoff?.initials?.trim()) {
          lineInitials[line.id] = signoff.initials.trim();
        }
      }
      const { buildTrainingChecklistPdf, trainingFileName } = await import("../pdf/trainingChecklistPdf");
    const pdf = buildTrainingChecklistPdf({
        agencyName: session.agencyName,
        individualName: person.fullName,
        siteName: site?.name ?? "",
        checklist,
        logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
        lineInitials,
      });
      return {
        blob: pdf.output("blob"),
        name: trainingFileName(checklist.staffName, person.fullName),
      };
    }
    if (input.type === "version") {
      const version = this.store.db.versions.find((row) => row.id === input.id);
      if (!version) return null;
      const document = this.store.db.documents.find((row) => row.id === version.documentId);
      assertCan(session, "documents.view");
      if (!document) return null;
      accessibleIndividual(this.store, session, document.individualId);
      const stored = version.storagePath ? await readFile(version.storagePath) : null;
      if (stored) {
        return {
          blob: stored,
          name: `${document?.title ?? "care-plan"}-${version.versionLabel}.pdf`,
        };
      }
      const person = document
        ? this.store.db.individuals.find((row) => row.id === document.individualId)
        : null;
      const { buildCarePlanPdf } = await import("../pdf/carePlanPdf");
    const pdf = buildCarePlanPdf({
        agencyName: session.agencyName,
        individualName: person?.fullName ?? "Individual",
        title: document?.title ?? "Care plan",
        versionLabel: version.versionLabel,
        effectiveOn: version.effectiveOn,
        logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
      });
      return {
        blob: pdf.output("blob"),
        name: `complyrer-care-plan-${(person?.fullName ?? "individual")
          .toLowerCase()
          .replaceAll(" ", "-")}.pdf`,
      };
    }
    const file = this.store.db.chartFiles.find((row) => row.id === input.id);
    if (!file) return null;
    accessibleIndividual(this.store, session, file.individualId);
    if (!canSeeRenewals(session.roleKey)) throw new Error("You cannot open clinical evidence.");
    const blob = await readFile(file.storagePath);
    if (!blob) return null;
    return { blob, name: file.name };
  }

  async recordMedDelivery(input: {
    medicationId: string;
    remainingPills: number;
    pillsPerDay: number;
    countedOn?: string;
  }) {
    const session = assertSession(this.store);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or DPM records a medication delivery.");
    }
    const med = this.store.db.medications.find((row) => row.id === input.medicationId);
    if (!med) throw new Error("Medication not found.");
    accessibleIndividual(this.store, session, med.individualId);
    if (!Number.isFinite(input.remainingPills) || input.remainingPills < 0) {
      throw new Error("Enter a finite, nonnegative remaining pill count.");
    }
    if (med.kind === "scheduled" && (!Number.isFinite(input.pillsPerDay) || input.pillsPerDay <= 0)) {
      throw new Error("Set pills per day for a scheduled medication.");
    }
    const countedOn = input.countedOn ?? todayIso();
    assertCalendarDate(countedOn, "Use a valid count date.");
    med.remainingPills = input.remainingPills;
    med.pillsPerDay = med.kind === "prn" ? 0 : input.pillsPerDay;
    med.lastDeliveryOn = countedOn;
    med.lastCountdownOn = countedOn;
    this.store.db.medicationDeliveries.push({
      id: crypto.randomUUID(),
      medicationId: med.id,
      countedOn,
      remainingPills: med.remainingPills,
      pillsPerDay: med.pillsPerDay,
      recordedBy: session.userId,
    });
    log(
      this.store,
      session,
      "medication.delivery",
      `${session.fullName} counted ${med.name} at ${med.remainingPills} pills`,
      "medication",
      med.id,
    );
    await persistMeta(this.store);
  }

  async logPrnDose(medicationId: string, pills = 1) {
    const session = assertSession(this.store);
    if (!canLogPrnDose(session.roleKey)) {
      throw new Error("You cannot log a PRN dose.");
    }
    const med = this.store.db.medications.find((row) => row.id === medicationId);
    if (!med || med.kind !== "prn") {
      throw new Error("PRN medication not found.");
    }
    accessibleIndividual(this.store, session, med.individualId);
    if (!Number.isFinite(pills) || pills <= 0) throw new Error("Enter how many pills were given.");
    if (pills > med.remainingPills) throw new Error("The dose exceeds the recorded stock. Reconcile the count first.");
    med.remainingPills = Math.max(0, med.remainingPills - pills);
    log(
      this.store,
      session,
      "medication.prn",
      `${session.fullName} gave ${pills} ${med.name}`,
      "medication",
      med.id,
    );
    await persistMeta(this.store);
  }

  async signTrainingChecklist(
    checklistId: string,
    role: "staff" | "hm",
    signatureName: string,
    // LIFEPATH-P2: optional signature mark (SignaturePad pattern); omitted = legacy behavior.
    opts?: { signatureMark?: string },
  ) {
    const session = assertSession(this.store);
    const row = this.store.db.trainingChecklists.find((item) => item.id === checklistId);
    if (!row) throw new Error("Training checklist not found.");
    if (!signatureName.trim()) throw new Error("Type your name to sign.");
    const now = new Date().toISOString();
    if (role === "staff") {
      if (row.staffUserId !== session.userId) {
        throw new Error("Staff must sign their own training sheet.");
      }
      if (row.staffSignedAt) throw new Error("This sheet is already signed by staff.");
      if (!allLinesInitialed(row)) {
        throw new Error("Check off every training item before you sign.");
      }
      row.staffSignedAt = now;
      row.staffSignatureName = signatureName.trim();
      // LIFEPATH-P2: keep the signature mark alongside the legacy checklist.
      if (opts?.signatureMark) {
        this.p2Collections().trainingLegacyChecklistMarks[checklistId] = {
          ...this.p2Collections().trainingLegacyChecklistMarks[checklistId],
          staffMark: opts.signatureMark,
        };
      }
    } else {
      if (!canSignTrainingAsHm(session.roleKey)) {
        throw new Error("Only a house manager can counter-sign training.");
      }
      if (!row.staffSignedAt) {
        throw new Error("Staff must sign this sheet before the house manager.");
      }
      if (row.hmSignedAt) throw new Error("House manager already signed.");
      row.hmSignedAt = now;
      row.hmSignatureName = signatureName.trim();
      // LIFEPATH-P2: keep the signature mark alongside the legacy checklist.
      if (opts?.signatureMark) {
        this.p2Collections().trainingLegacyChecklistMarks[checklistId] = {
          ...this.p2Collections().trainingLegacyChecklistMarks[checklistId],
          hmMark: opts.signatureMark,
        };
      }
    }
    log(
      this.store,
      session,
      "training.signed",
      `${session.fullName} signed training for ${row.staffName}`,
      "training_checklist",
      row.id,
    );
    await persistMeta(this.store);
  }

  async initialTrainingLine(
    checklistId: string,
    lineId: string,
    // LIFEPATH-P2: optional full sign-off detail; omitted = legacy title+date behavior.
    signoff?: LegacyLineSignoffInput,
  ) {
    const session = assertSession(this.store);
    const row = this.store.db.trainingChecklists.find((item) => item.id === checklistId);
    if (!row) throw new Error("Training checklist not found.");
    if (row.staffUserId !== session.userId) {
      throw new Error("Staff must check off their own training items.");
    }
    if (row.staffSignedAt) {
      throw new Error("This sheet is already signed.");
    }
    const line = row.items.find((item) => item.id === lineId);
    if (!line) throw new Error("Training item not found.");
    if (line.initialedAt) return;
    await this.assertDocumentUnlocked(
      "training_checklist",
      legacyTrainingDocId(checklistId),
    );
    line.initialedAt = new Date().toISOString();
    // LIFEPATH-P2: store the extended sign-off detail alongside the legacy line.
    if (signoff && (signoff.initials || signoff.trainerName)) {
      this.p2Collections().trainingLegacyLineSignoffs[`${checklistId}:${lineId}`] = {
        ...signoff,
        initialedAt: line.initialedAt,
      };
    }
    await persistMeta(this.store);
  }

  async submitPlanPacket(individualId: string) {
    const session = assertSession(this.store);
    const stack = mapPlanStack(
      this.store,
      session,
      this.store.db.individuals.find((p) => p.id === individualId)!,
    );
    if (!stack.canSubmit) {
      throw new Error("Sign every required document before submitting.");
    }
    this.store.db.packetSubmissions.push({
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId,
      userId: session.userId,
      submittedAt: new Date().toISOString(),
    });
    log(
      this.store,
      session,
      "plan_packet.submitted",
      `${session.fullName} submitted the required-document packet`,
      "individual",
      individualId,
    );
    await persistMeta(this.store);
  }

  async updateMonthlyDueSettings(input: {
    equipmentDay: number;
    drillDay: number;
    safetyDay: number;
  }) {
    const session = assertSession(this.store);
    if (!canConfigureMonthlyDue(session.roleKey)) {
      throw new Error("Only a DPM or administrator can set monthly due dates.");
    }
    const agency = this.store.db.agencies.find((row) => row.id === session.agencyId);
    if (!agency) throw new Error("Agency not found.");
    agency.monthlyDue = normalizeMonthlyDue(input);
    log(
      this.store,
      session,
      "monthly_due.updated",
      `Monthly checks due by day ${agency.monthlyDue.equipmentDay}/${agency.monthlyDue.drillDay}/${agency.monthlyDue.safetyDay}`,
      "agency",
      agency.id,
    );
    await persistMeta(this.store);
  }

  async addAdaptiveEquipment(individualId: string, name: string) {
    const session = assertSession(this.store);
    if (!canManageEquipment(session.roleKey)) {
      throw new Error("Only a DPM or house manager can add adaptive equipment.");
    }
    const person = this.store.db.individuals.find((row) => row.id === individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found.");
    }
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name the adaptive equipment.");
    if (
      this.store.db.adaptiveEquipment.some(
        (row) =>
          row.individualId === individualId &&
          row.active &&
          row.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      throw new Error("That equipment is already on this chart.");
    }
    const item: AdaptiveEquipment = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId,
      name: trimmed,
      source: "manual",
      active: true,
    };
    this.store.db.adaptiveEquipment.push(item);
    ensureMonthlyCycles(this.store.db, todayIso());
    log(
      this.store,
      session,
      "equipment.added",
      `${trimmed} added for ${person.fullName}`,
      "adaptive_equipment",
      item.id,
    );
    await persistMeta(this.store);
  }

  async removeAdaptiveEquipment(equipmentId: string) {
    const session = assertSession(this.store);
    if (!canManageEquipment(session.roleKey)) {
      throw new Error("Only a DPM or house manager can remove adaptive equipment.");
    }
    const item = this.store.db.adaptiveEquipment.find((row) => row.id === equipmentId);
    if (!item || item.agencyId !== session.agencyId) {
      throw new Error("Equipment not found.");
    }
    item.active = false;
    log(
      this.store,
      session,
      "equipment.removed",
      `${item.name} removed from monthly checks`,
      "adaptive_equipment",
      item.id,
    );
    await persistMeta(this.store);
  }

  async checkEquipmentLog(input: {
    equipmentId: string;
    monthKey: string;
    checkedOn: string;
    initials: string;
    comments?: string;
  }) {
    const session = assertSession(this.store);
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("You cannot complete monthly equipment checks.");
    }
    const item = this.store.db.adaptiveEquipment.find((row) => row.id === input.equipmentId);
    if (!item || !item.active || item.agencyId !== session.agencyId) {
      throw new Error("Equipment not found.");
    }
    let entry = this.store.db.equipmentMonthLogs.find(
      (row) => row.equipmentId === item.id && row.monthKey === input.monthKey,
    );
    if (!entry) {
      entry = {
        id: crypto.randomUUID(),
        equipmentId: item.id,
        monthKey: input.monthKey,
        checkedOn: null,
        initials: null,
        checkedByUserId: null,
        comments: "",
      };
      this.store.db.equipmentMonthLogs.push(entry);
    }
    const initials = input.initials.trim();
    if (!input.checkedOn || !initials) {
      throw new Error("Enter the date checked and your initials.");
    }
    entry.checkedOn = input.checkedOn;
    entry.initials = initials;
    entry.checkedByUserId = session.userId;
    entry.comments = input.comments?.trim() ?? "";
    const person = this.store.db.individuals.find((row) => row.id === item.individualId);
    log(
      this.store,
      session,
      "equipment.checked",
      `${item.name} checked for ${person?.fullName ?? "individual"} · ${input.monthKey}`,
      "equipment_log",
      entry.id,
    );
    await persistMeta(this.store);
  }

  async recordEmergencyDrill(input: {
    id: string;
    date: string;
    time: string;
    evacTime?: string;
    leaderName: string;
    participants: string;
    awakeOrSleep?: "awake" | "sleep" | "";
  }) {
    const session = assertSession(this.store);
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("You cannot record emergency drills.");
    }
    const drill = this.store.db.emergencyDrills.find((row) => row.id === input.id);
    if (!drill || drill.agencyId !== session.agencyId) {
      throw new Error("Drill not found.");
    }
    if (!input.date || !input.time || !input.leaderName.trim() || !input.participants.trim()) {
      throw new Error("Enter the date, time, drill leader, and participants.");
    }
    const conflict = drillDateConflict(
      this.store.db.emergencyDrills,
      drill.siteId,
      drill.id,
      input.date,
    );
    if (conflict) throw new Error(drillDateConflictMessage(conflict));
    drill.date = input.date;
    drill.time = input.time;
    drill.evacTime = input.evacTime?.trim() || null;
    drill.leaderName = input.leaderName.trim();
    drill.participants = input.participants.trim();
    drill.awakeOrSleep = input.awakeOrSleep ?? "";
    const site = this.store.db.sites.find((row) => row.id === drill.siteId);
    log(
      this.store,
      session,
      "drill.recorded",
      `${drill.drillType} drill recorded at ${site?.name ?? "site"} · ${drill.monthKey}`,
      "emergency_drill",
      drill.id,
    );
    await persistMeta(this.store);
  }

  async recordHomeSafety(input: { id: string; lines: SafetyLine[] }) {
    const session = assertSession(this.store);
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("You cannot complete the home safety report.");
    }
    const report = this.store.db.homeSafetyReports.find((row) => row.id === input.id);
    if (!report || report.agencyId !== session.agencyId) {
      throw new Error("Safety report not found.");
    }
    report.lines = input.lines;
    const site = this.store.db.sites.find((row) => row.id === report.siteId);
    log(
      this.store,
      session,
      "safety.recorded",
      `Home safety report updated for ${site?.name ?? "site"} · ${report.monthKey}`,
      "home_safety",
      report.id,
    );
    await persistMeta(this.store);
  }

  async downloadMonthlyCheck(input: {
    kind: "equipment" | "drills" | "safety";
    id: string;
    monthKey: string;
  }) {
    const session = assertSession(this.store);
    if (input.kind === "equipment") {
      const person = this.store.db.individuals.find((row) => row.id === input.id);
      if (!person || person.agencyId !== session.agencyId) {
        throw new Error("Individual not found.");
      }
      const view = equipmentViewForPerson(this.store.db, person.id, input.monthKey, todayIso());
      if (!view.items.length) {
        throw new Error("This person has no adaptive equipment on file.");
      }
      if (!view.complete) {
        throw new Error("Check every piece of equipment before downloading this month.");
      }
      const doc = buildEquipmentMonthPdf({
        agencyName: session.agencyName,
        individualName: person.fullName,
        dmhId: person.profile?.dmhId ?? "",
        monthKey: input.monthKey,
        items: view.items,
        logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
      });
      return {
        blob: doc.output("blob"),
        name: equipmentFileName(person.fullName, input.monthKey),
      };
    }
    const site = this.store.db.sites.find((row) => row.id === input.id);
    if (!site || site.agencyId !== session.agencyId) {
      throw new Error("Site not found.");
    }
    if (input.kind === "drills") {
      const drills = this.store.db.emergencyDrills.filter(
        (row) => row.siteId === site.id && row.monthKey === input.monthKey,
      );
      if (!drills.length || !drills.every(drillComplete)) {
        throw new Error("Finish every required drill before downloading this month.");
      }
      const doc = buildDrillsMonthPdf({
        agencyName: session.agencyName,
        siteName: site.name,
        monthKey: input.monthKey,
        drills,
        logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
      });
      return { blob: doc.output("blob"), name: drillsFileName(site.name, input.monthKey) };
    }
    const report = this.store.db.homeSafetyReports.find(
      (row) => row.siteId === site.id && row.monthKey === input.monthKey,
    );
    if (!report || !safetyComplete(report)) {
      throw new Error("Finish every safety line before downloading this month.");
    }
    const doc = buildSafetyMonthPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      monthKey: input.monthKey,
      report,
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return { blob: doc.output("blob"), name: safetyFileName(site.name, input.monthKey) };
  }

  async saveSiteFacts(siteId: string, facts: Partial<SiteFacts>) {
    const session = assertSession(this.store);
    if (!canEditSiteReview(session.roleKey)) {
      throw new Error("Only a DPM, house manager, or administrator can update site-review facts.");
    }
    const site = this.store.db.sites.find(
      (row) => row.id === siteId && row.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Site not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can update their own site.");
    }
    Object.assign(site, normalizeSiteFacts({ ...siteFactsFrom(site), ...facts }));
    log(
      this.store,
      session,
      "site.facts_updated",
      `Site facts updated for ${site.name}`,
      "site",
      site.id,
    );
    await persistMeta(this.store);
  }

  async saveSiteReview(input: {
    id: string;
    reviewerName: string;
    supportCoordinator: string;
    reviewedOn: string;
    providerOwnedControlled: boolean | null;
    heightenedScrutiny: boolean | null;
    meetsIndividualNeeds: boolean | null;
    part2Verified: boolean;
    lines: Array<{ id: string; status: SiteReviewLineStatus; comment: string }>;
  }) {
    const session = assertSession(this.store);
    if (!canEditSiteReview(session.roleKey)) {
      throw new Error("Only a DPM, house manager, or administrator can mark site-review checks.");
    }
    ensureSiteReviews(this.store.db);
    const review = this.store.db.siteReviews.find((row) => row.id === input.id);
    if (!review || review.agencyId !== session.agencyId) {
      throw new Error("Site review not found.");
    }
    const site = this.store.db.sites.find((row) => row.id === review.siteId);
    if (!site) throw new Error("Site not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can update their own site.");
    }
    review.reviewerName = input.reviewerName.trim();
    review.supportCoordinator = input.supportCoordinator.trim();
    review.reviewedOn = input.reviewedOn;
    review.providerOwnedControlled = input.providerOwnedControlled;
    review.heightenedScrutiny = input.heightenedScrutiny;
    review.meetsIndividualNeeds = input.meetsIndividualNeeds;
    review.part2Verified = input.part2Verified;
    review.lines = normalizeSiteReview({
      ...review,
      lines: input.lines.map((line) => ({
        id: line.id,
        status: line.status,
        comment: line.comment,
      })),
    }).lines;
    review.updatedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "site_review.saved",
      `Site review saved for ${site.name}`,
      "site_review",
      review.id,
    );
    await persistMeta(this.store);
  }

  async downloadSiteReviewPdf(siteId: string) {
    const session = assertSession(this.store);
    const site = this.store.db.sites.find(
      (row) => row.id === siteId && row.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Site not found.");
    ensureSiteReviews(this.store.db);
    const review = this.store.db.siteReviews.find((row) => row.siteId === site.id);
    if (!review) throw new Error("Site review not found.");
    const facts = siteFactsFrom(site);
    const people = this.store.db.individuals.filter((row) => row.siteId === site.id);
    const safety = siteSafetyView(
      {
        adaptiveEquipment: this.store.db.adaptiveEquipment,
        equipmentMonthLogs: this.store.db.equipmentMonthLogs,
        emergencyDrills: this.store.db.emergencyDrills,
        homeSafetyReports: this.store.db.homeSafetyReports,
      },
      site.id,
      monthKeyFrom(todayIso()),
    );
    const doc = buildSiteReviewPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      address: site.address,
      facts,
      residents: people.map((row) => row.fullName),
      review: normalizeSiteReview(applyWellWaterDefault(review, facts)),
      monthlySafetyOnFile: monthlySafetyOnFile(safety),
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return { blob: doc.output("blob"), name: siteReviewFileName(site.name) };
  }

  async downloadPreSurveyPdf(siteId: string) {
    const session = assertSession(this.store);
    const site = this.store.db.sites.find(
      (row) => row.id === siteId && row.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Site not found.");
    const facts = siteFactsFrom(site);
    const today = todayIso();
    const rows = this.store.db.individuals
      .filter((row) => row.siteId === site.id)
      .map((person) =>
        buildPreSurveyRow({
          person,
          profile: normalizeProfile(person, person.profile),
          today,
          equipment: this.store.db.adaptiveEquipment.filter(
            (row) => row.individualId === person.id && row.active,
          ),
          obligations: this.store.db.obligations.filter(
            (row) => row.individualId === person.id,
          ),
        }),
      );
    const doc = buildPreSurveyPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      address: site.address,
      facts,
      rows,
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return { blob: doc.output("blob"), name: preSurveyFileName(site.name) };
  }

  async uploadAgencyLogo(file: File) {
    const session = assertSession(this.store);
    if (!canManageAgencyLogo(session.roleKey)) {
      throw new Error("Only a DPM or administrator can change the agency logo.");
    }
    validateLogoFile(file);
    const agency = this.store.db.agencies.find((row) => row.id === session.agencyId);
    if (!agency) throw new Error("Agency not found.");
    const path = agencyLogoPath(agency.id);
    const bytes = await file.arrayBuffer();
    this.store.files.set(path, { mime: file.type || "image/png", bytes });
    await persistFile(path, file);
    agency.logoPath = path;
    log(this.store, session, "agency.logo_updated", `Logo uploaded for ${agency.name}`, "agency", agency.id);
    await persistMeta(this.store);
  }

  async removeAgencyLogo() {
    const session = assertSession(this.store);
    if (!canManageAgencyLogo(session.roleKey)) {
      throw new Error("Only a DPM or administrator can change the agency logo.");
    }
    const agency = this.store.db.agencies.find((row) => row.id === session.agencyId);
    if (!agency) throw new Error("Agency not found.");
    if (agency.logoPath) this.store.files.delete(agency.logoPath);
    agency.logoPath = null;
    log(this.store, session, "agency.logo_removed", `Logo removed for ${agency.name}`, "agency", agency.id);
    await persistMeta(this.store);
  }

  async createSite(input: {
    name: string;
    address: string;
    programName: string;
    managerUserId?: string | null;
  }) {
    const session = assertSession(this.store);
    if (!hasPermission(session, "sites.create")) {
      throw new Error("Only a DPM or administrator can add a program site.");
    }
    const name = input.name.trim();
    const address = input.address.trim();
    const programName = input.programName.trim();
    if (!name || !address || !programName) {
      throw new Error("Name the site, its address, and the program.");
    }
    if (
      this.store.db.sites.some(
        (row) =>
          row.agencyId === session.agencyId &&
          row.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw new Error("A site with that name already exists.");
    }
    let program = this.store.db.programs.find(
      (row) =>
        row.agencyId === session.agencyId &&
        row.name.toLowerCase() === programName.toLowerCase(),
    );
    if (!program) {
      program = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        name: programName,
      };
      this.store.db.programs.push(program);
    }
    const site = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      programId: program.id,
      name,
      address,
      ...normalizeSiteFacts({
        contactName: session.fullName,
      }),
    };
    this.store.db.sites.push(site);
    this.store.db.siteReviews.push(
      blankSiteReview({ agencyId: session.agencyId, siteId: site.id }),
    );
    if (input.managerUserId) {
      const membership = this.store.db.memberships.find(
        (row) =>
          row.agencyId === session.agencyId &&
          row.userId === input.managerUserId,
      );
      if (membership) membership.siteId = site.id;
    }
    log(
      this.store,
      session,
      "site.created",
      `${name} added to ${programName}`,
      "site",
      site.id,
    );
    await persistMeta(this.store);
    return { id: site.id };
  }

  async createIndividual(input: {
    fullName: string;
    dateOfBirth: string;
    siteId: string;
    goesBy?: string;
    dmhId?: string;
    file?: File;
    pageCount?: number;
    effectiveOn?: string;
  }) {
    const session = assertSession(this.store);
    if (!canCreateIndividual(session.roleKey)) {
      throw new Error("Only a DPM, nurse, or house manager can add an individual.");
    }
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("Enter the individual’s legal name.");
    assertCalendarDate(input.dateOfBirth, "Enter a valid date of birth.");
    if (input.dateOfBirth > todayIso()) throw new Error("Date of birth cannot be in the future.");
    const site = this.store.db.sites.find(
      (row) => row.id === input.siteId && row.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Choose a program site.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can add people to their own site.");
    }
    if (
      this.store.db.individuals.some(
        (row) =>
          row.agencyId === session.agencyId &&
          row.fullName.toLowerCase() === fullName.toLowerCase(),
      )
    ) {
      throw new Error("Someone with that name is already on the roster.");
    }
    const person = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId: site.id,
      fullName,
      dateOfBirth: input.dateOfBirth,
      profile: {
        ...emptyProfile({
          id: "new",
          agencyId: session.agencyId,
          siteId: site.id,
          fullName,
          dateOfBirth: input.dateOfBirth,
        }),
        goesBy: input.goesBy?.trim() || fullName.split(" ")[0] || fullName,
        dmhId: input.dmhId?.trim() || "",
      },
    };
    this.store.db.individuals.push(person);
    this.store.db.clinicalRenewals.push(
      ...defaultRenewals(session.agencyId, person.id),
    );
    log(
      this.store,
      session,
      "individual.created",
      `${fullName} added at ${site.name}`,
      "individual",
      person.id,
    );
    ensureTrainingChecklists(this.store);
    await persistMeta(this.store);
    if (input.file) {
      await this.uploadDocument({
        individualId: person.id,
        file: input.file,
        title: `${fullName} · PCSP`,
        kind: "pcsp",
        pageCount: input.pageCount || 1,
        effectiveOn: input.effectiveOn || new Date().toISOString().slice(0, 10),
        requirementTitle: `Acknowledge PCSP for ${fullName}`,
        category: "PCSP acknowledgments",
        ownerUserId: session.userId,
        dueOn: input.effectiveOn || new Date().toISOString().slice(0, 10),
        frequency: "On plan update",
        sourcePage: 1,
      });
    }
    return { id: person.id, name: fullName };
  }

  async resetWorkspace() {
    this.store.db = cloneSeed();
    this.store.files.clear();
    this.store.sessionUserId = null;
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(META_KEY);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(FILE_PREFIX)) localStorage.removeItem(key);
      }
    }
    hydrated = true;
  }
  // ===== LIFEPATH-P2 IMPL (training engine) =====
  /**
   * In-memory collections for the training engine. Stored as plain properties
   * on store.db (outside the shared LocalDatabase shape so seed.ts is untouched);
   * lazily initialized and serialized by persistMeta like everything else.
   */
  private p2Collections(): {
    trainingRequirements: TrainingRequirement[];
    trainingSignoffs: TrainingSignoff[];
    trainingCountersignatures: TrainingCountersignature[];
    trainingLegacyLineSignoffs: Record<string, LegacyLineSignoffInput & { initialedAt: string }>;
    trainingLegacyChecklistMarks: Record<string, { staffMark?: string; hmMark?: string }>;
  } {
    const db = this.store.db as unknown as {
      trainingRequirements?: TrainingRequirement[];
      trainingSignoffs?: TrainingSignoff[];
      trainingCountersignatures?: TrainingCountersignature[];
      trainingLegacyLineSignoffs?: Record<string, LegacyLineSignoffInput & { initialedAt: string }>;
      trainingLegacyChecklistMarks?: Record<string, { staffMark?: string; hmMark?: string }>;
    };
    db.trainingRequirements ??= [];
    db.trainingSignoffs ??= [];
    db.trainingCountersignatures ??= [];
    db.trainingLegacyLineSignoffs ??= {};
    db.trainingLegacyChecklistMarks ??= {};
    return db as {
      trainingRequirements: TrainingRequirement[];
      trainingSignoffs: TrainingSignoff[];
      trainingCountersignatures: TrainingCountersignature[];
      trainingLegacyLineSignoffs: Record<string, LegacyLineSignoffInput & { initialedAt: string }>;
      trainingLegacyChecklistMarks: Record<string, { staffMark?: string; hmMark?: string }>;
    };
  }

  /** Internal generator — no permission check; callers gate access. */
  private p2GenerateTraining(input: {
    agencyId: string;
    userId: string;
    siteId: string | null;
    individualId: string | null;
    source: TrainingRequirement["source"];
    planVersionId?: string | null;
    delegationId?: string | null;
    topicIds: string[];
    dueOn?: string | null;
  }): TrainingRequirement[] {
    const coll = this.p2Collections();
    const now = new Date().toISOString();
    const created: TrainingRequirement[] = [];
    for (const topicId of input.topicIds) {
      if (!TRAINING_TOPIC_BY_ID[topicId]) continue;
      const duplicate = coll.trainingRequirements.some(
        (row) =>
          row.agencyId === input.agencyId &&
          row.userId === input.userId &&
          row.topicId === topicId &&
          (row.siteId ?? null) === (input.siteId ?? null) &&
          (row.individualId ?? null) === (input.individualId ?? null),
      );
      if (duplicate) continue;
      const row: TrainingRequirement = {
        id: crypto.randomUUID(),
        agencyId: input.agencyId,
        userId: input.userId,
        topicId,
        individualId: input.individualId ?? null,
        siteId: input.siteId ?? null,
        source: input.source,
        planVersionId: input.planVersionId ?? null,
        delegationId: input.delegationId ?? null,
        status: "pending",
        dueOn: input.dueOn ?? null,
        createdAt: now,
      };
      coll.trainingRequirements.push(row);
      created.push(row);
    }
    return created;
  }

  /** LIFEPATH-P2 hook target: full checklist when a staff member is assigned. */
  private async p2GenerateForNewAssignment(
    session: SessionUser,
    userId: string,
    individual: IndividualRecord,
  ) {
    const siteTopics = siteChecklistTopics();
    const individualTopics = individualChecklistTopics();
    const siteCreated = this.p2GenerateTraining({
      agencyId: session.agencyId,
      userId,
      siteId: individual.siteId,
      individualId: null,
      source: "checklist",
      topicIds: siteTopics.map((topic) => topic.id),
    });
    const individualCreated = this.p2GenerateTraining({
      agencyId: session.agencyId,
      userId,
      siteId: individual.siteId,
      individualId: individual.id,
      source: "checklist",
      topicIds: individualTopics.map((topic) => topic.id),
    });
    const total = siteCreated.length + individualCreated.length;
    if (total > 0) {
      log(
        this.store,
        session,
        "training.assigned",
        `${total} training lines generated for ${ownerName(this.store, userId)} at ${individual.fullName}`,
        "training_requirement",
      );
    }
  }

  /** LIFEPATH-P2 hook target: targeted retraining when a plan version goes active. */
  private async p2GeneratePlanRetraining(
    session: SessionUser,
    individual: IndividualRecord,
    version: DocumentVersion,
  ) {
    const userIds = assignedUserIds(this.store, individual);
    if (userIds.length === 0) return;
    let total = 0;
    for (const userId of userIds) {
      total += this.p2GenerateTraining({
        agencyId: session.agencyId,
        userId,
        siteId: individual.siteId,
        individualId: individual.id,
        source: "plan_version",
        planVersionId: version.id,
        topicIds: planUpdateRetrainingTopicIds(),
      }).length;
    }
    if (total > 0) {
      log(
        this.store,
        session,
        "training.retraining_assigned",
        `${total} retraining lines generated for a new active plan version (${individual.fullName})`,
        "document_version",
        version.id,
      );
    }
  }

  async listTrainingTopics(scope?: "agency" | "site"): Promise<TrainingTopic[]> {
    assertSession(this.store);
    return scope ? TRAINING_TOPICS.filter((topic) => topic.scope === scope) : [...TRAINING_TOPICS];
  }

  async assignTraining(input: AssignTrainingInput): Promise<TrainingRequirement[]> {
    const session = assertSession(this.store);
    assertCan(session, "hr.view_staff");
    const profile = this.store.db.profiles.find((row) => row.id === input.userId);
    if (!profile) throw new Error("Staff member not found.");
    const membership = this.store.db.memberships.find(
      (row) => row.userId === input.userId && row.agencyId === session.agencyId,
    );
    if (!membership) throw new Error("That staff member is not in this agency.");
    const siteId = input.siteId ?? null;
    const individualId = input.individualId ?? null;
    let created: TrainingRequirement[];
    if (input.source === "checklist" && !input.topicIds) {
      // Sections 1–5 once per staff per site; section 6 once per staff per individual.
      created = this.p2GenerateTraining({
        agencyId: session.agencyId,
        userId: input.userId,
        siteId,
        individualId: null,
        source: "checklist",
        topicIds: siteChecklistTopics().map((topic) => topic.id),
        dueOn: input.dueOn ?? null,
      });
      if (individualId) {
        created = created.concat(
          this.p2GenerateTraining({
            agencyId: session.agencyId,
            userId: input.userId,
            siteId,
            individualId,
            source: "checklist",
            topicIds: individualChecklistTopics().map((topic) => topic.id),
            dueOn: input.dueOn ?? null,
          }),
        );
      }
    } else {
      const topicIds = input.topicIds ?? [];
      if (topicIds.length === 0) throw new Error("Choose at least one training topic.");
      created = this.p2GenerateTraining({
        agencyId: session.agencyId,
        userId: input.userId,
        siteId,
        individualId,
        source: input.source,
        planVersionId: input.planVersionId ?? null,
        delegationId: input.delegationId ?? null,
        topicIds,
        dueOn: input.dueOn ?? null,
      });
    }
    log(
      this.store,
      session,
      "training.assigned",
      `${created.length} training lines assigned to ${profile.fullName} (${input.source})`,
      "training_requirement",
    );
    await persistMeta(this.store);
    return created;
  }

  private p2SignoffFor(requirementId: string): TrainingSignoff | null {
    return (
      this.p2Collections().trainingSignoffs.find((row) => row.requirementId === requirementId) ??
      null
    );
  }

  /**
   * True when a house-manager countersignature locks the staffer's sheet.
   * Mirrors the training_signoffs RLS freeze: the join is on
   * (agency_id, user_id, site_id), and NULL site_id never matches in SQL.
   */
  private p2SheetLocked(requirement: TrainingRequirement): boolean {
    if (requirement.siteId == null) return false;
    return this.p2Collections().trainingCountersignatures.some(
      (row) =>
        row.agencyId === requirement.agencyId &&
        row.userId === requirement.userId &&
        row.siteId === requirement.siteId &&
        row.hmSignedAt != null,
    );
  }

  private assertTrainingUnlocked(requirement: TrainingRequirement) {
    if (this.p2SheetLocked(requirement)) {
      throw new Error(LOCKED_TRAINING_SHEET_MESSAGE);
    }
  }

  /** Resolve a trainer id against the agency staff roster (no free text). */
  private p2TrainerName(session: SessionUser, trainerUserId: string): string {
    const trainer = this.store.db.profiles.find(
      (row) => row.id === trainerUserId && row.homeAgencyId === session.agencyId,
    );
    if (!trainer) throw new Error("Choose the trainer from the staff roster.");
    return trainer.fullName;
  }

  private p2RequirementView(
    requirement: TrainingRequirement,
    today: string,
  ): TrainingRequirementView {
    const topic = TRAINING_TOPIC_BY_ID[requirement.topicId];
    const individual = requirement.individualId
      ? (this.store.db.individuals.find((row) => row.id === requirement.individualId) ?? null)
      : null;
    const signoff = this.p2SignoffFor(requirement.id);
    return {
      ...requirement,
      topicTitle: renderTopicTitle(topic, individual?.fullName),
      section: topic?.section ?? 5,
      perIndividual: topic?.perIndividual ?? false,
      individualName: individual?.fullName ?? null,
      // Sign-offs persisted before per-line e-initials carry no version.
      signoff: signoff
        ? { ...signoff, signoffVersion: signoff.signoffVersion ?? 1 }
        : null,
      resolvedStatus: resolveRequirementStatus(requirement.status, requirement.dueOn, today),
    };
  }

  async getStaffTrainingProfile(userId: string): Promise<StaffTrainingProfile> {
    const session = assertSession(this.store);
    if (session.userId !== userId) assertCan(session, "hr.view_staff");
    const profile = this.store.db.profiles.find((row) => row.id === userId);
    if (!profile) throw new Error("Staff member not found.");
    const today = new Date().toISOString().slice(0, 10);
    const coll = this.p2Collections();
    const requirements = coll.trainingRequirements
      .filter((row) => row.agencyId === session.agencyId && row.userId === userId)
      .map((row) => this.p2RequirementView(row, today));
    const countersignatures = coll.trainingCountersignatures.filter(
      (row) => row.agencyId === session.agencyId && row.userId === userId,
    );
    const siteIds = [...new Set(requirements.map((row) => row.siteId).filter(Boolean))] as string[];
    const siteNames = siteIds.map(
      (siteId) => this.store.db.sites.find((row) => row.id === siteId)?.name ?? "Unknown site",
    );
    const individualIds = [
      ...new Set(requirements.map((row) => row.individualId).filter(Boolean)),
    ] as string[];
    const individualNames = individualIds
      .map((id) => this.store.db.individuals.find((row) => row.id === id))
      .filter((row): row is IndividualRecord => Boolean(row))
      .map((row) => ({ id: row.id, fullName: row.fullName }));
    const signoffs = requirements
      .map((row) => row.signoff)
      .filter((row): row is TrainingSignoff => Boolean(row));
    const { hoursTotal, hoursWithHm } = sumHours(
      signoffs.map((row) => ({
        hoursTotal: row.hoursTotal,
        hoursWithHm: row.hoursWithHm,
        na: row.na,
      })),
    );
    let complete = 0;
    let pending = 0;
    let overdue = 0;
    let waived = 0;
    for (const row of requirements) {
      if (row.resolvedStatus === "complete") complete += 1;
      else if (row.resolvedStatus === "waived_na") waived += 1;
      else if (row.resolvedStatus === "overdue") overdue += 1;
      else pending += 1;
    }
    const required = complete + pending + overdue;
    // Countersignature is per site: the gate needs every assigned site countersigned.
    let staffCountersigned = siteIds.length > 0;
    let hmCountersigned = siteIds.length > 0;
    for (const siteId of siteIds) {
      const counter = countersignatures.find((row) => row.siteId === siteId);
      if (!counter?.staffSignedAt) staffCountersigned = false;
      if (!counter?.hmSignedAt) hmCountersigned = false;
    }
    const gate = evaluateInRatioGate({
      signoffs: signoffs.map((row) => ({
        hoursTotal: row.hoursTotal,
        hoursWithHm: row.hoursWithHm,
        na: row.na,
      })),
      requiredTotal: required,
      completeCount: complete,
      pendingCount: pending,
      overdueCount: overdue,
      staffCountersigned,
      hmCountersigned,
    });
    const reasons = [...gate.reasons];
    if (requirements.length === 0) reasons.unshift("No training assigned yet");
    return {
      userId,
      fullName: profile.fullName,
      siteNames,
      individualNames,
      requirements,
      countersignatures,
      hoursTotal: gate.hoursTotal,
      hoursWithHm: gate.hoursWithHm,
      counts: { required, complete, pending, overdue, waived },
      clearedForInRatio: gate.cleared && requirements.length > 0,
      gateReasons: reasons,
      certificates: [],
    };
  }

  async listStaffNeedingClearance(siteId?: string): Promise<StaffClearanceRow[]> {
    const session = assertSession(this.store);
    assertCan(session, "hr.view_staff");
    // Roster comes from the agency's staff memberships — not only from staff
    // who already have training assigned — so "All staff" never renders an
    // empty table while the agency has people.
    const memberships = this.store.db.memberships.filter(
      (row) =>
        row.agencyId === session.agencyId &&
        (!siteId || row.siteId === siteId),
    );
    const userIds = [...new Set(memberships.map((row) => row.userId))];
    const rows: StaffClearanceRow[] = [];
    for (const userId of userIds) {
      const profile = await this.getStaffTrainingProfile(userId);
      rows.push({
        userId,
        fullName: profile.fullName,
        siteName: siteId
          ? (this.store.db.sites.find((row) => row.id === siteId)?.name ?? "Unknown site")
          : profile.siteNames.join(", ") || "—",
        clearedForInRatio: profile.clearedForInRatio,
        gateReasons: profile.gateReasons,
        pendingCount: profile.counts.pending,
        overdueCount: profile.counts.overdue,
        hoursTotal: profile.hoursTotal,
        hoursWithHm: profile.hoursWithHm,
      });
    }
    rows.sort((a, b) => Number(a.clearedForInRatio) - Number(b.clearedForInRatio));
    return rows;
  }

  async initialRequirementLine(
    requirementId: string,
    input: RequirementLineSignoffInput,
  ): Promise<void> {
    const session = assertSession(this.store);
    const coll = this.p2Collections();
    const requirement = coll.trainingRequirements.find(
      (row) => row.id === requirementId && row.agencyId === session.agencyId,
    );
    if (!requirement) throw new Error("Training line not found.");
    if (session.userId !== requirement.userId) assertCan(session, "hr.view_staff");
    this.assertTrainingUnlocked(requirement);
    await this.assertDocumentUnlocked(
      "training_checklist",
      trainingChecklistDocId(requirement.userId, requirement.siteId ?? ""),
    );
    const validated = validateTrainingLineInput(input);
    const trainerName = this.p2TrainerName(session, validated.trainerUserId);
    const selfTraining = validated.trainerUserId === requirement.userId;
    const now = new Date().toISOString();
    const existing = this.p2SignoffFor(requirementId);
    if (existing) {
      // Correction edit of a completed line: allowed only on unlocked sheets
      // and only by roles that may update signoffs (mirrors RLS) — plus the
      // assigned trainee, who must be able to re-save their own line in order
      // to re-initial it. 13 CSR 65-3.050 attribution requires that only the
      // trainee initials their own lines, so the save path cannot lock them
      // out of the re-initial the stamp path demands.
      if (
        !canEditTrainingLine(session.roleKey) &&
        session.userId !== requirement.userId
      ) {
        throw new Error(
          "Only the assigned staff member, an administrator, compliance admin, house manager, or DPM can edit a completed training line.",
        );
      }
      Object.assign(existing, {
        initials: validated.initials,
        signedOn: validated.signedOn,
        na: false,
        naReason: null,
        // Void-and-redo: the edit voids the previous initialing — the line
        // must be re-initialed, stamping a fresh versioned signature event.
        // The old version's event stays as history.
        signoffVersion: (existing.signoffVersion ?? 1) + 1,
        trainerName,
        trainerUserId: validated.trainerUserId,
        signedByUserId: session.userId,
        selfTraining,
        method: input.method ?? null,
        hoursTotal: validated.hoursTotal,
        hoursWithHm: validated.hoursWithHm,
        competencyText: input.competencyText?.trim() || null,
        observerName: input.observerName?.trim() || null,
        observerSignature: input.observerSignature?.trim() || null,
        evidenceRef: input.evidenceRef?.trim() || null,
        renewalRule: input.renewalRule?.trim() || null,
        nextDueOn:
          input.nextDueOn?.slice(0, 10) ??
          computeNextDueOn(input.renewalRule?.trim() ?? null, validated.signedOn),
      });
      requirement.status = "complete";
      log(
        this.store,
        session,
        "training.line_edited",
        `${validated.initials} edited “${renderTopicTitle(TRAINING_TOPIC_BY_ID[requirement.topicId])}” for ${ownerName(this.store, requirement.userId)}`,
        "training_requirement",
        requirementId,
      );
      await persistMeta(this.store);
      return;
    }
    coll.trainingSignoffs.push({
      id: crypto.randomUUID(),
      requirementId,
      initials: validated.initials,
      signedOn: validated.signedOn,
      na: false,
      naReason: null,
      signoffVersion: 1,
      trainerName,
      trainerUserId: validated.trainerUserId,
      signedByUserId: session.userId,
      selfTraining,
      method: input.method ?? null,
      hoursTotal: validated.hoursTotal,
      hoursWithHm: validated.hoursWithHm,
      competencyText: input.competencyText?.trim() || null,
      observerName: input.observerName?.trim() || null,
      observerSignature: input.observerSignature?.trim() || null,
      evidenceRef: input.evidenceRef?.trim() || null,
      renewalRule: input.renewalRule?.trim() || null,
      nextDueOn:
        input.nextDueOn?.slice(0, 10) ??
        computeNextDueOn(input.renewalRule?.trim() ?? null, validated.signedOn),
      createdAt: now,
    });
    requirement.status = "complete";
    log(
      this.store,
      session,
      "training.line_initialed",
      `${validated.initials} initialed “${renderTopicTitle(TRAINING_TOPIC_BY_ID[requirement.topicId])}” for ${ownerName(this.store, requirement.userId)}`,
      "training_requirement",
      requirementId,
    );
    await persistMeta(this.store);
  }

  async waiveRequirementLine(requirementId: string, reason: string): Promise<void> {
    const session = assertSession(this.store);
    assertCan(session, "hr.view_staff");
    const coll = this.p2Collections();
    const requirement = coll.trainingRequirements.find(
      (row) => row.id === requirementId && row.agencyId === session.agencyId,
    );
    if (!requirement) throw new Error("Training line not found.");
    this.assertTrainingUnlocked(requirement);
    await this.assertDocumentUnlocked(
      "training_checklist",
      trainingChecklistDocId(requirement.userId, requirement.siteId ?? ""),
    );
    if (this.p2SignoffFor(requirementId)) {
      throw new Error("This training line is already initialed.");
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("Write the reason this line is N/A.");
    const now = new Date().toISOString();
    coll.trainingSignoffs.push({
      id: crypto.randomUUID(),
      requirementId,
      initials: "N/A",
      signedOn: now.slice(0, 10),
      na: true,
      naReason: trimmed,
      signoffVersion: 1,
      trainerName: session.fullName,
      trainerUserId: session.userId,
      signedByUserId: session.userId,
      selfTraining: false,
      method: null,
      hoursTotal: 0,
      hoursWithHm: 0,
      competencyText: null,
      observerName: null,
      observerSignature: null,
      evidenceRef: null,
      renewalRule: null,
      nextDueOn: null,
      createdAt: now,
    });
    requirement.status = "waived_na";
    log(
      this.store,
      session,
      "training.line_waived",
      `N/A: “${renderTopicTitle(TRAINING_TOPIC_BY_ID[requirement.topicId])}” for ${ownerName(this.store, requirement.userId)} — ${trimmed}`,
      "training_requirement",
      requirementId,
    );
    await persistMeta(this.store);
  }

  async requestTrainingCorrection(input: RequestTrainingCorrectionInput): Promise<void> {
    const session = assertSession(this.store);
    if (!canRequestTrainingCorrection(session.roleKey)) {
      throw new Error(
        "Only an administrator, compliance admin, or DPM can request a training correction.",
      );
    }
    const coll = this.p2Collections();
    const index = coll.trainingCountersignatures.findIndex(
      (row) => row.id === input.countersignatureId && row.agencyId === session.agencyId,
    );
    if (index < 0) throw new Error("Training sheet not found.");
    const reason = input.reason.trim();
    if (!reason) throw new Error("Write the reason for this correction.");
    const [removed] = coll.trainingCountersignatures.splice(index, 1);
    // Deleting the countersignature unlocks the sheet: completed lines can be
    // edited, and the sheet must be re-signed and re-countersigned. Clear the
    // whole-sheet end signatures so the same document id can be signed again,
    // but keep the per-line versioned initials stamps as audit history — a
    // line edit already bumps its version and requires re-initialing.
    const sigColl = this.sigCollections();
    sigColl.signatureEvents = sigColl.signatureEvents.filter(
      (row) =>
        !(
          row.agencyId === session.agencyId &&
          row.documentType === "training_checklist" &&
          row.documentId ===
            trainingChecklistDocId(removed.userId, removed.siteId) &&
          (row.fieldName === "staff_sign" || row.fieldName === "hm_countersign")
        ),
    );
    log(
      this.store,
      session,
      "training.correction_requested",
      `Correction requested for ${ownerName(this.store, removed.userId)}'s training sheet: ${reason}`,
      "training_countersignature",
      removed.id,
    );
    await persistMeta(this.store);
  }

  async signStaffChecklist(input: {
    userId: string;
    siteId: string;
    role: "staff" | "hm";
    signatureName: string;
    signatureMark?: string;
  }): Promise<void> {
    const session = assertSession(this.store);
    const coll = this.p2Collections();
    const site = this.store.db.sites.find((row) => row.id === input.siteId);
    if (!site) throw new Error("Site not found.");
    const today = new Date().toISOString().slice(0, 10);
    const lines = coll.trainingRequirements
      .filter(
        (row) =>
          row.agencyId === session.agencyId &&
          row.userId === input.userId &&
          row.siteId === input.siteId,
      )
      .map((row) => this.p2RequirementView(row, today));
    if (lines.length === 0) throw new Error("No training lines assigned for this site yet.");
    let counter = coll.trainingCountersignatures.find(
      (row) =>
        row.agencyId === session.agencyId &&
        row.userId === input.userId &&
        row.siteId === input.siteId,
    );
    if (!counter) {
      counter = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        userId: input.userId,
        siteId: input.siteId,
        staffSignatureName: null,
        staffSignatureMark: null,
        staffSignedAt: null,
        hmSignatureName: null,
        hmSignatureMark: null,
        hmSignedAt: null,
      };
      coll.trainingCountersignatures.push(counter);
    }
    const name = input.signatureName.trim();
    if (!name) throw new Error("Type your name to sign.");
    const now = new Date().toISOString();
    if (input.role === "staff") {
      if (session.userId !== input.userId) {
        throw new Error("Staff must sign their own training sheet.");
      }
      if (counter.staffSignedAt) throw new Error("This sheet is already signed by staff.");
      const open = lines.filter(
        (row) => row.resolvedStatus !== "complete" && row.resolvedStatus !== "waived_na",
      );
      if (open.length > 0) {
        throw new Error(
          `Initial or N/A every training line before signing (${open.length} still open).`,
        );
      }
      counter.staffSignedAt = now;
      counter.staffSignatureName = name;
      counter.staffSignatureMark = input.signatureMark ?? null;
    } else {
      if (!canSignTrainingAsHm(session.roleKey)) {
        throw new Error("Only a house manager can counter-sign training.");
      }
      if (!counter.staffSignedAt) {
        throw new Error("Staff must sign this sheet before the house manager.");
      }
      if (counter.hmSignedAt) throw new Error("House manager already signed.");
      counter.hmSignedAt = now;
      counter.hmSignatureName = name;
      counter.hmSignatureMark = input.signatureMark ?? null;
    }
    log(
      this.store,
      session,
      "training.checklist_signed",
      `${name} signed the training checklist for ${ownerName(this.store, input.userId)} at ${site.name} (${input.role})`,
      "training_requirement",
      counter.id,
    );
    await persistMeta(this.store);
  }
  // ===== LIFEPATH-P3 IMPL (delegation forms) =====

  /** Find the delegation obligation and assert it belongs to the caller's agency. */
  private delegationItem(store: MemoryStore, session: SessionUser, obligationId: string) {
    const item = store.db.obligations.find((row) => row.id === obligationId);
    if (!item || item.kind !== "delegation" || item.agencyId !== session.agencyId) {
      throw new Error("Delegation not found.");
    }
    accessibleIndividual(store, session, item.individualId);
    if (!item.delegationForm) item.delegationForm = blankDelegationForm();
    return item;
  }

  private assertDelegationEditor(session: SessionUser) {
    if (
      !canToggleDelegation(
        session.roleKey,
        session.role,
        hasPermission(session, "requirements.approve"),
      )
    ) {
      throw new Error("Only a DPM or nurse can manage a delegation form.");
    }
  }

  async createDelegation(input: {
    individualId: string;
    taskTitle: string;
    purpose: string;
    /** Optional for data compat; new forms default to the Complyrer version. */
    templateVersion?: DelegationTemplateVersion;
    procedures?: string;
    observeReportDo?: string;
  }) {
    const session = assertSession(this.store);
    this.assertDelegationEditor(session);
    const person = this.store.db.individuals.find(
      (row) => row.id === input.individualId && row.agencyId === session.agencyId,
    );
    if (!person) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, person.id);
    if (!canAccessSite(session, person.siteId)) {
      throw new Error("Choose a person at a site you can manage.");
    }
    const taskTitle = input.taskTitle.trim();
    if (!taskTitle) throw new Error("Name the delegated task.");
    if (!input.purpose.trim()) throw new Error("Describe the purpose of the task.");
    const form = blankDelegationForm(input.templateVersion ?? "complyrer_improved");
    form.purpose = input.purpose.trim();
    form.procedures = input.procedures?.trim() ?? "";
    form.observeReportDo = input.observeReportDo?.trim() ?? "";
    const item: ObligationItem = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId: person.id,
      kind: "delegation",
      mode: "required",
      title: taskTitle,
      detail: form.purpose,
      sourcePage: null,
      documentVersionId: null,
      enabled: true,
      frequency: "On plan update",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "manual",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
      delegationForm: form,
    };
    this.store.db.obligations.push(item);
    log(
      this.store,
      session,
      "delegation.created",
      `${session.fullName} created delegation "${taskTitle}" for ${person.fullName}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
    return { id: item.id };
  }

  async updateDelegationForm(input: {
    obligationId: string;
    patch: DelegationFormPatch;
  }) {
    const session = assertSession(this.store);
    this.assertDelegationEditor(session);
    const item = this.delegationItem(this.store, session, input.obligationId);
    const form = item.delegationForm!;
    await this.assertDocumentUnlocked("delegation_form", input.obligationId);
    const { instructingProfessional, delegatingRn, roster, ...rest } = input.patch;
    Object.assign(form, rest);
    if (instructingProfessional) Object.assign(form.instructingProfessional, instructingProfessional);
    if (delegatingRn) Object.assign(form.delegatingRn, delegatingRn);
    if (roster) form.roster = roster.slice(0, 12);
    log(
      this.store,
      session,
      "delegation.form_updated",
      `${session.fullName} updated the delegation form for ${item.title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  async signDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    signatureName: string;
    signatureMark: string;
    initials: string;
  }) {
    const session = assertSession(this.store);
    const item = this.delegationItem(this.store, session, input.obligationId);
    if (!item.enabled) throw new Error("This delegation is turned off.");
    // Signing order: RN first, then staff — matches the real workflow.
    if (!item.rnSignedAt) {
      throw new Error("The delegating RN must sign before staff sign their rows.");
    }
    const form = item.delegationForm!;
    const row = form.roster[input.rowIndex];
    if (!row) throw new Error("Roster row not found.");
    if (!row.printName.trim()) throw new Error("Name the staff member on that row first.");
    if (row.signedAt) throw new Error("That row is already signed.");
    if (!input.signatureName.trim() || !input.signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    if (!input.initials.trim()) throw new Error("Add your initials.");
    row.signatureName = input.signatureName.trim();
    row.staffSignature = input.signatureMark;
    row.initials = input.initials.trim().toUpperCase();
    row.signedAt = new Date().toISOString();
    log(
      this.store,
      session,
      "delegation.row_signed",
      `${input.signatureName.trim()} signed the delegation roster for ${item.title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  /**
   * Records a roster row's initials acknowledgment (the paper roster's
   * per-row "Initials" column) via the e-signature flow. Unlike signing,
   * initialing does not lock the form: it is the staff member's
   * acknowledgment of the training/competency statement, and the final row
   * signature still follows. Private — reached through applySignature only.
   */
  private async initialDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    initials: string;
  }) {
    const session = assertSession(this.store);
    const item = this.delegationItem(this.store, session, input.obligationId);
    if (!item.enabled) throw new Error("This delegation is turned off.");
    // Same signing order as the row signature: RN first, then staff.
    if (!item.rnSignedAt) {
      throw new Error(
        "The delegating RN must sign before staff initial their rows.",
      );
    }
    const form = item.delegationForm!;
    const row = form.roster[input.rowIndex];
    if (!row) throw new Error("Roster row not found.");
    const named = row.printName.trim();
    if (!named) throw new Error("Name the staff member on that row first.");
    // Only your own row: named rows only by the person named on them.
    if (named.toLowerCase() !== session.fullName.trim().toLowerCase()) {
      throw new Error(`Only ${named} can initial this row.`);
    }
    if (!input.initials.trim()) throw new Error("Add your initials.");
    // Keep the legacy initials column in sync; signedAt stays untouched —
    // initialing is not the row signature and does not lock the form.
    if (!row.initials) row.initials = input.initials.trim().toUpperCase();
    log(
      this.store,
      session,
      "delegation.row_initialed",
      `${session.fullName} initialed the delegation roster for ${item.title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  async rescindDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    rescindedDate: string;
  }) {
    const session = assertSession(this.store);
    this.assertDelegationEditor(session);
    const item = this.delegationItem(this.store, session, input.obligationId);
    const form = item.delegationForm!;
    await this.assertDocumentUnlocked("delegation_form", input.obligationId);
    const row = form.roster[input.rowIndex];
    if (!row) throw new Error("Roster row not found.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.rescindedDate)) {
      throw new Error("Use a valid rescinded date.");
    }
    row.rescindedDate = input.rescindedDate;
    log(
      this.store,
      session,
      "delegation.row_rescinded",
      `${session.fullName} rescinded ${row.printName || "a roster row"} on ${item.title}`,
      "obligation",
      item.id,
    );
    await persistMeta(this.store);
  }

  async getDelegationPdf(input: { obligationId: string }) {
    const session = assertSession(this.store);
    const item = this.delegationItem(this.store, session, input.obligationId);
    const person = this.store.db.individuals.find((row) => row.id === item.individualId);
    const site = this.store.db.sites.find((row) => row.id === person?.siteId);
    const { buildDelegationPdf, delegationFileName } = await import("../pdf/delegationPdf");
    const pdf = buildDelegationPdf({
      agencyName: session.agencyName,
      individualName: person?.fullName ?? "Individual",
      dmhId: "",
      individualLocation: site?.name ?? "",
      taskTitle: item.title,
      form: item.delegationForm!,
      documentId: input.obligationId,
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return {
      blob: pdf.output("blob"),
      name: delegationFileName(item.title, person?.fullName ?? "individual"),
    };
  }
  // ===== LIFEPATH-P4 IMPL (certificates) =====
  // LIFEPATH-P4 (certificates): HR certificate tracking (LocalApi, in-memory).
  private certificatesOf() {
    return (this.store.db.certificates ??= []);
  }

  private assertCertificateRead(session: SessionUser) {
    if (
      !hasPermission(session, "certificates.manage") &&
      !hasPermission(session, "hr.view_staff")
    ) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private assertCertificateWrite(session: SessionUser) {
    assertCan(session, "certificates.manage");
  }

  private requireAgencyProfile(session: SessionUser, userId: string) {
    const profile = this.store.db.profiles.find(
      (row) => row.id === userId && row.homeAgencyId === session.agencyId,
    );
    if (!profile) throw new Error("Staff member not found.");
    return profile;
  }

  private findCertificate(session: SessionUser, id: string) {
    const cert = this.certificatesOf().find(
      (row) => row.id === id && row.agencyId === session.agencyId,
    );
    if (!cert) throw new Error("Certificate not found.");
    return cert;
  }

  async listCertificates(userId: string): Promise<StaffCertificate[]> {
    const session = assertSession(this.store);
    this.assertCertificateRead(session);
    return this.certificatesOf()
      .filter((row) => row.userId === userId && row.agencyId === session.agencyId)
      .slice()
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  }

  async addCertificate(input: AddCertificateInput): Promise<StaffCertificate> {
    const session = assertSession(this.store);
    this.assertCertificateWrite(session);
    this.requireAgencyProfile(session, input.userId);
    const certName = input.certName.trim();
    if (!certName) throw new Error("Enter the certificate name.");
    validateCertificateDates(input.issuedOn, input.expiresOn);
    const cert: StaffCertificate = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      userId: input.userId,
      certName,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn,
      filePath: null,
      fileName: null,
      enteredBy: session.userId,
      createdAt: new Date().toISOString(),
    };
    this.certificatesOf().unshift(cert);
    log(
      this.store,
      session,
      "certificate.added",
      `${certName} recorded for ${this.requireAgencyProfile(session, input.userId).fullName} (renews ${input.expiresOn})`,
      "certificate",
      cert.id,
    );
    await persistMeta(this.store);
    return cert;
  }

  async uploadCertificateFile(
    input: UploadCertificateFileInput,
  ): Promise<StaffCertificate> {
    const session = assertSession(this.store);
    this.assertCertificateWrite(session);
    validateCertificateFile(input.file);
    const cert = await this.addCertificate({
      userId: input.userId,
      certName: input.certName,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn,
    });
    const safeName = input.file.name.replace(/[^\w.\-]+/g, "_") || "certificate.pdf";
    const storagePath = `agency/${session.agencyId}/certs/${cert.id}/${safeName}`;
    await persistFile(storagePath, input.file);
    cert.filePath = storagePath;
    cert.fileName = input.file.name;
    log(
      this.store,
      session,
      "certificate.uploaded",
      `Certificate file uploaded for ${cert.certName}`,
      "certificate",
      cert.id,
    );
    await persistMeta(this.store);
    return cert;
  }

  async updateCertificate(
    id: string,
    input: UpdateCertificateInput,
  ): Promise<StaffCertificate> {
    const session = assertSession(this.store);
    this.assertCertificateWrite(session);
    const cert = this.findCertificate(session, id);
    const certName = input.certName?.trim() ?? cert.certName;
    if (!certName) throw new Error("Enter the certificate name.");
    const issuedOn = input.issuedOn ?? cert.issuedOn;
    const expiresOn = input.expiresOn ?? cert.expiresOn;
    validateCertificateDates(issuedOn, expiresOn);
    cert.certName = certName;
    cert.issuedOn = issuedOn;
    cert.expiresOn = expiresOn;
    log(
      this.store,
      session,
      "certificate.updated",
      `${cert.certName} updated (renews ${cert.expiresOn})`,
      "certificate",
      cert.id,
    );
    await persistMeta(this.store);
    return cert;
  }

  async deleteCertificate(id: string): Promise<void> {
    const session = assertSession(this.store);
    this.assertCertificateWrite(session);
    const cert = this.findCertificate(session, id);
    const store = this.certificatesOf();
    store.splice(store.indexOf(cert), 1);
    if (cert.filePath) this.store.files.delete(cert.filePath);
    log(
      this.store,
      session,
      "certificate.deleted",
      `${cert.certName} removed`,
      "certificate",
      cert.id,
    );
    await persistMeta(this.store);
  }

  async certificatesExpiringSoon(days: number): Promise<ExpiringCertificate[]> {
    const session = assertSession(this.store);
    this.assertCertificateRead(session);
    const today = todayIso();
    return this.certificatesOf()
      .filter((row) => row.agencyId === session.agencyId)
      .map((row) => {
        const profile = this.store.db.profiles.find((p) => p.id === row.userId);
        return {
          ...row,
          staffName: profile?.fullName ?? "Unknown staff",
          daysRemaining: daysRemaining(row.expiresOn, today),
        };
      })
      .filter((row) => row.daysRemaining <= days)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  async certificateFileUrl(id: string): Promise<string> {
    const session = assertSession(this.store);
    this.assertCertificateRead(session);
    const cert = this.findCertificate(session, id);
    if (!cert.filePath) throw new Error("This certificate has no file attached.");
    const blob = await readStoredFile(this.store, cert.filePath);
    if (!blob || blob.size === 0) throw new Error("The certificate file is missing.");
    return URL.createObjectURL(blob);
  }

  // ===== AUDIT-READINESS IMPL (corrective actions) =====
  // AUDIT-READINESS: corrective-action workflow (LocalApi, in-memory).
  private correctiveActionsOf() {
    return (this.store.db.correctiveActions ??= []);
  }

  private assertCorrectiveActionWrite(session: SessionUser) {
    assertCan(session, "correctiveActions.manage");
  }

  private findCorrectiveAction(session: SessionUser, id: string) {
    const action = this.correctiveActionsOf().find(
      (row) => row.id === id && row.agencyId === session.agencyId && ((isAgencyWideViewer(session) && session.roleKey !== "hr") || row.createdByUserId === session.userId || row.assignedToUserId === session.userId),
    );
    if (!action) throw new Error("Corrective action not found.");
    return action;
  }

  private assigneeName(session: SessionUser, userId: string | null): string | null {
    if (!userId) return null;
    const profile = this.store.db.profiles.find(
      (row) => row.id === userId && row.homeAgencyId === session.agencyId,
    );
    return profile?.fullName ?? null;
  }

  async listCorrectiveActions(input?: {
    status?: "open" | "in_progress" | "resolved" | "overdue";
    assignedToUserId?: string;
  }): Promise<CorrectiveAction[]> {
    const session = assertSession(this.store);
    const now = new Date();
    let rows = this.correctiveActionsOf().filter(
      (row) => row.agencyId === session.agencyId && ((isAgencyWideViewer(session) && session.roleKey !== "hr") || row.createdByUserId === session.userId || row.assignedToUserId === session.userId),
    );
    if (input?.assignedToUserId) {
      rows = rows.filter((row) => row.assignedToUserId === input.assignedToUserId);
    }
    if (input?.status) {
      rows = rows.filter(
        (row) => deriveCorrectiveActionStatus(row, now) === input.status,
      );
    }
    return sortCorrectiveActions(rows, now);
  }

  async addCorrectiveAction(input: AddCorrectiveActionInput): Promise<CorrectiveAction> {
    const session = assertSession(this.store);
    this.assertCorrectiveActionWrite(session);
    const errors = validateCorrectiveActionInput(input);
    if (errors.length > 0) throw new Error(errors[0]);
    const assigneeId = input.assignedToUserId ?? null;
    if (assigneeId) this.requireAgencyProfile(session, assigneeId);
    const now = new Date().toISOString();
    const action: CorrectiveAction = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      assignedToUserId: assigneeId,
      assignedToName: this.assigneeName(session, assigneeId),
      dueOn: input.dueOn?.trim() || null,
      storedStatus: "open",
      linkedRiskId: input.linkedRiskId ?? null,
      linkedRiskSource: input.linkedRiskSource ?? null,
      createdByUserId: session.userId,
      createdAt: now,
      resolvedAt: null,
    };
    this.correctiveActionsOf().unshift(action);
    log(
      this.store,
      session,
      "corrective_action.added",
      `Corrective action "${action.title}" created${action.assignedToName ? `, assigned to ${action.assignedToName}` : ""}`,
      "corrective_action",
      action.id,
    );
    await persistMeta(this.store);
    return action;
  }

  async updateCorrectiveAction(
    id: string,
    input: UpdateCorrectiveActionInput,
  ): Promise<CorrectiveAction> {
    const session = assertSession(this.store);
    this.assertCorrectiveActionWrite(session);
    const action = this.findCorrectiveAction(session, id);
    if (input.title !== undefined) {
      const errors = validateCorrectiveActionInput({
        title: input.title,
        dueOn: input.dueOn ?? action.dueOn,
      });
      if (errors.length > 0) throw new Error(errors[0]);
      action.title = input.title.trim();
    }
    if (input.dueOn !== undefined) {
      const errors = validateCorrectiveActionInput({
        title: action.title,
        dueOn: input.dueOn,
      });
      if (errors.length > 0) throw new Error(errors[0]);
      action.dueOn = input.dueOn?.trim() || null;
    }
    if (input.description !== undefined) action.description = input.description?.trim() ?? "";
    if (input.assignedToUserId !== undefined) {
      if (input.assignedToUserId) this.requireAgencyProfile(session, input.assignedToUserId);
      action.assignedToUserId = input.assignedToUserId;
      action.assignedToName = this.assigneeName(session, input.assignedToUserId);
    }
    if (input.storedStatus !== undefined) action.storedStatus = input.storedStatus;
    if (input.linkedRiskId !== undefined) action.linkedRiskId = input.linkedRiskId;
    if (input.linkedRiskSource !== undefined)
      action.linkedRiskSource = input.linkedRiskSource;
    if (action.storedStatus === "resolved" && !action.resolvedAt) {
      action.resolvedAt = new Date().toISOString();
    } else if (action.storedStatus !== "resolved") {
      action.resolvedAt = null;
    }
    log(
      this.store,
      session,
      "corrective_action.updated",
      `Corrective action "${action.title}" updated`,
      "corrective_action",
      action.id,
    );
    await persistMeta(this.store);
    return action;
  }

  async resolveCorrectiveAction(id: string): Promise<CorrectiveAction> {
    return this.updateCorrectiveAction(id, { storedStatus: "resolved" });
  }

  // ===== AUDIT-READINESS IMPL (score snapshots) =====
  private complianceSnapshotsOf() {
    return (this.store.db.complianceSnapshots ??= []);
  }

  async saveComplianceSnapshot(input: {
    siteId?: string | null;
    result: ComplianceScore;
  }): Promise<ScoreSnapshot> {
    const session = assertSession(this.store);
    this.assertCorrectiveActionWrite(session);
    const siteId = input.siteId ?? null;
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.complianceSnapshotsOf();
    // One snapshot per day per scope — replace today's if it exists.
    const existing = rows.find(
      (row) =>
        row.agencyId === session.agencyId &&
        row.siteId === siteId &&
        row.computedAt.slice(0, 10) === today,
    );
    const snapshot: ScoreSnapshot = {
      id: existing?.id ?? crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId,
      score: input.result.score,
      band: input.result.band,
      breakdown: input.result.breakdown,
      factCount: input.result.factCount,
      computedAt: new Date().toISOString(),
    };
    if (existing) {
      rows.splice(rows.indexOf(existing), 1, snapshot);
    } else {
      rows.unshift(snapshot);
    }
    await persistMeta(this.store);
    return snapshot;
  }

  async listComplianceSnapshots(
    siteId?: string | null,
    limit = 30,
  ): Promise<ScoreSnapshot[]> {
    const session = assertSession(this.store);
    const scope = siteId ?? null;
    return sortSnapshotsOldestFirst(
      this.complianceSnapshotsOf().filter(
        (row) => row.agencyId === session.agencyId && row.siteId === scope,
      ),
    ).slice(-Math.max(limit, 1));
  }
  // ===== LIFEPATH-P5 IMPL (HM weekly checklist) =====

  /**
   * seed.ts carries no P5 marker, so the checklist collection rides on the
   * workspace db object and is persisted by the existing persistMeta flow.
   */
  private weeklyChecklists(): HmWeeklyChecklist[] {
    const db = this.store.db as LocalDatabase & {
      weeklyChecklists?: HmWeeklyChecklist[];
    };
    db.weeklyChecklists = db.weeklyChecklists ?? [];
    return db.weeklyChecklists;
  }

  private assertChecklistAssigner(session: SessionUser) {
    const ok =
      session.roleKey === "degreed_professional_manager" ||
      session.role === "administrator" ||
      session.role === "compliance_admin" ||
      session.platformAdmin;
    if (!ok) {
      throw new Error(
        "Only a DPM or agency administrator can assign weekly checklists.",
      );
    }
  }

  private checklistOversight(session: SessionUser): boolean {
    return (
      session.roleKey === "degreed_professional_manager" ||
      session.role === "administrator" ||
      session.role === "compliance_admin" ||
      session.platformAdmin
    );
  }

  private checklistById(
    session: SessionUser,
    checklistId: string,
  ): HmWeeklyChecklist {
    const row = this.weeklyChecklists().find(
      (c) => c.id === checklistId && c.agencyId === session.agencyId,
    );
    if (!row) throw new Error("Checklist not found.");
    if (
      row.assignedToUserId !== session.userId &&
      !this.checklistOversight(session)
    ) {
      throw new Error("This checklist is assigned to another house manager.");
    }
    return row;
  }

  private assertChecklistHm(
    session: SessionUser,
    row: HmWeeklyChecklist,
  ) {
    if (row.assignedToUserId !== session.userId) {
      throw new Error("Only the assigned house manager can fill in this checklist.");
    }
  }

  /**
   * LIFEPATH-P5 → P2 HOOK: pre-Phase-2 training readiness feed, built from the
   * legacy training-checklist data (signTrainingChecklist / initialTrainingLine).
   * When the Phase 2 training engine merges, replace this with the engine's
   * per-staff readiness feed (including delegation sign-offs). The
   * TrainingReadiness shape and computeItem21 stay the same.
   */
  private trainingReadinessForSite(
    siteId: string,
    agencyId: string,
  ): TrainingReadiness[] {
    const today = todayIso();
    const oversightKeys = [
      "administrator",
      "compliance_admin",
      "degreed_professional_manager",
      "program_manager",
    ];
    return this.store.db.memberships
      .filter(
        (m) =>
          m.agencyId === agencyId &&
          m.siteId === siteId &&
          !oversightKeys.includes(m.roleKey) &&
          (!m.expiresOn || m.expiresOn >= today),
      )
      .map((m) => {
        const profile = this.store.db.profiles.find((p) => p.id === m.userId);
        const sheets = this.store.db.trainingChecklists.filter(
          (t) => t.staffUserId === m.userId,
        );
        return {
          staffId: m.userId,
          staffName: profile?.fullName ?? "Staff",
          fullySignedOff:
            sheets.length > 0 &&
            sheets.every(
              (s) =>
                Boolean(s.staffSignedAt) &&
                Boolean(s.hmSignedAt) &&
                s.items.every((line) => Boolean(line.initialedAt)),
            ),
        };
      });
  }

  /** Recompute item 21 from training data and stamp it onto the instance. */
  private stampItem21(row: HmWeeklyChecklist): ChecklistAnswer {
    const computed = computeItem21(
      this.trainingReadinessForSite(row.siteId, row.agencyId),
    );
    row.items = applyItem21(row.items, computed);
    row.updatedAt = new Date().toISOString();
    return computed.answer;
  }

  async assignWeeklyChecklist(input: {
    siteId: string;
    hmUserId: string;
    weekOf: string;
  }): Promise<HmWeeklyChecklist> {
    const session = assertSession(this.store);
    this.assertChecklistAssigner(session);
    const site = this.store.db.sites.find(
      (s) => s.id === input.siteId && s.agencyId === session.agencyId,
    );
    if (!site || !canAccessSite(session, input.siteId)) throw new Error("Home not found.");
    const hmMembership = this.store.db.memberships.find(
      (m) =>
        m.agencyId === session.agencyId &&
        m.userId === input.hmUserId &&
        m.roleKey === "house_manager",
    );
    if (!hmMembership) {
      throw new Error("Checklists can only be assigned to a house manager.");
    }
    const weekOf = weekOfSundayIso(input.weekOf);
    const now = new Date().toISOString();
    const existing = this.weeklyChecklists().find(
      (c) =>
        c.agencyId === session.agencyId &&
        c.siteId === input.siteId &&
        c.weekOf === weekOf,
    );
    if (existing) {
      existing.assignedToUserId = input.hmUserId;
      existing.assignedByUserId = session.userId;
      if (existing.status === "open") this.stampItem21(existing);
      existing.updatedAt = now;
      log(
        this.store,
        session,
        "checklist.assigned",
        `Weekly checklist reassigned for ${site.name} · week of ${weekOf}`,
        "hm_weekly_checklist",
        existing.id,
      );
      await persistMeta(this.store);
      return existing;
    }
    const row: HmWeeklyChecklist = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId: input.siteId,
      weekOf,
      assignedToUserId: input.hmUserId,
      assignedByUserId: session.userId,
      status: "open",
      submittedAt: null,
      items: buildChecklistItems(),
      serviceLogs: [],
      attestation: null,
      createdAt: now,
      updatedAt: now,
    };
    this.stampItem21(row);
    this.weeklyChecklists().push(row);
    log(
      this.store,
      session,
      "checklist.assigned",
      `Weekly checklist assigned for ${site.name} · week of ${weekOf}`,
      "hm_weekly_checklist",
      row.id,
    );
    await persistMeta(this.store);
    return row;
  }

  async listWeeklyChecklists(input?: {
    siteId?: string;
    weekOf?: string;
  }): Promise<HmWeeklyChecklist[]> {
    const session = assertSession(this.store);
    const oversight = this.checklistOversight(session);
    return this.weeklyChecklists()
      .filter(
        (c) =>
          c.agencyId === session.agencyId &&
          (oversight || c.assignedToUserId === session.userId) &&
          (!input?.siteId || c.siteId === input.siteId) &&
          (!input?.weekOf || c.weekOf === weekOfSundayIso(input.weekOf)),
      )
      .sort((a, b) => b.weekOf.localeCompare(a.weekOf));
  }

  async answerChecklistItem(
    checklistId: string,
    itemKey: string,
    answer: ChecklistAnswer,
    note?: string,
  ): Promise<void> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    this.assertChecklistHm(session, row);
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open for edits.");
    }
    if (itemKey === ITEM_21_KEY) {
      throw new Error(
        "Item 21 is auto-checked from training records and cannot be answered by hand.",
      );
    }
    if (!row.items.some((item) => item.key === itemKey)) {
      throw new Error("Checklist item not found.");
    }
    await this.assertDocumentUnlocked("hm_checklist", checklistId);
    row.items = applyItemAnswer(row.items, itemKey, answer, note);
    row.updatedAt = new Date().toISOString();
    await persistMeta(this.store);
  }

  async addServiceLogEntry(
    checklistId: string,
    input: {
      kind: ServiceLogKind;
      detail: string;
      staffName?: string;
      dateTime?: string;
    },
  ): Promise<ServiceLogEntry> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    this.assertChecklistHm(session, row);
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open for edits.");
    }
    if (!input.detail.trim()) throw new Error("Describe the log entry.");
    await this.assertDocumentUnlocked("hm_checklist", checklistId);
    const entry: ServiceLogEntry = {
      id: crypto.randomUUID(),
      kind: input.kind,
      detail: input.detail.trim(),
      staffName: input.staffName?.trim() || null,
      dateTime: input.dateTime?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    row.serviceLogs.push(entry);
    row.updatedAt = new Date().toISOString();
    await persistMeta(this.store);
    return entry;
  }

  async removeServiceLogEntry(
    checklistId: string,
    entryId: string,
  ): Promise<void> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    this.assertChecklistHm(session, row);
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open for edits.");
    }
    await this.assertDocumentUnlocked("hm_checklist", checklistId);
    row.serviceLogs = row.serviceLogs.filter((e) => e.id !== entryId);
    row.updatedAt = new Date().toISOString();
    await persistMeta(this.store);
  }

  async refreshChecklistItem21(
    checklistId: string,
  ): Promise<ChecklistAnswer> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    if (row.status !== "open") return "N";
    const answer = this.stampItem21(row);
    await persistMeta(this.store);
    return answer;
  }

  async submitWeeklyChecklist(
    checklistId: string,
    signatureName: string,
  ): Promise<void> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    this.assertChecklistHm(session, row);
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open.");
    }
    // Item 21 reflects the latest training data at submit time.
    this.stampItem21(row);
    const blanks = blankItemNumbers(row.items);
    if (blanks.length > 0) {
      throw new Error(
        `Answer every item before submitting (do not leave blanks). Blank: ${blanks
          .map((n) => `#${n}`)
          .join(", ")}.`,
      );
    }
    const signedBy = signatureName.trim();
    if (!signedBy) throw new Error("Type your name to sign the attestation.");
    const now = new Date().toISOString();
    row.attestation = { signedBy, signedAt: now, signatureMark: signedBy };
    row.status = "submitted";
    row.submittedAt = now;
    row.updatedAt = now;
    const site = this.store.db.sites.find((s) => s.id === row.siteId);
    log(
      this.store,
      session,
      "checklist.submitted",
      `Weekly checklist submitted for ${site?.name ?? "home"} · week of ${row.weekOf}`,
      "hm_weekly_checklist",
      row.id,
    );
    await persistMeta(this.store);
  }

  async rolloverWeeklyChecklists(): Promise<{
    created: number;
    locked: number;
  }> {
    const session = assertSession(this.store);
    const currentWeek = weekOfSundayIso(todayIso());
    const now = new Date().toISOString();
    let locked = 0;
    for (const row of this.weeklyChecklists()) {
      if (
        row.agencyId === session.agencyId &&
        row.status === "open" &&
        row.weekOf < currentWeek
      ) {
        row.status = "overdue";
        row.updatedAt = now;
        locked += 1;
      }
    }
    const today = todayIso();
    const hmAssignments = this.store.db.memberships.filter(
      (m) =>
        m.agencyId === session.agencyId &&
        m.roleKey === "house_manager" &&
        m.siteId &&
        (!m.expiresOn || m.expiresOn >= today),
    );
    let created = 0;
    for (const m of hmAssignments) {
      const exists = this.weeklyChecklists().some(
        (c) =>
          c.agencyId === session.agencyId &&
          c.siteId === m.siteId &&
          c.weekOf === currentWeek,
      );
      if (exists) continue;
      const row: HmWeeklyChecklist = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        siteId: m.siteId!,
        weekOf: currentWeek,
        assignedToUserId: m.userId,
        assignedByUserId: null,
        status: "open",
        submittedAt: null,
        items: buildChecklistItems(),
        serviceLogs: [],
        attestation: null,
        createdAt: now,
        updatedAt: now,
      };
      this.stampItem21(row);
      this.weeklyChecklists().push(row);
      created += 1;
    }
    if (created > 0 || locked > 0) {
      log(
        this.store,
        session,
        "checklist.rollover",
        `Weekly rollover: ${created} opened · ${locked} locked overdue`,
        "hm_weekly_checklist",
      );
      await persistMeta(this.store);
    }
    return { created, locked };
  }

  async exportWeeklyChecklistPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    const site = this.store.db.sites.find((s) => s.id === row.siteId);
    const hm = this.store.db.profiles.find((p) => p.id === row.assignedToUserId);
    const doc = buildWeeklyChecklistPdf({
      agencyName: session.agencyName,
      siteName: site?.name ?? "Home",
      weekOf: row.weekOf,
      checklist: row,
      hmName: hm?.fullName ?? "",
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return {
      blob: doc.output("blob"),
      name: weeklyChecklistPdfName(site?.name ?? "home", row.weekOf),
    };
  }

  async exportWeeklyServiceLogPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }> {
    const session = assertSession(this.store);
    const row = this.checklistById(session, checklistId);
    const site = this.store.db.sites.find((s) => s.id === row.siteId);
    const hm = this.store.db.profiles.find((p) => p.id === row.assignedToUserId);
    const doc = buildWeeklyServiceLogPdf({
      agencyName: session.agencyName,
      siteName: site?.name ?? "Home",
      weekOf: row.weekOf,
      checklist: row,
      hmName: hm?.fullName ?? "",
      logoDataUrl: await logoDataUrlFor(this.store, session.agencyId),
    });
    return {
      blob: doc.output("blob"),
      name: weeklyServiceLogPdfName(site?.name ?? "home", row.weekOf),
    };
  }
  // ===== LIFEPATH-P6 IMPL (med inventory) =====
  private async p6lib(): Promise<typeof import("./medInventory")> {
    return await import("./medInventory");
  }

  private p6rows(): import("./types").MedInventoryRecord[] {
    const db = this.store.db as LocalDatabase & {
      medInventory?: import("./types").MedInventoryRecord[];
    };
    if (!db.medInventory) db.medInventory = [];
    return db.medInventory;
  }

  private p6medicationOrThrow(medicationId: string) {
    const session = assertSession(this.store);
    const med = this.store.db.medications.find((row) => row.id === medicationId);
    if (!med || med.agencyId !== session.agencyId) {
      throw new Error("Medication not found.");
    }
    accessibleIndividual(this.store, session, med.individualId);
    return { session, med };
  }

  private p6doseExceptions(): MedDoseException[] {
    const db = this.store.db as LocalDatabase & {
      medDoseExceptions?: MedDoseException[];
    };
    if (!db.medDoseExceptions) db.medDoseExceptions = [];
    return db.medDoseExceptions;
  }

  private p6upsertRow(
    session: { agencyId: string },
    med: { id: string; individualId: string },
    patch: Partial<import("./types").MedInventoryRecord>,
  ): import("./types").MedInventoryRecord {
    const rows = this.p6rows();
    const existing = rows.find((row) => row.medicationId === med.id);
    if (existing) {
      Object.assign(existing, patch, { updatedAt: new Date().toISOString() });
      return existing;
    }
    const row: import("./types").MedInventoryRecord = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId: med.individualId,
      medicationId: med.id,
      lowThresholdDays: 7,
      doseTimes: [],
      reorderAcknowledgedOn: null,
      updatedAt: new Date().toISOString(),
      ...patch,
    };
    rows.push(row);
    return row;
  }

  async getMedInventory(
    individualId: string,
  ): Promise<import("./types").MedInventoryView[]> {
    const { projectMedInventory, compareMedInventory } = await this.p6lib();
    const session = assertSession(this.store);
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view medication inventory.");
    }
    const person = this.store.db.individuals.find(
      (row) => row.id === individualId,
    );
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found.");
    }
    accessibleIndividual(this.store, session, person.id);
    const rows = this.p6rows();
    const today = todayIso();
    return this.store.db.medications
      .filter(
        (med) =>
          med.individualId === individualId && med.agencyId === session.agencyId,
      )
      .map((med) =>
        projectMedInventory({
          med,
          inventory: rows.find((row) => row.medicationId === med.id) ?? null,
          deliveries: this.store.db.medicationDeliveries.filter(
            (delivery) => delivery.medicationId === med.id,
          ),
          // Local backend: logPrnDose decrements the medication row directly,
          // so projectMedInventory falls back to the row count for PRN meds.
          prnDoses: [],
          doseExceptions: this.p6doseExceptions().filter(
            (exception) => exception.medicationId === med.id,
          ),
          today,
        }),
      )
      .sort(compareMedInventory);
  }

  async getMedicationSupplyStatus(
    siteId: string,
  ): Promise<import("./types").MedSupplyStatus> {
    const { summarizeMedSupply } = await this.p6lib();
    const session = assertSession(this.store);
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view medication inventory.");
    }
    const site = this.store.db.sites.find(
      (row) => row.id === siteId && row.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Site not found.");
    const people = this.store.db.individuals.filter(
      (row) => row.siteId === siteId && row.agencyId === session.agencyId,
    );
    const views = (
      await Promise.all(people.map((person) => this.getMedInventory(person.id)))
    ).flat();
    return summarizeMedSupply(siteId, site.name, views, todayIso());
  }

  async adjustMedInventory(input: {
    medicationId: string;
    quantityDelta: number;
    reason: string;
    countedOn?: string;
  }) {
    const { session, med } = this.p6medicationOrThrow(input.medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or DPM adjusts medication inventory.");
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error("Give a reason for the count correction.");
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
      throw new Error("Enter a non-zero correction.");
    }
    const countedOn = input.countedOn ?? todayIso();
    assertCalendarDate(countedOn, "Use a valid count date.");
    const next = Math.max(
      0,
      Math.round((med.remainingPills + input.quantityDelta) * 100) / 100,
    );
    med.remainingPills = next;
    med.lastDeliveryOn = countedOn;
    med.lastCountdownOn = countedOn;
    this.store.db.medicationDeliveries.push({
      id: crypto.randomUUID(),
      medicationId: med.id,
      countedOn,
      remainingPills: next,
      pillsPerDay: med.pillsPerDay,
      recordedBy: session.userId,
    });
    log(
      this.store,
      session,
      "medication.inventory_adjusted",
      `${session.fullName} corrected ${med.name} by ${input.quantityDelta > 0 ? "+" : ""}${input.quantityDelta} pills: ${reason}`,
      "medication",
      med.id,
    );
    await persistMeta(this.store);
  }

  async setReorderThreshold(input: {
    medicationId: string;
    lowThresholdDays: number;
  }) {
    const { session, med } = this.p6medicationOrThrow(input.medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or DPM sets the reorder threshold.");
    }
    const days = Math.floor(input.lowThresholdDays);
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      throw new Error("Set the reorder threshold to 1–90 days of doses.");
    }
    this.p6upsertRow(session, med, { lowThresholdDays: days });
    log(
      this.store,
      session,
      "medication.threshold_updated",
      `${session.fullName} set the ${med.name} reorder threshold to ${days} days`,
      "medication",
      med.id,
    );
    await persistMeta(this.store);
  }

  async acknowledgeReorderAlert(medicationId: string) {
    const { session, med } = this.p6medicationOrThrow(medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or DPM acknowledges a reorder alert.");
    }
    this.p6upsertRow(session, med, { reorderAcknowledgedOn: todayIso() });
    log(
      this.store,
      session,
      "medication.reorder_acknowledged",
      `${session.fullName} acknowledged the ${med.name} reorder alert`,
      "medication",
      med.id,
    );
    await persistMeta(this.store);
  }

  async addMedDoseException(input: AddMedDoseExceptionInput) {
    const { validateDoseExceptionInput } = await this.p6lib();
    const { session, med } = this.p6medicationOrThrow(input.medicationId);
    if (!canLogDoseException(session.roleKey)) {
      throw new Error("You cannot log a dose exception.");
    }
    const validated = validateDoseExceptionInput(input);
    const now = new Date().toISOString();
    const row: MedDoseException = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId: med.individualId,
      medicationId: med.id,
      occurredOn: validated.occurredOn,
      kind: validated.kind,
      pillsAffected: validated.pillsAffected,
      reason: validated.reason,
      createdBy: session.userId,
      createdAt: now,
    };
    // Insert-only: corrections are new rows, never edits — there is no
    // updateMedDoseException or deleteMedDoseException on this API.
    this.p6doseExceptions().push(row);
    log(
      this.store,
      session,
      "medication.dose_exception",
      `${session.fullName} logged a ${validated.kind} dose exception for ${med.name} (${validated.pillsAffected} pill${validated.pillsAffected === 1 ? "" : "s"}): ${validated.reason}`,
      "med_dose_exception",
      row.id,
    );
    await persistMeta(this.store);
  }
  // ===== LIFEPATH-P7 IMPL (mileage tracking) =====
  // LIFEPATH-P7 (mileage): vehicle mileage log (LocalApi, in-memory).

  private async p7lib(): Promise<typeof import("./mileage")> {
    return await import("./mileage");
  }

  private mileageRows(): import("./types").MileageTrip[] {
    const db = this.store.db as LocalDatabase & {
      mileageTrips?: import("./types").MileageTrip[];
    };
    if (!db.mileageTrips) db.mileageTrips = [];
    return db.mileageTrips;
  }

  private assertMileageAccess(session: SessionUser) {
    assertCan(session, "mileage.manage");
  }

  private siteOrThrow(session: { agencyId: string }, siteId: string) {
    const site = this.store.db.sites.find(
      (row) => row.id === siteId && row.agencyId === session.agencyId,
    );
    if (!site || !canAccessSite(assertSession(this.store), siteId)) throw new Error("Home not found.");
    return site;
  }

  private findMileageTrip(session: { agencyId: string }, tripId: string) {
    const trip = this.mileageRows().find(
      (row) => row.id === tripId && row.agencyId === session.agencyId,
    );
    if (!trip) throw new Error("Mileage trip not found.");
    this.siteOrThrow(session, trip.siteId);
    return trip;
  }

  private async validatedTripInput(
    input: import("./types").AddMileageTripInput | import("./types").UpdateMileageTripInput,
    existing?: import("./types").MileageTrip,
  ) {
    const { validateTripInput, computeTripMiles } = await this.p7lib();
    const merged = {
      tripDate: input.tripDate ?? existing?.tripDate ?? "",
      odometerStart: input.odometerStart ?? existing?.odometerStart ?? NaN,
      odometerEnd: input.odometerEnd ?? existing?.odometerEnd ?? NaN,
      riderIds: input.riderIds ?? existing?.riderIds ?? [],
      reason: input.reason ?? existing?.reason ?? "",
      driverName: input.driverName ?? existing?.driverName ?? "",
    };
    const errors = validateTripInput(merged);
    if (errors.length > 0) throw new Error(errors[0].message);
    return { ...merged, miles: computeTripMiles(merged.odometerStart, merged.odometerEnd) };
  }

  private riderIndividualsOrThrow(
    session: { agencyId: string },
    siteId: string,
    riderIds: string[],
  ) {
    const people = this.store.db.individuals.filter(
      (row) => row.agencyId === session.agencyId && row.siteId === siteId,
    );
    const ids = new Set(people.map((row) => row.id));
    for (const riderId of riderIds) {
      if (!ids.has(riderId)) throw new Error("A rider is not part of this home.");
    }
    return people;
  }

  async listMileageTrips(
    siteId: string,
    month: string,
  ): Promise<import("./types").MileageTripView[]> {
    const { compareMileageTrips, splitMilesAmongRiders } = await this.p7lib();
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    this.siteOrThrow(session, siteId);
    return this.mileageRows()
      .filter(
        (row) =>
          row.agencyId === session.agencyId &&
          row.siteId === siteId &&
          row.tripDate.slice(0, 7) === month,
      )
      .sort(compareMileageTrips)
      .map((trip) => ({
        ...trip,
        riderShares: [...splitMilesAmongRiders(trip.miles, trip.riderIds)].map(
          ([individualId, miles]) => ({ individualId, miles }),
        ),
      }));
  }

  async getMileageMonthlySummary(
    siteId: string,
    month: string,
    individualIds: string[],
  ): Promise<import("./mileage").MileageMonthlySummary> {
    const { summarizeMonthlyMileage } = await this.p7lib();
    const trips = await this.listMileageTrips(siteId, month);
    return summarizeMonthlyMileage(trips, individualIds);
  }

  /** Trips for one home across all time, oldest first (continuity + yearly rollups). */
  private siteMileageTrips(session: { agencyId: string }, siteId: string) {
    return this.mileageRows()
      .filter((row) => row.agencyId === session.agencyId && row.siteId === siteId)
      .sort((a, b) =>
        a.tripDate !== b.tripDate
          ? a.tripDate < b.tripDate
            ? -1
            : 1
          : a.createdAt < b.createdAt
            ? -1
            : 1,
      );
  }

  async getLastMileageOdometerEnd(siteId: string): Promise<number | null> {
    const { getLastOdometerEnd } = await this.p7lib();
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    this.siteOrThrow(session, siteId);
    return getLastOdometerEnd(this.siteMileageTrips(session, siteId));
  }

  async getPreviousMileageOdometerEnd(
    siteId: string,
    tripId: string,
  ): Promise<number | null> {
    const { getPreviousOdometerEnd } = await this.p7lib();
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    this.siteOrThrow(session, siteId);
    return getPreviousOdometerEnd(this.siteMileageTrips(session, siteId), tripId);
  }

  async getMileageYearlySummary(
    siteId: string,
    year: number,
    individualIds: string[],
  ): Promise<import("./mileage").MileageYearlySummary> {
    const { summarizeYearlyMileage, assertCanViewMileageYearlySummary } = await this.p7lib();
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    assertCanViewMileageYearlySummary(session);
    this.siteOrThrow(session, siteId);
    return summarizeYearlyMileage(
      this.siteMileageTrips(session, siteId),
      individualIds,
      year,
    );
  }

  async getMileageYearlySummaryAllSites(
    year: number,
    sites: Array<{ siteId: string; siteName: string; individualIds: string[] }>,
  ): Promise<import("./mileage").MileageAgencyYearlySummary> {
    const { summarizeAgencyYearlyMileage, assertCanViewMileageYearlySummary } =
      await this.p7lib();
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    assertCanViewMileageYearlySummary(session);
    const tripsBySite = new Map<string, import("./types").MileageTrip[]>();
    for (const site of sites) {
      this.siteOrThrow(session, site.siteId);
      tripsBySite.set(site.siteId, this.siteMileageTrips(session, site.siteId));
    }
    return summarizeAgencyYearlyMileage(tripsBySite, sites, year);
  }

  // ===== SITE DETAIL API (program-site detail view, read-focused) =====
  async listQaAuditHistory(siteId: string): Promise<QaAuditSummary[]> {
    return (await this.listQaAudits({ siteId })).map((audit) => ({
      id: audit.id, year: audit.year, quarter: audit.quarter,
      status: audit.status, auditorName: audit.auditorName ?? "",
      signedAt: audit.signedAt, createdAt: audit.createdAt, scoreJson: audit.score,
    }));
  }

  /** The log is one unbroken chain: a new trip's start must continue the latest end. */
  private async assertOdometerContinuity(
    session: { agencyId: string },
    siteId: string,
    odometerStart: number,
    excludeTripId?: string,
  ) {
    const { validateOdometerContinuity, getLastOdometerEnd, getPreviousOdometerEnd } =
      await this.p7lib();
    const trips = this.siteMileageTrips(session, siteId);
    const expected =
      excludeTripId === undefined
        ? getLastOdometerEnd(trips)
        : getPreviousOdometerEnd(trips, excludeTripId);
    const problem = validateOdometerContinuity(odometerStart, expected);
    if (problem) throw new Error(problem);
  }

  /**
   * Resolve the backfill request on a trip write: only administrators,
   * compliance administrators, and house managers may bypass continuity.
   * Returns whether this write is a backfill.
   */
  private async resolveBackfill(
    session: SessionUser,
    backfill: boolean | undefined,
  ): Promise<boolean> {
    if (backfill !== true) return false;
    const { assertCanBackfillMileage } = await this.p7lib();
    assertCanBackfillMileage(session);
    return true;
  }

  async addMileageTrip(
    input: import("./types").AddMileageTripInput,
  ): Promise<import("./types").MileageTrip> {
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    this.siteOrThrow(session, input.siteId);
    this.riderIndividualsOrThrow(session, input.siteId, input.riderIds);
    const valid = await this.validatedTripInput(input);
    const backfill = await this.resolveBackfill(session, input.backfill);
    if (!backfill) {
      await this.assertOdometerContinuity(session, input.siteId, valid.odometerStart);
    }
    const trip: import("./types").MileageTrip = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId: input.siteId,
      tripDate: valid.tripDate,
      odometerStart: valid.odometerStart,
      odometerEnd: valid.odometerEnd,
      miles: valid.miles,
      riderIds: [...new Set(valid.riderIds)],
      reason: valid.reason.trim(),
      backfilled: backfill,
      driverName: valid.driverName.trim(),
      signatureName: input.signatureName.trim(),
      createdBy: session.userId,
      createdAt: new Date().toISOString(),
    };
    this.mileageRows().unshift(trip);
    log(
      this.store,
      session,
      "mileage.trip_added",
      `${session.fullName} logged a ${trip.miles}-mile trip on ${trip.tripDate} (${trip.reason || "no reason given"})${backfill ? " [backfilled]" : ""}`,
      "mileage_trip",
      trip.id,
    );
    await persistMeta(this.store);
    return trip;
  }

  async updateMileageTrip(
    tripId: string,
    patch: import("./types").UpdateMileageTripInput,
  ): Promise<import("./types").MileageTrip> {
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    const trip = this.findMileageTrip(session, tripId);
    const nextRiders = patch.riderIds ?? trip.riderIds;
    this.riderIndividualsOrThrow(session, trip.siteId, nextRiders);
    const valid = await this.validatedTripInput(patch, trip);
    const backfill = (await this.resolveBackfill(session, patch.backfill)) || trip.backfilled;
    // A trip already marked backfilled stays exempt from the chain: it was
    // knowingly logged out of sequence by an authorized backfiller, so later
    // edits (reason, driver, …) must not be forced back into continuity.
    if (!backfill) {
      await this.assertOdometerContinuity(
        session,
        trip.siteId,
        valid.odometerStart,
        trip.id,
      );
    }
    Object.assign(trip, {
      tripDate: valid.tripDate,
      odometerStart: valid.odometerStart,
      odometerEnd: valid.odometerEnd,
      miles: valid.miles,
      riderIds: [...new Set(valid.riderIds)],
      reason: valid.reason.trim(),
      backfilled: backfill,
      driverName: valid.driverName.trim(),
      signatureName: (patch.signatureName ?? trip.signatureName).trim(),
    });
    log(
      this.store,
      session,
      "mileage.trip_updated",
      `${session.fullName} updated the ${trip.tripDate} mileage trip (${trip.miles} miles)`,
      "mileage_trip",
      trip.id,
    );
    await persistMeta(this.store);
    return trip;
  }

  async deleteMileageTrip(tripId: string): Promise<void> {
    const session = assertSession(this.store);
    this.assertMileageAccess(session);
    const rows = this.mileageRows();
    const index = rows.findIndex(
      (row) => row.id === tripId && row.agencyId === session.agencyId,
    );
    if (index === -1) throw new Error("Mileage trip not found.");
    const [removed] = rows.splice(index, 1);
    log(
      this.store,
      session,
      "mileage.trip_deleted",
      `${session.fullName} removed the ${removed.tripDate} mileage trip (${removed.miles} miles)`,
      "mileage_trip",
      removed.id,
    );
    await persistMeta(this.store);
  }

  // ===== E-SIGNATURES (local) =====

  private sigCollections(): {
    userSignatures: UserSignature[];
    signatureEvents: SignatureEvent[];
    agencySignatureSettings: Record<string, SignatureSettings>;
    signatureAuditLog: SignatureAuditRecord[];
  } {
    const db = this.store.db as unknown as {
      userSignatures?: UserSignature[];
      signatureEvents?: SignatureEvent[];
      agencySignatureSettings?: Record<string, SignatureSettings>;
      signatureAuditLog?: SignatureAuditRecord[];
    };
    db.userSignatures ??= [];
    db.signatureEvents ??= [];
    db.agencySignatureSettings ??= {};
    db.signatureAuditLog ??= [];
    return db as {
      userSignatures: UserSignature[];
      signatureEvents: SignatureEvent[];
      agencySignatureSettings: Record<string, SignatureSettings>;
      signatureAuditLog: SignatureAuditRecord[];
    };
  }

  /**
   * A document is locked once a whole-document SIGNATURE event exists for it
   * (staff_sign / hm_countersign / rn_signature / hm_signature / staff_ack) —
   * content edits are rejected with a correction-pointer message. Per-line
   * training initials (`line:<requirementId>:v<n>`) never lock the sheet:
   * every line must be initialable while its siblings already carry stamps.
   * Further SIGNATURES on other fields are still allowed (multi-signature
   * documents).
   */
  private async assertDocumentUnlocked(
    documentType: SignableDocumentType,
    documentId: string,
  ): Promise<void> {
    const events = await this.getSignatureEvents(documentType, documentId);
    const locking = events.filter((event) => !event.fieldName.startsWith("line:"));
    if (locking.length > 0) {
      const first = [...locking].sort((a, b) =>
        a.signedAt.localeCompare(b.signedAt),
      )[0];
      throw new Error(
        `Document is locked — signed on ${formatSignatureDate(first.signedAt)}. Request a correction to amend.`,
      );
    }
  }

  async getMySignature(): Promise<AdoptedSignature | null> {
    const session = assertSession(this.store);
    const row = this.sigCollections().userSignatures.find(
      (item) => item.userId === session.userId && item.agencyId === session.agencyId,
    );
    if (!row) return null;
    return {
      signaturePath: row.signaturePath,
      initialsPath: row.initialsPath,
      adoptedAt: row.adoptedAt,
      consentAt: row.consentAt,
      consentTextVersion: row.consentTextVersion,
    };
  }

  async adoptSignature(input: AdoptSignatureInput): Promise<AdoptedSignature> {
    const session = assertSession(this.store);
    if (!input.consentGiven) {
      throw new Error(
        "You must consent to electronic records and signatures before adopting.",
      );
    }
    if (!input.consentTextVersion?.trim()) {
      throw new Error("A consent text version is required.");
    }
    assertAdoptableSignature("Signature", input.signatureDataUrl);
    assertAdoptableSignature("Initials", input.initialsDataUrl);
    const now = new Date().toISOString();
    const signaturePath = `${session.userId}/signature.png`;
    const initialsPath = `${session.userId}/initials.png`;
    const sigFile = new File(
      [dataUrlToBlob(input.signatureDataUrl)],
      "signature.png",
      { type: "image/png" },
    );
    const iniFile = new File(
      [dataUrlToBlob(input.initialsDataUrl)],
      "initials.png",
      { type: "image/png" },
    );
    this.store.files.set(signaturePath, {
      mime: "image/png",
      bytes: await sigFile.arrayBuffer(),
    });
    this.store.files.set(initialsPath, {
      mime: "image/png",
      bytes: await iniFile.arrayBuffer(),
    });
    await persistFile(signaturePath, sigFile);
    await persistFile(initialsPath, iniFile);
    const record: UserSignature = {
      userId: session.userId,
      agencyId: session.agencyId,
      signaturePath,
      initialsPath,
      adoptedAt: now,
      consentAt: now,
      consentTextVersion: input.consentTextVersion.trim(),
    };
    const coll = this.sigCollections();
    const existing = coll.userSignatures.find(
      (row) => row.userId === session.userId,
    );
    if (existing) Object.assign(existing, record);
    else coll.userSignatures.push(record);
    log(
      this.store,
      session,
      "signature.adopted",
      `${session.fullName} adopted an electronic signature (consent ${record.consentTextVersion})`,
      "user_signature",
      session.userId,
    );
    await persistMeta(this.store);
    return {
      signaturePath: record.signaturePath,
      initialsPath: record.initialsPath,
      adoptedAt: record.adoptedAt,
      consentAt: record.consentAt,
      consentTextVersion: record.consentTextVersion,
    };
  }

  async applySignature(
    input: ApplySignatureInput,
  ): Promise<ApplySignatureResult> {
    const session = assertSession(this.store);
    const { documentType, documentId, fieldName, kind, documentPayload } = input;
    if (kind !== "signature" && kind !== "initials") {
      throw new Error("Unknown signature kind.");
    }
    const validTypes: SignableDocumentType[] = [
      "delegation_form",
      "training_checklist",
      "hm_checklist",
      "certificate",
    ];
    if (!validTypes.includes(documentType)) {
      throw new Error("Unknown document type.");
    }
    const field = fieldName.trim();
    if (!field) throw new Error("A signature field is required.");
    if (
      !documentPayload ||
      typeof documentPayload !== "object" ||
      Array.isArray(documentPayload)
    ) {
      throw new Error("A document payload is required.");
    }
    const adopted = this.sigCollections().userSignatures.find(
      (row) => row.userId === session.userId && row.agencyId === session.agencyId,
    );
    if (!adopted) {
      throw new Error("Adopt your electronic signature before signing.");
    }
    if (!adopted.consentAt) {
      throw new Error(
        "Electronic-signature consent is required before signing.",
      );
    }
    // 13 CSR 65-3.050 second identification component: even an adopted user
    // may only affix a signature/initials with a fresh password re-entry on
    // top of the session. The hosted edge function enforces the same gate
    // server-side.
    this.assertFreshReauth(session);
    const coll = this.sigCollections();
    const duplicate = coll.signatureEvents.find(
      (row) =>
        row.agencyId === session.agencyId &&
        row.documentType === documentType &&
        row.documentId === documentId &&
        row.fieldName === field,
    );
    if (duplicate) {
      throw new Error("This field has already been signed.");
    }
    // Domain state change with the SESSION user as the only possible signer.
    await this.applySignatureDomain(session, { ...input, fieldName: field });
    const documentHash = await signatureDocumentHash(
      documentType,
      documentId,
      field,
      documentPayload,
    );
    const now = new Date().toISOString();
    const event: SignatureEvent = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      userId: session.userId,
      signerName: session.fullName,
      documentType,
      documentId,
      fieldName: field,
      kind,
      documentHash,
      signedAt: now,
    };
    coll.signatureEvents.push(event);
    log(
      this.store,
      session,
      "signature.applied",
      `${session.fullName} signed ${documentType} field "${field}" (${kind})`,
      "signature_event",
      event.id,
    );
    // 13 CSR 65-3.050 audit trail: every applied signature is recorded with
    // the device identifier (mirrors the hosted signature_audit_log row).
    this.pushSignatureAudit(session, "sign_applied", {
      documentType,
      documentId,
      fieldName: field,
      details: { kind },
    });
    await persistMeta(this.store);
    return { eventId: event.id, signedAt: now, documentHash };
  }

  /**
   * 13 CSR 65-3.050: the password re-entry that authorizes a signing session.
   * Local/demo path — the credential check is the same one signIn uses; the
   * hosted path verifies against the Auth API inside the edge function.
   */
  async verifySigningPassword(password: string): Promise<{ reauthAt: string }> {
    const session = assertSession(this.store);
    const credential = this.store.db.credentials.find(
      (row) => row.userId === session.userId,
    );
    if (!credential || credential.password !== password) {
      this.pushSignatureAudit(session, "reauth_failed", {
        details: { reason: "bad_password" },
      });
      await persistMeta(this.store);
      throw new Error("That password is not correct.");
    }
    const reauthAt = new Date().toISOString();
    this.store.signingReauthAt.set(session.userId, reauthAt);
    this.pushSignatureAudit(session, "reauth_success", {});
    await persistMeta(this.store);
    return { reauthAt };
  }

  /** Throw unless the session user re-entered their password recently. */
  private assertFreshReauth(session: SessionUser): void {
    const at = this.store.signingReauthAt.get(session.userId);
    if (!at || Date.now() - new Date(at).getTime() > REAUTH_WINDOW_MS) {
      throw new ReauthRequiredError();
    }
  }

  async logSignatureAudit(input: LogSignatureAuditInput): Promise<void> {
    const session = assertSession(this.store);
    this.pushSignatureAudit(session, input.action, {
      documentType: input.documentType,
      documentId: input.documentId,
      fieldName: input.fieldName,
      details: input.details,
    });
    await persistMeta(this.store);
  }

  async getSignatureAuditLog(input?: {
    documentType?: SignableDocumentType;
    documentId?: string;
  }): Promise<SignatureAuditRecord[]> {
    const session = assertSession(this.store);
    return this.sigCollections()
      .signatureAuditLog.filter(
        (row) =>
          row.agencyId === session.agencyId &&
          row.userId === session.userId &&
          (!input?.documentType || row.documentType === input.documentType) &&
          (!input?.documentId || row.documentId === input.documentId),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Append one row to the local 13 CSR 65-3.050 audit collection. */
  private pushSignatureAudit(
    session: SessionUser,
    action: string,
    extra: {
      documentType?: SignableDocumentType;
      documentId?: string;
      fieldName?: string;
      details?: Record<string, unknown>;
    } = {},
  ): void {
    this.sigCollections().signatureAuditLog.push({
      id: crypto.randomUUID(),
      userId: session.userId,
      agencyId: session.agencyId,
      action,
      documentType: extra.documentType ?? null,
      documentId: extra.documentId ?? null,
      fieldName: extra.fieldName ?? null,
      createdAt: new Date().toISOString(),
      deviceId: getDeviceId(),
      ipAddress: null,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null,
      details: extra.details ?? null,
    });
  }

  /**
   * Routes an applySignature call to the existing domain mutation, fixing the
   * signer to the session user. Mirrors what the hosted `apply-signature`
   * edge function does server-side.
   */
  private async applySignatureDomain(
    session: SessionUser,
    input: ApplySignatureInput,
  ): Promise<void> {
    const { documentType, documentId, fieldName } = input;
    if (documentType === "delegation_form") {
      if (fieldName === "rn_signature") {
        await this.signDelegationRn(
          documentId,
          session.fullName,
          ADOPTED_SIGNATURE_MARK,
        );
        return;
      }
      if (fieldName.startsWith("row:") && fieldName.endsWith(":initials")) {
        // Per-row initials (the paper roster's "Initials" column): keyed by
        // the staff member's printed name, never the mutable array index.
        const item = this.delegationItem(this.store, session, documentId);
        const rowIndex =
          item.delegationForm?.roster.findIndex(
            (r) => delegationRosterRowKey(r.printName) === fieldName,
          ) ?? -1;
        if (rowIndex < 0) throw new Error("Roster row not found.");
        await this.initialDelegationRow({
          obligationId: documentId,
          rowIndex,
          initials: suggestInitials(session.fullName),
        });
        return;
      }
      if (fieldName.startsWith("row:")) {
        const rowIndex = Number(fieldName.slice(4));
        if (!Number.isInteger(rowIndex) || rowIndex < 0) {
          throw new Error("Unknown signature field.");
        }
        // Only your own row: unnamed rows may be claimed, named rows only by
        // the person named on them.
        const item = this.delegationItem(this.store, session, documentId);
        const row = item.delegationForm?.roster[rowIndex];
        if (!row) throw new Error("Roster row not found.");
        const named = row.printName.trim();
        if (
          named &&
          named.toLowerCase() !== session.fullName.trim().toLowerCase()
        ) {
          throw new Error(`Only ${named} can sign this row.`);
        }
        await this.signDelegationRow({
          obligationId: documentId,
          rowIndex,
          signatureName: session.fullName,
          signatureMark: ADOPTED_SIGNATURE_MARK,
          initials: suggestInitials(session.fullName),
        });
        return;
      }
      throw new Error("Unknown signature field.");
    }
    if (documentType === "training_checklist") {
      // Per-line e-initials (kind "initials"). The UI calls
      // initialRequirementLine FIRST, which writes the signoff row; the
      // signature event is the tamper-evident stamp on top. Here we only
      // verify the field addresses a real, current-version, non-N/A signoff
      // on this document — no further domain change is needed.
      const lineMatch = /^line:(.+):v(\d+)$/.exec(fieldName);
      if (lineMatch) {
        if (!documentId.startsWith("staff:")) throw new Error("Unknown document.");
        const [, userId, siteId] = documentId.split(":");
        if (!userId || !siteId) throw new Error("Unknown document.");
        const requirementId = lineMatch[1];
        const version = Number(lineMatch[2]);
        const requirement = this.p2Collections().trainingRequirements.find(
          (row) =>
            row.agencyId === session.agencyId &&
            row.id === requirementId &&
            row.userId === userId &&
            (row.siteId ?? "") === siteId,
        );
        if (!requirement) throw new Error("Unknown signature field.");
        // 13 CSR 65-3.050 attribution: ONLY the assigned staff member may
        // initial their own training lines. No HR/admin override — a signature
        // must be executed by the individual it is attributed to. (The hosted
        // edge function enforces the same rule server-side.)
        if (session.userId !== requirement.userId) {
          throw new Error(
            "Only the assigned staff member can initial their own training lines.",
          );
        }
        const signoff = this.p2SignoffFor(requirementId);
        if (!signoff || signoff.na) {
          throw new Error("This line has no matching sign-off to initial.");
        }
        if ((signoff.signoffVersion ?? 1) !== version) {
          // Versioned field names (line:<id>:v<n>): a newer sign-off version
          // supersedes the one this field was computed from, so the stamp is
          // stale — the signer must review the current line and initial it
          // again. Mirrors the hosted stale_version (409) code.
          throw new Error(
            "This line was changed after you opened it (stale version) — review the current line and initial it again.",
          );
        }
        // A whole-document end signature still freezes per-line stamping.
        await this.assertDocumentUnlocked("training_checklist", documentId);
        return;
      }
      const role =
        fieldName === "staff_sign"
          ? "staff"
          : fieldName === "hm_countersign"
            ? "hm"
            : null;
      if (!role) throw new Error("Unknown signature field.");
      if (documentId.startsWith("staff:")) {
        const [, userId, siteId] = documentId.split(":");
        if (!userId || !siteId) throw new Error("Unknown document.");
        await this.signStaffChecklist({
          userId,
          siteId,
          role,
          signatureName: session.fullName,
          signatureMark: ADOPTED_SIGNATURE_MARK,
        });
        return;
      }
      if (documentId.startsWith("checklist:")) {
        const checklistId = documentId.slice("checklist:".length);
        if (!checklistId) throw new Error("Unknown document.");
        await this.signTrainingChecklist(checklistId, role, session.fullName, {
          signatureMark: ADOPTED_SIGNATURE_MARK,
        });
        return;
      }
      throw new Error("Unknown document.");
    }
    if (documentType === "hm_checklist") {
      if (fieldName !== "hm_signature") {
        throw new Error("Unknown signature field.");
      }
      await this.submitWeeklyChecklist(documentId, session.fullName);
      return;
    }
    if (documentType === "certificate") {
      if (fieldName !== "staff_ack") throw new Error("Unknown signature field.");
      // The event itself is the acknowledgment; the certificate row is unchanged.
      const cert = this.store.db.certificates.find(
        (row) => row.id === documentId && row.agencyId === session.agencyId,
      );
      if (!cert) throw new Error("Certificate not found.");
      if (cert.userId !== session.userId) {
        throw new Error("Only the certificate holder can acknowledge it.");
      }
      return;
    }
    throw new Error("Unknown document type.");
  }

  async getSignatureEvents(
    documentType: SignableDocumentType,
    documentId: string,
  ): Promise<SignatureEvent[]> {
    const session = assertSession(this.store);
    return this.sigCollections()
      .signatureEvents.filter(
        (row) =>
          row.agencyId === session.agencyId &&
          row.documentType === documentType &&
          row.documentId === documentId,
      )
      .sort((a, b) => a.signedAt.localeCompare(b.signedAt));
  }

  async getSignatureImageUrl(path: string): Promise<string> {
    const session = assertSession(this.store);
    const ownerId = path.split("/")[0];
    const owner = this.store.db.profiles.find((row) => row.id === ownerId);
    if (!owner || owner.homeAgencyId !== session.agencyId) {
      throw new Error("Signature image not found.");
    }
    const blob = await readStoredFile(this.store, path);
    if (!blob || blob.size === 0) throw new Error("Signature image not found.");
    return blobToDataUrl(blob);
  }

  async getSignatureSettings(): Promise<SignatureSettings> {
    const session = assertSession(this.store);
    return (
      this.sigCollections().agencySignatureSettings[session.agencyId] ?? {
        allowDraw: true,
        allowType: true,
        allowUpload: true,
      }
    );
  }

  async updateSignatureSettings(
    input: SignatureSettings,
  ): Promise<SignatureSettings> {
    const session = assertSession(this.store);
    if (session.roleKey !== "administrator" && session.role !== "administrator") {
      throw new Error("Only an administrator can change signature settings.");
    }
    const next: SignatureSettings = {
      allowDraw: Boolean(input.allowDraw),
      allowType: Boolean(input.allowType),
      allowUpload: Boolean(input.allowUpload),
    };
    if (!next.allowDraw && !next.allowType && !next.allowUpload) {
      throw new Error("Keep at least one adoption method on.");
    }
    this.sigCollections().agencySignatureSettings[session.agencyId] = next;
    log(
      this.store,
      session,
      "signature.settings_updated",
      `${session.fullName} updated the signature adoption methods`,
      "agency",
      session.agencyId,
    );
    await persistMeta(this.store);
    return next;
  }

  // ======================================================================
  // RECOGNITION (winners-only)
  // ======================================================================

  private recognitionName(userId: string): string {
    return (
      this.store.db.profiles.find((p) => p.id === userId)?.fullName ??
      "Staff member"
    );
  }

  private activeMembership(userId: string, roleKey: string, today: string) {
    return this.store.db.memberships.find(
      (m) =>
        m.userId === userId &&
        m.roleKey === roleKey &&
        (!m.expiresOn || m.expiresOn >= today),
    );
  }

  /** Two members are "assigned together" when they share an active site. */
  private shareActiveSite(userA: string, userB: string): boolean {
    const db = this.store.db;
    const today = new Date().toISOString().slice(0, 10);
    const activeAsg = (a: { startsOn: string; endsOn: string | null }) =>
      a.startsOn <= today && (!a.endsOn || a.endsOn >= today);
    const sitesA = new Set(
      db.memberships
        .filter(
          (m) =>
            m.userId === userA &&
            m.siteId &&
            (!m.expiresOn || m.expiresOn >= today),
        )
        .map((m) => m.siteId as string),
    );
    // Active staff_assignments also count as a shared assignment.
    for (const a of db.assignments) {
      if (a.userId === userA && a.siteId && activeAsg(a)) {
        sitesA.add(a.siteId);
      }
    }
    if (sitesA.size === 0) return false;
    return (
      db.memberships.some(
        (m) =>
          m.userId === userB &&
          m.siteId &&
          sitesA.has(m.siteId) &&
          (!m.expiresOn || m.expiresOn >= today),
      ) ||
      db.assignments.some(
        (a) =>
          a.userId === userB && a.siteId && sitesA.has(a.siteId) && activeAsg(a),
      )
    );
  }

  private pushRecognitionNotification(input: {
    agencyId: string;
    userId: string | null;
    roleKey: string | null;
    type: string;
    title: string;
    body: string;
    deepLink: string;
    entityType: string | null;
    entityId: string | null;
    dedupeKey: string;
  }) {
    const db = this.store.db;
    // Idempotent: the same event never queues twice.
    if (db.notifications.some((n) => n.dedupeKey === input.dedupeKey)) return;
    db.notifications.push({
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
      readAt: null,
    });
  }

  private ratingHistoryFor(
    rows: { id: string; parentId: string; oldRating: number | null; newRating: number; changedBy: string; createdAt: string }[],
    parentId: string,
  ): import("../recognition/recognition").RatingHistoryEntry[] {
    return rows
      .filter((h) => h.parentId === parentId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((h) => ({
        id: h.id,
        oldRating: h.oldRating,
        newRating: h.newRating,
        changedBy: h.changedBy,
        changedByName: this.recognitionName(h.changedBy),
        createdAt: h.createdAt,
      }));
  }

  async submitDspHmRating(input: {
    hmUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").DspHmRating> {
    const session = assertSession(this.store);
    assertCan(session, "recognition.rate_hm");
    if (session.roleKey !== "dsp") {
      throw new Error("Only direct support professionals rate house managers.");
    }
    if (!isValidRating(input.rating)) {
      throw new Error("Rating must be a whole number from 1 to 5.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const hm = this.activeMembership(input.hmUserId, "house_manager", today);
    if (!hm || hm.agencyId !== session.agencyId) {
      throw new Error("That house manager was not found.");
    }
    if (input.hmUserId === session.userId) {
      throw new Error("You cannot rate yourself.");
    }
    if (!this.shareActiveSite(session.userId, input.hmUserId)) {
      throw new Error("You can only rate the house manager of your assigned site.");
    }
    const db = this.store.db;
    const now = new Date().toISOString();
    let row = db.dspHmRatings.find(
      (r) =>
        r.agencyId === session.agencyId &&
        r.dspId === session.userId &&
        r.hmId === input.hmUserId,
    );
    if (row && row.rating === input.rating) return row; // no change: no history, no notification
    const oldRating = row?.rating ?? null;
    if (row) {
      row.rating = input.rating;
      row.updatedAt = now;
    } else {
      row = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        dspId: session.userId,
        hmId: input.hmUserId,
        rating: input.rating,
        updatedAt: now,
      };
      db.dspHmRatings.push(row);
    }
    // Append-only history (mirrors the hosted trigger).
    const historyId = crypto.randomUUID();
    db.dspHmRatingHistory.push({
      id: historyId,
      parentId: row.id,
      agencyId: session.agencyId,
      oldRating,
      newRating: input.rating,
      changedBy: session.userId,
      createdAt: now,
    });
    // The reviewed HM is notified (dedupe per history row).
    const payload = dspRatingChangedPayload({
      agencyId: session.agencyId,
      hmUserId: input.hmUserId,
      historyId,
      ratingId: row.id,
      dspName: session.fullName,
      rating: input.rating,
      ratingLabel: ratingLabel(input.rating),
    });
    this.pushRecognitionNotification({
      agencyId: payload.agencyId,
      userId: payload.userId ?? null,
      roleKey: payload.roleKey ?? null,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      dedupeKey: payload.dedupeKey ?? `rating.changed:${historyId}`,
    });
    await persistMeta(this.store);
    return row;
  }

  async getMyDspHmRating(
    hmUserId: string,
  ): Promise<import("../recognition/recognition").DspHmRating | null> {
    const session = assertSession(this.store);
    return (
      this.store.db.dspHmRatings.find(
        (r) =>
          r.agencyId === session.agencyId &&
          r.dspId === session.userId &&
          r.hmId === hmUserId,
      ) ?? null
    );
  }

  async listDspHmRatingsAboutMe(): Promise<
    import("../recognition/recognition").DspHmRatingWithHistory[]
  > {
    const session = assertSession(this.store);
    return this.store.db.dspHmRatings
      .filter(
        (r) => r.agencyId === session.agencyId && r.hmId === session.userId,
      )
      .map((r) => ({
        ...r,
        hmName: this.recognitionName(r.hmId),
        dspName: this.recognitionName(r.dspId),
        history: this.ratingHistoryFor(this.store.db.dspHmRatingHistory, r.id),
      }));
  }

  async submitHmDspReview(input: {
    dspUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").HmDspReview> {
    const session = assertSession(this.store);
    assertCan(session, "recognition.review_dsp");
    if (session.roleKey !== "house_manager") {
      throw new Error("Only house managers review DSPs.");
    }
    if (!isValidRating(input.rating)) {
      throw new Error("Rating must be a whole number from 1 to 5.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const dsp = this.activeMembership(input.dspUserId, "dsp", today);
    if (!dsp || dsp.agencyId !== session.agencyId) {
      throw new Error("That DSP was not found.");
    }
    if (input.dspUserId === session.userId) {
      throw new Error("You cannot review yourself.");
    }
    if (!this.shareActiveSite(session.userId, input.dspUserId)) {
      throw new Error("You can only review DSPs at your assigned site.");
    }
    const db = this.store.db;
    const now = new Date().toISOString();
    let row = db.hmDspReviews.find(
      (r) =>
        r.agencyId === session.agencyId &&
        r.hmId === session.userId &&
        r.dspId === input.dspUserId,
    );
    if (row && row.rating === input.rating) return row;
    const oldRating = row?.rating ?? null;
    if (row) {
      row.rating = input.rating;
      row.updatedAt = now;
    } else {
      row = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        hmId: session.userId,
        dspId: input.dspUserId,
        rating: input.rating,
        updatedAt: now,
      };
      db.hmDspReviews.push(row);
    }
    const historyId = crypto.randomUUID();
    db.hmDspReviewHistory.push({
      id: historyId,
      parentId: row.id,
      agencyId: session.agencyId,
      oldRating,
      newRating: input.rating,
      changedBy: session.userId,
      createdAt: now,
    });
    const payload = hmReviewChangedPayload({
      agencyId: session.agencyId,
      dspUserId: input.dspUserId,
      historyId,
      reviewId: row.id,
      hmName: session.fullName,
      rating: input.rating,
      ratingLabel: ratingLabel(input.rating),
    });
    this.pushRecognitionNotification({
      agencyId: payload.agencyId,
      userId: payload.userId ?? null,
      roleKey: payload.roleKey ?? null,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      dedupeKey: payload.dedupeKey ?? `review.changed:${historyId}`,
    });
    await persistMeta(this.store);
    return row;
  }

  async getMyHmDspReview(
    dspUserId: string,
  ): Promise<import("../recognition/recognition").HmDspReview | null> {
    const session = assertSession(this.store);
    return (
      this.store.db.hmDspReviews.find(
        (r) =>
          r.agencyId === session.agencyId &&
          r.hmId === session.userId &&
          r.dspId === dspUserId,
      ) ?? null
    );
  }

  async listHmDspReviewsAboutMe(): Promise<
    import("../recognition/recognition").HmDspReviewWithHistory[]
  > {
    const session = assertSession(this.store);
    return this.store.db.hmDspReviews
      .filter(
        (r) => r.agencyId === session.agencyId && r.dspId === session.userId,
      )
      .map((r) => ({
        ...r,
        hmName: this.recognitionName(r.hmId),
        dspName: this.recognitionName(r.dspId),
        history: this.ratingHistoryFor(this.store.db.hmDspReviewHistory, r.id),
      }));
  }

  private canSeeRecognitionFeedback(session: SessionUser): boolean {
    return (
      hasPermission(session, "recognition.manage") ||
      session.roleKey === "degreed_professional_manager" ||
      session.roleKey === "program_manager"
    );
  }

  async listRecognitionFeedback(): Promise<
    import("../recognition/recognition").RecognitionFeedback
  > {
    const session = assertSession(this.store);
    if (!this.canSeeRecognitionFeedback(session)) {
      throw new Error("You do not have permission to do that.");
    }
    const db = this.store.db;
    const today = new Date().toISOString().slice(0, 10);
    // "Appropriate managers": administrators see the whole agency; other
    // managers see only pairs they share an active site with.
    const isAgencyAdmin =
      session.roleKey === "administrator" ||
      session.roleKey === "compliance_admin";
    const activeAsg = (a: { startsOn: string; endsOn: string | null }) =>
      a.startsOn <= today && (!a.endsOn || a.endsOn >= today);
    const sitesOf = (userId: string): Set<string> => {
      const sites = new Set<string>();
      for (const m of db.memberships) {
        if (
          m.agencyId === session.agencyId &&
          m.userId === userId &&
          m.siteId &&
          (!m.expiresOn || m.expiresOn >= today)
        ) {
          sites.add(m.siteId);
        }
      }
      for (const a of db.assignments) {
        if (
          a.agencyId === session.agencyId &&
          a.userId === userId &&
          a.siteId &&
          activeAsg(a)
        ) {
          sites.add(a.siteId);
        }
      }
      return sites;
    };
    const managerSites = isAgencyAdmin ? null : sitesOf(session.userId);
    const visible = (a: string, b: string): boolean => {
      if (!managerSites) return true;
      for (const id of [a, b]) {
        for (const s of sitesOf(id)) {
          if (managerSites.has(s)) return true;
        }
      }
      return false;
    };
    return {
      dspRatings: db.dspHmRatings
        .filter(
          (r) =>
            r.agencyId === session.agencyId && visible(r.dspId, r.hmId),
        )
        .map((r) => ({
          ...r,
          hmName: this.recognitionName(r.hmId),
          dspName: this.recognitionName(r.dspId),
          history: this.ratingHistoryFor(db.dspHmRatingHistory, r.id),
        })),
      hmReviews: db.hmDspReviews
        .filter(
          (r) =>
            r.agencyId === session.agencyId && visible(r.hmId, r.dspId),
        )
        .map((r) => ({
          ...r,
          hmName: this.recognitionName(r.hmId),
          dspName: this.recognitionName(r.dspId),
          history: this.ratingHistoryFor(db.hmDspReviewHistory, r.id),
        })),
    };
  }

  async listRecognitionPartners(): Promise<
    Array<{ userId: string; fullName: string; roleKey: string }>
  > {
    const session = assertSession(this.store);
    const counterpart =
      session.roleKey === "dsp"
        ? "house_manager"
        : session.roleKey === "house_manager"
          ? "dsp"
          : null;
    if (!counterpart) return [];
    const db = this.store.db;
    const today = new Date().toISOString().slice(0, 10);
    const activeAsg = (a: { startsOn: string; endsOn: string | null }) =>
      a.startsOn <= today && (!a.endsOn || a.endsOn >= today);
    const roleOf = (userId: string) =>
      db.memberships.find(
        (m) =>
          m.agencyId === session.agencyId &&
          m.userId === userId &&
          (!m.expiresOn || m.expiresOn >= today),
      )?.roleKey;
    const partners = new Map<string, string>();
    const consider = (userId: string) => {
      if (userId === session.userId || partners.has(userId)) return;
      if (roleOf(userId) !== counterpart) return;
      if (!this.shareActiveSite(session.userId, userId)) return;
      partners.set(userId, this.recognitionName(userId));
    };
    for (const m of db.memberships) {
      if (
        m.agencyId === session.agencyId &&
        m.siteId &&
        (!m.expiresOn || m.expiresOn >= today)
      ) {
        consider(m.userId);
      }
    }
    // Counterparts placed by active staff_assignments (role from membership).
    for (const a of db.assignments) {
      if (a.agencyId === session.agencyId && a.siteId && activeAsg(a)) {
        consider(a.userId);
      }
    }
    return [...partners.entries()]
      .map(([userId, fullName]) => ({ userId, fullName, roleKey: counterpart }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listRecognitionWinners(input?: {
    limit?: number;
  }): Promise<import("../recognition/recognition").PublicRecognitionWinner[]> {
    const session = assertSession(this.store);
    const limit = Math.max(1, Math.min(52, input?.limit ?? 12));
    return this.store.db.recognitionWinners
      .filter((w) => w.agencyId === session.agencyId)
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
      .slice(0, limit)
      .map((w) => ({
        id: w.id,
        weekStart: w.weekStart,
        category: w.category,
        winnerName: this.recognitionName(w.winnerId),
        highlights: [...w.highlights],
        decidedAt: w.decidedAt,
      }));
  }

  /**
   * Local/demo weekly winner selection. Mirrors the hosted
   * select-weekly-winners edge function using the same pure scoring math;
   * idempotent per (week, category).
   */
  async runWeeklyRecognition(input?: {
    weekStart?: string;
  }): Promise<import("../recognition/recognition").WeeklyRecognitionResult> {
    const session = assertSession(this.store);
    if (!this.canSeeRecognitionFeedback(session)) {
      throw new Error("You do not have permission to do that.");
    }
    const db = this.store.db;
    const today = new Date().toISOString().slice(0, 10);
    const weekStart =
      input?.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)
        ? input.weekStart
        : defaultRecognitionWeekStart(new Date());
    const monthKey = weekStart.slice(0, 7);
    // Checklist weeks are Sunday-keyed; the recognition Monday's checklist
    // week is the Sunday just before it (due the following Monday 4pm).
    const checklistSunday = addDaysIso(weekStart, -1);
    const checklistCutoff = checklistDeadlineUtc(weekStart);
    const active = (roleKey: string) =>
      db.memberships.filter(
        (m) =>
          m.agencyId === session.agencyId &&
          m.roleKey === roleKey &&
          (!m.expiresOn || m.expiresOn >= today),
      );
    const hms = active("house_manager");
    const dsps = active("dsp");

    // --- HM inputs ---------------------------------------------------------
    const checklists = (
      (db as LocalDatabase & { weeklyChecklists?: HmWeeklyChecklist[] })
        .weeklyChecklists ?? []
    ).filter(
      (c) =>
        c.agencyId === session.agencyId &&
        (c.weekStart === weekStart ||
          (!c.weekStart && c.weekOf === checklistSunday)),
    );
    const satisfaction = new Map<string, number[]>();
    for (const r of db.dspHmRatings) {
      if (r.agencyId !== session.agencyId) continue;
      const list = satisfaction.get(r.hmId) ?? [];
      list.push(r.rating);
      satisfaction.set(r.hmId, list);
    }
    const due = DEFAULT_MONTHLY_DUE;
    const monthlyDueDate = (day: number) =>
      `${monthKey}-${String(Math.min(28, Math.max(1, day))).padStart(2, "0")}`;
    const staffAtSite = (siteId: string) =>
      db.memberships
        .filter(
          (m) =>
            m.agencyId === session.agencyId &&
            m.roleKey === "dsp" &&
            m.siteId === siteId &&
            (!m.expiresOn || m.expiresOn >= today),
        )
        .map((m) => m.userId);
    const siteCompliance = (siteId: string): number => {
      const staff = staffAtSite(siteId);
      if (staff.length === 0) return 0.5;
      let sum = 0;
      for (const id of staff) {
        const trainingLeg = db.trainingChecklists.some(
          (t) => t.staffUserId === id && t.staffSignedAt,
        )
          ? 1
          : 0;
        const certs = db.certificates.filter((c) => c.userId === id);
        const certLeg =
          certs.length === 0
            ? 0.5
            : certs.some((c) => c.expiresOn < today)
              ? 0
              : 1;
        sum += (trainingLeg + certLeg) / 2;
      }
      return sum / staff.length;
    };

    type Candidate = { id: string; fullName: string; score: number; breakdown: import("../recognition/scoring").HmBreakdown | import("../recognition/scoring").DspBreakdown };
    const hmCandidates: Candidate[] = hms.map((m) => {
      const lists = checklists.filter((c) => c.assignedToUserId === m.userId);
      const dueCount = lists.length;
      const onTime = lists.filter(
        (c) =>
          c.submittedAt && c.submittedAt <= (c.dueAt ?? checklistCutoff),
      ).length;
      let monthlyDueCount = 0;
      let monthlyOnTime = 0;
      const siteIds = m.siteId ? [m.siteId] : [];
      for (const siteId of siteIds) {
        monthlyDueCount += 1;
        const drill = db.emergencyDrills.find(
          (d) => d.siteId === siteId && d.monthKey === monthKey && d.date,
        );
        if (drill && (drill.date as string) <= monthlyDueDate(due.drillDay)) {
          monthlyOnTime += 1;
        }
        monthlyDueCount += 1;
        if (
          db.homeSafetyReports.some(
            (s) => s.siteId === siteId && s.monthKey === monthKey && s.lines.length > 0,
          )
        ) {
          monthlyOnTime += 1;
        }
        const siteEquipment = db.adaptiveEquipment.filter((e) =>
          db.individuals.some(
            (i) => i.id === e.individualId && i.siteId === siteId,
          ),
        );
        if (siteEquipment.length > 0) {
          monthlyDueCount += 1;
          const allOnTime = siteEquipment.every((e) => {
            const log = db.equipmentMonthLogs.find(
              (l) => l.equipmentId === e.id && l.monthKey === monthKey,
            );
            return (
              log?.checkedOn != null &&
              log.checkedOn <= monthlyDueDate(due.equipmentDay)
            );
          });
          if (allOnTime) monthlyOnTime += 1;
        }
      }
      const result = scoreHmWeek({
        weeklyChecklistsDue: dueCount,
        weeklyChecklistsOnTime: onTime,
        monthlyChecksDue: monthlyDueCount,
        monthlyChecksOnTime: monthlyOnTime,
        siteComplianceShare:
          siteIds.length > 0
            ? siteIds.reduce((a, s) => a + siteCompliance(s), 0) / siteIds.length
            : 0.5,
        dspSatisfactionAverage: rollingAverage(satisfaction.get(m.userId) ?? []),
      });
      return { id: m.userId, fullName: this.recognitionName(m.userId), score: result.score, breakdown: { ...result.breakdown } };
    });

    // --- DSP inputs ----------------------------------------------------------
    const hmReviewAvg = new Map<string, number[]>();
    for (const r of db.hmDspReviews) {
      if (r.agencyId !== session.agencyId) continue;
      const list = hmReviewAvg.get(r.dspId) ?? [];
      list.push(r.rating);
      hmReviewAvg.set(r.dspId, list);
    }
    const dspCandidates: Candidate[] = dsps.map((m) => {
      const lines = db.trainingChecklists
        .filter((t) => t.agencyId === session.agencyId && t.staffUserId === m.userId)
        .flatMap((t) => t.items);
      const trainingShare =
        lines.length > 0
          ? lines.filter((l) => l.initialedAt).length / lines.length
          : 0.5;
      const certs = db.certificates.filter((c) => c.userId === m.userId);
      const credentialsShare =
        certs.length > 0
          ? certs.filter((c) => c.expiresOn >= today).length / certs.length
          : 0.5;
      const rows = db.rows.filter(
        (r) => r.agencyId === session.agencyId && r.userId === m.userId,
      );
      const signed = rows.filter((r) => r.signedAt);
      const packetById = new Map(db.packets.map((p) => [p.id, p]));
      const addDays = (iso: string, days: number) => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };
      const onTime = signed.filter((r) => {
        const p = packetById.get(r.packetId);
        if (!p || !r.signedAt) return false;
        const dueDate = p.endsOn ?? addDays(p.startsOn, 14);
        return r.signedAt.slice(0, 10) <= dueDate;
      }).length;
      const result = scoreDspWeek({
        trainingShare,
        credentialsShare,
        documentationTimelinessShare: signed.length > 0 ? onTime / signed.length : 0.5,
        reliabilityShare: rows.length > 0 ? signed.length / rows.length : 0.5,
        hmReviewAverage: rollingAverage(hmReviewAvg.get(m.userId) ?? []),
      });
      return { id: m.userId, fullName: this.recognitionName(m.userId), score: result.score, breakdown: { ...result.breakdown } };
    });

    // --- Decide (idempotent) ---------------------------------------------------
    const decided = (category: "hm_of_the_week" | "dsp_of_the_week") =>
      db.recognitionWinners.some(
        (w) =>
          w.agencyId === session.agencyId &&
          w.weekStart === weekStart &&
          w.category === category,
      );
    const now = new Date().toISOString();
    const weekLabel = weekRangeLabel(weekStart);
    const hmWasDecided = decided("hm_of_the_week");
    const dspWasDecided = decided("dsp_of_the_week");
    const outcomes: import("../recognition/recognition").WeeklyRecognitionResult = {
      weekStart,
      hmWinner: null,
      dspWinner: null,
      alreadyDecided: hmWasDecided && dspWasDecided,
    };
    const announce = (
      category: "hm_of_the_week" | "dsp_of_the_week",
      winner: Candidate | null,
    ) => {
      if (!winner || decided(category)) return;
      db.recognitionWinners.push({
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        weekStart,
        category,
        winnerId: winner.id,
        highlights: buildHighlights(category, winner.breakdown),
        decidedAt: now,
      });
      const winnerName = this.recognitionName(winner.id);
      const isHm = category === "hm_of_the_week";
      const selfPayload = isHm
        ? hmWinnerSelfPayload({
            agencyId: session.agencyId,
            winnerUserId: winner.id,
            winnerName,
            weekStart,
            weekLabel,
          })
        : dspWinnerSelfPayload({
            agencyId: session.agencyId,
            winnerUserId: winner.id,
            winnerName,
            weekStart,
            weekLabel,
          });
      this.pushRecognitionNotification({
        agencyId: selfPayload.agencyId,
        userId: selfPayload.userId ?? null,
        roleKey: selfPayload.roleKey ?? null,
        type: selfPayload.type,
        title: selfPayload.title,
        body: selfPayload.body,
        deepLink: selfPayload.deepLink,
        entityType: selfPayload.entityType ?? null,
        entityId: selfPayload.entityId ?? null,
        dedupeKey: selfPayload.dedupeKey ?? `${selfPayload.type}:${weekStart}:${winner.id}`,
      });
      for (const roleKey of ["administrator", isHm ? "dsp" : "house_manager"]) {
        const broadcast = isHm
          ? hmWinnerBroadcastPayload({
              agencyId: session.agencyId,
              roleKey,
              winnerName,
              weekStart,
              weekLabel,
            })
          : dspWinnerBroadcastPayload({
              agencyId: session.agencyId,
              roleKey,
              winnerName,
              weekStart,
              weekLabel,
            });
        this.pushRecognitionNotification({
          agencyId: broadcast.agencyId,
          userId: broadcast.userId ?? null,
          roleKey: broadcast.roleKey ?? null,
          type: broadcast.type,
          title: broadcast.title,
          body: broadcast.body,
          deepLink: broadcast.deepLink,
          entityType: broadcast.entityType ?? null,
          entityId: broadcast.entityId ?? null,
          dedupeKey:
            broadcast.dedupeKey ?? `${broadcast.type}:${weekStart}:${roleKey}`,
        });
      }
    };
    const hmBest = hmWasDecided ? null : pickWinner(hmCandidates);
    const dspBest = dspWasDecided ? null : pickWinner(dspCandidates);
    announce("hm_of_the_week", hmBest);
    announce("dsp_of_the_week", dspBest);
    // Idempotent reruns report the already-decided winners (matching the
    // select-weekly-winners edge function's already_decided response shape).
    const existingWinner = (
      category: "hm_of_the_week" | "dsp_of_the_week",
    ): { id: string; fullName: string } | null => {
      const row = db.recognitionWinners.find(
        (w) =>
          w.agencyId === session.agencyId &&
          w.weekStart === weekStart &&
          w.category === category,
      );
      return row
        ? { id: row.winnerId, fullName: this.recognitionName(row.winnerId) }
        : null;
    };
    if (hmBest) {
      outcomes.hmWinner = { id: hmBest.id, fullName: hmBest.fullName };
    } else if (hmWasDecided) {
      outcomes.hmWinner = existingWinner("hm_of_the_week");
    }
    if (dspBest) {
      outcomes.dspWinner = { id: dspBest.id, fullName: dspBest.fullName };
    } else if (dspWasDecided) {
      outcomes.dspWinner = existingWinner("dsp_of_the_week");
    }
    await persistMeta(this.store);
    return outcomes;
  }

  /* ------------------------------------------------------------------ */
  /* Delegation template workflow (local)                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Staff members whose membership pins them to this site (excludes
   * agency/program-scoped users like the administrator).
   */
  private delegationStaffAtSite(agencyId: string, siteId: string): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const ids = new Set<string>();
    for (const m of this.store.db.memberships) {
      if (m.agencyId !== agencyId) continue;
      if (m.expiresOn && m.expiresOn < today) continue;
      if (m.siteId !== siteId) continue;
      ids.add(m.userId);
    }
    return [...ids];
  }

  /**
   * Users holding a permission at this site — site memberships plus
   * agency/program-scoped users (their scope covers the site).
   */
  private delegationHoldersAtSite(
    agencyId: string,
    siteId: string,
    key: PermissionKey,
  ): string[] {
    const today = new Date().toISOString().slice(0, 10);
    const ids = new Set<string>();
    for (const m of this.store.db.memberships) {
      if (m.agencyId !== agencyId) continue;
      if (m.expiresOn && m.expiresOn < today) continue;
      if (m.siteId !== null && m.siteId !== siteId) continue;
      const permissions = permissionsFor(
        this.store,
        agencyId,
        m.roleKey ?? m.role,
      );
      if (permissions[key]) ids.add(m.userId);
    }
    return [...ids];
  }

  /** Copy of pushRecognitionNotification's dedupe pattern; true when queued. */
  private queueDelegationNotification(input: {
    agencyId: string;
    userId?: string | null;
    roleKey?: string | null;
    type: string;
    title: string;
    body: string;
    deepLink: string;
    entityType?: string | null;
    entityId?: string | null;
    dedupeKey?: string | null;
  }): boolean {
    const db = this.store.db;
    const dedupeKey = input.dedupeKey ?? crypto.randomUUID();
    // Idempotent: the same event never queues twice.
    if (db.notifications.some((n) => n.dedupeKey === dedupeKey)) {
      return false;
    }
    db.notifications.push({
      id: crypto.randomUUID(),
      agencyId: input.agencyId,
      userId: input.userId ?? null,
      roleKey: input.roleKey ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupeKey,
      createdAt: new Date().toISOString(),
      readAt: null,
    });
    return true;
  }

  private delegationMaterialFor(
    assignmentId: string,
    session: SessionUser,
  ): {
    assignment: IndividualDelegationAssignment;
    material: DelegationTrainingMaterial;
  } {
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const assignment = db.individualDelegationAssignments.find(
      (a) => a.id === assignmentId && a.agencyId === session.agencyId,
    );
    if (!assignment) throw new Error("Delegation assignment not found.");
    assertDelegationSite(session, assignment.siteId);
    accessibleIndividual(this.store, session, assignment.individualId);
    const material = db.delegationTrainingMaterials.find(
      (m) => m.assignmentId === assignment.id,
    );
    if (!material) throw new Error("Training material not found.");
    return { assignment, material };
  }

  async listDelegationTemplates(): Promise<DelegationTemplate[]> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.view");
    ensureDelegationCollections(this.store);
    return this.store.db.delegationTemplates.filter(
      (t) =>
        t.active && (t.agencyId === null || t.agencyId === session.agencyId),
    );
  }

  async createDelegationTemplate(input: {
    name: string;
    category: DelegationTemplateCategory;
    sections: TemplateSections;
    individualizationNote: string;
  }): Promise<DelegationTemplate> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.manage");
    ensureDelegationCollections(this.store);
    const template: DelegationTemplate = {
      id: `tpl-${crypto.randomUUID()}`,
      agencyId: session.agencyId,
      name: input.name,
      category: input.category,
      sections: {
        purpose: input.sections.purpose,
        steps: [...input.sections.steps],
        safetyWarnings: [...input.sections.safetyWarnings],
        documentation: [...input.sections.documentation],
      },
      individualizationNote: input.individualizationNote,
      active: true,
    };
    this.store.db.delegationTemplates.push(template);
    await persistMeta(this.store);
    return template;
  }

  async updateDelegationTemplate(
    id: string,
    patch: {
      name?: string;
      category?: DelegationTemplateCategory;
      active?: boolean;
    },
  ): Promise<DelegationTemplate> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.manage");
    ensureDelegationCollections(this.store);
    const template = this.store.db.delegationTemplates.find(
      (t) => t.id === id && (t.agencyId === null || t.agencyId === session.agencyId),
    );
    if (!template) throw new Error("Delegation template not found.");
    if (patch.name !== undefined) template.name = patch.name;
    if (patch.category !== undefined) template.category = patch.category;
    if (patch.active !== undefined) template.active = patch.active;
    await persistMeta(this.store);
    return template;
  }

  async activateDelegationTemplate(
    templateId: string,
    siteId: string,
  ): Promise<SiteDelegationActivation> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.activate");
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const template = db.delegationTemplates.find(
      (t) =>
        t.id === templateId &&
        (t.agencyId === null || t.agencyId === session.agencyId),
    );
    if (!template) throw new Error("Delegation template not found.");
    const site = db.sites.find(
      (s) => s.id === siteId && s.agencyId === session.agencyId,
    );
    if (!site) throw new Error("Site not found.");
    assertDelegationSite(session, siteId);
    const activation: SiteDelegationActivation = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      templateId: template.id,
      templateName: template.name,
      templateCategory: template.category,
      siteId: site.id,
      siteName: site.name,
      status: "active",
      activatedAt: new Date().toISOString(),
      activatedBy: session.userId,
    };
    db.siteDelegationActivations.push(activation);
    await persistMeta(this.store);
    return activation;
  }

  async deactivateDelegationActivation(
    id: string,
  ): Promise<SiteDelegationActivation> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.activate");
    ensureDelegationCollections(this.store);
    const activation = this.store.db.siteDelegationActivations.find(
      (a) => a.id === id && a.agencyId === session.agencyId,
    );
    if (!activation) throw new Error("Delegation activation not found.");
    assertDelegationSite(session, activation.siteId);
    activation.status = "deactivated";
    await persistMeta(this.store);
    return activation;
  }

  async listSiteDelegationActivations(filter?: {
    siteId?: string;
  }): Promise<SiteDelegationActivation[]> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.view");
    ensureDelegationCollections(this.store);
    const scope = delegationSiteScope(session);
    return this.store.db.siteDelegationActivations.filter((a) => {
      if (a.agencyId !== session.agencyId) return false;
      if (filter?.siteId && a.siteId !== filter.siteId) return false;
      if (scope !== null && !scope.includes(a.siteId)) return false;
      return true;
    });
  }

  async assignDelegationToIndividual(
    activationId: string,
    individualId: string,
  ): Promise<IndividualDelegationAssignment> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.assign");
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const activation = db.siteDelegationActivations.find(
      (a) => a.id === activationId && a.agencyId === session.agencyId,
    );
    if (!activation) throw new Error("Delegation activation not found.");
    assertDelegationSite(session, activation.siteId);
    if (activation.status !== "active") {
      throw new Error("That template activation is no longer active.");
    }
    const individual = db.individuals.find(
      (p) => p.id === individualId && p.agencyId === session.agencyId,
    );
    if (!individual) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, individual.id);
    if (individual.siteId !== activation.siteId) {
      throw new Error(
        "That individual does not belong to the activation's site.",
      );
    }
    const template = db.delegationTemplates.find(
      (t) => t.id === activation.templateId,
    );
    if (!template) throw new Error("Delegation template not found.");
    const now = new Date().toISOString();
    const assignment: IndividualDelegationAssignment = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      activationId: activation.id,
      templateId: template.id,
      templateName: template.name,
      individualId: individual.id,
      individualName: individual.fullName,
      siteId: activation.siteId,
      siteName: activation.siteName,
      status: "assigned",
      assignedAt: now,
      assignedBy: session.userId,
    };
    db.individualDelegationAssignments.push(assignment);
    db.delegationTrainingMaterials.push({
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      assignmentId: assignment.id,
      status: "draft",
      draftContent: instantiateDraft(template, assignment),
      publishedContent: null,
      submittedAt: null,
      approvedAt: null,
      approvedBy: null,
    });
    // Notify reviewers at the site — not all staff.
    for (const userId of this.delegationHoldersAtSite(
      session.agencyId,
      assignment.siteId,
      "delegation.training.review",
    )) {
      this.queueDelegationNotification(
        delegationReviewReadyPayload({
          agencyId: session.agencyId,
          userId,
          assignmentId: assignment.id,
          templateName: template.name,
          individualName: individual.fullName,
        }),
      );
    }
    await persistMeta(this.store);
    return assignment;
  }

  async endDelegationAssignment(
    id: string,
  ): Promise<IndividualDelegationAssignment> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.assign");
    ensureDelegationCollections(this.store);
    const assignment = this.store.db.individualDelegationAssignments.find(
      (a) => a.id === id && a.agencyId === session.agencyId,
    );
    if (!assignment) throw new Error("Delegation assignment not found.");
    assertDelegationSite(session, assignment.siteId);
    assignment.status = "ended";
    await persistMeta(this.store);
    return assignment;
  }

  async listDelegationAssignments(filter?: {
    siteId?: string;
  }): Promise<IndividualDelegationAssignment[]> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.view");
    ensureDelegationCollections(this.store);
    const scope = delegationSiteScope(session);
    return this.store.db.individualDelegationAssignments.filter((a) => {
      if (a.agencyId !== session.agencyId) return false;
      if (filter?.siteId && a.siteId !== filter.siteId) return false;
      if (scope !== null && !scope.includes(a.siteId)) return false;
      const person = this.store.db.individuals.find(p => p.id === a.individualId);
      return !!person && canReadIndividual(session, person, this.store.db.assignments);
    });
  }

  async getDelegationTrainingMaterial(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial | null> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.templates.view");
    const { material } = this.delegationMaterialFor(assignmentId, session);
    const canReview =
      hasPermission(session, "delegation.training.review") ||
      hasPermission(session, "delegation.training.approve");
    return visibleMaterialForStaff(material, canReview) === null
      ? null
      : material;
  }

  async updateDelegationTrainingDraft(
    assignmentId: string,
    draft: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.training.review");
    const { material } = this.delegationMaterialFor(assignmentId, session);
    if (material.status !== "draft" && material.status !== "in_review") {
      throw new Error("Only a draft or in-review material can be edited.");
    }
    material.draftContent = { ...draft, generatedMark: DIGITAL_RECORD_MARK };
    await persistMeta(this.store);
    return material;
  }

  async submitDelegationForReview(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.training.review");
    const { material } = this.delegationMaterialFor(assignmentId, session);
    if (material.status !== "draft" && material.status !== "in_review") {
      throw new Error("Only a draft or in-review material can be submitted.");
    }
    material.status = "in_review";
    material.submittedAt = new Date().toISOString();
    await persistMeta(this.store);
    return material;
  }

  async approveDelegationTrainingMaterial(
    assignmentId: string,
    content: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.training.approve");
    const { assignment, material } = this.delegationMaterialFor(
      assignmentId,
      session,
    );
    if (material.status !== "draft" && material.status !== "in_review") {
      throw new Error("Only a draft or in-review material can be approved.");
    }
    const now = new Date().toISOString();
    material.publishedContent = {
      ...content,
      generatedMark: DIGITAL_RECORD_MARK,
    };
    material.status = "published";
    material.approvedAt = now;
    material.approvedBy = session.userId;
    // Notify every staff member at the site, exactly once each.
    for (const staffId of this.delegationStaffAtSite(
      session.agencyId,
      assignment.siteId,
    )) {
      this.queueDelegationNotification(
        delegationPublishedPayload({
          agencyId: session.agencyId,
          userId: staffId,
          assignmentId: assignment.id,
          templateName: assignment.templateName,
          individualName: assignment.individualName,
        }),
      );
    }
    log(
      this.store,
      session,
      "delegation.published",
      `${session.fullName} published ${assignment.templateName} for ${assignment.individualName} at ${assignment.siteName}.`,
      "delegation_assignment",
      assignment.id,
    );
    await persistMeta(this.store);
    return material;
  }

  async openDelegationMaterial(
    assignmentId: string,
  ): Promise<DelegationAcknowledgment> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.acknowledge");
    const { assignment, material } = this.delegationMaterialFor(
      assignmentId,
      session,
    );
    if (material.status !== "published") {
      throw new Error("The training material is not published yet.");
    }
    const db = this.store.db;
    let row = db.delegationAcknowledgments.find(
      (r) => r.assignmentId === assignment.id && r.staffId === session.userId,
    );
    if (!row) {
      row = {
        id: crypto.randomUUID(),
        agencyId: session.agencyId,
        assignmentId: assignment.id,
        staffId: session.userId,
        staffName: session.fullName,
        openedAt: null,
        signedAt: null,
        signatureName: null,
        signatureMark: null,
      };
      db.delegationAcknowledgments.push(row);
    }
    if (!row.openedAt) row.openedAt = new Date().toISOString();
    await persistMeta(this.store);
    return row;
  }

  async getMyDelegationAck(
    assignmentId: string,
  ): Promise<DelegationAcknowledgment | null> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.acknowledge");
    const { assignment } = this.delegationMaterialFor(assignmentId, session);
    return (
      this.store.db.delegationAcknowledgments.find(
        (r) => r.assignmentId === assignment.id && r.staffId === session.userId,
      ) ?? null
    );
  }

  async signDelegationAcknowledgment(
    assignmentId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<DelegationAcknowledgment> {
    const session = assertSession(this.store);
    assertCan(session, "delegation.acknowledge");
    const { assignment, material } = this.delegationMaterialFor(
      assignmentId,
      session,
    );
    if (material.status !== "published") {
      throw new Error("The training material is not published yet.");
    }
    // Own row only: staffId is always the session user — there is no way to
    // sign for someone else.
    const row = this.store.db.delegationAcknowledgments.find(
      (r) => r.assignmentId === assignment.id && r.staffId === session.userId,
    );
    if (!row || !row.openedAt) {
      throw new Error("Open the training material before signing.");
    }
    if (row.signedAt) {
      throw new Error("You have already signed this acknowledgment.");
    }
    row.signedAt = new Date().toISOString();
    row.signatureName = signatureName;
    row.signatureMark = signatureMark;
    log(
      this.store,
      session,
      "delegation.signed",
      `${session.fullName} signed the ${assignment.templateName} delegation for ${assignment.individualName}.`,
      "delegation_acknowledgment",
      row.id,
    );
    await persistMeta(this.store);
    return row;
  }

  async listDelegationAckStatus(
    assignmentId: string,
  ): Promise<DelegationAckStatusRow[]> {
    const session = assertSession(this.store);
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const assignment = db.individualDelegationAssignments.find(
      (a) => a.id === assignmentId && a.agencyId === session.agencyId,
    );
    if (!assignment) throw new Error("Delegation assignment not found.");
    const mayView =
      hasPermission(session, "delegation.training.review") ||
      hasPermission(session, "delegation.training.approve") ||
      hasPermission(session, "delegation.activate") ||
      (session.roleKey === "house_manager" &&
        session.siteId !== null &&
        session.siteId === assignment.siteId);
    if (!mayView) {
      throw new Error("You do not have permission to do that.");
    }
    accessibleIndividual(this.store, session, assignment.individualId);
    const material = db.delegationTrainingMaterials.find(
      (m) => m.assignmentId === assignment.id,
    );
    const ackByStaff = new Map(
      db.delegationAcknowledgments
        .filter((r) => r.assignmentId === assignment.id)
        .map((r) => [r.staffId, r]),
    );
    return this.delegationStaffAtSite(session.agencyId, assignment.siteId).map(
      (staffId) => {
        const ack = ackByStaff.get(staffId);
        return {
          staffId,
          staffName:
            db.profiles.find((p) => p.id === staffId)?.fullName ?? "Unknown",
          openedAt: ack?.openedAt ?? null,
          signedAt: ack?.signedAt ?? null,
          overdue: isAcknowledgmentOverdue(
            ack?.signedAt ?? null,
            material?.approvedAt ?? null,
          ),
        };
      },
    );
  }

  async sweepDelegationAckOverdue(): Promise<number> {
    const session = assertSession(this.store);
    if (
      !hasPermission(session, "delegation.training.review") &&
      !hasPermission(session, "delegation.activate")
    ) {
      throw new Error("You do not have permission to do that.");
    }
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const nowMs = Date.now();
    let inserted = 0;
    for (const material of db.delegationTrainingMaterials) {
      if (material.agencyId !== session.agencyId) continue;
      if (material.status !== "published" || !material.approvedAt) continue;
      if (!isAcknowledgmentOverdue(null, material.approvedAt, nowMs)) continue;
      const assignment = db.individualDelegationAssignments.find(
        (a) => a.id === material.assignmentId,
      );
      if (!assignment || assignment.status !== "assigned") continue;
      const dueAt = Date.parse(acknowledgmentDueAt(material.approvedAt));
      const daysOverdue = Math.max(
        0,
        Math.floor((nowMs - dueAt) / 86_400_000),
      );
      const ackByStaff = new Map(
        db.delegationAcknowledgments
          .filter((r) => r.assignmentId === assignment.id)
          .map((r) => [r.staffId, r]),
      );
      // Unsigned staff plus site managers; the per-(assignment, user) dedupe
      // key collapses overlap to a single notification per person.
      const targets = new Set<string>();
      for (const staffId of this.delegationStaffAtSite(
        session.agencyId,
        assignment.siteId,
      )) {
        if (ackByStaff.get(staffId)?.signedAt) continue; // signed staff skip
        targets.add(staffId);
      }
      for (const managerId of this.delegationHoldersAtSite(
        session.agencyId,
        assignment.siteId,
        "delegation.activate",
      )) {
        targets.add(managerId);
      }
      for (const userId of targets) {
        if (
          this.queueDelegationNotification(
            delegationAckOverduePayload({
              agencyId: session.agencyId,
              userId,
              assignmentId: assignment.id,
              templateName: assignment.templateName,
              individualName: assignment.individualName,
              daysOverdue,
            }),
          )
        ) {
          inserted += 1;
        }
      }
    }
    await persistMeta(this.store);
    return inserted;
  }

  // ================= QA audits (local) =================

  private qaSiteScope(session: SessionUser): string[] | null {
    return isAgencyWideViewer(session) ? null : session.siteId ? [session.siteId] : [];
  }

  private assertQaSite(session: SessionUser, siteId: string): void {
    this.siteOrThrow(session, siteId);
    const scope = this.qaSiteScope(session);
    if (scope !== null && !scope.includes(siteId)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private getQaAuditOrThrow(
    session: SessionUser,
    auditId: string,
  ): StoredQaAudit {
    ensureQaCollections(this.store);
    const audit = this.store.db.qaAudits.find(
      (a) => a.id === auditId && a.agencyId === session.agencyId,
    );
    if (!audit) throw new Error("QA audit not found.");
    this.assertQaSite(session, audit.siteId);
    return audit;
  }

  /** Proof context for the five approved auto-verification mappings. */
  private qaAutoContext(
    session: SessionUser,
    siteId: string,
    year: number,
    quarter: number,
  ): QaAutoVerifyContext {
    const db = this.store.db;
    const agencyId = session.agencyId;
    const months = qaQuarterMonths(year, quarter);
    return {
      siteId,
      months,
      auditYear: year,
      drills: db.emergencyDrills
        .filter(
          (d) =>
            d.agencyId === agencyId &&
            d.siteId === siteId &&
            months.includes(d.monthKey),
        )
        .map((d) => ({ ...d })),
      trips: db.mileageTrips
        .filter(
          (t) =>
            t.agencyId === agencyId &&
            t.siteId === siteId &&
            months.includes(t.tripDate.slice(0, 7)),
        )
        .map((t) => ({ siteId: t.siteId, date: t.tripDate })),
      packets: db.packets
        .filter(
          (p) =>
            p.agencyId === agencyId && p.startsOn.slice(0, 4) === String(year),
        )
        .map((p) => ({
          individualId: p.individualId,
          startsOn: p.startsOn,
          rows: db.rows
            .filter((r) => r.packetId === p.id)
            .map((r) => ({ staffName: r.staffName, signedAt: r.signedAt })),
        })),
      assignments: db.individualDelegationAssignments
        .filter((a) => a.agencyId === agencyId && a.status === "assigned")
        .map((a) => ({
          individualId: a.individualId,
          status: a.status,
          acks: db.delegationAcknowledgments
            .filter((k) => k.assignmentId === a.id)
            .map((k) => ({ signedAt: k.signedAt })),
        })),
      safetyReports: db.homeSafetyReports
        .filter(
          (r) =>
            r.agencyId === agencyId &&
            r.siteId === siteId &&
            months.includes(r.monthKey),
        )
        .map((r) => ({
          siteId: r.siteId,
          monthKey: r.monthKey,
          lines: r.lines.map((l) => ({ dateChecked: l.dateChecked })),
        })),
    };
  }

  async createQaAudit(
    siteId: string,
    year: number,
    quarter: number,
  ): Promise<QaAudit> {
    const session = assertSession(this.store);
    assertCan(session, "qa.audit");
    this.assertQaSite(session, siteId);
    if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      throw new Error("That quarter is not valid.");
    }
    const q = quarter as 1 | 2 | 3 | 4;
    ensureQaCollections(this.store);
    const db = this.store.db;
    const existing = db.qaAudits.find(
      (a) =>
        a.agencyId === session.agencyId &&
        a.siteId === siteId &&
        a.year === year &&
        a.quarter === q,
    );
    if (existing) return existing;
    const individuals = db.individuals
      .filter((p) => p.agencyId === session.agencyId && p.siteId === siteId)
      .map((p) => ({ id: p.id, fullName: p.fullName }));
    const ctx = this.qaAutoContext(session, siteId, year, quarter);
    const items = expandAndVerifyQaItems(individuals, ctx);
    const now = new Date().toISOString();
    const audit: StoredQaAudit = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId,
      year,
      quarter: q,
      status: "in_progress",
      auditorId: session.userId,
      auditorName: session.fullName,
      auditorSignatureName: null,
      auditorSignatureMark: null,
      signedAt: null,
      score: null,
      createdAt: now,
      updatedAt: now,
    };
    db.qaAudits.push(audit);
    for (const item of items) {
      db.qaAuditItems.push({
        ...item,
        id: crypto.randomUUID(),
        auditId: audit.id,
        agencyId: session.agencyId,
      });
    }
    await persistMeta(this.store);
    return audit;
  }

  async listQaAudits(filter?: {
    siteId?: string;
    year?: number;
    quarter?: number;
  }): Promise<QaAudit[]> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    ensureQaCollections(this.store);
    const scope = this.qaSiteScope(session);
    return this.store.db.qaAudits
      .filter((a) => {
        if (a.agencyId !== session.agencyId) return false;
        if (filter?.siteId && a.siteId !== filter.siteId) return false;
        if (filter?.year && a.year !== filter.year) return false;
        if (filter?.quarter && a.quarter !== filter.quarter) return false;
        if (scope !== null && !scope.includes(a.siteId)) return false;
        return true;
      })
      .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  }

  async getQaAudit(id: string): Promise<QaAudit | null> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    ensureQaCollections(this.store);
    const audit = this.store.db.qaAudits.find(
      (a) => a.id === id && a.agencyId === session.agencyId,
    );
    if (!audit) return null;
    this.assertQaSite(session, audit.siteId);
    return audit;
  }

  async getQaAuditItems(auditId: string): Promise<QaAuditItemState[]> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    const audit = this.getQaAuditOrThrow(session, auditId);
    void audit;
    return this.store.db.qaAuditItems
      .filter((i) => i.auditId === auditId && i.agencyId === session.agencyId)
      .map((i) => ({ ...i }));
  }

  private qaItemOrThrow(
    session: SessionUser,
    auditId: string,
    itemKey: string,
  ): StoredQaAuditItem {
    this.getQaAuditOrThrow(session, auditId);
    const item = this.store.db.qaAuditItems.find(
      (i) =>
        i.auditId === auditId &&
        i.key === itemKey &&
        i.agencyId === session.agencyId,
    );
    if (!item) throw new Error("QA audit item not found.");
    return item;
  }

  async scoreQaItem(
    auditId: string,
    itemKey: string,
    result: "yes" | "no" | "na" | "skipped",
    comment: string,
  ): Promise<QaAuditItemState> {
    const session = assertSession(this.store);
    assertCan(session, "qa.audit");
    const audit = this.getQaAuditOrThrow(session, auditId);
    if (audit.status === "finalized") {
      throw new Error("That audit is finalized — it can no longer be scored.");
    }
    const item = this.qaItemOrThrow(session, auditId, itemKey);
    if (result === "no") recheckQaItemForScoring(item, this.qaAutoContext(session, audit.siteId, audit.year, audit.quarter));
    const updated = scoreQaItemState(
      item,
      result,
      comment,
      session.userId,
      session.fullName || "Auditor",
    );
    Object.assign(this.qaItemOrThrow(session, auditId, itemKey), updated);
    audit.updatedAt = new Date().toISOString();
    await persistMeta(this.store);
    return { ...updated };
  }

  async finalizeQaAudit(
    auditId: string,
    signature: { name: string; mark: string },
  ): Promise<QaAudit> {
    const session = assertSession(this.store);
    assertCan(session, "qa.audit");
    const audit = this.getQaAuditOrThrow(session, auditId);
    if (audit.status === "finalized") {
      throw new Error("That audit is already finalized.");
    }
    const items = this.store.db.qaAuditItems.filter(
      (i) => i.auditId === auditId && i.agencyId === session.agencyId,
    );
    const undecided = qaUndecidedItems(items);
    if (undecided.length > 0) {
      throw new Error(
        `${undecided.length} item${undecided.length === 1 ? " is" : "s are"} still undecided. Score or skip every item before finalizing.`,
      );
    }
    if (!signature.name.trim() || !signature.mark.trim()) {
      throw new Error("An adopted signature is required to finalize.");
    }
    const now = new Date().toISOString();
    audit.status = "finalized";
    audit.auditorSignatureName = session.fullName;
    audit.auditorSignatureMark = signature.mark.trim();
    audit.signedAt = now;
    audit.score = scoreQaAudit(items);
    audit.updatedAt = now;
    // Roll the site's schedule forward one quarter so the next audit is due
    // on time (system action — no extra permission needed to finalize).
    const schedule = this.store.db.qaSchedules.find(
      (s) => s.agencyId === session.agencyId && s.siteId === audit.siteId && s.active,
    );
    if (schedule) {
      schedule.nextDue = nextQaDueDate(schedule.nextDue);
      schedule.updatedAt = now;
    }
    await persistMeta(this.store);
    return audit;
  }

  async raiseQaDispute(
    auditId: string,
    itemKey: string,
    note: string,
    photos: QaPhotoInput[],
  ): Promise<QaAuditItemState> {
    const session = assertSession(this.store);
    assertCan(session, "qa.dispute");
    const audit = this.getQaAuditOrThrow(session, auditId);
    const updated = raiseQaDisputeState(
      this.qaItemOrThrow(session, auditId, itemKey),
      note,
      photos,
      session.userId,
      session.fullName || "Staff",
    );
    Object.assign(this.qaItemOrThrow(session, auditId, itemKey), updated);
    audit.updatedAt = new Date().toISOString();
    // Notify auditors at the agency that a dispute needs review.
    this.queueDelegationNotification({
      agencyId: session.agencyId,
      roleKey: "auditor",
      type: "qa.dispute_raised",
      title: "QA finding disputed",
      body: `${updated.individualName ? `${updated.individualName} — ` : ""}${this.qaItemLabel(updated.itemId)} was disputed with photo evidence.`,
      deepLink: `/qa-audits/${auditId}`,
      entityType: "qa_audit",
      entityId: auditId,
      dedupeKey: `qa-dispute-${auditId}-${itemKey}-${updated.disputeRaisedAt}`,
    });
    await persistMeta(this.store);
    return { ...updated };
  }

  private qaItemLabel(itemId: string): string {
    return QA_ITEM_MAP[itemId]?.text ?? itemId;
  }

  async resolveQaDispute(
    auditId: string,
    itemKey: string,
    approved: boolean,
    reason: string,
  ): Promise<QaAuditItemState> {
    const session = assertSession(this.store);
    assertCan(session, "qa.audit");
    const audit = this.getQaAuditOrThrow(session, auditId);
    const updated = resolveQaDisputeState(
      this.qaItemOrThrow(session, auditId, itemKey),
      approved,
      reason,
      session.userId,
      session.fullName || "Auditor",
    );
    Object.assign(this.qaItemOrThrow(session, auditId, itemKey), updated);
    // Keep the finalized score snapshot honest when a dispute changes it.
    if (audit.status === "finalized") {
      const items = this.store.db.qaAuditItems.filter(
        (i) => i.auditId === auditId && i.agencyId === session.agencyId,
      );
      audit.score = scoreQaAudit(items);
    }
    audit.updatedAt = new Date().toISOString();
    if (updated.disputeRaisedBy) this.queueDelegationNotification({
      agencyId: session.agencyId, userId: updated.disputeRaisedBy,
      type: "qa.dispute_resolved", title: "QA dispute resolved",
      body: `${this.qaItemLabel(updated.itemId)}: ${approved ? "dispute accepted" : "dispute rejected"}. ${reason}`,
      deepLink: `/qa-audits/${auditId}`, entityType: "qa_audit", entityId: auditId,
      dedupeKey: `qa.dispute_resolved:${auditId}:${itemKey}:${audit.updatedAt}`,
    });
    await persistMeta(this.store);
    return { ...updated };
  }

  async listQaSchedules(filter?: { siteId?: string }): Promise<QaAuditSchedule[]> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    ensureQaCollections(this.store);
    const scope = this.qaSiteScope(session);
    return this.store.db.qaSchedules
      .filter((s) => {
        if (s.agencyId !== session.agencyId) return false;
        if (filter?.siteId && s.siteId !== filter.siteId) return false;
        if (scope !== null && !scope.includes(s.siteId)) return false;
        return true;
      })
      .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
  }

  async upsertQaSchedule(input: {
    siteId: string;
    nextDue: string;
    assignedAuditorId?: string | null;
    assignedAuditorName?: string | null;
  }): Promise<QaAuditSchedule> {
    const session = assertSession(this.store);
    assertCan(session, "qa.schedule");
    this.assertQaSite(session, input.siteId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDue)) {
      throw new Error("The due date must be a calendar date.");
    }
    ensureQaCollections(this.store);
    const db = this.store.db;
    const now = new Date().toISOString();
    const existing = db.qaSchedules.find(
      (s) => s.agencyId === session.agencyId && s.siteId === input.siteId,
    );
    if (existing) {
      existing.nextDue = input.nextDue;
      existing.assignedAuditorId = input.assignedAuditorId ?? null;
      existing.assignedAuditorName = input.assignedAuditorName ?? null;
      existing.active = true;
      existing.updatedAt = now;
      await persistMeta(this.store);
      return existing;
    }
    const schedule: StoredQaAuditSchedule = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      siteId: input.siteId,
      nextDue: input.nextDue,
      assignedAuditorId: input.assignedAuditorId ?? null,
      assignedAuditorName: input.assignedAuditorName ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    db.qaSchedules.push(schedule);
    await persistMeta(this.store);
    return schedule;
  }

  /**
   * Queue due/overdue reminders for active QA schedules. Idempotent per
   * schedule per day — safe to run on login and on a daily sweep.
   */
  async sweepQaScheduleReminders(today = new Date().toISOString().slice(0, 10)): Promise<number> {
    const session = assertSession(this.store);
    assertCan(session, "qa.schedule");
    ensureQaCollections(this.store);
    let queued = 0;
    for (const schedule of this.store.db.qaSchedules) {
      if (schedule.agencyId !== session.agencyId || !schedule.active) continue;
      const overdue = schedule.nextDue < today;
      const dueSoon =
        !overdue &&
        schedule.nextDue <=
          new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86400000)
            .toISOString()
            .slice(0, 10);
      if (!overdue && !dueSoon) continue;
      const siteName =
        this.store.db.sites.find((s) => s.id === schedule.siteId)?.name ??
        "a program site";
      const dedupeKey = `qa-schedule-${schedule.id}-${today}`;
      const ok = this.queueDelegationNotification({
        agencyId: session.agencyId,
        roleKey: "auditor",
        type: overdue ? "qa.schedule_overdue" : "qa.schedule_due",
        title: overdue ? "QA audit overdue" : "QA audit due soon",
        body: `${siteName} — quarterly QA audit ${overdue ? "was due" : "is due"} ${schedule.nextDue}.`,
        deepLink: `/qa-audits?siteId=${schedule.siteId}`,
        entityType: "qa_schedule",
        entityId: schedule.id,
        dedupeKey,
      });
      if (ok) queued += 1;
    }
    await persistMeta(this.store);
    return queued;
  }

  async getQaSiteRanking(): Promise<QaRankedSite[]> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    ensureQaCollections(this.store);
    const db = this.store.db;
    const scope = this.qaSiteScope(session);
    const sites = db.sites.filter((s) => {
      if (s.agencyId !== session.agencyId) return false;
      if (scope !== null && !scope.includes(s.id)) return false;
      return true;
    });
    const finalized = db.qaAudits.filter(
      (a) => a.agencyId === session.agencyId && a.status === "finalized",
    );
    const bySite = new Map<string, QaAudit[]>();
    for (const audit of finalized) {
      const list = bySite.get(audit.siteId) ?? [];
      list.push(audit);
      bySite.set(audit.siteId, list);
    }
    const inputs = sites.map((site) => {
      const audits = (bySite.get(site.id) ?? []).sort(
        (a, b) => b.year - a.year || b.quarter - a.quarter,
      );
      const latest = audits[0] ?? null;
      const previous = audits[1] ?? null;
      return {
        siteId: site.id,
        siteName: site.name,
        score: latest?.score?.pct ?? null,
        previousScore: previous?.score?.pct ?? null,
        trend:
          latest?.score?.pct != null && previous?.score?.pct != null
            ? latest.score.pct - previous.score.pct
            : null,
        criticalFails: latest?.score?.criticalFails.length ?? 0,
        auditId: latest?.id ?? null,
        finalizedAt: latest?.signedAt ?? null,
      };
    });
    return rankQaSites(inputs);
  }

  async getQaSiteHistory(siteId: string): Promise<QaAudit[]> {
    const session = assertSession(this.store);
    assertCan(session, "audit.read");
    this.assertQaSite(session, siteId);
    ensureQaCollections(this.store);
    return this.store.db.qaAudits
      .filter(
        (a) =>
          a.agencyId === session.agencyId &&
          a.siteId === siteId &&
          a.status === "finalized",
      )
      .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
  }

  private assertExtractionAccess(session: SessionUser, extractionId: string): void {
    const extraction = this.store.db.documentExtractions.find(e => e.id === extractionId && e.agencyId === session.agencyId);
    const upload = extraction && this.store.db.documentUploads.find(u => u.id === extraction.uploadId && u.agencyId === session.agencyId);
    if (!upload) throw new Error("Upload not found.");
    accessibleIndividual(this.store, session, upload.individualId);
  }

  // ================= PCSP document-extraction pipeline (local demo) =================

  async registerDocumentUpload(input: {
    individualId: string;
    /** Optional — falls back to the individual's site when omitted. */
    siteId?: string;
    documentType: DocumentType;
    originalFilename: string;
    mimeType?: string;
    file?: Blob | null;
  }): Promise<DocumentUpload> {
    const session = assertSession(this.store);
    assertCan(session, "documents.upload");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    if (!DOCUMENT_TYPES.includes(input.documentType)) {
      throw new Error("Unknown document type.");
    }
    const individual = db.individuals.find(
      (p) => p.id === input.individualId && p.agencyId === session.agencyId,
    );
    if (!individual) throw new Error("Individual not found.");
    accessibleIndividual(this.store, session, individual.id);
    const site = input.siteId
      ? db.sites.find(
          (s) => s.id === input.siteId && s.agencyId === session.agencyId,
        )
      : db.sites.find(
          (s) => s.id === individual.siteId && s.agencyId === session.agencyId,
        );
    if (!site) throw new Error("Site not found.");
    if (site.id !== individual.siteId) throw new Error("The individual does not belong to this site.");
    if (!input.originalFilename.trim()) throw new Error("A filename is required.");
    const now = new Date().toISOString();
    const upload: DocumentUpload = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      individualId: individual.id,
      siteId: site.id,
      documentType: input.documentType,
      originalFilename: input.originalFilename.trim(),
      mimeType: input.mimeType ?? "application/pdf",
      storagePath: `${session.agencyId}/${site.id}/${crypto.randomUUID()}/${input.originalFilename.trim()}`,
      uploadedBy: session.userId,
      uploadedAt: now,
      status: "uploaded",
    };
    db.documentUploads.unshift(upload);
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: upload.id,
      actor: session.userId,
      action: "upload",
      detail: {
        document_type: upload.documentType,
        filename: upload.originalFilename,
      },
    });
    await persistMeta(this.store);
    return upload;
  }

  async listDocumentUploads(filter?: {
    individualId?: string;
    status?: DocumentStatus;
  }): Promise<DocumentUpload[]> {
    const session = assertSession(this.store);
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const isReviewer = hasPermission(session, "documents.review");
    return db.documentUploads.filter((u) => {
      if (u.agencyId !== session.agencyId) return false;
      const person = db.individuals.find(p => p.id === u.individualId);
      if (!person || !canReadIndividual(session, person, db.assignments)) return false;
      if (filter?.individualId && u.individualId !== filter.individualId) return false;
      if (filter?.status && u.status !== filter.status) return false;
      if (isReviewer) return true;
      // Ordinary staff: only approved/activated results at their own sites —
      // never raw uploads or extractions.
      if (!hasPermission(session, "documents.view")) return false;
      if (u.status !== "approved" && u.status !== "activated") return false;
      const scope = delegationSiteScope(session);
      if (scope !== null && !scope.includes(u.siteId)) return false;
      return true;
    });
  }

  async getDocumentExtraction(uploadId: string): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  } | null> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const upload = db.documentUploads.find(
      (u) => u.id === uploadId && u.agencyId === session.agencyId,
    );
    if (!upload) throw new Error("Upload not found.");
    accessibleIndividual(this.store, session, upload.individualId);
    const extraction = db.documentExtractions.find(
      (e) => e.uploadId === uploadId,
    );
    if (!extraction) return null;
    const items = db.documentTrackableItems.filter(
      (i) => i.extractionId === extraction.id,
    );
    return { extraction, items };
  }

  async simulatePcspExtraction(uploadId: string): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  }> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const upload = db.documentUploads.find(
      (u) => u.id === uploadId && u.agencyId === session.agencyId,
    );
    if (!upload) throw new Error("Upload not found.");
    accessibleIndividual(this.store, session, upload.individualId);
    const existing = db.documentExtractions.find((e) => e.uploadId === uploadId);
    if (existing) {
      const items = db.documentTrackableItems.filter(
        (i) => i.extractionId === existing.id,
      );
      return { extraction: existing, items };
    }
    // LOCAL DEMO ONLY — clearly marked simulated; the hosted path calls Gemini.
    const individualName =
      db.individuals.find((p) => p.id === upload.individualId)?.fullName ??
      "Unknown";
    const fixture = simulatedPcspFixture(individualName);
    const validated = validateExtraction(upload.documentType, fixture);
    if (!validated.ok || !validated.value) {
      throw new Error(`Fixture failed validation: ${validated.errors.join("; ")}`);
    }
    const now = new Date().toISOString();
    const extraction: LocalDocumentExtraction = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      uploadId: upload.id,
      schemaVersion: 1,
      extractedData: validated.value,
      confidence: { overall: 0.8, simulated: true },
      model: "simulated-local-fixture",
      createdAt: now,
    };
    db.documentExtractions.push(extraction);
    const items = simulatedItemsFor(
      validated.value as PcspExtraction,
      extraction.id,
      session.agencyId,
    );
    for (const item of items) db.documentTrackableItems.push(item);
    upload.status = "extracted";
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: upload.id,
      actor: null,
      action: "extraction_complete",
      detail: {
        model: "simulated-local-fixture",
        item_count: items.length,
        schema_version: 1,
        simulated: true,
      },
    });
    // Reviewers at the site get a bell notification: nothing is tracked yet.
    for (const userId of this.delegationHoldersAtSite(
      session.agencyId,
      upload.siteId,
      "documents.review",
    )) {
      this.queueDelegationNotification({
        agencyId: session.agencyId,
        userId,
        type: "document.extraction_ready",
        title: "Extraction ready for review",
        body:
          `${upload.originalFilename} for ${individualName} finished extraction — ` +
          "review the proposed items before anything is tracked.",
        deepLink: `/documents/extractions/${upload.id}`,
        entityType: "document_upload",
        entityId: upload.id,
        dedupeKey: `document.extraction_ready:${upload.id}:${userId}`,
      });
    }
    await persistMeta(this.store);
    return { extraction, items };
  }

  async extractDocumentUpload(
    _uploadId: string,
    _documentText: string,
  ): Promise<{ ok: boolean; fallbackUsed: boolean }> {
    // The local/demo backend has no Gemini key — the hosted API calls the
    // extract-pcsp edge function instead. See simulatePcspExtraction().
    throw new Error(
      "Real AI extraction is hosted-only (extract-pcsp edge function). " +
        "Use simulatePcspExtraction() for the local demo.",
    );
  }

  async updateTrackableItem(
    itemId: string,
    patch: {
      title: string;
      detail?: Record<string, unknown>;
      dueDate?: string | null;
      needsHumanCheck?: boolean;
    },
  ): Promise<TrackableItem> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const item = db.documentTrackableItems.find(
      (i) => i.id === itemId && i.agencyId === session.agencyId,
    );
    if (!item) throw new Error("Trackable item not found.");
    this.assertExtractionAccess(session, item.extractionId);
    if (item.status !== "proposed" && item.status !== "edited") {
      throw new Error("Only proposed or edited items can be edited.");
    }
    if (patch.dueDate) assertCalendarDate(patch.dueDate, "Use a valid due date.");
    if (!patch.title.trim()) throw new Error("A title is required.");
    item.title = patch.title.trim();
    item.detail = patch.detail ?? {};
    item.dueDate = patch.dueDate ?? null;
    item.needsHumanCheck = patch.needsHumanCheck ?? false;
    item.status = "edited";
    const extraction = db.documentExtractions.find(
      (e) => e.id === item.extractionId,
    );
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: extraction?.uploadId ?? null,
      actor: session.userId,
      action: "item_edited",
      detail: { item_id: itemId, title: item.title },
    });
    await persistMeta(this.store);
    return item;
  }

  async approveDocumentExtraction(uploadId: string): Promise<void> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const upload = db.documentUploads.find(
      (u) => u.id === uploadId && u.agencyId === session.agencyId,
    );
    if (!upload) throw new Error("Upload not found.");
    accessibleIndividual(this.store, session, upload.individualId);
    if (upload.status !== "extracted" && upload.status !== "in_review") {
      throw new Error("Only extracted or in-review uploads can be approved.");
    }
    const extraction = db.documentExtractions.find(
      (e) => e.uploadId === uploadId,
    );
    if (!extraction) throw new Error("No extraction recorded for this upload.");
    let count = 0;
    for (const item of db.documentTrackableItems) {
      if (
        item.extractionId === extraction.id &&
        (item.status === "proposed" || item.status === "edited")
      ) {
        if (!canTransitionTrackableItem(item.status, "approved")) {
          throw new Error("Internal error: invalid item transition.");
        }
        item.status = "approved";
        count += 1;
      }
    }
    if (!canTransitionUpload(upload.status, "approved")) {
      throw new Error("Internal error: invalid upload transition.");
    }
    upload.status = "approved";
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: upload.id,
      actor: session.userId,
      action: "extraction_approved",
      detail: { item_count: count },
    });
    // Reviewers at the site get a bell notification: items are now eligible
    // for one-by-one activation (staff still see nothing until activation).
    for (const userId of this.delegationHoldersAtSite(
      session.agencyId,
      upload.siteId,
      "documents.review",
    )) {
      this.queueDelegationNotification({
        agencyId: session.agencyId,
        userId,
        type: "document.extraction_approved",
        title: "Extraction approved",
        body: `${count} item(s) from ${upload.originalFilename} are ready to activate.`,
        deepLink: `/documents/extractions/${upload.id}`,
        entityType: "document_upload",
        entityId: upload.id,
        dedupeKey: `document.extraction_approved:${upload.id}:${userId}`,
      });
    }
    await persistMeta(this.store);
  }

  async activateTrackableItem(itemId: string): Promise<TrackableItem> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    ensureDelegationCollections(this.store);
    const db = this.store.db;
    const item = db.documentTrackableItems.find(
      (i) => i.id === itemId && i.agencyId === session.agencyId,
    );
    if (!item) throw new Error("Trackable item not found.");
    this.assertExtractionAccess(session, item.extractionId);
    if (!canTransitionTrackableItem(item.status, "activated")) {
      throw new Error("Only approved items can be activated.");
    }
    const extraction = db.documentExtractions.find(
      (e) => e.id === item.extractionId,
    );
    const upload = extraction
      ? db.documentUploads.find((u) => u.id === extraction.uploadId)
      : undefined;
    const individual = upload
      ? db.individuals.find((p) => p.id === upload.individualId)
      : undefined;
    const site = upload
      ? db.sites.find((s) => s.id === upload.siteId)
      : undefined;

    // Protocol handoff into the delegation system: ensure a template,
    // activate it for the site, assign to the individual, and seed the
    // editable training draft. Direct store inserts (like the SQL RPC does
    // inside its SECURITY DEFINER boundary) so the documents.review gate
    // that authorized activation isn't second-guessed by delegation.* gates
    // the reviewer may not hold. The draft still enters the normal
    // draft → review → approve → publish loop for DPM/RN sign-off.
    if (item.itemType === "protocol_needs_delegation") {
      if (!upload || !individual || !site) {
        throw new Error("Upload context is incomplete for the delegation handoff.");
      }
      const protocolName =
        (typeof item.detail.protocol_name === "string" &&
          item.detail.protocol_name.trim()) ||
        item.title.trim() ||
        "PCSP protocol";
      let template = db.delegationTemplates.find(
        (t) =>
          (t.agencyId === session.agencyId || t.agencyId === null) &&
          t.active &&
          t.name.toLowerCase() === protocolName.toLowerCase(),
      );
      if (!template) {
        template = {
          id: `tpl-${crypto.randomUUID()}`,
          agencyId: session.agencyId,
          name: protocolName,
          category: "Health monitoring",
          sections: {
            purpose:
              (typeof item.detail.description === "string" &&
                item.detail.description) ||
              "",
            steps: [],
            safetyWarnings: [],
            documentation: [],
          },
          individualizationNote: `Seeded from PCSP extraction. Individualize before publication. ${DOCUMENT_DIGITAL_MARK}`,
          active: true,
        } satisfies import("../delegation/delegation").DelegationTemplate;
        db.delegationTemplates.push(template);
      }
      let activation = db.siteDelegationActivations.find(
        (a) =>
          a.templateId === template.id &&
          a.siteId === site.id &&
          a.status === "active",
      );
      if (!activation) {
        activation = {
          id: crypto.randomUUID(),
          agencyId: session.agencyId,
          templateId: template.id,
          templateName: template.name,
          templateCategory: template.category,
          siteId: site.id,
          siteName: site.name,
          status: "active",
          activatedAt: new Date().toISOString(),
          activatedBy: session.userId,
        };
        db.siteDelegationActivations.push(activation);
      }
      let assignment = db.individualDelegationAssignments.find(
        (a) =>
          a.activationId === activation.id &&
          a.individualId === individual.id &&
          a.status === "assigned",
      );
      if (!assignment) {
        assignment = {
          id: crypto.randomUUID(),
          agencyId: session.agencyId,
          activationId: activation.id,
          templateId: template.id,
          templateName: template.name,
          individualId: individual.id,
          individualName: individual.fullName,
          siteId: site.id,
          siteName: site.name,
          status: "assigned",
          assignedAt: new Date().toISOString(),
          assignedBy: session.userId,
        };
        db.individualDelegationAssignments.push(assignment);
        const draft: import("../delegation/delegation").DelegationTrainingMaterial = {
          id: crypto.randomUUID(),
          agencyId: session.agencyId,
          assignmentId: assignment.id,
          status: "draft",
          draftContent: {
            templateId: template.id,
            templateName: template.name,
            individualId: individual.id,
            individualName: individual.fullName,
            siteId: site.id,
            siteName: site.name,
            purpose: template.sections.purpose,
            steps: [...template.sections.steps],
            safetyWarnings: [...template.sections.safetyWarnings],
            documentation: [...template.sections.documentation],
            individualNotes: "",
            individualizationNote: template.individualizationNote,
            generatedMark: DOCUMENT_DIGITAL_MARK,
          },
          publishedContent: null,
          submittedAt: null,
          approvedAt: null,
          approvedBy: null,
        };
        db.delegationTrainingMaterials.push(draft);
      }
      item.detail = {
        ...item.detail,
        delegation_assignment_id: assignment.id,
        delegation_template_id: template.id,
      };
    }

    item.status = "activated";
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: extraction?.uploadId ?? null,
      actor: session.userId,
      action: "item_activated",
      detail: {
        item_id: itemId,
        item_type: item.itemType,
        delegation_assignment_id:
          (item.detail.delegation_assignment_id as string | undefined) ?? null,
      },
    });
    // The item is now tracked: reviewers at the site get a bell notification.
    // (Protocol items already notified training reviewers via the delegation
    // handoff above; this covers the tracking event itself.)
    if (upload) {
      for (const userId of this.delegationHoldersAtSite(
        session.agencyId,
        upload.siteId,
        "documents.review",
      )) {
        this.queueDelegationNotification({
          agencyId: session.agencyId,
          userId,
          type: "document.item_activated",
          title: "Trackable item activated",
          body: `${item.title} is now tracked.`,
          deepLink: `/documents/extractions/${upload.id}`,
          entityType: "document_trackable_item",
          entityId: item.id,
          dedupeKey: `document.item_activated:${item.id}:${userId}`,
        });
      }
    }
    await persistMeta(this.store);
    return item;
  }

  async rejectDocumentUpload(uploadId: string, reason?: string): Promise<void> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const upload = db.documentUploads.find(
      (u) => u.id === uploadId && u.agencyId === session.agencyId,
    );
    if (!upload) throw new Error("Upload not found.");
    accessibleIndividual(this.store, session, upload.individualId);
    if (!canTransitionUpload(upload.status, "rejected")) {
      throw new Error("This upload can no longer be rejected.");
    }
    upload.status = "rejected";
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: upload.id,
      actor: session.userId,
      action: "upload_rejected",
      detail: { reason: reason ?? "" },
    });
    await persistMeta(this.store);
  }

  async getAgencyAiSettings(): Promise<LocalAgencyAiSettings> {
    const session = assertSession(this.store);
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const existing = db.agencyAiSettings.find(
      (s) => s.agencyId === session.agencyId,
    );
    if (existing) return existing;
    const row: LocalAgencyAiSettings = {
      agencyId: session.agencyId,
      aiProcessingEnabled: false,
      model: "gemini-2.5-flash",
      serviceAccountVerifiedAt: null,
      vertexProjectId: null,
    };
    db.agencyAiSettings.push(row);
    return row;
  }

  async setAgencyAiSettings(input: {
    enabled: boolean;
    model: string;
  }): Promise<LocalAgencyAiSettings> {
    const session = assertSession(this.store);
    // Model + enabled flag only — no credential is EVER stored here.
    assertPlatformOperator(session);
    if (!input.model.trim()) throw new Error("A model name is required.");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    let row = db.agencyAiSettings.find((s) => s.agencyId === session.agencyId);
    if (!row) {
      row = {
        agencyId: session.agencyId,
        aiProcessingEnabled: false,
        model: "gemini-2.5-flash",
        serviceAccountVerifiedAt: null,
        vertexProjectId: null,
      };
      db.agencyAiSettings.push(row);
    }
    row.aiProcessingEnabled = input.enabled;
    row.model = input.model.trim();
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: null,
      actor: session.userId,
      action: "ai_settings_changed",
      detail: { enabled: input.enabled, model: row.model },
    });
    await persistMeta(this.store);
    return row;
  }

  async verifyAiServiceAccount(): Promise<{
    ok: boolean;
    projectId?: string;
    error?: string;
  }> {
    // Local/demo has no service account — simulate a successful
    // verification so the settings screen can exercise the flow. Hosted
    // calls the extract-pcsp verify action instead.
    const session = assertSession(this.store);
    assertPlatformOperator(session);
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    let row = db.agencyAiSettings.find((s) => s.agencyId === session.agencyId);
    if (!row) {
      row = {
        agencyId: session.agencyId,
        aiProcessingEnabled: false,
        model: "gemini-2.5-flash",
        serviceAccountVerifiedAt: null,
        vertexProjectId: null,
      };
      db.agencyAiSettings.push(row);
    }
    row.serviceAccountVerifiedAt = new Date().toISOString();
    row.vertexProjectId = "demo-project";
    await persistMeta(this.store);
    return { ok: true, projectId: "demo-project" };
  }

  async addTrackableItem(input: {
    extractionId: string;
    itemType: TrackableItemType;
    title: string;
    detail?: Record<string, unknown>;
    dueDate?: string | null;
    needsHumanCheck?: boolean;
  }): Promise<TrackableItem> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const extraction = db.documentExtractions.find(
      (e) => e.id === input.extractionId && e.agencyId === session.agencyId,
    );
    if (!extraction) throw new Error("Extraction not found.");
    this.assertExtractionAccess(session, extraction.id);
    if (input.dueDate) assertCalendarDate(input.dueDate, "Use a valid due date.");
    if (!input.title.trim()) throw new Error("A title is required.");
    const item: TrackableItem = {
      id: crypto.randomUUID(),
      agencyId: session.agencyId,
      extractionId: input.extractionId,
      itemType: input.itemType,
      title: input.title.trim(),
      detail: input.detail ?? {},
      dueDate: input.dueDate ?? null,
      confidence: null,
      needsHumanCheck: input.needsHumanCheck ?? false,
      status: "proposed",
    };
    db.documentTrackableItems.push(item);
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: extraction.uploadId,
      actor: session.userId,
      action: "item_added",
      detail: { item_id: item.id, title: item.title },
    });
    await persistMeta(this.store);
    return item;
  }

  async removeTrackableItem(itemId: string): Promise<TrackableItem> {
    const session = assertSession(this.store);
    assertCan(session, "documents.review");
    ensureDocumentCollections(this.store);
    const db = this.store.db;
    const item = db.documentTrackableItems.find(
      (i) => i.id === itemId && i.agencyId === session.agencyId,
    );
    if (!item) throw new Error("Trackable item not found.");
    this.assertExtractionAccess(session, item.extractionId);
    if (item.status !== "proposed" && item.status !== "edited") {
      throw new Error("Only proposed or edited items can be removed.");
    }
    item.status = "removed";
    const extraction = db.documentExtractions.find(
      (e) => e.id === item.extractionId,
    );
    logDocumentAudit(this.store, {
      agencyId: session.agencyId,
      uploadId: extraction?.uploadId ?? null,
      actor: session.userId,
      action: "item_removed",
      detail: { item_id: itemId },
    });
    await persistMeta(this.store);
    return item;
  }
}

function weekRangeLabel(weekStart: string): string {
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const [y, m, d] = weekStart.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCDate(end.getUTCDate() + 6);
  const em = end.getUTCMonth() + 1;
  const ed = end.getUTCDate();
  return `${MONTHS[m - 1]} ${d} – ${MONTHS[em - 1]} ${ed}`;
}

export function createLocalApi(store?: MemoryStore) {
  return new LocalApi(store);
}

export { browserStore };
