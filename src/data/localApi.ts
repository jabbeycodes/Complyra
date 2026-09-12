import type { Activity, Plan, Requirement } from "../domain";
import { createEvergreenSeed, type LocalDatabase } from "./seed";
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
  capabilityForRoleKey,
  defaultPermissions,
  hasPermission,
  isRoleKey,
  type AgencyRole,
  type PermissionKey,
  type PermissionMap,
} from "./permissions";
import { generateTempPassword } from "./agencyCode";
import type {
  AcknowledgmentPacket,
  AppRole,
  DocumentVersion,
  IndividualRecord,
  CreateAgencyInput,
  CreateAgencyResult,
  AgencyStatus,
  InviteMemberInput,
  InviteMemberResult,
  LoginInput,
  PacketDetail,
  PendingAgency,
  RequirementRecord,
  SessionUser,
  UploadDocumentInput,
} from "./types";
import {
  LOGIN_FAILED_MESSAGE,
  USERNAME_PATTERN,
  normalizeAgencyCode,
  normalizeUsername,
} from "./types";
import {
  buildAgencyCode,
  validateAgencyCodeParts,
} from "./agencyCode";

const META_KEY = "complyra-v2-meta";
const FILE_PREFIX = "complyra-v2-file:";

export interface ComplyraApi {
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
  resetWorkspace(): Promise<void>;
}

export interface WorkspaceView {
  session: SessionUser;
  sites: { id: string; name: string; address: string; program: string; manager: string; color: string; initials: string }[];
  individuals: {
    id: string;
    name: string;
    site: string;
    dateOfBirth: string;
    manager: string;
    initials: string;
    color: string;
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
  scorecard: {
    score: number;
    total: number;
    done: number;
    overdue: number;
    dueSoon: number;
    review: number;
  };
}

function cloneSeed(): LocalDatabase {
  return structuredClone(createEvergreenSeed());
}

export class MemoryStore {
  db: LocalDatabase;
  files = new Map<string, { mime: string; bytes: ArrayBuffer }>();
  sessionUserId: string | null = null;

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
      }
      if (!browserStore.db.agencyRoles?.length) {
        browserStore.db.agencyRoles = browserStore.db.agencies.flatMap((agency) =>
          ROLE_TEMPLATES.map((template) => ({ ...template, agencyId: agency.id })),
        );
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
  return { ...(configured?.permissions ?? defaultPermissions(roleKey)) };
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
    status: row.status,
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
  const canViewPeople = hasPermission(session, "individuals.view");
  const canReadAudit =
    hasPermission(session, "audit.read") || canViewPeople;
  const sites = store.db.sites.filter((row) => row.agencyId === session.agencyId);
  const individuals = canViewPeople
    ? store.db.individuals.filter((row) => row.agencyId === session.agencyId)
    : [];
  const memberships = store.db.memberships.filter((row) => row.agencyId === session.agencyId);
  const allRequirements = store.db.requirements.filter(
    (row) => row.agencyId === session.agencyId,
  );
  const scorecard = metrics(allRequirements.map((row) => mapRequirement(store, row)));
  const requirements = canViewPeople ? allRequirements : [];
  const versions = canViewPeople
    ? store.db.versions.filter((row) => row.agencyId === session.agencyId)
    : [];
  const packets = canViewPeople
    ? store.db.packets.filter((row) => row.agencyId === session.agencyId)
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
    })),
    individuals: individuals.map((person, i) => {
      const site = sites.find((s) => s.id === person.siteId)!;
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
    roles: rolesFor(store, session.agencyId),
    scorecard,
  };
}

export class LocalApi implements ComplyraApi {
  constructor(private store: MemoryStore = browserStore) {}

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
    if (!agency || !profile || !credential || credential.password !== input.password) {
      throw new Error(LOGIN_FAILED_MESSAGE);
    }
    this.store.sessionUserId = credential.userId;
    await persistMeta(this.store);
    return currentSession(this.store)!;
  }

  async signOut() {
    this.store.sessionUserId = null;
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
    if (!session.permissions["members.invite"]) {
      throw new Error("You do not have permission to add members.");
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
    if (!session.permissions["members.assign_roles"]) {
      throw new Error("Only administrators can assign roles.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
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
    if (!session.permissions["members.assign_roles"]) {
      throw new Error("Only administrators can edit role access.");
    }
    if (!isRoleKey(roleKey)) throw new Error("Choose a valid role.");
    if (roleKey === "administrator" && !permissions["members.assign_roles"]) {
      throw new Error("The administrator role must keep role-assignment access.");
    }
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
    return toWorkspace(this.store, session);
  }

  async createRequirementDraft(input: Parameters<ComplyraApi["createRequirementDraft"]>[0]) {
    const session = assertSession(this.store);
    assertCan(session, "documents.upload");
    const individual = this.store.db.individuals.find((p) => p.id === input.individualId);
    if (!individual) throw new Error("Individual not found.");
    const version = this.store.db.versions.find((v) => {
      const document = this.store.db.documents.find((d) => d.id === v.documentId);
      return `${document?.title} · ${v.versionLabel}` === input.source;
    });
    this.store.db.requirements.unshift({
      id: `REQ-${crypto.randomUUID().slice(0, 8)}`,
      agencyId: session.agencyId,
      documentVersionId: version?.id ?? null,
      individualId: individual.id,
      siteId: individual.siteId,
      title: input.title,
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
    const item = this.store.db.requirements.find((r) => r.id === id);
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
    const item = this.store.db.requirements.find((r) => r.id === id);
    if (!item) throw new Error("Requirement not found.");
    if (item.status === "Pending review") {
      throw new Error("Approve this requirement before recording completion.");
    }
    if (
      session.role === "dsp" &&
      item.ownerUserId &&
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
    const session = assertSession(this.store);
    assertCan(session, "requirements.approve");
    const item = this.store.db.requirements.find((r) => r.id === id);
    if (!item) throw new Error("Requirement not found.");
    item.ownerUserId = ownerUserId;
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
    const version = this.store.db.versions.find((v) => v.id === versionId);
    if (!version?.storagePath) return null;
    return readFile(version.storagePath);
  }

  async assignStaff(individualId: string, userId: string) {
    const session = assertSession(this.store);
    assertPrivileged(session);
    const individual = this.store.db.individuals.find((p) => p.id === individualId);
    if (!individual) throw new Error("Individual not found.");
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
}

export function createLocalApi(store?: MemoryStore) {
  return new LocalApi(store);
}

export { browserStore };
