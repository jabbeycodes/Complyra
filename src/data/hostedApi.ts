import { assertPacketDates, validatePacketSubmission, packetFile, type ConsentPacket, type PacketCreateInput, type PacketEvidence, type PacketChoices, type PacketSignature, type PacketPublicView } from "./consentPackets";
import { RIGHTS_PACKET_COPY_VERSION, rightsCompletionFields, validateRightsCompletion, validateRightsPacketStart } from "./rightsPackets";
import { DEFAULT_CONSENT_TYPES, assertConsentRole, canManageConsents, validateConsentTypes, type ConsentDraft, type ConsentRegister, type ConsentType } from "./consents";
import type { CareAction, CareScreeningData } from "./careScreening";
import { recheckQaItemForScoring } from "./qaAudit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionsHttpError } from "@supabase/supabase-js";
import type { Activity, Plan, Requirement } from "../domain";
import {
  computeRequirementStatus,
  isPrivileged,
  requirementStatusFromDb,
  requirementStatusToDb,
  reviewStatusLabel,
  roleLabel,
} from "./status";
import type { ComplyraApi, QaAuditSummary, WorkspaceView } from "./localApi";
import type {
  AcknowledgmentPacket,
  AcknowledgmentRow,
  AddCertificateInput,
  AddMedDoseExceptionInput,
  AppRole,
  AssignTrainingInput,
  ChecklistAnswer,
  ChecklistAttestation,
  ChecklistItem,
  DelegationFormPatch,
  DelegationTemplateVersion,
  DocumentRecord,
  DocumentVersion,
  ExpiringCertificate,
  HmWeeklyChecklist,
  IndividualRecord,
  AgencyStatus,
  CreateAgencyInput,
  CreateAgencyResult,
  InviteMemberInput,
  InviteMemberResult,
  LegacyLineSignoffInput,
  LoginInput,
  MedDoseException,
  CreateMedicationOrderInput,
  UpdateMedicationOrderInput,
  MedicationOrder,
  MedicationOrderView,
  MedicationReconciliation,
  MedicationReconciliationItem,
  MedicationReconciliationView,
  ReconciliationItemInput,
  ReconciliationTrigger,
  PacketDetail,
  PendingAgency,
  RequestTrainingCorrectionInput,
  RequirementLineSignoffInput,
  RequirementRecord,
  ServiceLogEntry,
  ServiceLogKind,
  SessionUser,
  SiteRecord,
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
  WeeklyChecklistStatus,
  AdoptedSignature,
  AdoptSignatureInput,
  ApplySignatureInput,
  ApplySignatureResult,
  LogSignatureAuditInput,
  SignableDocumentType,
  SignatureAuditRecord,
  SignatureEvent,
  SignatureSettings,
} from "./types";
import { blankDelegationForm } from "./types";
import {
  LOGIN_BAD_PASSWORD_MESSAGE,
  LOGIN_FAILED_MESSAGE,
  LOGIN_NO_MEMBERSHIP_MESSAGE,
  USERNAME_PATTERN,
  normalizeAgencyCode,
  normalizeUsername,
} from "./types";
import { generateTempPassword } from "./agencyCode";
import { canAccessSite } from "./dashboard";
import { portraitSrc } from "./personPortrait";
import { assertCalendarDate, canReadIndividual } from "./access";
import {
  sortLifeEvents,
  toLifeEventView,
  validateLifeEventDraft,
  validateVoidReason,
  type LifeEventDraft,
  type LifeEventRow,
} from "./lifeEvents";
import {
  balanceThroughCents,
  closeForMonth,
  closedMonthMessage,
  monthEndIso,
  toHouseCardEntryView,
  validateHouseCardDraft,
  validateHouseCardMonth,
  validateHouseCardSignature,
  validateHouseCardVoidReason,
  type HouseCardEntryDraft,
  type HouseCardEntryRow,
  type HouseCardEntryView,
  type HouseCardMonthClose,
  type HouseCardReceiptPhoto,
} from "./houseCard";
import {
  balanceThroughCents as personalBalanceThroughCents,
  buildPersonalSpendingViews,
  closedMonthMessage as personalClosedMonthMessage,
  monthEndIso as personalMonthEndIso,
  validatePersonalSpendingCloseDraft,
  validatePersonalSpendingDraft,
  validatePersonalSpendingVoidReason,
  type PersonalSpendingCloseDraft,
  type PersonalSpendingEntryDraft,
  type PersonalSpendingEntryRow,
  type PersonalSpendingMonthClose,
  type PersonalSpendingReceiptPhoto,
} from "./personalSpending";
import { addDaysIso, centralTodayIso } from "./menuRecords";
import { assertSiteHasCapacity } from "./siteCapacity";
import {
  appointmentChangeDetail,
  assertConsultationUpload,
  canCompleteAppointments,
  canEditAllergies,
  canManageAppointments,
  canSeeAppointments,
  isAppointmentRemoved,
  validateAppointmentDraft,
  visibleAppointments,
  type Appointment,
  type AppointmentDraft,
} from "./appointments";
import {
  assertAdoptableSignature,
  dataUrlToBlob,
  EdgeFunctionError,
  formatSignatureDate,
  getDeviceId,
  ReauthRequiredError,
} from "../features/signatures/signatureUtils";
import {
  legacyTrainingDocId,
  trainingChecklistDocId,
} from "../features/signatures/documentPayloads";
import {
  hasBackfillMarker,
  stripBackfillMarker,
  withBackfillMarker,
} from "./mileage";
import {
  assembleMessageViews,
  assembleThreadView,
  firstUnreadMessageId,
  isMessagingRole,
  messageDedupeKey,
  messagePreview,
  sortThreads,
  validateMessageBody,
  validateRecipientIds,
  validateThreadSubject,
  type MessageParticipantRow,
  type MessageRow,
  type MessageThreadRow,
} from "./messaging";
import {
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_BY_KEY,
  capabilityForRoleKey,
  canConfigureIspTasks,
  canCreateIndividual,
  canEnterShiftNotes,
  canRecordLifeEvents,
  canGrantRole,
  canManageMedicationOrders,
  canSeeShiftNotes,
  canSignReconciliation,
  canStartReconciliation,
  canViewMedicationOrders,
  canUseMessaging,
  canEnterMenuEntries,
  canSeeMenuEntries,
  canViewHouseCard,
  canRecordHouseCard,
  canCloseHouseCardMonth,
  canViewPersonalSpending,
  canRecordPersonalSpending,
  canClosePersonalSpendingMonth,
  defaultPermissions,
  hasPermission,
  isRoleKey,
  PLAN_SIGNER_ROLE_KEYS,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";
import {
  canEditShiftNoteRow,
  displayStaffTitle,
  ispProgramVisibleToStaff,
  normalizeTaskTitle,
  progressNoteProblem,
  shiftDurationMinutes,
  type IspProgram,
  type IspProgramView,
  type IspScoringMethod,
  type ShiftNoteView,
  type SiteShiftNoteView,
} from "./shiftNotes";
import {
  canEditMenuEntryRow,
  MEAL_SLOTS,
  AMOUNT_EATEN_OPTIONS,
  type MenuEntryHistory,
  type MenuEntryView,
} from "./menuRecords";
import { isValidRating } from "../recognition/scoring";
import {
  allergiesChangeDetail,
  applyRenewalUpload,
  canEditCover,
  canEditExtraction,
  canSeeRenewals,
  canSignAsDelegatingRn,
  canToggleDelegation,
  canUploadRenewal,
  defaultRenewals,
  emptyProfile,
  isObligationActive,
  nextAllergiesStamp,
  normalizeAllergies,
  normalizeGuardianContacts,
  normalizeProfile,
  normalizeProviderContacts,
  renewalStatus,
  requiredForSigning,
  sortObligations,
  staffCanSignDelegation,
  type Allergy,
  type ClinicalEvidenceKind,
  type ClinicalRenewal,
  type GuardianContact,
  type IndividualProfile,
  type ObligationItem,
  type ObligationSignature,
  type PlanStackView,
  type ProviderContact,
} from "./planStack";
import {
  allLinesInitialed,
  canEditDiagnoses,
  canEditIndividualContacts,
  canEditTrainingLine,
  canCorrectDoseMark,
  canLogDoseException,
  canLogPrnDose,
  canRecordDelivery,
  canRequestTrainingCorrection,
  canSeeMeds,
  canSignTrainingAsHm,
  toMedicationView,
  todayIso,
  trainingLinesFromObligations,
  trainingStatus,
  type Medication,
  type TrainingChecklist,
} from "./chart";
import {
  buildSiteDueItems,
  canEditAloneTime,
  computeMedDueItems,
  computeShiftNoteDueItems,
  blockForShiftLabel,
  matchingShiftId,
  shiftBlocksForSite,
  zonedWallTimeMs,
  consecutiveRefusals,
  marRecordingProblem,
  recordingCostsAPoint,
  type ScheduledDose,
  type ShiftBlockId,
} from "./dueItems";
import { clockInIsLate, prnFollowupStillOpen, recognitionAwardProblem } from "./lateness";
import { agencyClock, dueItemClock, operatingReminderNotices, reminderRecipientIds } from "./operatingReminders";
import {
  accountabilityDates,
  checklistAccountabilityItems,
  computeShiftAccountability,
  ispAccountabilityItems,
  medicationAccountabilityItems,
  menuAccountabilityItems,
  shiftNoteAccountabilityItems,
  type AccountabilityDueItem,
  type AccountabilityShift,
} from "./shiftAccountability";
import { operatingRulesFrom, type EffectiveRule } from "./rules";
// Delegation template workflow: domain types + helpers.
import {
  DIGITAL_RECORD_MARK,
  isAcknowledgmentOverdue,
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
// PCSP-EXTRACTION: document pipeline types.
import type {
  DocumentStatus,
  DocumentType,
  DocumentUpload,
  TrackableItem,
  TrackableItemType,
} from "./documents";
import type { LocalAgencyAiSettings, LocalDocumentExtraction } from "./seed";
// LIFEPATH-P4 (certificates): expiry countdown + file validation helpers.
import {
  daysRemaining,
  validateCertificateDates,
  validateCertificateFile,
} from "./certificates";
// AUDIT-READINESS: corrective-action row mapping + validation.
import {
  buildCorrectiveActionRow,
  correctiveActionFromRow,
  deriveCorrectiveActionStatus,
  sortCorrectiveActions,
  validateCorrectiveActionInput,
  type AddCorrectiveActionInput,
  type CorrectiveAction,
  type UpdateCorrectiveActionInput,
} from "./correctiveActions";
// THERAP-CORE-GAPS-1: event reports, behavior supports, health trackers.
import {
  buildGerReportRow,
  canDecideGerReport,
  canEditGerReportBody,
  canViewGerReports,
  gerNeedsFollowUp,
  gerReportFromRow,
  gerSubmitNotificationTargets,
  sortGerReports,
  validateGerDraft,
  validateGerResolution,
  type GerReport,
  type GerReportDraft,
  type GerResolutionPatch,
} from "./ger";
import {
  behaviorEntryFromRow,
  behaviorPlanFromRow,
  buildBehaviorEntryRow,
  buildBehaviorPlanRow,
  canCorrectBehaviorEntry,
  canManageBehaviorPlan,
  canRecordBehavior,
  canViewBehavior,
  validateBehaviorCorrection,
  validateBehaviorEntryDraft,
  validateBehaviorPlanDraft,
  type BehaviorEntry,
  type BehaviorEntryDraft,
  type BehaviorPlan,
  type BehaviorPlanDraft,
} from "./behavior";
import {
  buildHealthTrackRow,
  canCorrectHealthTrackEntry,
  canRecordHealthEntry,
  canViewHealthTrack,
  healthAlertTargets,
  healthEntryNeedsAlert,
  healthTrackEntryFromRow,
  healthTrackTitle,
  isImmunizationOverdue,
  validateHealthCorrection,
  lowFluidAlertTargets,
  lowFluidDays,
  validateHealthTrackDraft,
  type HealthTrackEntry,
  type HealthTrackEntryDraft,
  type HealthTrackKind,
} from "./healthTrack";
// AUDIT-READINESS: score snapshot rows for the trend chart.
import {
  buildScoreSnapshotRow,
  type ComplianceScore,
  type ScoreSnapshot,
} from "./complianceScore";
import {
  DEFAULT_MONTHLY_DUE,
  blankSafetyLines,
  canCompleteMonthly,
  canConfigureMonthlyDue,
  canManageEquipment,
  drillComplete,
  drillDateConflict,
  drillDateConflictMessage,
  drillsForMonth,
  equipmentViewForPerson,
  monthKeyFrom,
  monthLabel,
  normalizeMonthlyDue,
  safetyComplete,
  siteSafetyView,
  type AdaptiveEquipment,
  type DrillType,
  type SafetyLine,
} from "./monthlyChecks";
// QA-AUDIT (2026-09-14): pure checklist/scoring module + row mappers.
import {
  expandAndVerifyQaItems,
  mapQaAuditItemRow,
  mapQaAuditRow,
  mapQaScheduleRow,
  qaAuditItemToRow,
} from "./qaAuditApi";
import {
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
  type QaAutoVerifyContext,
  type QaPhotoInput,
  type QaRankedSite,
} from "./qaAudit";
import {
  applyWellWaterDefault,
  blankSiteReview,
  buildPreSurveyRow,
  canEditSiteReview,
  monthlySafetyOnFile,
  normalizeSiteFacts,
  normalizeSiteReview,
  type SiteFacts,
} from "./siteReview";
import { agencyStateCode, siteLocationFrom, type SiteAddressParts } from "./siteAddress";
import {
  blobToDataUrl,
  canManageAgencyLogo,
  validateLogoFile,
} from "./branding";
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
  buildHmChecklistsPdf,
  buildServiceLogsPdf,
  hmChecklistsFileName,
  serviceLogsFileName,
} from "../pdf/checklistsPdf";
import {
  buildDrillSchedulePdf,
  drillScheduleFileName,
} from "../pdf/drillSchedulePdf";
import { drillExportScopeLabel, drillScheduleYearSummary } from "./drillSchedule";
import {
  buildDrillsMonthPdf,
  buildEquipmentMonthPdf,
  buildSafetyMonthPdf,
  drillsFileName,
  equipmentFileName,
  safetyFileName,
} from "../pdf/monthlyChecksPdf";
import {
  buildPreSurveyPdf,
  buildSiteReviewPdf,
  preSurveyFileName,
  siteReviewFileName,
} from "../pdf/siteReviewPdf";
import {
  mapAdaptiveEquipment,
  mapAppointment,
  mapChartFile,
  mapClinicalRenewal,
  mapEmergencyDrill,
  mapEquipmentMonthLog,
  mapHomeSafetyReport,
  mapMedication,
  mapMedicationOrder,
  mapMedicationReconciliation,
  mapMedicationReconciliationItem,
  mapObligation,
  mapObligationSignature,
  mapDelegationForm,
  mapSiteReview,
  mapTrainingChecklist,
  obligationPatch,
  profileFromRow,
} from "./hostedMappers";
import {
  buildReconciliationChecklist,
  compareOrderExpiry,
  daysUntilReview,
  isReconciliationTrigger,
  medicationStaysOnMar,
  orderExpiry,
  projectOrderToMedication,
  validateOrderInput,
  validateReconciliationItems,
} from "./medicationOrders";
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

const BUCKET = "agency-documents";
const CHART_BUCKET = "care-plan-docs";
const ASSETS_BUCKET = "agency-assets";

function throwIf(error: { message: string } | null | undefined, fallback: string) {
  if (error) throw new Error(error.message || fallback);
}

function asRole(value: string): AppRole {
  if (
    value === "administrator" ||
    value === "compliance_admin" ||
    value === "manager" ||
    value === "dsp" ||
    value === "nurse" ||
    value === "hr" ||
    value === "auditor"
  ) {
    return value;
  }
  return "dsp";
}

function activityKind(action: string): Activity["kind"] {
  if (action.includes("complete") || action.includes("signed")) return "complete";
  if (action.includes("review") || action.includes("approved")) return "review";
  if (action.includes("overdue")) return "alert";
  return "document";
}

/**
 * Invoke a Supabase edge function and surface application errors faithfully.
 * supabase-js surfaces non-2xx responses as FunctionsHttpError with the
 * structured body on `error.context`; this helper parses `{error, code}` so
 * the UI can act on machine-readable codes (e.g. `reauth_required` opens the
 * password sheet). A 200 response carrying an error envelope is handled too.
 */
async function invokeEdgeFunction<T>(
  client: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) {
    if (data && typeof data === "object" && "error" in data) {
      throw edgeErrorFromBody(data as { error?: unknown; code?: unknown }, undefined);
    }
    return data as T;
  }
  if (error instanceof FunctionsHttpError) {
    try {
      const bodyText = await error.context.text();
      const parsed = bodyText ? (JSON.parse(bodyText) as { error?: unknown; code?: unknown }) : {};
      throw edgeErrorFromBody(parsed, error);
    } catch (err) {
      if (err instanceof EdgeFunctionError || err instanceof ReauthRequiredError) throw err;
      // Body wasn't JSON — fall through to the generic message below.
    }
  }
  throw new Error(error.message ?? "The signature service is unavailable.");
}

/**
 * Map an edge-function `{error, code}` body to the matching client error.
 * Exported for contract tests: the UI opens the password sheet exactly when
 * the server answers code "reauth_required".
 */
export function edgeErrorFromBody(
  parsed: { error?: unknown; code?: unknown },
  cause: unknown,
): Error {
  const message =
    typeof parsed.error === "string" && parsed.error
      ? parsed.error
      : "The signature service returned an unexpected response.";
  const code = typeof parsed.code === "string" ? parsed.code : undefined;
  if (code === "reauth_required") {
    const err = new ReauthRequiredError(message);
    (err as { cause?: unknown }).cause = cause;
    return err;
  }
  const err = new EdgeFunctionError(message, code);
  (err as { cause?: unknown }).cause = cause;
  return err;
}

export class HostedApi implements ComplyraApi {
  async getCareScreeningData(individualId?: string): Promise<CareScreeningData> {
    const session = await this.requireSession();
    const {data, error} = await this.client.rpc('get_care_screening_data', {p_agency_id: session.agencyId, p_individual_id: individualId ?? null});
    throwIf(error, 'Could not load care records.');
    return data as CareScreeningData;
  }
  async mutateCareScreening(input: CareAction) {
    const session = await this.requireSession();
    const {error} = await this.client.rpc('mutate_care_screening', {p_agency_id: session.agencyId, p_input: input});
    throwIf(error, 'Could not save care records.');
  }
  async sweepCareScreening() {
    const session = await this.requireSession();
    const {error} = await this.client.rpc('sweep_care_screening', {p_agency_id: session.agencyId});
    throwIf(error, 'Could not refresh care reminders.');
  }
  constructor(private readonly client: SupabaseClient) {}

  // ── LIFE EVENTS — per-Individual timeline (hosted) ────────────────────
  // Mirrors LocalApi semantics exactly. The DB layer backstops everything
  // (supabase/migrations/20261027190000_life_events.sql): RLS scopes reads
  // to Individual readers, writes to the editor roles in scope, voids are
  // reasoned updates, and there is no delete path. No notifications are
  // emitted here — life events are context, not compliance.

  private lifeEventFromRow(row: Record<string, unknown>): LifeEventRow {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      individualId: row.individual_id as string,
      eventDate: row.event_date as string,
      category: row.category as string,
      title: row.title as string,
      note: (row.note as string) ?? "",
      relatedGerId: (row.related_ger_id as string | null) ?? null,
      recordedBy: row.recorded_by as string,
      createdAt: row.created_at as string,
      updatedBy: (row.updated_by as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
      voidedBy: (row.voided_by as string | null) ?? null,
      voidedAt: (row.voided_at as string | null) ?? null,
      voidReason: (row.void_reason as string | null) ?? null,
    };
  }

  private async lifeEventNames(userIds: string[]) {
    const names = new Map<string, string>();
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return names;
    const { data } = await this.client
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    for (const row of data ?? []) {
      const record = row as { id: string; full_name: string };
      names.set(record.id, record.full_name);
    }
    return names;
  }

  private async lifeEventView(row: LifeEventRow) {
    const names = await this.lifeEventNames(
      [row.recordedBy, row.updatedBy, row.voidedBy].filter(
        (id): id is string => Boolean(id),
      ),
    );
    return toLifeEventView(row, (userId) => names.get(userId) ?? "Staff member");
  }

  private assertLifeEventEditor(session: SessionUser) {
    if (!canRecordLifeEvents(session)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  /** The Individual, if this session may read them; otherwise throws. */
  private async assertLifeEventReadable(
    session: SessionUser,
    individualId: string,
  ) {
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const { data } = await this.client
      .from("staff_assignments")
      .select("*")
      .eq("agency_id", session.agencyId);
    const assignments = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as string,
        agencyId: record.agency_id as string,
        userId: record.user_id as string,
        individualId: (record.individual_id as string | null) ?? null,
        siteId: (record.site_id as string | null) ?? null,
        startsOn: record.starts_on as string,
        endsOn: (record.ends_on as string | null) ?? null,
      };
    });
    if (!canReadIndividual(session, person, assignments, [person])) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    return person;
  }

  private async requireLifeEventRow(session: SessionUser, lifeEventId: string) {
    const { data, error } = await this.client
      .from("life_events")
      .select("*")
      .eq("id", lifeEventId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load that life event.");
    if (!data) throw new Error("Life event not found.");
    return this.lifeEventFromRow(data as Record<string, unknown>);
  }

  async listLifeEvents(individualId: string) {
    const session = await this.requireSession();
    try {
      await this.assertLifeEventReadable(session, individualId);
    } catch {
      return [];
    }
    const { data, error } = await this.client
      .from("life_events")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .is("voided_at", null)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false });
    throwIf(error, "Could not load life events.");
    const rows = (data ?? []).map((row) =>
      this.lifeEventFromRow(row as Record<string, unknown>),
    );
    const names = await this.lifeEventNames(
      rows.flatMap((row) =>
        [row.recordedBy, row.updatedBy, row.voidedBy].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
    return sortLifeEvents(rows).map((row) =>
      toLifeEventView(row, (userId) => names.get(userId) ?? "Staff member"),
    );
  }

  async createLifeEvent(input: {
    individualId: string;
    eventDate: string;
    category: string;
    title: string;
    note?: string;
    relatedGerId?: string | null;
  }) {
    const session = await this.requireSession();
    this.assertLifeEventEditor(session);
    const person = await this.assertLifeEventReadable(session, input.individualId);
    const draft = validateLifeEventDraft(input);
    const { data, error } = await this.client
      .from("life_events")
      .insert({
        agency_id: session.agencyId,
        site_id: person.siteId,
        individual_id: person.id,
        event_date: draft.eventDate,
        category: draft.category,
        title: draft.title,
        note: draft.note,
        related_ger_id: draft.relatedGerId,
        recorded_by: session.userId,
      })
      .select("*")
      .single();
    throwIf(error, "Could not save that life event.");
    return this.lifeEventView(
      this.lifeEventFromRow(data as Record<string, unknown>),
    );
  }

  async updateLifeEvent(lifeEventId: string, patch: LifeEventDraft) {
    const session = await this.requireSession();
    this.assertLifeEventEditor(session);
    const existing = await this.requireLifeEventRow(session, lifeEventId);
    if (existing.voidedAt) {
      throw new Error("A voided life event cannot be changed.");
    }
    await this.assertLifeEventReadable(session, existing.individualId);
    const draft = validateLifeEventDraft(patch);
    const { data, error } = await this.client
      .from("life_events")
      .update({
        event_date: draft.eventDate,
        category: draft.category,
        title: draft.title,
        note: draft.note,
        related_ger_id: draft.relatedGerId,
      })
      .eq("id", existing.id)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not update that life event.");
    return this.lifeEventView(
      this.lifeEventFromRow(data as Record<string, unknown>),
    );
  }

  async voidLifeEvent(lifeEventId: string, reason: string) {
    const session = await this.requireSession();
    this.assertLifeEventEditor(session);
    const existing = await this.requireLifeEventRow(session, lifeEventId);
    if (existing.voidedAt) {
      throw new Error("That life event is already voided.");
    }
    await this.assertLifeEventReadable(session, existing.individualId);
    const voidReason = validateVoidReason(reason);
    const { data, error } = await this.client
      .from("life_events")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: session.userId,
        void_reason: voidReason,
      })
      .eq("id", existing.id)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not void that life event.");
    return this.lifeEventView(
      this.lifeEventFromRow(data as Record<string, unknown>),
    );
  }

  // ── HOUSE CARD — per-home petty cash ledger (hosted) ───────────────
  // Mirrors LocalApi semantics exactly. The DB backstops everything
  // (supabase/migrations/20261029130000_house_card.sql): RLS scopes reads
  // to the ledger's reader roles at readable sites, writes to the
  // recorder roles in scope, voids are reasoned updates, and there is no
  // delete path. Until that migration is applied these queries fail and
  // the House Card tab shows its own contained error state.

  private houseCardFromRow(row: Record<string, unknown>): HouseCardEntryRow {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      entryDate: String(row.entry_date).slice(0, 10),
      kind: row.kind as HouseCardEntryRow["kind"],
      location: (row.location as string) ?? "",
      amountCents: Number(row.amount_cents),
      category: (row.category as HouseCardEntryRow["category"]) ?? null,
      individualId: (row.individual_id as string | null) ?? null,
      note: (row.note as string) ?? "",
      receiptPhoto:
        (row.receipt_photo as HouseCardReceiptPhoto | null) ?? null,
      recordedBy: row.recorded_by as string,
      recordedByName: (row.recorded_by_name as string) ?? "",
      recordedByRole: (row.recorded_by_role as string) ?? "",
      createdAt: row.created_at as string,
      voidedBy: (row.voided_by as string | null) ?? null,
      voidedAt: (row.voided_at as string | null) ?? null,
      voidReason: (row.void_reason as string | null) ?? null,
      replacesEntryId: (row.replaces_entry_id as string | null) ?? null,
      replacedByEntryId: (row.replaced_by_entry_id as string | null) ?? null,
    };
  }

  private houseCardCloseFromRow(
    row: Record<string, unknown>,
  ): HouseCardMonthClose {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      month: String(row.month).slice(0, 7),
      closingBalanceCents: Number(row.closing_balance_cents),
      printedName: (row.printed_name as string) ?? "",
      signatureText: (row.signature_text as string) ?? "",
      signedBy: row.signed_by as string,
      signedByName: (row.signed_by_name as string) ?? "",
      signedAt: row.signed_at as string,
      createdAt: row.created_at as string,
    };
  }

  private assertHouseCardViewer(session: SessionUser) {
    if (!canViewHouseCard(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private assertHouseCardRecorder(session: SessionUser) {
    if (!canRecordHouseCard(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  /** The home must exist in the agency AND sit inside the session's scope. */
  private async assertHouseCardSite(session: SessionUser, siteId: string) {
    await this.assertSiteInAgency(session, siteId);
    if (!canAccessSite(session, siteId)) {
      throw new Error("Home not found.");
    }
  }

  private async houseCardClosesFor(session: SessionUser, siteId: string) {
    const { data, error } = await this.client
      .from("house_card_month_closes")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .order("month", { ascending: false });
    throwIf(error, "Could not load the house card sign-offs.");
    return (data ?? []).map((row) =>
      this.houseCardCloseFromRow(row as Record<string, unknown>),
    );
  }

  private async houseCardViewList(
    session: SessionUser,
    rows: HouseCardEntryRow[],
    closes: HouseCardMonthClose[],
  ): Promise<HouseCardEntryView[]> {
    const names = await this.lifeEventNames(
      rows.flatMap((row) =>
        [row.recordedBy, row.voidedBy].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
    const individualIds = [
      ...new Set(
        rows
          .map((row) => row.individualId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const individualNames = new Map<string, string>();
    if (individualIds.length) {
      const { data } = await this.client
        .from("individuals")
        .select("id, full_name")
        .eq("agency_id", session.agencyId)
        .in("id", individualIds);
      for (const row of data ?? []) {
        const record = row as { id: string; full_name: string };
        individualNames.set(record.id, record.full_name);
      }
    }
    return rows.map((row) =>
      toHouseCardEntryView(
        row,
        row.individualId
          ? (individualNames.get(row.individualId) ?? "Former Individual")
          : null,
        (userId) => names.get(userId) ?? row.recordedByName ?? "Staff member",
        closeForMonth(closes, monthKeyFrom(row.entryDate)),
      ),
    );
  }

  private async houseCardIndividualOrThrow(
    session: SessionUser,
    siteId: string,
    individualId: string,
  ) {
    const { data, error } = await this.client
      .from("individuals")
      .select("id, site_id")
      .eq("id", individualId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not verify the Individual.");
    if (!data || (data as { site_id: string }).site_id !== siteId) {
      throw new Error("That Individual is not part of this home.");
    }
  }

  private async assertHouseCardMonthOpen(
    session: SessionUser,
    siteId: string,
    entryDate: string,
  ) {
    const month = monthKeyFrom(entryDate);
    const { data, error } = await this.client
      .from("house_card_month_closes")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .eq("month", month)
      .maybeSingle();
    throwIf(error, "Could not check whether the month is closed.");
    if (data) throw new Error(closedMonthMessage(monthLabel(month)));
  }

  async listHouseCardEntries(siteId: string) {
    const session = await this.requireSession();
    this.assertHouseCardViewer(session);
    await this.assertHouseCardSite(session, siteId);
    const { data, error } = await this.client
      .from("house_card_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    throwIf(error, "Could not load the house card ledger.");
    const rows = (data ?? []).map((row) =>
      this.houseCardFromRow(row as Record<string, unknown>),
    );
    const closes = await this.houseCardClosesFor(session, siteId);
    return this.houseCardViewList(session, rows, closes);
  }

  async createHouseCardEntry(
    input: { siteId: string } & HouseCardEntryDraft,
  ) {
    const session = await this.requireSession();
    this.assertHouseCardRecorder(session);
    await this.assertHouseCardSite(session, input.siteId);
    const draft = validateHouseCardDraft(input, centralTodayIso());
    if (draft.individualId) {
      await this.houseCardIndividualOrThrow(
        session,
        input.siteId,
        draft.individualId,
      );
    }
    await this.assertHouseCardMonthOpen(session, input.siteId, draft.entryDate);
    const { data, error } = await this.client
      .from("house_card_entries")
      .insert({
        agency_id: session.agencyId,
        site_id: input.siteId,
        entry_date: draft.entryDate,
        kind: draft.kind,
        location: draft.location,
        amount_cents: draft.amountCents,
        category: draft.category,
        individual_id: draft.individualId,
        note: draft.note,
        receipt_photo: draft.receiptPhoto,
        recorded_by: session.userId,
        recorded_by_name: session.fullName,
        recorded_by_role: session.roleKey,
      })
      .select("*")
      .single();
    throwIf(error, "Could not save that house card entry.");
    const row = this.houseCardFromRow(data as Record<string, unknown>);
    const closes = await this.houseCardClosesFor(session, input.siteId);
    const [view] = await this.houseCardViewList(session, [row], closes);
    return view;
  }

  async voidHouseCardEntry(
    entryId: string,
    reason: string,
    replacement?: ({ siteId: string } & HouseCardEntryDraft) | null,
  ) {
    const session = await this.requireSession();
    this.assertHouseCardRecorder(session);
    const { data: existingData, error: fetchError } = await this.client
      .from("house_card_entries")
      .select("*")
      .eq("id", entryId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(fetchError, "Could not load that house card entry.");
    if (!existingData) throw new Error("House card entry not found.");
    const existing = this.houseCardFromRow(
      existingData as Record<string, unknown>,
    );
    await this.assertHouseCardSite(session, existing.siteId);
    if (existing.voidedAt) {
      throw new Error("That entry is already voided.");
    }
    const voidReason = validateHouseCardVoidReason(reason);

    // Validate + insert the replacement BEFORE voiding, so a failed
    // replacement never leaves a half-applied correction behind.
    let replacementRow: HouseCardEntryRow | null = null;
    if (replacement) {
      if (replacement.siteId !== existing.siteId) {
        throw new Error("The replacement must belong to the same home.");
      }
      const draft = validateHouseCardDraft(replacement, centralTodayIso());
      if (draft.individualId) {
        await this.houseCardIndividualOrThrow(
          session,
          existing.siteId,
          draft.individualId,
        );
      }
      if (monthKeyFrom(draft.entryDate) !== monthKeyFrom(existing.entryDate)) {
        await this.assertHouseCardMonthOpen(
          session,
          existing.siteId,
          draft.entryDate,
        );
      }
      const { data, error } = await this.client
        .from("house_card_entries")
        .insert({
          agency_id: session.agencyId,
          site_id: existing.siteId,
          entry_date: draft.entryDate,
          kind: draft.kind,
          location: draft.location,
          amount_cents: draft.amountCents,
          category: draft.category,
          individual_id: draft.individualId,
          note: draft.note,
          receipt_photo: draft.receiptPhoto,
          recorded_by: session.userId,
          recorded_by_name: session.fullName,
          recorded_by_role: session.roleKey,
          replaces_entry_id: existing.id,
        })
        .select("*")
        .single();
      throwIf(error, "Could not save the replacement entry.");
      replacementRow = this.houseCardFromRow(data as Record<string, unknown>);
    }

    const { data, error } = await this.client
      .from("house_card_entries")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: session.userId,
        void_reason: voidReason,
        replaced_by_entry_id: replacementRow?.id ?? null,
      })
      .eq("id", existing.id)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not void that entry.");
    const voidedRow = this.houseCardFromRow(data as Record<string, unknown>);
    const closes = await this.houseCardClosesFor(session, existing.siteId);
    const views = await this.houseCardViewList(
      session,
      replacementRow ? [voidedRow, replacementRow] : [voidedRow],
      closes,
    );
    return {
      voided: views[0],
      replacement: replacementRow ? views[1] : null,
    };
  }

  async listHouseCardMonthCloses(siteId: string) {
    const session = await this.requireSession();
    this.assertHouseCardViewer(session);
    await this.assertHouseCardSite(session, siteId);
    return this.houseCardClosesFor(session, siteId);
  }

  async closeHouseCardMonth(input: {
    siteId: string;
    month: string;
    signatureText: string;
  }) {
    const session = await this.requireSession();
    if (!canCloseHouseCardMonth(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
    await this.assertHouseCardSite(session, input.siteId);
    const month = validateHouseCardMonth(input.month);
    const signatureText = validateHouseCardSignature(input.signatureText);
    const closes = await this.houseCardClosesFor(session, input.siteId);
    if (closeForMonth(closes, month)) {
      throw new Error(`${monthLabel(month)} is already closed and signed.`);
    }
    const { data: entryData, error: entryError } = await this.client
      .from("house_card_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", input.siteId)
      .lte("entry_date", monthEndIso(month));
    throwIf(entryError, "Could not total the month before closing it.");
    const entries = (entryData ?? []).map((row) =>
      this.houseCardFromRow(row as Record<string, unknown>),
    );
    const { data, error } = await this.client
      .from("house_card_month_closes")
      .insert({
        agency_id: session.agencyId,
        site_id: input.siteId,
        month,
        closing_balance_cents: balanceThroughCents(entries, monthEndIso(month)),
        printed_name: session.fullName,
        signature_text: signatureText,
        signed_by: session.userId,
        signed_by_name: session.fullName,
      })
      .select("*")
      .single();
    throwIf(error, "Could not close the month.");
    return this.houseCardCloseFromRow(data as Record<string, unknown>);
  }

  // ── PERSONAL SPENDING — one Individual's own money (hosted) ────────
  // Mirrors LocalApi semantics exactly. The DB backstops everything
  // (supabase/migrations/20261029130100_personal_spending.sql): RLS
  // scopes reads and writes through private.can_read_individual plus
  // the reader/recorder role lists, voids are reasoned updates, and
  // there is no delete path. Until that migration is applied these
  // queries fail and the chart section shows its own contained error
  // state. SEPARATE from the house card: different tables, different
  // money, no shared rows.

  private personalSpendingFromRow(
    row: Record<string, unknown>,
  ): PersonalSpendingEntryRow {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      individualId: row.individual_id as string,
      entryDate: String(row.entry_date).slice(0, 10),
      kind: row.kind as PersonalSpendingEntryRow["kind"],
      location: (row.location as string) ?? "",
      purpose: (row.purpose as string) ?? "",
      amountCents: Number(row.amount_cents),
      note: (row.note as string) ?? "",
      receiptPhoto:
        (row.receipt_photo as PersonalSpendingReceiptPhoto | null) ?? null,
      recordedBy: row.recorded_by as string,
      recordedByName: (row.recorded_by_name as string) ?? "",
      recordedByRole: (row.recorded_by_role as string) ?? "",
      createdAt: row.created_at as string,
      voidedBy: (row.voided_by as string | null) ?? null,
      voidedAt: (row.voided_at as string | null) ?? null,
      voidReason: (row.void_reason as string | null) ?? null,
      replacesEntryId: (row.replaces_entry_id as string | null) ?? null,
      replacedByEntryId: (row.replaced_by_entry_id as string | null) ?? null,
    };
  }

  private personalSpendingCloseFromRow(
    row: Record<string, unknown>,
  ): PersonalSpendingMonthClose {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      individualId: row.individual_id as string,
      month: String(row.month).slice(0, 7),
      closingBalanceCents: Number(row.closing_balance_cents),
      printedName: (row.printed_name as string) ?? "",
      signatureText: (row.signature_text as string) ?? "",
      signedBy: row.signed_by as string,
      signedByName: (row.signed_by_name as string) ?? "",
      signedAt: row.signed_at as string,
      createdAt: row.created_at as string,
      individualSignoff:
        row.individual_signoff as PersonalSpendingMonthClose["individualSignoff"],
      secondStaffId: (row.second_staff_id as string | null) ?? null,
      secondStaffName: (row.second_staff_name as string | null) ?? null,
      secondStaffSignatureText:
        (row.second_staff_signature as string | null) ?? null,
    };
  }

  private assertPersonalSpendingViewer(session: SessionUser) {
    if (!canViewPersonalSpending(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private assertPersonalSpendingRecorder(session: SessionUser) {
    if (!canRecordPersonalSpending(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  /** The Individual, if this session may read them; otherwise throws. */
  private async assertPersonalSpendingReadable(
    session: SessionUser,
    individualId: string,
  ) {
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const { data } = await this.client
      .from("staff_assignments")
      .select("*")
      .eq("agency_id", session.agencyId);
    const assignments = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as string,
        agencyId: record.agency_id as string,
        userId: record.user_id as string,
        individualId: (record.individual_id as string | null) ?? null,
        siteId: (record.site_id as string | null) ?? null,
        startsOn: record.starts_on as string,
        endsOn: (record.ends_on as string | null) ?? null,
      };
    });
    if (!canReadIndividual(session, person, assignments, [person])) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    return person;
  }

  private async personalSpendingClosesFor(
    session: SessionUser,
    individualId: string,
  ) {
    const { data, error } = await this.client
      .from("personal_spending_month_closes")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("month", { ascending: false });
    throwIf(error, "Could not load the personal spending sign-offs.");
    return (data ?? []).map((row) =>
      this.personalSpendingCloseFromRow(row as Record<string, unknown>),
    );
  }

  private async personalSpendingViewsFor(
    session: SessionUser,
    individualId: string,
  ) {
    const { data, error } = await this.client
      .from("personal_spending_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    throwIf(error, "Could not load the personal spending ledger.");
    const rows = (data ?? []).map((row) =>
      this.personalSpendingFromRow(row as Record<string, unknown>),
    );
    const closes = await this.personalSpendingClosesFor(session, individualId);
    const names = await this.lifeEventNames(
      rows.flatMap((row) =>
        [row.recordedBy, row.voidedBy].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
    return buildPersonalSpendingViews(
      rows,
      closes,
      (userId) => names.get(userId) ?? "Staff member",
    );
  }

  private async assertPersonalSpendingMonthOpen(
    session: SessionUser,
    individualId: string,
    entryDate: string,
  ) {
    const month = monthKeyFrom(entryDate);
    const { data, error } = await this.client
      .from("personal_spending_month_closes")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .eq("month", month)
      .maybeSingle();
    throwIf(error, "Could not check whether the month is closed.");
    if (data) throw new Error(personalClosedMonthMessage(monthLabel(month)));
  }

  async listPersonalSpendingEntries(individualId: string) {
    const session = await this.requireSession();
    this.assertPersonalSpendingViewer(session);
    await this.assertPersonalSpendingReadable(session, individualId);
    return this.personalSpendingViewsFor(session, individualId);
  }

  async createPersonalSpendingEntry(
    input: { individualId: string } & PersonalSpendingEntryDraft,
  ) {
    const session = await this.requireSession();
    this.assertPersonalSpendingRecorder(session);
    const person = await this.assertPersonalSpendingReadable(
      session,
      input.individualId,
    );
    const draft = validatePersonalSpendingDraft(input, centralTodayIso());
    await this.assertPersonalSpendingMonthOpen(
      session,
      person.id,
      draft.entryDate,
    );
    const { data, error } = await this.client
      .from("personal_spending_entries")
      .insert({
        agency_id: session.agencyId,
        site_id: person.siteId,
        individual_id: person.id,
        entry_date: draft.entryDate,
        kind: draft.kind,
        location: draft.location,
        purpose: draft.purpose,
        amount_cents: draft.amountCents,
        note: draft.note,
        receipt_photo: draft.receiptPhoto,
        recorded_by: session.userId,
        recorded_by_name: session.fullName,
        recorded_by_role: session.roleKey,
      })
      .select("*")
      .single();
    throwIf(error, "Could not save that personal spending entry.");
    const row = this.personalSpendingFromRow(data as Record<string, unknown>);
    const views = await this.personalSpendingViewsFor(session, person.id);
    return views.find((view) => view.id === row.id) ?? views[views.length - 1];
  }

  async voidPersonalSpendingEntry(
    entryId: string,
    reason: string,
    replacement?:
      | ({ individualId: string } & PersonalSpendingEntryDraft)
      | null,
  ) {
    const session = await this.requireSession();
    this.assertPersonalSpendingRecorder(session);
    const { data: existingData, error: fetchError } = await this.client
      .from("personal_spending_entries")
      .select("*")
      .eq("id", entryId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(fetchError, "Could not load that personal spending entry.");
    if (!existingData) throw new Error("Personal spending entry not found.");
    const existing = this.personalSpendingFromRow(
      existingData as Record<string, unknown>,
    );
    await this.assertPersonalSpendingReadable(session, existing.individualId);
    if (existing.voidedAt) {
      throw new Error("That entry is already voided.");
    }
    const voidReason = validatePersonalSpendingVoidReason(reason);

    // Validate + insert the replacement BEFORE voiding, so a failed
    // replacement never leaves a half-applied correction behind.
    let replacementRow: PersonalSpendingEntryRow | null = null;
    if (replacement) {
      if (replacement.individualId !== existing.individualId) {
        throw new Error(
          "The replacement must belong to the same Individual's ledger.",
        );
      }
      const draft = validatePersonalSpendingDraft(
        replacement,
        centralTodayIso(),
      );
      if (monthKeyFrom(draft.entryDate) !== monthKeyFrom(existing.entryDate)) {
        await this.assertPersonalSpendingMonthOpen(
          session,
          existing.individualId,
          draft.entryDate,
        );
      }
      const { data, error } = await this.client
        .from("personal_spending_entries")
        .insert({
          agency_id: session.agencyId,
          site_id: existing.siteId,
          individual_id: existing.individualId,
          entry_date: draft.entryDate,
          kind: draft.kind,
          location: draft.location,
          purpose: draft.purpose,
          amount_cents: draft.amountCents,
          note: draft.note,
          receipt_photo: draft.receiptPhoto,
          recorded_by: session.userId,
          recorded_by_name: session.fullName,
          recorded_by_role: session.roleKey,
          replaces_entry_id: existing.id,
        })
        .select("*")
        .single();
      throwIf(error, "Could not save the replacement entry.");
      replacementRow = this.personalSpendingFromRow(
        data as Record<string, unknown>,
      );
    }

    const { error } = await this.client
      .from("personal_spending_entries")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: session.userId,
        void_reason: voidReason,
        replaced_by_entry_id: replacementRow?.id ?? null,
      })
      .eq("id", existing.id)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not void that entry.");
    const views = await this.personalSpendingViewsFor(
      session,
      existing.individualId,
    );
    const voided = views.find((view) => view.id === existing.id);
    if (!voided) throw new Error("Personal spending entry not found.");
    return {
      voided,
      replacement: replacementRow
        ? (views.find((view) => view.id === replacementRow!.id) ?? null)
        : null,
    };
  }

  async listPersonalSpendingMonthCloses(individualId: string) {
    const session = await this.requireSession();
    this.assertPersonalSpendingViewer(session);
    await this.assertPersonalSpendingReadable(session, individualId);
    return this.personalSpendingClosesFor(session, individualId);
  }

  async closePersonalSpendingMonth(
    input: { individualId: string } & PersonalSpendingCloseDraft,
  ) {
    const session = await this.requireSession();
    if (!canClosePersonalSpendingMonth(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
    const person = await this.assertPersonalSpendingReadable(
      session,
      input.individualId,
    );
    const draft = validatePersonalSpendingCloseDraft(input);
    const closes = await this.personalSpendingClosesFor(session, person.id);
    if (closes.some((close) => close.month === draft.month)) {
      throw new Error(`${monthLabel(draft.month)} is already closed and signed.`);
    }

    // The unable-to-sign case names a second staff member: an active
    // member of this agency, never the closer themselves.
    let secondStaffName: string | null = null;
    if (draft.individualSignoff === "unable_second_staff") {
      const secondId = draft.secondStaffId!;
      if (secondId === session.userId) {
        throw new Error(
          "The second staff member must be someone other than the manager closing the month.",
        );
      }
      const today = centralTodayIso();
      const { data: member, error: memberError } = await this.client
        .from("memberships")
        .select("user_id, expires_on")
        .eq("agency_id", session.agencyId)
        .eq("user_id", secondId)
        .maybeSingle();
      throwIf(memberError, "Could not verify the second staff member.");
      const memberRow = member as { expires_on: string | null } | null;
      if (!memberRow || (memberRow.expires_on && memberRow.expires_on < today)) {
        throw new Error(
          "Choose an active staff member in this agency as the second signer.",
        );
      }
      const names = await this.lifeEventNames([secondId]);
      secondStaffName = names.get(secondId) ?? "Staff member";
    }

    const { data: entryData, error: entryError } = await this.client
      .from("personal_spending_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", person.id)
      .lte("entry_date", personalMonthEndIso(draft.month));
    throwIf(entryError, "Could not total the month before closing it.");
    const entries = (entryData ?? []).map((row) =>
      this.personalSpendingFromRow(row as Record<string, unknown>),
    );
    const { data, error } = await this.client
      .from("personal_spending_month_closes")
      .insert({
        agency_id: session.agencyId,
        site_id: person.siteId,
        individual_id: person.id,
        month: draft.month,
        closing_balance_cents: personalBalanceThroughCents(
          entries,
          personalMonthEndIso(draft.month),
        ),
        printed_name: session.fullName,
        signature_text: draft.signatureText,
        signed_by: session.userId,
        signed_by_name: session.fullName,
        individual_signoff: draft.individualSignoff,
        second_staff_id: draft.secondStaffId,
        second_staff_name: secondStaffName,
        second_staff_signature: draft.secondStaffSignatureText,
      })
      .select("*")
      .single();
    throwIf(error, "Could not close the month.");
    return this.personalSpendingCloseFromRow(data as Record<string, unknown>);
  }

    async listConsentPackets(): Promise<ConsentPacket[]> {
        const session = await this.requireSession();
        assertConsentRole(session);
        if (session.roleKey === 'dsp')
            return [];
        const { data, error } = await this.client.from('consent_packets').select('*,consent_packet_audit(*)').eq('agency_id', session.agencyId);
        throwIf(error, 'Could not load packets.');
        return (data ?? []).map(r => ({ id: r.id, agencyId: r.agency_id, individualId: r.individual_id, createdBy: r.created_by, createdAt: r.created_at, snapshot: r.snapshot, status: r.status, generatedAt: r.generated_at, sentAt: r.sent_at, openedAt: r.opened_at, signedAt: r.signed_at, filedAt: r.filed_at, linkExpiresAt: r.link_expires_at, outstandingAfterDays: r.outstanding_after_days, choices: r.choices, signer: r.signer, evidenceName: r.evidence_name, audit: (r.consent_packet_audit ?? []).map((a: Record<string, string>) => ({ event: a.event, at: a.at, signerName: a.signer_name, authority: a.authority })) }));
    }
    async createConsentPacket(input: PacketCreateInput): Promise<string> {
        assertConsentRole(await this.requireSession(), true);
        assertPacketDates(input);
        const { data, error } = await this.client.rpc('create_consent_packet', { p_input: input });
        throwIf(error, 'Could not create packet.');
        return data;
    }
    async generateConsentPacket(id: string) {
        assertConsentRole(await this.requireSession(), true);
        const { error } = await this.client.rpc('generate_consent_packet', { p_id: id });
        throwIf(error, 'Could not generate packet.');
    }
    async sendConsentPacket(id: string, expiresInDays: number): Promise<string> {
        assertConsentRole(await this.requireSession(), true);
        const { data, error } = await this.client.rpc('send_consent_packet', { p_id: id, p_days: expiresInDays });
        throwIf(error, 'Could not create signing link.');
        return data;
    }
    async filePaperConsentPacket(id: string, choices: PacketChoices, signer: PacketSignature, file: File) {
        assertConsentRole(await this.requireSession(), true);
        validatePacketSubmission(choices, signer);
        const evidence = await packetFile(file);
        const { error } = await this.client.rpc('file_paper_consent_packet', { p_id: id, p_choices: choices, p_signer: signer, p_evidence: evidence });
        throwIf(error, 'Could not file packet.');
    }
    async getConsentPacketEvidence(id: string): Promise<PacketEvidence> {
        assertConsentRole(await this.requireSession());
        const { data, error } = await this.client.rpc('get_consent_packet_evidence', { p_id: id });
        throwIf(error, 'Could not load packet evidence.');
        return data;
    }
    async listRightsPackets(): Promise<import("./rightsPackets").RightsPacket[]> {
        const session = await this.requireSession();
        assertConsentRole(session);
        if (session.roleKey === 'dsp')
            return [];
        const { data, error } = await this.client.from('rights_packets').select('*').eq('agency_id', session.agencyId);
        throwIf(error, 'Could not load rights packets.');
        return (data ?? []).map(r => ({ id: r.id, agencyId: r.agency_id, individualId: r.individual_id, createdBy: r.created_by, createdAt: r.created_at, signerName: r.signer_name, reviewedBy: r.reviewed_by, packetOn: r.packet_on, status: r.status, signer: r.signer, signedAt: r.signed_at, filedAt: r.filed_at, evidenceName: r.evidence_name, copyVersion: r.copy_version }));
    }
    async createRightsPacket(input: { individualId: string; signerName: string }): Promise<string> {
        const session = await this.requireSession();
        assertConsentRole(session, true);
        validateRightsPacketStart(input);
        const { data, error } = await this.client.from('rights_packets').insert({ agency_id: session.agencyId, individual_id: input.individualId, created_by: session.userId, signer_name: input.signerName.trim(), copy_version: RIGHTS_PACKET_COPY_VERSION }).select('id').single();
        throwIf(error, 'Could not start the rights packet.');
        return (data as { id: string }).id;
    }
    private async completeRightsPacket(id: string, input: import("./rightsPackets").RightsPacketCompletion, evidence: PacketEvidence | null) {
        const session = await this.requireSession();
        assertConsentRole(session, true);
        const fields = rightsCompletionFields(input);
        validateRightsCompletion(fields);
        const now = new Date().toISOString();
        const { data, error } = await this.client.from('rights_packets').update({ reviewed_by: fields.reviewedBy.trim(), packet_on: fields.packetOn, signer: fields.signer, status: evidence ? 'filed' : 'signed', signed_at: now, filed_at: evidence ? now : null, evidence_name: evidence?.name ?? null }).eq('id', id).eq('agency_id', session.agencyId).eq('status', 'awaiting_signature').select('id, individual_id').single();
        throwIf(error, 'Could not complete the rights packet.');
        if (evidence) {
            const { error: evidenceError } = await this.client.from('rights_packet_evidence').insert({ packet_id: id, agency_id: session.agencyId, individual_id: (data as { individual_id: string }).individual_id, evidence });
            throwIf(evidenceError, 'Could not file the signed evidence.');
        }
    }
    async signRightsPacket(id: string, input: import("./rightsPackets").RightsPacketCompletion) {
        await this.completeRightsPacket(id, input, null);
    }
    async filePaperRightsPacket(id: string, input: import("./rightsPackets").RightsPacketCompletion, file: File) {
        const evidence = await packetFile(file);
        await this.completeRightsPacket(id, input, evidence);
    }
    async getRightsPacketEvidence(id: string): Promise<PacketEvidence> {
        assertConsentRole(await this.requireSession());
        if (!(await this.listRightsPackets()).some(p => p.id === id))
            throw new Error('Rights packet not found.');
        const { data, error } = await this.client.from('rights_packet_evidence').select('evidence').eq('packet_id', id).single();
        throwIf(error, 'No signed evidence filed.');
        return (data as { evidence: PacketEvidence }).evidence;
    }
    private async publicPacketRequest(body: Record<string, unknown>) {
        // Suppress any signed-in account JWT: the token is the sole authority here.
        const url = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!url || !anonKey)
            throw new Error('Hosted signing is not configured.');
        const response = await fetch(`${url}/functions/v1/consent-signing`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify(body), referrerPolicy: 'no-referrer' });
        const result = await response.json();
        if (!response.ok)
            throw new Error(result.error ?? 'Signing link is unavailable or expired.');
        return result;
    }
    async openConsentPacket(token: string): Promise<PacketPublicView> { return this.publicPacketRequest({ action: 'open', token }); }
    async signConsentPacket(token: string, choices: PacketChoices, signer: PacketSignature): Promise<PacketEvidence> {
        validatePacketSubmission(choices, signer);
        return this.publicPacketRequest({ action: 'sign', token, choices, signer });
    }
    async getConsents(): Promise<ConsentRegister> {
        const session = await this.requireSession();
        assertConsentRole(session);
        const [people, config, consents, revoked] = await Promise.all([
            this.client.from('individuals').select('id,agency_id,site_id,full_name').eq('agency_id', session.agencyId),
            this.client.from('consent_type_settings').select('types').eq('agency_id', session.agencyId).maybeSingle(),
            this.client.from('individual_consents').select('*').eq('agency_id', session.agencyId),
            this.client.from('consent_revocations').select('*').eq('agency_id', session.agencyId),
        ]);
        for (const result of [people, config, consents, revoked])
            throwIf(result.error, 'Could not load consents.');
        return { types: config.data?.types ?? structuredClone(DEFAULT_CONSENT_TYPES),
            individuals: (people.data ?? []).map(p => ({ id: p.id, agencyId: p.agency_id, siteId: p.site_id, fullName: p.full_name })),
            records: (consents.data ?? []).map(r => ({ ...r.details, id: r.id, agencyId: r.agency_id, individualId: r.individual_id, typeId: r.type_id,
                supersedesId: r.supersedes_id, createdBy: r.created_by, createdAt: r.created_at, activatedBy: r.activated_by, activatedAt: r.activated_at })),
            revocations: (revoked.data ?? []).map(r => ({ consentId: r.consent_id, revokedOn: r.revoked_on, reason: r.reason, revokedBy: r.revoked_by, revokedByName: r.revoked_by_name })) };
    }
    async saveConsent(draft: ConsentDraft, id?: string): Promise<string> {
        assertConsentRole(await this.requireSession(), true);
        const { data, error } = await this.client.rpc('save_consent', { p_id: id ?? null, p_draft: draft });
        throwIf(error, 'Could not save consent.');
        return data as string;
    }
    async activateConsent(id: string) {
        assertConsentRole(await this.requireSession(), true);
        const { error } = await this.client.rpc('activate_consent', { p_id: id });
        throwIf(error, 'Could not activate consent.');
    }
    async revokeConsent(id: string, revokedOn: string, reason: string) {
        assertConsentRole(await this.requireSession(), true);
        const { error } = await this.client.rpc('revoke_consent', { p_id: id, p_revoked_on: revokedOn, p_reason: reason });
        throwIf(error, 'Could not revoke consent.');
    }
    async saveConsentTypes(types: ConsentType[]) {
        const session = await this.requireSession();
        assertConsentRole(session, true);
        validateConsentTypes(types);
        if (session.roleKey !== 'program_manager' || session.siteId)
            throw new Error('An agency-wide Program Manager configures consent types.');
        const { error } = await this.client.rpc('save_consent_types', { p_agency_id: session.agencyId, p_types: types });
        throwIf(error, 'Could not save consent types.');
    }

  async listNotifications(): Promise<import("../features/notifications/notify").NotificationRow[]> {
    const session = await this.requireSession();
    await this.sweepOperatingReminders(session);
    if (canManageConsents(session.roleKey)) {
      const { error } = await this.client.rpc('sweep_consent_alerts', { p_agency_id: session.agencyId });
      throwIf(error, 'Could not check consent alerts.');
    }
    const { data, error } = await this.client.from("notifications")
      .select("*, notification_reads!left(read_at)").eq("agency_id", session.agencyId)
      .order("created_at", { ascending: false }).limit(100);
    throwIf(error, "Could not load notifications.");
    return (data ?? []).map((row) => ({ ...row,
      read_at: row.read_at ?? row.notification_reads?.[0]?.read_at ?? null,
    })) as import("../features/notifications/notify").NotificationRow[];
  }

  async markNotificationsRead(ids: string[]) {
    const session = await this.requireSession();
    const visible = (await this.listNotifications()).filter((row) => ids.includes(row.id) && !row.read_at);
    const direct = visible.filter((row) => row.user_id === session.userId);
    const broadcasts = visible.filter((row) => !row.user_id);
    const now = new Date().toISOString();
    if (direct.length) {
      const { error } = await this.client.from("notifications").update({ read_at: now })
        .eq("agency_id", session.agencyId).eq("user_id", session.userId).in("id", direct.map((row) => row.id));
      throwIf(error, "Could not mark notifications read.");
    }
    if (broadcasts.length) {
      const { error } = await this.client.from("notification_reads").upsert(broadcasts.map((row) => ({
        notification_id: row.id, user_id: session.userId, read_at: now,
      })), { onConflict: "notification_id,user_id", ignoreDuplicates: true });
      throwIf(error, "Could not mark notifications read.");
    }
  }

  // ── MESSAGING — staff-to-staff internal messaging (hosted) ─────────────
  // Mirrors LocalApi semantics exactly. The DB layer backstops everything
  // (supabase/migrations/20261027151000_internal_messaging.sql): RLS scopes
  // reads to thread participants, messages are immutable, authorship is
  // bound to auth.uid(), and private.can_use_messaging() excludes auditors.

  private messageThreadFromRow(row: Record<string, unknown>): MessageThreadRow {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      subject: (row.subject as string) ?? "",
      individualId: (row.individual_id as string | null) ?? null,
      createdBy: row.created_by as string,
      createdAt: row.created_at as string,
      lastMessageAt: row.last_message_at as string,
    };
  }

  private messageParticipantFromRow(row: Record<string, unknown>): MessageParticipantRow {
    return {
      threadId: row.thread_id as string,
      agencyId: row.agency_id as string,
      userId: row.user_id as string,
      addedBy: (row.added_by as string | null) ?? null,
      addedAt: row.added_at as string,
      lastReadAt: (row.last_read_at as string | null) ?? null,
      hiddenAt: (row.hidden_at as string | null) ?? null,
    };
  }

  private messageFromRow(row: Record<string, unknown>): MessageRow {
    return {
      id: row.id as string,
      threadId: row.thread_id as string,
      agencyId: row.agency_id as string,
      senderId: (row.sender_id as string | null) ?? null,
      kind: row.kind === "system" ? "system" : "user",
      body: row.body as string,
      createdAt: row.created_at as string,
    };
  }

  private async messageBundle(session: SessionUser, threadIds: string[]) {
    if (!threadIds.length) {
      return {
        threads: [] as MessageThreadRow[],
        participants: [] as MessageParticipantRow[],
        messages: [] as MessageRow[],
      };
    }
    const [threadsRes, partsRes, msgsRes] = await Promise.all([
      this.client.from("message_threads").select("*")
        .eq("agency_id", session.agencyId).in("id", threadIds),
      this.client.from("message_participants").select("*")
        .eq("agency_id", session.agencyId).in("thread_id", threadIds),
      this.client.from("messages").select("*")
        .eq("agency_id", session.agencyId).in("thread_id", threadIds)
        .order("created_at", { ascending: true }),
    ]);
    throwIf(threadsRes.error, "Could not load conversations.");
    throwIf(partsRes.error, "Could not load conversations.");
    throwIf(msgsRes.error, "Could not load messages.");
    return {
      threads: (threadsRes.data ?? []).map((row) =>
        this.messageThreadFromRow(row as Record<string, unknown>)),
      participants: (partsRes.data ?? []).map((row) =>
        this.messageParticipantFromRow(row as Record<string, unknown>)),
      messages: (msgsRes.data ?? []).map((row) =>
        this.messageFromRow(row as Record<string, unknown>)),
    };
  }

  /** Display names + role keys for a set of staff user ids in this agency. */
  private async messagePeople(session: SessionUser, userIds: string[]) {
    const names = new Map<string, string>();
    const roles = new Map<string, string>();
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return { names, roles };
    const [profilesRes, membershipsRes] = await Promise.all([
      this.client.from("profiles").select("id, full_name").in("id", unique),
      this.client.from("memberships").select("user_id, role, role_key")
        .eq("agency_id", session.agencyId).in("user_id", unique),
    ]);
    for (const row of profilesRes.data ?? []) {
      const record = row as { id: string; full_name: string };
      names.set(record.id, record.full_name);
    }
    for (const row of membershipsRes.data ?? []) {
      const record = row as { user_id: string; role: string; role_key: string | null };
      roles.set(record.user_id, record.role_key ?? record.role);
    }
    return { names, roles };
  }

  private assembleHostedThread(
    session: SessionUser,
    thread: MessageThreadRow,
    participants: MessageParticipantRow[],
    messages: MessageRow[],
    names: Map<string, string>,
    roles: Map<string, string>,
    individualName: string | null,
  ) {
    return assembleThreadView({
      thread,
      participants,
      messages,
      nameFor: (userId) => names.get(userId) ?? "Staff member",
      roleFor: (userId) => roles.get(userId) ?? "",
      individualName,
      selfUserId: session.userId,
    });
  }

  /** One notify-event call; failures are logged, never fatal (GER pattern). */
  private async emitMessageNotification(input: {
    session: SessionUser;
    userId: string;
    title: string;
    body: string;
    threadId: string;
    dedupeKey: string;
  }): Promise<void> {
    try {
      const { error } = await this.client.functions.invoke("notify-event", {
        body: {
          agency_id: input.session.agencyId,
          user_id: input.userId,
          role_key: null,
          type: "message.received",
          title: input.title,
          body: input.body,
          deep_link: "/messages",
          entity_type: "message_thread",
          entity_id: input.threadId,
          dedupe_key: input.dedupeKey,
        },
      });
      if (error) {
        console.warn("[notifications] notify-event failed:", error.message);
      }
    } catch (err) {
      console.warn("[notifications] notify-event threw:", err);
    }
  }

  /**
   * Bell fan-out after a message lands: one entry per other participant per
   * unread burst, dedupe-keyed to their first unread message (identical
   * semantics to LocalApi.queueMessageNotifications).
   */
  private async notifyMessageRecipients(
    session: SessionUser,
    thread: MessageThreadRow,
    participants: MessageParticipantRow[],
    messages: MessageRow[],
    anchor: MessageRow,
    recipientIds: string[],
  ) {
    const { names, roles } = await this.messagePeople(
      session,
      participants.map((row) => row.userId),
    );
    const view = this.assembleHostedThread(
      session, thread, participants, messages, names, roles, null,
    );
    const isAdd = anchor.kind === "system";
    await Promise.allSettled(
      recipientIds
        .filter((userId) => userId !== session.userId)
        .map(async (userId) => {
          const participant = participants.find((row) => row.userId === userId);
          if (!participant) return;
          const firstUnread = firstUnreadMessageId(messages, participant) ?? anchor.id;
          await this.emitMessageNotification({
            session,
            userId,
            title: isAdd
              ? `${session.fullName} added you to a conversation`
              : `New message from ${session.fullName}`,
            body: `${view.title} — ${messagePreview(anchor.body)}`,
            threadId: thread.id,
            dedupeKey: messageDedupeKey(thread.id, userId, firstUnread),
          });
        }),
    );
  }

  private async myParticipantRow(session: SessionUser, threadId: string) {
    const { data, error } = await this.client
      .from("message_participants")
      .select("*")
      .eq("thread_id", threadId)
      .eq("user_id", session.userId)
      .maybeSingle();
    throwIf(error, "Could not load the conversation.");
    return data ? this.messageParticipantFromRow(data as Record<string, unknown>) : null;
  }

  private async requireHostedParticipant(session: SessionUser, threadId: string) {
    const participant = await this.myParticipantRow(session, threadId);
    if (!participant) throw new Error("Conversation not found.");
    const { data, error } = await this.client
      .from("message_threads")
      .select("*")
      .eq("id", threadId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load the conversation.");
    if (!data) throw new Error("Conversation not found.");
    return {
      thread: this.messageThreadFromRow(data as Record<string, unknown>),
      participant,
    };
  }

  private assertMessaging(session: SessionUser) {
    if (!canUseMessaging(session)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  /**
   * Active agency members whose role can use messaging. The role list and
   * the role's `messages.use` permission must agree (defaults or the
   * agency's configured role map) — auditors are out on both checks.
   */
  private async messagingMemberships(session: SessionUser) {
    const today = new Date().toISOString().slice(0, 10);
    const [membershipsRes, rolesRes] = await Promise.all([
      this.client.from("memberships").select("*").eq("agency_id", session.agencyId),
      this.client.from("agency_roles").select("*").eq("agency_id", session.agencyId),
    ]);
    throwIf(membershipsRes.error, "Could not load staff.");
    const rolePermissions = new Map<string, Record<string, boolean>>();
    for (const row of rolesRes.data ?? []) {
      const record = row as { template_key: string; permissions: Record<string, boolean> };
      rolePermissions.set(record.template_key, record.permissions ?? {});
    }
    return (membershipsRes.data ?? [])
      .map((row) => row as Record<string, unknown>)
      .filter((row) => {
        const expires = row.expires_on as string | null;
        return !expires || expires >= today;
      })
      .filter((row) => {
        const roleKey = (row.role_key as string) ?? (row.role as string);
        if (!isMessagingRole(roleKey)) return false;
        const configured = rolePermissions.get(roleKey);
        const permissions = configured
          ? { ...defaultPermissions(roleKey), ...configured }
          : defaultPermissions(roleKey);
        return Boolean(permissions["messages.use"]);
      });
  }

  private async assertIndividualReadable(session: SessionUser, individualId: string) {
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const { data } = await this.client
      .from("staff_assignments")
      .select("*")
      .eq("agency_id", session.agencyId);
    const assignments = (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as string,
        agencyId: record.agency_id as string,
        userId: record.user_id as string,
        individualId: (record.individual_id as string | null) ?? null,
        siteId: (record.site_id as string | null) ?? null,
        startsOn: record.starts_on as string,
        endsOn: (record.ends_on as string | null) ?? null,
      };
    });
    if (!canReadIndividual(session, person, assignments, [person])) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    return person;
  }

  async listMessageContacts() {
    const session = await this.requireSession();
    if (!canUseMessaging(session)) return [];
    const memberships = await this.messagingMemberships(session);
    const others = memberships.filter(
      (row) => (row.user_id as string) !== session.userId,
    );
    const { names } = await this.messagePeople(
      session,
      others.map((row) => row.user_id as string),
    );
    const seen = new Set<string>();
    return others
      .map((row) => {
        const roleKey = (row.role_key as string) ?? (row.role as string);
        return {
          userId: row.user_id as string,
          fullName: names.get(row.user_id as string) ?? "Staff member",
          roleKey,
          roleLabel: ROLE_TEMPLATE_BY_KEY[roleKey as keyof typeof ROLE_TEMPLATE_BY_KEY]?.name ?? roleKey,
        };
      })
      .filter((row) => (seen.has(row.userId) ? false : (seen.add(row.userId), true)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listMessageThreads() {
    const session = await this.requireSession();
    if (!canUseMessaging(session)) return [];
    const { data, error } = await this.client
      .from("message_participants")
      .select("thread_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", session.userId);
    throwIf(error, "Could not load conversations.");
    const threadIds = (data ?? []).map((row) => (row as { thread_id: string }).thread_id);
    const bundle = await this.messageBundle(session, threadIds);
    const people = await this.messagePeople(
      session,
      bundle.participants.map((row) => row.userId),
    );
    const individualIds = [...new Set(
      bundle.threads.map((row) => row.individualId).filter(Boolean) as string[],
    )];
    const individualNames = new Map<string, string>();
    if (individualIds.length) {
      const { data: people2 } = await this.client
        .from("individuals")
        .select("id, full_name")
        .eq("agency_id", session.agencyId)
        .in("id", individualIds);
      for (const row of people2 ?? []) {
        const record = row as { id: string; full_name: string };
        individualNames.set(record.id, record.full_name);
      }
    }
    const views = bundle.threads.map((thread) =>
      this.assembleHostedThread(
        session,
        thread,
        bundle.participants.filter((row) => row.threadId === thread.id),
        bundle.messages.filter((row) => row.threadId === thread.id),
        people.names,
        people.roles,
        thread.individualId ? individualNames.get(thread.individualId) ?? null : null,
      ),
    );
    return sortThreads(views.filter((view) => !view.hidden));
  }

  async getMessageThread(threadId: string) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    const { thread } = await this.requireHostedParticipant(session, threadId);
    const bundle = await this.messageBundle(session, [threadId]);
    const participants = bundle.participants.filter((row) => row.threadId === threadId);
    const messages = bundle.messages.filter((row) => row.threadId === threadId);
    const people = await this.messagePeople(
      session,
      participants.map((row) => row.userId),
    );
    let individualName: string | null = null;
    if (thread.individualId) {
      const person = await this.individualRecord(thread.individualId);
      individualName = person?.fullName ?? null;
    }
    const view = this.assembleHostedThread(
      session, thread, participants, messages, people.names, people.roles, individualName,
    );
    return {
      ...view,
      messages: assembleMessageViews(
        messages,
        (userId) => people.names.get(userId) ?? "Staff member",
      ),
    };
  }

  async createMessageThread(input: {
    recipientUserIds: string[];
    subject?: string;
    body: string;
    individualId?: string | null;
  }) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    const recipientIds = validateRecipientIds(input.recipientUserIds, session.userId);
    const memberships = await this.messagingMemberships(session);
    const eligible = new Set(memberships.map((row) => row.user_id as string));
    for (const userId of recipientIds) {
      if (!eligible.has(userId)) {
        throw new Error("Choose staff members in this agency who can use messaging.");
      }
    }
    const subject = validateThreadSubject(input.subject);
    const body = validateMessageBody(input.body);
    let individualId: string | null = null;
    if (input.individualId) {
      individualId = (await this.assertIndividualReadable(session, input.individualId)).id;
    }
    const { data: threadData, error: threadError } = await this.client
      .from("message_threads")
      .insert({
        agency_id: session.agencyId,
        subject,
        individual_id: individualId,
        created_by: session.userId,
      })
      .select("*")
      .single();
    throwIf(threadError, "Could not start the conversation.");
    const thread = this.messageThreadFromRow(threadData as Record<string, unknown>);
    const participantRows = [
      {
        thread_id: thread.id,
        agency_id: session.agencyId,
        user_id: session.userId,
        added_by: null,
        last_read_at: thread.createdAt,
      },
      ...recipientIds.map((userId) => ({
        thread_id: thread.id,
        agency_id: session.agencyId,
        user_id: userId,
        added_by: session.userId,
        last_read_at: null,
      })),
    ];
    const { error: partsError } = await this.client
      .from("message_participants")
      .insert(participantRows);
    throwIf(partsError, "Could not start the conversation.");
    const { data: messageData, error: messageError } = await this.client
      .from("messages")
      .insert({
        thread_id: thread.id,
        agency_id: session.agencyId,
        sender_id: session.userId,
        kind: "user",
        body,
      })
      .select("*")
      .single();
    throwIf(messageError, "Could not send the first message.");
    const message = this.messageFromRow(messageData as Record<string, unknown>);
    const bundle = await this.messageBundle(session, [thread.id]);
    await this.notifyMessageRecipients(
      session,
      thread,
      bundle.participants,
      bundle.messages,
      message,
      recipientIds,
    );
    return thread.id;
  }

  async sendMessage(threadId: string, body: string) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    const { thread } = await this.requireHostedParticipant(session, threadId);
    const text = validateMessageBody(body);
    const { data, error } = await this.client
      .from("messages")
      .insert({
        thread_id: thread.id,
        agency_id: session.agencyId,
        sender_id: session.userId,
        kind: "user",
        body: text,
      })
      .select("*")
      .single();
    throwIf(error, "Could not send the message.");
    const message = this.messageFromRow(data as Record<string, unknown>);
    const { error: readError } = await this.client
      .from("message_participants")
      .update({ last_read_at: message.createdAt, hidden_at: null })
      .eq("thread_id", thread.id)
      .eq("user_id", session.userId);
    throwIf(readError, "Could not update the conversation.");
    const bundle = await this.messageBundle(session, [thread.id]);
    await this.notifyMessageRecipients(
      session,
      thread,
      bundle.participants,
      bundle.messages,
      message,
      bundle.participants.map((row) => row.userId),
    );
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      senderName: session.fullName,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
    };
  }

  async markThreadRead(threadId: string) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    await this.requireHostedParticipant(session, threadId);
    const { data } = await this.client
      .from("messages")
      .select("created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = (data ?? [])[0] as { created_at: string } | undefined;
    if (!latest) return;
    const { error } = await this.client
      .from("message_participants")
      .update({ last_read_at: latest.created_at })
      .eq("thread_id", threadId)
      .eq("user_id", session.userId);
    throwIf(error, "Could not mark the conversation read.");
  }

  async addThreadParticipant(threadId: string, userId: string) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    const { thread } = await this.requireHostedParticipant(session, threadId);
    const existing = await this.client
      .from("message_participants")
      .select("user_id")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.data) {
      throw new Error("That staff member is already in this conversation.");
    }
    const memberships = await this.messagingMemberships(session);
    if (!memberships.some((row) => (row.user_id as string) === userId)) {
      throw new Error("Choose a staff member in this agency who can use messaging.");
    }
    const { error } = await this.client.from("message_participants").insert({
      thread_id: thread.id,
      agency_id: session.agencyId,
      user_id: userId,
      added_by: session.userId,
    });
    throwIf(error, "Could not add that staff member.");
    // The DB trigger writes the visible "added" system note; it also bumps
    // the thread's last activity. Notify only the person who was added.
    const bundle = await this.messageBundle(session, [thread.id]);
    const note = [...bundle.messages].reverse().find((row) => row.kind === "system");
    if (note) {
      await this.notifyMessageRecipients(
        session,
        thread,
        bundle.participants,
        bundle.messages,
        note,
        [userId],
      );
    }
  }

  async hideMessageThread(threadId: string) {
    const session = await this.requireSession();
    this.assertMessaging(session);
    await this.requireHostedParticipant(session, threadId);
    const { error } = await this.client
      .from("message_participants")
      .update({ hidden_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", session.userId);
    throwIf(error, "Could not hide the conversation.");
  }

  async listIndividualMessageThreads(individualId: string) {
    const session = await this.requireSession();
    if (!canUseMessaging(session)) return [];
    try {
      await this.assertIndividualReadable(session, individualId);
    } catch {
      return [];
    }
    const { data, error } = await this.client
      .from("message_threads")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId);
    throwIf(error, "Could not load conversations.");
    const threadIds = (data ?? []).map((row) => (row as { id: string }).id);
    const bundle = await this.messageBundle(session, threadIds);
    const mine = new Set(
      bundle.participants
        .filter((row) => row.userId === session.userId)
        .map((row) => row.threadId),
    );
    const people = await this.messagePeople(
      session,
      bundle.participants.map((row) => row.userId),
    );
    const person = await this.individualRecord(individualId);
    const views = bundle.threads
      .filter((thread) => mine.has(thread.id))
      .map((thread) =>
        this.assembleHostedThread(
          session,
          thread,
          bundle.participants.filter((row) => row.threadId === thread.id),
          bundle.messages.filter((row) => row.threadId === thread.id),
          people.names,
          people.roles,
          person?.fullName ?? null,
        ),
      );
    return sortThreads(views);
  }

  async getMessageUnreadTotal() {
    const threads = await this.listMessageThreads();
    return threads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  }

  async getSession() {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return null;
    return this.sessionFromUser(data.user.id, data.user.email ?? "");
  }

  async signIn(input: LoginInput) {
    const { data, error } = await this.client.rpc("resolve_login", {
      p_agency_code: normalizeAgencyCode(input.agencyCode),
      p_username: normalizeUsername(input.username),
    });
    const email = Array.isArray(data) ? data[0]?.email : data?.email;
    if (error || !email) {
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    const { error: authError, data: auth } = await this.client.auth.signInWithPassword({
      email,
      password: input.password,
    });
    if (authError || !auth.user) {
      throw new Error(LOGIN_BAD_PASSWORD_MESSAGE);
    }
    const session = await this.sessionFromUser(auth.user.id, auth.user.email ?? email);
    if (!session) {
      throw new Error(LOGIN_NO_MEMBERSHIP_MESSAGE);
    }
    // 13 CSR 65-3.050: track user log-in (server records device + IP).
    await this.logSignatureAudit({ action: "login" });
    return session;
  }

  async signOut() {
    // 13 CSR 65-3.050: track user log-out before the session is destroyed.
    await this.logSignatureAudit({ action: "logout" });
    await this.client.auth.signOut();
  }

  async changePassword(currentPassword: string, nextPassword: string) {
    const session = await this.requireSession();
    if (nextPassword.length < 8) {
      throw new Error("New password must be at least 8 characters.");
    }
    if (nextPassword === currentPassword) {
      throw new Error("Choose a new password that is different from the temporary one.");
    }
    const { error: checkError } = await this.client.auth.signInWithPassword({
      email: session.email,
      password: currentPassword,
    });
    if (checkError) throw new Error("Current password is not correct.");
    const { error } = await this.client.auth.updateUser({ password: nextPassword });
    throwIf(error, "Could not update the password.");
    const { error: flagError } = await this.client.rpc("complete_password_change");
    throwIf(flagError, "Password was updated, but the account flag could not be cleared.");
  }

  async createAgency(input: CreateAgencyInput): Promise<CreateAgencyResult> {
    const { data, error } = await this.client.functions.invoke("create-agency", {
      body: {
        name: input.name.trim(),
        stateCode: input.stateCode,
        slug: input.slug,
        adminFullName: input.adminFullName.trim(),
        adminUsername: input.adminUsername,
        adminTempPassword: input.adminTempPassword,
        provisionedBy: input.provisionedBy ?? "self",
      },
    });
    if (error) {
      const body = (data as { error?: string } | null)?.error;
      throw new Error(body || error.message || "Could not create that agency.");
    }
    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }
    const result = data as CreateAgencyResult;
    return {
      agencyCode: result.agencyCode,
      username: result.username,
      fullName: result.fullName,
      status: result.status ?? "pending",
    };
  }

  async inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
    const session = await this.requireSession();
    if (!session.permissions["members.invite"]) {
      throw new Error("You do not have permission to add members.");
    }
    // HR-ROLES (2026-09-13): HR may invite staff, but only an administrator
    // may invite another administrator (mirror of the edge-function guard).
    if (!canGrantRole(session.roleKey, input.roleKey)) {
      throw new Error("Only an administrator can invite someone to that role.");
    }
    const username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(username)) {
      throw new Error("Username must be 3–40 characters: letters, numbers, or dots.");
    }
    const { data, error } = await this.client.functions.invoke("invite-member", {
      body: {
        username,
        tempPassword: input.tempPassword,
        fullName: input.fullName.trim(),
        roleKey: input.roleKey,
        jobTitle: input.jobTitle,
        siteId: input.siteId ?? null,
        expiresOn: input.expiresOn ?? null,
      },
    });
    if (error) {
      const body = (data as { error?: string } | null)?.error;
      throw new Error(body || error.message || "Could not add that member.");
    }
    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }
    const result = data as InviteMemberResult;
    return {
      username: result.username ?? username,
      agencyCode: result.agencyCode ?? session.agencyCode,
      fullName: result.fullName ?? input.fullName.trim(),
      role: result.role ?? capabilityForRoleKey(input.roleKey),
    };
  }

  async assignMemberRole(
    userId: string,
    roleKey: string,
    siteId?: string | null,
    expiresOn?: string | null,
  ) {
    const session = await this.requireSession();
    if (!session.permissions["members.assign_roles"]) {
      throw new Error("You do not have permission to assign roles.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    // HR-ROLES (2026-09-13): HR can assign operational roles, but granting
    // administrator / compliance-administrator stays with administrators.
    if (!canGrantRole(session.roleKey, roleKey)) {
      throw new Error("Only an administrator can grant that role.");
    }
    const { data: membership, error } = await this.client
      .from("memberships")
      .select("id, role_key, site_id")
      .eq("user_id", userId)
      .eq("agency_id", session.agencyId)
      .single();
    throwIf(error, "Staff member not found.");
    if (membership!.role_key === "administrator" && roleKey !== "administrator") {
      const { count } = await this.client
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", session.agencyId)
        .eq("role_key", "administrator");
      if ((count ?? 0) < 2) {
        throw new Error("Keep at least one agency administrator.");
      }
    }
    const { error: updateError } = await this.client
      .from("memberships")
      .update({
        role: capabilityForRoleKey(roleKey),
        role_key: roleKey,
        site_id: siteId === undefined ? membership!.site_id : siteId,
        expires_on: expiresOn ?? null,
      })
      .eq("id", membership!.id);
    throwIf(updateError, "Could not assign that role.");
    await this.audit(
      session,
      "member.role_assigned",
      `${roleLabel(roleKey)} assigned`,
      "membership",
      membership!.id,
    );
  }

  async updateAgencyRole(roleKey: string, permissions: PermissionMap) {
    const session = await this.requireSession();
    // HR-ROLES (2026-09-13): editing the role templates themselves is a
    // separate permission from assigning roles to people, so HR cannot use
    // role assignment to escalate its own access.
    if (!session.permissions["roles.manage"]) {
      throw new Error("Only administrators can edit role access.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    if (roleKey === "administrator" && !permissions["members.assign_roles"]) {
      throw new Error("The administrator role must keep role-assignment access.");
    }
    if (roleKey === "administrator" && !permissions["roles.manage"]) {
      throw new Error("The administrator role must keep role-management access.");
    }
    const { error } = await this.client
      .from("agency_roles")
      .update({ permissions })
      .eq("agency_id", session.agencyId)
      .eq("template_key", roleKey);
    throwIf(error, "Could not update that role.");
    await this.audit(
      session,
      "role.updated",
      `${roleLabel(roleKey)} access levels updated`,
      "agency_role",
    );
  }

  async resetMemberPassword(userId: string) {
    const session = await this.requireSession();
    this.requirePermission(session, "members.reset_password");
    const { data, error } = await this.client.functions.invoke(
      "reset-member-password",
      { body: { userId } },
    );
    if (error) {
      const body = (data as { error?: string } | null)?.error;
      throw new Error(body || error.message || "Could not reset that password.");
    }
    if ((data as { error?: string } | null)?.error) {
      throw new Error((data as { error: string }).error);
    }
    return {
      tempPassword:
        (data as { tempPassword?: string }).tempPassword || generateTempPassword(),
    };
  }

  async listAgencies(): Promise<PendingAgency[]> {
    const session = await this.requireSession();
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can list agencies.");
    }
    const { data, error } = await this.client
      .from("agencies")
      .select("id, name, agency_code, state_code, provisioned_by, status")
      .order("name");
    throwIf(error, "Could not load agencies.");
    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      agencyCode: String(row.agency_code),
      stateCode: String(row.state_code),
      provisionedBy: row.provisioned_by === "platform" ? "platform" : "self",
      status: row.status as AgencyStatus,
    }));
  }

  async listPendingAgencies(): Promise<PendingAgency[]> {
    const session = await this.requireSession();
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can review agency setups.");
    }
    const { data, error } = await this.client
      .from("agencies")
      .select("id, name, agency_code, state_code, provisioned_by, status")
      .eq("status", "pending")
      .order("name");
    throwIf(error, "Could not load pending agencies.");
    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      agencyCode: String(row.agency_code),
      stateCode: String(row.state_code),
      provisionedBy: row.provisioned_by === "platform" ? "platform" : "self",
      status: "pending",
    }));
  }

  async setAgencyStatus(agencyId: string, status: AgencyStatus) {
    const session = await this.requireSession();
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can approve agency setups.");
    }
    const { error } = await this.client
      .from("agencies")
      .update({ status })
      .eq("id", agencyId);
    throwIf(error, "Could not update that agency.");
  }

  async loadWorkspace(session: SessionUser): Promise<WorkspaceView> {
    const agencyId = session.agencyId;
    const [
      sitesRes,
      programsRes,
      individualsRes,
      profilesRes,
      membershipsRes,
      documentsRes,
      versionsRes,
      requirementsRes,
      packetsRes,
      rowsRes,
      auditRes,
      rolesRes,
      scoreRes,
      indProfilesRes,
      obligationsRes,
      obligationSigsRes,
      submissionsRes,
      renewalsRes,
      medsRes,
      checklistsRes,
      monthlyDueRes,
      equipmentRes,
      equipmentLogsRes,
      drillsRes,
      safetyRes,
      siteFactsRes,
      reviewsRes,
      brandingRes,
      assignmentsRes,
      appointmentsRes,
    ] = await Promise.all([
      this.client.from("sites").select("*").eq("agency_id", agencyId),
      this.client.from("programs").select("*").eq("agency_id", agencyId),
      this.client.from("individuals").select("*").eq("agency_id", agencyId),
      this.client.from("profiles").select("*"),
      this.client.from("memberships").select("*").eq("agency_id", agencyId),
      this.client.from("documents").select("*").eq("agency_id", agencyId),
      this.client.from("document_versions").select("*").eq("agency_id", agencyId),
      this.client.from("requirement_definitions").select("*").eq("agency_id", agencyId),
      this.client.from("acknowledgment_packets").select("*").eq("agency_id", agencyId),
      this.client.from("acknowledgment_rows").select("*").eq("agency_id", agencyId),
      this.client
        .from("audit_events")
        .select("*")
        .eq("agency_id", agencyId)
        .order("created_at", { ascending: false })
        .limit(40),
      this.client.from("agency_roles").select("*").eq("agency_id", agencyId),
      this.client.rpc("agency_scorecard", { p_agency_id: agencyId }),
      this.client.from("individual_profiles").select("*").eq("agency_id", agencyId),
      this.client.from("obligations").select("*").eq("agency_id", agencyId),
      this.client.from("obligation_signatures").select("*").eq("agency_id", agencyId),
      this.client.from("packet_submissions").select("*").eq("agency_id", agencyId),
      this.client.from("clinical_renewals").select("*").eq("agency_id", agencyId),
      this.client.from("medications").select("*").eq("agency_id", agencyId),
      this.client.from("training_checklists").select("*").eq("agency_id", agencyId),
      this.client.from("agency_monthly_due").select("*").eq("agency_id", agencyId).maybeSingle(),
      this.client.from("adaptive_equipment").select("*").eq("agency_id", agencyId),
      this.client.from("equipment_month_logs").select("*").eq("agency_id", agencyId),
      this.client.from("emergency_drills").select("*").eq("agency_id", agencyId),
      this.client.from("home_safety_reports").select("*").eq("agency_id", agencyId),
      this.client.from("site_facts").select("*").eq("agency_id", agencyId),
      this.client.from("site_reviews").select("*").eq("agency_id", agencyId),
      this.client.from("agency_branding").select("*").eq("agency_id", agencyId).maybeSingle(),
      this.client.from("staff_assignments").select("*").eq("agency_id", agencyId),
      this.client.from("appointments").select("*").eq("agency_id", agencyId),
    ]);

    for (const result of [
      sitesRes,
      programsRes,
      individualsRes,
      profilesRes,
      membershipsRes,
      documentsRes,
      versionsRes,
      requirementsRes,
      packetsRes,
      rowsRes,
      auditRes,
      scoreRes,
      rolesRes,
      indProfilesRes,
      obligationsRes,
      obligationSigsRes,
      submissionsRes,
      renewalsRes,
      medsRes,
      checklistsRes,
      monthlyDueRes,
      equipmentRes,
      equipmentLogsRes,
      drillsRes,
      safetyRes,
      siteFactsRes,
      reviewsRes,
      brandingRes,
      assignmentsRes,
    ]) {
      throwIf(result.error, "Could not load the agency workspace.");
    }
    // Appointments ship with Health H1; ignore until the migration is applied.
    const appointmentRows = appointmentsRes.error ? [] : (appointmentsRes.data ?? []);

    const canViewPeople = hasPermission(session, "individuals.view");
    const canReadAudit = hasPermission(session, "audit.read") || canViewPeople;
    const sites = (sitesRes.data ?? []).map(mapSite);
    const programs = programsRes.data ?? [];
    const individuals = canViewPeople
      ? (individualsRes.data ?? []).map(mapIndividual)
      : [];
    const profiles = (profilesRes.data ?? []).map(mapProfile);
    const memberships = membershipsRes.data ?? [];
    const documents = canViewPeople
      ? (documentsRes.data ?? []).map(mapDocument)
      : [];
    const versions = canViewPeople
      ? (versionsRes.data ?? []).map(mapVersion)
      : [];
    const requirements = canViewPeople
      ? (requirementsRes.data ?? []).map(mapRequirementRow)
      : [];
    const packets = canViewPeople
      ? (packetsRes.data ?? []).map(mapPacket)
      : [];
    const rows = canViewPeople ? (rowsRes.data ?? []).map(mapAckRow) : [];
    const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));
    const membershipByUser = Object.fromEntries(
      memberships.map((m) => [m.user_id as string, m]),
    );
    const siteById = Object.fromEntries(sites.map((s) => [s.id, s]));
    const programById = Object.fromEntries(
      programs.map((p) => [p.id as string, p.name as string]),
    );
    const documentById = Object.fromEntries(documents.map((d) => [d.id, d]));
    const versionById = Object.fromEntries(versions.map((v) => [v.id, v]));
    const individualById = Object.fromEntries(individuals.map((p) => [p.id, p]));
    const managerBySite = Object.fromEntries(
      memberships
        .filter((m) => m.role === "manager" && m.site_id)
        .map((m) => {
          const profile = profileById[m.user_id as string];
          return [m.site_id as string, profile?.fullName ?? "Unassigned"];
        }),
    );
    const fallbackManager =
      profiles.find((p) => membershipByUser[p.id]?.role === "administrator")?.fullName ??
      session.fullName;
    const colors = ["purple", "green", "peach", "blue"];

    // Idempotent per-load collection setup (monthly cycles, renewal rows,
    // training rosters), then re-read the tables it may have added rows to.
    if (canViewPeople) {
      await this.ensureHostedCollections(session, {
        sites,
        individuals,
        equipment: (equipmentRes.data ?? []).map(mapAdaptiveEquipment),
      });
      const [renewalsFresh, checklistsFresh, equipmentLogsFresh, drillsFresh, safetyFresh, reviewsFresh] =
        await Promise.all([
          this.client.from("clinical_renewals").select("*").eq("agency_id", agencyId),
          this.client.from("training_checklists").select("*").eq("agency_id", agencyId),
          this.client.from("equipment_month_logs").select("*").eq("agency_id", agencyId),
          this.client.from("emergency_drills").select("*").eq("agency_id", agencyId),
          this.client.from("home_safety_reports").select("*").eq("agency_id", agencyId),
          this.client.from("site_reviews").select("*").eq("agency_id", agencyId),
        ]);
      for (const result of [
        renewalsFresh,
        checklistsFresh,
        equipmentLogsFresh,
        drillsFresh,
        safetyFresh,
        reviewsFresh,
      ]) {
        throwIf(result.error, "Could not load the agency workspace.");
      }
      renewalsRes.data = renewalsFresh.data;
      checklistsRes.data = checklistsFresh.data;
      equipmentLogsRes.data = equipmentLogsFresh.data;
      drillsRes.data = drillsFresh.data;
      safetyRes.data = safetyFresh.data;
      reviewsRes.data = reviewsFresh.data;
    }

    const individualProfiles = new Map<string, IndividualProfile>();
    for (const row of (indProfilesRes.data ?? []) as Record<string, unknown>[]) {
      const person = individualById[row.individual_id as string];
      if (!person) continue;
      individualProfiles.set(
        person.id,
        normalizeProfile(person, profileFromRow(person, row)),
      );
    }
    const versionLabelById = new Map<string, string | null>(
      versions.map((version) => [version.id, version.versionLabel]),
    );
    const orderReminderDays = canViewPeople
      ? (await this.loadOperatingRules(session.agencyId)).orderReminderDays
      : undefined;
    // The MAR medication list derives from active orders: a medication fed by a
    // discontinued order drops off the board. Fetch the order statuses once.
    const medOrderStatuses = canViewPeople
      ? (
          (
            await this.client
              .from("medication_orders")
              .select("id,status")
              .eq("agency_id", agencyId)
          ).data ?? []
        ).map((row) => ({
          id: String((row as Record<string, unknown>).id),
          status: String(
            (row as Record<string, unknown>).status,
          ) as MedicationOrder["status"],
        }))
      : [];
    const planStacks = canViewPeople
      ? individuals.map((person) =>
          this.hostedPlanStack(session, person, {
            orderReminderDays,
            profileRow:
              ((indProfilesRes.data ?? []) as Record<string, unknown>[]).find(
                (row) => row.individual_id === person.id,
              ) ?? null,
            obligations: (obligationsRes.data ?? []).map(mapObligation),
            signatures: (obligationSigsRes.data ?? []).map(mapObligationSignature),
            submissions: (submissionsRes.data ?? []).map((row) => ({
              individualId: row.individual_id as string,
              userId: row.user_id as string,
              submittedAt: (row.submitted_at as string | null) ?? null,
            })),
            renewals: (renewalsRes.data ?? []).map(mapClinicalRenewal),
            medications: (medsRes.data ?? [])
              .map(mapMedication)
              .filter((med) => medicationStaysOnMar(med, medOrderStatuses)),
            appointments: appointmentRows.map(mapAppointment),
            checklists: (checklistsRes.data ?? []).map(mapTrainingChecklist),
            versionLabelById,
          }),
        )
      : [];
    const monthly = {
      equipment: (equipmentRes.data ?? []).map(mapAdaptiveEquipment),
      equipmentLogs: (equipmentLogsRes.data ?? []).map(mapEquipmentMonthLog),
      drills: (drillsRes.data ?? []).map(mapEmergencyDrill),
      safetyReports: (safetyRes.data ?? []).map(mapHomeSafetyReport),
    };
    const monthlyDue = normalizeMonthlyDue(
      monthlyDueRes.data
        ? {
            equipmentDay: monthlyDueRes.data.equipment_day as number,
            drillDay: monthlyDueRes.data.drill_day as number,
            safetyDay: monthlyDueRes.data.safety_day as number,
          }
        : undefined,
    );
    const factsBySite = new Map<string, SiteFacts>();
    for (const row of (siteFactsRes.data ?? []) as Record<string, unknown>[]) {
      factsBySite.set(
        row.site_id as string,
        normalizeSiteFacts((row.facts as Partial<SiteFacts> | null) ?? {}),
      );
    }
    const siteReviews = (reviewsRes.data ?? []).map((row) =>
      normalizeSiteReview(
        applyWellWaterDefault(
          mapSiteReview(row),
          factsBySite.get(row.site_id as string) ?? normalizeSiteFacts(),
        ),
      ),
    );
    const logoUrl = await this.hostedLogoDataUrl(agencyId);

    // Pass 3 (simulation Phase D): the session user's own active
    // assignment site ids — site assignments directly, plus the site of
    // any Individual they are assigned to (active = starts_on <= today
    // and (ends_on null or >= today), mirroring the assignment branch of
    // private.can_read_site). RLS already scoped assignmentsRes to rows
    // this caller may read; filter to their own rows here.
    const assignmentToday = todayIso();
    const individualSiteById = Object.fromEntries(
      (individualsRes.data ?? []).map((row) => [row.id as string, row.site_id as string]),
    );
    const assignmentSiteIds = [...new Set(
      ((assignmentsRes.data ?? []) as Record<string, unknown>[])
        .filter((row) => row.user_id === session.userId &&
          (row.starts_on as string) <= assignmentToday &&
          (!row.ends_on || (row.ends_on as string) >= assignmentToday))
        .map((row) => (row.site_id as string | null) ??
          (row.individual_id ? individualSiteById[row.individual_id as string] ?? null : null))
        .filter((id): id is string => Boolean(id)),
    )];

    return {
      session,
      assignmentSiteIds,
      sites: sites.map((site, i) => ({
        id: site.id,
        name: site.name,
        address: site.address,
        program: programById[site.programId] ?? "",
        manager: managerBySite[site.id] ?? fallbackManager,
        color: ["purple", "green", "peach", "blue", "pink", "green"][i % 6],
        initials: (managerBySite[site.id] ?? fallbackManager)
          .split(" ")
          .map((part) => part[0])
          .join(""),
        ...normalizeSiteFacts(factsBySite.get(site.id)),
      })),
      individuals: individuals.map((person, i) => {
        const site = siteById[person.siteId];
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
          profile: individualProfiles.get(person.id) ?? null,
          photoUrl: person.photoUrl || portraitSrc(person.fullName),
        };
      }),
      staff: memberships.map((membership) => {
        const profile = profileById[membership.user_id as string];
        const site = membership.site_id
          ? siteById[membership.site_id as string]
          : undefined;
        return {
          id: membership.user_id as string,
          name: profile?.fullName ?? "Unknown",
          role: roleLabel(
            String(membership.role_key ?? membership.role),
            profile?.jobTitle,
          ),
          site: site?.name ?? "Agency-wide",
          email: profile?.email ?? "",
          username: profile?.username ?? "",
          appRole: asRole(membership.role as string),
          roleKey: String(membership.role_key ?? membership.role),
          siteId: (membership.site_id as string | null) ?? null,
          expiresOn: membership.expires_on
            ? String(membership.expires_on).slice(0, 10)
            : null,
          hiredOn: profile?.hiredOn ?? null,
        };
      }),
      requirements: requirements.map((row) => {
        const owner = row.ownerUserId ? profileById[row.ownerUserId] : undefined;
        const ownerMembership = row.ownerUserId
          ? membershipByUser[row.ownerUserId]
          : undefined;
        const version = row.documentVersionId
          ? versionById[row.documentVersionId]
          : undefined;
        const document = version ? documentById[version.documentId] : undefined;
        return {
          id: row.id,
          title: row.title,
          person: row.individualId
            ? (individualById[row.individualId]?.fullName ?? "Unknown")
            : "Site-wide",
          site: siteById[row.siteId]?.name ?? "Unknown site",
          category: row.category,
          owner: owner?.fullName ?? "Unassigned",
          role: roleLabel(asRole((ownerMembership?.role as string) ?? "dsp"), owner?.jobTitle),
          due: row.dueOn,
          status: row.status === "Compliant" || row.status === "Pending review" ? row.status : computeRequirementStatus(row.dueOn, row.category),
          source:
            document && version
              ? `${document.title} · ${version.versionLabel}`
              : "Agency requirement",
          page: row.sourcePage,
          frequency: row.frequency,
          evidence: row.evidenceNote,
          completedAt: row.completedAt,
        } satisfies Requirement;
      }),
      plans: versions.flatMap((version) => {
        const document = documentById[version.documentId];
        const individual = document ? individualById[document.individualId] : undefined;
        if (!document || !individual) return [];
        return [
          {
            id: version.id,
            name: document.title,
            person: individual.fullName,
            site: siteById[individual.siteId]?.name ?? "Unknown site",
            version: version.versionLabel,
            effective: version.effectiveOn,
            status: reviewStatusLabel(version.status),
            pages: version.pageCount,
          } satisfies Plan,
        ];
      }),
      activity: (canReadAudit ? auditRes.data ?? [] : []).map((event) => ({
        id: event.id as string,
        text: String(event.action).replaceAll(".", " "),
        detail: (event.detail as string) ?? "",
        time: event.created_at as string,
        kind: activityKind(String(event.action)),
      })),
      packets: packets.flatMap((packet) => {
        const individual = individualById[packet.individualId];
        const version = versionById[packet.documentVersionId];
        const document = version ? documentById[version.documentId] : undefined;
        const site = individual ? siteById[individual.siteId] : undefined;
        if (!individual || !version || !document || !site) return [];
        const packetRows = rows
          .filter((row) => row.packetId === packet.id)
          .sort((a, b) => {
            if (a.signedAt && b.signedAt) return a.signedAt.localeCompare(b.signedAt);
            if (a.signedAt) return -1;
            if (b.signedAt) return 1;
            return a.staffName.localeCompare(b.staffName);
          });
        return [
          {
            packet,
            individual,
            site,
            version,
            document,
            rows: packetRows,
          } satisfies PacketDetail,
        ];
      }),
      roles: mapAgencyRoles(agencyId, rolesRes.data ?? []),
      planStacks,
      scorecard: {
        score: Number((scoreRes.data as { score?: number } | null)?.score ?? 100),
        total: Number((scoreRes.data as { total?: number } | null)?.total ?? 0),
        done: Number((scoreRes.data as { done?: number } | null)?.done ?? 0),
        overdue: Number((scoreRes.data as { overdue?: number } | null)?.overdue ?? 0),
        dueSoon: Number((scoreRes.data as { dueSoon?: number } | null)?.dueSoon ?? 0),
        review: Number((scoreRes.data as { review?: number } | null)?.review ?? 0),
      },
      monthly,
      monthlyDue,
      siteReviews,
      branding: { logoUrl },
    };
  }

  async createRequirementDraft(input: Parameters<ComplyraApi["createRequirementDraft"]>[0]) {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.upload");
    if (!input.title.trim()) throw new Error("Enter a title for the requirement.");
    assertCalendarDate(input.dueOn, "Use a valid due date.");
    if (!Number.isInteger(input.sourcePage) || input.sourcePage < 1) throw new Error("Source page must be a positive whole number.");
    const { data: individual, error: personError } = await this.client
      .from("individuals")
      .select("id, site_id, full_name")
      .eq("id", input.individualId)
      .single();
    throwIf(personError, "Individual not found.");
    const versionId = await this.versionIdFromSource(input.source);
    const { error } = await this.client.from("requirement_definitions").insert({
      agency_id: session.agencyId,
      document_version_id: versionId,
      individual_id: individual!.id,
      site_id: individual!.site_id,
      title: input.title.trim(),
      category: input.category,
      owner_user_id: input.ownerUserId,
      due_on: input.dueOn,
      frequency: input.frequency,
      source_page: input.sourcePage,
      status: "pending_review",
    });
    throwIf(error, "Could not save the draft requirement.");
    await this.audit(
      session,
      "requirement.drafted",
      `${input.title} · ${individual!.full_name} · Pending manager approval`,
      "requirement",
    );
  }

  async approveRequirement(id: string) {
    const session = await this.requireSession();
    this.requirePermission(session, "requirements.approve");
    const { data: item, error } = await this.client
      .from("requirement_definitions")
      .select("*")
      .eq("id", id)
      .single();
    throwIf(error, "Requirement not found.");
    if (item!.status !== "pending_review") {
      throw new Error("Only draft requirements can be approved.");
    }
    const nextStatus = requirementStatusToDb(
      computeRequirementStatus(item!.due_on as string, item!.category as string),
    );
    const { error: updateError } = await this.client
      .from("requirement_definitions")
      .update({ status: nextStatus })
      .eq("id", id);
    throwIf(updateError, "Could not approve that requirement.");

    if (item!.document_version_id) {
      const { data: pending } = await this.client
        .from("requirement_definitions")
        .select("id")
        .eq("document_version_id", item!.document_version_id)
        .eq("status", "pending_review");
      const { data: version } = await this.client
        .from("document_versions")
        .select("id, status")
        .eq("id", item!.document_version_id)
        .maybeSingle();
      if (version?.status === "pending_review" && (pending ?? []).length === 0) {
        const { error: activateError } = await this.client.rpc(
          "activate_document_version",
          { p_version_id: version.id },
        );
        throwIf(activateError, "Requirement approved, but the plan could not be activated.");
        // LIFEPATH-P2 hook: targeted retraining for staff assigned to this individual.
        const person = await this.individualRecord(String(item!.individual_id));
        if (person) {
          await this.p2GeneratePlanRetraining(
            session,
            person.id,
            person.siteId,
            person.fullName,
            String(version.id),
          );
        }
      }
    }

    const ownerName = await this.profileName(item!.owner_user_id as string | null);
    await this.audit(
      session,
      "requirement.approved",
      `${item!.title} · Approved by ${session.fullName} · Assigned to ${ownerName}`,
      "requirement",
      id,
    );
  }

  async completeRequirement(id: string, evidence: string) {
    const session = await this.requireSession();
    this.requirePermission(session, "requirements.complete");
    if (!evidence.trim()) throw new Error("A completion record is required.");
    const { data: item, error } = await this.client
      .from("requirement_definitions")
      .select("*")
      .eq("id", id)
      .single();
    throwIf(error, "Requirement not found.");
    if (item!.status === "pending_review") {
      throw new Error("Approve this requirement before recording completion.");
    }
    if (
      session.role === "dsp" &&
      item!.owner_user_id !== session.userId
    ) {
      throw new Error("You can only complete requirements assigned to you.");
    }
    const { error: updateError } = await this.client
      .from("requirement_definitions")
      .update({
        status: "compliant",
        evidence_note: evidence.trim(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    throwIf(updateError, "Could not record completion.");
    const siteName = await this.siteName(item!.site_id as string);
    await this.audit(
      session,
      "requirement.completed",
      `${session.fullName} · ${item!.title} · ${siteName}`,
      "requirement",
      id,
    );
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
    const session = await this.requireSession();
    this.requirePermission(session, "requirements.approve");
    const { data: item, error } = await this.client
      .from("requirement_definitions")
      .select("id, title, due_on, frequency, owner_user_id, status, category")
      .eq("id", id)
      .single();
    throwIf(error, "Requirement not found.");
    const update: Record<string, string> = {};
    const changes: string[] = [];
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new Error("Enter a title for the requirement.");
      if (title !== item!.title) {
        update.title = title;
        changes.push(`title → "${title}"`);
      }
    }
    if (patch.dueOn !== undefined) {
      assertCalendarDate(patch.dueOn, "Use a valid due date.");
      if (patch.dueOn !== item!.due_on) {
        update.due_on = patch.dueOn;
        changes.push(`due ${item!.due_on} → ${patch.dueOn}`);
      }
    }
    if (patch.frequency !== undefined && patch.frequency !== item!.frequency) {
      update.frequency = patch.frequency;
      changes.push(`frequency → ${patch.frequency}`);
    }
    if (
      patch.ownerUserId !== undefined &&
      patch.ownerUserId !== item!.owner_user_id
    ) {
      update.owner_user_id = patch.ownerUserId;
      changes.push(`owner → ${await this.profileName(patch.ownerUserId)}`);
    }
    if (!changes.length) return;
    if (item!.status !== "pending_review" && item!.status !== "compliant") {
      update.status = requirementStatusToDb(
        computeRequirementStatus(
          update.due_on ?? (item!.due_on as string),
          item!.category as string,
        ),
      );
    }
    const { error: updateError } = await this.client
      .from("requirement_definitions")
      .update(update)
      .eq("id", id);
    throwIf(updateError, "Could not correct that requirement.");
    await this.audit(
      session,
      "requirement.corrected",
      `${session.fullName} corrected ${update.title ?? item!.title} · ${changes.join(" · ")}`,
      "requirement",
      id,
    );
  }

  async uploadDocument(input: UploadDocumentInput) {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.upload");
    if (!input.file.name.toLowerCase().endsWith(".pdf") || input.file.size > 10 * 1024 * 1024) {
      throw new Error("Choose a PDF smaller than 10 MB.");
    }
    const { data: individual, error: personError } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", input.individualId)
      .single();
    throwIf(personError, "Individual not found.");
    const title = input.title || `${individual!.full_name} · PCSP 2026`;
    let documentId: string;
    const { data: existing } = await this.client
      .from("documents")
      .select("id")
      .eq("individual_id", individual!.id)
      .eq("title", title)
      .maybeSingle();
    if (existing?.id) {
      documentId = existing.id;
    } else {
      const { data: created, error: createError } = await this.client
        .from("documents")
        .insert({
          agency_id: session.agencyId,
          individual_id: individual!.id,
          title,
          kind: input.kind ?? "pcsp",
        })
        .select("id")
        .single();
      throwIf(createError, "Could not create the document record.");
      documentId = created!.id;
    }

    const { data: prior } = await this.client
      .from("document_versions")
      .select("version_label")
      .eq("document_id", documentId);
    const nextNumber =
      Math.max(
        0,
        ...(prior ?? []).map(
          (row) => parseInt(String(row.version_label).replace("v", ""), 10) || 0,
        ),
      ) + 1;
    const versionId = crypto.randomUUID();
    const storagePath = `${session.agencyId}/${individual!.id}/${versionId}/source.pdf`;
    const bytes = await input.file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
    const contentHash = [...new Uint8Array(hashBuffer)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error: uploadError } = await this.client.storage
      .from(BUCKET)
      .upload(storagePath, input.file, { contentType: "application/pdf", upsert: false });
    throwIf(uploadError, "Could not store the PDF.");
    const { error: versionError } = await this.client.from("document_versions").insert({
      id: versionId,
      agency_id: session.agencyId,
      document_id: documentId,
      version_label: `v${nextNumber} draft`,
      status: "pending_review",
      storage_path: storagePath,
      content_hash: contentHash,
      page_count: input.pageCount,
      effective_on: input.effectiveOn,
      expires_on: input.expiresOn ?? null,
      created_by: session.userId,
    });
    throwIf(versionError, "Could not save the document version.");
    if (input.requirementTitle?.trim()) {
      if ((input.sourcePage ?? 1) > input.pageCount) {
        throw new Error("The source page cannot exceed the document’s page count.");
      }
      const { error: reqError } = await this.client.from("requirement_definitions").insert({
        agency_id: session.agencyId,
        document_version_id: versionId,
        individual_id: individual!.id,
        site_id: individual!.site_id,
        title: input.requirementTitle.trim(),
        category: input.category ?? "PCSP acknowledgments",
        owner_user_id: input.ownerUserId ?? session.userId,
        due_on: input.dueOn ?? input.effectiveOn,
        frequency: input.frequency ?? "On plan update",
        source_page: input.sourcePage ?? 1,
        status: "pending_review",
      });
      throwIf(reqError, "Document saved, but the draft requirement could not be created.");
    }
    await this.audit(
      session,
      "document.uploaded",
      `${title} · v${nextNumber} draft · File retained (${input.file.name})`,
      "document_version",
      versionId,
    );
  }

  async getDocumentFile(versionId: string) {
    const { data: version, error } = await this.client
      .from("document_versions")
      .select("storage_path")
      .eq("id", versionId)
      .maybeSingle();
    throwIf(error, "Document version not found.");
    if (!version?.storage_path) return null;
    const { data, error: signedError } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(version.storage_path, 60);
    throwIf(signedError, "Could not open that document.");
    if (!data?.signedUrl) return null;
    const response = await fetch(data.signedUrl);
    if (!response.ok) return null;
    return response.blob();
  }

  async assignStaff(individualId: string, userId: string) {
    const session = await this.requirePrivileged();
    const { data: individual, error } = await this.client
      .from("individuals")
      .select("id, site_id, full_name")
      .eq("id", individualId)
      .single();
    throwIf(error, "Individual not found.");
    const { error: assignError } = await this.client.from("staff_assignments").insert({
      agency_id: session.agencyId,
      user_id: userId,
      individual_id: individualId,
      site_id: individual!.site_id,
      starts_on: new Date().toISOString().slice(0, 10),
    });
    throwIf(assignError, "Could not assign that staff member.");
    const { data: packets } = await this.client
      .from("acknowledgment_packets")
      .select("id")
      .eq("individual_id", individualId)
      .eq("status", "open");
    for (const packet of packets ?? []) {
      const { error: syncError } = await this.client.rpc("sync_packet_roster", {
        p_packet_id: packet.id,
      });
      throwIf(syncError, "Staff assigned, but the acknowledgment sheet could not be updated.");
    }
    const staffName = await this.profileName(userId);
    // LIFEPATH-P2 hook: auto-generate the full in-home checklist for the newly assigned staff.
    await this.p2GenerateForNewAssignment(session, userId, individual!);
    await this.audit(
      session,
      "staff.assigned",
      `${staffName} assigned to ${individual!.full_name}`,
      "staff_assignment",
    );
  }

  async addPacketSigner(packetId: string, userId: string, reason: string) {
    const session = await this.requireSession();
    this.requirePermission(session, "acknowledgments.manage");
    if (!reason.trim()) throw new Error("Add a reason for this one-off signer.");
    const { data: packet, error } = await this.client
      .from("acknowledgment_packets")
      .select("*")
      .eq("id", packetId)
      .single();
    throwIf(error, "Packet not found.");
    if (packet!.status !== "open") throw new Error("Packet not found.");
    const { data: existing } = await this.client
      .from("acknowledgment_rows")
      .select("id")
      .eq("packet_id", packetId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) throw new Error("That staff member is already on this sheet.");
    const staffName = await this.profileName(userId);
    if (staffName === "Unassigned") throw new Error("Staff member not found.");
    const { error: insertError } = await this.client.from("acknowledgment_rows").insert({
      agency_id: packet!.agency_id,
      packet_id: packetId,
      user_id: userId,
      staff_name: staffName,
      added_manually: true,
      add_reason: reason.trim(),
    });
    throwIf(insertError, "Could not add that signer.");
    await this.audit(
      session,
      "acknowledgment.signer_added",
      `${staffName} added to acknowledgment sheet · ${reason.trim()}`,
      "acknowledgment_row",
    );
  }

  async markOpened(rowId: string) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("acknowledgment_rows")
      .select("*")
      .eq("id", rowId)
      .single();
    throwIf(error, "Acknowledgment row not found.");
    if (row!.user_id !== session.userId && !isPrivileged(session.role)) {
      throw new Error("You can only open your assigned acknowledgments.");
    }
    if (!row!.opened_at) {
      const { error: updateError } = await this.client
        .from("acknowledgment_rows")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", rowId);
      throwIf(updateError, "Could not record that the document was opened.");
    }
    await this.audit(
      session,
      "document.opened",
      `${session.fullName} opened the source document for acknowledgment`,
      "acknowledgment_row",
      rowId,
    );
  }

  async signRow(rowId: string, signatureName: string, signatureMark: string) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("acknowledgment_rows")
      .select("*")
      .eq("id", rowId)
      .single();
    throwIf(error, "Acknowledgment row not found.");
    if (row!.user_id !== session.userId) {
      throw new Error("Staff must sign their own acknowledgment row.");
    }
    const { data: packet } = await this.client
      .from("acknowledgment_packets")
      .select("*")
      .eq("id", row!.packet_id)
      .maybeSingle();
    if (!packet || packet.status !== "open") {
      throw new Error("This acknowledgment sheet is locked.");
    }
    if (!row!.opened_at) {
      throw new Error("Open and review the PCSP before signing.");
    }
    if (row!.signed_at) throw new Error("This row is already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    const { error: updateError } = await this.client
      .from("acknowledgment_rows")
      .update({
        signature_name: signatureName.trim(),
        signature_mark: signatureMark,
        signed_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    throwIf(updateError, "Could not save the signature.");
    await this.audit(
      session,
      "acknowledgment.signed",
      `${session.fullName} signed ${packet.what_acknowledging}`,
      "acknowledgment_row",
      rowId,
    );
  }

  // ---- Individual chart (plan stack) ----

  async updateIndividualProfile(individualId: string, profile: IndividualProfile) {
    const session = await this.requireSession();
    if (!canEditCover(session.roleKey)) {
      throw new Error("Only a PM or compliance admin can edit cover-page fields.");
    }
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", individualId)
      .single();
    throwIf(personError, "Individual not found.");
    const record = mapIndividual(person!);
    const normalized = normalizeProfile(record, profile);
    const { error: profileError } = await this.client.from("individual_profiles").upsert(
      {
        agency_id: session.agencyId,
        individual_id: record.id,
        profile: normalized,
      },
      { onConflict: "individual_id" },
    );
    throwIf(profileError, "Could not save the cover page.");
    if (normalized.legalName.trim()) {
      const { error: nameError } = await this.client
        .from("individuals")
        .update({ full_name: normalized.legalName.trim() })
        .eq("id", record.id);
      throwIf(nameError, "Cover page saved, but the legal name could not be updated.");
    }
  }

  /**
   * Issue #81 — narrowly scoped contact update. Reads the stored profile,
   * patches only guardians + providerContacts, and upserts the merged row so
   * one role cannot overwrite fields outside its permission.
   */
  async updateIndividualContacts(
    individualId: string,
    patch: { guardians: GuardianContact[]; providerContacts: ProviderContact[] },
  ) {
    const session = await this.requireSession();
    if (!canEditIndividualContacts(session.roleKey)) {
      throw new Error("Only a house manager, PM, or administrator can edit contacts.");
    }
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", individualId)
      .single();
    throwIf(personError, "Individual not found.");
    const record = mapIndividual(person!);
    const { data: profileRow } = await this.client
      .from("individual_profiles")
      .select("profile")
      .eq("individual_id", record.id)
      .maybeSingle();
    const current = normalizeProfile(record, profileRow?.profile ?? null);
    current.guardians = normalizeGuardianContacts(patch.guardians);
    current.providerContacts = normalizeProviderContacts(patch.providerContacts);
    const { error: profileError } = await this.client.from("individual_profiles").upsert(
      {
        agency_id: session.agencyId,
        individual_id: record.id,
        profile: current,
      },
      { onConflict: "individual_id" },
    );
    throwIf(profileError, "Could not save the contacts.");
  }

  /** Issue #81 — narrowly scoped diagnosis update; only the diagnosis field is written. */
  async updateIndividualDiagnosis(individualId: string, diagnosis: string) {
    const session = await this.requireSession();
    if (!canEditDiagnoses(session.roleKey)) {
      throw new Error("Only a nurse, PM, or administrator can edit diagnoses.");
    }
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", individualId)
      .single();
    throwIf(personError, "Individual not found.");
    const record = mapIndividual(person!);
    const { data: profileRow } = await this.client
      .from("individual_profiles")
      .select("profile")
      .eq("individual_id", record.id)
      .maybeSingle();
    const current = normalizeProfile(record, profileRow?.profile ?? null);
    current.diagnosis = diagnosis.trim();
    const { error: profileError } = await this.client.from("individual_profiles").upsert(
      {
        agency_id: session.agencyId,
        individual_id: record.id,
        profile: current,
      },
      { onConflict: "individual_id" },
    );
    throwIf(profileError, "Could not save the diagnosis.");
  }

  // ------------------------------------------------------------------
  // Issue #80 — ISP programs + shift notes (Therap-informed).
  // ------------------------------------------------------------------

  private mapIspScoringMethod(row: Record<string, unknown>): IspScoringMethod {
    const levels = Array.isArray(row.levels) ? row.levels : [];
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      name: String(row.name ?? ""),
      levels: levels.map((level: Record<string, unknown>, i: number) => ({
        id: String(level.id ?? `${row.id}-l${i}`),
        caption: String(level.caption ?? ""),
        shortLabel: String(level.short_label ?? level.shortLabel ?? ""),
        reportable: level.reportable !== false,
        sortOrder: Number(level.sort_order ?? level.sortOrder ?? i),
      })),
      createdBy: String(row.created_by ?? ""),
      createdByName: String(row.created_by_name ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
  }

  private mapIspProgram(row: Record<string, unknown>): IspProgram {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      individualId: String(row.individual_id),
      planYear: String(row.plan_year ?? ""),
      name: String(row.name ?? ""),
      effectiveOn: String(row.effective_on ?? "").slice(0, 10),
      expiresOn: String(row.expires_on ?? "").slice(0, 10),
      schedule: (row.schedule as IspProgram["schedule"]) ?? "per_shift",
      maxEntriesPerDay: Number(row.max_entries_per_day ?? 1),
      scoringMethodId: String(row.scoring_method_id ?? ""),
      status: (row.status as IspProgram["status"]) ?? "draft",
      approvedBy: String(row.approved_by ?? ""),
      approvedByName: String(row.approved_by_name ?? ""),
      approvedAt: String(row.approved_at ?? ""),
      createdBy: String(row.created_by ?? ""),
      createdByName: String(row.created_by_name ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      goalService: String(row.goal_service ?? ""),
      completionCriteria: String(row.completion_criteria ?? ""),
      scheduleComment: String(row.schedule_comment ?? ""),
    };
  }

  async getIspData(individualId: string): Promise<{
    programs: IspProgramView[];
    scoringMethods: IspScoringMethod[];
    notes: ShiftNoteView[];
  }> {
    const session = await this.requireSession();
    if (!canSeeShiftNotes(session.roleKey) && !canConfigureIspTasks(session.roleKey)) {
      throw new Error("You do not have access to shift notes.");
    }
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("id")
      .eq("id", individualId)
      .single();
    throwIf(personError, "Individual not found.");
    void person;
    const staffSeesAll = canConfigureIspTasks(session.roleKey);
    let programQuery = this.client
      .from("isp_programs")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("plan_year", { ascending: false });
    if (!staffSeesAll) programQuery = programQuery.eq("status", "approved");
    const { data: programRows, error: programError } = await programQuery;
    throwIf(programError, "Could not load ISP programs.");
    const programs = (programRows ?? []).map((row) => this.mapIspProgram(row));
    const programIds = programs.map((program) => program.id);
    const { data: taskRows, error: taskError } = programIds.length
      ? await this.client
          .from("isp_program_tasks")
          .select("*")
          .in("program_id", programIds)
          .order("sort_order", { ascending: true })
      : { data: [], error: null };
    throwIf(taskError, "Could not load ISP tasks.");
    const { data: methodRows, error: methodError } = await this.client
      .from("isp_scoring_methods")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("name", { ascending: true });
    throwIf(methodError, "Could not load scoring methods.");
    const scoringMethods = (methodRows ?? []).map((row) => this.mapIspScoringMethod(row));
    const { data: noteRows, error: noteError } = await this.client
      .from("shift_notes")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .is("deleted_at", null)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30);
    throwIf(noteError, "Could not load shift notes.");
    const noteIds = (noteRows ?? []).map((row) => String(row.id));
    const { data: scoreRows, error: scoreError } = noteIds.length
      ? await this.client.from("shift_note_task_scores").select("*").in("note_id", noteIds)
      : { data: [], error: null };
    throwIf(scoreError, "Could not load note scores.");
    const tasksByProgram = new Map<string, { id: string; programId: string; title: string; instructions: string; sortOrder: number }[]>();
    for (const row of taskRows ?? []) {
      const list = tasksByProgram.get(String(row.program_id)) ?? [];
      list.push({
        id: String(row.id),
        programId: String(row.program_id),
        title: String(row.title ?? ""),
        instructions: String(row.instructions ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
      });
      tasksByProgram.set(String(row.program_id), list);
    }
    const taskTitleById = new Map<string, string>();
    for (const tasks of tasksByProgram.values()) {
      for (const task of tasks) taskTitleById.set(task.id, task.title);
    }
    const scoresByNote = new Map<string, ShiftNoteView["scores"]>();
    for (const row of scoreRows ?? []) {
      const list = scoresByNote.get(String(row.note_id)) ?? [];
      list.push({
        id: String(row.id),
        noteId: String(row.note_id),
        taskId: String(row.task_id),
        taskTitle: taskTitleById.get(String(row.task_id)) ?? "",
        levelId: String(row.level_id),
        comment: String(row.comment ?? ""),
      });
      scoresByNote.set(String(row.note_id), list);
    }
    const methodById = new Map(scoringMethods.map((method) => [method.id, method]));
    return {
      programs: programs.map((program) => ({
        ...program,
        tasks: tasksByProgram.get(program.id) ?? [],
        scoringMethod: methodById.get(program.scoringMethodId) ?? null,
      })),
      scoringMethods,
      notes: (noteRows ?? []).map((row) => {
        const program = programs.find((item) => item.id === String(row.program_id));
        return {
          id: String(row.id),
          agencyId: String(row.agency_id),
          individualId: String(row.individual_id),
          programId: String(row.program_id),
          noteDate: String(row.note_date ?? "").slice(0, 10),
          shift: String(row.shift ?? ""),
          beginTime: String(row.begin_time ?? ""),
          endTime: String(row.end_time ?? ""),
          location: String(row.location ?? ""),
          staffTitle: String(row.staff_title ?? ""),
          waiverService: String(row.waiver_service ?? ""),
          signatureDataUrl: String(row.signature_data_url ?? ""),
          summary: String(row.summary ?? ""),
          timeSpentMinutes: row.time_spent_minutes === null ? null : Number(row.time_spent_minutes),
          staffUserId: String(row.staff_user_id ?? ""),
          staffName: String(row.staff_name ?? ""),
          hrShiftId: row.hr_shift_id ? String(row.hr_shift_id) : null,
          createdAt: String(row.created_at ?? ""),
          updatedAt: String(row.updated_at ?? ""),
          deletedAt: row.deleted_at ? String(row.deleted_at) : null,
          programName: program?.name ?? "ISP program",
          scoringMethodName:
            methodById.get(program?.scoringMethodId ?? "")?.name ?? "",
          scores: scoresByNote.get(String(row.id)) ?? [],
        };
      }),
    };
  }

  private async requireIspProgram(programId: string) {
    const session = await this.requireSession();
    if (!canConfigureIspTasks(session.roleKey)) {
      throw new Error("Only a PM or administrator can configure ISP programs.");
    }
    const { data, error } = await this.client
      .from("isp_programs")
      .select("*")
      .eq("id", programId)
      .eq("agency_id", session.agencyId)
      .single();
    throwIf(error, "ISP program not found.");
    return { session, program: this.mapIspProgram(data as Record<string, unknown>) };
  }

  async createIspProgram(
    individualId: string,
    input: Parameters<ComplyraApi["createIspProgram"]>[1],
  ) {
    const session = await this.requireSession();
    if (!canConfigureIspTasks(session.roleKey)) {
      throw new Error("Only a PM or administrator can configure ISP programs.");
    }
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("id")
      .eq("id", individualId)
      .single();
    throwIf(personError, "Individual not found.");
    void person;
    const name = input.name.trim();
    if (!name) throw new Error("Give the ISP program a name.");
    if (!/^\d{4}$/.test(input.planYear.trim())) {
      throw new Error("Plan year must be a four-digit year.");
    }
    if (input.expiresOn < input.effectiveOn) {
      throw new Error("The expiry date must be on or after the effective date.");
    }
    const { data: method, error: methodError } = await this.client
      .from("isp_scoring_methods")
      .select("id")
      .eq("id", input.scoringMethodId)
      .eq("agency_id", session.agencyId)
      .single();
    throwIf(methodError, "Choose a scoring method for the program.");
    void method;
    const maxEntries = Math.trunc(input.maxEntriesPerDay);
    if (!Number.isFinite(maxEntries) || maxEntries < 1 || maxEntries > 10) {
      throw new Error("Max entries per day must be between 1 and 10.");
    }
    const { data, error } = await this.client
      .from("isp_programs")
      .insert({
        agency_id: session.agencyId,
        individual_id: individualId,
        plan_year: input.planYear.trim(),
        name,
        effective_on: input.effectiveOn,
        expires_on: input.expiresOn,
        schedule: input.schedule,
        max_entries_per_day: maxEntries,
        scoring_method_id: input.scoringMethodId,
        goal_service: input.goalService?.trim().slice(0, 4000) ?? "",
        completion_criteria: input.completionCriteria?.trim().slice(0, 4000) ?? "",
        schedule_comment: input.scheduleComment?.trim().slice(0, 4000) ?? "",
        status: "draft",
        created_by: session.userId,
        created_by_name: session.fullName,
      })
      .select("id")
      .single();
    throwIf(error, "Could not create the ISP program.");
    return String((data as { id: string }).id);
  }

  async updateIspProgram(
    programId: string,
    patch: Parameters<ComplyraApi["updateIspProgram"]>[1],
  ) {
    const { session, program } = await this.requireIspProgram(programId);
    void program;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error("Give the ISP program a name.");
      update.name = name;
    }
    if (patch.effectiveOn !== undefined) update.effective_on = patch.effectiveOn;
    if (patch.expiresOn !== undefined) update.expires_on = patch.expiresOn;
    if (patch.schedule !== undefined) update.schedule = patch.schedule;
    if (patch.maxEntriesPerDay !== undefined) {
      const maxEntries = Math.trunc(patch.maxEntriesPerDay);
      if (!Number.isFinite(maxEntries) || maxEntries < 1 || maxEntries > 10) {
        throw new Error("Max entries per day must be between 1 and 10.");
      }
      update.max_entries_per_day = maxEntries;
    }
    if (patch.scoringMethodId !== undefined) {
      const { data: method, error: methodError } = await this.client
        .from("isp_scoring_methods")
        .select("id")
        .eq("id", patch.scoringMethodId)
        .eq("agency_id", session.agencyId)
        .single();
      throwIf(methodError, "Choose a scoring method for the program.");
      void method;
      update.scoring_method_id = patch.scoringMethodId;
    }
    if (patch.goalService !== undefined) update.goal_service = patch.goalService.trim().slice(0, 4000);
    if (patch.completionCriteria !== undefined) {
      update.completion_criteria = patch.completionCriteria.trim().slice(0, 4000);
    }
    if (patch.scheduleComment !== undefined) {
      update.schedule_comment = patch.scheduleComment.trim().slice(0, 4000);
    }
    const { error } = await this.client.from("isp_programs").update(update).eq("id", programId);
    throwIf(error, "Could not update the ISP program.");
  }

  async approveIspProgram(programId: string) {
    const { session, program } = await this.requireIspProgram(programId);
    if (program.status === "approved") throw new Error("This program is already approved.");
    const { data: tasks, error: taskError } = await this.client
      .from("isp_program_tasks")
      .select("id")
      .eq("program_id", programId);
    throwIf(taskError, "Could not load ISP tasks.");
    if (!tasks?.length) throw new Error("Add at least one task before approving the program.");
    const now = new Date().toISOString();
    const { error: supersedeError } = await this.client
      .from("isp_programs")
      .update({ status: "superseded", updated_at: now })
      .eq("agency_id", session.agencyId)
      .eq("individual_id", program.individualId)
      .eq("plan_year", program.planYear)
      .eq("status", "approved")
      .neq("id", programId);
    throwIf(supersedeError, "Could not supersede the prior program.");
    const { error } = await this.client
      .from("isp_programs")
      .update({
        status: "approved",
        approved_by: session.userId,
        approved_by_name: session.fullName,
        approved_at: now,
        updated_at: now,
      })
      .eq("id", programId);
    throwIf(error, "Could not approve the ISP program.");
  }

  async saveIspProgramTasks(
    programId: string,
    tasks: Parameters<ComplyraApi["saveIspProgramTasks"]>[1],
  ) {
    await this.requireIspProgram(programId);
    const clean = tasks
      .map((task) => ({
        title: normalizeTaskTitle(task.title),
        instructions: task.instructions.trim().slice(0, 500),
      }))
      .filter((task) => task.title.length > 0);
    if (clean.length > 60) throw new Error("An ISP program holds at most 60 tasks.");
    const { error: deleteError } = await this.client
      .from("isp_program_tasks")
      .delete()
      .eq("program_id", programId);
    throwIf(deleteError, "Could not replace the task list.");
    if (clean.length) {
      const { error } = await this.client.from("isp_program_tasks").insert(
        clean.map((task, i) => ({
          program_id: programId,
          title: task.title,
          instructions: task.instructions,
          sort_order: i,
        })),
      );
      throwIf(error, "Could not save the tasks.");
    }
  }

  async createIspScoringMethod(
    input: Parameters<ComplyraApi["createIspScoringMethod"]>[0],
  ) {
    const session = await this.requireSession();
    if (!canConfigureIspTasks(session.roleKey)) {
      throw new Error("Only a PM or administrator can configure ISP programs.");
    }
    const name = input.name.trim();
    if (!name) throw new Error("Give the scoring method a name.");
    const levels = input.levels
      .map((level) => ({
        caption: level.caption.trim(),
        short_label: level.shortLabel.trim().slice(0, 8),
        reportable: level.reportable,
      }))
      .filter((level) => level.caption.length > 0 && level.short_label.length > 0);
    if (levels.length < 2) throw new Error("A scoring method needs at least two levels.");
    if (levels.length > 10) throw new Error("A scoring method holds at most 10 levels.");
    const { data, error } = await this.client
      .from("isp_scoring_methods")
      .insert({
        agency_id: session.agencyId,
        name,
        levels: levels.map((level, i) => ({ id: crypto.randomUUID(), ...level, sort_order: i })),
        created_by: session.userId,
        created_by_name: session.fullName,
      })
      .select("id")
      .single();
    throwIf(error, "Could not create the scoring method.");
    return String((data as { id: string }).id);
  }

  /** The published staff shift this note belongs to, or null when the house has no schedule. */
  private async linkedHrShiftId(input: {
    agencyId: string;
    individualId: string;
    staffUserId: string;
    noteDate: string;
    beginTime: string;
    endTime: string;
    shift: string;
  }): Promise<string | null> {
    const { data: person } = await this.client
      .from("individuals")
      .select("site_id")
      .eq("id", input.individualId)
      .eq("agency_id", input.agencyId)
      .maybeSingle();
    const siteId = person?.site_id ? String(person.site_id) : "";
    if (!siteId) return null;
    const clock = dueItemClock();
    const dayStart = new Date(zonedWallTimeMs(input.noteDate, 0, clock.timeZone)).toISOString();
    const dayEnd = new Date(zonedWallTimeMs(input.noteDate, 36 * 60, clock.timeZone)).toISOString();
    const { data: shiftRows } = await this.client
      .from("hr_shifts")
      .select("id, staff_id, starts_at, ends_at")
      .eq("agency_id", input.agencyId)
      .eq("site_id", siteId)
      .eq("staff_id", input.staffUserId)
      .in("status", ["scheduled", "published"])
      .lt("starts_at", dayEnd)
      .gt("ends_at", dayStart);
    if (!shiftRows?.length) return null;
    const blocks = shiftBlocksForSite(await this.siteFacts(siteId));
    const blockId = blockForShiftLabel(input.shift);
    return matchingShiftId({
      shifts: shiftRows.map((row) => ({
        id: String(row.id),
        staffUserId: String(row.staff_id),
        startsAt: String(row.starts_at),
        endsAt: String(row.ends_at),
      })),
      staffUserId: input.staffUserId,
      noteDate: input.noteDate,
      beginTime: input.beginTime,
      endTime: input.endTime,
      block: blockId ? blocks[blockId] : null,
    });
  }

  async saveShiftNote(input: Parameters<ComplyraApi["saveShiftNote"]>[0]) {
    const session = await this.requireSession();
    if (!canEnterShiftNotes(session.roleKey)) {
      throw new Error("Your role cannot enter shift notes.");
    }
    const { data: programRow, error: programError } = await this.client
      .from("isp_programs")
      .select("*")
      .eq("id", input.programId)
      .eq("agency_id", session.agencyId)
      .eq("individual_id", input.individualId)
      .single();
    throwIf(programError, "ISP program not found.");
    const program = this.mapIspProgram(programRow as Record<string, unknown>);
    if (!ispProgramVisibleToStaff(program)) {
      throw new Error("Notes can only be entered against an approved ISP program.");
    }
    const shift = input.shift.trim().slice(0, 80);
    if (!shift) throw new Error("Choose the shift for this note.");
    const beginTime = input.beginTime?.trim().slice(0, 5) ?? "";
    const endTime = input.endTime?.trim().slice(0, 5) ?? "";
    if ((beginTime && !endTime) || (!beginTime && endTime)) {
      throw new Error("Use a begin time and an end time.");
    }
    const clockDuration = beginTime && endTime ? shiftDurationMinutes(beginTime, endTime) : null;
    if (beginTime && endTime && clockDuration === null) {
      throw new Error("Use a clock time for the begin and end.");
    }
    const location = input.location?.trim().slice(0, 160) ?? "";
    const staffTitle = displayStaffTitle(input.staffTitle || session.jobTitle, session.roleKey);
    const waiverService = input.waiverService?.trim().slice(0, 80) ?? "";
    let signatureDataUrl = input.signatureDataUrl?.trim() ?? "";
    if (!input.noteId && !signatureDataUrl) {
      const adopted = await this.getMySignature();
      if (adopted) {
        try {
          signatureDataUrl = await this.getSignatureImageUrl(adopted.signaturePath);
        } catch {
          signatureDataUrl = "";
        }
      }
    }
    if (!input.noteId) {
      if (signatureDataUrl) assertAdoptableSignature("Signature", signatureDataUrl);
      const problem = progressNoteProblem({
        goalService: program.goalService ?? "",
        beginTime,
        endTime,
        waiverService,
        summary: input.summary,
        staffTitle,
        signatureDataUrl,
      });
      if (problem) throw new Error(problem);
    }
    const { data: taskRows, error: taskError } = await this.client
      .from("isp_program_tasks")
      .select("id")
      .eq("program_id", program.id);
    throwIf(taskError, "Could not load ISP tasks.");
    const taskIds = new Set((taskRows ?? []).map((row) => String(row.id)));
    const { data: methodRow, error: methodError } = await this.client
      .from("isp_scoring_methods")
      .select("levels")
      .eq("id", program.scoringMethodId)
      .single();
    throwIf(methodError, "Could not load the scoring method.");
    const levelIds = new Set(
      (Array.isArray(methodRow?.levels) ? methodRow.levels : []).map((level: { id: string }) =>
        String(level.id),
      ),
    );
    const cleanScores = input.scores
      .map((score) => ({
        taskId: score.taskId,
        levelId: score.levelId,
        comment: score.comment.trim().slice(0, 1000),
      }))
      .filter((score) => taskIds.has(score.taskId));
    for (const score of cleanScores) {
      if (!levelIds.has(score.levelId)) {
        throw new Error("Choose a valid score for every scored task.");
      }
    }
    const now = new Date().toISOString();
    const summary = input.summary.trim().slice(0, 4000);
    const timeSpent =
      clockDuration !== null
        ? clockDuration
        : input.timeSpentMinutes === null
          ? null
          : Math.max(0, Math.trunc(input.timeSpentMinutes));
    let noteId = input.noteId ?? "";
    if (noteId) {
      const { data: existing, error: existingError } = await this.client
        .from("shift_notes")
        .select("*")
        .eq("id", noteId)
        .eq("agency_id", session.agencyId)
        .eq("individual_id", input.individualId)
        .eq("program_id", program.id)
        .is("deleted_at", null)
        .single();
      throwIf(existingError, "Shift note not found.");
      const existingUserId = String(
        (existing as Record<string, unknown>).staff_user_id ?? "",
      );
      if (!canEditShiftNoteRow(session.roleKey, session.userId, { staffUserId: existingUserId })) {
        throw new Error("You can only edit your own shift notes.");
      }
      const hrShiftId = await this.linkedHrShiftId({
        agencyId: session.agencyId,
        individualId: input.individualId,
        staffUserId: existingUserId,
        noteDate: input.noteDate,
        beginTime,
        endTime,
        shift,
      });
      const { error } = await this.client
        .from("shift_notes")
        .update({
          note_date: input.noteDate,
          shift,
          hr_shift_id: hrShiftId,
          begin_time: beginTime,
          end_time: endTime,
          location,
          ...(staffTitle ? { staff_title: staffTitle } : {}),
          ...(waiverService ? { waiver_service: waiverService } : {}),
          ...(signatureDataUrl ? { signature_data_url: signatureDataUrl } : {}),
          summary,
          time_spent_minutes: timeSpent,
          updated_at: now,
        })
        .eq("id", noteId);
      throwIf(error, "Could not update the shift note.");
      const { error: scoreDeleteError } = await this.client
        .from("shift_note_task_scores")
        .delete()
        .eq("note_id", noteId);
      throwIf(scoreDeleteError, "Could not replace the note scores.");
    } else {
      const hrShiftId = await this.linkedHrShiftId({
        agencyId: session.agencyId,
        individualId: input.individualId,
        staffUserId: session.userId,
        noteDate: input.noteDate,
        beginTime,
        endTime,
        shift,
      });
      const { data, error } = await this.client
        .from("shift_notes")
        .insert({
          agency_id: session.agencyId,
          individual_id: input.individualId,
          program_id: program.id,
          note_date: input.noteDate,
          shift,
          hr_shift_id: hrShiftId,
          begin_time: beginTime,
          end_time: endTime,
          location,
          staff_title: staffTitle,
          waiver_service: waiverService,
          signature_data_url: signatureDataUrl,
          summary,
          time_spent_minutes: timeSpent,
          staff_user_id: session.userId,
          staff_name: session.fullName,
        })
        .select("id")
        .single();
      throwIf(error, "Could not save the shift note.");
      noteId = String((data as { id: string }).id);
    }
    if (cleanScores.length) {
      const { error } = await this.client.from("shift_note_task_scores").insert(
        cleanScores.map((score) => ({
          note_id: noteId,
          task_id: score.taskId,
          level_id: score.levelId,
          comment: score.comment,
        })),
      );
      throwIf(error, "Could not save the task scores.");
    }
    const block = blockForShiftLabel(shift);
    if (block) {
      // The note is already saved. A missing function, or a database that
      // has not had this migration, must not fail the save.
      await this.client.rpc("resolve_missing_note_notices", {
        p_individual_id: input.individualId,
        p_note_date: input.noteDate,
        p_block: block,
      });
    }
    return noteId;
  }

  async deleteShiftNote(noteId: string) {
    const session = await this.requireSession();
    if (!canEnterShiftNotes(session.roleKey)) {
      throw new Error("Your role cannot enter shift notes.");
    }
    const { data, error } = await this.client
      .from("shift_notes")
      .select("*")
      .eq("id", noteId)
      .eq("agency_id", session.agencyId)
      .is("deleted_at", null)
      .single();
    throwIf(error, "Shift note not found.");
    const noteUserId = String((data as Record<string, unknown>).staff_user_id ?? "");
    if (!canEditShiftNoteRow(session.roleKey, session.userId, { staffUserId: noteUserId })) {
      throw new Error("You can only delete your own shift notes.");
    }
    const now = new Date().toISOString();
    const { error: updateError } = await this.client
      .from("shift_notes")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", noteId);
    throwIf(updateError, "Could not delete the shift note.");
  }

  // ─────────── Menu records (per-Individual food record) ───────────

  private mapMenuEntry(row: Record<string, unknown>): MenuEntryView {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      siteId: String(row.site_id ?? ""),
      individualId: String(row.individual_id),
      entryDate: String(row.entry_date ?? "").slice(0, 10),
      mealSlot: (row.meal_slot as MenuEntryView["mealSlot"]) ?? "snack",
      foodText: String(row.food_text ?? ""),
      amountEaten: (row.amount_eaten as MenuEntryView["amountEaten"]) ?? "all",
      note: String(row.note ?? ""),
      recordedBy: String(row.recorded_by ?? ""),
      recordedByName: String(row.recorded_by_name ?? ""),
      recordedByRole: String(row.recorded_by_role ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      voidedBy: row.voided_by ? String(row.voided_by) : null,
      voidReason: String(row.void_reason ?? ""),
    };
  }

  async getMenuEntries(
    individualId: string,
    from: string,
    to: string,
  ): Promise<MenuEntryView[]> {
    const session = await this.requireSession();
    if (!canSeeMenuEntries(session.roleKey)) {
      throw new Error("Your role cannot view menu records.");
    }
    const { data, error } = await this.client
      .from("menu_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .is("deleted_at", null)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    throwIf(error, "Could not load menu records.");
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.mapMenuEntry(row),
    );
  }

  async saveMenuEntry(input: Parameters<ComplyraApi["saveMenuEntry"]>[0]) {
    const session = await this.requireSession();
    if (!canEnterMenuEntries(session.roleKey)) {
      throw new Error("Your role cannot record menu entries.");
    }
    if (!MEAL_SLOTS.includes(input.mealSlot)) {
      throw new Error("Choose the meal.");
    }
    if (!AMOUNT_EATEN_OPTIONS.includes(input.amountEaten)) {
      throw new Error("Choose how much was eaten.");
    }
    const foodText = input.foodText.trim().slice(0, 500);
    if (!foodText) throw new Error("Record what was eaten.");
    const note = (input.note ?? "").trim().slice(0, 1000);
    const now = new Date().toISOString();
    if (input.entryId) {
      const { data: existing, error: loadError } = await this.client
        .from("menu_entries")
        .select("recorded_by, individual_id")
        .eq("id", input.entryId)
        .eq("agency_id", session.agencyId)
        .is("deleted_at", null)
        .single();
      throwIf(loadError, "Menu entry not found.");
      const row = existing as Record<string, unknown>;
      if (String(row.individual_id) !== input.individualId) {
        throw new Error("Menu entry not found.");
      }
      if (
        !canEditMenuEntryRow(session.roleKey, session.userId, {
          recordedBy: String(row.recorded_by ?? ""),
        })
      ) {
        throw new Error("You can only edit your own menu entries.");
      }
      const { error } = await this.client
        .from("menu_entries")
        .update({
          entry_date: input.entryDate,
          meal_slot: input.mealSlot,
          food_text: foodText,
          amount_eaten: input.amountEaten,
          note,
          updated_at: now,
        })
        .eq("id", input.entryId)
        .eq("agency_id", session.agencyId);
      throwIf(error, "Could not save the menu entry.");
      await this.audit(session, "menu_entry.updated", `${session.fullName} corrected a menu entry`, "menu_entry", input.entryId);
      return input.entryId;
    }
    // The Individual row is RLS-scoped: if the caller cannot read this
    // person, the row simply does not come back.
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .select("id, site_id")
      .eq("id", input.individualId)
      .eq("agency_id", session.agencyId)
      .single();
    throwIf(personError, "Individual not found or outside your assigned access.");
    const { data, error } = await this.client
      .from("menu_entries")
      .insert({
        agency_id: session.agencyId,
        site_id: String((person as Record<string, unknown>).site_id ?? ""),
        individual_id: input.individualId,
        entry_date: input.entryDate,
        meal_slot: input.mealSlot,
        food_text: foodText,
        amount_eaten: input.amountEaten,
        note,
        recorded_by: session.userId,
        recorded_by_name: session.fullName,
        recorded_by_role: session.roleKey,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    throwIf(error, "Could not save the menu entry.");
    const id = String((data as { id: string } | null)?.id ?? "");
    await this.audit(session, "menu_entry.created", `${session.fullName} recorded a menu entry`, "menu_entry", id);
    return id;
  }

  async voidMenuEntry(entryId: string, reason: string) {
    const session = await this.requireSession();
    if (!canEnterMenuEntries(session.roleKey)) {
      throw new Error("Your role cannot record menu entries.");
    }
    const cleanReason = reason.trim().slice(0, 500);
    if (!cleanReason) throw new Error("Give a reason for voiding this entry.");
    const { data, error } = await this.client
      .from("menu_entries")
      .select("recorded_by")
      .eq("id", entryId)
      .eq("agency_id", session.agencyId)
      .is("deleted_at", null)
      .single();
    throwIf(error, "Menu entry not found.");
    const recordedBy = String((data as Record<string, unknown>).recorded_by ?? "");
    if (!canEditMenuEntryRow(session.roleKey, session.userId, { recordedBy })) {
      throw new Error("You can only void your own menu entries.");
    }
    const now = new Date().toISOString();
    const { error: updateError } = await this.client
      .from("menu_entries")
      .update({
        deleted_at: now,
        void_reason: cleanReason,
        updated_at: now,
      })
      .eq("id", entryId)
      .eq("agency_id", session.agencyId);
    throwIf(updateError, "Could not void the menu entry.");
    await this.audit(session, "menu_entry.voided", `${session.fullName} voided a menu entry`, "menu_entry", entryId);
  }

  async getMenuEntryHistory(individualId: string): Promise<MenuEntryHistory> {
    const session = await this.requireSession();
    if (!canSeeMenuEntries(session.roleKey)) {
      throw new Error("Your role cannot view menu records.");
    }
    // Both reads ride the same can_read_individual scope as the entries
    // themselves (menu_entry_history's select policy is identical), so a
    // reader sees exactly the history of the Individuals they can read —
    // auditors included — and nobody else's.
    const { data: versionRows, error } = await this.client
      .from("menu_entry_history")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("replaced_at", { ascending: false });
    throwIf(error, "Could not load menu record history.");
    const { data: voidedRows, error: voidedError } = await this.client
      .from("menu_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    throwIf(voidedError, "Could not load menu record history.");
    const versionsRaw = (versionRows ?? []) as Array<Record<string, unknown>>;
    const voidedRaw = (voidedRows ?? []) as Array<Record<string, unknown>>;
    const names = await this.profileNames([
      ...versionsRaw
        .map((row) => String(row.replaced_by ?? ""))
        .filter(Boolean),
      ...voidedRaw.map((row) => String(row.voided_by ?? "")).filter(Boolean),
    ]);
    return {
      versions: versionsRaw.map((row) => {
        const replacedBy = row.replaced_by ? String(row.replaced_by) : null;
        return {
          id: String(row.id),
          entryId: String(row.entry_id),
          entryDate: String(row.entry_date ?? "").slice(0, 10),
          mealSlot: (row.meal_slot as MenuEntryView["mealSlot"]) ?? "snack",
          foodText: String(row.food_text ?? ""),
          amountEaten:
            (row.amount_eaten as MenuEntryView["amountEaten"]) ?? "all",
          note: String(row.note ?? ""),
          versionSavedAt: String(row.version_saved_at ?? ""),
          replacedBy,
          replacedByName:
            (replacedBy && names.get(replacedBy)) || "Staff member",
          replacedAt: String(row.replaced_at ?? ""),
        };
      }),
      voided: voidedRaw.map((row) => {
        const voidedBy = row.voided_by ? String(row.voided_by) : null;
        return {
          ...this.mapMenuEntry(row),
          voidedByName: (voidedBy && names.get(voidedBy)) || "Staff member",
        };
      }),
    };
  }

  async getSiteShiftNotes(siteId: string): Promise<SiteShiftNoteView[]> {
    const session = await this.requireSession();
    if (!canSeeShiftNotes(session.roleKey)) {
      throw new Error("You do not have access to shift notes.");
    }
    const { data: individualRows, error: individualError } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(individualError, "Could not load shift notes.");
    const individualIds = (individualRows ?? []).map((row) => String(row.id));
    if (individualIds.length === 0) return [];
    const { data: noteRows, error: noteError } = await this.client
      .from("shift_notes")
      .select("*")
      .eq("agency_id", session.agencyId)
      .in("individual_id", individualIds)
      .is("deleted_at", null)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    throwIf(noteError, "Could not load shift notes.");
    const noteIds = (noteRows ?? []).map((row) => String(row.id));
    const programIds = [...new Set((noteRows ?? []).map((row) => String(row.program_id)))];
    const { data: scoreRows, error: scoreError } = noteIds.length
      ? await this.client.from("shift_note_task_scores").select("*").in("note_id", noteIds)
      : { data: [], error: null };
    throwIf(scoreError, "Could not load note scores.");
    const { data: programRows, error: programError } = programIds.length
      ? await this.client.from("isp_programs").select("id, name").in("id", programIds)
      : { data: [], error: null };
    throwIf(programError, "Could not load shift notes.");
    const nameById = new Map(
      (individualRows ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]),
    );
    const programById = new Map(
      (programRows ?? []).map((row) => [String(row.id), String(row.name ?? "ISP program")]),
    );
    const scoresByNote = new Map<string, ShiftNoteView["scores"]>();
    for (const row of scoreRows ?? []) {
      const list = scoresByNote.get(String(row.note_id)) ?? [];
      list.push({
        id: String(row.id),
        noteId: String(row.note_id),
        taskId: String(row.task_id),
        taskTitle: "",
        levelId: String(row.level_id),
        comment: String(row.comment ?? ""),
      });
      scoresByNote.set(String(row.note_id), list);
    }
    return (noteRows ?? []).map((row) => ({
      id: String(row.id),
      agencyId: String(row.agency_id),
      individualId: String(row.individual_id),
      programId: String(row.program_id),
      noteDate: String(row.note_date ?? "").slice(0, 10),
      shift: String(row.shift ?? ""),
      beginTime: String(row.begin_time ?? ""),
      endTime: String(row.end_time ?? ""),
      location: String(row.location ?? ""),
      staffTitle: String(row.staff_title ?? ""),
      waiverService: String(row.waiver_service ?? ""),
      signatureDataUrl: String(row.signature_data_url ?? ""),
      summary: String(row.summary ?? ""),
      timeSpentMinutes: row.time_spent_minutes === null ? null : Number(row.time_spent_minutes),
      staffUserId: String(row.staff_user_id ?? ""),
      staffName: String(row.staff_name ?? ""),
      hrShiftId: row.hr_shift_id ? String(row.hr_shift_id) : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      programName: programById.get(String(row.program_id)) ?? "ISP program",
      scoringMethodName: "",
      scores: scoresByNote.get(String(row.id)) ?? [],
      individualName: nameById.get(String(row.individual_id)) ?? "",
    }));
  }

  async updateObligation(
    obligationId: string,
    patch: Parameters<ComplyraApi["updateObligation"]>[1],
  ) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("obligations")
      .select("*")
      .eq("id", obligationId)
      .single();
    throwIf(error, "Item not found.");
    const item = mapObligation(row!);
    const turningOnDelegation = item.kind === "delegation" && patch.enabled === true;
    const turningOffDelegation = item.kind === "delegation" && patch.enabled === false;
    if (turningOffDelegation) {
      throw new Error("Upload a discontinuation order before turning a delegation off.");
    }
    const canApprove = hasPermission(session, "requirements.approve");
    if (turningOnDelegation) {
      if (!canToggleDelegation(session.roleKey, session.role, canApprove)) {
        throw new Error("Only a PM or nurse can turn a delegation on.");
      }
    } else if (!canEditExtraction(session.roleKey, canApprove)) {
      throw new Error("Only a PM can edit extracted items.");
    }
    const update = obligationPatch(patch);
    if (turningOnDelegation) {
      Object.assign(update, {
        delegating_rn_user_id: null,
        rn_signed_at: null,
        rn_signature_name: null,
        rn_signature_mark: null,
        discontinued_at: null,
        discontinue_file_id: null,
        discontinue_title: null,
      });
    }
    const enabled = patch.enabled ?? item.enabled;
    const mode = patch.mode ?? item.mode;
    if (enabled && mode === "required") {
      update.proposed = false;
    }
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await this.client
        .from("obligations")
        .update(update)
        .eq("id", obligationId);
      throwIf(updateError, "Could not update that item.");
    }
    if (enabled && mode === "required") {
      await this.syncObligationRoster(session, {
        id: item.id,
        agencyId: item.agencyId,
        individualId: item.individualId,
        mode,
        enabled,
        expiresOn: item.expiresOn,
        kind: item.kind,
      });
    }
  }

  async addProtocol(individualId: string, title: string, detail = "") {
    const session = await this.requireSession();
    if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a PM can add a protocol.");
    }
    if (!title.trim()) throw new Error("Name the protocol.");
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) throw new Error("Individual not found.");
    const { data: created, error: insertError } = await this.client
      .from("obligations")
      .insert({
        agency_id: session.agencyId,
        individual_id: person.id,
        kind: "protocol",
        mode: "required",
        title: title.trim(),
        detail: detail.trim() || "Staff acknowledge this protocol.",
        source_page: null,
        document_version_id: null,
        enabled: true,
        frequency: "On protocol update",
        shift_periods: [],
        expires_on: null,
        created_from: "manual",
        inventory_state: "present",
        proposed: false,
      })
      .select("id")
      .single();
    throwIf(insertError, "Could not add that protocol.");
    await this.syncObligationRoster(session, {
      id: created!.id as string,
      agencyId: session.agencyId,
      individualId: person.id,
      mode: "required",
      enabled: true,
      expiresOn: null,
    });
  }

  async promoteToShiftTask(obligationId: string, shiftPeriods: string[]) {
    const session = await this.requireSession();
    if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a PM can add a daily shift requirement.");
    }
    const { data: row, error } = await this.client
      .from("obligations")
      .select("id, agency_id, individual_id, mode, enabled, expires_on")
      .eq("id", obligationId)
      .single();
    throwIf(error, "Item not found.");
    const { error: updateError } = await this.client
      .from("obligations")
      .update({
        kind: "shift_task",
        mode: "required",
        enabled: true,
        proposed: false,
        frequency: "Daily",
        shift_periods: shiftPeriods.map((part) => part.trim()).filter(Boolean),
      })
      .eq("id", obligationId);
    throwIf(updateError, "Could not update that item.");
    await this.syncObligationRoster(session, {
      id: row!.id as string,
      agencyId: row!.agency_id as string,
      individualId: row!.individual_id as string,
      mode: "required",
      enabled: true,
      expiresOn: (row!.expires_on as string | null) ?? null,
    });
  }

  async markObligationOpened(signatureId: string) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("obligation_signatures")
      .select("*")
      .eq("id", signatureId)
      .single();
    throwIf(error, "Signature row not found.");
    if (row!.user_id !== session.userId && !isPrivileged(session.role)) {
      throw new Error("You can only open your assigned documents.");
    }
    if (!row!.opened_at) {
      const { error: updateError } = await this.client
        .from("obligation_signatures")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", signatureId);
      throwIf(updateError, "Could not record that the document was opened.");
    }
  }

  async signObligation(signatureId: string, signatureName: string, signatureMark: string) {
    const session = await this.requireSession();
    this.requirePermission(session, "acknowledgments.sign_own");
    const { data: row, error } = await this.client
      .from("obligation_signatures")
      .select("*")
      .eq("id", signatureId)
      .single();
    throwIf(error, "Signature row not found.");
    if (row!.user_id !== session.userId) throw new Error("Staff must sign their own row.");
    const { data: itemRow } = await this.client
      .from("obligations")
      .select("*")
      .eq("id", row!.obligation_id)
      .maybeSingle();
    const item = itemRow ? mapObligation(itemRow) : null;
    const rules = await this.loadOperatingRules(session.agencyId);
    if (!item || !isObligationActive(item, undefined, { delegationsExpire: rules.delegationsExpire })) {
      throw new Error("This document is not open for signature.");
    }
    if (!staffCanSignDelegation(item)) {
      throw new Error("The delegating RN must sign this form before staff can sign.");
    }
    if (!row!.opened_at) throw new Error("Open and review the document before signing.");
    if (row!.signed_at) throw new Error("Already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    const { error: updateError } = await this.client
      .from("obligation_signatures")
      .update({
        signature_name: signatureName.trim(),
        signature_mark: signatureMark,
        signed_at: new Date().toISOString(),
      })
      .eq("id", signatureId);
    throwIf(updateError, "Could not save the signature.");
    await this.audit(
      session,
      "obligation.signed",
      `${session.fullName} signed ${item.title}`,
      "obligation_signature",
      row!.id as string,
    );
  }

  async submitPlanPacket(individualId: string) {
    const session = await this.requireSession();
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) throw new Error("Individual not found.");
    if (!(await this.planPacketCanSubmit(session, individualId))) {
      throw new Error("Sign every required document before submitting.");
    }
    const { error } = await this.client.from("packet_submissions").insert({
      agency_id: session.agencyId,
      individual_id: individualId,
      user_id: session.userId,
    });
    throwIf(error, "Could not submit the packet.");
    await this.audit(
      session,
      "plan_packet.submitted",
      `${session.fullName} submitted the required-document packet`,
      "individual",
      individualId,
    );
  }

  async signDelegationRn(obligationId: string, signatureName: string, signatureMark: string) {
    const session = await this.requireSession();
    if (!canSignAsDelegatingRn(session.roleKey, session.role)) {
      throw new Error("Only a nurse can sign as the delegating RN.");
    }
    const { data: row, error } = await this.client
      .from("obligations")
      .select("*")
      .eq("id", obligationId)
      .single();
    throwIf(error, "Delegation not found.");
    const item = mapObligation(row!);
    if (item.kind !== "delegation") throw new Error("Delegation not found.");
    if (!item.enabled || item.mode !== "required") {
      throw new Error("Delegation not found.");
    }
    if (item.delegatingRnUserId) {
      throw new Error("This delegation already has an RN signature.");
    }
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your name and add a signature mark.");
    }
    const { error: updateError } = await this.client
      .from("obligations")
      .update({
        delegating_rn_user_id: session.userId,
        rn_signed_at: new Date().toISOString(),
        rn_signature_name: signatureName.trim(),
        rn_signature_mark: signatureMark,
      })
      .eq("id", obligationId);
    throwIf(updateError, "Could not save the RN signature.");
    // Keep the form JSON's delegatingRn in sync so renders/PDFs show the sign date.
    {
      const { item: freshItem, form } = await this.delegationRow(session, obligationId);
      form.delegatingRn.signatureName = signatureName.trim();
      form.delegatingRn.dateSigned = new Date().toISOString().slice(0, 10);
      if (!form.delegatingRn.name.trim()) {
        form.delegatingRn.name = signatureName.trim();
      }
      const { error: formError } = await this.client
        .from("obligations")
        .update({ delegation_form: JSON.parse(JSON.stringify(form)) })
        .eq("id", freshItem.id);
      throwIf(formError, "Could not save the RN signature.");
    }
    await this.audit(
      session,
      "delegation.signed_rn",
      `${session.fullName} signed delegation ${item.title} as the delegating RN`,
      "obligation",
      item.id,
    );
  }

  async uploadRenewalEvidence(input: {
    renewalId: string;
    evidenceKind: ClinicalEvidenceKind;
    documentTitle: string;
    uploadedOn?: string;
    file?: File;
  }) {
    const session = await this.requireSession();
    if (!canUploadRenewal(session.roleKey)) {
      throw new Error("RN, PM, or House Manager can upload renewal evidence.");
    }
    const { data: row, error } = await this.client
      .from("clinical_renewals")
      .select("*")
      .eq("id", input.renewalId)
      .single();
    throwIf(error, "Renewal not found.");
    const renewal = mapClinicalRenewal(row!);
    const title = input.documentTitle.trim() || input.file?.name || "Clinical evidence";
    const uploadedOn = (input.uploadedOn ?? new Date().toISOString()).slice(0, 10);
    let fileId = renewal.fileId;
    if (input.file) {
      this.requirePdfFile(input.file, "Upload a PDF for renewal evidence.");
      fileId = await this.saveChartFile(session, renewal.individualId, "renewal", input.file);
    }
    const next = applyRenewalUpload(renewal, {
      uploadedOn,
      documentTitle: title,
      evidenceKind: input.evidenceKind,
      fileId,
    });
    const { error: updateError } = await this.client
      .from("clinical_renewals")
      .update({
        last_uploaded_on: next.lastUploadedOn,
        next_due_on: next.nextDueOn,
        last_document_title: next.lastDocumentTitle,
        last_evidence_kind: next.lastEvidenceKind,
        file_id: next.fileId,
      })
      .eq("id", renewal.id);
    throwIf(updateError, "Could not save the renewal evidence.");
    await this.audit(
      session,
      "renewal.evidence_uploaded",
      `${session.fullName} uploaded ${title} for ${renewal.title}`,
      "clinical_renewal",
      renewal.id,
    );
  }

  async discontinueDelegation(input: { obligationId: string; title: string; file: File }) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("obligations")
      .select("*")
      .eq("id", input.obligationId)
      .single();
    throwIf(error, "Delegation not found.");
    const item = mapObligation(row!);
    if (item.kind !== "delegation") throw new Error("Delegation not found.");
    if (
      !canToggleDelegation(session.roleKey, session.role, hasPermission(session, "requirements.approve"))
    ) {
      throw new Error("Only a PM or nurse can discontinue a delegation.");
    }
    if (!input.file) throw new Error("Upload the discontinuation order first.");
    this.requirePdfFile(input.file, "Upload the discontinuation order as a PDF.");
    const title = input.title.trim() || input.file.name;
    const fileId = await this.saveChartFile(session, item.individualId, "discontinue", input.file);
    const { error: updateError } = await this.client
      .from("obligations")
      .update({
        enabled: false,
        discontinued_at: new Date().toISOString(),
        discontinue_file_id: fileId,
        discontinue_title: title,
      })
      .eq("id", item.id);
    throwIf(updateError, "Could not discontinue that delegation.");
    await this.audit(
      session,
      "delegation.discontinued",
      `${session.fullName} discontinued ${item.title} · ${title}`,
      "obligation",
      item.id,
    );
  }

  async getChartFile(input: {
    type: "renewal" | "discontinue" | "training" | "version" | "consultation";
    id: string;
  }): Promise<{ blob: Blob; name: string } | null> {
    const session = await this.requireSession();
    const logoDataUrl = await this.hostedLogoDataUrl(session.agencyId);
    if (input.type === "training") {
      const { data: row, error } = await this.client
        .from("training_checklists")
        .select("*")
        .eq("id", input.id)
        .maybeSingle();
      throwIf(error, "Training checklist not found.");
      if (!row) return null;
      const checklist = mapTrainingChecklist(row);
      if (!canSeeRenewals(session.roleKey) && checklist.staffUserId !== session.userId) {
        throw new Error("You can only open your own training sheet.");
      }
      const person = await this.individualRecord(checklist.individualId);
      if (!person || person.agencyId !== session.agencyId) return null;
      const { buildTrainingChecklistPdf, trainingFileName } = await import("../pdf/trainingChecklistPdf");
    const pdf = buildTrainingChecklistPdf({
        agencyName: session.agencyName,
        individualName: person.fullName,
        siteName: await this.siteName(person.siteId),
        checklist,
        logoDataUrl,
        siteLocation: await this.siteLocationParts(person.siteId),
      });
      return { blob: pdf.output("blob"), name: trainingFileName(checklist.staffName, person.fullName) };
    }
    if (input.type === "version") {
      const { data: version, error } = await this.client
        .from("document_versions")
        .select("*")
        .eq("id", input.id)
        .maybeSingle();
      throwIf(error, "Document version not found.");
      if (!version) return null;
      const { data: document } = await this.client
        .from("documents")
        .select("id, individual_id, title")
        .eq("id", version.document_id)
        .maybeSingle();
      if (version.storage_path) {
        const { data: stored, error: downloadError } = await this.client.storage
          .from(BUCKET)
          .download(version.storage_path as string);
        if (!downloadError && stored && stored.size > 0) {
          return {
            blob: stored,
            name: `${(document?.title as string) ?? "care-plan"}-${version.version_label as string}.pdf`,
          };
        }
      }
      const person = document
        ? await this.individualRecord(document.individual_id as string)
        : null;
      const { buildCarePlanPdf } = await import("../pdf/carePlanPdf");
    const pdf = buildCarePlanPdf({
        agencyName: session.agencyName,
        individualName: person?.fullName ?? "Individual",
        title: (document?.title as string) ?? "Care plan",
        versionLabel: version.version_label as string,
        effectiveOn: String(version.effective_on).slice(0, 10),
        logoDataUrl,
      });
      return {
        blob: pdf.output("blob"),
        name: `complyrer-care-plan-${(person?.fullName ?? "individual").toLowerCase().replaceAll(" ", "-")}.pdf`,
      };
    }
    const { data: fileRow, error: fileError } = await this.client
      .from("chart_files")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    throwIf(fileError, "Chart file not found.");
    if (!fileRow) return null;
    const file = mapChartFile(fileRow);
    if (input.type === "consultation" && !canSeeAppointments(session.roleKey)) {
      throw new Error("You cannot view Health records.");
    }
    const { data: blob, error: downloadError } = await this.client.storage
      .from(CHART_BUCKET)
      .download(file.storagePath);
    throwIf(downloadError, "Could not open that chart file.");
    if (!blob) return null;
    return { blob, name: file.name };
  }
  // ---- Medications ----

  async recordMedDelivery(input: {
    medicationId: string;
    remainingPills: number;
    pillsPerDay: number;
    countedOn?: string;
  }) {
    const session = await this.requireSession();
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or PM records a medication delivery.");
    }
    const { data: row, error } = await this.client
      .from("medications")
      .select("*")
      .eq("id", input.medicationId)
      .single();
    throwIf(error, "Medication not found.");
    const med = mapMedication(row!);
    if (med.agencyId !== session.agencyId) throw new Error("Medication not found.");
    if (!Number.isFinite(input.remainingPills) || input.remainingPills < 0) {
      throw new Error("Enter a finite, nonnegative remaining pill count.");
    }
    if (med.kind === "scheduled" && (!Number.isFinite(input.pillsPerDay) || input.pillsPerDay <= 0)) {
      throw new Error("Set pills per day for a scheduled medication.");
    }
    const countedOn = input.countedOn ?? todayIso();
    assertCalendarDate(countedOn, "Use a valid count date.");
    const nextPillsPerDay = med.kind === "prn" ? 0 : input.pillsPerDay;
    const { error: saveError } = await this.client.rpc("record_medication_delivery", {
      p_medication_id: med.id, p_remaining: input.remainingPills,
      p_daily: nextPillsPerDay, p_counted_on: countedOn,
    });
    throwIf(saveError, "Could not record the medication count.");
  }

  async logPrnDose(medicationId: string, pills = 1) {
    const session = await this.requireSession();
    if (!canLogPrnDose(session.roleKey)) {
      throw new Error("You cannot log a PRN dose.");
    }
    const { data: row, error } = await this.client
      .from("medications")
      .select("*")
      .eq("id", medicationId)
      .single();
    throwIf(error, "PRN medication not found.");
    const med = mapMedication(row!);
    if (med.agencyId !== session.agencyId || med.kind !== "prn") {
      throw new Error("PRN medication not found.");
    }
    if (!Number.isFinite(pills) || pills <= 0) throw new Error("Enter how many pills were given.");
    if (pills > med.remainingPills) throw new Error("The dose exceeds the recorded stock. Reconcile the count first.");
    const { error: saveError } = await this.client.rpc("record_prn_dose", {
      p_medication_id: med.id, p_pills: pills,
    });
    throwIf(saveError, "Could not record the PRN dose.");
    const rules = await this.loadOperatingRules(session.agencyId);
    await this.audit(
      session,
      "medication.prn_followup",
      `Effectiveness follow-up for ${med.name} is due in ${rules.prnFollowupMinutes} minutes. Remind the house every ${rules.prnReminderRepeatMinutes} minutes until it is recorded.`,
      "medication",
      med.id,
    );
    const givenAt = new Date().toISOString();
    await this.queueOperatingNotice({
      agencyId: session.agencyId,
      userId: null,
      roleKey: "nurse",
      type: "med.prn_followup",
      title: "PRN follow-up",
      body: `${session.fullName} gave ${med.name}. Effectiveness follow-up is due in ${rules.prnFollowupMinutes} minutes.`,
      deepLink: "/meds",
      entityId: med.id,
      dedupeKey: `med.prn_followup:${med.id}:${givenAt}`,
    });
  }

  async recordPrnFollowup(
    medicationId: string,
    input: { indication: string; result: string },
  ) {
    const session = await this.requireSession();
    if (!canLogPrnDose(session.roleKey)) throw new Error("You cannot log a PRN dose.");
    const { data: row, error } = await this.client.from("medications").select("*").eq("id", medicationId).single();
    throwIf(error, "PRN medication not found.");
    const med = mapMedication(row!);
    if (med.agencyId !== session.agencyId || med.kind !== "prn") throw new Error("PRN medication not found.");
    const indication = input.indication.trim();
    const result = input.result.trim();
    if (!indication) throw new Error("Say why the PRN was given.");
    if (!result) throw new Error("Record what you saw at follow-up.");
    await this.audit(
      session,
      "medication.prn_effectiveness",
      `Indication: ${indication.slice(0, 240)}. Result: ${result.slice(0, 240)}.`,
      "medication",
      med.id,
    );
  }

  async noteLateClockIn(input: {
    staffId: string;
    scheduledStart: string;
    punchedAt: string;
    sourceKey: string;
  }) {
    const session = await this.requireSession();
    if (input.staffId !== session.userId && !hasPermission(session, "hub.view_team")) {
      throw new Error("You cannot record a clock-in point for someone else.");
    }
    const rules = await this.loadOperatingRules(session.agencyId);
    if (!clockInIsLate(input.scheduledStart, input.punchedAt, rules.lateClockInMinutes)) return;
    const sourceKey = input.sourceKey.trim();
    if (!sourceKey) throw new Error("A clock-in point needs a source.");
    await this.audit(
      session,
      "accountability.point",
      `Late clock-in costs ${rules.pointsPerLateItem} point. source=${sourceKey}`,
      "profile",
      input.staffId,
    );
    await this.queueOperatingNotice({
      agencyId: session.agencyId,
      userId: input.staffId,
      roleKey: null,
      type: "accountability.warning",
      title: "Late clock-in",
      body: `Clocking in more than ${rules.lateClockInMinutes} minutes late costs ${rules.pointsPerLateItem} point.`,
      deepLink: "/hub",
      entityId: sourceKey,
      dedupeKey: sourceKey,
    });
  }

  async awardRecognitionPoints(input: {
    recipientId: string;
    points: number;
    reason: string;
  }): Promise<{ usedThisMonth: number; cap: number }> {
    const session = await this.requireSession();
    if (
      !hasPermission(session, "recognition.manage") &&
      !hasPermission(session, "recognition.review_dsp")
    ) {
      throw new Error("You cannot award recognition points.");
    }
    if (input.recipientId === session.userId) throw new Error("You cannot award points to yourself.");
    const reason = input.reason.trim();
    if (!reason) throw new Error("Say why you are awarding the points.");
    const points = Math.trunc(input.points);
    const rules = await this.loadOperatingRules(session.agencyId);
    const month = new Date().toISOString().slice(0, 7);
    const { data, error } = await this.client
      .from("audit_events")
      .select("detail, created_at")
      .eq("agency_id", session.agencyId)
      .eq("actor_id", session.userId)
      .eq("action", "recognition.award");
    throwIf(error, "Could not check this month's recognition points.");
    const used = ((data ?? []) as Array<{ detail?: string; created_at?: string }>)
      .filter((row) => String(row.created_at ?? "").startsWith(month))
      .reduce((sum, row) => {
        const match = /^points=(\d+)/.exec(String(row.detail ?? ""));
        return sum + (match ? Number(match[1]) : 0);
      }, 0);
    const problem = recognitionAwardProblem(used, points, rules.recognitionMonthlyCap);
    if (problem) throw new Error(problem);
    await this.audit(
      session,
      "recognition.award",
      `points=${points};recipient=${input.recipientId};reason=${reason.slice(0, 240)}`,
      "profile",
      input.recipientId,
    );
    await this.queueOperatingNotice({
      agencyId: session.agencyId,
      userId: input.recipientId,
      roleKey: null,
      type: "recognition.awarded",
      title: "Recognition points",
      body: `${session.fullName} awarded you ${points} point${points === 1 ? "" : "s"}. ${reason.slice(0, 240)}`,
      deepLink: "/recognition",
      entityId: input.recipientId,
      dedupeKey: `recognition.award:${crypto.randomUUID()}`,
    });
    return { usedThisMonth: used + points, cap: rules.recognitionMonthlyCap };
  }

  // ---- Training ----

  async signTrainingChecklist(
    checklistId: string,
    role: "staff" | "hm",
    signatureName: string,
    // LIFEPATH-P2: optional signature mark (SignaturePad pattern); omitted = legacy behavior.
    opts?: { signatureMark?: string },
  ) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("training_checklists")
      .select("*")
      .eq("id", checklistId)
      .single();
    throwIf(error, "Training checklist not found.");
    const checklist = mapTrainingChecklist(row!);
    if (!signatureName.trim()) throw new Error("Type your name to sign.");
    const now = new Date().toISOString();
    if (role === "staff") {
      if (checklist.staffUserId !== session.userId) {
        throw new Error("Staff must sign their own training sheet.");
      }
      if (checklist.staffSignedAt) throw new Error("This sheet is already signed by staff.");
      if (!allLinesInitialed(checklist)) {
        throw new Error("Check off every training item before you sign.");
      }
      const { error: updateError } = await this.client
        .from("training_checklists")
        .update({
          staff_signed_at: now,
          staff_signature_name: signatureName.trim(),
          // LIFEPATH-P2: signature mark column added by the P2 migration.
          staff_signature_mark: opts?.signatureMark ?? null,
        })
        .eq("id", checklistId);
      throwIf(updateError, "Could not save the signature.");
    } else {
      if (!canSignTrainingAsHm(session.roleKey)) {
        throw new Error("Only a house manager can counter-sign training.");
      }
      if (!checklist.staffSignedAt) {
        throw new Error("Staff must sign this sheet before the house manager.");
      }
      if (checklist.hmSignedAt) throw new Error("House manager already signed.");
      const { error: updateError } = await this.client
        .from("training_checklists")
        .update({
          hm_signed_at: now,
          hm_signature_name: signatureName.trim(),
          // LIFEPATH-P2: signature mark column added by the P2 migration.
          hm_signature_mark: opts?.signatureMark ?? null,
        })
        .eq("id", checklistId);
      throwIf(updateError, "Could not save the signature.");
    }
    await this.audit(
      session,
      "training.signed",
      `${session.fullName} signed training for ${checklist.staffName}`,
      "training_checklist",
      checklist.id,
    );
  }

  async initialTrainingLine(
    checklistId: string,
    lineId: string,
    // LIFEPATH-P2: optional full sign-off detail; omitted = legacy title+date behavior.
    signoff?: LegacyLineSignoffInput,
  ) {
    const session = await this.requireSession();
    const { data: row, error } = await this.client
      .from("training_checklists")
      .select("*")
      .eq("id", checklistId)
      .single();
    throwIf(error, "Training checklist not found.");
    const checklist = mapTrainingChecklist(row!);
    if (checklist.staffUserId !== session.userId) {
      throw new Error("Staff must check off their own training items.");
    }
    if (checklist.staffSignedAt) throw new Error("This sheet is already signed.");
    const line = checklist.items.find((item) => item.id === lineId);
    if (!line) throw new Error("Training item not found.");
    if (line.initialedAt) return;
    await this.assertDocumentUnlocked(
      session,
      "training_checklist",
      legacyTrainingDocId(checklistId),
    );
    const items = checklist.items.map((item) =>
      item.id === lineId
        ? {
            ...item,
            initialedAt: new Date().toISOString(),
            // LIFEPATH-P2: extended sign-off detail kept inside the line JSON.
            ...(signoff && (signoff.initials || signoff.trainerName) ? { signoffDetail: signoff } : {}),
          }
        : item,
    );
    const { error: updateError } = await this.client
      .from("training_checklists")
      .update({ items })
      .eq("id", checklistId);
    throwIf(updateError, "Could not check off that item.");
  }

  // ---- Monthly checks ----

  async updateMonthlyDueSettings(input: { equipmentDay: number; drillDay: number; safetyDay: number }) {
    const session = await this.requireSession();
    if (!canConfigureMonthlyDue(session.roleKey)) {
      throw new Error("Only a PM or administrator can set monthly due dates.");
    }
    const due = normalizeMonthlyDue(input);
    const { error } = await this.client.from("agency_monthly_due").upsert(
      {
        agency_id: session.agencyId,
        equipment_day: due.equipmentDay,
        drill_day: due.drillDay,
        safety_day: due.safetyDay,
      },
      { onConflict: "agency_id" },
    );
    throwIf(error, "Could not save the monthly due dates.");
    await this.audit(
      session,
      "monthly_due.updated",
      `Monthly checks due by day ${due.equipmentDay}/${due.drillDay}/${due.safetyDay}`,
      "agency",
      session.agencyId,
    );
  }

  async addAdaptiveEquipment(individualId: string, name: string) {
    const session = await this.requireSession();
    if (!canManageEquipment(session.roleKey)) {
      throw new Error("Only a PM or house manager can add adaptive equipment.");
    }
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) throw new Error("Individual not found.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Name the adaptive equipment.");
    const { data: existing } = await this.client
      .from("adaptive_equipment")
      .select("id, name")
      .eq("individual_id", individualId)
      .eq("active", true);
    if (
      (existing ?? []).some(
        (row) => String(row.name).toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      throw new Error("That equipment is already on this chart.");
    }
    const { data: created, error } = await this.client
      .from("adaptive_equipment")
      .insert({
        agency_id: session.agencyId,
        individual_id: individualId,
        name: trimmed,
        source: "manual",
        active: true,
      })
      .select("id")
      .single();
    throwIf(error, "Could not add that equipment.");
    const equipmentId = created!.id as string;
    await this.client.from("equipment_month_logs").upsert(
      {
        agency_id: session.agencyId,
        equipment_id: equipmentId,
        month_key: monthKeyFrom(todayIso()),
        checked_on: null,
        initials: null,
        checked_by_user_id: null,
        comments: "",
      },
      { onConflict: "equipment_id,month_key", ignoreDuplicates: true },
    );
    await this.audit(
      session,
      "equipment.added",
      `${trimmed} added for ${person.fullName}`,
      "adaptive_equipment",
      equipmentId,
    );
  }

  async removeAdaptiveEquipment(equipmentId: string) {
    const session = await this.requireSession();
    if (!canManageEquipment(session.roleKey)) {
      throw new Error("Only a PM or house manager can remove adaptive equipment.");
    }
    const { data: row, error } = await this.client
      .from("adaptive_equipment")
      .select("id, agency_id, name")
      .eq("id", equipmentId)
      .single();
    throwIf(error, "Equipment not found.");
    if (row!.agency_id !== session.agencyId) throw new Error("Equipment not found.");
    const { error: updateError } = await this.client
      .from("adaptive_equipment")
      .update({ active: false })
      .eq("id", equipmentId);
    throwIf(updateError, "Could not remove that equipment.");
    await this.audit(
      session,
      "equipment.removed",
      `${row!.name as string} removed`,
      "adaptive_equipment",
      equipmentId,
    );
  }

  async checkEquipmentLog(input: {
    equipmentId: string;
    monthKey: string;
    checkedOn: string;
    initials: string;
    comments?: string;
  }) {
    const session = await this.requireSession();
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("You cannot complete monthly equipment checks.");
    }
    const { data: itemRow, error: itemError } = await this.client
      .from("adaptive_equipment")
      .select("*")
      .eq("id", input.equipmentId)
      .single();
    throwIf(itemError, "Equipment not found.");
    const item = mapAdaptiveEquipment(itemRow!);
    if (!item.active || item.agencyId !== session.agencyId) throw new Error("Equipment not found.");
    const initials = input.initials.trim();
    if (!input.checkedOn || !initials) {
      throw new Error("Enter the date checked and your initials.");
    }
    const { error } = await this.client.from("equipment_month_logs").upsert(
      {
        agency_id: session.agencyId,
        equipment_id: item.id,
        month_key: input.monthKey,
        checked_on: input.checkedOn,
        initials,
        checked_by_user_id: session.userId,
        comments: input.comments?.trim() ?? "",
      },
      { onConflict: "equipment_id,month_key" },
    );
    throwIf(error, "Could not save that equipment check.");
    const person = await this.individualRecord(item.individualId);
    await this.audit(
      session,
      "equipment.checked",
      `${item.name} checked for ${person?.fullName ?? "individual"} · ${input.monthKey}`,
      "equipment_log",
      item.id,
    );
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
    const session = await this.requireSession();
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("You cannot record emergency drills.");
    }
    const { data: drillRow, error } = await this.client
      .from("emergency_drills")
      .select("*")
      .eq("id", input.id)
      .single();
    throwIf(error, "Drill not found.");
    const drill = mapEmergencyDrill(drillRow!);
    if (drill.agencyId !== session.agencyId) throw new Error("Drill not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== drill.siteId) {
      throw new Error("House managers record drills at their own site.");
    }
    if (!input.date || !input.time || !input.leaderName.trim() || !input.participants.trim()) {
      throw new Error("Enter the date, time, drill leader, and participants.");
    }
    const { data: clash } = await this.client
      .from("emergency_drills")
      .select("id, drill_type, date")
      .eq("site_id", drill.siteId)
      .eq("date", input.date)
      .neq("id", input.id)
      .limit(1)
      .maybeSingle();
    if (clash) {
      throw new Error(
        drillDateConflictMessage({
          drillType: clash.drill_type as DrillType,
          date: clash.date as string | null,
        }),
      );
    }
    const { error: updateError } = await this.client
      .from("emergency_drills")
      .update({
        date: input.date,
        time: input.time,
        evac_time: input.evacTime?.trim() || null,
        leader_name: input.leaderName.trim(),
        participants: input.participants.trim(),
        awake_or_sleep: input.awakeOrSleep ?? "",
      })
      .eq("id", input.id);
    throwIf(updateError, "Could not save that drill.");
    const site = await this.siteRecord(drill.siteId);
    await this.audit(
      session,
      "drill.recorded",
      `${drill.drillType} drill recorded at ${site?.name ?? "site"} · ${drill.monthKey}`,
      "emergency_drill",
      drill.id,
    );
  }

  async recordHomeSafety(input: { id: string; lines: SafetyLine[] }) {
    const session = await this.requireSession();
    if (!canCompleteMonthly(session.roleKey)) {
      throw new Error("Only a PM, nurse, or house manager can record safety checks.");
    }
    const { data: report, error } = await this.client
      .from("home_safety_reports")
      .select("id, agency_id, site_id, month_key")
      .eq("id", input.id)
      .single();
    throwIf(error, "Safety report not found.");
    if (report!.agency_id !== session.agencyId) throw new Error("Safety report not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== report!.site_id) {
      throw new Error("House managers record safety at their own site.");
    }
    const { error: updateError } = await this.client
      .from("home_safety_reports")
      .update({ lines: input.lines })
      .eq("id", input.id);
    throwIf(updateError, "Could not save that safety check.");
    const site = await this.siteRecord(report!.site_id as string);
    await this.audit(
      session,
      "safety.recorded",
      `Home safety report updated for ${site?.name ?? "site"} · ${report!.month_key as string}`,
      "home_safety",
      input.id,
    );
  }

  async downloadMonthlyCheck(input: {
    kind: "equipment" | "drills" | "safety";
    id: string;
    monthKey: string;
  }): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const logoDataUrl = await this.hostedLogoDataUrl(session.agencyId);
    if (input.kind === "equipment") {
      const person = await this.individualRecord(input.id);
      if (!person || person.agencyId !== session.agencyId) throw new Error("Individual not found.");
      const { data: equipmentRows } = await this.client
        .from("adaptive_equipment")
        .select("*")
        .eq("individual_id", person.id);
      const { data: logRows } = await this.client
        .from("equipment_month_logs")
        .select("*")
        .eq("month_key", input.monthKey);
      const collections = {
        adaptiveEquipment: (equipmentRows ?? []).map(mapAdaptiveEquipment),
        equipmentMonthLogs: (logRows ?? []).map(mapEquipmentMonthLog),
        emergencyDrills: [],
        homeSafetyReports: [],
      };
      const view = equipmentViewForPerson(collections, person.id, input.monthKey, todayIso());
      if (!view.items.length) throw new Error("This person has no adaptive equipment on file.");
      if (!view.complete) {
        throw new Error("Check every piece of equipment before downloading this month.");
      }
      const profile = await this.individualProfile(person);
      const pdf = buildEquipmentMonthPdf({
        agencyName: session.agencyName,
        individualName: person.fullName,
        dmhId: profile.dmhId,
        monthKey: input.monthKey,
        items: view.items,
        logoDataUrl,
      });
      return { blob: pdf.output("blob"), name: equipmentFileName(person.fullName, input.monthKey) };
    }
    const site = await this.siteRecord(input.id);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    if (input.kind === "drills") {
      const { data: drillRows } = await this.client
        .from("emergency_drills")
        .select("*")
        .eq("site_id", site.id)
        .eq("month_key", input.monthKey);
      const drills = (drillRows ?? [])
        .map(mapEmergencyDrill)
        .sort((a, b) => a.drillType.localeCompare(b.drillType));
      if (!drills.length || !drills.every(drillComplete)) {
        throw new Error("Finish every required drill before downloading this month.");
      }
      const pdf = buildDrillsMonthPdf({
        agencyName: session.agencyName,
        siteName: site.name,
        monthKey: input.monthKey,
        drills,
        logoDataUrl,
        siteLocation: await this.siteLocationParts(site.id),
      });
      return { blob: pdf.output("blob"), name: drillsFileName(site.name, input.monthKey) };
    }
    const { data: reportRow } = await this.client
      .from("home_safety_reports")
      .select("*")
      .eq("site_id", site.id)
      .eq("month_key", input.monthKey)
      .maybeSingle();
    const report = reportRow ? mapHomeSafetyReport(reportRow) : undefined;
    if (!report || !safetyComplete(report)) {
      throw new Error("Finish every safety line before downloading this month.");
    }
    const pdf = buildSafetyMonthPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      monthKey: input.monthKey,
      report,
      logoDataUrl,
      siteLocation: await this.siteLocationParts(site.id),
    });
    return { blob: pdf.output("blob"), name: safetyFileName(site.name, input.monthKey) };
  }

  // Issue #94: printable/downloads for the rebuilt Checklists tab. No new
  // records are written — these only render existing data.
  async downloadDrillSchedule(input: {
    siteId: string;
    year: number;
    /** When set, the export is scoped to this 1-12 month. */
    month?: number | null;
  }): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    const { data: drillRows, error } = await this.client
      .from("emergency_drills")
      .select("*")
      .eq("site_id", site.id);
    throwIf(error, "Could not load drills.");
    const records = (drillRows ?? []).map(mapEmergencyDrill);
    const allMonths = drillScheduleYearSummary(input.year, records);
    const months = input.month
      ? allMonths.filter((m) => m.month.month === input.month)
      : allMonths;
    const scopeLabel = drillExportScopeLabel(input.year, input.month ?? "all");
    const pdf = buildDrillSchedulePdf({
      agencyName: session.agencyName,
      siteName: site.name,
      year: input.year,
      months,
      scopeLabel,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      siteLocation: await this.siteLocationParts(site.id),
    });
    return {
      blob: pdf.output("blob"),
      name: drillScheduleFileName(site.name, input.year, input.month ?? null),
    };
  }

  private async checklistsForDownload(
    session: SessionUser,
    siteId: string,
    monthKey: string | null,
  ): Promise<HmWeeklyChecklist[]> {
    let query = this.client
      .from("hm_weekly_checklists")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    if (!this.checklistCanOversee(session)) {
      query = query.eq("assigned_to_user_id", session.userId);
    }
    query = query.order("week_of", { ascending: false });
    const { data, error } = await query;
    throwIf(error, "Could not load checklists.");
    return (data ?? [])
      .map((r) => this.mapChecklistRow(r as Record<string, unknown>))
      .filter((c) => !monthKey || c.weekOf.slice(0, 7) === monthKey);
  }

  async downloadHmChecklists(input: {
    siteId: string;
    monthKey: string | null;
  }): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    const checklists = await this.checklistsForDownload(session, site.id, input.monthKey);
    const scopeLabel = input.monthKey ? monthLabel(input.monthKey) : "All months";
    const pdf = buildHmChecklistsPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      scopeLabel,
      checklists,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      siteLocation: await this.siteLocationParts(site.id),
    });
    return { blob: pdf.output("blob"), name: hmChecklistsFileName(site.name, scopeLabel) };
  }

  async downloadServiceLogs(input: {
    siteId: string;
    monthKey: string | null;
  }): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    const checklists = await this.checklistsForDownload(session, site.id, input.monthKey);
    const logs = checklists
      .flatMap((c) => c.serviceLogs.map((log) => ({ ...log, weekOf: c.weekOf })))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const scopeLabel = input.monthKey ? monthLabel(input.monthKey) : "All months";
    const pdf = buildServiceLogsPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      scopeLabel,
      logs,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      siteLocation: await this.siteLocationParts(site.id),
    });
    return { blob: pdf.output("blob"), name: serviceLogsFileName(site.name, scopeLabel) };
  }
  // ---- Site reviews / branding ----

  async saveSiteFacts(siteId: string, facts: Partial<SiteFacts>) {
    const session = await this.requireSession();
    if (!canEditSiteReview(session.roleKey)) {
      throw new Error("Only a PM, house manager, or administrator can update site-review facts.");
    }
    const site = await this.siteRecord(siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can update their own site.");
    }
    const current = await this.siteFacts(site.id);
    const merged = normalizeSiteFacts({ ...current, ...facts });
    const { error } = await this.client.from("site_facts").upsert(
      { site_id: site.id, agency_id: session.agencyId, facts: merged },
      { onConflict: "site_id" },
    );
    throwIf(error, "Could not save the site facts.");
    await this.audit(session, "site.facts_updated", `Site facts updated for ${site.name}`, "site", site.id);
  }

  async saveSiteReview(input: Parameters<ComplyraApi["saveSiteReview"]>[0]) {
    const session = await this.requireSession();
    if (!canEditSiteReview(session.roleKey)) {
      throw new Error("Only a PM, house manager, or administrator can mark site-review checks.");
    }
    const { data: reviewRow, error } = await this.client
      .from("site_reviews")
      .select("*")
      .eq("id", input.id)
      .single();
    throwIf(error, "Site review not found.");
    if (reviewRow!.agency_id !== session.agencyId) throw new Error("Site review not found.");
    const site = await this.siteRecord(reviewRow!.site_id as string);
    if (!site) throw new Error("Site not found.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can update their own site.");
    }
    const review = mapSiteReview(reviewRow!);
    const normalized = normalizeSiteReview({
      ...review,
      lines: input.lines.map((line) => ({ id: line.id, status: line.status, comment: line.comment })),
    });
    const { error: updateError } = await this.client
      .from("site_reviews")
      .update({
        reviewer_name: input.reviewerName.trim(),
        support_coordinator: input.supportCoordinator.trim(),
        reviewed_on: input.reviewedOn || null,
        provider_owned_controlled: input.providerOwnedControlled,
        heightened_scrutiny: input.heightenedScrutiny,
        meets_individual_needs: input.meetsIndividualNeeds,
        part2_verified: input.part2Verified,
        lines: normalized.lines,
      })
      .eq("id", review.id);
    throwIf(updateError, "Could not save the site review.");
    await this.audit(session, "site_review.saved", `Site review saved for ${site.name}`, "site_review", review.id);
  }

  async downloadSiteReviewPdf(siteId: string): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const site = await this.siteRecord(siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    const { data: reviewRow } = await this.client
      .from("site_reviews")
      .select("*")
      .eq("site_id", site.id)
      .maybeSingle();
    if (!reviewRow) throw new Error("Site review not found.");
    const facts = await this.siteFacts(site.id);
    const { data: personRows } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("site_id", site.id);
    const { data: safetyRow } = await this.client
      .from("home_safety_reports")
      .select("*")
      .eq("site_id", site.id)
      .eq("month_key", monthKeyFrom(todayIso()))
      .maybeSingle();
    const safety = safetyRow ? mapHomeSafetyReport(safetyRow) : undefined;
    const pdf = buildSiteReviewPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      address: site.address,
      facts,
      residents: (personRows ?? []).map((row) => String(row.full_name)),
      review: normalizeSiteReview(applyWellWaterDefault(mapSiteReview(reviewRow), facts)),
      monthlySafetyOnFile: monthlySafetyOnFile(safety),
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      stateCode: await this.agencyState(session.agencyId),
    });
    return { blob: pdf.output("blob"), name: siteReviewFileName(site.name) };
  }

  async downloadPreSurveyPdf(siteId: string): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const site = await this.siteRecord(siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Site not found.");
    const facts = await this.siteFacts(site.id);
    const today = todayIso();
    const { data: personRows } = await this.client
      .from("individuals")
      .select("*")
      .eq("site_id", site.id);
    const { data: equipmentRows } = await this.client
      .from("adaptive_equipment")
      .select("*")
      .eq("active", true);
    const { data: obligationRows } = await this.client.from("obligations").select("*");
    const { data: profileRows } = await this.client
      .from("individual_profiles")
      .select("individual_id, profile");
    const rows = (personRows ?? []).map((row) => {
      const person = mapIndividual(row);
      const profileRow = (profileRows ?? []).find((entry) => entry.individual_id === person.id);
      const profile = normalizeProfile(person, profileFromRow(person, profileRow ?? null));
      return buildPreSurveyRow({
        person: { fullName: person.fullName, dateOfBirth: person.dateOfBirth },
        profile,
        today,
        equipment: (equipmentRows ?? [])
          .filter((entry) => entry.individual_id === person.id)
          .map(mapAdaptiveEquipment),
        obligations: (obligationRows ?? [])
          .filter((entry) => entry.individual_id === person.id)
          .map(mapObligation),
      });
    });
    const pdf = buildPreSurveyPdf({
      agencyName: session.agencyName,
      siteName: site.name,
      address: site.address,
      facts,
      rows,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      stateCode: await this.agencyState(session.agencyId),
    });
    return { blob: pdf.output("blob"), name: preSurveyFileName(site.name) };
  }

  async uploadAgencyLogo(file: File) {
    const session = await this.requireSession();
    if (!canManageAgencyLogo(session.roleKey)) {
      throw new Error("Only a PM or administrator can change the agency logo.");
    }
    validateLogoFile(file);
    const extension = file.type === "image/jpeg" ? "jpg" : "png";
    const path = `agency/${session.agencyId}/logo.${extension}`;
    const { error: uploadError } = await this.client.storage
      .from(ASSETS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: true });
    throwIf(uploadError, "Could not upload the logo.");
    const { error: brandError } = await this.client.from("agency_branding").upsert(
      { agency_id: session.agencyId, logo_path: path },
      { onConflict: "agency_id" },
    );
    throwIf(brandError, "Logo uploaded, but the agency record could not be updated.");
    await this.audit(
      session,
      "agency.logo_updated",
      `Logo uploaded for ${session.agencyName}`,
      "agency",
      session.agencyId,
    );
  }

  async removeAgencyLogo() {
    const session = await this.requireSession();
    if (!canManageAgencyLogo(session.roleKey)) {
      throw new Error("Only a PM or administrator can change the agency logo.");
    }
    const { data: branding } = await this.client
      .from("agency_branding")
      .select("logo_path")
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    const path = branding?.logo_path as string | null;
    if (path) {
      await this.client.storage.from(ASSETS_BUCKET).remove([path]);
    }
    const { error } = await this.client.from("agency_branding").upsert(
      { agency_id: session.agencyId, logo_path: null },
      { onConflict: "agency_id" },
    );
    throwIf(error, "Could not remove the logo.");
    await this.audit(
      session,
      "agency.logo_removed",
      `Logo removed for ${session.agencyName}`,
      "agency",
      session.agencyId,
    );
  }

  // ---- Site / individual creation ----

  async createSite(input: {
    name: string;
    address: string;
    programName: string;
    managerUserId?: string | null;
  }): Promise<{ id: string }> {
    const session = await this.requireSession();
    this.requirePermission(session, "sites.create");
    const name = input.name.trim();
    const address = input.address.trim();
    const programName = input.programName.trim();
    if (!name || !address || !programName) {
      throw new Error("Name the site, its address, and the program.");
    }
    const { data: existingSites } = await this.client
      .from("sites")
      .select("id, name")
      .eq("agency_id", session.agencyId);
    if ((existingSites ?? []).some((row) => String(row.name).toLowerCase() === name.toLowerCase())) {
      throw new Error("A site with that name already exists.");
    }
    const { data: programs } = await this.client
      .from("programs")
      .select("id, name")
      .eq("agency_id", session.agencyId);
    const programMatch = (programs ?? []).find(
      (row) => String(row.name).toLowerCase() === programName.toLowerCase(),
    );
    let programId: string;
    if (programMatch) {
      programId = programMatch.id as string;
    } else {
      const { data: created, error: programError } = await this.client
        .from("programs")
        .insert({ agency_id: session.agencyId, name: programName })
        .select("id")
        .single();
      throwIf(programError, "Could not create the program.");
      programId = created!.id as string;
    }
    const { data: site, error: siteError } = await this.client
      .from("sites")
      .insert({ agency_id: session.agencyId, program_id: programId, name, address })
      .select("id")
      .single();
    throwIf(siteError, "Could not create the site.");
    const siteId = site!.id as string;
    await this.client.from("site_facts").upsert(
      {
        site_id: siteId,
        agency_id: session.agencyId,
        facts: normalizeSiteFacts({ contactName: session.fullName }),
      },
      { onConflict: "site_id", ignoreDuplicates: true },
    );
    const blank = blankSiteReview({ agencyId: session.agencyId, siteId });
    await this.client.from("site_reviews").upsert(
      {
        id: blank.id,
        agency_id: blank.agencyId,
        site_id: blank.siteId,
        reviewer_name: blank.reviewerName,
        support_coordinator: blank.supportCoordinator,
        reviewed_on: null,
        provider_owned_controlled: null,
        heightened_scrutiny: null,
        meets_individual_needs: null,
        part2_verified: false,
        lines: blank.lines,
      },
      { onConflict: "site_id", ignoreDuplicates: true },
    );
    const monthKey = monthKeyFrom(todayIso());
    await this.client.from("emergency_drills").upsert(
      drillsForMonth(monthKey).map((drillType) => ({
        agency_id: session.agencyId,
        site_id: siteId,
        month_key: monthKey,
        drill_type: drillType,
        date: null,
        time: null,
        evac_time: null,
        leader_name: null,
        participants: "",
        awake_or_sleep: "",
      })),
      { onConflict: "site_id,month_key,drill_type", ignoreDuplicates: true },
    );
    await this.client.from("home_safety_reports").upsert(
      {
        agency_id: session.agencyId,
        site_id: siteId,
        month_key: monthKey,
        lines: blankSafetyLines(),
      },
      { onConflict: "site_id,month_key", ignoreDuplicates: true },
    );
    if (input.managerUserId) {
      await this.client
        .from("memberships")
        .update({ site_id: siteId })
        .eq("agency_id", session.agencyId)
        .eq("user_id", input.managerUserId);
    }
    await this.audit(session, "site.created", `${name} added to ${programName}`, "site", siteId);
    return { id: siteId };
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
    enrolledOn?: string;
  }): Promise<{ id: string; name: string }> {
    const session = await this.requireSession();
    if (!canCreateIndividual(session.roleKey)) {
      throw new Error("Only a PM, nurse, or house manager can add an individual.");
    }
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("Enter the individual’s legal name.");
    assertCalendarDate(input.dateOfBirth, "Enter a valid date of birth.");
    if (input.dateOfBirth > todayIso()) throw new Error("Date of birth cannot be in the future.");
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Choose a program site.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can add individuals to their own site.");
    }
    const { count: rosterCount, error: rosterCountError } = await this.client
      .from("individuals")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", session.agencyId)
      .eq("site_id", site.id);
    throwIf(rosterCountError, "Could not check this site’s Individual limit.");
    assertSiteHasCapacity({
      siteName: site.name,
      agencyCode: session.agencyCode,
      currentCount: rosterCount ?? 0,
    });
    const { data: roster } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId);
    if (
      (roster ?? []).some(
        (row) => String(row.full_name).toLowerCase() === fullName.toLowerCase(),
      )
    ) {
      throw new Error("An Individual with that name is already on the roster.");
    }
    const enrolledOn = input.enrolledOn?.trim() || todayIso();
    assertCalendarDate(enrolledOn, "Enter a valid enrollment date.");
    const { data: person, error: personError } = await this.client
      .from("individuals")
      .insert({
        agency_id: session.agencyId,
        site_id: site.id,
        full_name: fullName,
        date_of_birth: input.dateOfBirth,
      })
      .select("*")
      .single();
    throwIf(personError, "Could not add that individual.");
    const record = mapIndividual(person!);
    const { error: profileError } = await this.client.from("individual_profiles").upsert(
      {
        agency_id: session.agencyId,
        individual_id: record.id,
        profile: {
          ...emptyProfile(record),
          goesBy: input.goesBy?.trim() || fullName.split(" ")[0] || fullName,
          dmhId: input.dmhId?.trim() || "",
          enrolledOn,
        },
      },
      { onConflict: "individual_id" },
    );
    throwIf(profileError, "Individual added, but the cover page could not be created.");
    await this.ensureClinicalRenewals(session, record.id);
    await this.ensureTrainingChecklists(session, record.id);
    await this.audit(session, "individual.created", `${fullName} added at ${site.name}`, "individual", record.id);
    if (input.file) {
      await this.uploadDocument({
        individualId: record.id,
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
    return { id: record.id, name: fullName };
  }

  async reassignIndividualToSite(individualId: string, siteId: string) {
    const session = await this.requireSession();
    if (!canCreateIndividual(session.roleKey)) {
      throw new Error("Only a PM, nurse, or house manager can move an Individual.");
    }
    const { data: personRow, error: personError } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", individualId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(personError, "Individual not found.");
    if (!personRow) throw new Error("Individual not found or outside your assigned access.");
    const person = mapIndividual(personRow);
    const site = await this.siteRecord(siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Choose a program site.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can move individuals to their own site.");
    }
    if (person.siteId === site.id) return;
    const { count: rosterCount, error: rosterCountError } = await this.client
      .from("individuals")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", session.agencyId)
      .eq("site_id", site.id)
      .neq("id", person.id);
    throwIf(rosterCountError, "Could not check this site’s Individual limit.");
    assertSiteHasCapacity({
      siteName: site.name,
      agencyCode: session.agencyCode,
      currentCount: rosterCount ?? 0,
    });
    const { error: moveError } = await this.client
      .from("individuals")
      .update({ site_id: site.id })
      .eq("id", person.id);
    throwIf(moveError, "Could not move this Individual.");
    await this.audit(
      session,
      "individual.reassigned",
      `${person.fullName} moved to ${site.name}`,
      "individual",
      person.id,
    );
  }

  async createAppointment(input: AppointmentDraft & { individualId: string }) {
    const session = await this.requireSession();
    if (!canManageAppointments(session.roleKey)) {
      throw new Error("You cannot create or edit appointments.");
    }
    const person = await this.individualRecord(input.individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const draft = validateAppointmentDraft(input);
    const { data, error } = await this.client
      .from("appointments")
      .insert(this.appointmentRow(session.agencyId, person.id, session, draft))
      .select("id")
      .single();
    throwIf(error, "Could not save that appointment.");
    await this.audit(
      session,
      "appointment.created",
      `${draft.consultant} for ${person.fullName}`,
      "appointment",
      data!.id as string,
    );
    return { id: data!.id as string };
  }

  async updateAppointment(appointmentId: string, patch: AppointmentDraft) {
    const session = await this.requireSession();
    if (!canManageAppointments(session.roleKey)) {
      throw new Error("You cannot create or edit appointments.");
    }
    const existing = await this.appointmentRecord(session.agencyId, appointmentId);
    if (isAppointmentRemoved(existing)) throw new Error("That appointment was already removed.");
    const person = await this.individualRecord(existing.individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const draft = validateAppointmentDraft(patch);
    const { error } = await this.client
      .from("appointments")
      .update({
        starts_on: draft.startsOn,
        start_time: `${draft.startTime}:00`,
        end_time: `${draft.endTime}:00`,
        timezone: draft.timezone,
        consultant: draft.consultant,
        specialty: draft.specialty ?? "",
        reason: draft.reason ?? "",
        visit_address: draft.visitAddress ?? "",
        updated_by: session.userId,
        updated_by_name: session.fullName,
      })
      .eq("id", appointmentId)
      .eq("agency_id", session.agencyId);
    throwIf(error, "Could not update that appointment.");
    await this.audit(
      session,
      "appointment.updated",
      appointmentChangeDetail(existing, draft),
      "appointment",
      appointmentId,
    );
  }

  async deleteAppointment(appointmentId: string) {
    const session = await this.requireSession();
    if (!canManageAppointments(session.roleKey)) {
      throw new Error("You cannot create or edit appointments.");
    }
    const existing = await this.appointmentRecord(session.agencyId, appointmentId);
    if (isAppointmentRemoved(existing)) throw new Error("That appointment was already removed.");
    const { error } = await this.client
      .from("appointments")
      .update({
        deleted_by: session.userId,
        deleted_by_name: session.fullName,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", appointmentId)
      .eq("agency_id", session.agencyId)
      .is("deleted_at", null);
    throwIf(error, "Could not remove that appointment.");
    await this.audit(
      session,
      "appointment.deleted",
      `${existing.consultant} appointment removed`,
      "appointment",
      appointmentId,
    );
  }

  async completeAppointment(input: {
    appointmentId: string;
    file: File;
    comments?: string;
  }) {
    const session = await this.requireSession();
    if (!canCompleteAppointments(session.roleKey)) {
      throw new Error("You cannot complete this appointment.");
    }
    const existing = await this.appointmentRecord(session.agencyId, input.appointmentId);
    if (isAppointmentRemoved(existing)) throw new Error("That appointment was already removed.");
    if (existing.completedAt) throw new Error("That appointment is already completed.");
    const person = await this.individualRecord(existing.individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    assertConsultationUpload(input.file);
    const fileId = await this.saveChartFile(session, person.id, "other", input.file);
    const now = new Date().toISOString();
    const { error } = await this.client
      .from("appointments")
      .update({
        consultation_file_id: fileId,
        visit_comments: input.comments?.trim() ?? "",
        completed_by: session.userId,
        completed_by_name: session.fullName,
        completed_at: now,
        updated_by: session.userId,
        updated_by_name: session.fullName,
      })
      .eq("id", input.appointmentId)
      .eq("agency_id", session.agencyId)
      .is("deleted_at", null)
      .is("completed_at", null);
    throwIf(error, "Could not complete that appointment.");
    await this.audit(
      session,
      "appointment.completed",
      `${existing.consultant} visit completed for ${person.fullName} · ${input.file.name}`,
      "appointment",
      input.appointmentId,
    );
  }

  async updateIndividualAllergies(individualId: string, allergies: Allergy[]) {
    const session = await this.requireSession();
    if (!canEditAllergies(session.roleKey)) {
      throw new Error("You cannot edit allergies.");
    }
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const current = await this.individualProfile(person);
    const nextAllergies = normalizeAllergies(allergies);
    const now = new Date().toISOString();
    const next = {
      ...current,
      allergies: nextAllergies,
      allergiesStamp: nextAllergiesStamp(current.allergiesStamp, session, now),
    };
    const { error } = await this.client.from("individual_profiles").upsert(
      {
        agency_id: session.agencyId,
        individual_id: person.id,
        profile: next,
      },
      { onConflict: "individual_id" },
    );
    throwIf(error, "Could not save allergies.");
    await this.audit(
      session,
      "allergies.updated",
      allergiesChangeDetail(current.allergies, nextAllergies),
      "individual",
      person.id,
    );
  }
  async recordConsultationPacketGenerated(appointmentId: string) {
    const session = await this.requireSession();
    if (!canSeeAppointments(session.roleKey)) {
      throw new Error("You cannot view Health records.");
    }
    const existing = await this.appointmentRecord(session.agencyId, appointmentId);
    if (isAppointmentRemoved(existing) && !canManageAppointments(session.roleKey)) {
      throw new Error("Appointment not found.");
    }
    const person = await this.individualRecord(existing.individualId);
    await this.audit(
      session,
      "consultation_packet.generated",
      `${existing.consultant} packet for ${person?.fullName ?? "Individual"}`,
      "appointment",
      appointmentId,
    );
  }

  private appointmentRow(
    agencyId: string,
    individualId: string,
    actor: { userId: string; fullName: string },
    draft: AppointmentDraft,
  ) {
    return {
      agency_id: agencyId,
      individual_id: individualId,
      starts_on: draft.startsOn,
      start_time: `${draft.startTime}:00`,
      end_time: `${draft.endTime}:00`,
      timezone: draft.timezone,
      consultant: draft.consultant,
      specialty: draft.specialty ?? "",
      reason: draft.reason ?? "",
      visit_address: draft.visitAddress ?? "",
      created_by: actor.userId,
      created_by_name: actor.fullName,
    };
  }

  private async appointmentRecord(agencyId: string, appointmentId: string) {
    const { data, error } = await this.client
      .from("appointments")
      .select("*")
      .eq("agency_id", agencyId)
      .eq("id", appointmentId)
      .maybeSingle();
    throwIf(error, "Could not load that appointment.");
    if (!data) throw new Error("Appointment not found.");
    return mapAppointment(data);
  }

  // ---- Hosted plan-stack helpers ----

  private requirePdfFile(file: File, message: string) {
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") && (!file.type || file.type === "application/pdf");
    if (!isPdf) throw new Error(message);
  }

  private async saveChartFile(
    session: SessionUser,
    individualId: string,
    kind: "renewal" | "discontinue" | "other",
    file: File,
  ): Promise<string> {
    const fileId = crypto.randomUUID();
    const storagePath = `${session.agencyId}/${individualId}/chart/${fileId}/${file.name}`;
    const mime = file.type || (kind === "other" ? "application/octet-stream" : "application/pdf");
    const { error: uploadError } = await this.client.storage
      .from(CHART_BUCKET)
      .upload(storagePath, file, { contentType: mime, upsert: false });
    throwIf(uploadError, "Could not store the file.");
    const { error: insertError } = await this.client.from("chart_files").insert({
      id: fileId,
      agency_id: session.agencyId,
      individual_id: individualId,
      kind,
      name: file.name,
      mime,
      storage_path: storagePath,
    });
    throwIf(insertError, "File stored, but the chart record could not be saved.");
    return fileId;
  }

  private async hostedLogoDataUrl(agencyId: string): Promise<string | null> {
    const { data: branding } = await this.client
      .from("agency_branding")
      .select("logo_path")
      .eq("agency_id", agencyId)
      .maybeSingle();
    const path = branding?.logo_path as string | null;
    if (!path) return null;
    const { data, error } = await this.client.storage.from(ASSETS_BUCKET).download(path);
    if (error || !data || data.size === 0) return null;
    return blobToDataUrl(data);
  }

  /** Roles whose RLS write policies permit clinical-renewal/training setup. */
  private canSetupChartRows(roleKey: string) {
    return [
      "administrator",
      "compliance_admin",
      "house_manager",
      "program_manager",
      "nurse",
      "program_manager",
    ].includes(roleKey);
  }

  /**
   * Idempotent per-load setup mirroring the local store's ensure* helpers:
   * monthly drill/safety cycles per site, equipment log rows for the current
   * month, one site review per site, default clinical renewals, and training
   * checklists for assigned staff. All writes use upserts/inserts guarded by
   * unique constraints, so repeat loads add nothing.
   *
   * Failures are swallowed: a PM/nurse can often SELECT every home but fail
   * WITH CHECK on a bulk upsert. That must not strand sign-in on
   * "Loading workspace…".
   */
  private async ensureHostedCollections(
    session: SessionUser,
    input: { sites: SiteRecord[]; individuals: IndividualRecord[]; equipment: AdaptiveEquipment[] },
  ) {
    try {
      await this.writeHostedCollections(session, input);
    } catch {
      /* best-effort — workspace reads already succeeded */
    }
  }

  private async writeHostedCollections(
    session: SessionUser,
    input: { sites: SiteRecord[]; individuals: IndividualRecord[]; equipment: AdaptiveEquipment[] },
  ) {
    const monthKey = monthKeyFrom(todayIso());
    const writableSites = input.sites.filter((site) => canAccessSite(session, site.id));
    if (canCompleteMonthly(session.roleKey)) {
      const drillsPayload = writableSites.flatMap((site) =>
        drillsForMonth(monthKey).map((drillType) => ({
          agency_id: session.agencyId,
          site_id: site.id,
          month_key: monthKey,
          drill_type: drillType,
          date: null,
          time: null,
          evac_time: null,
          leader_name: null,
          participants: "",
          awake_or_sleep: "",
        })),
      );
      if (drillsPayload.length) {
        const { error } = await this.client
          .from("emergency_drills")
          .upsert(drillsPayload, { onConflict: "site_id,month_key,drill_type", ignoreDuplicates: true });
        if (error) return;
      }
      const safetyPayload = writableSites.map((site) => ({
        agency_id: session.agencyId,
        site_id: site.id,
        month_key: monthKey,
        lines: blankSafetyLines(),
      }));
      if (safetyPayload.length) {
        const { error } = await this.client
          .from("home_safety_reports")
          .upsert(safetyPayload, { onConflict: "site_id,month_key", ignoreDuplicates: true });
        if (error) return;
      }
      const logsPayload = input.equipment
        .filter((item) => item.active)
        .map((item) => ({
          agency_id: session.agencyId,
          equipment_id: item.id,
          month_key: monthKey,
          checked_on: null,
          initials: null,
          checked_by_user_id: null,
          comments: "",
        }));
      if (logsPayload.length) {
        const { error } = await this.client
          .from("equipment_month_logs")
          .upsert(logsPayload, { onConflict: "equipment_id,month_key", ignoreDuplicates: true });
        if (error) return;
      }
    }
    if (canEditSiteReview(session.roleKey)) {
      const reviewsPayload = writableSites.map((site) => {
        const blank = blankSiteReview({ agencyId: session.agencyId, siteId: site.id });
        return {
          id: blank.id,
          agency_id: blank.agencyId,
          site_id: blank.siteId,
          reviewer_name: blank.reviewerName,
          support_coordinator: blank.supportCoordinator,
          reviewed_on: null,
          provider_owned_controlled: null,
          heightened_scrutiny: null,
          meets_individual_needs: null,
          part2_verified: false,
          lines: blank.lines,
        };
      });
      if (reviewsPayload.length) {
        const { error } = await this.client
          .from("site_reviews")
          .upsert(reviewsPayload, { onConflict: "site_id", ignoreDuplicates: true });
        if (error) return;
      }
    }
    if (this.canSetupChartRows(session.roleKey)) {
      for (const person of input.individuals) {
        await this.ensureClinicalRenewals(session, person.id);
        await this.ensureTrainingChecklists(session, person.id);
      }
    }
  }

  /** Hosted equivalent of the local mapPlanStack. */
  private hostedPlanStack(
    session: SessionUser,
    person: IndividualRecord,
    input: {
      profileRow: Record<string, unknown> | null;
      obligations: ObligationItem[];
      signatures: ObligationSignature[];
      submissions: { individualId: string; userId: string; submittedAt: string | null }[];
      renewals: ClinicalRenewal[];
      medications: Medication[];
      appointments: Appointment[];
      checklists: TrainingChecklist[];
      versionLabelById: Map<string, string | null>;
      orderReminderDays?: number[];
    },
  ): PlanStackView {
    const items = input.obligations.filter((item) => item.individualId === person.id);
    const views = sortObligations(items).map((item) => {
      const itemSigs = input.signatures.filter((row) => row.obligationId === item.id);
      return {
        item,
        mySignature: itemSigs.find((row) => row.userId === session.userId) ?? null,
        signedCount: itemSigs.filter((row) => row.signedAt).length,
        assignedCount: itemSigs.length,
      };
    });
    const required = views.filter((view) => view.item.mode === "required");
    const checked = views.filter((view) => view.item.mode === "checked");
    const mustSign = requiredForSigning(items);
    const myRequired = mustSign.map((item) =>
      input.signatures.find(
        (row) => row.obligationId === item.id && row.userId === session.userId,
      ),
    );
    const submission =
      input.submissions.find(
        (row) => row.individualId === person.id && row.userId === session.userId,
      ) ?? null;
    const checklistRows = input.checklists.filter((row) => row.individualId === person.id);
    const myChecklist =
      checklistRows.find((row) => row.staffUserId === session.userId) ?? null;
    const pcsp = required.find((view) => view.item.kind === "pcsp" && view.item.enabled);
    return {
      individualId: person.id,
      individualName: person.fullName,
      profile: normalizeProfile(person, profileFromRow(person, input.profileRow)),
      required,
      checked,
      renewals: canSeeRenewals(session.roleKey)
        ? input.renewals
            .filter((row) => row.individualId === person.id)
            .map((row) => ({
              ...row,
              status: renewalStatus(row.nextDueOn, undefined, input.orderReminderDays),
            }))
            .sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn))
        : [],
      carePlan: pcsp
        ? {
            title: pcsp.item.title,
            versionLabel: pcsp.item.documentVersionId
              ? (input.versionLabelById.get(pcsp.item.documentVersionId) ?? null)
              : null,
            documentVersionId: pcsp.item.documentVersionId,
            signedCount: pcsp.signedCount,
            assignedCount: pcsp.assignedCount,
          }
        : null,
      medications: canSeeMeds(session.roleKey)
        ? input.medications
            .filter((row) => row.individualId === person.id)
            .map((row) => toMedicationView(row))
        : [],
      staffTraining: checklistRows
        .filter((row) => canSeeRenewals(session.roleKey) || row.staffUserId === session.userId)
        .map((checklist) => ({ checklist, status: trainingStatus(checklist) })),
      myTraining: myChecklist
        ? { checklist: myChecklist, status: trainingStatus(myChecklist) }
        : null,
      mySubmissionAt: submission?.submittedAt ?? null,
      canSubmit:
        mustSign.length > 0 &&
        myRequired.every((row) => row?.signedAt) &&
        !submission &&
        (!myChecklist || (allLinesInitialed(myChecklist) && Boolean(myChecklist.staffSignedAt))),
      appointments: visibleAppointments(
        input.appointments.filter((row) => row.individualId === person.id),
        canManageAppointments(session.roleKey),
      ),
    };
  }

  private async individualRecord(individualId: string): Promise<IndividualRecord | null> {
    const { data: row } = await this.client
      .from("individuals")
      .select("*")
      .eq("id", individualId)
      .maybeSingle();
    return row ? mapIndividual(row) : null;
  }

  private async siteRecord(siteId: string): Promise<{ id: string; agencyId: string; name: string; address: string } | null> {
    const { data: row } = await this.client.from("sites").select("*").eq("id", siteId).maybeSingle();
    if (!row) return null;
    const site = mapSite(row);
    return { id: site.id, agencyId: site.agencyId, name: site.name, address: site.address };
  }

  private async agencyState(agencyId: string): Promise<string> {
    const { data } = await this.client
      .from("agencies")
      .select("state_code")
      .eq("id", agencyId)
      .maybeSingle();
    return agencyStateCode({ stateCode: data?.state_code as string | undefined });
  }

  private async siteLocationParts(siteId: string): Promise<SiteAddressParts> {
    const site = await this.siteRecord(siteId);
    const facts = site ? await this.siteFacts(site.id) : normalizeSiteFacts();
    const stateCode = site ? await this.agencyState(site.agencyId) : "";
    return siteLocationFrom(
      { name: site?.name ?? "Home", address: site?.address, city: facts.city, zip: facts.zip },
      stateCode,
    );
  }

  private async siteFacts(siteId: string): Promise<SiteFacts> {
    const { data: row } = await this.client
      .from("site_facts")
      .select("facts")
      .eq("site_id", siteId)
      .maybeSingle();
    return normalizeSiteFacts((row?.facts as Partial<SiteFacts> | null) ?? {});
  }

  private async individualProfile(person: IndividualRecord): Promise<IndividualProfile> {
    const { data: row } = await this.client
      .from("individual_profiles")
      .select("profile")
      .eq("individual_id", person.id)
      .maybeSingle();
    return normalizeProfile(person, profileFromRow(person, row ?? null));
  }

  private async obligationRosterUserIds(
    session: SessionUser,
    individualId: string,
    siteId: string,
  ): Promise<string[]> {
    const today = todayIso();
    const ids = new Set<string>();
    const { data: assignments } = await this.client
      .from("staff_assignments")
      .select("user_id, starts_on, ends_on")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId);
    for (const assignment of assignments ?? []) {
      const active =
        String(assignment.starts_on).slice(0, 10) <= today &&
        (!assignment.ends_on || String(assignment.ends_on).slice(0, 10) >= today);
      if (active) ids.add(assignment.user_id as string);
    }
    const { data: memberships } = await this.client
      .from("memberships")
      .select("user_id, role_key, role, site_id")
      .eq("agency_id", session.agencyId);
    for (const membership of memberships ?? []) {
      if (!PLAN_SIGNER_ROLE_KEYS.includes(membership.role_key as never)) continue;
      if (membership.site_id && membership.site_id !== siteId) continue;
      ids.add(membership.user_id as string);
    }
    return [...ids];
  }

  private async trainingRosterUserIds(
    session: SessionUser,
    individualId: string,
    siteId: string,
  ): Promise<string[]> {
    const today = todayIso();
    const ids = new Set<string>();
    const { data: assignments } = await this.client
      .from("staff_assignments")
      .select("user_id, individual_id, site_id, starts_on, ends_on")
      .eq("agency_id", session.agencyId);
    for (const assignment of assignments ?? []) {
      const active =
        String(assignment.starts_on).slice(0, 10) <= today &&
        (!assignment.ends_on || String(assignment.ends_on).slice(0, 10) >= today);
      if (!active) continue;
      if (assignment.individual_id === individualId || assignment.site_id === siteId) {
        ids.add(assignment.user_id as string);
      }
    }
    const { data: memberships } = await this.client
      .from("memberships")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    for (const membership of memberships ?? []) {
      ids.add(membership.user_id as string);
    }
    return [...ids];
  }

  private async syncObligationRoster(
    session: SessionUser,
    item: {
      id: string;
      agencyId: string;
      individualId: string;
      mode: string;
      enabled: boolean;
      expiresOn: string | null;
      kind?: string;
    },
  ) {
    if (item.mode !== "required") return;
    if (!item.enabled) return;
    if (item.kind !== "delegation" && item.expiresOn && item.expiresOn < todayIso()) return;
    const person = await this.individualRecord(item.individualId);
    if (!person) return;
    const userIds = await this.obligationRosterUserIds(session, item.individualId, person.siteId);
    if (!userIds.length) return;
    const { data: profiles } = await this.client.from("profiles").select("id, full_name").in("id", userIds);
    const rows = userIds
      .filter((userId) => (profiles ?? []).some((entry) => entry.id === userId))
      .map((userId) => ({
        agency_id: item.agencyId,
        obligation_id: item.id,
        user_id: userId,
        staff_name: (profiles ?? []).find((entry) => entry.id === userId)?.full_name as string,
      }));
    if (!rows.length) return;
    const { error } = await this.client
      .from("obligation_signatures")
      .upsert(rows, { onConflict: "obligation_id,user_id", ignoreDuplicates: true });
    throwIf(error, "Item saved, but the signature roster could not be synced.");
  }

  private async planPacketCanSubmit(session: SessionUser, individualId: string): Promise<boolean> {
    const { data: obligationRows } = await this.client
      .from("obligations")
      .select("*")
      .eq("individual_id", individualId);
    const items = (obligationRows ?? []).map(mapObligation);
    const mustSign = requiredForSigning(items);
    if (!mustSign.length) return false;
    const { data: signatureRows } = await this.client
      .from("obligation_signatures")
      .select("obligation_id, signed_at")
      .eq("user_id", session.userId)
      .in(
        "obligation_id",
        mustSign.map((item) => item.id),
      );
    const signed = new Set(
      (signatureRows ?? []).filter((row) => row.signed_at).map((row) => row.obligation_id as string),
    );
    if (!mustSign.every((item) => signed.has(item.id))) return false;
    const { data: submission } = await this.client
      .from("packet_submissions")
      .select("id")
      .eq("individual_id", individualId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (submission) return false;
    const { data: checklistRow } = await this.client
      .from("training_checklists")
      .select("*")
      .eq("individual_id", individualId)
      .eq("staff_user_id", session.userId)
      .maybeSingle();
    if (!checklistRow) return true;
    const checklist = mapTrainingChecklist(checklistRow);
    return allLinesInitialed(checklist) && Boolean(checklist.staffSignedAt);
  }

  private async ensureClinicalRenewals(session: SessionUser, individualId: string) {
    const { data: existing } = await this.client
      .from("clinical_renewals")
      .select("kind")
      .eq("individual_id", individualId);
    const have = new Set((existing ?? []).map((row) => String(row.kind)));
    const missing = defaultRenewals(session.agencyId, individualId).filter((row) => !have.has(row.kind));
    if (!missing.length) return;
    const { error } = await this.client.from("clinical_renewals").upsert(
      missing.map((row) => ({
        agency_id: row.agencyId,
        individual_id: row.individualId,
        kind: row.kind,
        title: row.title,
        interval_months: row.intervalMonths,
        last_uploaded_on: row.lastUploadedOn,
        next_due_on: row.nextDueOn,
        last_document_title: row.lastDocumentTitle,
        last_evidence_kind: row.lastEvidenceKind,
        file_id: row.fileId,
      })),
      { onConflict: "individual_id,kind", ignoreDuplicates: true },
    );
    throwIf(error, "Could not set up clinical renewals.");
  }

  private async ensureTrainingChecklists(session: SessionUser, individualId: string) {
    const person = await this.individualRecord(individualId);
    if (!person) return;
    const userIds = await this.trainingRosterUserIds(session, individualId, person.siteId);
    if (!userIds.length) return;
    const { data: obligationRows } = await this.client
      .from("obligations")
      .select("*")
      .eq("individual_id", individualId);
    const lines = trainingLinesFromObligations((obligationRows ?? []).map(mapObligation));
    const { data: existing } = await this.client
      .from("training_checklists")
      .select("staff_user_id")
      .eq("individual_id", individualId);
    const have = new Set((existing ?? []).map((row) => row.staff_user_id as string));
    const { data: profiles } = await this.client.from("profiles").select("id, full_name").in("id", userIds);
    const nameById = new Map((profiles ?? []).map((entry) => [entry.id as string, String(entry.full_name)]));
    const toInsert = userIds
      .filter((userId) => !have.has(userId) && nameById.has(userId))
      .map((userId) => ({
        agency_id: session.agencyId,
        individual_id: individualId,
        staff_user_id: userId,
        staff_name: nameById.get(userId)!,
        document_version_id: null,
        items: lines,
      }));
    if (!toInsert.length) return;
    const { error } = await this.client.from("training_checklists").insert(toInsert);
    throwIf(error, "Could not set up training checklists.");
  }

  async resetWorkspace() {
    throw new Error("Hosted workspaces cannot be reset from the browser.");
  }

  private async requireSession() {
    const session = await this.getSession();
    if (!session) throw new Error("Sign in to continue.");
    return session;
  }

  private async requirePrivileged() {
    const session = await this.requireSession();
    if (!isPrivileged(session.role)) {
      throw new Error("You do not have permission to do that.");
    }
    return session;
  }

  private requirePermission(session: SessionUser, key: PermissionKey) {
    if (!hasPermission(session, key)) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private requirePlatformOperator(session: SessionUser) {
    if (!session.platformAdmin) {
      throw new Error("Only the Complyrer operator can manage AI settings.");
    }
  }

  private async sessionFromUser(
    userId: string,
    email: string,
  ): Promise<SessionUser | null> {
    // SECURITY DEFINER so a valid Auth user is not told they have no agency
    // when memberships RLS cannot see their own row yet.
    const { data: context } = await this.client.rpc("login_context");
    const ctx = (context ?? {}) as {
      profile?: Record<string, unknown> | null;
      membership?: Record<string, unknown> | null;
      agency?: Record<string, unknown> | null;
    };
    let profile = ctx.profile
      ? {
          id: String(ctx.profile.id),
          full_name: String(ctx.profile.full_name ?? ""),
          email: String(ctx.profile.email ?? email),
          job_title: String(ctx.profile.job_title ?? ""),
          username: String(ctx.profile.username ?? ""),
          must_change_password: Boolean(ctx.profile.must_change_password),
          platform_admin: Boolean(ctx.profile.platform_admin),
        }
      : null;
    let membership = ctx.membership
      ? {
          agency_id: String(ctx.membership.agency_id),
          role: String(ctx.membership.role),
          role_key: String(ctx.membership.role_key ?? ctx.membership.role),
          site_id: (ctx.membership.site_id as string | null) ?? null,
          expires_on: ctx.membership.expires_on,
        }
      : null;
    let agency = ctx.agency
      ? {
          id: String(ctx.agency.id),
          name: String(ctx.agency.name ?? "Agency"),
          agency_code: String(ctx.agency.agency_code ?? ""),
          status: String(ctx.agency.status ?? "active"),
        }
      : null;

    if (!profile) {
      const { data } = await this.client
        .from("profiles")
        .select("id, full_name, email, job_title, username, must_change_password, home_agency_id, platform_admin")
        .eq("id", userId)
        .maybeSingle();
      profile = data
        ? {
            id: data.id,
            full_name: data.full_name,
            email: data.email,
            job_title: data.job_title,
            username: data.username ?? "",
            must_change_password: Boolean(data.must_change_password),
            platform_admin: Boolean(data.platform_admin),
          }
        : null;
    }
    if (!membership) {
      const { data } = await this.client
        .from("memberships")
        .select("agency_id, role, role_key, site_id, expires_on")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      membership = data
        ? {
            agency_id: data.agency_id,
            role: String(data.role),
            role_key: String(data.role_key ?? data.role),
            site_id: data.site_id,
            expires_on: data.expires_on,
          }
        : null;
    }
    if (!profile || !membership) return null;
    if (
      membership.expires_on &&
      String(membership.expires_on).slice(0, 10) < new Date().toISOString().slice(0, 10)
    ) {
      return null;
    }
    if (!agency) {
      const { data } = await this.client
        .from("agencies")
        .select("id, name, agency_code, status")
        .eq("id", membership.agency_id)
        .maybeSingle();
      agency = data
        ? {
            id: data.id,
            name: data.name,
            agency_code: data.agency_code,
            status: data.status,
          }
        : null;
    }
    const roleKey = String(membership.role_key ?? membership.role);
    const { data: agencyRole } = await this.client
      .from("agency_roles")
      .select("permissions")
      .eq("agency_id", membership.agency_id)
      .eq("template_key", roleKey)
      .maybeSingle();
    return {
      userId: profile.id,
      email: profile.email || email,
      username: profile.username ?? "",
      fullName: profile.full_name,
      jobTitle: profile.job_title,
      role: asRole(membership.role),
      roleKey,
      agencyId: membership.agency_id,
      agencyName: agency?.name ?? "Agency",
      agencyCode: agency?.agency_code ?? "",
      siteId: membership.site_id,
      mustChangePassword: Boolean(profile.must_change_password),
      expiresOn: membership.expires_on ? String(membership.expires_on).slice(0, 10) : null,
      permissions: (agencyRole?.permissions as PermissionMap) ?? defaultPermissions(roleKey),
      platformAdmin: Boolean(profile.platform_admin),
      agencyStatus:
        agency?.status === "pending" || agency?.status === "rejected"
          ? agency.status
          : "active",
    };
  }

  private async audit(
    session: SessionUser,
    action: string,
    detail: string,
    targetType: string,
    targetId?: string,
  ) {
    const { error } = await this.client.from("audit_events").insert({
      agency_id: session.agencyId,
      actor_id: session.userId,
      action,
      target_type: targetType,
      target_id: targetId ?? null,
      detail,
    });
    throwIf(error, "Could not write the audit event.");
  }

  private async profileName(userId: string | null) {
    if (!userId) return "Unassigned";
    const { data } = await this.client
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    return data?.full_name ?? "Unassigned";
  }

  private async siteName(siteId: string) {
    const { data } = await this.client
      .from("sites")
      .select("name")
      .eq("id", siteId)
      .maybeSingle();
    return data?.name ?? "Unknown site";
  }

  private async versionIdFromSource(source: string) {
    const { data: versions } = await this.client
      .from("document_versions")
      .select("id, version_label, document_id");
    const { data: documents } = await this.client.from("documents").select("id, title");
    const match = (versions ?? []).find((version) => {
      const document = (documents ?? []).find((d) => d.id === version.document_id);
      return `${document?.title} · ${version.version_label}` === source;
    });
    return match?.id ?? null;
  }

  // ===== LIFEPATH-P2 HOSTED (training engine) =====
  private mapTrainingRequirement(row: Record<string, unknown>): TrainingRequirement {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      userId: String(row.user_id),
      topicId: String(row.topic_id),
      individualId: (row.individual_id as string | null) ?? null,
      siteId: (row.site_id as string | null) ?? null,
      source: row.source as TrainingRequirement["source"],
      planVersionId: (row.plan_version_id as string | null) ?? null,
      delegationId: (row.delegation_id as string | null) ?? null,
      status: row.status as TrainingRequirement["status"],
      dueOn: row.due_on ? String(row.due_on).slice(0, 10) : null,
      createdAt: String(row.created_at),
    };
  }

  private mapTrainingSignoff(row: Record<string, unknown>): TrainingSignoff {
    return {
      id: String(row.id),
      requirementId: String(row.requirement_id),
      initials: String(row.initials),
      signedOn: String(row.signed_on).slice(0, 10),
      na: Boolean(row.na),
      naReason: (row.na_reason as string | null) ?? null,
      // Rows written before per-line e-initials carry no version.
      signoffVersion: Number(row.signoff_version ?? 1),
      trainerName: String(row.trainer_name),
      trainerUserId: (row.trainer_user_id as string | null) ?? null,
      signedByUserId: (row.signed_by_user_id as string | null) ?? null,
      selfTraining: Boolean(row.self_training),
      method: (row.method as TrainingSignoff["method"]) ?? null,
      hoursTotal: Number(row.hours_total ?? 0),
      hoursWithHm: Number(row.hours_with_hm ?? 0),
      competencyText: (row.competency_text as string | null) ?? null,
      observerName: (row.observer_name as string | null) ?? null,
      observerSignature: (row.observer_signature as string | null) ?? null,
      evidenceRef: (row.evidence_ref as string | null) ?? null,
      renewalRule: (row.renewal_rule as string | null) ?? null,
      nextDueOn: row.next_due_on ? String(row.next_due_on).slice(0, 10) : null,
      createdAt: String(row.created_at),
    };
  }

  private mapTrainingCountersignature(row: Record<string, unknown>): TrainingCountersignature {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      userId: String(row.user_id),
      siteId: String(row.site_id),
      staffSignatureName: (row.staff_signature_name as string | null) ?? null,
      staffSignatureMark: (row.staff_signature_mark as string | null) ?? null,
      staffSignedAt: (row.staff_signed_at as string | null) ?? null,
      hmSignatureName: (row.hm_signature_name as string | null) ?? null,
      hmSignatureMark: (row.hm_signature_mark as string | null) ?? null,
      hmSignedAt: (row.hm_signed_at as string | null) ?? null,
    };
  }

  /** Internal generator — no permission check; callers gate access. */
  private async p2GenerateTraining(input: {
    agencyId: string;
    userId: string;
    siteId: string | null;
    individualId: string | null;
    source: TrainingRequirement["source"];
    planVersionId?: string | null;
    delegationId?: string | null;
    topicIds: string[];
    dueOn?: string | null;
  }): Promise<TrainingRequirement[]> {
    const { data: existing } = await this.client
      .from("training_requirements")
      .select("topic_id, site_id, individual_id")
      .eq("agency_id", input.agencyId)
      .eq("user_id", input.userId);
    const seen = new Set(
      (existing ?? []).map(
        (row) =>
          `${String(row.topic_id)}|${String(row.site_id ?? "")}|${String(row.individual_id ?? "")}`,
      ),
    );
    const rows = input.topicIds
      .filter((topicId) => TRAINING_TOPIC_BY_ID[topicId])
      .filter((topicId) => {
        const key = `${topicId}|${input.siteId ?? ""}|${input.individualId ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((topicId) => ({
        agency_id: input.agencyId,
        user_id: input.userId,
        topic_id: topicId,
        individual_id: input.individualId,
        site_id: input.siteId,
        source: input.source,
        plan_version_id: input.planVersionId ?? null,
        delegation_id: input.delegationId ?? null,
        status: "pending",
        due_on: input.dueOn ?? null,
      }));
    if (rows.length === 0) return [];
    const { data, error } = await this.client
      .from("training_requirements")
      .insert(rows)
      .select("*");
    throwIf(error, "Could not generate training lines.");
    return (data ?? []).map((row) => this.mapTrainingRequirement(row));
  }

  /** LIFEPATH-P2 hook target: full checklist when a staff member is assigned. */
  private async p2GenerateForNewAssignment(
    session: SessionUser,
    userId: string,
    individual: { id: string; site_id: string; full_name: string },
  ) {
    const siteCreated = await this.p2GenerateTraining({
      agencyId: session.agencyId,
      userId,
      siteId: individual.site_id,
      individualId: null,
      source: "checklist",
      topicIds: siteChecklistTopics().map((topic) => topic.id),
    });
    const individualCreated = await this.p2GenerateTraining({
      agencyId: session.agencyId,
      userId,
      siteId: individual.site_id,
      individualId: individual.id,
      source: "checklist",
      topicIds: individualChecklistTopics().map((topic) => topic.id),
    });
    const total = siteCreated.length + individualCreated.length;
    if (total > 0) {
      await this.audit(
        session,
        "training.assigned",
        `${total} training lines generated for ${await this.profileName(userId)} at ${individual.full_name}`,
        "training_requirement",
      );
    }
  }

  /** LIFEPATH-P2 hook target: targeted retraining when a plan version goes active. */
  private async p2GeneratePlanRetraining(
    session: SessionUser,
    individualId: string,
    siteId: string,
    individualName: string,
    versionId: string,
  ) {
    const { data: assignments } = await this.client
      .from("staff_assignments")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId);
    const userIds = [...new Set((assignments ?? []).map((row) => String(row.user_id)))];
    if (userIds.length === 0) return;
    let total = 0;
    for (const userId of userIds) {
      total += (
        await this.p2GenerateTraining({
          agencyId: session.agencyId,
          userId,
          siteId,
          individualId,
          source: "plan_version",
          planVersionId: versionId,
          topicIds: planUpdateRetrainingTopicIds(),
        })
      ).length;
    }
    if (total > 0) {
      await this.audit(
        session,
        "training.retraining_assigned",
        `${total} retraining lines generated for a new active plan version (${individualName})`,
        "document_version",
        versionId,
      );
    }
  }

  async listTrainingTopics(scope?: "agency" | "site"): Promise<TrainingTopic[]> {
    await this.requireSession();
    return scope ? TRAINING_TOPICS.filter((topic) => topic.scope === scope) : [...TRAINING_TOPICS];
  }

  async assignTraining(input: AssignTrainingInput): Promise<TrainingRequirement[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "hr.view_staff");
    const { data: membership, error: memberError } = await this.client
      .from("memberships")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", input.userId)
      .maybeSingle();
    throwIf(memberError, "Could not verify that staff member.");
    if (!membership) throw new Error("That staff member is not in this agency.");
    const siteId = input.siteId ?? null;
    const individualId = input.individualId ?? null;
    let created: TrainingRequirement[];
    if (input.source === "checklist" && !input.topicIds) {
      // Sections 1–5 once per staff per site; section 6 once per staff per individual.
      created = await this.p2GenerateTraining({
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
          await this.p2GenerateTraining({
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
      created = await this.p2GenerateTraining({
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
    await this.audit(
      session,
      "training.assigned",
      `${created.length} training lines assigned to ${await this.profileName(input.userId)} (${input.source})`,
      "training_requirement",
    );
    return created;
  }

  private async p2RequirementView(
    requirement: TrainingRequirement,
    signoffsByRequirement: Map<string, TrainingSignoff>,
    individualNames: Map<string, string>,
    today: string,
  ): Promise<TrainingRequirementView> {
    const topic = TRAINING_TOPIC_BY_ID[requirement.topicId];
    const individualName = requirement.individualId
      ? (individualNames.get(requirement.individualId) ?? null)
      : null;
    const signoff = signoffsByRequirement.get(requirement.id) ?? null;
    return {
      ...requirement,
      topicTitle: renderTopicTitle(topic, individualName),
      section: topic?.section ?? 5,
      perIndividual: topic?.perIndividual ?? false,
      individualName,
      signoff,
      resolvedStatus: resolveRequirementStatus(requirement.status, requirement.dueOn, today),
    };
  }

  async getStaffTrainingProfile(userId: string): Promise<StaffTrainingProfile> {
    const session = await this.requireSession();
    if (session.userId !== userId) this.requirePermission(session, "hr.view_staff");
    const fullName = await this.profileName(userId);
    const today = new Date().toISOString().slice(0, 10);
    const { data: reqRows, error: reqError } = await this.client
      .from("training_requirements")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    throwIf(reqError, "Could not load training lines.");
    const requirements = (reqRows ?? []).map((row) => this.mapTrainingRequirement(row));
    const requirementIds = requirements.map((row) => row.id);
    const { data: signoffRows } = requirementIds.length
      ? await this.client.from("training_signoffs").select("*").in("requirement_id", requirementIds)
      : { data: [] as Record<string, unknown>[] };
    const signoffs = ((signoffRows ?? []) as Record<string, unknown>[]).map((row) =>
      this.mapTrainingSignoff(row),
    );
    const signoffsByRequirement = new Map(signoffs.map((row) => [row.requirementId, row]));
    const individualIds = [
      ...new Set(requirements.map((row) => row.individualId).filter(Boolean)),
    ] as string[];
    const { data: people } = individualIds.length
      ? await this.client.from("individuals").select("id, full_name").in("id", individualIds)
      : { data: [] as { id: string; full_name: string }[] };
    const individualNames = new Map(
      ((people ?? []) as { id: string; full_name: string }[]).map((row) => [row.id, row.full_name]),
    );
    const views: TrainingRequirementView[] = [];
    for (const requirement of requirements) {
      views.push(
        await this.p2RequirementView(requirement, signoffsByRequirement, individualNames, today),
      );
    }
    const { data: counterRows } = await this.client
      .from("training_countersignatures")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("user_id", userId);
    const countersignatures = ((counterRows ?? []) as Record<string, unknown>[]).map((row) =>
      this.mapTrainingCountersignature(row),
    );
    const siteIds = [...new Set(requirements.map((row) => row.siteId).filter(Boolean))] as string[];
    const { data: siteRows } = siteIds.length
      ? await this.client.from("sites").select("id, name").in("id", siteIds)
      : { data: [] as { id: string; name: string }[] };
    const siteNameById = new Map(
      ((siteRows ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
    );
    const siteNames = siteIds.map((id) => siteNameById.get(id) ?? "Unknown site");
    const { hoursTotal, hoursWithHm } = sumHours(
      signoffs.map((row) => ({ hoursTotal: row.hoursTotal, hoursWithHm: row.hoursWithHm, na: row.na })),
    );
    let complete = 0;
    let pending = 0;
    let overdue = 0;
    let waived = 0;
    for (const view of views) {
      if (view.resolvedStatus === "complete") complete += 1;
      else if (view.resolvedStatus === "waived_na") waived += 1;
      else if (view.resolvedStatus === "overdue") overdue += 1;
      else pending += 1;
    }
    const required = complete + pending + overdue;
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
      fullName,
      siteNames,
      individualNames: individualIds.map((id) => ({
        id,
        fullName: individualNames.get(id) ?? "Unknown",
      })),
      requirements: views,
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
    const session = await this.requireSession();
    this.requirePermission(session, "hr.view_staff");
    let query = this.client
      .from("training_requirements")
      .select("user_id")
      .eq("agency_id", session.agencyId);
    if (siteId) query = query.eq("site_id", siteId);
    const { data, error } = await query;
    throwIf(error, "Could not load staff training.");
    const userIds = [...new Set((data ?? []).map((row) => String(row.user_id)))];
    const rows: StaffClearanceRow[] = [];
    for (const userId of userIds) {
      const profile = await this.getStaffTrainingProfile(userId);
      rows.push({
        userId,
        fullName: profile.fullName,
        siteName: siteId ? (profile.siteNames[0] ?? "Unknown site") : profile.siteNames.join(", ") || "—",
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

  /**
   * App-level locked-sheet check: a house-manager countersignature freezes
   * signoff writes for that staffer+site (the RLS update policy rejects them
   * too, but this gives a clear message instead of a database error).
   */
  private async assertTrainingUnlocked(requirement: {
    userId: string;
    siteId: string | null;
  }) {
    if (requirement.siteId == null) return;
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("training_countersignatures")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", requirement.userId)
      .eq("site_id", requirement.siteId)
      .not("hm_signed_at", "is", null)
      .limit(1);
    throwIf(error, "Could not check the training sheet lock.");
    if ((data ?? []).length > 0) throw new Error(LOCKED_TRAINING_SHEET_MESSAGE);
  }

  /** Resolve a trainer id against the agency staff roster (no free text). */
  private async trainerNameOrThrow(session: SessionUser, trainerUserId: string) {
    const { data, error } = await this.client
      .from("profiles")
      .select("full_name,home_agency_id")
      .eq("id", trainerUserId)
      .maybeSingle();
    throwIf(error, "Could not verify the trainer.");
    if (!data || (data.home_agency_id as string) !== session.agencyId) {
      throw new Error("Choose the trainer from the staff roster.");
    }
    return String(data.full_name);
  }

  /** Map a lock-shaped database error to the friendly locked-sheet message. */
  private throwLockAware(error: { message: string } | null, fallback: string): never {
    if (error && /row-level security/i.test(error.message ?? "")) {
      throw new Error(LOCKED_TRAINING_SHEET_MESSAGE);
    }
    if (error) throwIf(error, fallback);
    throw new Error(fallback);
  }

  async initialRequirementLine(
    requirementId: string,
    input: RequirementLineSignoffInput,
  ): Promise<void> {
    const session = await this.requireSession();
    const { data: requirement, error } = await this.client
      .from("training_requirements")
      .select("*")
      .eq("id", requirementId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Training line not found.");
    if (!requirement) throw new Error("Training line not found.");
    const mapped = this.mapTrainingRequirement(requirement);
    if (session.userId !== mapped.userId) this.requirePermission(session, "hr.view_staff");
    await this.assertTrainingUnlocked(mapped);
    await this.assertDocumentUnlocked(
      session,
      "training_checklist",
      trainingChecklistDocId(mapped.userId, mapped.siteId ?? ""),
    );
    const validated = validateTrainingLineInput(input);
    const trainerName = await this.trainerNameOrThrow(session, validated.trainerUserId);
    const selfTraining = validated.trainerUserId === mapped.userId;
    const payload = {
      initials: validated.initials,
      signed_on: validated.signedOn,
      na: false,
      na_reason: null,
      trainer_name: trainerName,
      trainer_user_id: validated.trainerUserId,
      signed_by_user_id: session.userId,
      self_training: selfTraining,
      method: input.method ?? null,
      hours_total: validated.hoursTotal,
      hours_with_hm: validated.hoursWithHm,
      competency_text: input.competencyText?.trim() || null,
      observer_name: input.observerName?.trim() || null,
      observer_signature: input.observerSignature?.trim() || null,
      evidence_ref: input.evidenceRef?.trim() || null,
      renewal_rule: input.renewalRule?.trim() || null,
      next_due_on:
        input.nextDueOn?.slice(0, 10) ??
        computeNextDueOn(input.renewalRule?.trim() ?? null, validated.signedOn),
    };
    const { data: existingSignoff } = await this.client
      .from("training_signoffs")
      .select("id, signoff_version")
      .eq("requirement_id", requirementId)
      .maybeSingle();
    if (existingSignoff) {
      // Correction edit of a completed line: allowed only on unlocked sheets
      // and only by roles that may update signoffs (mirrors RLS) — plus the
      // assigned trainee, who must be able to re-save their own line in order
      // to re-initial it. 13 CSR 65-3.050 attribution requires that only the
      // trainee initials their own lines, so the save path cannot lock them
      // out of the re-initial the stamp path demands.
      if (!canEditTrainingLine(session.roleKey) && session.userId !== mapped.userId) {
        throw new Error(
          "Only the assigned staff member, an administrator, compliance admin, house manager, or PM can edit a completed training line.",
        );
      }
      // Void-and-redo: the edit voids the previous initialing — the line must
      // be re-initialed, stamping a fresh versioned signature event. The old
      // version's event stays as history.
      const nextVersion = Number((existingSignoff as { signoff_version?: unknown }).signoff_version ?? 1) + 1;
      const { error: updateError } = await this.client
        .from("training_signoffs")
        .update({ ...payload, signoff_version: nextVersion })
        .eq("id", (existingSignoff as { id: string }).id);
      if (updateError) this.throwLockAware(updateError, "Could not save the sign-off.");
      const { error: updateStatusError } = await this.client
        .from("training_requirements")
        .update({ status: "complete" })
        .eq("id", requirementId);
      throwIf(updateStatusError, "Sign-off saved, but the line status could not be updated.");
      await this.audit(
        session,
        "training.line_edited",
        `${validated.initials} edited “${renderTopicTitle(TRAINING_TOPIC_BY_ID[mapped.topicId])}” for ${await this.profileName(mapped.userId)}`,
        "training_requirement",
        requirementId,
      );
      return;
    }
    const { error: insertError } = await this.client.from("training_signoffs").insert({
      agency_id: session.agencyId,
      requirement_id: requirementId,
      signoff_version: 1,
      ...payload,
    });
    throwIf(insertError, "Could not save the sign-off.");
    const { error: updateError } = await this.client
      .from("training_requirements")
      .update({ status: "complete" })
      .eq("id", requirementId);
    throwIf(updateError, "Sign-off saved, but the line status could not be updated.");
    await this.audit(
      session,
      "training.line_initialed",
      `${validated.initials} initialed “${renderTopicTitle(TRAINING_TOPIC_BY_ID[mapped.topicId])}” for ${await this.profileName(mapped.userId)}`,
      "training_requirement",
      requirementId,
    );
  }

  async waiveRequirementLine(requirementId: string, reason: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "hr.view_staff");
    const { data: requirement, error } = await this.client
      .from("training_requirements")
      .select("*")
      .eq("id", requirementId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Training line not found.");
    if (!requirement) throw new Error("Training line not found.");
    const mapped = this.mapTrainingRequirement(requirement);
    await this.assertTrainingUnlocked(mapped);
    await this.assertDocumentUnlocked(
      session,
      "training_checklist",
      trainingChecklistDocId(mapped.userId, mapped.siteId ?? ""),
    );
    const { data: existingSignoff } = await this.client
      .from("training_signoffs")
      .select("id")
      .eq("requirement_id", requirementId)
      .maybeSingle();
    if (existingSignoff) throw new Error("This training line is already initialed.");
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("Write the reason this line is N/A.");
    const { error: insertError } = await this.client.from("training_signoffs").insert({
      agency_id: session.agencyId,
      requirement_id: requirementId,
      initials: "N/A",
      signed_on: new Date().toISOString().slice(0, 10),
      na: true,
      na_reason: trimmed,
      signoff_version: 1,
      trainer_name: session.fullName,
      trainer_user_id: session.userId,
      signed_by_user_id: session.userId,
      self_training: false,
      method: null,
      hours_total: 0,
      hours_with_hm: 0,
      competency_text: null,
      observer_name: null,
      observer_signature: null,
      evidence_ref: null,
      renewal_rule: null,
      next_due_on: null,
    });
    throwIf(insertError, "Could not save the N/A.");
    const { error: updateError } = await this.client
      .from("training_requirements")
      .update({ status: "waived_na" })
      .eq("id", requirementId);
    throwIf(updateError, "N/A saved, but the line status could not be updated.");
    await this.audit(
      session,
      "training.line_waived",
      `N/A: “${renderTopicTitle(TRAINING_TOPIC_BY_ID[mapped.topicId])}” for ${await this.profileName(mapped.userId)} — ${trimmed}`,
      "training_requirement",
      requirementId,
    );
  }

  async requestTrainingCorrection(input: RequestTrainingCorrectionInput): Promise<void> {
    const session = await this.requireSession();
    if (!canRequestTrainingCorrection(session.roleKey)) {
      throw new Error(
        "Only an administrator, compliance admin, or PM can request a training correction.",
      );
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error("Write the reason for this correction.");
    const { data: counter, error: fetchError } = await this.client
      .from("training_countersignatures")
      .select("id, user_id, site_id")
      .eq("id", input.countersignatureId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(fetchError, "Training sheet not found.");
    if (!counter) throw new Error("Training sheet not found.");
    // Clearing the end-signature events unlocks the sheet: with no sheet
    // signatures the same document id can be signed again with the corrected
    // content. Per-line versioned initials stamps stay as audit history —
    // a line edit already bumps its version and requires re-initialing.
    const counterRow = counter as { user_id: string; site_id: string };
    const { error: eventError } = await this.client
      .from("signature_events")
      .delete()
      .eq("agency_id", session.agencyId)
      .eq("document_type", "training_checklist")
      .eq("document_id", trainingChecklistDocId(counterRow.user_id, counterRow.site_id))
      .in("field_name", ["staff_sign", "hm_countersign"]);
    throwIf(eventError, "Could not clear the sheet's signatures.");
    // Deleting the countersignature unlocks the sheet: completed lines can be
    // edited, and the sheet must be re-signed and re-countersigned.
    const { error: deleteError } = await this.client
      .from("training_countersignatures")
      .delete()
      .eq("id", input.countersignatureId);
    if (deleteError) this.throwLockAware(deleteError, "Could not request the correction.");
    await this.audit(
      session,
      "training.correction_requested",
      `Correction requested for ${await this.profileName((counter as { user_id: string }).user_id)}'s training sheet: ${reason}`,
      "training_countersignature",
      input.countersignatureId,
    );
  }

  async signStaffChecklist(input: {
    userId: string;
    siteId: string;
    role: "staff" | "hm";
    signatureName: string;
    signatureMark?: string;
  }): Promise<void> {
    const session = await this.requireSession();
    const { data: reqRows, error: reqError } = await this.client
      .from("training_requirements")
      .select("id, status, due_on")
      .eq("agency_id", session.agencyId)
      .eq("user_id", input.userId)
      .eq("site_id", input.siteId);
    throwIf(reqError, "Could not load training lines.");
    const lines = reqRows ?? [];
    if (lines.length === 0) throw new Error("No training lines assigned for this site yet.");
    const today = new Date().toISOString().slice(0, 10);
    const requirementIds = lines.map((row) => String(row.id));
    const { data: signoffRows } = await this.client
      .from("training_signoffs")
      .select("requirement_id")
      .in("requirement_id", requirementIds);
    const signedIds = new Set((signoffRows ?? []).map((row) => String(row.requirement_id)));
    const { data: counterRow } = await this.client
      .from("training_countersignatures")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("user_id", input.userId)
      .eq("site_id", input.siteId)
      .maybeSingle();
    let counter = counterRow ? this.mapTrainingCountersignature(counterRow) : null;
    if (!counter) {
      const { data: inserted, error: insertError } = await this.client
        .from("training_countersignatures")
        .insert({ agency_id: session.agencyId, user_id: input.userId, site_id: input.siteId })
        .select("*")
        .single();
      throwIf(insertError, "Could not start the signature sheet.");
      counter = this.mapTrainingCountersignature(inserted!);
    }
    const name = input.signatureName.trim();
    if (!name) throw new Error("Type your name to sign.");
    const now = new Date().toISOString();
    if (input.role === "staff") {
      if (session.userId !== input.userId) {
        throw new Error("Staff must sign their own training sheet.");
      }
      if (counter.staffSignedAt) throw new Error("This sheet is already signed by staff.");
      const open = lines.filter((row) => !signedIds.has(String(row.id)));
      if (open.length > 0) {
        throw new Error(
          `Initial or N/A every training line before signing (${open.length} still open).`,
        );
      }
      const { error: updateError } = await this.client
        .from("training_countersignatures")
        .update({
          staff_signed_at: now,
          staff_signature_name: name,
          staff_signature_mark: input.signatureMark ?? null,
        })
        .eq("id", counter.id);
      throwIf(updateError, "Could not save the signature.");
    } else {
      if (!canSignTrainingAsHm(session.roleKey)) {
        throw new Error("Only a house manager can counter-sign training.");
      }
      if (!counter.staffSignedAt) {
        throw new Error("Staff must sign this sheet before the house manager.");
      }
      if (counter.hmSignedAt) throw new Error("House manager already signed.");
      const { error: updateError } = await this.client
        .from("training_countersignatures")
        .update({
          hm_signed_at: now,
          hm_signature_name: name,
          hm_signature_mark: input.signatureMark ?? null,
        })
        .eq("id", counter.id);
      throwIf(updateError, "Could not save the signature.");
    }
    await this.audit(
      session,
      "training.checklist_signed",
      `${name} signed the training checklist for ${await this.profileName(input.userId)} at ${await this.siteName(input.siteId)} (${input.role})`,
      "training_requirement",
      counter.id,
    );
  }
  // ===== LIFEPATH-P3 HOSTED (delegation forms) =====

  /** Load the delegation obligation + its form, scoped to the caller's agency. */
  private async delegationRow(session: SessionUser, obligationId: string) {
    const { data: row, error } = await this.client
      .from("obligations")
      .select("*")
      .eq("id", obligationId)
      .eq("agency_id", session.agencyId)
      .single();
    throwIf(error, "Delegation not found.");
    const item = mapObligation(row!);
    if (item.kind !== "delegation") throw new Error("Delegation not found.");
    return { item, form: item.delegationForm ?? blankDelegationForm() };
  }

  private assertDelegationEditor(session: SessionUser) {
    if (
      !canToggleDelegation(
        session.roleKey,
        session.role,
        hasPermission(session, "requirements.approve"),
      )
    ) {
      throw new Error("Only a PM or nurse can manage a delegation form.");
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
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    this.assertDelegationEditor(session);
    const person = await this.individualRecord(input.individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found.");
    }
    if (!canAccessSite(session, person.siteId)) {
      throw new Error("Choose an individual at a site you can manage.");
    }
    const taskTitle = input.taskTitle.trim();
    if (!taskTitle) throw new Error("Name the delegated task.");
    if (!input.purpose.trim()) throw new Error("Describe the purpose of the task.");
    const form = blankDelegationForm(input.templateVersion ?? "complyrer_improved");
    form.purpose = input.purpose.trim();
    form.procedures = input.procedures?.trim() ?? "";
    form.observeReportDo = input.observeReportDo?.trim() ?? "";
    const { data, error } = await this.client
      .from("obligations")
      .insert({
        agency_id: session.agencyId,
        individual_id: person.id,
        kind: "delegation",
        mode: "required",
        title: taskTitle,
        detail: form.purpose,
        created_from: "manual",
        delegation_form: JSON.parse(JSON.stringify(form)),
      })
      .select("id")
      .single();
    throwIf(error, "Could not create the delegation.");
    await this.audit(
      session,
      "delegation.created",
      `${session.fullName} created delegation "${taskTitle}" for ${person.fullName}`,
      "obligation",
      data!.id as string,
    );
    return { id: data!.id as string };
  }

  async updateDelegationForm(input: {
    obligationId: string;
    patch: DelegationFormPatch;
  }) {
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    this.assertDelegationEditor(session);
    const { item, form } = await this.delegationRow(session, input.obligationId);
    await this.assertDocumentUnlocked(session, "delegation_form", input.obligationId);
    const { instructingProfessional, delegatingRn, roster, ...rest } = input.patch;
    Object.assign(form, rest);
    if (instructingProfessional) Object.assign(form.instructingProfessional, instructingProfessional);
    if (delegatingRn) Object.assign(form.delegatingRn, delegatingRn);
    if (roster) form.roster = roster.slice(0, 12);
    const { error } = await this.client
      .from("obligations")
      .update({ delegation_form: JSON.parse(JSON.stringify(form)) })
      .eq("id", item.id);
    throwIf(error, "Could not update the delegation form.");
    await this.audit(
      session,
      "delegation.form_updated",
      `${session.fullName} updated the delegation form for ${item.title}`,
      "obligation",
      item.id,
    );
  }

  async signDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    signatureName: string;
    signatureMark: string;
    initials: string;
  }) {
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    const { item, form } = await this.delegationRow(session, input.obligationId);
    if (!item.enabled) throw new Error("This delegation is turned off.");
    // Signing order: RN first, then staff — matches the real workflow.
    if (!item.rnSignedAt) {
      throw new Error("The delegating RN must sign before staff sign their rows.");
    }
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
    const { error } = await this.client
      .from("obligations")
      .update({ delegation_form: JSON.parse(JSON.stringify(form)) })
      .eq("id", item.id);
    throwIf(error, "Could not save the signature.");
    await this.audit(
      session,
      "delegation.row_signed",
      `${input.signatureName.trim()} signed the delegation roster for ${item.title}`,
      "obligation",
      item.id,
    );
  }

  async rescindDelegationRow(input: {
    obligationId: string;
    rowIndex: number;
    rescindedDate: string;
  }) {
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    this.assertDelegationEditor(session);
    const { item, form } = await this.delegationRow(session, input.obligationId);
    await this.assertDocumentUnlocked(session, "delegation_form", input.obligationId);
    const row = form.roster[input.rowIndex];
    if (!row) throw new Error("Roster row not found.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.rescindedDate)) {
      throw new Error("Use a valid rescinded date.");
    }
    row.rescindedDate = input.rescindedDate;
    const { error } = await this.client
      .from("obligations")
      .update({ delegation_form: JSON.parse(JSON.stringify(form)) })
      .eq("id", item.id);
    throwIf(error, "Could not rescind that roster row.");
    await this.audit(
      session,
      "delegation.row_rescinded",
      `${session.fullName} rescinded ${row.printName || "a roster row"} on ${item.title}`,
      "obligation",
      item.id,
    );
  }

  async getDelegationPdf(input: { obligationId: string }) {
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    const { item, form } = await this.delegationRow(session, input.obligationId);
    const person = await this.individualRecord(item.individualId);
    if (!person || person.agencyId !== session.agencyId) throw new Error("Delegation not found.");
    const logoDataUrl = await this.hostedLogoDataUrl(session.agencyId);
    const { buildDelegationPdf, delegationFileName } = await import("../pdf/delegationPdf");
    const pdf = buildDelegationPdf({
      agencyName: session.agencyName,
      individualName: person.fullName,
      dmhId: "",
      individualLocation: await this.siteName(person.siteId),
      taskTitle: item.title,
      form,
      documentId: input.obligationId,
      logoDataUrl,
    });
    return {
      blob: pdf.output("blob"),
      name: delegationFileName(item.title, person.fullName),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Delegation template workflow (hosted): templates → site activation  */
  /* → assignment → training review → publish → staff acknowledgment.   */
  /* Reads go straight at the tables (RLS scopes them to the caller's  */
  /* site); every write flows through a SECURITY DEFINER RPC that       */
  /* re-checks permissions server-side.                                 */
  /* ------------------------------------------------------------------ */

  async listDelegationTemplates(): Promise<DelegationTemplate[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.view");
    const { data, error } = await this.client
      .from("delegation_templates")
      .select(
        "id, agency_id, name, category, sections, individualization_note, active",
      )
      .eq("active", true)
      .order("name");
    throwIf(error, "Could not load delegation templates.");
    // RLS already serves the common library + the caller's agency rows;
    // keep the local parity filter as a second check.
    return ((data ?? []) as Record<string, unknown>[])
      .filter(
        (row) =>
          row.agency_id === null || row.agency_id === session.agencyId,
      )
      .map(mapDelegationTemplate);
  }

  async createDelegationTemplate(input: {
    name: string;
    category: DelegationTemplateCategory;
    sections: TemplateSections;
    individualizationNote: string;
  }): Promise<DelegationTemplate> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.manage");
    // The migration ships no INSERT policy on delegation_templates: writes go
    // through this SECURITY DEFINER RPC, which re-checks the permission.
    // Returns a single JSON object (the template row).
    const { data, error } = await this.client.rpc(
      "create_delegation_template",
      {
        p_agency_id: session.agencyId,
        p_name: input.name,
        p_category: input.category,
        p_sections: JSON.parse(JSON.stringify(input.sections)),
        p_individualization_note: input.individualizationNote,
      },
    );
    throwIf(error, "Could not create the delegation template.");
    if (!data) throw new Error("Could not create the delegation template.");
    return mapDelegationTemplate(data as Record<string, unknown>);
  }

  async updateDelegationTemplate(
    id: string,
    patch: {
      name?: string;
      category?: DelegationTemplateCategory;
      active?: boolean;
    },
  ): Promise<DelegationTemplate> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.manage");
    // The migration ships no UPDATE policy on delegation_templates: writes go
    // through this SECURITY DEFINER RPC, which re-checks the permission.
    // Returns a single JSON object (the template row).
    const { data, error } = await this.client.rpc(
      "update_delegation_template",
      {
        p_template_id: id,
        p_name: patch.name ?? null,
        p_category: patch.category ?? null,
        p_active: patch.active ?? null,
      },
    );
    throwIf(error, "Could not update the delegation template.");
    if (!data) throw new Error("Delegation template not found.");
    return mapDelegationTemplate(data as Record<string, unknown>);
  }

  async activateDelegationTemplate(
    templateId: string,
    siteId: string,
  ): Promise<SiteDelegationActivation> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.activate");
    // Returns a single JSON object (the activation row).
    const { data, error } = await this.client.rpc(
      "activate_delegation_template",
      { p_template_id: templateId, p_site_id: siteId },
    );
    throwIf(error, "Could not activate that template.");
    const activation = (await this.mapDelegationActivations([
      data as Record<string, unknown>,
    ]))[0];
    if (!activation) throw new Error("Could not activate that template.");
    return activation;
  }

  async deactivateDelegationActivation(
    id: string,
  ): Promise<SiteDelegationActivation> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.activate");
    // Returns a single JSON object (the updated activation row).
    const { data, error } = await this.client.rpc(
      "deactivate_delegation_activation",
      { p_activation_id: id },
    );
    throwIf(error, "Could not deactivate that activation.");
    const activation = (await this.mapDelegationActivations([
      data as Record<string, unknown>,
    ]))[0];
    if (!activation) throw new Error("Delegation activation not found.");
    return activation;
  }

  async listSiteDelegationActivations(filter?: {
    siteId?: string;
  }): Promise<SiteDelegationActivation[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.view");
    let query = this.client
      .from("site_delegation_activations")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("activated_at", { ascending: false });
    if (filter?.siteId) query = query.eq("site_id", filter.siteId);
    const { data, error } = await query;
    throwIf(error, "Could not load delegation activations.");
    return this.mapDelegationActivations(
      (data ?? []) as Record<string, unknown>[],
    );
  }

  async assignDelegationToIndividual(
    activationId: string,
    individualId: string,
  ): Promise<IndividualDelegationAssignment> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.assign");
    // Returns {assignment, material}: the material is created by the RPC
    // and read through the training-material methods below.
    const { data, error } = await this.client.rpc("assign_delegation", {
      p_activation_id: activationId,
      p_individual_id: individualId,
    });
    throwIf(error, "Could not assign that delegation.");
    const result = data as {
      assignment?: Record<string, unknown>;
    } | null;
    if (!result?.assignment) throw new Error("Could not assign that delegation.");
    const assignment = (
      await this.mapDelegationAssignments([result.assignment])
    )[0];
    if (!assignment) throw new Error("Could not assign that delegation.");
    return assignment;
  }

  async endDelegationAssignment(
    id: string,
  ): Promise<IndividualDelegationAssignment> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.assign");
    // Returns a single JSON object (the updated assignment row).
    const { data, error } = await this.client.rpc("end_delegation_assignment", {
      p_assignment_id: id,
    });
    throwIf(error, "Could not end that delegation assignment.");
    const assignment = (
      await this.mapDelegationAssignments([data as Record<string, unknown>])
    )[0];
    if (!assignment) throw new Error("Delegation assignment not found.");
    return assignment;
  }

  async listDelegationAssignments(filter?: {
    siteId?: string;
  }): Promise<IndividualDelegationAssignment[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.view");
    let query = this.client
      .from("individual_delegation_assignments")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("assigned_at", { ascending: false });
    if (filter?.siteId) query = query.eq("site_id", filter.siteId);
    const { data, error } = await query;
    throwIf(error, "Could not load delegation assignments.");
    return this.mapDelegationAssignments(
      (data ?? []) as Record<string, unknown>[],
    );
  }

  async getDelegationTrainingMaterial(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial | null> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.view");
    const canReview =
      hasPermission(session, "delegation.training.review") ||
      hasPermission(session, "delegation.training.approve");
    if (canReview) {
      // Reviewers may read the full row (draft included) — RLS permits them.
      const { data, error } = await this.client
        .from("delegation_training_materials")
        .select("*")
        .eq("assignment_id", assignmentId)
        .maybeSingle();
      throwIf(error, "Could not load the training material.");
      return data
        ? mapDelegationTrainingMaterial(data as Record<string, unknown>)
        : null;
    }
    // Ordinary staff only ever see published content — the RPC returns
    // published_content only, never draft_content.
    const { data, error } = await this.client.rpc(
      "get_published_training_material",
      { p_assignment_id: assignmentId },
    );
    throwIf(error, "Could not load the training material.");
    if (!data) return null;
    const published = data as Record<string, unknown>;
    const content = published.content as TrainingMaterialContent;
    // One material per assignment; the RPC does not return the material's
    // own id, so the assignment id stands in as the material key.
    return {
      id: assignmentId,
      agencyId: session.agencyId,
      assignmentId,
      status: "published",
      draftContent: content,
      publishedContent: content,
      submittedAt: null,
      approvedAt: (published.approvedAt as string) ?? null,
      approvedBy: null,
    };
  }

  async updateDelegationTrainingDraft(
    assignmentId: string,
    draft: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.training.review");
    // The migration ships no UPDATE policy on delegation_training_materials:
    // writes go through this SECURITY DEFINER RPC, which re-checks the
    // permission and only allows editing draft/in-review material.
    // Returns a single JSON object (the material row).
    const { data, error } = await this.client.rpc(
      "save_delegation_training_draft",
      {
        p_assignment_id: assignmentId,
        p_draft_content: JSON.parse(
          JSON.stringify({ ...draft, generatedMark: DIGITAL_RECORD_MARK }),
        ),
      },
    );
    throwIf(error, "Could not update the training draft.");
    if (!data) throw new Error("Training material not found.");
    return mapDelegationTrainingMaterial(data as Record<string, unknown>);
  }

  async submitDelegationForReview(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.training.review");
    // Returns a single JSON object (the material row).
    const { data, error } = await this.client.rpc("submit_delegation_review", {
      p_assignment_id: assignmentId,
    });
    throwIf(error, "Could not submit that training draft.");
    if (!data) throw new Error("Training material not found.");
    return mapDelegationTrainingMaterial(data as Record<string, unknown>);
  }

  async approveDelegationTrainingMaterial(
    assignmentId: string,
    content: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.training.approve");
    // Returns a single JSON object (the published material row).
    const { data, error } = await this.client.rpc(
      "approve_delegation_material",
      {
        p_assignment_id: assignmentId,
        p_content: JSON.parse(
          JSON.stringify({ ...content, generatedMark: DIGITAL_RECORD_MARK }),
        ),
      },
    );
    throwIf(error, "Could not approve that training material.");
    if (!data) throw new Error("Training material not found.");
    const material = mapDelegationTrainingMaterial(
      data as Record<string, unknown>,
    );
    const contentName =
      material.publishedContent?.templateName ?? "delegation training";
    await this.audit(
      session,
      "delegation.published",
      `${session.fullName} published ${contentName}.`,
      "delegation_assignment",
      assignmentId,
    );
    return material;
  }

  async openDelegationMaterial(
    assignmentId: string,
  ): Promise<DelegationAcknowledgment> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.acknowledge");
    const { error } = await this.client.rpc("open_delegation_material", {
      p_assignment_id: assignmentId,
    });
    throwIf(error, "Could not open the training material.");
    const row = await this.myDelegationAckRow(session, assignmentId);
    if (!row) throw new Error("Could not open the training material.");
    return { ...mapDelegationAcknowledgment(row), staffName: session.fullName };
  }

  async getMyDelegationAck(
    assignmentId: string,
  ): Promise<DelegationAcknowledgment | null> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.acknowledge");
    const row = await this.myDelegationAckRow(session, assignmentId);
    if (!row) return null;
    return { ...mapDelegationAcknowledgment(row), staffName: session.fullName };
  }

  async signDelegationAcknowledgment(
    assignmentId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<DelegationAcknowledgment> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.acknowledge");
    // Returns a single JSON object (the caller's acknowledgment row).
    const { data, error } = await this.client.rpc("sign_delegation_ack", {
      p_assignment_id: assignmentId,
      p_signature_name: signatureName,
      p_signature_mark: signatureMark,
    });
    throwIf(error, "Could not sign that acknowledgment.");
    if (!data) throw new Error("Acknowledgment not found.");
    const ack = {
      ...mapDelegationAcknowledgment(data as Record<string, unknown>),
      staffName: session.fullName,
    };
    await this.audit(
      session,
      "delegation.signed",
      `${session.fullName} signed a delegation acknowledgment.`,
      "delegation_acknowledgment",
      ack.id,
    );
    return ack;
  }

  async listDelegationAckStatus(
    assignmentId: string,
  ): Promise<DelegationAckStatusRow[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "delegation.templates.view");
    // Assignment lookup (RLS scopes to the caller's own sites).
    const { data: assignmentData, error: assignmentError } = await this.client
      .from("individual_delegation_assignments")
      .select("id, agency_id, site_id")
      .eq("id", assignmentId)
      .maybeSingle();
    throwIf(assignmentError, "Could not load the delegation assignment.");
    if (!assignmentData) throw new Error("Delegation assignment not found.");
    const siteId = (assignmentData as Record<string, unknown>)
      .site_id as string;
    // Roster rule (mirrors the local layer): reviewers, approvers, or
    // activators may view; otherwise only a house manager of the site.
    const mayView =
      hasPermission(session, "delegation.training.review") ||
      hasPermission(session, "delegation.training.approve") ||
      hasPermission(session, "delegation.activate") ||
      (await this.isHouseManagerAtSite(session, siteId));
    if (!mayView) {
      throw new Error("You do not have permission to do that.");
    }
    // Publication timestamp drives overdue. Reviewers can read the row;
    // everyone else goes through the published-only RPC.
    let approvedAt: string | null = null;
    const canReview =
      hasPermission(session, "delegation.training.review") ||
      hasPermission(session, "delegation.training.approve");
    if (canReview) {
      const { data, error } = await this.client
        .from("delegation_training_materials")
        .select("approved_at")
        .eq("assignment_id", assignmentId)
        .maybeSingle();
      throwIf(error, "Could not load the training material.");
      approvedAt =
        ((data as Record<string, unknown> | null)?.approved_at as string) ??
        null;
    } else {
      const { data, error } = await this.client.rpc(
        "get_published_training_material",
        { p_assignment_id: assignmentId },
      );
      throwIf(error, "Could not load the training material.");
      approvedAt =
        ((data as Record<string, unknown> | null)?.approvedAt as string) ??
        null;
    }
    // Roster: active memberships at the site (agency-wide members included),
    // acknowledgments read through the RLS roster-viewer policy.
    const today = new Date().toISOString().slice(0, 10);
    const { data: membershipData, error: membershipError } = await this.client
      .from("memberships")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .or(`site_id.eq.${siteId},site_id.is.null`)
      .or(`expires_on.is.null,expires_on.gte.${today}`);
    throwIf(membershipError, "Could not load the site roster.");
    const userIds = [
      ...new Set(
        ((membershipData ?? []) as Record<string, unknown>[]).map(
          (m) => m.user_id as string,
        ),
      ),
    ];
    const { data: ackData, error: ackError } = await this.client
      .from("delegation_acknowledgments")
      .select(
        "staff_id, opened_at, signed_at, signature_name, signature_mark",
      )
      .eq("assignment_id", assignmentId);
    throwIf(ackError, "Could not load acknowledgments.");
    const ackByStaff = new Map(
      ((ackData ?? []) as Record<string, unknown>[]).map((r) => [
        r.staff_id as string,
        r,
      ]),
    );
    const names = await this.profileNames(userIds);
    return userIds.map((userId) => {
      const ack = ackByStaff.get(userId);
      return {
        staffId: userId,
        staffName: names.get(userId) ?? "Staff member",
        openedAt: (ack?.opened_at as string) ?? null,
        signedAt: (ack?.signed_at as string) ?? null,
        overdue: isAcknowledgmentOverdue(
          (ack?.signed_at as string) ?? null,
          approvedAt,
        ),
      };
    });
  }

  async sweepDelegationAckOverdue(): Promise<number> {
    const session = await this.requireSession();
    if (
      !hasPermission(session, "delegation.training.review") &&
      !hasPermission(session, "delegation.activate")
    ) {
      throw new Error("You do not have permission to do that.");
    }
    const { data, error } = await this.client.rpc(
      "sweep_delegation_ack_overdue",
    );
    throwIf(error, "Could not sweep overdue acknowledgments.");
    return Number(data ?? 0);
  }

  // ================= QA audits (hosted) =================

  /** HMs are scoped to their own site; admins/auditors/PMs see the agency. */
  private qaSiteFilter<T>(
    session: SessionUser,
    query: T,
    siteColumn: string,
  ): T {
    if (session.roleKey === "house_manager" && session.siteId) {
      // Supabase query builder: narrow via eq on the site column.
      return (query as { eq: (c: string, v: string) => T }).eq(
        siteColumn,
        session.siteId,
      );
    }
    return query;
  }

  /** Proof context for the five approved auto-verification mappings (hosted). */
  private async qaAutoContext(
    session: SessionUser,
    siteId: string,
    year: number,
    quarter: number,
  ): Promise<QaAutoVerifyContext> {
    const months = qaQuarterMonths(year, quarter);
    const agencyId = session.agencyId;
    const [
      drillsRes,
      tripsRes,
      packetsRes,
      rowsRes,
      assignmentsRes,
      acksRes,
      reportsRes,
    ] = await Promise.all([
      this.client
        .from("emergency_drills")
        .select("id, agency_id, site_id, month_key, drill_type, date, time, evac_time, leader_name, participants, awake_or_sleep")
        .eq("agency_id", agencyId)
        .eq("site_id", siteId)
        .in("month_key", months),
      this.client
        .from("mileage_trips")
        .select("site_id, trip_date")
        .eq("agency_id", agencyId)
        .eq("site_id", siteId)
        .gte("trip_date", `${months[0]}-01`)
        .lt("trip_date", new Date(Date.UTC(year, quarter * 3, 1)).toISOString().slice(0, 10)),
      this.client
        .from("acknowledgment_packets")
        .select("id, individual_id, starts_on")
        .eq("agency_id", agencyId)
        .gte("starts_on", `${year}-01-01`)
        .lt("starts_on", `${year + 1}-01-01`),
      this.client
        .from("acknowledgment_rows")
        .select("packet_id, staff_name, signed_at")
        .eq("agency_id", agencyId),
      this.client
        .from("individual_delegation_assignments")
        .select("id, individual_id, status")
        .eq("agency_id", agencyId)
        .eq("status", "assigned"),
      this.client
        .from("delegation_acknowledgments")
        .select("assignment_id, signed_at")
        .eq("agency_id", agencyId),
      this.client
        .from("home_safety_reports")
        .select("site_id, month_key, lines")
        .eq("agency_id", agencyId)
        .eq("site_id", siteId)
        .in("month_key", months),
    ]);
    for (const [res, label] of [
      [drillsRes, "drills"],
      [tripsRes, "trips"],
      [packetsRes, "packets"],
      [rowsRes, "rows"],
      [assignmentsRes, "assignments"],
      [acksRes, "acks"],
      [reportsRes, "reports"],
    ] as const) {
      throwIf(res.error, `Could not load ${label} for auto-verification.`);
    }
    const drills = ((drillsRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
      id: String(d.id),
      agencyId: String(d.agency_id),
      siteId: String(d.site_id),
      monthKey: String(d.month_key),
      drillType: String(d.drill_type) as QaAutoVerifyContext["drills"][number]["drillType"],
      date: (d.date as string) ?? null,
      time: (d.time as string) ?? null,
      evacTime: (d.evac_time as string) ?? null,
      leaderName: (d.leader_name as string) ?? null,
      participants: String(d.participants ?? ""),
      awakeOrSleep: (d.awake_or_sleep as "awake" | "sleep" | "") ?? "",
    }));
    const rowsByPacket = new Map<string, { staffName: string; signedAt: string | null }[]>();
    for (const r of (rowsRes.data ?? []) as Record<string, unknown>[]) {
      const list = rowsByPacket.get(String(r.packet_id)) ?? [];
      list.push({ staffName: String(r.staff_name), signedAt: (r.signed_at as string) ?? null });
      rowsByPacket.set(String(r.packet_id), list);
    }
    const acksByAssignment = new Map<string, { signedAt: string | null }[]>();
    for (const k of (acksRes.data ?? []) as Record<string, unknown>[]) {
      const list = acksByAssignment.get(String(k.assignment_id)) ?? [];
      list.push({ signedAt: (k.signed_at as string) ?? null });
      acksByAssignment.set(String(k.assignment_id), list);
    }
    return {
      siteId,
      months,
      auditYear: year,
      drills,
      trips: ((tripsRes.data ?? []) as Record<string, unknown>[]).map((t) => ({
        siteId: String(t.site_id),
        date: String(t.trip_date),
      })),
      packets: ((packetsRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
        individualId: String(p.individual_id),
        startsOn: String(p.starts_on),
        rows: rowsByPacket.get(String(p.id)) ?? [],
      })),
      assignments: ((assignmentsRes.data ?? []) as Record<string, unknown>[]).map((a) => ({
        individualId: String(a.individual_id),
        status: String(a.status),
        acks: acksByAssignment.get(String(a.id)) ?? [],
      })),
      safetyReports: ((reportsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        siteId: String(r.site_id),
        monthKey: String(r.month_key),
        lines: (Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]) : []).map((l) => ({
          dateChecked: (l.dateChecked as string) ?? (l.date_checked as string) ?? null,
        })),
      })),
    };
  }

  private async qaAuditRowOrThrow(
    session: SessionUser,
    auditId: string,
  ): Promise<QaAudit> {
    let query = this.client.from("qa_audits").select("*").eq("id", auditId);
    query = this.qaSiteFilter(session, query, "site_id");
    const { data, error } = await query.maybeSingle();
    throwIf(error, "Could not load that QA audit.");
    if (!data) throw new Error("QA audit not found.");
    const audit = mapQaAuditRow(data as Record<string, unknown>);
    if (audit.agencyId !== session.agencyId) throw new Error("QA audit not found.");
    return audit;
  }

  private async qaItemRowOrThrow(
    audit: QaAudit,
    itemKey: string,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.client
      .from("qa_audit_items")
      .select("*")
      .eq("audit_id", audit.id)
      .eq("item_key", itemKey)
      .maybeSingle();
    throwIf(error, "Could not load that QA audit item.");
    if (!data) throw new Error("QA audit item not found.");
    return data as Record<string, unknown>;
  }

  async createQaAudit(siteId: string, year: number, quarter: number): Promise<QaAudit> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.audit");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== siteId) {
      throw new Error("You do not have permission to do that.");
    }
    if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      throw new Error("That quarter is not valid.");
    }
    const { data: existing, error: existingError } = await this.client
      .from("qa_audits")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .eq("year", year)
      .eq("quarter", quarter)
      .maybeSingle();
    throwIf(existingError, "Could not load existing QA audits.");
    if (existing) return mapQaAuditRow(existing as Record<string, unknown>);

    const { data: individuals, error: individualsError } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(individualsError, "Could not load individuals for that site.");

    const ctx = await this.qaAutoContext(session, siteId, year, quarter);
    const items = expandAndVerifyQaItems(
      ((individuals ?? []) as Record<string, unknown>[]).map((p) => ({
        id: String(p.id),
        fullName: String(p.full_name),
      })),
      ctx,
    );

    const { data: auditRow, error: auditError } = await this.client
      .from("qa_audits")
      .insert({
        agency_id: session.agencyId,
        site_id: siteId,
        year,
        quarter,
        status: "in_progress",
        auditor_id: session.userId,
        auditor_name: session.fullName,
      })
      .select("*")
      .single();
    throwIf(auditError, "Could not create that QA audit.");
    const audit = mapQaAuditRow(auditRow as Record<string, unknown>);

    const { error: itemsError } = await this.client.from("qa_audit_items").insert(
      items.map((item) => qaAuditItemToRow(audit.id, session.agencyId, item)),
    );
    throwIf(itemsError, "Could not create the QA audit items.");
    return audit;
  }

  async listQaAudits(filter?: { siteId?: string; year?: number; quarter?: number }): Promise<QaAudit[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    let query = this.client
      .from("qa_audits")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("year", { ascending: false })
      .order("quarter", { ascending: false });
    if (filter?.siteId) query = query.eq("site_id", filter.siteId);
    if (filter?.year) query = query.eq("year", filter.year);
    if (filter?.quarter) query = query.eq("quarter", filter.quarter);
    query = this.qaSiteFilter(session, query, "site_id");
    const { data, error } = await query;
    throwIf(error, "Could not load QA audits.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapQaAuditRow);
  }

  async getQaAudit(id: string): Promise<QaAudit | null> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    let query = this.client.from("qa_audits").select("*").eq("id", id);
    query = this.qaSiteFilter(session, query, "site_id");
    const { data, error } = await query.maybeSingle();
    throwIf(error, "Could not load that QA audit.");
    if (!data) return null;
    const audit = mapQaAuditRow(data as Record<string, unknown>);
    return audit.agencyId === session.agencyId ? audit : null;
  }

  async getQaAuditItems(auditId: string): Promise<QaAuditItemState[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    const audit = await this.qaAuditRowOrThrow(session, auditId);
    const { data, error } = await this.client
      .from("qa_audit_items")
      .select("*")
      .eq("audit_id", audit.id)
      .order("item_key");
    throwIf(error, "Could not load QA audit items.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapQaAuditItemRow);
  }

  private async qaRefreshFinalizedScore(audit: QaAudit): Promise<QaAudit> {
    const items = await this.getQaAuditItems(audit.id);
    const score = scoreQaAudit(items);
    const { data, error } = await this.client
      .from("qa_audits")
      .update({ score })
      .eq("id", audit.id)
      .select("*")
      .single();
    throwIf(error, "Could not update the QA audit score.");
    return mapQaAuditRow(data as Record<string, unknown>);
  }

  async scoreQaItem(
    auditId: string,
    itemKey: string,
    result: "yes" | "no" | "na" | "skipped",
    comment: string,
  ): Promise<QaAuditItemState> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.audit");
    const audit = await this.qaAuditRowOrThrow(session, auditId);
    if (audit.status === "finalized") {
      throw new Error("That audit is finalized — it can no longer be scored.");
    }
    const row = await this.qaItemRowOrThrow(audit, itemKey);
    // Client-side precheck gives the clear error; RLS + state machine enforce it.
    if (result === "no") recheckQaItemForScoring(mapQaAuditItemRow(row), await this.qaAutoContext(session, audit.siteId, audit.year, audit.quarter));
    const updated = scoreQaItemState(
      mapQaAuditItemRow(row),
      result,
      comment,
      session.userId,
      session.fullName || "Auditor",
    );
    const { data, error } = await this.client
      .from("qa_audit_items")
      .update(qaAuditItemToRow(audit.id, session.agencyId, updated))
      .eq("id", row.id)
      .select("*")
      .single();
    throwIf(error, "Could not save that score.");
    return mapQaAuditItemRow(data as Record<string, unknown>);
  }

  async finalizeQaAudit(
    auditId: string,
    signature: { name: string; mark: string },
  ): Promise<QaAudit> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.audit");
    const audit = await this.qaAuditRowOrThrow(session, auditId);
    if (audit.status === "finalized") {
      throw new Error("That audit is already finalized.");
    }
    const items = await this.getQaAuditItems(audit.id);
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
    const { data, error } = await this.client
      .from("qa_audits")
      .update({
        status: "finalized",
        auditor_signature_name: signature.name.trim(),
        auditor_signature_mark: signature.mark.trim(),
        signed_at: now,
        score: scoreQaAudit(items),
      })
      .eq("id", audit.id)
      .select("*")
      .single();
    throwIf(error, "Could not finalize that QA audit.");
    const finalized = mapQaAuditRow(data as Record<string, unknown>);
    // Roll the site's schedule forward one quarter.
    const { data: schedule } = await this.client
      .from("qa_schedules")
      .select("id, next_due")
      .eq("agency_id", session.agencyId)
      .eq("site_id", audit.siteId)
      .eq("active", true)
      .maybeSingle();
    if (schedule) {
      await this.client
        .from("qa_schedules")
        .update({ next_due: nextQaDueDate(String((schedule as Record<string, unknown>).next_due)) })
        .eq("id", String((schedule as Record<string, unknown>).id));
    }
    return finalized;
  }

  async raiseQaDispute(
    auditId: string,
    itemKey: string,
    note: string,
    photos: QaPhotoInput[],
  ): Promise<QaAuditItemState> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.dispute");
    const audit = await this.qaAuditRowOrThrow(session, auditId);
    const row = await this.qaItemRowOrThrow(audit, itemKey);
    // Client prechecks give clear errors; the RPC re-validates + notifies.
    raiseQaDisputeState(
      mapQaAuditItemRow(row),
      note,
      photos,
      session.userId,
      session.fullName || "Staff",
    );
    const { data, error } = await this.client.rpc("raise_qa_dispute", {
      p_item_id: row.id,
      p_note: note,
      p_photos: photos,
    });
    throwIf(error, "Could not raise that dispute.");
    return mapQaAuditItemRow(data as Record<string, unknown>);
  }

  async resolveQaDispute(
    auditId: string,
    itemKey: string,
    approved: boolean,
    reason: string,
  ): Promise<QaAuditItemState> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.audit");
    const audit = await this.qaAuditRowOrThrow(session, auditId);
    const row = await this.qaItemRowOrThrow(audit, itemKey);
    resolveQaDisputeState(
      mapQaAuditItemRow(row),
      approved,
      reason,
      session.userId,
      session.fullName || "Auditor",
    );
    const { data, error } = await this.client.rpc("resolve_qa_dispute", {
      p_item_id: row.id,
      p_approved: approved,
      p_reason: reason,
    });
    throwIf(error, "Could not resolve that dispute.");
    const resolved = mapQaAuditItemRow(data as Record<string, unknown>);
    if (audit.status === "finalized") {
      await this.qaRefreshFinalizedScore(audit);
    }
    return resolved;
  }

  async listQaSchedules(filter?: { siteId?: string }): Promise<QaAuditSchedule[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    let query = this.client
      .from("qa_schedules")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("next_due", { ascending: true });
    if (filter?.siteId) query = query.eq("site_id", filter.siteId);
    query = this.qaSiteFilter(session, query, "site_id");
    const { data, error } = await query;
    throwIf(error, "Could not load QA schedules.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapQaScheduleRow);
  }

  async upsertQaSchedule(input: {
    siteId: string;
    nextDue: string;
    assignedAuditorId?: string | null;
    assignedAuditorName?: string | null;
  }): Promise<QaAuditSchedule> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.schedule");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== input.siteId) {
      throw new Error("You do not have permission to do that.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextDue)) {
      throw new Error("The due date must be a calendar date.");
    }
    const { data, error } = await this.client
      .from("qa_schedules")
      .upsert(
        {
          agency_id: session.agencyId,
          site_id: input.siteId,
          next_due: input.nextDue,
          assigned_auditor_id: input.assignedAuditorId ?? null,
          assigned_auditor_name: input.assignedAuditorName ?? null,
          active: true,
        },
        { onConflict: "agency_id,site_id" },
      )
      .select("*")
      .single();
    throwIf(error, "Could not save that QA schedule.");
    return mapQaScheduleRow(data as Record<string, unknown>);
  }

  async sweepQaScheduleReminders(): Promise<number> {
    const session = await this.requireSession();
    this.requirePermission(session, "qa.schedule");
    const { data, error } = await this.client.rpc("sweep_qa_schedule_reminders");
    throwIf(error, "Could not sweep QA schedule reminders.");
    return Number(data ?? 0);
  }

  async getQaSiteRanking(): Promise<QaRankedSite[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    let sitesQuery = this.client
      .from("sites")
      .select("id, name")
      .eq("agency_id", session.agencyId)
      .order("name");
    sitesQuery = this.qaSiteFilter(session, sitesQuery, "id");
    const { data: sites, error: sitesError } = await sitesQuery;
    throwIf(sitesError, "Could not load program sites.");
    let auditsQuery = this.client
      .from("qa_audits")
      .select("id, site_id, year, quarter, status, signed_at, score")
      .eq("agency_id", session.agencyId)
      .eq("status", "finalized");
    auditsQuery = this.qaSiteFilter(session, auditsQuery, "site_id");
    const { data: audits, error: auditsError } = await auditsQuery;
    throwIf(auditsError, "Could not load QA audits.");
    const bySite = new Map<string, QaAudit[]>();
    for (const row of (audits ?? []) as Record<string, unknown>[]) {
      const audit = mapQaAuditRow(row);
      const list = bySite.get(audit.siteId) ?? [];
      list.push(audit);
      bySite.set(audit.siteId, list);
    }
    const inputs = ((sites ?? []) as Record<string, unknown>[]).map((s) => {
      const siteAudits = (bySite.get(String(s.id)) ?? []).sort(
        (a, b) => b.year - a.year || b.quarter - a.quarter,
      );
      const latest = siteAudits[0] ?? null;
      const previous = siteAudits[1] ?? null;
      return {
        siteId: String(s.id),
        siteName: String(s.name),
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
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== siteId) {
      throw new Error("You do not have permission to do that.");
    }
    const { data, error } = await this.client
      .from("qa_audits")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .eq("status", "finalized")
      .order("year", { ascending: false })
      .order("quarter", { ascending: false });
    throwIf(error, "Could not load QA audit history.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapQaAuditRow);
  }

  /** The caller's own acknowledgment row for one assignment (or null). */
  private async myDelegationAckRow(
    session: SessionUser,
    assignmentId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.client
      .from("delegation_acknowledgments")
      .select(
        "id, agency_id, assignment_id, staff_id, opened_at, signed_at, signature_name, signature_mark",
      )
      .eq("assignment_id", assignmentId)
      .eq("staff_id", session.userId)
      .maybeSingle();
    throwIf(error, "Could not load your acknowledgment.");
    return data ? (data as Record<string, unknown>) : null;
  }

  /** True when the caller holds a house_manager membership at the site. */
  private async isHouseManagerAtSite(
    session: SessionUser,
    siteId: string,
  ): Promise<boolean> {
    const { data } = await this.client
      .from("memberships")
      .select("role_key, role")
      .eq("user_id", session.userId)
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    return ((data ?? []) as Record<string, unknown>[]).some(
      (m) => String(m.role_key ?? m.role) === "house_manager",
    );
  }

  /** Batch full_name lookup for a set of user ids. */
  private async profileNames(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const names = new Map<string, string>();
    if (!unique.length) return names;
    const { data, error } = await this.client
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    throwIf(error, "Could not load staff names.");
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      names.set(row.id as string, (row.full_name as string) ?? "Staff member");
    }
    return names;
  }

  /** Activation rows -> domain, enriched with template + site names. */
  private async mapDelegationActivations(
    rows: Record<string, unknown>[],
  ): Promise<SiteDelegationActivation[]> {
    const templateIds = rows.map((r) => r.template_id as string);
    const siteIds = rows.map((r) => r.site_id as string);
    const templates = await this.delegationTemplateNames(templateIds);
    const sites = await this.delegationSiteNames(siteIds);
    return rows.map((row) => {
      const template = templates.get(row.template_id as string);
      return {
        id: row.id as string,
        agencyId: row.agency_id as string,
        templateId: row.template_id as string,
        templateName: template?.name ?? "Unknown template",
        templateCategory: (template?.category ??
          "Health monitoring") as DelegationTemplateCategory,
        siteId: row.site_id as string,
        siteName: sites.get(row.site_id as string) ?? "Unknown site",
        status: row.status as SiteDelegationActivation["status"],
        activatedAt: row.activated_at as string,
        activatedBy: (row.activated_by as string) ?? "",
      };
    });
  }

  /** Assignment rows -> domain, enriched with template/individual/site names. */
  private async mapDelegationAssignments(
    rows: Record<string, unknown>[],
  ): Promise<IndividualDelegationAssignment[]> {
    const templateIds = rows.map((r) => r.template_id as string);
    const individualIds = rows.map((r) => r.individual_id as string);
    const siteIds = rows.map((r) => r.site_id as string);
    const templates = await this.delegationTemplateNames(templateIds);
    const individuals = await this.delegationIndividualNames(individualIds);
    const sites = await this.delegationSiteNames(siteIds);
    return rows.map((row) => {
      const template = templates.get(row.template_id as string);
      return {
        id: row.id as string,
        agencyId: row.agency_id as string,
        activationId: row.activation_id as string,
        templateId: row.template_id as string,
        templateName: template?.name ?? "Unknown template",
        individualId: row.individual_id as string,
        individualName:
          individuals.get(row.individual_id as string) ?? "Unknown individual",
        siteId: row.site_id as string,
        siteName: sites.get(row.site_id as string) ?? "Unknown site",
        status: row.status as IndividualDelegationAssignment["status"],
        assignedAt: row.assigned_at as string,
        assignedBy: (row.assigned_by as string) ?? "",
      };
    });
  }

  private async delegationTemplateNames(
    templateIds: string[],
  ): Promise<Map<string, { name: string; category: string }>> {
    const unique = [...new Set(templateIds)].filter(Boolean);
    const map = new Map<string, { name: string; category: string }>();
    if (!unique.length) return map;
    const { data, error } = await this.client
      .from("delegation_templates")
      .select("id, name, category")
      .in("id", unique);
    throwIf(error, "Could not load delegation templates.");
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      map.set(row.id as string, {
        name: row.name as string,
        category: row.category as string,
      });
    }
    return map;
  }

  private async delegationIndividualNames(
    individualIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(individualIds)].filter(Boolean);
    const map = new Map<string, string>();
    if (!unique.length) return map;
    const { data, error } = await this.client
      .from("individuals")
      .select("id, full_name")
      .in("id", unique);
    throwIf(error, "Could not load individual names.");
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      map.set(row.id as string, (row.full_name as string) ?? "Unknown");
    }
    return map;
  }

  private async delegationSiteNames(
    siteIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(siteIds)].filter(Boolean);
    const map = new Map<string, string>();
    if (!unique.length) return map;
    const { data, error } = await this.client
      .from("sites")
      .select("id, name")
      .in("id", unique);
    throwIf(error, "Could not load site names.");
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      map.set(row.id as string, (row.name as string) ?? "Unknown site");
    }
    return map;
  }
  // ===== LIFEPATH-P4 HOSTED (certificates) =====
  // LIFEPATH-P4 (certificates): HR certificate tracking (HostedApi, Supabase).
  // Storage bucket is `staff-certificates` (created by the Phase 4 migration);
  // file paths look like `agency/<agencyId>/certs/<certId>/<file>`.

  private requireCertificateWrite(session: SessionUser) {
    this.requirePermission(session, "certificates.manage");
  }

  private requireCertificateRead(session: SessionUser) {
    if (
      !hasPermission(session, "certificates.manage") &&
      !hasPermission(session, "hr.view_staff")
    ) {
      throw new Error("You do not have permission to do that.");
    }
  }

  private mapCertificate(row: Record<string, unknown>): StaffCertificate {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      userId: row.user_id as string,
      certName: row.cert_name as string,
      issuedOn: String(row.issued_on).slice(0, 10),
      expiresOn: String(row.expires_on).slice(0, 10),
      filePath: (row.storage_path as string) ?? null,
      fileName: (row.file_name as string) ?? null,
      enteredBy: row.entered_by as string,
      createdAt: row.created_at as string,
    };
  }

  private async fetchCertificateRow(session: SessionUser, id: string) {
    const { data, error } = await this.client
      .from("staff_certificates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the certificate.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Certificate not found.");
    }
    return data as Record<string, unknown>;
  }

  async listCertificates(userId: string): Promise<StaffCertificate[]> {
    const session = await this.requireSession();
    this.requireCertificateRead(session);
    const { data, error } = await this.client
      .from("staff_certificates")
      .select("*")
      .eq("user_id", userId)
      .order("expires_on", { ascending: true });
    throwIf(error, "Could not load certificates.");
    return (data ?? []).map((row) => this.mapCertificate(row as Record<string, unknown>));
  }

  async addCertificate(input: AddCertificateInput): Promise<StaffCertificate> {
    const session = await this.requireSession();
    this.requireCertificateWrite(session);
    const certName = input.certName.trim();
    if (!certName) throw new Error("Enter the certificate name.");
    validateCertificateDates(input.issuedOn, input.expiresOn);
    const { data: profile, error: profileError } = await this.client
      .from("profiles")
      .select("id")
      .eq("id", input.userId)
      .eq("home_agency_id", session.agencyId)
      .maybeSingle();
    throwIf(profileError, "Could not verify the staff member.");
    if (!profile) throw new Error("Staff member not found.");
    const { data, error } = await this.client
      .from("staff_certificates")
      .insert({
        agency_id: session.agencyId,
        user_id: input.userId,
        cert_name: certName,
        issued_on: input.issuedOn,
        expires_on: input.expiresOn,
        entered_by: session.userId,
      })
      .select("*")
      .single();
    throwIf(error, "Could not save the certificate.");
    const cert = this.mapCertificate(data as Record<string, unknown>);
    await this.audit(
      session,
      "certificate.added",
      `${cert.certName} recorded (renews ${cert.expiresOn})`,
      "certificate",
      cert.id,
    );
    return cert;
  }

  async uploadCertificateFile(
    input: UploadCertificateFileInput,
  ): Promise<StaffCertificate> {
    const session = await this.requireSession();
    this.requireCertificateWrite(session);
    validateCertificateFile(input.file);
    const cert = await this.addCertificate({
      userId: input.userId,
      certName: input.certName,
      issuedOn: input.issuedOn,
      expiresOn: input.expiresOn,
    });
    const safeName = input.file.name.replace(/[^\w.\-]+/g, "_") || "certificate.pdf";
    const storagePath = `agency/${session.agencyId}/certs/${cert.id}/${safeName}`;
    const { error: uploadError } = await this.client.storage
      .from("staff-certificates")
      .upload(storagePath, input.file, {
        contentType: input.file.type || "application/pdf",
        upsert: false,
      });
    if (uploadError) {
      await this.client.from("staff_certificates").delete().eq("id", cert.id);
      throw new Error(uploadError.message || "Could not store the certificate file.");
    }
    const { data, error } = await this.client
      .from("staff_certificates")
      .update({ storage_path: storagePath, file_name: input.file.name })
      .eq("id", cert.id)
      .select("*")
      .single();
    throwIf(error, "Could not link the certificate file.");
    const linked = this.mapCertificate(data as Record<string, unknown>);
    await this.audit(
      session,
      "certificate.uploaded",
      `Certificate file uploaded for ${linked.certName}`,
      "certificate",
      linked.id,
    );
    return linked;
  }

  async updateCertificate(
    id: string,
    input: UpdateCertificateInput,
  ): Promise<StaffCertificate> {
    const session = await this.requireSession();
    this.requireCertificateWrite(session);
    const current = this.mapCertificate(await this.fetchCertificateRow(session, id));
    const certName = input.certName?.trim() ?? current.certName;
    if (!certName) throw new Error("Enter the certificate name.");
    const issuedOn = input.issuedOn ?? current.issuedOn;
    const expiresOn = input.expiresOn ?? current.expiresOn;
    validateCertificateDates(issuedOn, expiresOn);
    const { data, error } = await this.client
      .from("staff_certificates")
      .update({ cert_name: certName, issued_on: issuedOn, expires_on: expiresOn })
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "Could not update the certificate.");
    const updated = this.mapCertificate(data as Record<string, unknown>);
    await this.audit(
      session,
      "certificate.updated",
      `${updated.certName} updated (renews ${updated.expiresOn})`,
      "certificate",
      updated.id,
    );
    return updated;
  }

  async deleteCertificate(id: string): Promise<void> {
    const session = await this.requireSession();
    this.requireCertificateWrite(session);
    const row = await this.fetchCertificateRow(session, id);
    const cert = this.mapCertificate(row);
    if (cert.filePath) {
      await this.client.storage.from("staff-certificates").remove([cert.filePath]);
    }
    const { error } = await this.client.from("staff_certificates").delete().eq("id", id);
    throwIf(error, "Could not delete the certificate.");
    await this.audit(
      session,
      "certificate.deleted",
      `${cert.certName} removed`,
      "certificate",
      cert.id,
    );
  }

  async certificatesExpiringSoon(days: number): Promise<ExpiringCertificate[]> {
    const session = await this.requireSession();
    this.requireCertificateRead(session);
    const today = todayIso();
    const { data, error } = await this.client
      .from("staff_certificates")
      .select("*, profiles!staff_certificates_user_id_fkey(full_name)")
      .eq("agency_id", session.agencyId)
      .order("expires_on", { ascending: true });
    throwIf(error, "Could not load certificates.");
    const out: ExpiringCertificate[] = [];
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const cert = this.mapCertificate(row);
      const remaining = daysRemaining(cert.expiresOn, today);
      if (remaining > days) continue;
      const profile = row.profiles as { full_name?: string } | null;
      out.push({
        ...cert,
        staffName: profile?.full_name ?? "Unknown staff",
        daysRemaining: remaining,
      });
    }
    return out.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  async certificateFileUrl(id: string): Promise<string> {
    const session = await this.requireSession();
    this.requireCertificateRead(session);
    const cert = this.mapCertificate(await this.fetchCertificateRow(session, id));
    if (!cert.filePath) throw new Error("This certificate has no file attached.");
    const { data, error } = await this.client.storage
      .from("staff-certificates")
      .createSignedUrl(cert.filePath, 300);
    throwIf(error, "Could not open the certificate file.");
    return data!.signedUrl;
  }
  // ===== AUDIT-READINESS HOSTED (corrective actions) =====
  // AUDIT-READINESS: corrective-action workflow (HostedApi, Supabase).
  // Table: public.corrective_actions (migration 20260914070000_audit_readiness.sql).

  private requireCorrectiveActionWrite(session: SessionUser) {
    this.requirePermission(session, "correctiveActions.manage");
  }

  private mapCorrectiveActionRow(row: Record<string, unknown>): CorrectiveAction {
    const action = correctiveActionFromRow(row);
    const profile = row.profiles as { full_name?: string } | null;
    if (profile?.full_name) action.assignedToName = profile.full_name;
    return action;
  }

  private async fetchCorrectiveActionRow(session: SessionUser, id: string) {
    const { data, error } = await this.client
      .from("corrective_actions")
      .select("*, profiles!corrective_actions_assigned_to_user_id_fkey(full_name)")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the corrective action.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Corrective action not found.");
    }
    return data as Record<string, unknown>;
  }

  async listCorrectiveActions(input?: {
    status?: "open" | "in_progress" | "resolved" | "overdue";
    assignedToUserId?: string;
  }): Promise<CorrectiveAction[]> {
    const session = await this.requireSession();
    const now = new Date();
    let query = this.client
      .from("corrective_actions")
      .select("*, profiles!corrective_actions_assigned_to_user_id_fkey(full_name)")
      .eq("agency_id", session.agencyId);
    if (input?.assignedToUserId) {
      query = query.eq("assigned_to_user_id", input.assignedToUserId);
    }
    const { data, error } = await query;
    throwIf(error, "Could not load corrective actions.");
    let rows = (data ?? []).map((row) =>
      this.mapCorrectiveActionRow(row as Record<string, unknown>),
    );
    if (input?.status) {
      rows = rows.filter(
        (row) => deriveCorrectiveActionStatus(row, now) === input.status,
      );
    }
    return sortCorrectiveActions(rows, now);
  }

  async addCorrectiveAction(input: AddCorrectiveActionInput): Promise<CorrectiveAction> {
    const session = await this.requireSession();
    this.requireCorrectiveActionWrite(session);
    const errors = validateCorrectiveActionInput(input);
    if (errors.length > 0) throw new Error(errors[0]);
    if (input.assignedToUserId) {
      const { data: profile, error: profileError } = await this.client
        .from("profiles")
        .select("id")
        .eq("id", input.assignedToUserId)
        .eq("home_agency_id", session.agencyId)
        .maybeSingle();
      throwIf(profileError, "Could not verify the staff member.");
      if (!profile) throw new Error("Staff member not found.");
    }
    const { data, error } = await this.client
      .from("corrective_actions")
      .insert(
        buildCorrectiveActionRow({
          agencyId: session.agencyId,
          createdByUserId: session.userId,
          data: input,
        }),
      )
      .select("*, profiles!corrective_actions_assigned_to_user_id_fkey(full_name)")
      .single();
    throwIf(error, "Could not save the corrective action.");
    const action = this.mapCorrectiveActionRow(data as Record<string, unknown>);
    await this.audit(
      session,
      "corrective_action.added",
      `Corrective action "${action.title}" created${action.assignedToName ? `, assigned to ${action.assignedToName}` : ""}`,
      "corrective_action",
      action.id,
    );
    return action;
  }

  async updateCorrectiveAction(
    id: string,
    input: UpdateCorrectiveActionInput,
  ): Promise<CorrectiveAction> {
    const session = await this.requireSession();
    this.requireCorrectiveActionWrite(session);
    const current = this.mapCorrectiveActionRow(await this.fetchCorrectiveActionRow(session, id));
    const title = input.title?.trim() ?? current.title;
    const dueOn = input.dueOn !== undefined ? input.dueOn?.trim() || null : current.dueOn;
    const errors = validateCorrectiveActionInput({ title, dueOn });
    if (errors.length > 0) throw new Error(errors[0]);
    if (input.assignedToUserId !== undefined && input.assignedToUserId) {
      const { data: profile, error: profileError } = await this.client
        .from("profiles")
        .select("id")
        .eq("id", input.assignedToUserId)
        .eq("home_agency_id", session.agencyId)
        .maybeSingle();
      throwIf(profileError, "Could not verify the staff member.");
      if (!profile) throw new Error("Staff member not found.");
    }
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = title;
    if (input.description !== undefined)
      patch.description = input.description?.trim() ?? "";
    if (input.assignedToUserId !== undefined)
      patch.assigned_to_user_id = input.assignedToUserId;
    if (input.dueOn !== undefined) patch.due_on = dueOn;
    if (input.storedStatus !== undefined) patch.status = input.storedStatus;
    if (input.linkedRiskId !== undefined) patch.linked_risk_id = input.linkedRiskId;
    if (input.linkedRiskSource !== undefined)
      patch.linked_risk_source = input.linkedRiskSource;
    const { data, error } = await this.client
      .from("corrective_actions")
      .update(patch)
      .eq("id", id)
      .select("*, profiles!corrective_actions_assigned_to_user_id_fkey(full_name)")
      .single();
    throwIf(error, "Could not update the corrective action.");
    const updated = this.mapCorrectiveActionRow(data as Record<string, unknown>);
    await this.audit(
      session,
      "corrective_action.updated",
      `Corrective action "${updated.title}" updated`,
      "corrective_action",
      updated.id,
    );
    return updated;
  }

  async resolveCorrectiveAction(id: string): Promise<CorrectiveAction> {
    return this.updateCorrectiveAction(id, { storedStatus: "resolved" });
  }

  // ===== THERAP-CORE-GAPS-1 HOSTED (event reports, behavior, health) =====
  // Tables: public.ger_reports, public.behavior_plans, public.behavior_entries,
  // public.health_track_entries (migration 20261027120000_therap_core_gaps_1.sql).

  /** Emit one incident.followup alert via notify-event; never breaks a mutation. */
  private async emitFollowupAlert(input: {
    session: SessionUser;
    userId: string | null;
    roleKey: string | null;
    title: string;
    body: string;
    individualId: string;
    entityId: string;
    entityType: string;
    dedupeKey: string;
  }): Promise<void> {
    try {
      const { error } = await this.client.functions.invoke("notify-event", {
        body: {
          agency_id: input.session.agencyId,
          user_id: input.userId,
          role_key: input.roleKey,
          type: "incident.followup",
          title: input.title,
          body: input.body,
          deep_link: `/plans/${input.individualId}`,
          entity_type: input.entityType,
          entity_id: input.entityId,
          dedupe_key: input.dedupeKey,
        },
      });
      if (error) {
        console.warn("[notifications] notify-event failed:", error.message);
      }
    } catch (err) {
      console.warn("[notifications] notify-event threw:", err);
    }
  }

  private async houseManagerIdsForSite(
    session: SessionUser,
    siteId: string,
  ): Promise<string[]> {
    const { data, error } = await this.client
      .from("memberships")
      .select("user_id, expires_on")
      .eq("agency_id", session.agencyId)
      .eq("role_key", "house_manager")
      .eq("site_id", siteId);
    if (error) return [];
    const today = new Date().toISOString().slice(0, 10);
    return (data ?? [])
      .filter((row) => {
        const expires = (row as { expires_on?: string | null }).expires_on;
        return !expires || expires >= today;
      })
      .map((row) => (row as { user_id: string }).user_id);
  }

  private async fetchGerReportRow(session: SessionUser, id: string) {
    const { data, error } = await this.client
      .from("ger_reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the event report.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Event report not found.");
    }
    const report = gerReportFromRow(data as Record<string, unknown>);
    // Nurses review across the agency's homes (clinical oversight).
    if (!canAccessSite(session, report.siteId) && session.roleKey !== "nurse") {
      throw new Error("Event report not found.");
    }
    return report;
  }

  async listGerReports(input: { siteId: string }): Promise<GerReport[]> {
    const session = await this.requireSession();
    if (!canViewGerReports(session)) return [];
    if (!canAccessSite(session, input.siteId) && session.roleKey !== "nurse") return [];
    const { data, error } = await this.client
      .from("ger_reports")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", input.siteId);
    throwIf(error, "Could not load event reports.");
    const rows = (data ?? []).map((row) =>
      gerReportFromRow(row as Record<string, unknown>),
    );
    await this.queueGerOverdueAlerts(session, rows);
    return sortGerReports(rows);
  }

  async listAgencyGerReports(): Promise<GerReport[]> {
    const session = await this.requireSession();
    if (!canViewGerReports(session)) return [];
    const { data, error } = await this.client
      .from("ger_reports")
      .select("*")
      .eq("agency_id", session.agencyId)
      .in("status", ["submitted", "approved"]);
    throwIf(error, "Could not load event reports.");
    const rows = (data ?? [])
      .map((row) => gerReportFromRow(row as Record<string, unknown>))
      .filter(
        (row) => canAccessSite(session, row.siteId) || session.roleKey === "nurse",
      );
    await this.queueGerOverdueAlerts(session, rows);
    return sortGerReports(rows);
  }

  /** Overdue follow-ups alert the assigned manager (or HM/PM/nurse set). */
  private async queueGerOverdueAlerts(session: SessionUser, rows: GerReport[]) {
    const today = new Date().toISOString().slice(0, 10);
    for (const report of rows) {
      if (!gerNeedsFollowUp(report)) continue;
      if (!report.resolutionDueOn || report.resolutionDueOn >= today) continue;
      const person = await this.individualRecord(report.individualId);
      const targets = gerSubmitNotificationTargets({
        gerId: `${report.id}:overdue:${report.resolutionDueOn}`,
        houseManagerUserIds: report.assignedManagerUserId
          ? [report.assignedManagerUserId]
          : await this.houseManagerIdsForSite(session, report.siteId),
      });
      await Promise.allSettled(
        targets.map((target) =>
          this.emitFollowupAlert({
            session,
            userId: target.userId,
            roleKey: target.roleKey,
            title: `Event follow-up overdue — ${person?.fullName ?? "An Individual"}`,
            body: `Follow-up on the ${report.eventType} of ${report.eventDate} was due ${report.resolutionDueOn} and is still open.`,
            individualId: report.individualId,
            entityType: "ger_report",
            entityId: report.id,
            dedupeKey: target.dedupeKey,
          }),
        ),
      );
    }
  }

  /**
   * GER site integrity: a report belongs to the home its Individual lives
   * at. Resolve every Individual on the draft to their home so validation
   * can reject a report filed under the wrong home — and its alerts and
   * review queue can never route to the wrong home's managers. The stored
   * row's site always comes from the Individual, never from the caller.
   */
  private async gerSiteContext(session: SessionUser, draft: GerReportDraft) {
    const person = await this.individualRecord(draft.individualId);
    const linkedSiteIds: Record<string, string | null> = {};
    for (const linkedId of draft.linkedIndividualIds ?? []) {
      const linked = await this.individualRecord(linkedId);
      linkedSiteIds[linkedId] =
        linked && linked.agencyId === session.agencyId ? linked.siteId : null;
    }
    return {
      person,
      context: {
        individualSiteId:
          person && person.agencyId === session.agencyId ? person.siteId : null,
        linkedSiteIds,
      },
    };
  }

  async createGerReport(draft: GerReportDraft): Promise<GerReport> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.create");
    const { person, context } = await this.gerSiteContext(session, draft);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const errors = validateGerDraft(draft, context);
    if (errors.length > 0) throw new Error(errors[0]);
    if (!canAccessSite(session, person.siteId) && session.roleKey !== "nurse") {
      throw new Error("You do not have permission to do that.");
    }
    const { data, error } = await this.client
      .from("ger_reports")
      .insert(
        buildGerReportRow({
          agencyId: session.agencyId,
          createdByUserId: session.userId,
          draft: { ...draft, siteId: person.siteId },
          status: "draft",
        }),
      )
      .select("*")
      .single();
    throwIf(error, "Could not save the event report.");
    const report = gerReportFromRow(data as Record<string, unknown>);
    await this.audit(
      session,
      "ger.created",
      `Event report (${report.eventType}) drafted for ${person.fullName}`,
      "ger_report",
      report.id,
    );
    return report;
  }

  async updateGerReport(id: string, draft: GerReportDraft): Promise<GerReport> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.create");
    const report = await this.fetchGerReportRow(session, id);
    if (!canEditGerReportBody(report, session)) {
      throw new Error("Only a draft or returned report can be edited.");
    }
    // Changing the Individual re-derives the home in the same update: the
    // report, its dashboard rows, and its alerts can never point at two
    // different homes.
    const { person, context } = await this.gerSiteContext(session, draft);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    const effectiveDraft = { ...draft, siteId: person.siteId };
    const errors = validateGerDraft(effectiveDraft, context);
    if (errors.length > 0) throw new Error(errors[0]);
    if (!canAccessSite(session, person.siteId) && session.roleKey !== "nurse") {
      throw new Error("You do not have permission to do that.");
    }
    const row = buildGerReportRow({
      agencyId: session.agencyId,
      createdByUserId: report.createdByUserId,
      draft: effectiveDraft,
      status: report.status,
    });
    delete row.agency_id;
    delete row.status;
    delete row.created_by_user_id;
    const { data, error } = await this.client
      .from("ger_reports")
      .update(row)
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "Could not update the event report.");
    return gerReportFromRow(data as Record<string, unknown>);
  }

  async submitGerReport(id: string): Promise<GerReport> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.create");
    const report = await this.fetchGerReportRow(session, id);
    if (report.status === "submitted" || report.status === "approved") {
      throw new Error("This report has already been submitted.");
    }
    if (
      report.createdByUserId !== session.userId &&
      session.permissions["ger.review"] !== true
    ) {
      throw new Error("Only the author or a reviewer can submit this report.");
    }
    const errors = validateGerDraft(report);
    if (errors.length > 0) throw new Error(errors[0]);
    const patch: Record<string, unknown> = { status: "submitted" };
    if (report.resolutionStatus === "resolved") {
      patch.resolution_status = "unaddressed";
      patch.resolved_at = null;
      patch.resolved_by_user_id = null;
    }
    const { data, error } = await this.client
      .from("ger_reports")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "Could not submit the event report.");
    const submitted = gerReportFromRow(data as Record<string, unknown>);
    // Alert the home's HM directly + PM/nurse broadcasts (all severities).
    const person = await this.individualRecord(submitted.individualId);
    const targets = gerSubmitNotificationTargets({
      gerId: submitted.id,
      houseManagerUserIds: await this.houseManagerIdsForSite(
        session,
        submitted.siteId,
      ),
    });
    await Promise.allSettled(
      targets.map((target) =>
        this.emitFollowupAlert({
          session,
          userId: target.userId,
          roleKey: target.roleKey,
          title: `${submitted.severity} event report — ${person?.fullName ?? "An Individual"}`,
          body: `${submitted.eventType} on ${submitted.eventDate} was submitted and needs review and follow-up.`,
          individualId: submitted.individualId,
          entityType: "ger_report",
          entityId: submitted.id,
          dedupeKey: target.dedupeKey,
        }),
      ),
    );
    await this.audit(
      session,
      "ger.submitted",
      `Event report (${submitted.eventType}, ${submitted.severity}) submitted for ${person?.fullName ?? "an Individual"}`,
      "ger_report",
      submitted.id,
    );
    return submitted;
  }

  async reviewGerReport(
    id: string,
    decision: "approved" | "returned",
    note?: string,
  ): Promise<GerReport> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.review");
    const report = await this.fetchGerReportRow(session, id);
    if (!canDecideGerReport(report, session)) {
      throw new Error("Only a submitted report can be reviewed.");
    }
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("ger_reports")
      .update({
        status: decision,
        review_note: (note ?? "").trim(),
        reviewed_by_user_id: session.userId,
        reviewed_at: now,
      })
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "Could not save the review.");
    const reviewed = gerReportFromRow(data as Record<string, unknown>);
    await this.audit(
      session,
      decision === "approved" ? "ger.approved" : "ger.returned",
      `Event report (${reviewed.eventType}) ${decision === "approved" ? "approved" : "returned for corrections"}`,
      "ger_report",
      reviewed.id,
    );
    return reviewed;
  }

  async updateGerResolution(
    id: string,
    patch: GerResolutionPatch,
  ): Promise<GerReport> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.resolve");
    const report = await this.fetchGerReportRow(session, id);
    if (report.status !== "submitted" && report.status !== "approved") {
      throw new Error("Follow-up starts once a report is submitted.");
    }
    const errors = validateGerResolution(patch, report);
    if (errors.length > 0) throw new Error(errors[0]);
    const dbPatch: Record<string, unknown> = {};
    if (patch.resolutionStatus !== undefined) {
      dbPatch.resolution_status = patch.resolutionStatus;
    }
    if (patch.investigationRequired !== undefined) {
      dbPatch.investigation_required = patch.investigationRequired;
    }
    if (patch.investigationNotes !== undefined) {
      dbPatch.investigation_notes = patch.investigationNotes;
    }
    if (patch.assignedManagerUserId !== undefined) {
      dbPatch.assigned_manager_user_id = patch.assignedManagerUserId;
    }
    if (patch.resolutionDueOn !== undefined) {
      dbPatch.resolution_due_on = patch.resolutionDueOn || null;
    }
    if (patch.closureNote !== undefined) dbPatch.closure_note = patch.closureNote;
    const nextStatus = patch.resolutionStatus ?? report.resolutionStatus;
    if (nextStatus === "resolved") {
      dbPatch.resolved_by_user_id = session.userId;
      dbPatch.resolved_at = new Date().toISOString();
    }
    const { data, error } = await this.client
      .from("ger_reports")
      .update(dbPatch)
      .eq("id", id)
      .select("*")
      .single();
    throwIf(error, "Could not update the follow-up.");
    const updated = gerReportFromRow(data as Record<string, unknown>);
    await this.audit(
      session,
      "ger.resolution_updated",
      `Event follow-up updated (${updated.resolutionStatus.replace("_", " ")})`,
      "ger_report",
      updated.id,
    );
    return updated;
  }

  async deleteGerReport(id: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "ger.create");
    const report = await this.fetchGerReportRow(session, id);
    if (report.status !== "draft" || report.createdByUserId !== session.userId) {
      throw new Error("Only your own draft reports can be deleted.");
    }
    const { error } = await this.client.from("ger_reports").delete().eq("id", id);
    throwIf(error, "Could not delete the event report.");
  }

  // ----- Behavior supports (hosted) -----

  private async assertBehaviorIndividual(session: SessionUser, individualId: string) {
    const person = await this.individualRecord(individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found or outside your assigned access.");
    }
    return person;
  }

  async getBehaviorPlan(individualId: string): Promise<BehaviorPlan | null> {
    const session = await this.requireSession();
    if (!canViewBehavior(session)) return null;
    await this.assertBehaviorIndividual(session, individualId);
    const { data, error } = await this.client
      .from("behavior_plans")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .eq("active", true)
      .maybeSingle();
    throwIf(error, "Could not load the behavior plan.");
    return data ? behaviorPlanFromRow(data as Record<string, unknown>) : null;
  }

  async saveBehaviorPlan(
    individualId: string,
    draft: BehaviorPlanDraft,
  ): Promise<BehaviorPlan> {
    const session = await this.requireSession();
    this.requirePermission(session, "behavior.plan");
    if (!canManageBehaviorPlan(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
    await this.assertBehaviorIndividual(session, individualId);
    const errors = validateBehaviorPlanDraft(draft);
    if (errors.length > 0) throw new Error(errors[0]);
    const existing = await this.getBehaviorPlan(individualId);
    if (existing) {
      const { data, error } = await this.client
        .from("behavior_plans")
        .update({
          target_behaviors: draft.targetBehaviors.trim(),
          interventions: draft.interventions.trim(),
          crisis_steps: draft.crisisSteps.trim(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      throwIf(error, "Could not save the behavior plan.");
      return behaviorPlanFromRow(data as Record<string, unknown>);
    }
    const { data, error } = await this.client
      .from("behavior_plans")
      .insert(
        buildBehaviorPlanRow({
          agencyId: session.agencyId,
          individualId,
          createdByUserId: session.userId,
          draft,
        }),
      )
      .select("*")
      .single();
    throwIf(error, "Could not save the behavior plan.");
    return behaviorPlanFromRow(data as Record<string, unknown>);
  }

  async listBehaviorEntries(individualId: string): Promise<BehaviorEntry[]> {
    const session = await this.requireSession();
    if (!canViewBehavior(session)) return [];
    await this.assertBehaviorIndividual(session, individualId);
    const { data, error } = await this.client
      .from("behavior_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("occurred_on", { ascending: false })
      .order("occurred_at_time", { ascending: false });
    throwIf(error, "Could not load behavior records.");
    return (data ?? []).map((row) =>
      behaviorEntryFromRow(row as Record<string, unknown>),
    );
  }

  async addBehaviorEntry(
    individualId: string,
    draft: BehaviorEntryDraft,
  ): Promise<BehaviorEntry> {
    const session = await this.requireSession();
    this.requirePermission(session, "behavior.record");
    if (!canRecordBehavior(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
    await this.assertBehaviorIndividual(session, individualId);
    const errors = validateBehaviorEntryDraft(draft);
    if (errors.length > 0) throw new Error(errors[0]);
    const { data, error } = await this.client
      .from("behavior_entries")
      .insert(
        buildBehaviorEntryRow({
          agencyId: session.agencyId,
          individualId,
          recordedByUserId: session.userId,
          draft,
        }),
      )
      .select("*")
      .single();
    throwIf(error, "Could not save the behavior record.");
    return behaviorEntryFromRow(data as Record<string, unknown>);
  }

  async deleteBehaviorEntry(id: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "behavior.record");
    const { data, error } = await this.client
      .from("behavior_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the behavior record.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Behavior record not found.");
    }
    const entry = behaviorEntryFromRow(data as Record<string, unknown>);
    if (
      entry.recordedByUserId !== session.userId &&
      !canManageBehaviorPlan(session.roleKey)
    ) {
      throw new Error("You can only remove behavior records you recorded.");
    }
    const { error: deleteError } = await this.client
      .from("behavior_entries")
      .delete()
      .eq("id", id);
    throwIf(deleteError, "Could not delete the behavior record.");
  }

  async correctBehaviorEntry(
    id: string,
    draft: BehaviorEntryDraft,
    rationale: string,
  ): Promise<BehaviorEntry> {
    const session = await this.requireSession();
    this.requirePermission(session, "behavior.record");
    const { data, error } = await this.client
      .from("behavior_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the behavior record.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Behavior record not found.");
    }
    const existing = behaviorEntryFromRow(data as Record<string, unknown>);
    if (
      existing.recordedByUserId !== session.userId &&
      !canCorrectBehaviorEntry(session.roleKey)
    ) {
      throw new Error("You can only correct behavior records you recorded.");
    }
    const errors = validateBehaviorCorrection(draft, rationale);
    if (errors.length > 0) throw new Error(errors[0]);
    // The database correction path is the enforcement point: it re-checks
    // the caller's scope, requires the rationale, preserves the replaced
    // version, and writes the immutable history record.
    const { error: rpcError } = await this.client.rpc("correct_behavior_entry", {
      p_entry_id: id,
      p_rationale: rationale.trim(),
      p_occurred_on: draft.occurredOn,
      p_occurred_at_time: draft.occurredAtTime ?? "",
      p_behavior: draft.behavior,
      p_antecedent: draft.antecedent ?? "",
      p_duration_minutes: draft.durationMinutes ?? null,
      p_intensity: draft.intensity,
      p_intervention_used: draft.interventionUsed ?? "",
      p_outcome: draft.outcome ?? "",
    });
    throwIf(rpcError, "Could not save the correction.");
    const { data: updated, error: reloadError } = await this.client
      .from("behavior_entries")
      .select("*")
      .eq("id", id)
      .single();
    throwIf(reloadError, "Could not load the corrected record.");
    return behaviorEntryFromRow(updated as Record<string, unknown>);
  }

  // ----- Health trackers (hosted) -----

  private async emitHealthAlert(session: SessionUser, entry: HealthTrackEntry) {
    const person = await this.individualRecord(entry.individualId);
    const targets = healthAlertTargets({
      entryId: entry.id,
      houseManagerUserIds: person
        ? await this.houseManagerIdsForSite(session, person.siteId)
        : [],
    });
    await Promise.allSettled(
      targets.map((target) =>
        this.emitFollowupAlert({
          session,
          userId: target.userId,
          roleKey: target.roleKey,
          title:
            entry.kind === "immunization"
              ? `Immunization overdue — ${person?.fullName ?? "An Individual"}`
              : `Health alert — ${person?.fullName ?? "An Individual"}`,
          body:
            entry.kind === "immunization"
              ? `${entry.title} was due ${entry.details.nextDueOn ?? ""} and has not been recorded as given.`
              : `${entry.title} on ${entry.occurredOn} needs a manager's attention.`,
          individualId: entry.individualId,
          entityType: "health_track_entry",
          entityId: entry.id,
          dedupeKey: target.dedupeKey,
        }),
      ),
    );
  }

  /** Time-based alert: a finished day with very little fluid alerts once. */
  private async emitLowFluidAlerts(session: SessionUser, individualId: string) {
    const { data, error } = await this.client
      .from("health_track_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .eq("kind", "intake");
    if (error) return;
    const entries = (data ?? []).map((row) =>
      healthTrackEntryFromRow(row as Record<string, unknown>),
    );
    const days = lowFluidDays(entries);
    if (days.length === 0) return;
    const person = await this.individualRecord(individualId);
    const houseManagerUserIds = person
      ? await this.houseManagerIdsForSite(session, person.siteId)
      : [];
    await Promise.allSettled(
      days.flatMap((day) =>
        lowFluidAlertTargets({
          individualId,
          date: day.date,
          houseManagerUserIds,
        }).map((target) =>
          this.emitFollowupAlert({
            session,
            userId: target.userId,
            roleKey: target.roleKey,
            title: `Low fluid intake — ${person?.fullName ?? "An Individual"}`,
            body: `Only ${day.fluidOz} oz of fluids were recorded on ${day.date}. Check in and encourage fluids.`,
            individualId,
            entityType: "health_track_entry",
            entityId: `low-fluid:${individualId}:${day.date}`,
            dedupeKey: target.dedupeKey,
          }),
        ),
      ),
    );
  }

  async listHealthTrackEntries(input: {
    individualId: string;
    kind?: HealthTrackKind;
  }): Promise<HealthTrackEntry[]> {
    const session = await this.requireSession();
    if (!canViewHealthTrack(session)) return [];
    await this.assertBehaviorIndividual(session, input.individualId);
    let query = this.client
      .from("health_track_entries")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", input.individualId);
    if (input.kind) query = query.eq("kind", input.kind);
    const { data, error } = await query.order("occurred_on", {
      ascending: false,
    });
    throwIf(error, "Could not load health records.");
    const rows = (data ?? []).map((row) =>
      healthTrackEntryFromRow(row as Record<string, unknown>),
    );
    for (const row of rows) {
      if (isImmunizationOverdue(row, rows)) await this.emitHealthAlert(session, row);
    }
    // Time-based alert: a finished day with very low fluids alerts once.
    await this.emitLowFluidAlerts(session, input.individualId);
    return rows;
  }

  async addHealthTrackEntry(
    individualId: string,
    draft: HealthTrackEntryDraft,
  ): Promise<HealthTrackEntry> {
    const session = await this.requireSession();
    this.requirePermission(session, "health.record");
    if (!canRecordHealthEntry(session.roleKey)) {
      throw new Error("You do not have permission to do that.");
    }
    await this.assertBehaviorIndividual(session, individualId);
    const errors = validateHealthTrackDraft(draft);
    if (errors.length > 0) throw new Error(errors[0]);
    const { data, error } = await this.client
      .from("health_track_entries")
      .insert(
        buildHealthTrackRow({
          agencyId: session.agencyId,
          individualId,
          recordedByUserId: session.userId,
          draft,
        }),
      )
      .select("*")
      .single();
    throwIf(error, "Could not save the health record.");
    const entry = healthTrackEntryFromRow(data as Record<string, unknown>);
    if (healthEntryNeedsAlert(entry)) await this.emitHealthAlert(session, entry);
    // A backdated intake entry can complete a low-fluid day.
    if (entry.kind === "intake") {
      await this.emitLowFluidAlerts(session, individualId);
    }
    return entry;
  }

  async deleteHealthTrackEntry(id: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "health.record");
    const { data, error } = await this.client
      .from("health_track_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the health record.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Health record not found.");
    }
    const entry = healthTrackEntryFromRow(data as Record<string, unknown>);
    if (
      entry.recordedByUserId !== session.userId &&
      session.permissions["ger.review"] !== true
    ) {
      throw new Error("You can only remove health records you recorded.");
    }
    const { error: deleteError } = await this.client
      .from("health_track_entries")
      .delete()
      .eq("id", id);
    throwIf(deleteError, "Could not delete the health record.");
  }

  async correctHealthTrackEntry(
    id: string,
    draft: HealthTrackEntryDraft,
    rationale: string,
  ): Promise<HealthTrackEntry> {
    const session = await this.requireSession();
    this.requirePermission(session, "health.record");
    const { data, error } = await this.client
      .from("health_track_entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIf(error, "Could not load the health record.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Health record not found.");
    }
    const existing = healthTrackEntryFromRow(data as Record<string, unknown>);
    if (
      existing.recordedByUserId !== session.userId &&
      !canCorrectHealthTrackEntry(session.roleKey)
    ) {
      throw new Error("You can only correct health records you recorded.");
    }
    const errors = validateHealthCorrection(draft, rationale);
    if (errors.length > 0) throw new Error(errors[0]);
    // The database correction path is the enforcement point: it re-checks
    // the caller's scope, requires the rationale, preserves the replaced
    // version, and writes the immutable history record.
    const { error: rpcError } = await this.client.rpc(
      "correct_health_track_entry",
      {
        p_entry_id: id,
        p_rationale: rationale.trim(),
        p_kind: draft.kind,
        p_occurred_on: draft.occurredOn,
        p_title: healthTrackTitle(draft.kind, draft.details ?? {}),
        p_details: draft.details ?? {},
        p_flagged_abnormal: draft.flaggedAbnormal === true,
        p_note: draft.note ?? "",
      },
    );
    throwIf(rpcError, "Could not save the correction.");
    const { data: updated, error: reloadError } = await this.client
      .from("health_track_entries")
      .select("*")
      .eq("id", id)
      .single();
    throwIf(reloadError, "Could not load the corrected record.");
    const entry = healthTrackEntryFromRow(updated as Record<string, unknown>);
    if (healthEntryNeedsAlert(entry)) await this.emitHealthAlert(session, entry);
    return entry;
  }
  // ===== AUDIT-READINESS HOSTED (score snapshots) =====
  // Table: public.compliance_score_snapshots
  // (migration 20260914070000_audit_readiness.sql).

  private mapScoreSnapshot(row: Record<string, unknown>): ScoreSnapshot {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: (row.site_id as string | null) ?? null,
      score: row.score as number,
      band: row.band as ScoreSnapshot["band"],
      breakdown: (row.breakdown as ScoreSnapshot["breakdown"]) ?? {},
      factCount: (row.fact_count as number) ?? 0,
      computedAt: row.computed_at as string,
    };
  }

  async saveComplianceSnapshot(input: {
    siteId?: string | null;
    result: ComplianceScore;
  }): Promise<ScoreSnapshot> {
    const session = await this.requireSession();
    this.requireCorrectiveActionWrite(session);
    const siteId = input.siteId ?? null;
    const today = new Date().toISOString().slice(0, 10);
    // One snapshot per day per scope — replace today's if it exists.
    let existingQuery = this.client
      .from("compliance_score_snapshots")
      .select("id")
      .eq("agency_id", session.agencyId)
      .gte("computed_at", `${today}T00:00:00`)
      .lt("computed_at", `${today}T23:59:59.999`);
    existingQuery = siteId
      ? existingQuery.eq("site_id", siteId)
      : existingQuery.is("site_id", null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    throwIf(existingError, "Could not check today's snapshot.");
    const row = buildScoreSnapshotRow({
      agencyId: session.agencyId,
      siteId,
      result: input.result,
    });
    let saved: Record<string, unknown>;
    if (existing) {
      const { data, error } = await this.client
        .from("compliance_score_snapshots")
        .update(row)
        .eq("id", (existing as Record<string, unknown>).id)
        .select("*")
        .single();
      throwIf(error, "Could not update today's snapshot.");
      saved = data as Record<string, unknown>;
    } else {
      const { data, error } = await this.client
        .from("compliance_score_snapshots")
        .insert(row)
        .select("*")
        .single();
      throwIf(error, "Could not save the snapshot.");
      saved = data as Record<string, unknown>;
    }
    return this.mapScoreSnapshot(saved);
  }

  async listComplianceSnapshots(
    siteId?: string | null,
    limit = 30,
  ): Promise<ScoreSnapshot[]> {
    const session = await this.requireSession();
    const scope = siteId ?? null;
    let query = this.client
      .from("compliance_score_snapshots")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("computed_at", { ascending: true })
      .limit(Math.max(limit, 1));
    query = scope ? query.eq("site_id", scope) : query.is("site_id", null);
    const { data, error } = await query;
    throwIf(error, "Could not load score snapshots.");
    return (data ?? []).map((row) =>
      this.mapScoreSnapshot(row as Record<string, unknown>),
    );
  }
  // ===== LIFEPATH-P5 HOSTED (HM weekly checklist) =====

  private checklistCanAssign(session: SessionUser): boolean {
    return (
      session.roleKey === "program_manager" ||
      session.role === "administrator" ||
      session.role === "compliance_admin" ||
      session.platformAdmin
    );
  }

  private checklistCanOversee(session: SessionUser): boolean {
    return this.checklistCanAssign(session);
  }

  private mapChecklistRow(row: Record<string, unknown>): HmWeeklyChecklist {
    const isoOrNull = (value: unknown): string | null => {
      if (value == null) return null;
      const d = new Date(value as string);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      weekOf: (row.week_of as string).slice(0, 10),
      weekStart:
        row.week_start == null
          ? null
          : String(row.week_start).slice(0, 10),
      dueAt: isoOrNull(row.due_at),
      late: row.late === true,
      lateFlaggedAt: isoOrNull(row.late_flagged_at),
      assignedToUserId: row.assigned_to_user_id as string,
      assignedByUserId: (row.assigned_by_user_id as string | null) ?? null,
      status: row.status as WeeklyChecklistStatus,
      submittedAt: isoOrNull(row.submitted_at),
      items: (row.items as ChecklistItem[]) ?? [],
      serviceLogs: (row.service_logs as ServiceLogEntry[]) ?? [],
      attestation: (row.attestation as ChecklistAttestation | null) ?? null,
      createdAt: isoOrNull(row.created_at) ?? "",
      updatedAt: isoOrNull(row.updated_at) ?? "",
    };
  }

  private async checklistRow(
    session: SessionUser,
    checklistId: string,
  ): Promise<HmWeeklyChecklist> {
    const { data, error } = await this.client
      .from("hm_weekly_checklists")
      .select("*")
      .eq("id", checklistId)
      .maybeSingle();
    throwIf(error, "Could not load the checklist.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Checklist not found.");
    }
    const row = this.mapChecklistRow(data as Record<string, unknown>);
    if (
      row.assignedToUserId !== session.userId &&
      !this.checklistCanOversee(session)
    ) {
      throw new Error("This checklist is assigned to another house manager.");
    }
    return row;
  }

  /**
   * LIFEPATH-P5 → P2 HOOK: pre-Phase-2 training readiness feed, built from the
   * legacy training_checklists table (mirrors LocalApi.trainingReadinessForSite).
   * When the Phase 2 training engine merges, replace this with the engine's
   * per-staff readiness feed (including delegation sign-offs). The
   * TrainingReadiness shape and computeItem21 stay the same.
   */
  private async trainingReadinessHosted(
    session: SessionUser,
    siteId: string,
  ): Promise<TrainingReadiness[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data: memberships, error: memberError } = await this.client
      .from("memberships")
      .select("user_id, role_key, expires_on")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .not(
        "role_key",
        "in",
        "(administrator,compliance_admin,program_manager)",
      );
    throwIf(memberError, "Could not load site staff.");
    const active = (memberships ?? []).filter(
      (m) => !(m.expires_on as string | null) || (m.expires_on as string) >= today,
    );
    if (active.length === 0) return [];
    const userIds = active.map((m) => m.user_id as string);
    const { data: profiles } = await this.client
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    const names = new Map(
      (profiles ?? []).map((p) => [p.id as string, p.full_name as string]),
    );
    const { data: sheets, error: sheetError } = await this.client
      .from("training_checklists")
      .select("staff_user_id, staff_signed_at, hm_signed_at, items")
      .eq("agency_id", session.agencyId)
      .in("staff_user_id", userIds);
    throwIf(sheetError, "Could not load training records.");
    return active.map((m) => {
      const userId = m.user_id as string;
      const rows = (sheets ?? []).filter(
        (s) => (s.staff_user_id as string) === userId,
      );
      const fullySignedOff =
        rows.length > 0 &&
        rows.every(
          (s) =>
            Boolean(s.staff_signed_at) &&
            Boolean(s.hm_signed_at) &&
            Array.isArray(s.items) &&
            (s.items as Array<{ initialedAt?: string | null }>).every((line) =>
              Boolean(line.initialedAt),
            ),
        );
      return {
        staffId: userId,
        staffName: names.get(userId) ?? "Staff",
        fullySignedOff,
      };
    });
  }

  private async stampItem21Hosted(
    session: SessionUser,
    row: HmWeeklyChecklist,
  ): Promise<ChecklistAnswer> {
    const readiness = await this.trainingReadinessHosted(session, row.siteId);
    const items = applyItem21(row.items, computeItem21(readiness));
    const { error } = await this.client
      .from("hm_weekly_checklists")
      .update({ items })
      .eq("id", row.id);
    throwIf(error, "Could not update item 21.");
    row.items = items;
    return (items.find((i) => i.key === ITEM_21_KEY)?.answer ?? "N") as ChecklistAnswer;
  }

  async assignWeeklyChecklist(input: {
    siteId: string;
    hmUserId: string;
    weekOf: string;
  }): Promise<HmWeeklyChecklist> {
    const session = await this.requireSession();
    if (!this.checklistCanAssign(session)) {
      throw new Error(
        "Only a PM or agency administrator can assign weekly checklists.",
      );
    }
    const weekOf = weekOfSundayIso(input.weekOf);
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) {
      throw new Error("Home not found.");
    }
    const { data: hmRow } = await this.client
      .from("memberships")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", input.hmUserId)
      .eq("role_key", "house_manager")
      .maybeSingle();
    if (!hmRow) {
      throw new Error("Checklists can only be assigned to a house manager.");
    }
    const { data: existing } = await this.client
      .from("hm_weekly_checklists")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", input.siteId)
      .eq("week_of", weekOf)
      .maybeSingle();
    if (existing) {
      const row = this.mapChecklistRow(existing as Record<string, unknown>);
      let items = row.items;
      if (row.status === "open") {
        const readiness = await this.trainingReadinessHosted(session, row.siteId);
        items = applyItem21(items, computeItem21(readiness));
      }
      const { error } = await this.client
        .from("hm_weekly_checklists")
        .update({
          assigned_to_user_id: input.hmUserId,
          assigned_by_user_id: session.userId,
          items,
        })
        .eq("id", row.id);
      throwIf(error, "Could not reassign the checklist.");
      await this.audit(
        session,
        "checklist.assigned",
        `Weekly checklist reassigned for ${site.name} · week of ${weekOf}`,
        "hm_weekly_checklist",
        row.id,
      );
      return { ...row, assignedToUserId: input.hmUserId, assignedByUserId: session.userId, items };
    }
    const readiness = await this.trainingReadinessHosted(session, input.siteId);
    const items = applyItem21(buildChecklistItems(), computeItem21(readiness));
    const { data, error } = await this.client
      .from("hm_weekly_checklists")
      .insert({
        agency_id: session.agencyId,
        site_id: input.siteId,
        week_of: weekOf,
        assigned_to_user_id: input.hmUserId,
        assigned_by_user_id: session.userId,
        status: "open",
        items,
        service_logs: [],
      })
      .select("*")
      .single();
    throwIf(error, "Could not assign the checklist.");
    await this.audit(
      session,
      "checklist.assigned",
      `Weekly checklist assigned for ${site.name} · week of ${weekOf}`,
      "hm_weekly_checklist",
      (data as Record<string, unknown>).id as string,
    );
    return this.mapChecklistRow(data as Record<string, unknown>);
  }

  async listWeeklyChecklists(input?: {
    siteId?: string;
    weekOf?: string;
  }): Promise<HmWeeklyChecklist[]> {
    const session = await this.requireSession();
    let query = this.client
      .from("hm_weekly_checklists")
      .select("*")
      .eq("agency_id", session.agencyId);
    if (!this.checklistCanOversee(session)) {
      query = query.eq("assigned_to_user_id", session.userId);
    }
    if (input?.siteId) query = query.eq("site_id", input.siteId);
    if (input?.weekOf) query = query.eq("week_of", weekOfSundayIso(input.weekOf));
    query = query.order("week_of", { ascending: false });
    const { data, error } = await query;
    throwIf(error, "Could not load checklists.");
    return (data ?? []).map((r) =>
      this.mapChecklistRow(r as Record<string, unknown>),
    );
  }

  async answerChecklistItem(
    checklistId: string,
    itemKey: string,
    answer: ChecklistAnswer,
    note?: string,
  ): Promise<void> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    if (row.assignedToUserId !== session.userId) {
      throw new Error("Only the assigned house manager can fill in this checklist.");
    }
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
    await this.assertDocumentUnlocked(session, "hm_checklist", checklistId);
    const items = applyItemAnswer(row.items, itemKey, answer, note);
    const { error } = await this.client
      .from("hm_weekly_checklists")
      .update({ items })
      .eq("id", row.id);
    throwIf(error, "Could not save the answer.");
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
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    if (row.assignedToUserId !== session.userId) {
      throw new Error("Only the assigned house manager can fill in this checklist.");
    }
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open for edits.");
    }
    if (!input.detail.trim()) throw new Error("Describe the log entry.");
    await this.assertDocumentUnlocked(session, "hm_checklist", checklistId);
    const entry: ServiceLogEntry = {
      id: crypto.randomUUID(),
      kind: input.kind,
      detail: input.detail.trim(),
      staffName: input.staffName?.trim() || null,
      dateTime: input.dateTime?.trim() || null,
      createdAt: new Date().toISOString(),
    };
    const serviceLogs = [...row.serviceLogs, entry];
    const { error } = await this.client
      .from("hm_weekly_checklists")
      .update({ service_logs: serviceLogs })
      .eq("id", row.id);
    throwIf(error, "Could not add the log entry.");
    return entry;
  }

  async removeServiceLogEntry(
    checklistId: string,
    entryId: string,
  ): Promise<void> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    if (row.assignedToUserId !== session.userId) {
      throw new Error("Only the assigned house manager can fill in this checklist.");
    }
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open for edits.");
    }
    await this.assertDocumentUnlocked(session, "hm_checklist", checklistId);
    const serviceLogs = row.serviceLogs.filter((e) => e.id !== entryId);
    const { error } = await this.client
      .from("hm_weekly_checklists")
      .update({ service_logs: serviceLogs })
      .eq("id", row.id);
    throwIf(error, "Could not remove the log entry.");
  }

  async refreshChecklistItem21(
    checklistId: string,
  ): Promise<ChecklistAnswer> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    if (row.status !== "open") return "N";
    return this.stampItem21Hosted(session, row);
  }

  async submitWeeklyChecklist(
    checklistId: string,
    signatureName: string,
  ): Promise<void> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    if (row.assignedToUserId !== session.userId) {
      throw new Error("Only the assigned house manager can fill in this checklist.");
    }
    if (row.status !== "open") {
      throw new Error("This checklist is no longer open.");
    }
    // Item 21 reflects the latest training data at submit time.
    const readiness = await this.trainingReadinessHosted(session, row.siteId);
    const items = applyItem21(row.items, computeItem21(readiness));
    const blanks = blankItemNumbers(items);
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
    const attestation: ChecklistAttestation = {
      signedBy,
      signedAt: now,
      signatureMark: signedBy,
    };
    const { error } = await this.client
      .from("hm_weekly_checklists")
      .update({
        items,
        attestation,
        status: "submitted",
        submitted_at: now,
      })
      .eq("id", row.id);
    throwIf(error, "Could not submit the checklist.");
    const site = await this.siteRecord(row.siteId);
    await this.audit(
      session,
      "checklist.submitted",
      `Weekly checklist submitted for ${site?.name ?? "home"} · week of ${row.weekOf}`,
      "hm_weekly_checklist",
      row.id,
    );
  }

  async rolloverWeeklyChecklists(): Promise<{
    created: number;
    locked: number;
  }> {
    const session = await this.requireSession();
    const today = new Date().toISOString().slice(0, 10);
    const currentWeek = weekOfSundayIso(today);
    const { data: stale, error: staleError } = await this.client
      .from("hm_weekly_checklists")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("status", "open")
      .lt("week_of", currentWeek);
    throwIf(staleError, "Could not find stale checklists.");
    let locked = 0;
    if (stale && stale.length > 0) {
      const { error } = await this.client
        .from("hm_weekly_checklists")
        .update({ status: "overdue" })
        .in(
          "id",
          stale.map((r) => (r as Record<string, unknown>).id as string),
        );
      throwIf(error, "Could not lock prior weeks.");
      locked = stale.length;
    }
    const { data: assignments, error: assignError } = await this.client
      .from("memberships")
      .select("user_id, site_id, expires_on")
      .eq("agency_id", session.agencyId)
      .eq("role_key", "house_manager")
      .not("site_id", "is", null);
    throwIf(assignError, "Could not load HM assignments.");
    const { data: have, error: haveError } = await this.client
      .from("hm_weekly_checklists")
      .select("site_id")
      .eq("agency_id", session.agencyId)
      .eq("week_of", currentWeek);
    throwIf(haveError, "Could not load this week's checklists.");
    const haveSites = new Set(
      (have ?? []).map((r) => (r as Record<string, unknown>).site_id as string),
    );
    let created = 0;
    for (const m of (assignments ?? []) as Array<Record<string, unknown>>) {
      const expiresOn = m.expires_on as string | null;
      if (expiresOn && expiresOn < today) continue;
      const siteId = m.site_id as string;
      if (haveSites.has(siteId)) continue;
      const readiness = await this.trainingReadinessHosted(session, siteId);
      const items = applyItem21(buildChecklistItems(), computeItem21(readiness));
      const { error } = await this.client.from("hm_weekly_checklists").insert({
        agency_id: session.agencyId,
        site_id: siteId,
        week_of: currentWeek,
        assigned_to_user_id: m.user_id as string,
        assigned_by_user_id: null,
        status: "open",
        items,
        service_logs: [],
      });
      if (error) {
        // Idempotent: another concurrent run may have created this row.
        if (!/duplicate|unique/i.test(error.message)) {
          throwIf(error, "Could not open this week's checklist.");
        }
        continue;
      }
      created += 1;
      haveSites.add(siteId);
    }
    if (created > 0 || locked > 0) {
      await this.audit(
        session,
        "checklist.rollover",
        `Weekly rollover: ${created} opened · ${locked} locked overdue`,
        "hm_weekly_checklist",
      );
    }
    return { created, locked };
  }

  async exportWeeklyChecklistPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    const site = await this.siteRecord(row.siteId);
    const hmName = await this.profileName(row.assignedToUserId);
    const doc = buildWeeklyChecklistPdf({
      agencyName: session.agencyName,
      siteName: site?.name ?? "Home",
      weekOf: row.weekOf,
      checklist: row,
      hmName,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      siteLocation: site ? await this.siteLocationParts(site.id) : { name: "Home" },
    });
    return {
      blob: doc.output("blob"),
      name: weeklyChecklistPdfName(site?.name ?? "home", row.weekOf),
    };
  }

  async exportWeeklyServiceLogPdf(
    checklistId: string,
  ): Promise<{ blob: Blob; name: string }> {
    const session = await this.requireSession();
    const row = await this.checklistRow(session, checklistId);
    const site = await this.siteRecord(row.siteId);
    const hmName = await this.profileName(row.assignedToUserId);
    const doc = buildWeeklyServiceLogPdf({
      agencyName: session.agencyName,
      siteName: site?.name ?? "Home",
      weekOf: row.weekOf,
      checklist: row,
      hmName,
      logoDataUrl: await this.hostedLogoDataUrl(session.agencyId),
      siteLocation: site ? await this.siteLocationParts(site.id) : { name: "Home" },
    });
    return {
      blob: doc.output("blob"),
      name: weeklyServiceLogPdfName(site?.name ?? "home", row.weekOf),
    };
  }
  // ===== LIFEPATH-P6 HOSTED (med inventory) =====
  private async p6lib(): Promise<typeof import("./medInventory")> {
    return await import("./medInventory");
  }

  private mapMedInventoryRecord(
    row: Record<string, unknown>,
  ): import("./types").MedInventoryRecord {
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      individualId: row.individual_id as string,
      medicationId: row.medication_id as string,
      lowThresholdDays: Number(row.low_threshold_days ?? 7),
      doseTimes: Array.isArray(row.dose_times)
        ? (row.dose_times as string[])
        : [],
      reorderAcknowledgedOn: (row.reorder_acknowledged_on as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? new Date().toISOString(),
    };
  }

  private async p6medicationOrThrow(medicationId: string) {
    const session = await this.requireSession();
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view medication inventory.");
    }
    const { data: row, error } = await this.client
      .from("medications")
      .select("*")
      .eq("id", medicationId)
      .single();
    throwIf(error, "Medication not found.");
    const med = mapMedication(row!);
    if (med.agencyId !== session.agencyId) throw new Error("Medication not found.");
    return { session, med };
  }

  private async p6inventoryViews(
    session: SessionUser,
    individualId: string,
    today: string,
  ): Promise<import("./types").MedInventoryView[]> {
    const { projectMedInventory, compareMedInventory } = await this.p6lib();
    const medsRes = await this.client
      .from("medications")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId);
    throwIf(medsRes.error, "Could not load medications.");
    const allMeds = (medsRes.data ?? []).map(mapMedication);
    const ordersRes = await this.client
      .from("medication_orders")
      .select("id,status")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId);
    throwIf(ordersRes.error, "Could not load medication orders.");
    const orders = (ordersRes.data ?? []).map((row) => ({
      id: String((row as Record<string, unknown>).id),
      status: String(
        (row as Record<string, unknown>).status,
      ) as MedicationOrder["status"],
    }));
    const meds = allMeds.filter((med) => medicationStaysOnMar(med, orders));
    const medIds = meds.map((med) => med.id);
    const prnIds = meds.filter((med) => med.kind === "prn").map((med) => med.id);
    const [invRes, delRes, prnRes, excRes] = await Promise.all([
      medIds.length
        ? this.client
            .from("med_inventory")
            .select("*")
            .eq("agency_id", session.agencyId)
            .eq("individual_id", individualId)
        : { data: [], error: null },
      medIds.length
        ? this.client
            .from("medication_deliveries")
            .select("*")
            .eq("agency_id", session.agencyId)
            .in("medication_id", medIds)
            .order("counted_on", { ascending: false })
        : { data: [], error: null },
      prnIds.length
        ? this.client
            .from("prn_dose_logs")
            .select("medication_id,logged_on,pills_used")
            .eq("agency_id", session.agencyId)
            .in("medication_id", prnIds)
        : { data: [], error: null },
      medIds.length
        ? this.client
            .from("med_dose_exceptions")
            .select("*")
            .eq("agency_id", session.agencyId)
            .in("medication_id", medIds)
            .order("occurred_on", { ascending: false })
        : { data: [], error: null },
    ]);
    throwIf(invRes.error, "Could not load medication inventory.");
    throwIf(delRes.error, "Could not load delivery records.");
    throwIf(prnRes.error, "Could not load PRN dose logs.");
    throwIf(excRes.error, "Could not load dose exceptions.");
    const invByMed = new Map(
      ((invRes.data ?? []) as Record<string, unknown>[]).map((row) => {
        const record = this.mapMedInventoryRecord(row);
        return [record.medicationId, record] as const;
      }),
    );
    const { mapMedicationDelivery } = await import("./hostedMappers");
    const deliveries = (
      (delRes.data ?? []) as Record<string, unknown>[]
    ).map((row) => mapMedicationDelivery(row));
    const prnByMed = new Map<string, Array<{ date: string; pills: number }>>();
    for (const row of (prnRes.data ?? []) as Record<string, unknown>[]) {
      const medId = row.medication_id as string;
      const list = prnByMed.get(medId) ?? [];
      list.push({
        date: (row.logged_on as string) ?? "",
        pills: Number(row.pills_used ?? 0),
      });
      prnByMed.set(medId, list);
    }
    const excByMed = new Map<string, MedDoseException[]>();
    for (const row of (excRes.data ?? []) as Record<string, unknown>[]) {
      const medId = row.medication_id as string;
      const list = excByMed.get(medId) ?? [];
      list.push({
        id: String(row.id),
        agencyId: String(row.agency_id),
        individualId: String(row.individual_id),
        medicationId: medId,
        occurredOn: String(row.occurred_on).slice(0, 10),
        kind: row.kind as MedDoseException["kind"],
        pillsAffected: Number(row.pills_affected ?? 0),
        reason: String(row.reason ?? ""),
        createdBy: (row.created_by as string | null) ?? null,
        createdAt: String(row.created_at),
      });
      excByMed.set(medId, list);
    }
    return meds
      .map((med) =>
        projectMedInventory({
          med,
          inventory: invByMed.get(med.id) ?? null,
          deliveries: deliveries.filter((row) => row.medicationId === med.id),
          prnDoses: prnByMed.get(med.id) ?? [],
          doseExceptions: excByMed.get(med.id) ?? [],
          today,
        }),
      )
      .sort(compareMedInventory);
  }

  async getMedInventory(
    individualId: string,
  ): Promise<import("./types").MedInventoryView[]> {
    const session = await this.requireSession();
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view medication inventory.");
    }
    const { data: person, error } = await this.client
      .from("individuals")
      .select("id,agency_id")
      .eq("id", individualId)
      .single();
    throwIf(error, "Individual not found.");
    if ((person!.agency_id as string) !== session.agencyId) {
      throw new Error("Individual not found.");
    }
    return this.p6inventoryViews(session, individualId, todayIso());
  }

  async getMedicationSupplyStatus(
    siteId: string,
  ): Promise<import("./types").MedSupplyStatus> {
    const { summarizeMedSupply } = await this.p6lib();
    const session = await this.requireSession();
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view medication inventory.");
    }
    const { data: site, error: siteError } = await this.client
      .from("sites")
      .select("id,name,agency_id")
      .eq("id", siteId)
      .single();
    throwIf(siteError, "Site not found.");
    if ((site!.agency_id as string) !== session.agencyId) {
      throw new Error("Site not found.");
    }
    const { data: people, error: peopleError } = await this.client
      .from("individuals")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(peopleError, "Could not load individuals.");
    const today = todayIso();
    const views = (
      await Promise.all(
        ((people ?? []) as Array<{ id: string }>).map((person) =>
          this.p6inventoryViews(session, person.id as string, today),
        ),
      )
    ).flat();
    return summarizeMedSupply(
      siteId,
      (site!.name as string) ?? "Site",
      views,
      today,
    );
  }

  async adjustMedInventory(input: {
    medicationId: string;
    quantityDelta: number;
    reason: string;
    countedOn?: string;
  }) {
    const { session, med } = await this.p6medicationOrThrow(input.medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or PM adjusts medication inventory.");
    }
    const reason = input.reason.trim();
    if (!reason) throw new Error("Give a reason for the count correction.");
    if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
      throw new Error("Enter a non-zero correction.");
    }
    const countedOn = input.countedOn ?? todayIso();
    assertCalendarDate(countedOn, "Use a valid count date.");
    const next =
      Math.max(0, Math.round((med.remainingPills + input.quantityDelta) * 100) / 100);
    const { error: updateError } = await this.client
      .from("medications")
      .update({
        remaining_pills: next,
        last_delivery_on: countedOn,
        last_countdown_on: countedOn,
      })
      .eq("id", med.id);
    throwIf(updateError, "Could not correct the count.");
    const { error: deliveryError } = await this.client
      .from("medication_deliveries")
      .insert({
        agency_id: session.agencyId,
        medication_id: med.id,
        counted_on: countedOn,
        remaining_pills: next,
        pills_per_day: med.pillsPerDay,
        recorded_by: session.userId,
      });
    throwIf(deliveryError, "Correction saved, but the count record could not be written.");
    await this.audit(
      session,
      "medication.inventory_adjusted",
      `${session.fullName} corrected ${med.name} by ${input.quantityDelta > 0 ? "+" : ""}${input.quantityDelta} pills: ${reason}`,
      "medication",
      med.id,
    );
  }

  async setReorderThreshold(input: {
    medicationId: string;
    lowThresholdDays: number;
  }) {
    const { session, med } = await this.p6medicationOrThrow(input.medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or PM sets the reorder threshold.");
    }
    const days = Math.floor(input.lowThresholdDays);
    if (!Number.isFinite(days) || days < 1 || days > 90) {
      throw new Error("Set the reorder threshold to 1–90 days of doses.");
    }
    const { error } = await this.client.from("med_inventory").upsert(
      {
        agency_id: session.agencyId,
        individual_id: med.individualId,
        medication_id: med.id,
        low_threshold_days: days,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,medication_id" },
    );
    throwIf(error, "Could not save the reorder threshold.");
    await this.audit(
      session,
      "medication.threshold_updated",
      `${session.fullName} set the ${med.name} reorder threshold to ${days} days`,
      "medication",
      med.id,
    );
  }

  async acknowledgeReorderAlert(medicationId: string) {
    const { session, med } = await this.p6medicationOrThrow(medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or PM acknowledges a reorder alert.");
    }
    const { error } = await this.client.from("med_inventory").upsert(
      {
        agency_id: session.agencyId,
        individual_id: med.individualId,
        medication_id: med.id,
        reorder_acknowledged_on: todayIso(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,medication_id" },
    );
    throwIf(error, "Could not acknowledge the reorder alert.");
    await this.audit(
      session,
      "medication.reorder_acknowledged",
      `${session.fullName} acknowledged the ${med.name} reorder alert`,
      "medication",
      med.id,
    );
  }

  async addMedDoseException(input: AddMedDoseExceptionInput) {
    const { validateDoseExceptionInput } = await import("./medInventory");
    const { session, med } = await this.p6medicationOrThrow(input.medicationId);
    if (!canLogDoseException(session.roleKey)) {
      throw new Error("You cannot log a dose exception.");
    }
    const validated = validateDoseExceptionInput(input);
    // Insert-only: corrections are new rows, never edits — there is no
    // update/delete path for med_dose_exceptions on this API.
    const { data, error } = await this.client
      .from("med_dose_exceptions")
      .insert({
        agency_id: session.agencyId,
        individual_id: med.individualId,
        medication_id: med.id,
        occurred_on: validated.occurredOn,
        kind: validated.kind,
        pills_affected: validated.pillsAffected,
        reason: validated.reason,
        created_by: session.userId,
      })
      .select("id")
      .single();
    throwIf(error, "Could not log the dose exception.");
    await this.audit(
      session,
      "medication.dose_exception",
      `${session.fullName} logged a ${validated.kind} dose exception for ${med.name} (${validated.pillsAffected} pill${validated.pillsAffected === 1 ? "" : "s"}): ${validated.reason}`,
      "med_dose_exception",
      (data as { id: string } | null)?.id,
    );
    if (validated.kind === "refused") {
      const rules = await this.loadOperatingRules(session.agencyId);
      const { data: recent } = await this.client
        .from("med_dose_exceptions")
        .select("kind, created_at")
        .eq("agency_id", session.agencyId)
        .eq("medication_id", med.id)
        .order("created_at", { ascending: false })
        .limit(20);
      const streak = consecutiveRefusals(
        ((recent ?? []) as Array<{ kind: string; created_at: string }>).map((row) => ({
          medicationId: med.id,
          kind: String(row.kind),
          createdAt: String(row.created_at ?? ""),
        })),
        med.id,
      );
      if (streak >= rules.refusalsBeforeRn) {
        await this.audit(
          session,
          "medication.refusal_review",
          `Nurse review: ${med.name} has been refused ${streak} times in a row.`,
          "medication",
          med.id,
        );
        await this.queueOperatingNotice({
          agencyId: session.agencyId,
          userId: null,
          roleKey: "nurse",
          type: "med.refusal_review",
          title: "Nurse review — refusals",
          body: `${med.name} has been refused ${streak} times in a row.`,
          deepLink: "/meds",
          entityId: med.id,
          dedupeKey: `med.refusal_review:${med.id}:${streak}`,
        });
      }
    }
  }

  // ===== ISSUE #75 alone time + #76 MAR marks + Overview due items =====

  private mapAloneTimeWindow(
    row: Record<string, unknown>,
  ): import("./types").AloneTimeWindow {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      individualId: String(row.individual_id),
      recurrence: (row.recurrence as import("./types").AloneTimeRecurrence) ?? "once",
      weekday: row.weekday === null || row.weekday === undefined ? null : Number(row.weekday),
      onDate: row.on_date ? String(row.on_date).slice(0, 10) : null,
      startTime: String(row.start_time ?? "").slice(0, 5),
      endTime: String(row.end_time ?? "").slice(0, 5),
      note: String(row.note ?? ""),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdByName: String(row.created_by_name ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    };
  }

  private mapMedDoseMark(
    row: Record<string, unknown>,
  ): import("./types").MedDoseMark {
    return {
      id: String(row.id),
      agencyId: String(row.agency_id),
      individualId: String(row.individual_id),
      medicationId: String(row.medication_id),
      doseDate: String(row.dose_date ?? "").slice(0, 10),
      doseTime: String(row.dose_time ?? "").slice(0, 5),
      status: (row.status as import("./types").MedDoseMarkStatus) ?? "given",
      markedBy: row.marked_by ? String(row.marked_by) : null,
      markedByName: String(row.marked_by_name ?? ""),
      markedAt: String(row.marked_at ?? ""),
    };
  }

  /**
   * Saved settings from effective_rules. Catalog defaults apply when the
   * migration is not on this database yet, so due items keep working.
   */
  private async loadOperatingRules(agencyId: string) {
    const { data, error } = await this.client.rpc("effective_rules", {
      p_agency_id: agencyId,
      p_site_id: null,
    });
    if (error || !data) return operatingRulesFrom(null);
    return operatingRulesFrom(
      (data as Array<Record<string, unknown>>).map(
        (row): EffectiveRule => ({
          key: String(row.key),
          value: row.value as EffectiveRule["value"],
          lock: (row.lock as EffectiveRule["lock"]) ?? "agency",
          source: (row.source as EffectiveRule["source"]) ?? "default",
        }),
      ),
    );
  }

  async getSiteDueItems(
    siteId: string,
  ): Promise<import("./dueItems").SiteDueItemsResult> {
    const session = await this.requireSession();
    if (!canAccessSite(session, siteId)) {
      throw new Error("Site not found or outside your assigned access.");
    }
    const { data: site, error: siteError } = await this.client
      .from("sites")
      .select("id,name,agency_id")
      .eq("id", siteId)
      .single();
    throwIf(siteError, "Site not found.");
    if ((site!.agency_id as string) !== session.agencyId) {
      throw new Error("Site not found.");
    }
    const siteFacts = await this.siteFacts(siteId);
    const { data: peopleRows, error: peopleError } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(peopleError, "Could not load the due-items list.");
    const people = ((peopleRows ?? []) as Array<{ id: string; full_name: string }>).map(
      (row) => ({ id: String(row.id), name: String(row.full_name ?? "") }),
    );
    const peopleIds = people.map((p) => p.id);
    const rules = await this.loadOperatingRules(session.agencyId);
    const clock = dueItemClock();
    const today = clock.doseDate;
    const serviceDate = clock.serviceDate;
    const now = clock.now;

    // On-duty writers = assigned house DSPs (no clock-in v1).
    const { data: writerRows } = await this.client
      .from("memberships")
      .select("user_id, role_key")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .eq("role_key", "dsp");
    const writerIds = [
      ...new Set(((writerRows ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id))),
    ];
    const writerNames = new Map<string, string>();
    if (writerIds.length) {
      const { data: profs } = await this.client
        .from("profiles")
        .select("id, full_name")
        .in("id", writerIds);
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string }>) {
        writerNames.set(String(p.id), String(p.full_name ?? "Staff"));
      }
    }
    const requiredWriters = writerIds
      .map((id) => ({ userId: id, name: writerNames.get(id) ?? "Staff" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let shiftNoteItems: ReturnType<typeof computeShiftNoteDueItems> = [];
    if (canSeeShiftNotes(session.roleKey) && peopleIds.length) {
      const { data: noteRows } = await this.client
        .from("shift_notes")
        .select("individual_id, staff_user_id, shift, note_date, hr_shift_id")
        .eq("agency_id", session.agencyId)
        .in("individual_id", peopleIds)
        .is("deleted_at", null)
        .eq("note_date", serviceDate);
      const notes = ((noteRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        individualId: String(row.individual_id),
        staffUserId: String(row.staff_user_id ?? ""),
        blockId: blockForShiftLabel(String(row.shift ?? "")) as ShiftBlockId | null,
        noteDate: String(row.note_date ?? "").slice(0, 10),
        hrShiftId: row.hr_shift_id ? String(row.hr_shift_id) : null,
      }));
      const dayStart = new Date(zonedWallTimeMs(serviceDate, 0, clock.timeZone)).toISOString();
      const dayEnd = new Date(zonedWallTimeMs(serviceDate, 36 * 60, clock.timeZone)).toISOString();
      const { data: shiftRows } = await this.client
        .from("hr_shifts")
        .select("id, staff_id, title, starts_at, ends_at, status")
        .eq("agency_id", session.agencyId)
        .eq("site_id", siteId)
        .in("status", ["scheduled", "published"])
        .not("staff_id", "is", null)
        .lt("starts_at", dayEnd)
        .gt("ends_at", dayStart);
      const shiftStaffIds = [...new Set((shiftRows ?? []).map((row) => String(row.staff_id)))];
      const { data: shiftProfiles } = shiftStaffIds.length
        ? await this.client.from("profiles").select("id, full_name").in("id", shiftStaffIds)
        : { data: [] };
      const shiftNames = new Map((shiftProfiles ?? []).map((row) => [String(row.id), String(row.full_name ?? "Staff")]));
      const scheduledShifts = (shiftRows ?? []).map((row) => ({
        id: String(row.id),
        staffUserId: String(row.staff_id),
        staffName: shiftNames.get(String(row.staff_id)) ?? "Staff",
        startsAt: String(row.starts_at),
        endsAt: String(row.ends_at),
      }));
      const { data: openRows } = await this.client
        .from("hr_open_shifts")
        .select("id, starts_at, ends_at, status, kind")
        .eq("agency_id", session.agencyId)
        .eq("site_id", siteId)
        .eq("kind", "temporary")
        .eq("status", "open")
        .lt("starts_at", dayEnd)
        .gt("ends_at", dayStart);
      for (const row of openRows ?? []) {
        if (!row.starts_at || !row.ends_at) continue;
        scheduledShifts.push({
          id: String(row.id),
          staffUserId: "",
          staffName: "Open",
          startsAt: String(row.starts_at),
          endsAt: String(row.ends_at),
        });
      }
      const { data: aloneRows } = await this.client
        .from("alone_time_windows")
        .select("*")
        .eq("agency_id", session.agencyId)
        .is("deleted_at", null)
        .in("individual_id", peopleIds);
      shiftNoteItems = computeShiftNoteDueItems({
        serviceDate,
        now,
        graceMinutes: rules.noteGraceMinutes,
        timeZone: clock.timeZone,
        blocks: shiftBlocksForSite(siteFacts),
        staffed24h: siteFacts.staffed24h !== false,
        individuals: people,
        requiredWriters,
        notes,
        scheduledShifts,
        aloneTime: ((aloneRows ?? []) as Array<Record<string, unknown>>).map((r) =>
          this.mapAloneTimeWindow(r),
        ),
      });
    }

    let medItems: ReturnType<typeof computeMedDueItems> = [];
    if (canSeeMeds(session.roleKey) && peopleIds.length) {
      const nameById = new Map(people.map((p) => [p.id, p.name]));
      const { data: medRows } = await this.client
        .from("medications")
        .select("id, individual_id, name, strength, kind")
        .eq("agency_id", session.agencyId)
        .eq("kind", "scheduled")
        .in("individual_id", peopleIds);
      const meds = (medRows ?? []) as Array<Record<string, unknown>>;
      const medIds = meds.map((m) => String(m.id));
      const doseByMed = new Map<string, string[]>();
      if (medIds.length) {
        const { data: invRows } = await this.client
          .from("med_inventory")
          .select("medication_id, dose_times")
          .eq("agency_id", session.agencyId)
          .in("medication_id", medIds);
        for (const inv of (invRows ?? []) as Array<Record<string, unknown>>) {
          doseByMed.set(
            String(inv.medication_id),
            Array.isArray(inv.dose_times) ? (inv.dose_times as string[]) : [],
          );
        }
      }
      const scheduledDoses: ScheduledDose[] = meds
        .map((m) => ({
          individualId: String(m.individual_id),
          individualName: nameById.get(String(m.individual_id)) ?? "",
          medicationId: String(m.id),
          medName: String(m.name ?? ""),
          strength: String(m.strength ?? ""),
          doseTimes: doseByMed.get(String(m.id)) ?? [],
        }))
        .filter((d) => d.doseTimes.length > 0);
      const { data: markRows } = medIds.length
        ? await this.client
            .from("med_dose_marks")
            .select("medication_id, dose_date, dose_time, status")
            .eq("agency_id", session.agencyId)
            .eq("dose_date", today)
            .in("medication_id", medIds)
        : { data: [] };
      medItems = computeMedDueItems({
        doseDate: today,
        nowMinutes: clock.nowMinutes,
        windowBeforeMinutes: rules.medWindowBeforeMinutes,
        windowAfterMinutes: rules.medWindowAfterMinutes,
        scheduledDoses,
        marks: ((markRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
          medicationId: String(row.medication_id),
          doseDate: String(row.dose_date ?? "").slice(0, 10),
          doseTime: String(row.dose_time ?? "").slice(0, 5),
          status: String(row.status ?? "") as import("./types").MedDoseMarkStatus,
        })),
      });
    }

    return {
      items: buildSiteDueItems(shiftNoteItems, medItems),
      shiftNoteCount: shiftNoteItems.length,
      medCount: medItems.length,
      basedOnAssignedStaff: requiredWriters.length > 0,
      serviceDate,
      doseDate: today,
    };
  }

  async getShiftAccountability(
    siteId: string,
    fromIso: string,
    toIso: string,
  ): Promise<import("./shiftAccountability").ShiftAccountability[]> {
    const session = await this.requireSession();
    if (!canAccessSite(session, siteId)) {
      throw new Error("Site not found or outside your assigned access.");
    }
    const { data: site, error: siteError } = await this.client
      .from("sites")
      .select("id,name,agency_id")
      .eq("id", siteId)
      .single();
    throwIf(siteError, "Site not found.");
    if ((site!.agency_id as string) !== session.agencyId) {
      throw new Error("Site not found.");
    }
    const siteFacts = await this.siteFacts(siteId);
    const { data: peopleRows, error: peopleError } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(peopleError, "Could not load shift accountability.");
    const people = ((peopleRows ?? []) as Array<{ id: string; full_name: string }>).map(
      (row) => ({ id: String(row.id), name: String(row.full_name ?? "") }),
    );
    const peopleIds = people.map((p) => p.id);
    const peopleSet = new Set(peopleIds);
    const nameById = new Map(people.map((p) => [p.id, p.name]));
    // Central dates covering the requested instants, padded a day each way
    // so an overnight shift at either edge still sees its whole window.
    const fromDate = addDaysIso(agencyClock(new Date(fromIso)).today, -1);
    const toDate = addDaysIso(agencyClock(new Date(toIso)).today, 1);
    const dates = accountabilityDates(fromDate, toDate);

    const { data: shiftRows, error: shiftError } = await this.client
      .from("hr_shifts")
      .select("id, staff_id, starts_at, ends_at, status")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .in("status", ["scheduled", "published"])
      .lt("starts_at", toIso)
      .gt("ends_at", fromIso)
      .order("starts_at", { ascending: true });
    throwIf(shiftError, "Could not load shift accountability.");
    const shifts: AccountabilityShift[] = ((shiftRows ?? []) as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id),
        staffId: row.staff_id ? String(row.staff_id) : null,
        startsAt: String(row.starts_at),
        endsAt: String(row.ends_at),
        status: String(row.status ?? "published"),
      }),
    );
    const staffIds = [...new Set(shifts.map((s) => s.staffId).filter(Boolean))] as string[];
    const ownerNameById = new Map<string, string>();
    if (staffIds.length) {
      const { data: profs } = await this.client
        .from("profiles")
        .select("id, full_name")
        .in("id", staffIds);
      for (const p of (profs ?? []) as Array<{ id: string; full_name: string }>) {
        ownerNameById.set(String(p.id), String(p.full_name ?? "Staff"));
      }
    }

    const items: AccountabilityDueItem[] = [];

    if (canSeeMeds(session.roleKey) && peopleIds.length) {
      const { data: medRows } = await this.client
        .from("medications")
        .select("id, individual_id, name, strength, kind")
        .eq("agency_id", session.agencyId)
        .eq("kind", "scheduled")
        .in("individual_id", peopleIds);
      const meds = (medRows ?? []) as Array<Record<string, unknown>>;
      const medIds = meds.map((m) => String(m.id));
      const doseByMed = new Map<string, string[]>();
      if (medIds.length) {
        const { data: invRows } = await this.client
          .from("med_inventory")
          .select("medication_id, dose_times")
          .eq("agency_id", session.agencyId)
          .in("medication_id", medIds);
        for (const inv of (invRows ?? []) as Array<Record<string, unknown>>) {
          doseByMed.set(
            String(inv.medication_id),
            Array.isArray(inv.dose_times) ? (inv.dose_times as string[]) : [],
          );
        }
      }
      const scheduledDoses: ScheduledDose[] = meds
        .map((m) => ({
          individualId: String(m.individual_id),
          individualName: nameById.get(String(m.individual_id)) ?? "",
          medicationId: String(m.id),
          medName: String(m.name ?? ""),
          strength: String(m.strength ?? ""),
          doseTimes: doseByMed.get(String(m.id)) ?? [],
        }))
        .filter((d) => d.doseTimes.length > 0);
      const { data: markRows } = medIds.length
        ? await this.client
            .from("med_dose_marks")
            .select("medication_id, dose_date, dose_time")
            .eq("agency_id", session.agencyId)
            .gte("dose_date", fromDate)
            .lte("dose_date", toDate)
            .in("medication_id", medIds)
        : { data: [] };
      items.push(
        ...medicationAccountabilityItems({
          scheduledDoses,
          marks: ((markRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            medicationId: String(row.medication_id),
            doseDate: String(row.dose_date ?? "").slice(0, 10),
            doseTime: String(row.dose_time ?? "").slice(0, 5),
          })),
          dates,
        }),
      );
    }

    if (canSeeShiftNotes(session.roleKey) && peopleIds.length) {
      const { data: noteRows } = await this.client
        .from("shift_notes")
        .select("individual_id, staff_user_id, shift, note_date, hr_shift_id, program_id, begin_time, end_time")
        .eq("agency_id", session.agencyId)
        .in("individual_id", peopleIds)
        .is("deleted_at", null)
        .gte("note_date", fromDate)
        .lte("note_date", toDate);
      const notes = ((noteRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        individualId: String(row.individual_id),
        staffUserId: String(row.staff_user_id ?? ""),
        noteDate: String(row.note_date ?? "").slice(0, 10),
        shift: String(row.shift ?? ""),
        beginTime: String(row.begin_time ?? ""),
        endTime: String(row.end_time ?? ""),
        hrShiftId: row.hr_shift_id ? String(row.hr_shift_id) : null,
        programId: String(row.program_id ?? ""),
      }));
      const { data: programRows } = await this.client
        .from("isp_programs")
        .select("id, individual_id, name, status, effective_on, expires_on")
        .eq("agency_id", session.agencyId)
        .in("individual_id", peopleIds);
      items.push(
        ...ispAccountabilityItems({
          people,
          programs: ((programRows ?? []) as Array<Record<string, unknown>>)
            .filter((row) => peopleSet.has(String(row.individual_id)))
            .map((row) => ({
              id: String(row.id),
              individualId: String(row.individual_id),
              name: String(row.name ?? ""),
              status: String(row.status ?? "draft"),
              effectiveOn: String(row.effective_on ?? "").slice(0, 10),
              expiresOn: String(row.expires_on ?? "").slice(0, 10),
            })),
          notes,
          dates,
        }),
        ...shiftNoteAccountabilityItems({
          shifts,
          people,
          notes,
          blocks: shiftBlocksForSite(siteFacts),
        }),
      );
    }

    if (canSeeMenuEntries(session.roleKey) && peopleIds.length) {
      const { data: menuRows } = await this.client
        .from("menu_entries")
        .select("individual_id, entry_date, meal_slot")
        .eq("agency_id", session.agencyId)
        .in("individual_id", peopleIds)
        .is("deleted_at", null)
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);
      items.push(
        ...menuAccountabilityItems({
          people,
          entries: ((menuRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
            individualId: String(row.individual_id),
            entryDate: String(row.entry_date ?? "").slice(0, 10),
            mealSlot: String(row.meal_slot ?? ""),
          })),
          dates,
        }),
      );
    }

    if (this.checklistCanOversee(session)) {
      const { data: checklistRows } = await this.client
        .from("hm_weekly_checklists")
        .select("*")
        .eq("agency_id", session.agencyId)
        .eq("site_id", siteId)
        .gte("week_of", addDaysIso(fromDate, -7))
        .lte("week_of", toDate);
      items.push(
        ...checklistAccountabilityItems({
          checklists: ((checklistRows ?? []) as Array<Record<string, unknown>>).map((row) =>
            this.mapChecklistRow(row),
          ),
        }),
      );
    }

    return computeShiftAccountability({
      shifts,
      ownerNameById,
      items,
      now: new Date(),
    });
  }

  async listAloneTime(
    individualId: string,
  ): Promise<import("./types").AloneTimeWindow[]> {
    const session = await this.requireSession();
    if (!canSeeShiftNotes(session.roleKey)) {
      throw new Error("You do not have access to alone-time windows.");
    }
    const { data, error } = await this.client
      .from("alone_time_windows")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .is("deleted_at", null)
      .order("start_time", { ascending: true });
    throwIf(error, "Could not load alone-time windows.");
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.mapAloneTimeWindow(row),
    );
  }

  async getSiteAloneTime(
    siteId: string,
  ): Promise<import("./types").AloneTimeWindowView[]> {
    const session = await this.requireSession();
    if (!canSeeShiftNotes(session.roleKey)) {
      throw new Error("You do not have access to alone-time windows.");
    }
    if (!canAccessSite(session, siteId)) {
      throw new Error("Site not found or outside your assigned access.");
    }
    const { data: peopleRows, error: peopleError } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(peopleError, "Could not load alone-time windows.");
    const names = new Map(
      ((peopleRows ?? []) as Array<{ id: string; full_name: string }>).map((p) => [
        String(p.id),
        String(p.full_name ?? ""),
      ]),
    );
    const ids = [...names.keys()];
    if (!ids.length) return [];
    const { data, error } = await this.client
      .from("alone_time_windows")
      .select("*")
      .eq("agency_id", session.agencyId)
      .is("deleted_at", null)
      .in("individual_id", ids)
      .order("start_time", { ascending: true });
    throwIf(error, "Could not load alone-time windows.");
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...this.mapAloneTimeWindow(row),
      individualName: names.get(String(row.individual_id)) ?? "",
    }));
  }

  async saveAloneTimeWindow(
    input: Parameters<ComplyraApi["saveAloneTimeWindow"]>[0],
  ): Promise<string> {
    const session = await this.requireSession();
    if (!canEditAloneTime(session.roleKey)) {
      throw new Error("Only a house manager or administrator can set alone time.");
    }
    if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
      throw new Error("Use HH:MM start and end times.");
    }
    if (input.startTime === input.endTime) {
      throw new Error("Start and end times cannot match.");
    }
    if (input.recurrence === "weekly") {
      if (input.weekday == null || input.weekday < 0 || input.weekday > 6) {
        throw new Error("Choose a weekday for a recurring window.");
      }
    } else if (!input.onDate) {
      throw new Error("Choose a date for a one-off window.");
    }
    const payload = {
      agency_id: session.agencyId,
      individual_id: input.individualId,
      recurrence: input.recurrence,
      weekday: input.recurrence === "weekly" ? input.weekday ?? null : null,
      on_date: input.recurrence === "once" ? input.onDate ?? null : null,
      start_time: input.startTime,
      end_time: input.endTime,
      note: (input.note ?? "").trim(),
      updated_at: new Date().toISOString(),
    };
    if (input.id) {
      const { error } = await this.client
        .from("alone_time_windows")
        .update(payload)
        .eq("id", input.id)
        .eq("agency_id", session.agencyId);
      throwIf(error, "Could not save the alone-time window.");
      await this.audit(session, "alone_time.updated", `${session.fullName} updated an alone-time window`, "alone_time_window", input.id);
      return input.id;
    }
    const { data, error } = await this.client
      .from("alone_time_windows")
      .insert({
        ...payload,
        created_by: session.userId,
        created_by_name: session.fullName,
      })
      .select("id")
      .single();
    throwIf(error, "Could not save the alone-time window.");
    const id = (data as { id: string } | null)?.id ?? "";
    await this.audit(session, "alone_time.created", `${session.fullName} set an alone-time window`, "alone_time_window", id);
    return id;
  }

  async deleteAloneTimeWindow(id: string): Promise<void> {
    const session = await this.requireSession();
    if (!canEditAloneTime(session.roleKey)) {
      throw new Error("Only a house manager or administrator can set alone time.");
    }
    const { error } = await this.client
      .from("alone_time_windows")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("agency_id", session.agencyId);
    throwIf(error, "Could not remove the alone-time window.");
    await this.audit(session, "alone_time.deleted", `${session.fullName} removed an alone-time window`, "alone_time_window", id);
  }

  async setMedDoseTimes(
    input: Parameters<ComplyraApi["setMedDoseTimes"]>[0],
  ): Promise<void> {
    const { session, med } = await this.p6medicationOrThrow(input.medicationId);
    if (!canRecordDelivery(session.roleKey)) {
      throw new Error("House manager, RN, or PM sets the dose schedule.");
    }
    if (med.kind !== "scheduled") {
      throw new Error("Only scheduled medications carry dose times.");
    }
    const times = [...new Set(input.doseTimes.map((t) => t.trim()))]
      .filter((t) => /^\d{2}:\d{2}$/.test(t))
      .sort();
    const { error } = await this.client.from("med_inventory").upsert(
      {
        agency_id: session.agencyId,
        individual_id: med.individualId,
        medication_id: med.id,
        dose_times: times,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,medication_id" },
    );
    throwIf(error, "Could not save the dose schedule.");
  }

  async getMedDoseMarks(
    individualId: string,
    doseDate: string,
  ): Promise<import("./types").MedDoseMark[]> {
    const session = await this.requireSession();
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view the medication record.");
    }
    const { data, error } = await this.client
      .from("med_dose_marks")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .eq("dose_date", doseDate.slice(0, 10))
      .order("dose_time", { ascending: true });
    throwIf(error, "Could not load the medication record.");
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.mapMedDoseMark(row),
    );
  }

  async getMedDoseMarksInRange(
    individualId: string,
    fromDate: string,
    toDate: string,
  ): Promise<import("./types").MedDoseMark[]> {
    const session = await this.requireSession();
    if (!canSeeMeds(session.roleKey)) {
      throw new Error("You cannot view the medication record.");
    }
    const { data, error } = await this.client
      .from("med_dose_marks")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .gte("dose_date", fromDate.slice(0, 10))
      .lte("dose_date", toDate.slice(0, 10))
      .order("dose_date", { ascending: true })
      .order("dose_time", { ascending: true });
    throwIf(error, "Could not load the medication record.");
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.mapMedDoseMark(row),
    );
  }

  async markMedDose(
    input: Parameters<ComplyraApi["markMedDose"]>[0],
  ): Promise<void> {
    const { session, med } = await this.p6medicationOrThrow(input.medicationId);
    if (!canLogDoseException(session.roleKey)) {
      throw new Error("Your role cannot mark medications.");
    }
    if (med.kind !== "scheduled") {
      throw new Error("Only scheduled medications are marked on the MAR.");
    }
    if (!/^\d{2}:\d{2}$/.test(input.doseTime)) {
      throw new Error("Use an HH:MM dose time.");
    }
    const rules = await this.loadOperatingRules(session.agencyId);
    const clock = dueItemClock();
    const early = marRecordingProblem({
      doseDate: input.doseDate,
      doseTime: input.doseTime,
      now: clock.now,
      windowBeforeMinutes: rules.medWindowBeforeMinutes,
      blockEarly: rules.blockEarlyRecording,
      timeZone: clock.timeZone,
    });
    if (early) throw new Error(early);
    const { data: existingMark, error: existingError } = await this.client
      .from("med_dose_marks")
      .select("marked_by")
      .eq("agency_id", session.agencyId)
      .eq("medication_id", med.id)
      .eq("dose_date", input.doseDate.slice(0, 10))
      .eq("dose_time", input.doseTime)
      .maybeSingle();
    throwIf(existingError, "Could not load the MAR entry.");
    if (
      existingMark &&
      !canCorrectDoseMark(session.roleKey, session.userId, {
        markedBy: (existingMark as { marked_by: string | null }).marked_by,
      })
    ) {
      throw new Error("You can correct only MAR entries you recorded. Ask your house manager or nurse.");
    }
    const { error } = await this.client.from("med_dose_marks").upsert(
      {
        agency_id: session.agencyId,
        individual_id: med.individualId,
        medication_id: med.id,
        dose_date: input.doseDate.slice(0, 10),
        dose_time: input.doseTime,
        status: input.status,
        marked_by: session.userId,
        marked_by_name: session.fullName,
        marked_at: new Date().toISOString(),
      },
      { onConflict: "agency_id,medication_id,dose_date,dose_time" },
    );
    throwIf(error, "Could not mark the dose.");
    const late = !existingMark && recordingCostsAPoint({
      doseDate: input.doseDate.slice(0, 10),
      doseTime: input.doseTime,
      now: new Date(),
      windowAfterMinutes: rules.medWindowAfterMinutes,
      lateAfterHours: rules.lateRecordingAfterHours,
    });
    if (late) {
      await this.queueOperatingNotice({
        agencyId: session.agencyId,
        userId: session.userId,
        roleKey: null,
        type: "med.late_recording",
        title: "Late medication recording",
        body: `Recording ${med.name} at ${input.doseTime} after the window costs ${rules.pointsPerLateItem} point. You can dispute it for ${rules.disputeWindowDays} days.`,
        deepLink: "/meds",
        entityId: med.id,
        dedupeKey: `med.late_recording:${med.id}:${input.doseDate.slice(0, 10)}:${input.doseTime}`,
      });
    }
    await this.audit(
      session,
      "medication.dose_marked",
      `${session.fullName} marked ${med.name} ${input.doseTime} as ${input.status}`,
      "medication",
      med.id,
    );
  }

  // ===== MEDICATION ORDERS + RECONCILIATION (hosted) =====

  private async medOrderOrThrow(orderId: string) {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("medication_orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();
    throwIf(error, "Medication order not found.");
    if (!data) throw new Error("Medication order not found.");
    const order = mapMedicationOrder(data as Record<string, unknown>);
    if (order.agencyId !== session.agencyId) {
      throw new Error("Medication order not found.");
    }
    return { session, order };
  }

  private async reconciliationOrThrow(reconciliationId: string) {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("medication_reconciliations")
      .select("*")
      .eq("id", reconciliationId)
      .maybeSingle();
    throwIf(error, "Reconciliation not found.");
    if (!data) throw new Error("Reconciliation not found.");
    const recon = mapMedicationReconciliation(data as Record<string, unknown>);
    if (recon.agencyId !== session.agencyId) {
      throw new Error("Reconciliation not found.");
    }
    return { session, recon };
  }

  private async orderNameMaps(agencyId: string) {
    const [indRes, siteRes] = await Promise.all([
      this.client
        .from("individuals")
        .select("id,full_name,site_id")
        .eq("agency_id", agencyId),
      this.client.from("sites").select("id,name").eq("agency_id", agencyId),
    ]);
    const siteName = new Map(
      ((siteRes.data ?? []) as Record<string, unknown>[]).map((row) => [
        String(row.id),
        String(row.name ?? ""),
      ]),
    );
    const personName = new Map<string, string>();
    const personSite = new Map<string, string>();
    for (const row of (indRes.data ?? []) as Record<string, unknown>[]) {
      personName.set(String(row.id), String(row.full_name ?? ""));
      personSite.set(String(row.id), siteName.get(String(row.site_id)) ?? "");
    }
    return { personName, personSite };
  }

  private async reconciliationView(
    recon: MedicationReconciliation,
  ): Promise<MedicationReconciliationView> {
    const [itemRes, personRes] = await Promise.all([
      this.client
        .from("medication_reconciliation_items")
        .select("*")
        .eq("agency_id", recon.agencyId)
        .eq("reconciliation_id", recon.id),
      this.client
        .from("individuals")
        .select("full_name")
        .eq("id", recon.individualId)
        .maybeSingle(),
    ]);
    throwIf(itemRes.error, "Could not load reconciliation items.");
    const items = ((itemRes.data ?? []) as Record<string, unknown>[])
      .map(mapMedicationReconciliationItem)
      .sort((a, b) => a.medicationLabel.localeCompare(b.medicationLabel));
    const individualName = personRes.data
      ? String((personRes.data as Record<string, unknown>).full_name ?? "")
      : "";
    return { ...recon, items, individualName };
  }

  async listMedicationOrders(individualId: string): Promise<MedicationOrder[]> {
    const session = await this.requireSession();
    if (!canViewMedicationOrders(session.roleKey)) {
      throw new Error("You cannot view medication orders.");
    }
    const { data, error } = await this.client
      .from("medication_orders")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("created_at", { ascending: false });
    throwIf(error, "Could not load medication orders.");
    return ((data ?? []) as Record<string, unknown>[]).map(mapMedicationOrder);
  }

  async listMedicationOrderWorklist(): Promise<MedicationOrderView[]> {
    const session = await this.requireSession();
    if (!canViewMedicationOrders(session.roleKey)) {
      throw new Error("You cannot view medication orders.");
    }
    const today = todayIso();
    const { data, error } = await this.client
      .from("medication_orders")
      .select("*")
      .eq("agency_id", session.agencyId)
      .in("status", ["draft", "active"]);
    throwIf(error, "Could not load medication orders.");
    const { personName, personSite } = await this.orderNameMaps(session.agencyId);
    const views: MedicationOrderView[] = (
      (data ?? []) as Record<string, unknown>[]
    ).map((row) => {
      const order = mapMedicationOrder(row);
      return {
        ...order,
        expiry: orderExpiry(order, today),
        daysUntilReview: daysUntilReview(order, today),
        individualName: personName.get(order.individualId) ?? "",
        siteName: personSite.get(order.individualId) ?? "",
      };
    });
    // No cron: alert the nurse + Program Manager when a reviewer opens the
    // worklist. The notice RPC dedupes per order + review date.
    for (const view of views) {
      if (view.expiry === "ok") continue;
      const type =
        view.expiry === "expired" ? "med.order_expired" : "med.order_expiring";
      const when = view.endReviewDate ?? "";
      const phrase =
        view.expiry === "expired"
          ? "has passed its review date"
          : "is approaching its review date";
      const title =
        view.expiry === "expired"
          ? "Medication order expired"
          : "Medication order expiring";
      const body = `${view.medicationName} for ${view.individualName} ${phrase} (${when}). Review or renew the order.`;
      for (const roleKey of ["nurse", "program_manager"]) {
        await this.queueOperatingNotice({
          agencyId: session.agencyId,
          userId: null,
          roleKey,
          type,
          title,
          body,
          deepLink: "/medication-orders",
          entityId: view.id,
          dedupeKey: `${type}:${view.id}:${when}`,
        });
      }
    }
    return views.sort(
      (a, b) =>
        compareOrderExpiry(a, b) ||
        a.individualName.localeCompare(b.individualName),
    );
  }

  async createMedicationOrder(
    input: CreateMedicationOrderInput,
  ): Promise<MedicationOrder> {
    const session = await this.requireSession();
    if (!canManageMedicationOrders(session.roleKey)) {
      throw new Error("Only a nurse or Program Manager creates medication orders.");
    }
    const draft = validateOrderInput(input);
    const { data, error } = await this.client
      .from("medication_orders")
      .insert({
        agency_id: session.agencyId,
        individual_id: input.individualId,
        medication_name: draft.medicationName,
        dose: draft.dose,
        route: draft.route,
        schedule: draft.schedule,
        schedule_times: draft.scheduleTimes,
        is_prn: draft.isPrn,
        start_date: draft.startDate,
        end_review_date: draft.endReviewDate,
        prescriber_name: draft.prescriberName,
        reason: draft.reason,
        status: "draft",
        created_by: session.userId,
        created_by_name: session.fullName,
      })
      .select("*")
      .single();
    throwIf(error, "Could not create the medication order.");
    const order = mapMedicationOrder(data as Record<string, unknown>);
    await this.audit(
      session,
      "medication.order_created",
      `${session.fullName} drafted an order for ${draft.medicationName}`,
      "medication_order",
      order.id,
    );
    return order;
  }

  async updateMedicationOrder(
    orderId: string,
    patch: UpdateMedicationOrderInput,
  ): Promise<MedicationOrder> {
    const { session, order } = await this.medOrderOrThrow(orderId);
    if (!canManageMedicationOrders(session.roleKey)) {
      throw new Error("Only a nurse or Program Manager edits medication orders.");
    }
    if (order.status !== "draft") {
      throw new Error("Only a draft order can be edited. Discontinue and reorder instead.");
    }
    const draft = validateOrderInput({
      individualId: order.individualId,
      medicationName: patch.medicationName ?? order.medicationName,
      dose: patch.dose ?? order.dose,
      route: patch.route ?? order.route,
      schedule: patch.schedule ?? order.schedule,
      scheduleTimes: patch.scheduleTimes ?? order.scheduleTimes,
      isPrn: patch.isPrn ?? order.isPrn,
      startDate: patch.startDate ?? order.startDate,
      endReviewDate:
        patch.endReviewDate !== undefined ? patch.endReviewDate : order.endReviewDate,
      prescriberName: patch.prescriberName ?? order.prescriberName,
      reason: patch.reason ?? order.reason,
    });
    const { data, error } = await this.client
      .from("medication_orders")
      .update({
        medication_name: draft.medicationName,
        dose: draft.dose,
        route: draft.route,
        schedule: draft.schedule,
        schedule_times: draft.scheduleTimes,
        is_prn: draft.isPrn,
        start_date: draft.startDate,
        end_review_date: draft.endReviewDate,
        prescriber_name: draft.prescriberName,
        reason: draft.reason,
      })
      .eq("id", orderId)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not update the medication order.");
    return mapMedicationOrder(data as Record<string, unknown>);
  }

  async activateMedicationOrder(orderId: string): Promise<MedicationOrder> {
    const { session, order } = await this.medOrderOrThrow(orderId);
    if (!canManageMedicationOrders(session.roleKey)) {
      throw new Error("Only a nurse or Program Manager activates medication orders.");
    }
    if (order.status !== "draft") {
      throw new Error("Only a draft order can be activated.");
    }
    const fields = projectOrderToMedication(order);
    const now = new Date().toISOString();
    let medicationId = order.medicationId;
    if (medicationId) {
      const { error } = await this.client
        .from("medications")
        .update({
          name: fields.name,
          strength: fields.strength,
          kind: fields.kind,
          pills_per_day: fields.pillsPerDay,
          source_order_id: order.id,
        })
        .eq("id", medicationId)
        .eq("agency_id", session.agencyId);
      throwIf(error, "Could not update the medication.");
    } else {
      const { data, error } = await this.client
        .from("medications")
        .insert({
          agency_id: session.agencyId,
          individual_id: order.individualId,
          name: fields.name,
          strength: fields.strength,
          kind: fields.kind,
          controlled: false,
          pills_per_day: fields.pillsPerDay,
          remaining_pills: 0,
          source_order_id: order.id,
        })
        .select("id")
        .single();
      throwIf(error, "Could not create the medication.");
      medicationId = String((data as Record<string, unknown>).id);
    }
    const { error: invError } = await this.client.from("med_inventory").upsert(
      {
        agency_id: session.agencyId,
        individual_id: order.individualId,
        medication_id: medicationId,
        dose_times: fields.kind === "scheduled" ? fields.doseTimes : [],
      },
      { onConflict: "agency_id,medication_id" },
    );
    throwIf(invError, "Could not set the dose schedule.");
    const { data: updated, error: upError } = await this.client
      .from("medication_orders")
      .update({
        status: "active",
        medication_id: medicationId,
        activated_by: session.userId,
        activated_by_name: session.fullName,
        activated_at: now,
      })
      .eq("id", orderId)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(upError, "Could not activate the order.");
    const activated = mapMedicationOrder(updated as Record<string, unknown>);
    await this.audit(
      session,
      "medication.order_activated",
      `${session.fullName} activated the order for ${activated.medicationName}`,
      "medication_order",
      activated.id,
    );
    return activated;
  }

  async discontinueMedicationOrder(
    orderId: string,
    reason: string,
  ): Promise<MedicationOrder> {
    const { session, order } = await this.medOrderOrThrow(orderId);
    if (!canManageMedicationOrders(session.roleKey)) {
      throw new Error("Only a nurse or Program Manager discontinues medication orders.");
    }
    if (order.status !== "active") {
      throw new Error("Only an active order can be discontinued.");
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("Enter a reason for discontinuing the order.");
    const now = new Date().toISOString();
    if (order.medicationId) {
      // Clear the fed medication's MAR dose schedule so the dose leaves the MAR.
      const { error: invError } = await this.client
        .from("med_inventory")
        .update({ dose_times: [] })
        .eq("agency_id", session.agencyId)
        .eq("medication_id", order.medicationId);
      throwIf(invError, "Could not clear the MAR dose schedule.");
    }
    const { data, error } = await this.client
      .from("medication_orders")
      .update({
        status: "discontinued",
        discontinued_by: session.userId,
        discontinued_by_name: session.fullName,
        discontinued_at: now,
        discontinue_reason: trimmed,
      })
      .eq("id", orderId)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not discontinue the order.");
    const discontinued = mapMedicationOrder(data as Record<string, unknown>);
    await this.audit(
      session,
      "medication.order_discontinued",
      `${session.fullName} discontinued the order for ${discontinued.medicationName}: ${trimmed}`,
      "medication_order",
      discontinued.id,
    );
    return discontinued;
  }

  async listReconciliations(
    individualId: string,
  ): Promise<MedicationReconciliationView[]> {
    const session = await this.requireSession();
    if (!canViewMedicationOrders(session.roleKey)) {
      throw new Error("You cannot view medication reconciliations.");
    }
    const { data, error } = await this.client
      .from("medication_reconciliations")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("individual_id", individualId)
      .order("started_at", { ascending: false });
    throwIf(error, "Could not load reconciliations.");
    const recons = ((data ?? []) as Record<string, unknown>[]).map(
      mapMedicationReconciliation,
    );
    if (recons.length === 0) return [];
    const [itemRes, personRes] = await Promise.all([
      this.client
        .from("medication_reconciliation_items")
        .select("*")
        .eq("agency_id", session.agencyId)
        .in(
          "reconciliation_id",
          recons.map((row) => row.id),
        ),
      this.client
        .from("individuals")
        .select("full_name")
        .eq("id", individualId)
        .maybeSingle(),
    ]);
    throwIf(itemRes.error, "Could not load reconciliation items.");
    const items = ((itemRes.data ?? []) as Record<string, unknown>[]).map(
      mapMedicationReconciliationItem,
    );
    const individualName = personRes.data
      ? String((personRes.data as Record<string, unknown>).full_name ?? "")
      : "";
    return recons.map((recon) => ({
      ...recon,
      items: items
        .filter((item) => item.reconciliationId === recon.id)
        .sort((a, b) => a.medicationLabel.localeCompare(b.medicationLabel)),
      individualName,
    }));
  }

  async startReconciliation(input: {
    individualId: string;
    trigger: ReconciliationTrigger;
  }): Promise<MedicationReconciliationView> {
    const session = await this.requireSession();
    if (!canStartReconciliation(session.roleKey)) {
      throw new Error("Only a nurse, Program Manager, or house manager starts a reconciliation.");
    }
    if (!isReconciliationTrigger(input.trigger)) {
      throw new Error("Choose a valid reconciliation trigger.");
    }
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("medication_reconciliations")
      .insert({
        agency_id: session.agencyId,
        individual_id: input.individualId,
        trigger: input.trigger,
        status: "in_progress",
        started_by: session.userId,
        started_by_name: session.fullName,
        started_at: now,
      })
      .select("*")
      .single();
    throwIf(error, "Could not start the reconciliation.");
    const recon = mapMedicationReconciliation(data as Record<string, unknown>);
    const [ordersRes, medsRes] = await Promise.all([
      this.client
        .from("medication_orders")
        .select("*")
        .eq("agency_id", session.agencyId)
        .eq("individual_id", input.individualId),
      this.client
        .from("medications")
        .select("*")
        .eq("agency_id", session.agencyId)
        .eq("individual_id", input.individualId),
    ]);
    throwIf(ordersRes.error, "Could not load orders.");
    throwIf(medsRes.error, "Could not load medications.");
    const orders = ((ordersRes.data ?? []) as Record<string, unknown>[]).map(
      mapMedicationOrder,
    );
    const allMeds = ((medsRes.data ?? []) as Record<string, unknown>[]).map(
      mapMedication,
    );
    const suggested = buildReconciliationChecklist({
      activeOrders: orders.filter((row) => row.status === "active"),
      marMedications: allMeds.filter((med) => medicationStaysOnMar(med, orders)),
    });
    if (suggested.length) {
      const { error: insError } = await this.client
        .from("medication_reconciliation_items")
        .insert(
          suggested.map((item) => ({
            agency_id: session.agencyId,
            reconciliation_id: recon.id,
            order_id: item.orderId ?? null,
            medication_id: item.medicationId ?? null,
            medication_label: item.medicationLabel,
            decision: item.decision,
            discrepancy: Boolean(item.discrepancy),
            note: item.note ?? "",
          })),
        );
      throwIf(insError, "Could not seed the reconciliation checklist.");
    }
    return this.reconciliationView(recon);
  }

  async saveReconciliationItems(
    reconciliationId: string,
    items: ReconciliationItemInput[],
  ): Promise<MedicationReconciliationView> {
    const { session, recon } = await this.reconciliationOrThrow(reconciliationId);
    if (!canStartReconciliation(session.roleKey)) {
      throw new Error("Only a nurse, Program Manager, or house manager edits a reconciliation.");
    }
    if (recon.status !== "in_progress") {
      throw new Error("This reconciliation is already signed off.");
    }
    const validated = validateReconciliationItems(items);
    const { error: delError } = await this.client
      .from("medication_reconciliation_items")
      .delete()
      .eq("agency_id", session.agencyId)
      .eq("reconciliation_id", recon.id);
    throwIf(delError, "Could not update the reconciliation.");
    const { error: insError } = await this.client
      .from("medication_reconciliation_items")
      .insert(
        validated.map((item) => ({
          agency_id: session.agencyId,
          reconciliation_id: recon.id,
          order_id: item.orderId ?? null,
          medication_id: item.medicationId ?? null,
          medication_label: item.medicationLabel,
          decision: item.decision,
          discrepancy: item.discrepancy,
          note: item.note,
        })),
      );
    throwIf(insError, "Could not save the reconciliation decisions.");
    await this.client
      .from("medication_reconciliations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", recon.id)
      .eq("agency_id", session.agencyId);
    return this.reconciliationView(recon);
  }

  async signOffReconciliation(
    reconciliationId: string,
    input: { note: string; signatureName?: string },
  ): Promise<MedicationReconciliationView> {
    const { session, recon } = await this.reconciliationOrThrow(reconciliationId);
    if (!canSignReconciliation(session.roleKey)) {
      throw new Error("A nurse or Program Manager signs off a reconciliation.");
    }
    if (recon.status !== "in_progress") {
      throw new Error("This reconciliation is already signed off.");
    }
    const trimmed = input.note.trim();
    if (!trimmed) throw new Error("Add a sign-off note.");
    const { data: itemRows, error: itemError } = await this.client
      .from("medication_reconciliation_items")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("reconciliation_id", recon.id);
    throwIf(itemError, "Could not load reconciliation items.");
    if (((itemRows ?? []) as unknown[]).length === 0) {
      throw new Error("Record the medication decisions before signing off.");
    }
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("medication_reconciliations")
      .update({
        status: "completed",
        signed_off_by: session.userId,
        signed_off_by_name: input.signatureName?.trim() || session.fullName,
        signed_off_at: now,
        sign_off_note: trimmed,
      })
      .eq("id", recon.id)
      .eq("agency_id", session.agencyId)
      .select("*")
      .single();
    throwIf(error, "Could not sign off the reconciliation.");
    const completed = mapMedicationReconciliation(data as Record<string, unknown>);
    await this.audit(
      session,
      "medication.reconciliation_signed",
      `${completed.signedOffByName} signed off a medication reconciliation`,
      "medication_reconciliation",
      completed.id,
    );
    return this.reconciliationView(completed);
  }

  /**
   * Opening the bell queues the same gaps the unattended sweep writes.
   * A failure leaves the existing notices readable.
   */
  private async sweepOperatingReminders(session: SessionUser) {
    try {
      const rules = await this.loadOperatingRules(session.agencyId);
      const { data: siteRows, error: siteError } = await this.client
        .from("sites")
        .select("id, name")
        .eq("agency_id", session.agencyId);
      if (siteError || !siteRows) return;
      const { data: membershipRows } = await this.client
        .from("memberships")
        .select("user_id, role_key, role, site_id, expires_on")
        .eq("agency_id", session.agencyId);
      const clock = dueItemClock();
      const today = clock.doseDate;
      const memberships = (membershipRows ?? []).map((membership) => ({
        userId: String(membership.user_id),
        role: String(membership.role_key ?? membership.role ?? ""),
        siteId: membership.site_id ? String(membership.site_id) : null,
        expiresOn: membership.expires_on ? String(membership.expires_on).slice(0, 10) : null,
      }));
      const now = clock.now;
      const sites = [];
      for (const site of siteRows) {
        const siteId = String(site.id);
        if (!canAccessSite(session, siteId)) continue;
        try {
          const due = await this.getSiteDueItems(siteId);
          sites.push({
            id: siteId,
            name: String(site.name),
            items: due.items,
            medRecipients: reminderRecipientIds(memberships, siteId, ["dsp", "house_manager", "administrator", "nurse"], today),
            noteManagers: reminderRecipientIds(memberships, siteId, ["house_manager", "administrator"], today),
          });
        } catch {
          continue;
        }
      }
      const { data: events } = await this.client
        .from("audit_events")
        .select("action, target_id, actor_id, created_at")
        .eq("agency_id", session.agencyId)
        .in("action", ["medication.prn", "medication.prn_followup", "medication.prn_effectiveness"])
        .order("created_at", { ascending: false })
        .limit(500);
      const mapped = (events ?? []).map((event) => ({
        action: String(event.action),
        targetId: event.target_id ? String(event.target_id) : null,
        actorId: event.actor_id ? String(event.actor_id) : null,
        createdAt: String(event.created_at),
      }));
      const latestGiven = new Map<string, { createdAt: string; actorId: string | null }>();
      for (const event of mapped) {
        if (!event.targetId || (event.action !== "medication.prn" && event.action !== "medication.prn_followup")) continue;
        const prev = latestGiven.get(event.targetId);
        if (!prev || event.createdAt > prev.createdAt) {
          latestGiven.set(event.targetId, { createdAt: event.createdAt, actorId: event.actorId });
        }
      }
      const openIds = [...latestGiven.keys()];
      const { data: medRows } = openIds.length
        ? await this.client.from("medications").select("id, name, individual_id").in("id", openIds)
        : { data: [] };
      const individualIds = [...new Set((medRows ?? []).map((row) => String(row.individual_id)))];
      const { data: people } = individualIds.length
        ? await this.client.from("individuals").select("id, site_id").in("id", individualIds)
        : { data: [] };
      const siteByPerson = new Map((people ?? []).map((row) => [String(row.id), row.site_id ? String(row.site_id) : null]));
      const medById = new Map((medRows ?? []).map((row) => [String(row.id), row]));
      for (const notice of operatingReminderNotices({
        now,
        noteDay: clock.noteDay,
        unrecordedReminderMinutes: rules.unrecordedReminderMinutes,
        prnReminderRepeatMinutes: rules.prnReminderRepeatMinutes,
        prnFollowupMinutes: rules.prnFollowupMinutes,
        sites,
        prnFollowups: [...latestGiven].flatMap(([medicationId, given]) => {
          const med = medById.get(medicationId);
          if (!med) return [];
          const homeId = siteByPerson.get(String(med.individual_id)) ?? null;
          return [{
            medicationId,
            medName: String(med.name),
            createdAt: given.createdAt,
            stillOpen: prnFollowupStillOpen(mapped, medicationId, given.createdAt),
            actorId: given.actorId,
            homeRecipients: homeId
              ? reminderRecipientIds(memberships, homeId, ["house_manager", "administrator", "nurse"], today)
              : [],
          }];
        }),
      })) {
        if (!notice.userId) continue;
        await this.queueOperatingNotice({
          agencyId: session.agencyId,
          userId: notice.userId,
          roleKey: null,
          type: notice.type,
          title: notice.title,
          body: notice.body,
          deepLink: notice.deepLink,
          entityId: notice.entityId,
          dedupeKey: notice.dedupeKey,
        });
      }
      const loadedSiteIds = sites.map((site) => site.id);
      const liveIds = sites.flatMap((site) =>
        site.items.filter((item) => item.kind === "shift_note").map((item) => item.id),
      );
      if (loadedSiteIds.length) {
        const { data: loadedPeople } = await this.client
          .from("individuals")
          .select("id")
          .eq("agency_id", session.agencyId)
          .in("site_id", loadedSiteIds);
        await this.client.rpc("retire_stale_missing_note_notices", {
          p_agency_id: session.agencyId,
          p_service_date: clock.serviceDate,
          p_individual_ids: (loadedPeople ?? []).map((row) => String(row.id)),
          p_live_ids: liveIds,
        });
      }
    } catch {
      // The bell still opens if a reminder cannot be queued.
    }
  }

  /** Best-effort notice. A missing database function must not undo the action. */
  private async queueOperatingNotice(input: {
    agencyId: string;
    userId: string | null;
    roleKey: string | null;
    type: string;
    title: string;
    body: string;
    deepLink: string;
    entityId: string;
    dedupeKey: string;
  }) {
    const { error } = await this.client.rpc("queue_operating_notice", {
      p_agency_id: input.agencyId,
      p_user_id: input.userId,
      p_role_key: input.roleKey,
      p_type: input.type,
      p_title: input.title,
      p_body: input.body,
      p_deep_link: input.deepLink,
      p_entity_id: input.entityId,
      p_dedupe_key: input.dedupeKey,
    });
    void error;
  }
  // ===== LIFEPATH-P7 HOSTED (mileage tracking) =====
  // LIFEPATH-P7 (mileage): vehicle mileage log (HostedApi, Supabase).

  private async p7lib(): Promise<typeof import("./mileage")> {
    return await import("./mileage");
  }

  private requireMileageAccess(session: SessionUser) {
    this.requirePermission(session, "mileage.manage");
  }

  private mapMileageTrip(row: Record<string, unknown>): import("./types").MileageTrip {
    // Backfilled trips are flagged via a "[backfill]" marker on the stored
    // reason (no schema change); the mapper strips it back into `backfilled`.
    const rawReason = (row.reason as string) ?? "";
    return {
      id: row.id as string,
      agencyId: row.agency_id as string,
      siteId: row.site_id as string,
      tripDate: String(row.trip_date).slice(0, 10),
      odometerStart: Number(row.odometer_start),
      odometerEnd: Number(row.odometer_end),
      miles: Number(row.miles),
      riderIds: (row.rider_ids as string[]) ?? [],
      reason: stripBackfillMarker(rawReason),
      backfilled: hasBackfillMarker(rawReason),
      driverName: (row.driver_name as string) ?? "",
      signatureName: (row.signature_name as string) ?? "",
      createdBy: (row.created_by as string) ?? "",
      createdAt: row.created_at as string,
    };
  }

  private async fetchMileageTrip(session: SessionUser, tripId: string) {
    const { data, error } = await this.client
      .from("mileage_trips")
      .select("*")
      .eq("id", tripId)
      .maybeSingle();
    throwIf(error, "Could not load the mileage trip.");
    if (!data || (data as Record<string, unknown>).agency_id !== session.agencyId) {
      throw new Error("Mileage trip not found.");
    }
    return data as Record<string, unknown>;
  }

  private async assertSiteInAgency(session: SessionUser, siteId: string) {
    const { data, error } = await this.client
      .from("sites")
      .select("id")
      .eq("id", siteId)
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not verify the home.");
    if (!data) throw new Error("Home not found.");
  }

  private async assertRidersInSite(session: SessionUser, siteId: string, riderIds: string[]) {
    const { data, error } = await this.client
      .from("individuals")
      .select("id")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(error, "Could not verify the riders.");
    const ids = new Set((data ?? []).map((row) => (row as Record<string, unknown>).id as string));
    for (const riderId of riderIds) {
      if (!ids.has(riderId)) throw new Error("A rider is not part of this home.");
    }
  }

  private async validatedTripInput(
    input:
      | import("./types").AddMileageTripInput
      | import("./types").UpdateMileageTripInput,
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

  async listMileageTrips(
    siteId: string,
    month: string,
  ): Promise<import("./types").MileageTripView[]> {
    const { compareMileageTrips, splitMilesAmongRiders, nextMonthStart } =
      await this.p7lib();
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    await this.assertSiteInAgency(session, siteId);
    const { data, error } = await this.client
      .from("mileage_trips")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .gte("trip_date", `${month}-01`)
      .lt("trip_date", nextMonthStart(month))
      .order("trip_date", { ascending: true })
      .order("created_at", { ascending: true });
    throwIf(error, "Could not load the mileage log.");
    return (data ?? [])
      .map((row) => this.mapMileageTrip(row as Record<string, unknown>))
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

  /** All trips for one home, oldest first, for continuity checks and yearly rollups. */
  private async siteMileageTripsOrdered(session: SessionUser, siteId: string) {
    const { compareMileageTrips } = await this.p7lib();
    await this.assertSiteInAgency(session, siteId);
    const { data, error } = await this.client
      .from("mileage_trips")
      .select("id,trip_date,created_at,odometer_start,odometer_end,miles")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId);
    throwIf(error, "Could not load the mileage log.");
    return (data ?? [])
      .map((row) => this.mapMileageTrip(row as Record<string, unknown>))
      .sort(compareMileageTrips);
  }

  async getLastMileageOdometerEnd(siteId: string): Promise<number | null> {
    const { getLastOdometerEnd } = await this.p7lib();
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    return getLastOdometerEnd(
      await this.siteMileageTripsOrdered(session, siteId),
    );
  }

  async getPreviousMileageOdometerEnd(
    siteId: string,
    tripId: string,
  ): Promise<number | null> {
    const { getPreviousOdometerEnd } = await this.p7lib();
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    return getPreviousOdometerEnd(
      await this.siteMileageTripsOrdered(session, siteId),
      tripId,
    );
  }

  async getMileageYearlySummary(
    siteId: string,
    year: number,
    individualIds: string[],
  ): Promise<import("./mileage").MileageYearlySummary> {
    const { summarizeYearlyMileage, assertCanViewMileageYearlySummary } = await this.p7lib();
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    assertCanViewMileageYearlySummary(session);
    await this.assertSiteInAgency(session, siteId);
    const { data, error } = await this.client
      .from("mileage_trips")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .gte("trip_date", `${year}-01-01`)
      .lt("trip_date", `${year + 1}-01-01`);
    throwIf(error, "Could not load the yearly mileage summary.");
    const trips = (data ?? []).map((row) =>
      this.mapMileageTrip(row as Record<string, unknown>),
    );
    return summarizeYearlyMileage(trips, individualIds, year);
  }

  async getMileageYearlySummaryAllSites(
    year: number,
    sites: Array<{ siteId: string; siteName: string; individualIds: string[] }>,
  ): Promise<import("./mileage").MileageAgencyYearlySummary> {
    const { summarizeAgencyYearlyMileage, assertCanViewMileageYearlySummary } =
      await this.p7lib();
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    assertCanViewMileageYearlySummary(session);
    for (const site of sites) {
      await this.assertSiteInAgency(session, site.siteId);
    }
    const { data, error } = await this.client
      .from("mileage_trips")
      .select("*")
      .eq("agency_id", session.agencyId)
      .gte("trip_date", `${year}-01-01`)
      .lt("trip_date", `${year + 1}-01-01`);
    throwIf(error, "Could not load the agency-wide yearly mileage summary.");
    const trips = (data ?? []).map((row) =>
      this.mapMileageTrip(row as Record<string, unknown>),
    );
    const tripsBySite = new Map<string, import("./types").MileageTrip[]>();
    for (const site of sites) {
      tripsBySite.set(
        site.siteId,
        trips.filter((trip) => trip.siteId === site.siteId),
      );
    }
    return summarizeAgencyYearlyMileage(tripsBySite, sites, year);
  }

  // ===== SITE DETAIL API (program-site detail view, read-focused) =====
  /**
   * QA audit history for one program site, newest first. Read-only; the
   * audit workflow itself lives elsewhere. RLS on qa_audits already scopes
   * rows to the caller's agency; we additionally enforce site access and
   * the audit.read permission here.
   */
  async listQaAuditHistory(siteId: string): Promise<QaAuditSummary[]> {
    const session = await this.requireSession();
    this.requirePermission(session, "audit.read");
    if (!canAccessSite(session, siteId)) return [];
    await this.assertSiteInAgency(session, siteId);
    const { data, error } = await this.client
      .from("qa_audits")
      .select("id, year, quarter, status, auditor_name, signed_at, created_at, score")
      .eq("agency_id", session.agencyId)
      .eq("site_id", siteId)
      .order("year", { ascending: false })
      .order("quarter", { ascending: false });
    throwIf(error, "Could not load QA audit history.");
    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        year: Number(r.year),
        quarter: Number(r.quarter),
        status: (r.status === "finalized" || r.status === "in_progress" ? r.status : "draft") as QaAuditSummary["status"],
        auditorName: String(r.auditor_name ?? ""),
        signedAt: (r.signed_at as string | null) ?? null,
        createdAt: String(r.created_at ?? ""),
        scoreJson: (r.score as unknown) ?? null,
      };
    });
  }

  /** The log is one unbroken chain: a trip's start must continue the previous end. */
  private async assertOdometerContinuity(
    session: SessionUser,
    siteId: string,
    odometerStart: number,
    excludeTripId?: string,
  ) {
    const {
      validateOdometerContinuity,
      getLastOdometerEnd,
      getPreviousOdometerEnd,
    } = await this.p7lib();
    const trips = await this.siteMileageTripsOrdered(session, siteId);
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
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    await this.assertSiteInAgency(session, input.siteId);
    await this.assertRidersInSite(session, input.siteId, input.riderIds);
    const valid = await this.validatedTripInput(input);
    const backfill = await this.resolveBackfill(session, input.backfill);
    if (!backfill) {
      await this.assertOdometerContinuity(session, input.siteId, valid.odometerStart);
    }
    const storedReason = backfill
      ? withBackfillMarker(valid.reason.trim())
      : valid.reason.trim();
    const { data, error } = await this.client
      .from("mileage_trips")
      .insert({
        agency_id: session.agencyId,
        site_id: input.siteId,
        trip_date: valid.tripDate,
        odometer_start: valid.odometerStart,
        odometer_end: valid.odometerEnd,
        miles: valid.miles,
        rider_ids: [...new Set(valid.riderIds)],
        reason: storedReason,
        driver_name: valid.driverName.trim(),
        signature_name: input.signatureName.trim(),
        created_by: session.userId,
      })
      .select("*")
      .single();
    throwIf(error, "Could not save the mileage trip.");
    const trip = this.mapMileageTrip(data as Record<string, unknown>);
    await this.audit(
      session,
      "mileage.trip_added",
      `${session.fullName} logged a ${trip.miles}-mile trip on ${trip.tripDate}${backfill ? " [backfilled]" : ""}`,
      "mileage_trip",
      trip.id,
    );
    return trip;
  }

  async updateMileageTrip(
    tripId: string,
    patch: import("./types").UpdateMileageTripInput,
  ): Promise<import("./types").MileageTrip> {
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    const row = await this.fetchMileageTrip(session, tripId);
    const existing = this.mapMileageTrip(row);
    const nextRiders = patch.riderIds ?? existing.riderIds;
    await this.assertRidersInSite(session, existing.siteId, nextRiders);
    const valid = await this.validatedTripInput(patch, existing);
    const backfill = (await this.resolveBackfill(session, patch.backfill)) || existing.backfilled;
    // A trip already marked backfilled stays exempt from the chain: it was
    // knowingly logged out of sequence by an authorized backfiller, so later
    // edits (reason, driver, …) must not be forced back into continuity.
    if (!backfill) {
      await this.assertOdometerContinuity(
        session,
        existing.siteId,
        valid.odometerStart,
        existing.id,
      );
    }
    const storedReason = backfill
      ? withBackfillMarker(valid.reason.trim())
      : stripBackfillMarker(valid.reason.trim());
    const { data, error } = await this.client
      .from("mileage_trips")
      .update({
        trip_date: valid.tripDate,
        odometer_start: valid.odometerStart,
        odometer_end: valid.odometerEnd,
        miles: valid.miles,
        rider_ids: [...new Set(valid.riderIds)],
        reason: storedReason,
        driver_name: valid.driverName.trim(),
        signature_name: (patch.signatureName ?? existing.signatureName).trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", tripId)
      .select("*")
      .single();
    throwIf(error, "Could not update the mileage trip.");
    const trip = this.mapMileageTrip(data as Record<string, unknown>);
    await this.audit(
      session,
      "mileage.trip_updated",
      `${session.fullName} updated the ${trip.tripDate} mileage trip (${trip.miles} miles)`,
      "mileage_trip",
      trip.id,
    );
    return trip;
  }

  async deleteMileageTrip(tripId: string): Promise<void> {
    const session = await this.requireSession();
    this.requireMileageAccess(session);
    const row = await this.fetchMileageTrip(session, tripId);
    const trip = this.mapMileageTrip(row);
    const { error } = await this.client.from("mileage_trips").delete().eq("id", tripId);
    throwIf(error, "Could not delete the mileage trip.");
    await this.audit(
      session,
      "mileage.trip_deleted",
      `${session.fullName} removed the ${trip.tripDate} mileage trip (${trip.miles} miles)`,
      "mileage_trip",
      trip.id,
    );
  }

  // ===== E-SIGNATURES (hosted) =====

  /**
   * Document lock for hosted writes: a document is locked once ANY signature
   * event exists for it. Racy by nature (two concurrent writers) — the
   * authoritative gate is the sibling-owned RLS/trigger layer; this gives the
   * same user-facing error before we send the write.
   */
  private async assertDocumentUnlocked(
    session: SessionUser,
    documentType: SignableDocumentType,
    documentId: string,
  ): Promise<void> {
    const events = await this.getSignatureEvents(documentType, documentId);
    // Per-line training initials (`line:<requirementId>:v<n>`) never lock the
    // sheet — only whole-document signature events do.
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
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("user_signatures")
      .select(
        "signature_path, initials_path, adopted_at, consent_at, consent_text_version",
      )
      .eq("user_id", session.userId)
      .maybeSingle();
    throwIf(error, "Could not load your signature.");
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      signaturePath: row.signature_path as string,
      initialsPath: row.initials_path as string,
      adoptedAt: row.adopted_at as string,
      consentAt: row.consent_at as string,
      consentTextVersion: row.consent_text_version as string,
    };
  }

  async adoptSignature(input: AdoptSignatureInput): Promise<AdoptedSignature> {
    const session = await this.requireSession();
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
    // Upload the PNG bytes first; the service reads user_signatures from the
    // session JWT.
    const uploads: Array<[dataUrl: string, path: string]> = [
      [input.signatureDataUrl, `${session.userId}/signature.png`],
      [input.initialsDataUrl, `${session.userId}/initials.png`],
    ];
    for (const [dataUrl, path] of uploads) {
      const { error } = await this.client.storage
        .from("user-signatures")
        .upload(path, dataUrlToBlob(dataUrl), {
          upsert: true,
          contentType: "image/png",
        });
      throwIf(error, "Could not save your signature images.");
    }
    const now = new Date().toISOString();
    const consentTextVersion = input.consentTextVersion.trim();
    const { error: upsertError } = await this.client
      .from("user_signatures")
      .upsert(
        {
          user_id: session.userId,
          signature_path: `${session.userId}/signature.png`,
          initials_path: `${session.userId}/initials.png`,
          adopted_at: now,
          consent_at: now,
          consent_text_version: consentTextVersion,
        },
        { onConflict: "user_id" },
      );
    throwIf(upsertError, "Could not save your signature.");
    await this.audit(
      session,
      "signature.adopted",
      `${session.fullName} adopted an electronic signature (consent ${consentTextVersion})`,
      "user_signature",
      session.userId,
    );
    return {
      signaturePath: `${session.userId}/signature.png`,
      initialsPath: `${session.userId}/initials.png`,
      adoptedAt: now,
      consentAt: now,
      consentTextVersion,
    };
  }

  async applySignature(
    input: ApplySignatureInput,
  ): Promise<ApplySignatureResult> {
    const session = await this.requireSession();
    // The edge function re-validates everything against the session JWT; this
    // just rejects malformed input early.
    if (
      !input ||
      typeof input.documentType !== "string" ||
      !input.documentType.trim() ||
      typeof input.documentId !== "string" ||
      !input.documentId.trim() ||
      typeof input.fieldName !== "string" ||
      !input.fieldName.trim() ||
      (input.kind !== "signature" && input.kind !== "initials") ||
      !input.documentPayload ||
      typeof input.documentPayload !== "object" ||
      Array.isArray(input.documentPayload)
    ) {
      throw new Error("A valid signature request is required.");
    }
    // The edge-function contract is snake_case (see
    // supabase/functions/apply-signature/index.ts). 4xx bodies carry
    // {error, code}; code "reauth_required" opens the password sheet.
    const result = await invokeEdgeFunction<{
      event_id?: string;
      signed_at?: string;
      document_hash?: string;
    }>(this.client, "apply-signature", {
      document_type: input.documentType.trim(),
      document_id: input.documentId.trim(),
      field_name: input.fieldName.trim(),
      signature_kind: input.kind,
      document_payload: input.documentPayload,
      agency_id: session.agencyId,
      device_id: getDeviceId(),
    });
    if (!result.event_id || !result.signed_at || !result.document_hash) {
      throw new Error("The signature service returned an unexpected response.");
    }
    return {
      eventId: result.event_id,
      signedAt: result.signed_at,
      documentHash: result.document_hash,
    };
  }

  /**
   * 13 CSR 65-3.050 second identification component (hosted): the password is
   * verified inside the apply-signature edge function against the Auth API —
   * never trusted from a client-side claim, never stored. A success covers
   * REAUTH_WINDOW_MS of signing; 401 means the password was wrong, 429 means
   * the attempt budget is spent for now.
   */
  async verifySigningPassword(password: string): Promise<{ reauthAt: string }> {
    await this.requireSession();
    const result = await invokeEdgeFunction<{ reauth_at?: string }>(
      this.client,
      "apply-signature",
      { action: "reauth", password, device_id: getDeviceId() },
    );
    if (!result.reauth_at) {
      throw new Error("The signature service returned an unexpected response.");
    }
    return { reauthAt: result.reauth_at };
  }

  /**
   * 13 CSR 65-3.050: report a client-observed audit event (login, logout, or
   * a signed-document view). The edge function records it with the
   * server-observed IP; failures are swallowed so audit logging can never
   * break the login/logout/view it is observing.
   */
  async logSignatureAudit(input: LogSignatureAuditInput): Promise<void> {
    try {
      await this.requireSession();
      await invokeEdgeFunction<{ ok?: boolean }>(this.client, "apply-signature", {
        action: "log",
        log_action: input.action,
        document_type: input.documentType ?? null,
        document_id: input.documentId ?? null,
        field_name: input.fieldName ?? null,
        device_id: getDeviceId(),
        details: input.details ?? null,
      });
    } catch {
      // Audit logging must never break the action it observes.
    }
  }

  async getSignatureAuditLog(input?: {
    documentType?: SignableDocumentType;
    documentId?: string;
  }): Promise<SignatureAuditRecord[]> {
    const session = await this.requireSession();
    let query = this.client
      .from("signature_audit_log")
      .select("*")
      .eq("user_id", session.userId)
      .order("created_at", { ascending: true });
    if (input?.documentType) query = query.eq("document_type", input.documentType);
    if (input?.documentId) query = query.eq("document_id", input.documentId);
    const { data, error } = await query;
    throwIf(error, "Could not load the signature audit log.");
    return (data ?? []).map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      agencyId: String(row.agency_id ?? ""),
      action: String(row.action),
      documentType: (row.document_type as string | null) ?? null,
      documentId: (row.document_id as string | null) ?? null,
      fieldName: (row.field_name as string | null) ?? null,
      createdAt: String(row.created_at),
      deviceId: (row.device_id as string | null) ?? null,
      ipAddress: (row.ip_address as string | null) ?? null,
      userAgent: (row.user_agent as string | null) ?? null,
      details: (row.details as Record<string, unknown> | null) ?? null,
    }));
  }

  async getSignatureEvents(
    documentType: SignableDocumentType,
    documentId: string,
  ): Promise<SignatureEvent[]> {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("signature_events")
      .select("*")
      .eq("agency_id", session.agencyId)
      .eq("document_type", documentType)
      .eq("document_id", documentId)
      .order("signed_at", { ascending: true });
    throwIf(error, "Could not load signature events.");
    const rows = (data ?? []) as Record<string, unknown>[];
    // Resolve signer display names in one batch (signature_events stores only
    // the signer_user_id by design).
    const signerIds = [
      ...new Set(
        rows.map((r) => r.signer_user_id as string).filter(Boolean),
      ),
    ];
    const names = new Map<string, string>();
    if (signerIds.length > 0) {
      const { data: profiles } = await this.client
        .from("profiles")
        .select("id, full_name")
        .in("id", signerIds);
      for (const p of (profiles ?? []) as Array<{
        id: string;
        full_name: string;
      }>) {
        names.set(p.id, p.full_name);
      }
    }
    return rows.map((row) =>
      this.mapSignatureEvent(
        row,
        names.get(row.signer_user_id as string) ?? "Unknown signer",
      ),
    );
  }

  private mapSignatureEvent(
    row: Record<string, unknown>,
    signerName: string,
  ): SignatureEvent {
    return {
      id: row.id as string,
      agencyId: (row.agency_id as string) ?? "",
      userId: row.signer_user_id as string,
      signerName,
      documentType: row.document_type as SignableDocumentType,
      documentId: row.document_id as string,
      fieldName: row.field_name as string,
      kind: (row.kind as "signature" | "initials") ?? "signature",
      documentHash: row.document_hash as string,
      signedAt: row.signed_at as string,
    };
  }

  async getSignatureImageUrl(path: string): Promise<string> {
    await this.requireSession();
    // Download the object and return a PNG data URL, exactly like LocalApi.
    // A storage signed URL is NOT interchangeable here: the shift-note save
    // path validates the adopted signature with assertAdoptableSignature,
    // which only accepts PNG data URLs, so handing back a signed URL made
    // every hosted shift-note save throw "Signature must be a PNG image."
    // (simulation batch 9, Finding 1). Display callers use the value as an
    // <img> src, which a data URL serves equally well. Failure contract
    // matches LocalApi: throw.
    const { data, error } = await this.client.storage
      .from("user-signatures")
      .download(path);
    throwIf(error, "Could not load the signature image.");
    if (!data || data.size === 0) throw new Error("Could not load the signature image.");
    return blobToDataUrl(data);
  }

  async getSignatureSettings(): Promise<SignatureSettings> {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("agency_signature_settings")
      .select("allow_draw, allow_type, allow_upload")
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load signature settings.");
    const row = data as Record<string, unknown> | null;
    if (!row) return { allowDraw: true, allowType: true, allowUpload: true };
    return {
      allowDraw: Boolean(row.allow_draw),
      allowType: Boolean(row.allow_type),
      allowUpload: Boolean(row.allow_upload),
    };
  }

  async updateSignatureSettings(
    input: SignatureSettings,
  ): Promise<SignatureSettings> {
    const session = await this.requireSession();
    if (
      session.roleKey !== "administrator" &&
      session.role !== "administrator"
    ) {
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
    const { error } = await this.client.from("agency_signature_settings").upsert(
      {
        agency_id: session.agencyId,
        allow_draw: next.allowDraw,
        allow_type: next.allowType,
        allow_upload: next.allowUpload,
      },
      { onConflict: "agency_id" },
    );
    throwIf(error, "Could not save signature settings.");
    await this.audit(
      session,
      "signature.settings_updated",
      `${session.fullName} updated the signature adoption methods`,
      "agency",
      session.agencyId,
    );
    return next;
  }

  // ======================================================================
  // RECOGNITION (winners-only)
  // ======================================================================

  private async recognitionNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return names;
    const { data } = await this.client
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      names.set(row.id as string, (row.full_name as string) || "Staff member");
    }
    return names;
  }

  private async activeMemberInRole(
    agencyId: string,
    userId: string,
    roleKey: string,
  ): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await this.client
      .from("memberships")
      .select("user_id")
      .eq("agency_id", agencyId)
      .eq("user_id", userId)
      .eq("role_key", roleKey)
      .or(`expires_on.is.null,expires_on.gte.${today}`)
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  private canSeeRecognitionFeedback(session: SessionUser): boolean {
    return hasPermission(session, "recognition.manage");
  }

  /**
   * Manager feedback scope: administrators (administrator/compliance_admin)
   * see the whole agency (null); other recognition.manage holders see only
   * pairs at sites they are actively assigned to. Mirrors
   * private.recognition_manager_view in the recognition migration.
   */
  private async recognitionManagerScope(
    session: SessionUser,
  ): Promise<Set<string> | null> {
    if (
      session.roleKey === "administrator" ||
      session.roleKey === "compliance_admin"
    ) {
      return null;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: m } = await this.client
      .from("memberships")
      .select("site_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", session.userId)
      .not("site_id", "is", null)
      .or(`expires_on.is.null,expires_on.gte.${today}`);
    const { data: a } = await this.client
      .from("staff_assignments")
      .select("site_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", session.userId)
      .not("site_id", "is", null)
      .lte("starts_on", today)
      .or(`ends_on.is.null,ends_on.gte.${today}`);
    const sites = new Set<string>();
    for (const r of ((m ?? []) as Record<string, unknown>[]).concat(
      (a ?? []) as Record<string, unknown>[],
    )) {
      if (r.site_id) sites.add(r.site_id as string);
    }
    return sites;
  }

  /** Active site ids (memberships + staff_assignments) for each user. */
  private async sitesOfUsers(
    agencyId: string,
    userIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (userIds.length === 0) return map;
    const today = new Date().toISOString().slice(0, 10);
    const add = (userId: string, siteId: unknown) => {
      if (!siteId) return;
      let set = map.get(userId);
      if (!set) {
        set = new Set<string>();
        map.set(userId, set);
      }
      set.add(siteId as string);
    };
    const { data: m } = await this.client
      .from("memberships")
      .select("user_id, site_id")
      .eq("agency_id", agencyId)
      .in("user_id", userIds)
      .not("site_id", "is", null)
      .or(`expires_on.is.null,expires_on.gte.${today}`);
    const { data: a } = await this.client
      .from("staff_assignments")
      .select("user_id, site_id")
      .eq("agency_id", agencyId)
      .in("user_id", userIds)
      .not("site_id", "is", null)
      .lte("starts_on", today)
      .or(`ends_on.is.null,ends_on.gte.${today}`);
    for (const r of ((m ?? []) as Record<string, unknown>[]).concat(
      (a ?? []) as Record<string, unknown>[],
    )) {
      add(r.user_id as string, r.site_id);
    }
    return map;
  }

  /** Whether two members share an active site (assigned together). */
  private async shareActiveSite(
    agencyId: string,
    userA: string,
    userB: string,
  ): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await this.client
      .from("memberships")
      .select("user_id, site_id")
      .eq("agency_id", agencyId)
      .in("user_id", [userA, userB])
      .or(`expires_on.is.null,expires_on.gte.${today}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    const sitesA = new Set(
      rows
        .filter((r) => r.user_id === userA && r.site_id)
        .map((r) => r.site_id as string),
    );
    // Active staff_assignments also count as a shared assignment
    // (mirrors the SQL shared_active_site() helper).
    const { data: asg } = await this.client
      .from("staff_assignments")
      .select("user_id, site_id")
      .eq("agency_id", agencyId)
      .in("user_id", [userA, userB])
      .lte("starts_on", today)
      .or(`ends_on.is.null,ends_on.gte.${today}`);
    for (const r of ((asg ?? []) as Record<string, unknown>[])) {
      if (r.user_id === userA && r.site_id) sitesA.add(r.site_id as string);
    }
    if (sitesA.size === 0) return false;
    const inB = (r: Record<string, unknown>) =>
      r.user_id === userB && r.site_id && sitesA.has(r.site_id as string);
    return (
      rows.some(inB) ||
      ((asg ?? []) as Record<string, unknown>[]).some(inB)
    );
  }

  async submitDspHmRating(input: {
    hmUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").DspHmRating> {
    const session = await this.requireSession();
    this.requirePermission(session, "recognition.rate_hm");
    if (session.roleKey !== "dsp") {
      throw new Error(
        "Only direct support professionals rate house managers.",
      );
    }
    if (!isValidRating(input.rating)) {
      throw new Error("Rating must be a whole number from 1 to 5.");
    }
    if (input.hmUserId === session.userId) {
      throw new Error("You cannot rate yourself.");
    }
    const isHm = await this.activeMemberInRole(
      session.agencyId,
      input.hmUserId,
      "house_manager",
    );
    if (!isHm) throw new Error("That house manager was not found.");
    const sharesSite = await this.shareActiveSite(
      session.agencyId,
      session.userId,
      input.hmUserId,
    );
    if (!sharesSite) {
      throw new Error("You can only rate the house manager of your assigned site.");
    }
    // Atomic submission: the submit_dsp_hm_rating RPC upserts the current
    // value, lets the trigger append history, and queues the reviewed HM's
    // notification in ONE transaction — a change can never succeed while its
    // notification fails. The client prechecks above give clear errors; the
    // RPC re-validates authoritatively.
    const { data: rpc, error: rpcError } = await this.client.rpc(
      "submit_dsp_hm_rating",
      { p_hm_id: input.hmUserId, p_rating: input.rating },
    );
    throwIf(rpcError, "Could not save your rating.");
    const result = rpc as { changed: boolean; rating: number } | null;
    const { data: saved, error: readError } = await this.client
      .from("dsp_hm_ratings")
      .select("id, agency_id, dsp_id, hm_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("dsp_id", session.userId)
      .eq("hm_id", input.hmUserId)
      .single();
    throwIf(readError, "Could not save your rating.");
    void result?.changed;
    return mapDspHmRating(saved as Record<string, unknown>);
  }

  async getMyDspHmRating(
    hmUserId: string,
  ): Promise<import("../recognition/recognition").DspHmRating | null> {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("dsp_hm_ratings")
      .select("id, agency_id, dsp_id, hm_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("dsp_id", session.userId)
      .eq("hm_id", hmUserId)
      .maybeSingle();
    throwIf(error, "Could not load your rating.");
    return data ? mapDspHmRating(data as Record<string, unknown>) : null;
  }

  async listDspHmRatingsAboutMe(): Promise<
    import("../recognition/recognition").DspHmRatingWithHistory[]
  > {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("dsp_hm_ratings")
      .select("id, agency_id, dsp_id, hm_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("hm_id", session.userId)
      .order("updated_at", { ascending: false });
    throwIf(error, "Could not load ratings about you.");
    const rows = (data ?? []) as Record<string, unknown>[];
    const names = await this.recognitionNames(
      rows.flatMap((r) => [r.dsp_id as string, r.hm_id as string]),
    );
    const history = await this.recognitionHistory(
      "dsp_hm_rating_history",
      "rating_id",
      rows.map((r) => r.id as string),
    );
    return rows.map((r) => ({
      ...mapDspHmRating(r),
      hmName: names.get(r.hm_id as string) ?? "Staff member",
      dspName: names.get(r.dsp_id as string) ?? "Staff member",
      history: history.get(r.id as string) ?? [],
    }));
  }

  async submitHmDspReview(input: {
    dspUserId: string;
    rating: number;
  }): Promise<import("../recognition/recognition").HmDspReview> {
    const session = await this.requireSession();
    this.requirePermission(session, "recognition.review_dsp");
    if (session.roleKey !== "house_manager") {
      throw new Error("Only house managers review DSPs.");
    }
    if (!isValidRating(input.rating)) {
      throw new Error("Rating must be a whole number from 1 to 5.");
    }
    if (input.dspUserId === session.userId) {
      throw new Error("You cannot review yourself.");
    }
    const isDsp = await this.activeMemberInRole(
      session.agencyId,
      input.dspUserId,
      "dsp",
    );
    if (!isDsp) throw new Error("That DSP was not found.");
    const sharesSite = await this.shareActiveSite(
      session.agencyId,
      session.userId,
      input.dspUserId,
    );
    if (!sharesSite) {
      throw new Error("You can only review DSPs at your assigned site.");
    }
    const { data: existing } = await this.client
      .from("hm_dsp_reviews")
      .select("id, agency_id, hm_id, dsp_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("hm_id", session.userId)
      .eq("dsp_id", input.dspUserId)
      .maybeSingle();
    const current = existing as Record<string, unknown> | null;
    if (current && Number(current.rating) === input.rating) {
      return mapHmDspReview(current);
    }
    // Atomic submission: the submit_hm_dsp_review RPC upserts the current
    // value, lets the trigger append history, and queues the reviewed DSP's
    // notification in ONE transaction. The client prechecks above give clear
    // errors; the RPC re-validates authoritatively.
    const { error: rpcError } = await this.client.rpc("submit_hm_dsp_review", {
      p_dsp_id: input.dspUserId,
      p_rating: input.rating,
    });
    throwIf(rpcError, "Could not save your review.");
    const { data: saved, error: readError } = await this.client
      .from("hm_dsp_reviews")
      .select("id, agency_id, hm_id, dsp_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("hm_id", session.userId)
      .eq("dsp_id", input.dspUserId)
      .single();
    throwIf(readError, "Could not save your review.");
    return mapHmDspReview(saved as Record<string, unknown>);
  }

  async getMyHmDspReview(
    dspUserId: string,
  ): Promise<import("../recognition/recognition").HmDspReview | null> {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("hm_dsp_reviews")
      .select("id, agency_id, hm_id, dsp_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("hm_id", session.userId)
      .eq("dsp_id", dspUserId)
      .maybeSingle();
    throwIf(error, "Could not load your review.");
    return data ? mapHmDspReview(data as Record<string, unknown>) : null;
  }

  async listHmDspReviewsAboutMe(): Promise<
    import("../recognition/recognition").HmDspReviewWithHistory[]
  > {
    const session = await this.requireSession();
    const { data, error } = await this.client
      .from("hm_dsp_reviews")
      .select("id, agency_id, hm_id, dsp_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .eq("dsp_id", session.userId)
      .order("updated_at", { ascending: false });
    throwIf(error, "Could not load reviews about you.");
    const rows = (data ?? []) as Record<string, unknown>[];
    const names = await this.recognitionNames(
      rows.flatMap((r) => [r.hm_id as string, r.dsp_id as string]),
    );
    const history = await this.recognitionHistory(
      "hm_dsp_review_history",
      "review_id",
      rows.map((r) => r.id as string),
    );
    return rows.map((r) => ({
      ...mapHmDspReview(r),
      hmName: names.get(r.hm_id as string) ?? "Staff member",
      dspName: names.get(r.dsp_id as string) ?? "Staff member",
      history: history.get(r.id as string) ?? [],
    }));
  }

  private async recognitionHistory(
    table: string,
    parentColumn: string,
    parentIds: string[],
  ): Promise<
    Map<string, import("../recognition/recognition").RatingHistoryEntry[]>
  > {
    const grouped = new Map<
      string,
      import("../recognition/recognition").RatingHistoryEntry[]
    >();
    if (parentIds.length === 0) return grouped;
    const columns =
      `id, agency_id, ${parentColumn}, old_rating, new_rating, changed_by, created_at` as "*";
    const { data, error } = await this.client
      .from(table)
      .select(columns)
      .in(parentColumn, parentIds)
      .order("created_at", { ascending: false });
    throwIf(error, "Could not load change history.");
    const rows = (data ?? []) as Record<string, unknown>[];
    const names = await this.recognitionNames(
      rows.map((r) => r.changed_by as string),
    );
    for (const r of rows) {
      const key = r[parentColumn] as string;
      const list = grouped.get(key) ?? [];
      list.push({
        id: r.id as string,
        oldRating: r.old_rating == null ? null : Number(r.old_rating),
        newRating: Number(r.new_rating),
        changedBy: r.changed_by as string,
        changedByName: names.get(r.changed_by as string) ?? null,
        createdAt: r.created_at as string,
      });
      grouped.set(key, list);
    }
    return grouped;
  }

  async listRecognitionFeedback(): Promise<
    import("../recognition/recognition").RecognitionFeedback
  > {
    const session = await this.requireSession();
    if (!this.canSeeRecognitionFeedback(session)) {
      throw new Error("You do not have permission to do that.");
    }
    const { data: ratings, error: ratingsError } = await this.client
      .from("dsp_hm_ratings")
      .select("id, agency_id, dsp_id, hm_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .order("updated_at", { ascending: false });
    throwIf(ratingsError, "Could not load ratings.");
    const { data: reviews, error: reviewsError } = await this.client
      .from("hm_dsp_reviews")
      .select("id, agency_id, hm_id, dsp_id, rating, updated_at")
      .eq("agency_id", session.agencyId)
      .order("updated_at", { ascending: false });
    throwIf(reviewsError, "Could not load reviews.");
    let ratingRows = (ratings ?? []) as Record<string, unknown>[];
    let reviewRows = (reviews ?? []) as Record<string, unknown>[];
    // "Appropriate managers": administrators see the whole agency; other
    // recognition.manage holders (PM) see only pairs they
    // share an active site with. Mirrors private.recognition_manager_view.
    const scope = await this.recognitionManagerScope(session);
    if (scope) {
      const partyIds = [
        ...new Set([
          ...ratingRows.flatMap((r) => [r.dsp_id as string, r.hm_id as string]),
          ...reviewRows.flatMap((r) => [r.hm_id as string, r.dsp_id as string]),
        ]),
      ];
      const sitesByUser = await this.sitesOfUsers(
        session.agencyId,
        partyIds,
      );
      const visible = (a: string, b: string) => {
        for (const id of [a, b]) {
          for (const s of sitesByUser.get(id) ?? []) {
            if (scope.has(s)) return true;
          }
        }
        return false;
      };
      ratingRows = ratingRows.filter((r) =>
        visible(r.dsp_id as string, r.hm_id as string),
      );
      reviewRows = reviewRows.filter((r) =>
        visible(r.hm_id as string, r.dsp_id as string),
      );
    }
    const names = await this.recognitionNames([
      ...ratingRows.flatMap((r) => [r.dsp_id as string, r.hm_id as string]),
      ...reviewRows.flatMap((r) => [r.hm_id as string, r.dsp_id as string]),
    ]);
    const ratingHistory = await this.recognitionHistory(
      "dsp_hm_rating_history",
      "rating_id",
      ratingRows.map((r) => r.id as string),
    );
    const reviewHistory = await this.recognitionHistory(
      "hm_dsp_review_history",
      "review_id",
      reviewRows.map((r) => r.id as string),
    );
    return {
      dspRatings: ratingRows.map((r) => ({
        ...mapDspHmRating(r),
        hmName: names.get(r.hm_id as string) ?? "Staff member",
        dspName: names.get(r.dsp_id as string) ?? "Staff member",
        history: ratingHistory.get(r.id as string) ?? [],
      })),
      hmReviews: reviewRows.map((r) => ({
        ...mapHmDspReview(r),
        hmName: names.get(r.hm_id as string) ?? "Staff member",
        dspName: names.get(r.dsp_id as string) ?? "Staff member",
        history: reviewHistory.get(r.id as string) ?? [],
      })),
    };
  }

  async listRecognitionPartners(): Promise<
    Array<{ userId: string; fullName: string; roleKey: string }>
  > {
    const session = await this.requireSession();
    const counterpart =
      session.roleKey === "dsp"
        ? "house_manager"
        : session.roleKey === "house_manager"
          ? "dsp"
          : null;
    if (!counterpart) return [];
    const today = new Date().toISOString().slice(0, 10);
    const active = `expires_on.is.null,expires_on.gte.${today}`;
    const asgActive = `ends_on.is.null,ends_on.gte.${today}`;
    const { data: mySites } = await this.client
      .from("memberships")
      .select("site_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", session.userId)
      .not("site_id", "is", null)
      .or(active);
    const { data: myAsg } = await this.client
      .from("staff_assignments")
      .select("site_id")
      .eq("agency_id", session.agencyId)
      .eq("user_id", session.userId)
      .not("site_id", "is", null)
      .lte("starts_on", today)
      .or(asgActive);
    const siteIds = [
      ...new Set(
        ((((mySites ?? []) as Record<string, unknown>[]).concat(
          (myAsg ?? []) as Record<string, unknown>[],
        ) as Record<string, unknown>[]).map((r) => r.site_id as string)),
      ),
    ];
    if (siteIds.length === 0) return [];
    // Counterparts via active memberships at those sites…
    const { data: partners } = await this.client
      .from("memberships")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .eq("role_key", counterpart)
      .in("site_id", siteIds)
      .neq("user_id", session.userId)
      .or(active);
    // …plus counterparts whose active staff_assignments place them there.
    const { data: asgPartners } = await this.client
      .from("staff_assignments")
      .select("user_id")
      .eq("agency_id", session.agencyId)
      .in("site_id", siteIds)
      .neq("user_id", session.userId)
      .lte("starts_on", today)
      .or(asgActive);
    const asgIds = [
      ...new Set(
        ((asgPartners ?? []) as Record<string, unknown>[]).map(
          (r) => r.user_id as string,
        ),
      ),
    ];
    let asgCounterparts: string[] = [];
    if (asgIds.length > 0) {
      const { data: roles } = await this.client
        .from("memberships")
        .select("user_id")
        .eq("agency_id", session.agencyId)
        .eq("role_key", counterpart)
        .in("user_id", asgIds)
        .or(active);
      asgCounterparts = ((roles ?? []) as Record<string, unknown>[]).map(
        (r) => r.user_id as string,
      );
    }
    const ids = [
      ...new Set(
        ((partners ?? []) as Record<string, unknown>[])
          .map((r) => r.user_id as string)
          .concat(asgCounterparts),
      ),
    ];
    const names = await this.recognitionNames(ids);
    return ids
      .map((userId) => ({
        userId,
        fullName: names.get(userId) ?? "Staff member",
        roleKey: counterpart,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async listRecognitionWinners(input?: {
    limit?: number;
  }): Promise<import("../recognition/recognition").PublicRecognitionWinner[]> {
    const session = await this.requireSession();
    const limit = Math.max(1, Math.min(52, input?.limit ?? 12));
    const { data, error } = await this.client
      .from("recognition_winners")
      .select("id, week_start, category, winner_id, highlights, decided_at")
      .eq("agency_id", session.agencyId)
      .order("week_start", { ascending: false })
      .limit(limit);
    throwIf(error, "Could not load winners.");
    const rows = (data ?? []) as Record<string, unknown>[];
    const names = await this.recognitionNames(
      rows.map((r) => r.winner_id as string),
    );
    return rows.map((r) => ({
      id: r.id as string,
      weekStart: r.week_start as string,
      category: r.category as "hm_of_the_week" | "dsp_of_the_week",
      winnerName: names.get(r.winner_id as string) ?? "Staff member",
      highlights: Array.isArray(r.highlights) ? (r.highlights as string[]) : [],
      decidedAt: r.decided_at as string,
    }));
  }

  async runWeeklyRecognition(input?: {
    weekStart?: string;
  }): Promise<import("../recognition/recognition").WeeklyRecognitionResult> {
    const session = await this.requireSession();
    if (!this.canSeeRecognitionFeedback(session)) {
      throw new Error("You do not have permission to do that.");
    }
    const result = await invokeEdgeFunction<{
      week_start: string;
      agencies: Array<{
        agency_id: string;
        hm_winner: { id: string; full_name: string } | null;
        dsp_winner: { id: string; full_name: string } | null;
        already_decided?: boolean;
      }>;
    }>(this.client, "select-weekly-winners", {
      ...(input?.weekStart ? { week_start: input.weekStart } : {}),
      agency_id: session.agencyId,
    });
    const agency = result.agencies.find(
      (a) => a.agency_id === session.agencyId,
    );
    return {
      weekStart: result.week_start,
      hmWinner: agency?.hm_winner
        ? { id: agency.hm_winner.id, fullName: agency.hm_winner.full_name }
        : null,
      dspWinner: agency?.dsp_winner
        ? { id: agency.dsp_winner.id, fullName: agency.dsp_winner.full_name }
        : null,
      alreadyDecided: Boolean(agency?.already_decided),
    };
  }

  // ================= PCSP document-extraction pipeline (hosted) =================

  async registerDocumentUpload(input: {
    individualId: string;
    /** Optional — the server falls back to the individual's site when omitted. */
    siteId?: string;
    documentType: DocumentType;
    originalFilename: string;
    mimeType?: string;
    file?: Blob | null;
  }): Promise<DocumentUpload> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.upload");
    const uploadId = crypto.randomUUID();
    const filename = input.originalFilename.trim();
    const storagePath = `${session.agencyId}/${uploadId}/${filename}`;
    // Storage write first (path convention matches the bucket policy); the
    // metadata row is registered after, so a failed upload leaves nothing
    // behind.
    if (input.file) {
      const { error: storageError } = await this.client.storage
        .from("pcsp-documents")
        .upload(storagePath, input.file, {
          contentType: input.mimeType ?? "application/pdf",
          upsert: false,
        });
      throwIf(storageError, "Could not upload the document file.");
    }
    // The migration ships no INSERT policy on document_uploads: writes go
    // through this SECURITY DEFINER RPC, which re-checks documents.upload.
    const { data, error } = await this.client.rpc("register_document_upload", {
      p_agency_id: session.agencyId,
      p_individual_id: input.individualId,
      p_site_id: input.siteId ?? null,
      p_document_type: input.documentType,
      p_original_filename: filename,
      p_storage_path: storagePath,
      p_mime_type: input.mimeType ?? "application/pdf",
      p_id: uploadId,
    });
    throwIf(error, "Could not register the document upload.");
    if (!data) throw new Error("Could not register the document upload.");
    return mapDocumentUpload(data as Record<string, unknown>);
  }

  async listDocumentUploads(filter?: {
    individualId?: string;
    status?: DocumentStatus;
  }): Promise<DocumentUpload[]> {
    const session = await this.requireSession();
    let query = this.client
      .from("document_uploads")
      .select("*")
      .eq("agency_id", session.agencyId)
      .order("uploaded_at", { ascending: false });
    if (filter?.individualId) query = query.eq("individual_id", filter.individualId);
    if (filter?.status) query = query.eq("status", filter.status);
    // RLS: reviewers see everything in the agency; ordinary staff see only
    // approved/activated uploads at their own site(s) — enforced server-side.
    const { data, error } = await query;
    throwIf(error, "Could not load document uploads.");
    return (data ?? []).map((row) =>
      mapDocumentUpload(row as Record<string, unknown>),
    );
  }

  async getDocumentExtraction(uploadId: string): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  } | null> {
    await this.requireSession();
    // RLS enforces documents.review-only reads on document_extractions.
    const { data: extractionRow, error: extractionError } = await this.client
      .from("document_extractions")
      .select("*")
      .eq("upload_id", uploadId)
      .maybeSingle();
    throwIf(extractionError, "Could not load the extraction.");
    if (!extractionRow) return null;
    const { data: itemRows, error: itemsError } = await this.client
      .from("document_trackable_items")
      .select("*")
      .eq("extraction_id", (extractionRow as Record<string, unknown>).id)
      .order("created_at", { ascending: true });
    throwIf(itemsError, "Could not load the trackable items.");
    const row = extractionRow as Record<string, unknown>;
    return {
      extraction: {
        id: row.id as string,
        agencyId: row.agency_id as string,
        uploadId: row.upload_id as string,
        schemaVersion: Number(row.schema_version ?? 1),
        extractedData: row.extracted_data as LocalDocumentExtraction["extractedData"],
        confidence: (row.confidence as Record<string, unknown>) ?? {},
        model: String(row.model ?? "gemini-2.5-flash"),
        createdAt: row.created_at as string,
      },
      items: ((itemRows ?? []) as Record<string, unknown>[]).map(mapTrackableItem),
    };
  }

  async simulatePcspExtraction(
    _uploadId: string,
  ): Promise<{
    extraction: LocalDocumentExtraction;
    items: TrackableItem[];
  }> {
    // The hosted path runs the real extract-pcsp edge function.
    throw new Error(
      "Real AI extraction is hosted-only. Use extractDocumentUpload() to invoke the extract-pcsp edge function.",
    );
  }

  /**
   * Invoke the extract-pcsp edge function: Gemini extracts the document
   * text into the v1 schema, records the extraction + proposed items via
   * mark_extraction_complete (service role), and returns the result.
   * documents.review is re-checked inside the function along with the
   * agency's ai_processing_enabled BAA gate.
   */
  async extractDocumentUpload(
    uploadId: string,
    documentText: string,
  ): Promise<{ ok: boolean; fallbackUsed: boolean }> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    const result = await invokeEdgeFunction<{
      ok?: boolean;
      fallback_used?: boolean;
      error?: string;
    }>(this.client, "extract-pcsp", {
      upload_id: uploadId,
      document_type: (
        await this.listDocumentUploads()
      ).find((u) => u.id === uploadId)?.documentType,
      document_text: documentText,
    });
    return {
      ok: result.ok !== false,
      fallbackUsed: Boolean(result.fallback_used),
    };
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
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    const { data, error } = await this.client.rpc("update_trackable_item", {
      p_item_id: itemId,
      p_title: patch.title,
      p_detail: patch.detail ?? {},
      p_due_date: patch.dueDate ?? null,
      p_needs_human_check: patch.needsHumanCheck ?? false,
    });
    throwIf(error, "Could not update the trackable item.");
    if (!data) throw new Error("Could not update the trackable item.");
    return mapTrackableItem(data as Record<string, unknown>);
  }

  async approveDocumentExtraction(uploadId: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    // THE gate: nothing becomes tracked before this RPC runs.
    const { error } = await this.client.rpc("approve_extraction", {
      p_upload_id: uploadId,
    });
    throwIf(error, "Could not approve the extraction.");
  }

  async activateTrackableItem(itemId: string): Promise<TrackableItem> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    // protocol_needs_delegation items hand off into the delegation system
    // (template → activation → assignment → training draft) inside the RPC.
    const { data, error } = await this.client.rpc("activate_trackable_item", {
      p_item_id: itemId,
    });
    throwIf(error, "Could not activate the trackable item.");
    const result = data as { item?: Record<string, unknown> } | null;
    if (!result?.item) throw new Error("Could not activate the trackable item.");
    return mapTrackableItem(result.item);
  }

  async rejectDocumentUpload(uploadId: string, reason?: string): Promise<void> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    const { error } = await this.client.rpc("reject_upload", {
      p_upload_id: uploadId,
      p_reason: reason ?? null,
    });
    throwIf(error, "Could not reject the upload.");
  }

  async getAgencyAiSettings(): Promise<LocalAgencyAiSettings> {
    const session = await this.requireSession();
    // Carries no secrets — RLS allows any agency member to read.
    const { data, error } = await this.client
      .from("agency_ai_settings")
      .select("*")
      .eq("agency_id", session.agencyId)
      .maybeSingle();
    throwIf(error, "Could not load the AI settings.");
    const row = data as Record<string, unknown> | null;
    return {
      agencyId: session.agencyId,
      aiProcessingEnabled: Boolean(row?.ai_processing_enabled),
      model: String(row?.model ?? "gemini-2.5-flash"),
      serviceAccountVerifiedAt: (row?.service_account_verified_at as string) ?? null,
      vertexProjectId: (row?.vertex_project_id as string) ?? null,
    };
  }

  async setAgencyAiSettings(input: {
    enabled: boolean;
    model: string;
  }): Promise<LocalAgencyAiSettings> {
    const session = await this.requireSession();
    this.requirePlatformOperator(session);
    // Model + enabled flag only — no credential is EVER stored.
    const { data, error } = await this.client.rpc("set_agency_ai_settings", {
      p_agency_id: session.agencyId,
      p_enabled: input.enabled,
      p_model: input.model,
    });
    throwIf(error, "Could not save the AI settings.");
    const row = data as Record<string, unknown> | null;
    return {
      agencyId: session.agencyId,
      aiProcessingEnabled: Boolean(row?.ai_processing_enabled),
      model: String(row?.model ?? input.model),
      serviceAccountVerifiedAt: (row?.service_account_verified_at as string) ?? null,
      vertexProjectId: (row?.vertex_project_id as string) ?? null,
    };
  }

  async verifyAiServiceAccount(): Promise<{
    ok: boolean;
    projectId?: string;
    error?: string;
  }> {
    const session = await this.requireSession();
    this.requirePlatformOperator(session);
    // Minimal generateContent call inside the edge function — the
    // service-account JSON never leaves the server and is never returned.
    const result = await invokeEdgeFunction<{
      ok?: boolean;
      project_id?: string;
      error?: string;
    }>(this.client, "extract-pcsp", {
      action: "verify",
      agency_id: session.agencyId,
    });
    return {
      ok: result.ok === true,
      projectId:
        typeof result.project_id === "string" ? result.project_id : undefined,
      error: result.error,
    };
  }

  async addTrackableItem(input: {
    extractionId: string;
    itemType: TrackableItemType;
    title: string;
    detail?: Record<string, unknown>;
    dueDate?: string | null;
    needsHumanCheck?: boolean;
  }): Promise<TrackableItem> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    const { data, error } = await this.client.rpc("add_trackable_item", {
      p_extraction_id: input.extractionId,
      p_item_type: input.itemType,
      p_title: input.title,
      p_detail: input.detail ?? {},
      p_due_date: input.dueDate ?? null,
      p_needs_human_check: input.needsHumanCheck ?? false,
    });
    throwIf(error, "Could not add the trackable item.");
    if (!data) throw new Error("Could not add the trackable item.");
    return mapTrackableItem(data as Record<string, unknown>);
  }

  async removeTrackableItem(itemId: string): Promise<TrackableItem> {
    const session = await this.requireSession();
    this.requirePermission(session, "documents.review");
    const { data, error } = await this.client.rpc("remove_trackable_item", {
      p_item_id: itemId,
    });
    throwIf(error, "Could not remove the trackable item.");
    if (!data) throw new Error("Could not remove the trackable item.");
    return mapTrackableItem(data as Record<string, unknown>);
  }
}

function mapDspHmRating(
  row: Record<string, unknown>,
): import("../recognition/recognition").DspHmRating {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    dspId: row.dsp_id as string,
    hmId: row.hm_id as string,
    rating: Number(row.rating) as 1 | 2 | 3 | 4 | 5,
    updatedAt: row.updated_at as string,
  };
}

function mapHmDspReview(
  row: Record<string, unknown>,
): import("../recognition/recognition").HmDspReview {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    hmId: row.hm_id as string,
    dspId: row.dsp_id as string,
    rating: Number(row.rating) as 1 | 2 | 3 | 4 | 5,
    updatedAt: row.updated_at as string,
  };
}

function mapSite(row: Record<string, unknown>): SiteRecord {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    programId: row.program_id as string,
    name: row.name as string,
    address: (row.address as string) ?? "",
  };
}

function mapIndividual(row: Record<string, unknown>): IndividualRecord {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    siteId: row.site_id as string,
    fullName: row.full_name as string,
    dateOfBirth: String(row.date_of_birth).slice(0, 10),
    photoUrl:
      typeof row.photo_url === "string" && row.photo_url
        ? row.photo_url
        : null,
  };
}

function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    jobTitle: (row.job_title as string) ?? "DSP",
    username: (row.username as string) ?? "",
    hiredOn: row.hired_on ? String(row.hired_on).slice(0, 10) : null,
  };
}

function mapDocument(row: Record<string, unknown>): DocumentRecord {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    title: row.title as string,
    kind: row.kind as DocumentRecord["kind"],
  };
}

function mapVersion(row: Record<string, unknown>): DocumentVersion {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    documentId: row.document_id as string,
    versionLabel: row.version_label as string,
    status: row.status as DocumentVersion["status"],
    storagePath: (row.storage_path as string) ?? null,
    contentHash: (row.content_hash as string) ?? null,
    pageCount: Number(row.page_count ?? 1),
    effectiveOn: String(row.effective_on).slice(0, 10),
    expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
    createdBy: (row.created_by as string) ?? null,
  };
}

function mapRequirementRow(row: Record<string, unknown>): RequirementRecord {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    documentVersionId: (row.document_version_id as string) ?? null,
    individualId: (row.individual_id as string) ?? null,
    siteId: row.site_id as string,
    title: row.title as string,
    category: row.category as RequirementRecord["category"],
    ownerUserId: (row.owner_user_id as string) ?? null,
    dueOn: String(row.due_on).slice(0, 10),
    frequency: row.frequency as string,
    sourcePage: Number(row.source_page ?? 1),
    status: requirementStatusFromDb(row.status as string),
    evidenceNote: (row.evidence_note as string) ?? "",
    completedAt: (row.completed_at as string) ?? undefined,
  };
}

/* ---------------------------------------------------------------------- */
/* PCSP document-extraction pipeline mappers: snake_case table/RPC rows  */
/* to the domain types in src/data/documents.ts.                        */
/* ---------------------------------------------------------------------- */

function mapDocumentUpload(row: Record<string, unknown>): DocumentUpload {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    siteId: row.site_id as string,
    documentType: row.document_type as DocumentType,
    originalFilename: row.original_filename as string,
    mimeType: (row.mime_type as string) ?? "application/pdf",
    storagePath: row.storage_path as string,
    uploadedBy: (row.uploaded_by as string) ?? null,
    uploadedAt: row.uploaded_at as string,
    status: row.status as DocumentStatus,
  };
}

function mapTrackableItem(row: Record<string, unknown>): TrackableItem {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    extractionId: row.extraction_id as string,
    itemType: row.item_type as TrackableItem["itemType"],
    title: row.title as string,
    detail: (row.detail as Record<string, unknown>) ?? {},
    dueDate: (row.due_date as string) ?? null,
    confidence:
      row.confidence === null || row.confidence === undefined
        ? null
        : Number(row.confidence),
    needsHumanCheck: Boolean(row.needs_human_check),
    status: row.status as TrackableItem["status"],
  };
}

/* ---------------------------------------------------------------------- */
/* Delegation template workflow mappers: snake_case RPC/table rows to     */
/* the domain types in src/delegation/delegation.ts.                     */
/* ---------------------------------------------------------------------- */

function mapDelegationTemplate(row: Record<string, unknown>): DelegationTemplate {
  return {
    id: row.id as string,
    agencyId: (row.agency_id as string) ?? null,
    name: row.name as string,
    category: row.category as DelegationTemplateCategory,
    sections: row.sections as TemplateSections,
    individualizationNote: (row.individualization_note as string) ?? "",
    active: Boolean(row.active),
  };
}

function mapDelegationTrainingMaterial(
  row: Record<string, unknown>,
): DelegationTrainingMaterial {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    assignmentId: row.assignment_id as string,
    status: row.status as DelegationTrainingMaterial["status"],
    draftContent: row.draft_content as TrainingMaterialContent,
    publishedContent: (row.published_content as TrainingMaterialContent) ?? null,
    submittedAt: (row.submitted_at as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    approvedBy: (row.approved_by as string) ?? null,
  };
}

function mapDelegationAcknowledgment(
  row: Record<string, unknown>,
): DelegationAcknowledgment {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    assignmentId: row.assignment_id as string,
    staffId: row.staff_id as string,
    staffName: (row.staff_name as string) ?? "",
    openedAt: (row.opened_at as string) ?? null,
    signedAt: (row.signed_at as string) ?? null,
    signatureName: (row.signature_name as string) ?? null,
    signatureMark: (row.signature_mark as string) ?? null,
  };
}

function mapPacket(row: Record<string, unknown>): AcknowledgmentPacket {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    documentVersionId: row.document_version_id as string,
    whatAcknowledging: row.what_acknowledging as string,
    startsOn: String(row.starts_on).slice(0, 10),
    endsOn: row.ends_on ? String(row.ends_on).slice(0, 10) : null,
    status: row.status as AcknowledgmentPacket["status"],
  };
}

function mapAgencyRoles(agencyId: string, rows: Record<string, unknown>[]): AgencyRole[] {
  if (!rows.length) {
    return ROLE_TEMPLATES.map((template) => ({ ...template, agencyId }));
  }
  return rows.map((row) => {
    const key = String(row.template_key);
    const template = ROLE_TEMPLATES.find((item) => item.key === key);
    return {
      agencyId,
      key: (template?.key ?? key) as AgencyRole["key"],
      name: String(row.name ?? template?.name ?? key),
      shortCode: String(row.short_code ?? template?.shortCode ?? ""),
      description: template?.description ?? "",
      defaultScope: (row.scope as AgencyRole["defaultScope"]) ?? template?.defaultScope ?? "assigned",
      capability: template?.capability ?? "dsp",
      permissions: (row.permissions as PermissionMap) ?? defaultPermissions(key),
    };
  });
}

function mapAckRow(row: Record<string, unknown>): AcknowledgmentRow {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    packetId: row.packet_id as string,
    userId: row.user_id as string,
    staffName: row.staff_name as string,
    addedManually: Boolean(row.added_manually),
    addReason: (row.add_reason as string) ?? null,
    openedAt: (row.opened_at as string) ?? null,
    signedAt: (row.signed_at as string) ?? null,
    signatureName: (row.signature_name as string) ?? null,
    signatureMark: (row.signature_mark as string) ?? null,
  };
}
