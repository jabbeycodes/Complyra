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
  Profile,
  Program,
  RequirementRecord,
  SiteRecord,
  StaffAssignment,
} from "./types";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES, type AgencyRole } from "./permissions";

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
}

export function createEvergreenSeed(): LocalDatabase {
  const programs: Program[] = [
    { id: RESIDENTIAL_ID, agencyId: AGENCY_ID, name: "Residential services" },
    { id: SUPPORTED_ID, agencyId: AGENCY_ID, name: "Supported living" },
  ];
  const sites: SiteRecord[] = demoSites.map((site, i) => ({
    id: padId(11 + i),
    agencyId: AGENCY_ID,
    programId:
      site.program === "Supported living" ? SUPPORTED_ID : RESIDENTIAL_ID,
    name: site.name,
    address: site.address,
  }));
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
          : "dsp",
      roleKey: isSarah
        ? "administrator"
        : member.role === "House Manager"
          ? "house_manager"
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

  const jodie = individualByName["Jodie Williams"];
  const jodieV2 = versions.find((v) => {
    const doc = documents.find((d) => d.id === v.documentId);
    return doc?.title === "Jodie Williams · PCSP 2026" && v.versionLabel === "v2";
  })!;
  const packet: AcknowledgmentPacket = {
    id: padId(801),
    agencyId: AGENCY_ID,
    individualId: jodie.id,
    documentVersionId: jodieV2.id,
    whatAcknowledging: "PCSP 2026 · v2",
    startsOn: jodieV2.effectiveOn,
    endsOn: jodieV2.expiresOn,
    status: "open",
  };
  const jodieStaff = assignments.filter((a) => a.individualId === jodie.id);
  const rows: AcknowledgmentRow[] = jodieStaff.map((assignment, i) => {
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
  };
}

export const DEMO_AGENCY_CODE = "EVERGREEN-MO";
export const PLATFORM_AGENCY_CODE = "COMPLYRER-MO";
export const PLATFORM_USERNAME = "platform.owner";
export const DEMO_ADMIN_EMAIL = emailFor("Sarah Mitchell");
export const DEMO_DSP_EMAIL = emailFor("Alex Morgan");
export const DEMO_ADMIN_USERNAME = DEMO_ADMIN_EMAIL.split("@")[0];
export const DEMO_DSP_USERNAME = DEMO_DSP_EMAIL.split("@")[0];
