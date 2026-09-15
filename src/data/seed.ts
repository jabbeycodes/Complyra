import {
  individuals as demoPeople,
  seedActivity,
  seedPlans,
  seedRequirements,
  sites as demoSites,
  staff as demoStaff,
} from "../domain";
import type {
  AcknowledgmentPacket,
  AcknowledgmentRow,
  Agency,
  AuditEvent,
  DocumentRecord,
  DocumentVersion,
  IndividualRecord,
  Membership,
  MileageTrip,
  Profile,
  Program,
  RequirementRecord,
  SiteRecord,
  StaffAssignment,
  StaffCertificate,
  MedDoseException,
} from "./types";
import type {
  ClinicalRenewal,
  IndividualProfile,
  ObligationItem,
  ObligationSignature,
  PacketSubmission,
} from "./planStack";
import { defaultRenewals } from "./planStack";
import {
  defaultEllisMedications,
  mergeTrainingLines,
  trainingLinesFromObligations,
  type ChartFile,
  type Medication,
  type MedicationDelivery,
  type TrainingChecklist,
} from "./chart";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES, type AgencyRole } from "./permissions";
import {
  blankSafetyLines,
  type AdaptiveEquipment,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
} from "./monthlyChecks";
import {
  applyWellWaterDefault,
  blankSiteReview,
  mergeSiteReviewLines,
  type SiteReview,
} from "./siteReview";
import type { DspHmRating, HmDspReview } from "../recognition/recognition";
import {
  DELEGATION_TEMPLATES,
  type DelegationAcknowledgment,
  type DelegationTemplate,
  type DelegationTrainingMaterial,
  type IndividualDelegationAssignment,
  type SiteDelegationActivation,
} from "../delegation/delegation";
import type { CorrectiveAction } from "./correctiveActions";
import type { ScoreSnapshot } from "./complianceScore";

export const AGENCY_ID = "00000000-0000-4000-8000-000000000001";
export const PLATFORM_AGENCY_ID = "00000000-0000-4000-8000-000000000090";
export const PLATFORM_USER_ID = "00000000-0000-4000-8000-000000000091";
const RESIDENTIAL_ID = "00000000-0000-4000-8000-000000000002";
const SUPPORTED_ID = "00000000-0000-4000-8000-000000000003";

function padId(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function emailFor(name: string) {
  return `${name.toLowerCase().replaceAll(" ", ".")}@evergreen.example`;
}

export interface LocalDatabase {
  agencies: Agency[];
  programs: Program[];
  sites: SiteRecord[];
  profiles: Profile[];
  memberships: Membership[];
  agencyRoles: AgencyRole[];
  credentials: { userId: string; email: string; password: string }[];
  individuals: IndividualRecord[];
  assignments: StaffAssignment[];
  documents: DocumentRecord[];
  versions: DocumentVersion[];
  requirements: RequirementRecord[];
  packets: AcknowledgmentPacket[];
  rows: AcknowledgmentRow[];
  audit: AuditEvent[];
  obligations: ObligationItem[];
  obligationSignatures: ObligationSignature[];
  packetSubmissions: PacketSubmission[];
  clinicalRenewals: ClinicalRenewal[];
  chartFiles: ChartFile[];
  medications: Medication[];
  medicationDeliveries: MedicationDelivery[];
  medDoseExceptions: MedDoseException[];
  trainingChecklists: TrainingChecklist[];
  adaptiveEquipment: AdaptiveEquipment[];
  equipmentMonthLogs: EquipmentMonthLog[];
  emergencyDrills: EmergencyDrill[];
  homeSafetyReports: HomeSafetyReport[];
  siteReviews: SiteReview[];
  // LIFEPATH-P4 (certificates): per-staff certificate records for HR tracking.
  certificates: StaffCertificate[];
  // AUDIT-READINESS: corrective actions are created by managers after go-live.
  correctiveActions: CorrectiveAction[];
  // AUDIT-READINESS: compliance score snapshots for the trend chart.
  complianceSnapshots: ScoreSnapshot[];
  // LIFEPATH-P7 (mileage): vehicle mileage trip rows, one per house trip.
  mileageTrips: MileageTrip[];
  // RECOGNITION: bidirectional ratings/reviews + weekly winners (winners-only).
  dspHmRatings: DspHmRating[];
  dspHmRatingHistory: RecognitionHistoryRow[];
  hmDspReviews: HmDspReview[];
  hmDspReviewHistory: RecognitionHistoryRow[];
  recognitionWinners: RecognitionWinnerRow[];
  notifications: RecognitionNotificationRow[];
  notificationReads?: Record<string, string>;
  // DELEGATION: template workflow — common/agency templates, site
  // activations, per-individual assignments, training materials, acks.
  delegationTemplates: DelegationTemplate[];
  siteDelegationActivations: SiteDelegationActivation[];
  individualDelegationAssignments: IndividualDelegationAssignment[];
  delegationTrainingMaterials: DelegationTrainingMaterial[];
  delegationAcknowledgments: DelegationAcknowledgment[];
  // PCSP-EXTRACTION: document uploads, AI extractions, proposed trackable
  // items, audit log, and per-agency AI settings (local demo shapes).
  documentUploads: import("./documents").DocumentUpload[];
  documentExtractions: LocalDocumentExtraction[];
  documentTrackableItems: import("./documents").TrackableItem[];
  documentAuditLog: LocalDocumentAuditEntry[];
  agencyAiSettings: LocalAgencyAiSettings[];
  // QA-AUDIT (2026-09-14): quarterly program-site QA reviews, their scored
  // items, and per-site audit schedules.
  qaAudits: import("./qaAudit").QaAudit[];
  qaAuditItems: import("./qaAudit").StoredQaAuditItem[];
  qaSchedules: import("./qaAudit").QaAuditSchedule[];
}

/** Local demo shape for one AI extraction (mirrors document_extractions). */
export interface LocalDocumentExtraction {
  id: string;
  agencyId: string;
  uploadId: string;
  schemaVersion: number;
  extractedData: import("./documents").PcspExtraction | import("./documents").AnnualPhysicianOrderExtraction;
  confidence: Record<string, unknown>;
  model: string;
  createdAt: string;
}

/** Local demo shape for one audit entry (mirrors document_audit_log). */
export interface LocalDocumentAuditEntry {
  id: string;
  agencyId: string;
  uploadId: string | null;
  actor: string | null;
  action: string;
  at: string;
  detail: Record<string, unknown>;
}

/** Local demo shape for per-agency AI settings (mirrors agency_ai_settings). */
export interface LocalAgencyAiSettings {
  agencyId: string;
  aiProcessingEnabled: boolean;
  model: string;
  serviceAccountVerifiedAt: string | null;
  vertexProjectId: string | null;
}

/** Append-only change record for one rating/review row (local store shape). */
export interface RecognitionHistoryRow {
  id: string;
  parentId: string; // rating or review id
  agencyId: string;
  oldRating: number | null;
  newRating: number;
  changedBy: string;
  createdAt: string;
}

/** Weekly winner row (local store shape). */
export interface RecognitionWinnerRow {
  id: string;
  agencyId: string;
  weekStart: string;
  category: "hm_of_the_week" | "dsp_of_the_week";
  winnerId: string;
  highlights: string[];
  decidedAt: string;
}

/** Notification row (local store shape; mirrors the hosted table). */
export interface RecognitionNotificationRow {
  id: string;
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
  createdAt: string;
  readAt: string | null;
}

export function createEvergreenSeed(): LocalDatabase {
  const programs: Program[] = [
    { id: RESIDENTIAL_ID, agencyId: AGENCY_ID, name: "Residential services" },
    { id: SUPPORTED_ID, agencyId: AGENCY_ID, name: "Supported living" },
  ];
  const sites: SiteRecord[] = demoSites.map((site, i) => {
    const cedar = site.name === "Cedar House";
    return {
      id: padId(11 + i),
      agencyId: AGENCY_ID,
      programId:
        site.program === "Supported living" ? SUPPORTED_ID : RESIDENTIAL_ID,
      name: site.name,
      address: site.address,
      serviceType: "ISL",
      staffed24h: true,
      overnightSleepStaff: false,
      wellWater: false,
      lastWaterTestOn: "",
      sitePhone: cedar ? "573-555-0144" : "573-555-0188",
      contactName: cedar ? "Sarah Mitchell" : "James Wilson",
      contactPhone: cedar ? "573-555-0144" : "573-555-0188",
      city: cedar ? "Columbia" : "Columbia",
      county: "Boone",
      zip: cedar ? "65202" : "65203",
    };
  });
  const siteByName = Object.fromEntries(sites.map((s) => [s.name, s]));
  const profiles: Profile[] = demoStaff.map((member, i) => ({
    id: padId(201 + i),
    fullName: member.name,
    email: emailFor(member.name),
    jobTitle: member.role,
    username: emailFor(member.name).split("@")[0],
    homeAgencyId: AGENCY_ID,
    mustChangePassword: false,
  }));
  const profileByName = Object.fromEntries(
    profiles.map((p) => [p.fullName, p]),
  );
  const memberships: Membership[] = demoStaff.map((member, i) => {
    const isSarah = member.name === "Sarah Mitchell";
    return {
      id: padId(301 + i),
      agencyId: AGENCY_ID,
      userId: padId(201 + i),
      role: isSarah
        ? "administrator"
        : member.role === "House Manager"
          ? "manager"
          : member.role === "Nurse"
            ? "nurse"
            : "dsp",
      roleKey: isSarah
        ? "administrator"
        : member.role === "House Manager"
          ? "house_manager"
          : member.role === "Nurse"
            ? "nurse"
            : "dsp",
      siteId: isSarah ? null : siteByName[member.site].id,
      expiresOn: null,
    };
  });
  const agencyRoles: AgencyRole[] = ROLE_TEMPLATES.map((template) => ({
    ...template,
    agencyId: AGENCY_ID,
  }));
  const individuals: IndividualRecord[] = demoPeople.map((person, i) => ({
    id: padId(101 + i),
    agencyId: AGENCY_ID,
    siteId: siteByName[person.site].id,
    fullName: person.name,
    dateOfBirth: `${1978 + (i % 18)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`,
  }));
  const individualByName = Object.fromEntries(
    individuals.map((p) => [p.fullName, p]),
  );
  const assignments: StaffAssignment[] = [];
  individuals.forEach((person, i) => {
    const siteStaff = demoStaff.filter(
      (s) => siteByName[s.site].id === person.siteId,
    );
    siteStaff.forEach((member, j) => {
      assignments.push({
        id: padId(401 + i * 10 + j),
        agencyId: AGENCY_ID,
        userId: profileByName[member.name].id,
        individualId: person.id,
        siteId: person.siteId,
        startsOn: "2026-01-01",
        endsOn: null,
      });
    });
  });

  const documents: DocumentRecord[] = [];
  const versions: DocumentVersion[] = [];
  seedPlans.forEach((plan, i) => {
    const person = individualByName[plan.person];
    let document = documents.find((d) => d.title === plan.name);
    if (!document) {
      document = {
        id: padId(501 + documents.length),
        agencyId: AGENCY_ID,
        individualId: person.id,
        title: plan.name,
        kind: plan.name.includes("Behavior") ? "other" : "pcsp",
      };
      documents.push(document);
    }
    versions.push({
      id: padId(601 + i),
      agencyId: AGENCY_ID,
      documentId: document.id,
      versionLabel: plan.version,
      status:
        plan.status === "Pending review"
          ? "pending_review"
          : plan.status === "Archived"
            ? "archived"
            : "active",
      storagePath: null,
      contentHash: null,
      pageCount: plan.pages,
      effectiveOn: plan.effective,
      expiresOn: plan.status === "Active" ? "2027-06-30" : null,
      createdBy: profileByName["Sarah Mitchell"].id,
    });
  });

  const versionBySource = Object.fromEntries(
    versions.map((v) => {
      const doc = documents.find((d) => d.id === v.documentId)!;
      return [`${doc.title} · ${v.versionLabel}`, v];
    }),
  );

  const requirements: RequirementRecord[] = seedRequirements.map((item, i) => {
    const owner = profileByName[item.owner];
    const site = siteByName[item.site];
    const person =
      item.person === "Site-wide" ? null : individualByName[item.person];
    const version = versionBySource[item.source] ?? null;
    return {
      id: item.id.length > 8 ? item.id : padId(701 + i),
      agencyId: AGENCY_ID,
      documentVersionId: version?.id ?? null,
      individualId: person?.id ?? null,
      siteId: site.id,
      title: item.title,
      category: item.category,
      ownerUserId: owner?.id ?? null,
      dueOn: item.due,
      frequency: item.frequency,
      sourcePage: item.page,
      status: item.status,
      evidenceNote: item.evidence,
      completedAt: item.completedAt,
    };
  });

  const ellis = individualByName["Ellis Hart"];
  const ellisProfile: IndividualProfile = {
    legalName: "Ellis Hart",
    goesBy: "Ellis",
    dmhId: "110245",
    diagnosis: "Unspecified intellectual disability",
    waiver: "Comprehensive Residential",
    address: "418 Cedar Court",
    phone: "573-555-0144",
    language: "English",
    implementationStart: "2026-01-15",
    implementationEnd: "2027-01-14",
    serviceCoordinator: "Ashley Allen",
    sex: "F",
    medicaidStatus: "yes",
    specializedDiet: "No concentrated sweets. Nut allergy.",
    specializedMedical: "Seizure protocol. Wheelchair for community distances.",
    behaviorSupports: "None",
    dailyActivities: "Day habilitation, weekdays",
    visitHours: "Weekdays after 4:00 p.m.; weekends by appointment",
    enrolledOn: "2026-01-15",
    guardians: [
      {
        name: "Dana Hart",
        relationship: "Sibling",
        phone: "573-555-0199",
        email: "guardian@example.com",
        preferredContact: "Phone",
      },
    ],
  };
  const ellisRecord = individuals.find((p) => p.id === ellis.id);
  if (ellisRecord) ellisRecord.profile = ellisProfile;
  attachSurveyProfiles(individuals);
  const ellisV2 = versions.find((v) => {
    const doc = documents.find((d) => d.id === v.documentId);
    return doc?.title === "Ellis Hart · PCSP 2026" && v.versionLabel === "v2";
  })!;
  const packet: AcknowledgmentPacket = {
    id: padId(801),
    agencyId: AGENCY_ID,
    individualId: ellis.id,
    documentVersionId: ellisV2.id,
    whatAcknowledging: "PCSP 2026 · v2",
    startsOn: ellisV2.effectiveOn,
    endsOn: ellisV2.expiresOn,
    status: "open",
  };
  const ellisStaff = assignments.filter((a) => a.individualId === ellis.id);
  const rows: AcknowledgmentRow[] = ellisStaff.map((assignment, i) => {
    const profile = profiles.find((p) => p.id === assignment.userId)!;
    const signed = profile.fullName === "Sarah Mitchell";
    return {
      id: padId(901 + i),
      agencyId: AGENCY_ID,
      packetId: packet.id,
      userId: profile.id,
      staffName: profile.fullName,
      addedManually: false,
      addReason: null,
      openedAt: signed ? "2026-07-02T15:00:00.000Z" : null,
      signedAt: signed ? "2026-07-02T15:04:00.000Z" : null,
      signatureName: signed ? profile.fullName : null,
      signatureMark: signed ? "signed" : null,
    };
  });

  const { obligations: ellisObligations, obligationSignatures: ellisObligationSignatures } =
    buildEllisStack(
      AGENCY_ID,
      ellis.id,
      ellisV2.id,
      ellisStaff.map((assignment) => {
        const profile = profiles.find((p) => p.id === assignment.userId)!;
        return {
          userId: profile.id,
          staffName: profile.fullName,
          signedPcsp: profile.fullName === "Sarah Mitchell",
        };
      }),
    );

  const audit: AuditEvent[] = seedActivity.map((event, i) => ({
    id: padId(1001 + i),
    agencyId: AGENCY_ID,
    actorId: profileByName["Sarah Mitchell"].id,
    action: event.kind,
    targetType: "requirement",
    targetId: null,
    detail: `${event.text} · ${event.detail}`,
    createdAt: event.time,
  }));

  return {
    agencies: [
      {
        id: AGENCY_ID,
        name: "Evergreen Care",
        agencyCode: "EVERGREEN-MO",
        stateCode: "MO",
        provisionedBy: "platform",
        status: "active",
        monthlyDue: { equipmentDay: 7, drillDay: 7, safetyDay: 7 },
        logoPath: `agency/${AGENCY_ID}/logo`,
      },
      {
        id: PLATFORM_AGENCY_ID,
        name: "Complyrer",
        agencyCode: "COMPLYRER-MO",
        stateCode: "MO",
        provisionedBy: "platform",
        status: "active",
      },
    ],
    programs,
    sites,
    profiles: [
      ...profiles,
      {
        id: PLATFORM_USER_ID,
        fullName: "Complyrer operator",
        email: "platform.owner@complyrer.com",
        jobTitle: "Platform owner",
        username: "platform.owner",
        homeAgencyId: PLATFORM_AGENCY_ID,
        mustChangePassword: false,
        platformAdmin: true,
      },
    ],
    memberships: [
      ...memberships,
      {
        id: padId(390),
        agencyId: PLATFORM_AGENCY_ID,
        userId: PLATFORM_USER_ID,
        role: "administrator",
        roleKey: "administrator",
        siteId: null,
        expiresOn: null,
      },
    ],
    agencyRoles: [
      ...agencyRoles,
      ...ROLE_TEMPLATES.map((template) => ({
        ...template,
        agencyId: PLATFORM_AGENCY_ID,
      })),
    ],
    credentials: [
      ...profiles.map((profile) => ({
        userId: profile.id,
        email: profile.email,
        password: DEMO_PASSWORD,
      })),
      {
        userId: PLATFORM_USER_ID,
        email: "platform.owner@complyrer.com",
        password: DEMO_PASSWORD,
      },
    ],
    individuals,
    assignments,
    documents,
    versions,
    requirements,
    packets: [packet],
    rows,
    audit,
    obligations: ellisObligations,
    obligationSignatures: ellisObligationSignatures,
    packetSubmissions: [],
    clinicalRenewals: individuals.flatMap((person) =>
      // Vary the reference date per person so annual physical, vision,
      // dental, and physician-order cards don't show identical dates.
      defaultRenewals(AGENCY_ID, person.id, renewalSeedToday(person.fullName)),
    ),
    chartFiles: [],
    medications: defaultEllisMedications(AGENCY_ID, ellis.id),
    medicationDeliveries: [],
    medDoseExceptions: [],
    trainingChecklists: buildTrainingChecklists(
      AGENCY_ID,
      ellis.id,
      ellisV2.id,
      ellisObligations,
      ellisStaff.map((assignment) => {
        const profile = profiles.find((p) => p.id === assignment.userId)!;
        return { userId: profile.id, staffName: profile.fullName };
      }),
    ),
    ...buildMonthlySeed(sites, individuals),
    siteReviews: buildSiteReviewSeed(sites),
    // LIFEPATH-P4 (certificates): a realistic starter set so the demo shows
    // the expiry countdown working — two expiring within 90 days, one
    // already expired, the rest current.
    certificates: buildCertificateSeed(profileByName),
    // LIFEPATH-P4 (certificates): HR adds certificate records after go-live.
    // AUDIT-READINESS: managers create corrective actions after go-live.
    correctiveActions: [],
    // AUDIT-READINESS: score snapshots accumulate as the command center runs.
    complianceSnapshots: [],
    // LIFEPATH-P7 (mileage): staff log vehicle trips per house after go-live.
    mileageTrips: [],
    // RECOGNITION: ratings/reviews and winners accumulate through use.
    dspHmRatings: [],
    dspHmRatingHistory: [],
    hmDspReviews: [],
    hmDspReviewHistory: [],
    recognitionWinners: [],
    notifications: [],
    // DELEGATION: seed the common template library (agencyId null = every
    // agency). Site activations, assignments, materials, and acks accrue
    // through the workflow.
    delegationTemplates: DELEGATION_TEMPLATES.map((template, i) => ({
      ...template,
      id: `tpl-${String(i + 1).padStart(2, "0")}`,
      agencyId: null,
      active: true,
    })),
    siteDelegationActivations: [],
    individualDelegationAssignments: [],
    delegationTrainingMaterials: [],
    delegationAcknowledgments: [],
    // PCSP-EXTRACTION: empty in the seed — uploads are created at runtime.
    documentUploads: [],
    documentExtractions: [],
    documentTrackableItems: [],
    documentAuditLog: [],
    agencyAiSettings: [],
    // QA-AUDIT: created at runtime — audits, items, and schedules.
    qaAudits: [],
    qaAuditItems: [],
    qaSchedules: [],
  };
}

function attachSurveyProfiles(people: IndividualRecord[]) {
  const extras: Record<string, Partial<IndividualProfile>> = {
    "Morgan Pruitt": {
      legalName: "Morgan Pruitt",
      goesBy: "Morgan",
      dmhId: "110312",
      diagnosis: "Mild intellectual disability",
      waiver: "Comprehensive Residential",
      address: "418 Cedar Court",
      sex: "M",
      medicaidStatus: "yes",
      specializedDiet: "None",
      specializedMedical: "Gait belt for transfers.",
      behaviorSupports: "None",
      dailyActivities: "Community employment, weekdays",
      visitHours: "Evenings after 5:00 p.m.",
      serviceCoordinator: "Jason Briscoe",
    },
    "Reese Lang": {
      legalName: "Reese Lang",
      goesBy: "Reese",
      dmhId: "110418",
      diagnosis: "Unspecified intellectual disability",
      waiver: "Comprehensive Residential",
      address: "920 Willow Lane",
      sex: "M",
      medicaidStatus: "ida",
      specializedDiet: "Texture-modified diet. No thin liquids.",
      specializedMedical: "Enteral feeding support.",
      behaviorSupports: "Positive behavior supports on file",
      dailyActivities: "Day habilitation, weekdays",
      visitHours: "Weekends 10:00 a.m. to 2:00 p.m.",
      serviceCoordinator: "Jason Briscoe",
    },
    "Harper Soto": {
      legalName: "Harper Soto",
      goesBy: "Harper",
      dmhId: "110509",
      diagnosis: "Moderate intellectual disability",
      waiver: "Comprehensive Residential",
      address: "920 Willow Lane",
      sex: "F",
      medicaidStatus: "yes",
      specializedDiet: "None",
      specializedMedical: "Shower chair. Fall risk in wet areas.",
      behaviorSupports: "None",
      dailyActivities: "Volunteer site, Tuesday and Thursday",
      visitHours: "Weekdays after 3:00 p.m.",
      serviceCoordinator: "Ashley Allen",
    },
  };
  for (const person of people) {
    const extra = extras[person.fullName];
    if (!extra) continue;
    person.profile = {
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
      sex: "",
      medicaidStatus: "",
      specializedDiet: "",
      specializedMedical: "",
      behaviorSupports: "",
      dailyActivities: "",
      visitHours: "",
      enrolledOn: "",
      ...person.profile,
      ...extra,
    };
  }
}

/** Per-person reference date so seeded clinical renewals vary realistically. */
function renewalSeedToday(fullName: string): string {
  switch (fullName) {
    case "Morgan Pruitt":
      return "2026-08-20";
    case "Reese Lang":
      return "2026-09-25";
    case "Harper Soto":
      return "2026-07-30";
    default:
      return "2026-09-12";
  }
}

function buildCertificateSeed(
  profileByName: Record<string, Profile>,
): StaffCertificate[] {
  const hr = profileByName["James Wilson"];
  const specs: Array<{
    staffName: string;
    certName: string;
    issuedOn: string;
    expiresOn: string;
  }> = [
    // Expiring within 90 days of the demo "today" (2026-09-14).
    { staffName: "Alex Morgan", certName: "CPR", issuedOn: "2024-10-20", expiresOn: "2026-10-20" },
    { staffName: "Casey Adams", certName: "Positive Behavior Support", issuedOn: "2025-01-15", expiresOn: "2026-11-15" },
    // Already expired — HR needs to see this too.
    { staffName: "James Wilson", certName: "First Aid", issuedOn: "2024-08-01", expiresOn: "2026-08-01" },
    // Current.
    { staffName: "Taylor Reed", certName: "Crisis Prevention (CPI)", issuedOn: "2026-03-10", expiresOn: "2027-03-10" },
    { staffName: "Jordan Lee", certName: "Level 1 Medication Aide", issuedOn: "2026-06-01", expiresOn: "2027-06-01" },
    { staffName: "Cameron Price", certName: "CPR", issuedOn: "2026-02-15", expiresOn: "2027-02-15" },
  ];
  return specs.map((spec, i) => ({
    id: padId(1601 + i),
    agencyId: AGENCY_ID,
    userId: profileByName[spec.staffName].id,
    certName: spec.certName,
    issuedOn: spec.issuedOn,
    expiresOn: spec.expiresOn,
    filePath: null,
    fileName: null,
    enteredBy: hr.id,
    createdAt: `${spec.issuedOn}T09:00:00.000Z`,
  }));
}

function buildSiteReviewSeed(sites: SiteRecord[]): SiteReview[] {
  return sites.map((site, i) => {
    const blank = blankSiteReview({
      id: padId(1501 + i),
      agencyId: site.agencyId,
      siteId: site.id,
      updatedAt: "2026-07-15T16:00:00.000Z",
    });
    if (site.name !== "Cedar House") return blank;
    const complete = applyWellWaterDefault(
      {
        ...blank,
        reviewerName: "Sarah Mitchell",
        supportCoordinator: "Jason Briscoe",
        reviewedOn: "2026-07-15",
        providerOwnedControlled: true,
        heightenedScrutiny: false,
        meetsIndividualNeeds: true,
        part2Verified: true,
        lines: mergeSiteReviewLines(
          blank.lines.map((line) => ({
            ...line,
            status: line.id === "int-well-water" ? "na" : "satisfactory",
          })),
        ),
      },
      {
        serviceType: site.serviceType ?? "ISL",
        staffed24h: Boolean(site.staffed24h),
        overnightSleepStaff: Boolean(site.overnightSleepStaff),
        wellWater: Boolean(site.wellWater),
        lastWaterTestOn: site.lastWaterTestOn ?? "",
        sitePhone: site.sitePhone ?? "",
        contactName: site.contactName ?? "",
        contactPhone: site.contactPhone ?? "",
        city: site.city ?? "",
        county: site.county ?? "",
        zip: site.zip ?? "",
      },
    );
    return complete;
  });
}

function buildMonthlySeed(
  sites: SiteRecord[],
  people: IndividualRecord[],
): {
  adaptiveEquipment: AdaptiveEquipment[];
  equipmentMonthLogs: EquipmentMonthLog[];
  emergencyDrills: EmergencyDrill[];
  homeSafetyReports: HomeSafetyReport[];
} {
  const byName = Object.fromEntries(people.map((row) => [row.fullName, row]));
  const adaptiveEquipment: AdaptiveEquipment[] = [
    {
      id: padId(1301),
      agencyId: AGENCY_ID,
      individualId: byName["Ellis Hart"].id,
      name: "Wheelchair",
      source: "pcsp",
      active: true,
    },
    {
      id: padId(1302),
      agencyId: AGENCY_ID,
      individualId: byName["Ellis Hart"].id,
      name: "Shower chair",
      source: "pcsp",
      active: true,
    },
    {
      id: padId(1303),
      agencyId: AGENCY_ID,
      individualId: byName["Morgan Pruitt"].id,
      name: "Gait belt",
      source: "manual",
      active: true,
    },
    {
      id: padId(1304),
      agencyId: AGENCY_ID,
      individualId: byName["Harper Soto"].id,
      name: "Shower chair",
      source: "pcsp",
      active: true,
    },
  ];
  const equipmentMonthLogs: EquipmentMonthLog[] = adaptiveEquipment.map((item, i) => ({
    id: padId(1311 + i),
    equipmentId: item.id,
    monthKey: "2026-08",
    checkedOn: "2026-08-04",
    initials: item.individualId === byName["Harper Soto"].id ? "JW" : "AM",
    checkedByUserId: null,
    comments: "",
  }));
  const emergencyDrills: EmergencyDrill[] = [];
  const homeSafetyReports: HomeSafetyReport[] = [];
  let n = 1321;
  for (const site of sites) {
    for (const drillType of ["fire", "tornado", "earthquake"] as const) {
      emergencyDrills.push({
        id: padId(n++),
        agencyId: AGENCY_ID,
        siteId: site.id,
        monthKey: "2026-08",
        drillType,
        date: "2026-08-05",
        time: "14:20",
        evacTime: "2:05",
        leaderName: site.name === "Cedar House" ? "Alex Morgan" : "James Wilson",
        participants:
          site.name === "Cedar House"
            ? "Alex Morgan, Taylor Reed, Ellis Hart, Morgan Pruitt"
            : "James Wilson, Jordan Lee, Reese Lang, Harper Soto",
        awakeOrSleep: drillType === "fire" ? "awake" : "",
      });
    }
    homeSafetyReports.push({
      id: padId(n++),
      agencyId: AGENCY_ID,
      siteId: site.id,
      monthKey: "2026-08",
      lines: blankSafetyLines().map((line) => ({
        ...line,
        dateChecked: "2026-08-03",
        location:
          line.key.includes("smoke") || line.key === "co_1"
            ? "Hallway"
            : line.key.includes("faucet")
              ? "Kitchen"
              : "",
        temp: line.key.includes("faucet") ? "116 F" : "",
        extra: line.key === "fire_extinguisher" ? "2027-03 / full" : "",
        checkedBy: site.name === "Cedar House" ? "Alex Morgan" : "James Wilson",
        signature: site.name === "Cedar House" ? "Alex Morgan" : "James Wilson",
      })),
    });
  }
  return { adaptiveEquipment, equipmentMonthLogs, emergencyDrills, homeSafetyReports };
}

function buildTrainingChecklists(
  agencyId: string,
  individualId: string,
  documentVersionId: string,
  obligations: ObligationItem[],
  staff: { userId: string; staffName: string }[],
): TrainingChecklist[] {
  const lines = trainingLinesFromObligations(obligations);
  return staff.map((member, i) => ({
    id: padId(1401 + i),
    agencyId,
    individualId,
    staffUserId: member.userId,
    staffName: member.staffName,
    documentVersionId,
    items: mergeTrainingLines([], lines),
    staffSignedAt: null,
    staffSignatureName: null,
    hmSignedAt: null,
    hmSignatureName: null,
  }));
}

function buildEllisStack(
  agencyId: string,
  personId: string,
  versionId: string,
  staff: { userId: string; staffName: string; signedPcsp: boolean }[],
): {
  obligations: ObligationItem[];
  obligationSignatures: ObligationSignature[];
} {
  const obligations: ObligationItem[] = [
    {
      id: padId(1101),
      agencyId,
      individualId: personId,
      kind: "pcsp",
      mode: "required",
      title: "PCSP for Ellis Hart",
      detail:
        "I have read and understood the PCSP that started on 1/15/2026. I had the opportunity to ask questions.",
      sourcePage: 1,
      documentVersionId: versionId,
      enabled: true,
      frequency: "On plan update",
      shiftPeriods: [],
      expiresOn: "2027-01-14",
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1102),
      agencyId,
      individualId: personId,
      kind: "protocol",
      mode: "required",
      title: "Seizure protocol",
      detail: "Follow the seizure protocol on file and give PRN medication when needed.",
      sourcePage: 5,
      documentVersionId: versionId,
      enabled: true,
      frequency: "On protocol update",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1103),
      agencyId,
      individualId: personId,
      kind: "protocol",
      mode: "required",
      title: "Behavioral support strategies",
      detail: "Use the positive support plan when Ellis is upset or wants space.",
      sourcePage: 7,
      documentVersionId: versionId,
      enabled: true,
      frequency: "On protocol update",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1104),
      agencyId,
      individualId: personId,
      kind: "delegation",
      mode: "required",
      title: "RN delegation of specified nursing task",
      detail: "Injectable medication administration. DPM/RN can turn this on for assigned staff.",
      sourcePage: null,
      documentVersionId: null,
      enabled: false,
      frequency: "As delegated",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "unchecked",
      proposed: true,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1105),
      agencyId,
      individualId: personId,
      kind: "shift_task",
      mode: "required",
      title: "Daily body / skin checks",
      detail: "Complete head-to-toe skin checks on shift and report breakdown early.",
      sourcePage: 12,
      documentVersionId: versionId,
      enabled: true,
      frequency: "Daily",
      shiftPeriods: ["7a–3p", "3p–11p"],
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
    },
    {
      id: padId(1106),
      agencyId,
      individualId: personId,
      kind: "inventory",
      mode: "checked",
      title: "HRST support needs",
      detail: "Eating, ambulation, transfer, toileting, seizures, and skin integrity.",
      sourcePage: 5,
      documentVersionId: versionId,
      enabled: true,
      frequency: "On plan update",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1108),
      agencyId,
      individualId: personId,
      kind: "inventory",
      mode: "checked",
      title: "Adaptive equipment",
      detail: "Wheelchair, shower chair, and other listed equipment.",
      sourcePage: 6,
      documentVersionId: versionId,
      enabled: true,
      frequency: "Monthly",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
    {
      id: padId(1107),
      agencyId,
      individualId: personId,
      kind: "inventory",
      mode: "checked",
      title: "Physician orders / equipment renewals",
      detail: "Wheelchair and shower chair orders. Staff do not sign. DPM tracks renewal.",
      sourcePage: 6,
      documentVersionId: versionId,
      enabled: true,
      frequency: "Annually",
      shiftPeriods: [],
      expiresOn: null,
      createdFrom: "extraction",
      inventoryState: "present",
      proposed: false,
      delegatingRnUserId: null,
      rnSignedAt: null,
      rnSignatureName: null,
      rnSignatureMark: null,
      discontinuedAt: null,
      discontinueFileId: null,
      discontinueTitle: null,
    },
  ];

  const obligationSignatures: ObligationSignature[] = [];
  let n = 1201;
  for (const item of obligations) {
    if (item.mode !== "required" || !item.enabled) continue;
    for (const member of staff) {
      const signed = member.signedPcsp && item.kind === "pcsp";
      obligationSignatures.push({
        id: padId(n++),
        agencyId,
        obligationId: item.id,
        userId: member.userId,
        staffName: member.staffName,
        openedAt: signed ? "2026-07-02T15:00:00.000Z" : null,
        signedAt: signed ? "2026-07-02T15:04:00.000Z" : null,
        signatureName: signed ? member.staffName : null,
        signatureMark: signed ? "signed" : null,
      });
    }
  }
  return { obligations, obligationSignatures };
}

export const DEMO_AGENCY_CODE = "EVERGREEN-MO";
export const PLATFORM_AGENCY_CODE = "COMPLYRER-MO";
export const PLATFORM_USERNAME = "platform.owner";
export const DEMO_ADMIN_EMAIL = emailFor("Sarah Mitchell");
export const DEMO_DSP_EMAIL = emailFor("Alex Morgan");
export const DEMO_ADMIN_USERNAME = DEMO_ADMIN_EMAIL.split("@")[0];
export const DEMO_DSP_USERNAME = DEMO_DSP_EMAIL.split("@")[0];
export const DEMO_NURSE_EMAIL = emailFor("Cameron Price");
export const DEMO_HM_EMAIL = emailFor("James Wilson");
export const DEMO_NURSE_USERNAME = DEMO_NURSE_EMAIL.split("@")[0];
export const DEMO_HM_USERNAME = DEMO_HM_EMAIL.split("@")[0];
