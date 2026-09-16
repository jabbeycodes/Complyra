import type { Appointment } from "./appointments";
import type { DelegationForm, IndividualRecord } from "./types";

export type ObligationKind =
  | "pcsp"
  | "protocol"
  | "delegation"
  | "shift_task"
  | "inventory";

export type ObligationMode = "required" | "checked";
export type InventoryState = "unchecked" | "present" | "missing" | "na";
export type ObligationOrigin = "extraction" | "manual";

export interface GuardianContact {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  preferredContact: string;
  /** Issue #81: Overview contact form fields (Name → Role → Phone → Email → Address → Notes). */
  address?: string;
  notes?: string;
}

/**
 * Issue #81: provider contacts listed on the Individual chart Overview.
 * Manager-added/editable; never invented — an empty list renders
 * "No providers yet". `role` carries the provider kind
 * (PCP, neurologist, psychiatrist, dentist, pharmacy, hospital, specialist).
 */
export interface ProviderContact {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export type SexCode = "" | "M" | "F" | "X";
export type MedicaidStatus = "" | "yes" | "no" | "ida" | "cd_only";
export type AllergyStatus = "active" | "resolved";

export interface Allergy {
  allergen: string;
  reaction: string;
  status: AllergyStatus;
}

/** Who/when for the allergies list as a whole (one Health write). */
export interface AllergiesStamp {
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface IndividualProfile {
  legalName: string;
  goesBy: string;
  dmhId: string;
  diagnosis: string;
  waiver: string;
  address: string;
  phone: string;
  language: string;
  implementationStart: string;
  implementationEnd: string;
  serviceCoordinator: string;
  guardians: GuardianContact[];
  /** Issue #81: manager-maintained provider contacts on the Overview. */
  providerContacts: ProviderContact[];
  sex: SexCode;
  medicaidStatus: MedicaidStatus;
  specializedDiet: string;
  specializedMedical: string;
  behaviorSupports: string;
  dailyActivities: string;
  visitHours: string;
  /** Optional program enrollment / admit date. Intake defaults this to today. */
  enrolledOn: string;
  /** Structured allergy list for the consultation packet (Health H1). */
  allergies: Allergy[];
  allergiesStamp: AllergiesStamp | null;
}

export interface ObligationItem {
  id: string;
  agencyId: string;
  individualId: string;
  kind: ObligationKind;
  mode: ObligationMode;
  title: string;
  detail: string;
  sourcePage: number | null;
  documentVersionId: string | null;
  enabled: boolean;
  frequency: string;
  shiftPeriods: string[];
  expiresOn: string | null;
  createdFrom: ObligationOrigin;
  inventoryState: InventoryState;
  proposed: boolean;
  delegatingRnUserId: string | null;
  rnSignedAt: string | null;
  rnSignatureName: string | null;
  rnSignatureMark: string | null;
  discontinuedAt: string | null;
  discontinueFileId: string | null;
  discontinueTitle: string | null;
  /** LIFEPATH-P3 (delegation forms): full RN delegation form, stored as jsonb. */
  delegationForm?: DelegationForm | null;
}

export interface ObligationSignature {
  id: string;
  agencyId: string;
  obligationId: string;
  userId: string;
  staffName: string;
  openedAt: string | null;
  signedAt: string | null;
  signatureName: string | null;
  signatureMark: string | null;
}

export interface PacketSubmission {
  id: string;
  agencyId: string;
  individualId: string;
  userId: string;
  submittedAt: string;
}

export interface ObligationView {
  item: ObligationItem;
  mySignature: ObligationSignature | null;
  signedCount: number;
  assignedCount: number;
}

export type ClinicalRenewalKind =
  | "annual_physical"
  | "vision"
  | "dental"
  | "physician_orders";

export type ClinicalEvidenceKind =
  | "consultation"
  | "doctor_notes"
  | "physician_orders"
  | "pdf";

export interface ClinicalRenewal {
  id: string;
  agencyId: string;
  individualId: string;
  kind: ClinicalRenewalKind;
  title: string;
  intervalMonths: number;
  lastUploadedOn: string | null;
  nextDueOn: string;
  lastDocumentTitle: string | null;
  lastEvidenceKind: ClinicalEvidenceKind | null;
  fileId: string | null;
}

export type RenewalStatus = "current" | "due_soon" | "overdue";

export interface PlanStackView {
  individualId: string;
  individualName: string;
  profile: IndividualProfile;
  required: ObligationView[];
  checked: ObligationView[];
  renewals: ClinicalRenewalView[];
  carePlan: import("./chart").CarePlanView | null;
  medications: import("./chart").MedicationView[];
  staffTraining: import("./chart").TrainingRowView[];
  myTraining: import("./chart").TrainingRowView | null;
  mySubmissionAt: string | null;
  canSubmit: boolean;
  appointments: Appointment[];
}

export interface ClinicalRenewalView extends ClinicalRenewal {
  status: RenewalStatus;
}

const KIND_ORDER: Record<ObligationKind, number> = {
  pcsp: 0,
  protocol: 1,
  delegation: 2,
  shift_task: 3,
  inventory: 4,
};

export const blankRnFields = {
  delegatingRnUserId: null as string | null,
  rnSignedAt: null as string | null,
  rnSignatureName: null as string | null,
  rnSignatureMark: null as string | null,
  discontinuedAt: null as string | null,
  discontinueFileId: null as string | null,
  discontinueTitle: null as string | null,
};

const SURVEY_PROFILE_DEFAULTS = {
  sex: "" as SexCode,
  medicaidStatus: "" as MedicaidStatus,
  specializedDiet: "",
  specializedMedical: "",
  behaviorSupports: "",
  dailyActivities: "",
  visitHours: "",
  enrolledOn: "",
  allergies: [] as Allergy[],
  allergiesStamp: null as AllergiesStamp | null,
};

export function emptyProfile(person: IndividualRecord): IndividualProfile {
  return {
    legalName: person.fullName,
    goesBy: person.fullName.split(" ")[0] ?? person.fullName,
    dmhId: "",
    diagnosis: "",
    waiver: "",
    address: "",
    phone: "",
    language: "English",
    implementationStart: "",
    implementationEnd: "",
    serviceCoordinator: "",
    guardians: [],
    providerContacts: [],
    ...SURVEY_PROFILE_DEFAULTS,
  };
}

export function normalizeProfile(
  person: IndividualRecord,
  profile?: Partial<IndividualProfile> | null,
): IndividualProfile {
  const base = emptyProfile(person);
  return {
    ...base,
    ...profile,
    guardians: normalizeGuardianContacts(profile?.guardians),
    providerContacts: normalizeProviderContacts(profile?.providerContacts),
    sex: profile?.sex ?? base.sex,
    medicaidStatus: profile?.medicaidStatus ?? base.medicaidStatus,
    specializedDiet: profile?.specializedDiet ?? "",
    specializedMedical: profile?.specializedMedical ?? "",
    behaviorSupports: profile?.behaviorSupports ?? "",
    dailyActivities: profile?.dailyActivities ?? "",
    visitHours: profile?.visitHours ?? "",
    enrolledOn: profile?.enrolledOn ?? "",
    allergies: normalizeAllergies(profile?.allergies),
    allergiesStamp: normalizeAllergiesStamp(profile?.allergiesStamp),
  };
}

export function normalizeAllergies(value: unknown): Allergy[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<Allergy>;
    const allergen = typeof row.allergen === "string" ? row.allergen.trim() : "";
    if (!allergen) return [];
    return [
      {
        allergen,
        reaction: typeof row.reaction === "string" ? row.reaction.trim() : "",
        status: row.status === "resolved" ? "resolved" : "active",
      },
    ];
  });
}

export function normalizeGuardianContacts(value: unknown): GuardianContact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<GuardianContact>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) return [];
    return [
      {
        name,
        relationship: typeof row.relationship === "string" ? row.relationship.trim() : "",
        phone: typeof row.phone === "string" ? row.phone.trim() : "",
        email: typeof row.email === "string" ? row.email.trim() : "",
        preferredContact: typeof row.preferredContact === "string" ? row.preferredContact.trim() : "",
        address: typeof row.address === "string" ? row.address.trim() : "",
        notes: typeof row.notes === "string" ? row.notes.trim() : "",
      },
    ];
  });
}

export function normalizeProviderContacts(value: unknown): ProviderContact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<ProviderContact>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) return [];
    return [
      {
        id: typeof row.id === "string" && row.id.trim() ? row.id : `provider-${index}`,
        name,
        role: typeof row.role === "string" ? row.role.trim() : "",
        phone: typeof row.phone === "string" ? row.phone.trim() : "",
        email: typeof row.email === "string" ? row.email.trim() : "",
        address: typeof row.address === "string" ? row.address.trim() : "",
        notes: typeof row.notes === "string" ? row.notes.trim() : "",
      },
    ];
  });
}

export function normalizeAllergiesStamp(value: unknown): AllergiesStamp | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<AllergiesStamp>;
  const createdByName = typeof row.createdByName === "string" ? row.createdByName.trim() : "";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : "";
  if (!createdByName || !createdAt) return null;
  return {
    createdBy: typeof row.createdBy === "string" ? row.createdBy : "",
    createdByName,
    createdAt,
    updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : "",
    updatedByName: typeof row.updatedByName === "string" ? row.updatedByName : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

export function formatAllergiesLabel(allergies: Allergy[]) {
  const rows = normalizeAllergies(allergies);
  if (rows.length === 0) return "";
  return rows
    .map((row) => {
      const reaction = row.reaction ? ` — ${row.reaction}` : "";
      return `${row.allergen} (${row.status})${reaction}`;
    })
    .join("; ");
}

export function allergiesChangeDetail(before: Allergy[], after: Allergy[]) {
  const from = formatAllergiesLabel(before) || "(none)";
  const to = formatAllergiesLabel(after) || "(none)";
  if (from === to) return "Allergies unchanged";
  return `Allergies: ${from} → ${to}`;
}

export function nextAllergiesStamp(
  existing: AllergiesStamp | null,
  actor: { userId: string; fullName: string },
  at: string,
): AllergiesStamp {
  const name = actor.fullName.trim() || "Unknown";
  if (!existing) {
    return {
      createdBy: actor.userId,
      createdByName: name,
      createdAt: at,
      updatedBy: "",
      updatedByName: "",
      updatedAt: "",
    };
  }
  return {
    ...existing,
    updatedBy: actor.userId,
    updatedByName: name,
    updatedAt: at,
  };
}

export function isObligationActive(item: ObligationItem, today = new Date().toISOString().slice(0, 10)) {
  if (!item.enabled) return false;
  if (item.expiresOn && item.expiresOn < today) return false;
  return true;
}

export function sortObligations<T extends { kind: ObligationKind; title: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kind !== 0) return kind;
    return a.title.localeCompare(b.title);
  });
}

export function requiredForSigning(items: ObligationItem[], today?: string) {
  return sortObligations(
    items.filter(
      (item) =>
        item.mode === "required" &&
        !item.proposed &&
        isObligationActive(item, today),
    ),
  );
}

/** Typical residential PCSP sections. PM edits these after extraction. */
export function proposeFromPcsp(input: {
  agencyId: string;
  individualId: string;
  documentVersionId: string;
  expiresOn: string | null;
  personName: string;
  effectiveOn: string;
}): ObligationItem[] {
  const base = {
    agencyId: input.agencyId,
    individualId: input.individualId,
    documentVersionId: input.documentVersionId,
    enabled: true,
    createdFrom: "extraction" as const,
    inventoryState: "unchecked" as const,
    proposed: true,
    shiftPeriods: [] as string[],
    expiresOn: input.expiresOn,
    delegatingRnUserId: null as string | null,
    rnSignedAt: null as string | null,
    rnSignatureName: null as string | null,
    rnSignatureMark: null as string | null,
    discontinuedAt: null as string | null,
    discontinueFileId: null as string | null,
    discontinueTitle: null as string | null,
  };

  const pcsp: ObligationItem = {
    ...base,
    id: crypto.randomUUID(),
    kind: "pcsp",
    mode: "required",
    title: `PCSP for ${input.personName}`,
    detail: `I have read and understood the PCSP that started on ${input.effectiveOn}. I had the opportunity to ask questions.`,
    sourcePage: 1,
    frequency: "On plan update",
    proposed: false,
  };

  const protocols: ObligationItem[] = (
    [
      ["Seizure protocol", "Staff follow the individual's seizure protocol and give PRN medication when needed.", 5],
      ["Bowel movement protocol", "Staff follow the bowel protocol on file in the home.", 6],
      ["Behavioral support strategies", "Staff use the positive support strategy plan when the individual is upset.", 7],
      ["PRN medication protocol", "House manager contacts RN/PM before a mood PRN is given.", 7],
      ["Eating / food size", "Food is cut to the planned size. Staff feed or hand utensils as written.", 8],
    ] as [string, string, number][]
  ).map(([title, detail, page]) => ({
    ...base,
    id: crypto.randomUUID(),
    kind: "protocol" as const,
    mode: "required" as const,
    title,
    detail,
    sourcePage: page,
    frequency: "On protocol update",
    expiresOn: null,
    proposed: false,
  }));

  const delegation: ObligationItem = {
    ...base,
    id: crypto.randomUUID(),
    kind: "delegation",
    mode: "required",
    title: "RN delegation of specified nursing task",
    detail:
      "Detected from the plan. PM or RN can turn this on for assigned staff to sign. Off until they do.",
    sourcePage: null,
    frequency: "As delegated",
    enabled: false,
    expiresOn: null,
    proposed: true,
  };

  const outcomes: ObligationItem[] = (
    [
      ["Daily body / skin checks", "Complete head-to-toe skin checks and report breakdown early.", "Daily", 12],
      ["Support while eating", "Stay present at meals, assist as needed, watch for choking.", "Daily", 12],
      ["Monitor self-injurious behavior", "Document SIB and use the support plan.", "Daily", 12],
      ["Tooth brushing support", "Support the individual to brush teeth.", "Daily", 12],
      ["Visit family / community outing", "Support planned family visits and community activities.", "Weekly", 11],
    ] as [string, string, string, number][]
  ).map(([title, detail, frequency, page]) => ({
    ...base,
    id: crypto.randomUUID(),
    kind: "inventory" as const,
    mode: "checked" as const,
    title,
    detail,
    sourcePage: page,
    frequency,
    expiresOn: null,
    proposed: false,
  }));

  const inventory: ObligationItem[] = (
    [
      ["HRST support needs", "Eating, ambulation, transfer, toileting, seizures, skin, bowel, nutrition.", 5],
      ["Adaptive equipment", "Wheelchair, shower chair, lift, and other listed equipment.", 6],
      ["Safety: 24-hour awake staffing", "No home-alone or community-alone time.", 7],
      ["Physician orders / equipment renewals", "Track expired equipment orders. Staff do not sign this.", 6],
      ["Allergies and diet", "Recorded allergies and specialized diet from the cover pages.", 6],
    ] as [string, string, number][]
  ).map(([title, detail, page]) => ({
    ...base,
    id: crypto.randomUUID(),
    kind: "inventory" as const,
    mode: "checked" as const,
    title,
    detail,
    sourcePage: page,
    frequency: "On plan update",
    expiresOn: null,
    proposed: false,
  }));

  return [pcsp, ...protocols, delegation, ...outcomes, ...inventory];
}

export function canEditCover(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "program_manager",
  ].includes(roleKey);
}

export function canEditExtraction(roleKey: string, canApprove: boolean) {
  return canApprove || roleKey === "program_manager";
}

export function canToggleDelegation(roleKey: string, role: string, canApprove: boolean) {
  return role === "nurse" || roleKey === "nurse" || canEditExtraction(roleKey, canApprove);
}

/** RN, PM, HM, admin, and auditor see clinical due dates on the chart. */
export function canSeeRenewals(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "program_manager",
    "nurse",
    "auditor",
  ].includes(roleKey);
}

export function canUploadRenewal(roleKey: string) {
  return canSeeRenewals(roleKey) && roleKey !== "auditor";
}

export function canSignAsDelegatingRn(roleKey: string, role: string) {
  return role === "nurse" || roleKey === "nurse";
}

export function staffCanSignDelegation(item: ObligationItem) {
  if (item.kind !== "delegation") return true;
  return Boolean(item.enabled && item.rnSignedAt);
}

export function addMonths(isoDate: string, months: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export function renewalStatus(
  nextDueOn: string,
  today = new Date().toISOString().slice(0, 10),
): RenewalStatus {
  if (nextDueOn < today) return "overdue";
  const horizon = addMonths(today, 1);
  if (nextDueOn <= horizon) return "due_soon";
  return "current";
}

export function defaultRenewals(
  agencyId: string,
  individualId: string,
  today = "2026-09-12",
): ClinicalRenewal[] {
  const specs: [ClinicalRenewalKind, string, string][] = [
    ["annual_physical", "Annual physical", addMonths(today, 1)],
    ["vision", "Vision exam", addMonths(today, -6)],
    ["dental", "Dental exam", addMonths(today, 4)],
    ["physician_orders", "Physician orders / equipment", addMonths(today, 0)],
  ];
  return specs.map(([kind, title, nextDueOn]) => ({
    id: `${individualId}-${kind}`,
    agencyId,
    individualId,
    kind,
    title,
    intervalMonths: 12,
    lastUploadedOn: addMonths(nextDueOn, -12),
    nextDueOn,
    lastDocumentTitle: null,
    lastEvidenceKind: null,
    fileId: null,
  }));
}

export function renewalBadge(status: RenewalStatus) {
  if (status === "overdue") return "Overdue";
  if (status === "due_soon") return "Due soon";
  return "Current";
}

export function applyRenewalUpload(
  row: ClinicalRenewal,
  input: {
    uploadedOn: string;
    documentTitle: string;
    evidenceKind: ClinicalEvidenceKind;
    fileId?: string | null;
  },
): ClinicalRenewal {
  return {
    ...row,
    lastUploadedOn: input.uploadedOn,
    nextDueOn: addMonths(input.uploadedOn, row.intervalMonths),
    lastDocumentTitle: input.documentTitle,
    lastEvidenceKind: input.evidenceKind,
    fileId: input.fileId ?? row.fileId,
  };
}
