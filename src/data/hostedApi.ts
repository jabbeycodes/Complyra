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
  defaultPermissions,
  hasPermission,
  isRoleKey,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";

const BUCKET = "agency-documents";

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
          profile: null,
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
      planStacks: [],
      scorecard: {
        score: Number((scoreRes.data as { score?: number } | null)?.score ?? 100),
        total: Number((scoreRes.data as { total?: number } | null)?.total ?? 0),
        done: Number((scoreRes.data as { done?: number } | null)?.done ?? 0),
        overdue: Number((scoreRes.data as { overdue?: number } | null)?.overdue ?? 0),
        dueSoon: Number((scoreRes.data as { dueSoon?: number } | null)?.dueSoon ?? 0),
        review: Number((scoreRes.data as { review?: number } | null)?.review ?? 0),
      },
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

  async updateIndividualProfile() {
    throw new Error("Cover-page editing is on the local workspace until the hosted schema is migrated.");
  }
  async updateObligation() {
    throw new Error("Plan-stack editing is on the local workspace until the hosted schema is migrated.");
  }
  async addProtocol() {
    throw new Error("Adding protocols is on the local workspace until the hosted schema is migrated.");
  }
  async promoteToShiftTask() {
    throw new Error("Shift requirements are on the local workspace until the hosted schema is migrated.");
  }
  async markObligationOpened() {
    throw new Error("Required-document signing is on the local workspace until the hosted schema is migrated.");
  }
  async signObligation() {
    throw new Error("Required-document signing is on the local workspace until the hosted schema is migrated.");
  }
  async submitPlanPacket() {
    throw new Error("Packet submit is on the local workspace until the hosted schema is migrated.");
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
