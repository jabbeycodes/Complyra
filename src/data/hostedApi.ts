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
import { assertCalendarDate } from "./access";
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
  ROLE_TEMPLATES,
  capabilityForRoleKey,
  canCreateIndividual,
  canGrantRole,
  defaultPermissions,
  hasPermission,
  isRoleKey,
  PLAN_SIGNER_ROLE_KEYS,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";
import { isValidRating } from "../recognition/scoring";
import {
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
  normalizeProfile,
  renewalStatus,
  requiredForSigning,
  sortObligations,
  staffCanSignDelegation,
  type ClinicalEvidenceKind,
  type ClinicalRenewal,
  type IndividualProfile,
  type ObligationItem,
  type ObligationSignature,
  type PlanStackView,
} from "./planStack";
import {
  allLinesInitialed,
  canEditTrainingLine,
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
  mapChartFile,
  mapClinicalRenewal,
  mapEmergencyDrill,
  mapEquipmentMonthLog,
  mapHomeSafetyReport,
  mapMedication,
  mapObligation,
  mapObligationSignature,
  mapDelegationForm,
  mapSiteReview,
  mapTrainingChecklist,
  obligationPatch,
  profileFromRow,
} from "./hostedMappers";
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
  constructor(private readonly client: SupabaseClient) {}

  async listNotifications(): Promise<import("../features/notifications/notify").NotificationRow[]> {
    const session = await this.requireSession();
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
    const planStacks = canViewPeople
      ? individuals.map((person) =>
          this.hostedPlanStack(session, person, {
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
            medications: (medsRes.data ?? []).map(mapMedication),
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

    return {
      session,
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
      throw new Error("Only a DPM or compliance admin can edit cover-page fields.");
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
        throw new Error("Only a DPM or nurse can turn a delegation on.");
      }
    } else if (!canEditExtraction(session.roleKey, canApprove)) {
      throw new Error("Only a DPM can edit extracted items.");
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
      });
    }
  }

  async addProtocol(individualId: string, title: string, detail = "") {
    const session = await this.requireSession();
    if (!canEditExtraction(session.roleKey, hasPermission(session, "requirements.approve"))) {
      throw new Error("Only a DPM can add a protocol.");
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
      throw new Error("Only a DPM can add a daily shift requirement.");
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
    if (!item || !isObligationActive(item)) {
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
      throw new Error("RN, DPM, or House Manager can upload renewal evidence.");
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
      throw new Error("Only a DPM or nurse can discontinue a delegation.");
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
    type: "renewal" | "discontinue" | "training" | "version";
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
      throw new Error("House manager, RN, or DPM records a medication delivery.");
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
      throw new Error("Only a DPM or administrator can set monthly due dates.");
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
      throw new Error("Only a DPM or house manager can add adaptive equipment.");
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
      throw new Error("Only a DPM or house manager can remove adaptive equipment.");
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
      throw new Error("Only a DPM, nurse, or house manager can record safety checks.");
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
    });
    return { blob: pdf.output("blob"), name: safetyFileName(site.name, input.monthKey) };
  }
  // ---- Site reviews / branding ----

  async saveSiteFacts(siteId: string, facts: Partial<SiteFacts>) {
    const session = await this.requireSession();
    if (!canEditSiteReview(session.roleKey)) {
      throw new Error("Only a DPM, house manager, or administrator can update site-review facts.");
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
      throw new Error("Only a DPM, house manager, or administrator can mark site-review checks.");
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
    });
    return { blob: pdf.output("blob"), name: preSurveyFileName(site.name) };
  }

  async uploadAgencyLogo(file: File) {
    const session = await this.requireSession();
    if (!canManageAgencyLogo(session.roleKey)) {
      throw new Error("Only a DPM or administrator can change the agency logo.");
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
      throw new Error("Only a DPM or administrator can change the agency logo.");
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
  }): Promise<{ id: string; name: string }> {
    const session = await this.requireSession();
    if (!canCreateIndividual(session.roleKey)) {
      throw new Error("Only a DPM, nurse, or house manager can add an individual.");
    }
    const fullName = input.fullName.trim();
    if (!fullName) throw new Error("Enter the individual’s legal name.");
    assertCalendarDate(input.dateOfBirth, "Enter a valid date of birth.");
    if (input.dateOfBirth > todayIso()) throw new Error("Date of birth cannot be in the future.");
    const site = await this.siteRecord(input.siteId);
    if (!site || site.agencyId !== session.agencyId) throw new Error("Choose a program site.");
    if (session.roleKey === "house_manager" && session.siteId && session.siteId !== site.id) {
      throw new Error("House managers can add people to their own site.");
    }
    const { data: roster } = await this.client
      .from("individuals")
      .select("id, full_name")
      .eq("agency_id", session.agencyId);
    if (
      (roster ?? []).some(
        (row) => String(row.full_name).toLowerCase() === fullName.toLowerCase(),
      )
    ) {
      throw new Error("Someone with that name is already on the roster.");
    }
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

  // ---- Hosted plan-stack helpers ----

  private requirePdfFile(file: File, message: string) {
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") && (!file.type || file.type === "application/pdf");
    if (!isPdf) throw new Error(message);
  }

  private async saveChartFile(
    session: SessionUser,
    individualId: string,
    kind: "renewal" | "discontinue",
    file: File,
  ): Promise<string> {
    const fileId = crypto.randomUUID();
    const storagePath = `${session.agencyId}/${individualId}/chart/${fileId}/${file.name}`;
    const { error: uploadError } = await this.client.storage
      .from(CHART_BUCKET)
      .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
    throwIf(uploadError, "Could not store the file.");
    const { error: insertError } = await this.client.from("chart_files").insert({
      id: fileId,
      agency_id: session.agencyId,
      individual_id: individualId,
      kind,
      name: file.name,
      mime: "application/pdf",
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
      "degreed_professional_manager",
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
   * Failures are swallowed: a DPM/nurse can often SELECT every home but fail
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
      checklists: TrainingChecklist[];
      versionLabelById: Map<string, string | null>;
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
            .map((row) => ({ ...row, status: renewalStatus(row.nextDueOn) }))
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
    },
  ) {
    if (item.mode !== "required") return;
    if (!item.enabled) return;
    if (item.expiresOn && item.expiresOn < todayIso()) return;
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
          "Only the assigned staff member, an administrator, compliance admin, house manager, or DPM can edit a completed training line.",
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
        "Only an administrator, compliance admin, or DPM can request a training correction.",
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
    const session = await this.requireSession();
    this.requirePermission(session, "clinical.view");
    this.assertDelegationEditor(session);
    const person = await this.individualRecord(input.individualId);
    if (!person || person.agencyId !== session.agencyId) {
      throw new Error("Individual not found.");
    }
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

  /** HMs are scoped to their own site; admins/auditors/DPMs see the agency. */
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
      session.roleKey === "degreed_professional_manager" ||
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
        "(administrator,compliance_admin,degreed_professional_manager,program_manager)",
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
        "Only a DPM or agency administrator can assign weekly checklists.",
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
    const meds = (medsRes.data ?? []).map(mapMedication);
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
      throw new Error("House manager, RN, or DPM adjusts medication inventory.");
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
      throw new Error("House manager, RN, or DPM sets the reorder threshold.");
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
      throw new Error("House manager, RN, or DPM acknowledges a reorder alert.");
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
    const { data, error } = await this.client.storage
      .from("user-signatures")
      .createSignedUrl(path, 60 * 60);
    throwIf(error, "Could not load the signature image.");
    if (!data?.signedUrl) throw new Error("Could not load the signature image.");
    return data.signedUrl;
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
    // recognition.manage holders (DPM, program manager) see only pairs they
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
  };
}

function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    jobTitle: (row.job_title as string) ?? "DSP",
    username: (row.username as string) ?? "",
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
