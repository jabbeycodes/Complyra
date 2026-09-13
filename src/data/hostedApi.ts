import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Plan, Requirement } from "../domain";
import {
  computeRequirementStatus,
  isPrivileged,
  requirementStatusFromDb,
  requirementStatusToDb,
  reviewStatusLabel,
  roleLabel,
} from "./status";
import type { ComplyraApi, WorkspaceView } from "./localApi";
import type {
  AcknowledgmentPacket,
  AcknowledgmentRow,
  AppRole,
  DocumentRecord,
  DocumentVersion,
  IndividualRecord,
  AgencyStatus,
  CreateAgencyInput,
  CreateAgencyResult,
  InviteMemberInput,
  InviteMemberResult,
  LoginInput,
  PacketDetail,
  PendingAgency,
  RequirementRecord,
  SessionUser,
  SiteRecord,
  UploadDocumentInput,
} from "./types";
import {
  LOGIN_FAILED_MESSAGE,
  USERNAME_PATTERN,
  normalizeAgencyCode,
  normalizeUsername,
} from "./types";
import { generateTempPassword } from "./agencyCode";
import {
  ROLE_TEMPLATES,
  capabilityForRoleKey,
  canCreateIndividual,
  defaultPermissions,
  hasPermission,
  isRoleKey,
  PLAN_SIGNER_ROLE_KEYS,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";
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
  canLogPrnDose,
  canRecordDelivery,
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
  DEFAULT_MONTHLY_DUE,
  blankSafetyLines,
  canCompleteMonthly,
  canConfigureMonthlyDue,
  canManageEquipment,
  drillComplete,
  drillsForMonth,
  equipmentViewForPerson,
  monthKeyFrom,
  normalizeMonthlyDue,
  safetyComplete,
  siteSafetyView,
  type AdaptiveEquipment,
  type SafetyLine,
} from "./monthlyChecks";
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
import { buildCarePlanPdf } from "../pdf/carePlanPdf";
import { buildTrainingChecklistPdf, trainingFileName } from "../pdf/trainingChecklistPdf";
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
  mapSiteReview,
  mapTrainingChecklist,
  obligationPatch,
  profileFromRow,
} from "./hostedMappers";

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

export class HostedApi implements ComplyraApi {
  constructor(private readonly client: SupabaseClient) {}

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
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    const session = await this.sessionFromUser(auth.user.id, auth.user.email ?? email);
    if (!session) {
      throw new Error("This account is not a member of an agency.");
    }
    return session;
  }

  async signOut() {
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
      throw new Error("Only administrators can assign roles.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
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
    if (!session.permissions["members.assign_roles"]) {
      throw new Error("Only administrators can edit role access.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    if (roleKey === "administrator" && !permissions["members.assign_roles"]) {
      throw new Error("The administrator role must keep role-assignment access.");
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
        serviceType: "ISL",
        staffed24h: false,
        overnightSleepStaff: false,
        wellWater: false,
        lastWaterTestOn: "",
        sitePhone: "",
        contactName: "",
        contactPhone: "",
        city: "",
        county: "",
        zip: "",
      })),
      individuals: individuals.map((person, i) => {
        const site = siteById[person.siteId];
        return {
          id: person.id,
          name: person.fullName,
          site: site?.name ?? "Unknown site",
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
          status: row.status,
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
      title: input.title,
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
      item!.owner_user_id &&
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
    const session = await this.requireSession();
    this.requirePermission(session, "requirements.approve");
    const { error } = await this.client
      .from("requirement_definitions")
      .update({ owner_user_id: ownerUserId })
      .eq("id", id);
    throwIf(error, "Could not reassign that requirement.");
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.dueOn)) {
        throw new Error("Use a valid due date.");
      }
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
    if (input.remainingPills < 0) {
      throw new Error("Remaining pills cannot be negative.");
    }
    if (med.kind === "scheduled" && input.pillsPerDay <= 0) {
      throw new Error("Set pills per day for a scheduled medication.");
    }
    const countedOn = (input.countedOn ?? todayIso()).slice(0, 10);
    const nextPillsPerDay = med.kind === "prn" ? 0 : input.pillsPerDay;
    const { error: updateError } = await this.client
      .from("medications")
      .update({
        remaining_pills: input.remainingPills,
        pills_per_day: nextPillsPerDay,
        last_delivery_on: countedOn,
        last_countdown_on: countedOn,
      })
      .eq("id", med.id);
    throwIf(updateError, "Could not record the delivery.");
    const { error: deliveryError } = await this.client.from("medication_deliveries").insert({
      agency_id: session.agencyId,
      medication_id: med.id,
      counted_on: countedOn,
      remaining_pills: input.remainingPills,
      pills_per_day: nextPillsPerDay,
      recorded_by: session.userId,
    });
    throwIf(deliveryError, "Delivery saved, but the count record could not be written.");
    await this.audit(
      session,
      "medication.delivery",
      `${session.fullName} counted ${med.name} at ${input.remainingPills} pills`,
      "medication",
      med.id,
    );
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
    if (pills <= 0) throw new Error("Enter how many pills were given.");
    const nextCount = Math.max(0, med.remainingPills - pills);
    const { error: updateError } = await this.client
      .from("medications")
      .update({ remaining_pills: nextCount })
      .eq("id", med.id);
    throwIf(updateError, "Could not log the PRN dose.");
    const { error: logError } = await this.client.from("prn_dose_logs").insert({
      agency_id: session.agencyId,
      medication_id: med.id,
      logged_on: todayIso(),
      logged_at: new Date().toISOString(),
      pills_used: pills,
      remaining_after: nextCount,
      logged_by: session.fullName,
      logged_by_user_id: session.userId,
    });
    throwIf(logError, "Dose counted down, but the PRN log could not be written.");
    await this.audit(
      session,
      "medication.prn",
      `${session.fullName} gave ${pills} ${med.name}`,
      "medication",
      med.id,
    );
  }

  // ---- Training ----

  async signTrainingChecklist(checklistId: string, role: "staff" | "hm", signatureName: string) {
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
        .update({ staff_signed_at: now, staff_signature_name: signatureName.trim() })
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
        .update({ hm_signed_at: now, hm_signature_name: signatureName.trim() })
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

  async initialTrainingLine(checklistId: string, lineId: string) {
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
    const items = checklist.items.map((item) =>
      item.id === lineId ? { ...item, initialedAt: new Date().toISOString() } : item,
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
    if (!input.dateOfBirth) throw new Error("Enter a date of birth.");
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
   */
  private async ensureHostedCollections(
    session: SessionUser,
    input: { sites: SiteRecord[]; individuals: IndividualRecord[]; equipment: AdaptiveEquipment[] },
  ) {
    const monthKey = monthKeyFrom(todayIso());
    if (canCompleteMonthly(session.roleKey)) {
      const drillsPayload = input.sites.flatMap((site) =>
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
        throwIf(error, "Could not load the agency workspace.");
      }
      const safetyPayload = input.sites.map((site) => ({
        agency_id: session.agencyId,
        site_id: site.id,
        month_key: monthKey,
        lines: blankSafetyLines(),
      }));
      if (safetyPayload.length) {
        const { error } = await this.client
          .from("home_safety_reports")
          .upsert(safetyPayload, { onConflict: "site_id,month_key", ignoreDuplicates: true });
        throwIf(error, "Could not load the agency workspace.");
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
        throwIf(error, "Could not load the agency workspace.");
      }
    }
    if (canEditSiteReview(session.roleKey)) {
      const reviewsPayload = input.sites.map((site) => {
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
        throwIf(error, "Could not load the agency workspace.");
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

  private async sessionFromUser(
    userId: string,
    email: string,
  ): Promise<SessionUser | null> {
    const { data: profile } = await this.client
      .from("profiles")
      .select("id, full_name, email, job_title, username, must_change_password, home_agency_id, platform_admin")
      .eq("id", userId)
      .maybeSingle();
    const { data: membership } = await this.client
      .from("memberships")
      .select("agency_id, role, role_key, site_id, expires_on")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile || !membership) return null;
    if (
      membership.expires_on &&
      String(membership.expires_on).slice(0, 10) < new Date().toISOString().slice(0, 10)
    ) {
      return null;
    }
    const { data: agency } = await this.client
      .from("agencies")
      .select("id, name, agency_code, status")
      .eq("id", membership.agency_id)
      .single();
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
