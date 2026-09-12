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
  canCreateIndividual,
  canCreateSite,
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
  allLinesInitialed,
  applyDailyMedDrop,
  canLogPrnDose,
  canRecordDelivery,
  canSeeMeds,
  canSignTrainingAsHm,
  mergeTrainingLines,
  toMedicationView,
  todayIso,
  trainingLinesFromObligations,
  trainingStatus,
  type ChartFileKind,
} from "./chart";
import { buildCarePlanPdf } from "../pdf/carePlanPdf";
import { buildTrainingChecklistPdf, trainingFileName } from "../pdf/trainingChecklistPdf";
import {
  canCompleteMonthly,
  canConfigureMonthlyDue,
  canManageEquipment,
  drillComplete,
  ensureMonthlyCycles,
  equipmentViewForPerson,
  safetyComplete,
  normalizeMonthlyDue,
  type AdaptiveEquipment,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
  type SafetyLine,
} from "./monthlyChecks";
import {
  buildDrillsMonthPdf,
  buildEquipmentMonthPdf,
  buildSafetyMonthPdf,
  drillsFileName,
  equipmentFileName,
  safetyFileName,
} from "../pdf/monthlyChecksPdf";
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
  ): Promise<void>;
  initialTrainingLine(checklistId: string, lineId: string): Promise<void>;
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
    profile: IndividualProfile | null;
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
      browserStore.db.chartFiles = browserStore.db.chartFiles ?? [];
      browserStore.db.medications = browserStore.db.medications ?? [];
      browserStore.db.medicationDeliveries = browserStore.db.medicationDeliveries ?? [];
      browserStore.db.trainingChecklists = browserStore.db.trainingChecklists ?? [];
      browserStore.db.adaptiveEquipment = browserStore.db.adaptiveEquipment ?? [];
      browserStore.db.equipmentMonthLogs = browserStore.db.equipmentMonthLogs ?? [];
      browserStore.db.emergencyDrills = browserStore.db.emergencyDrills ?? [];
      browserStore.db.homeSafetyReports = browserStore.db.homeSafetyReports ?? [];
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
    profile: person.profile ?? emptyProfile(person),
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
  applyMedicationCountdowns(store);
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
        profile: person.profile ?? emptyProfile(person),
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
      equipment: store.db.adaptiveEquipment.filter((row) => row.agencyId === session.agencyId),
      equipmentLogs: store.db.equipmentMonthLogs.filter((log) =>
        store.db.adaptiveEquipment.some(
          (item) => item.id === log.equipmentId && item.agencyId === session.agencyId,
        ),
      ),
      drills: store.db.emergencyDrills.filter((row) => row.agencyId === session.agencyId),
      safetyReports: store.db.homeSafetyReports.filter((row) => row.agencyId === session.agencyId),
    },
    monthlyDue: normalizeMonthlyDue(
      store.db.agencies.find((row) => row.id === session.agencyId)?.monthlyDue,
    ),
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
    person.profile = profile;
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
    if (item.rnSignedAt) throw new Error("Delegating RN already signed.");
    if (!signatureName.trim() || !signatureMark) {
      throw new Error("Type your legal name and add a signature mark.");
    }
    item.delegatingRnUserId = session.userId;
    item.rnSignedAt = new Date().toISOString();
    item.rnSignatureName = signatureName.trim();
    item.rnSignatureMark = signatureMark;
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
      const site = this.store.db.sites.find((row) => row.id === person.siteId);
      const pdf = buildTrainingChecklistPdf({
        agencyName: session.agencyName,
        individualName: person.fullName,
        siteName: site?.name ?? "",
        checklist,
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
      const pdf = buildCarePlanPdf({
        agencyName: session.agencyName,
        individualName: person?.fullName ?? "Individual",
        title: document?.title ?? "Care plan",
        versionLabel: version.versionLabel,
        effectiveOn: version.effectiveOn,
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
    if (input.remainingPills < 0) {
      throw new Error("Remaining pills cannot be negative.");
    }
    if (med.kind === "scheduled" && input.pillsPerDay <= 0) {
      throw new Error("Set pills per day for a scheduled medication.");
    }
    const countedOn = (input.countedOn ?? todayIso()).slice(0, 10);
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
    if (pills <= 0) throw new Error("Enter how many pills were given.");
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

  async initialTrainingLine(checklistId: string, lineId: string) {
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
    line.initialedAt = new Date().toISOString();
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
    });
    return { blob: doc.output("blob"), name: safetyFileName(site.name, input.monthKey) };
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
    };
    this.store.db.sites.push(site);
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
    if (!input.dateOfBirth) throw new Error("Enter a date of birth.");
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
}

export function createLocalApi(store?: MemoryStore) {
  return new LocalApi(store);
}

export { browserStore };
