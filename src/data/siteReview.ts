import type { IndividualRecord, SiteRecord, SiteServiceType } from "./types";
import type { IndividualProfile, ObligationItem } from "./planStack";
import type { AdaptiveEquipment } from "./monthlyChecks";
import { safetyComplete, type HomeSafetyReport } from "./monthlyChecks";

export type { SiteServiceType };

export const SERVICE_TYPE_LABELS: Record<SiteServiceType, string> = {
  ISL: "Individualized Supported Living",
  GH: "Group Home",
  SL: "Shared Living",
  DH: "Day Habilitation",
  CN: "Community Networking",
  ISD: "Individual Skill Development",
};

export type SiteReviewLineStatus = "unchecked" | "satisfactory" | "unsatisfactory" | "na";
export type SiteReviewSectionId = "interior" | "exterior" | "hcbs" | "part2";
export type SiteReviewEvidence = "monthly-safety" | "monthly-drills";

export type SiteFacts = {
  serviceType: SiteServiceType;
  staffed24h: boolean;
  overnightSleepStaff: boolean;
  wellWater: boolean;
  lastWaterTestOn: string;
  sitePhone: string;
  contactName: string;
  contactPhone: string;
  city: string;
  county: string;
  zip: string;
};

export const DEFAULT_SITE_FACTS: SiteFacts = {
  serviceType: "ISL",
  staffed24h: true,
  overnightSleepStaff: false,
  wellWater: false,
  lastWaterTestOn: "",
  sitePhone: "",
  contactName: "",
  contactPhone: "",
  city: "",
  county: "",
  zip: "",
};

export type SiteReviewLineDef = {
  id: string;
  section: SiteReviewSectionId;
  label: string;
  hint?: string;
  evidence?: SiteReviewEvidence;
};

export type SiteReviewLine = {
  id: string;
  status: SiteReviewLineStatus;
  comment: string;
};

export type SiteReview = {
  id: string;
  agencyId: string;
  siteId: string;
  reviewerName: string;
  supportCoordinator: string;
  reviewedOn: string;
  providerOwnedControlled: boolean | null;
  heightenedScrutiny: boolean | null;
  meetsIndividualNeeds: boolean | null;
  part2Verified: boolean;
  lines: SiteReviewLine[];
  updatedAt: string;
};

/** Working copy of the ISL environmental site review. Monthly smoke/CO/temp/extinguisher/first-aid stay on the monthly safety report. */
export const SITE_REVIEW_LINE_DEFS: SiteReviewLineDef[] = [
  {
    id: "int-clean",
    section: "interior",
    label: "Interior is clean and maintained",
    hint: "Flooring, stairs, pests, odors, doors, windows, and locks.",
  },
  {
    id: "int-adapt",
    section: "interior",
    label: "Home meets individual needs and adaptations",
    hint: "Ramps, accessible bath, wide halls, and lighted stairs as needed.",
  },
  {
    id: "int-water-temp",
    section: "interior",
    label: "Water temperature is 120°F or below unless written in the plan",
    evidence: "monthly-safety",
  },
  {
    id: "int-well-water",
    section: "interior",
    label: "If well water: initial and annual inspection on file",
  },
  {
    id: "int-exits",
    section: "interior",
    label: "Two means of exit on each floor",
    hint: "A window counts if it is a usable egress. Second-floor fire-escape plan if needed.",
  },
  {
    id: "int-exits-clear",
    section: "interior",
    label: "Exits are unblocked and people who live here can use them",
  },
  {
    id: "int-temp",
    section: "interior",
    label: "Home temperature is comfortable when HVAC is on",
  },
  {
    id: "int-smoke",
    section: "interior",
    label: "Working smoke detector in or near each bedroom and on each level",
    evidence: "monthly-safety",
  },
  {
    id: "int-co",
    section: "interior",
    label: "CO detectors if there is an attached garage or gas/propane",
    evidence: "monthly-safety",
  },
  {
    id: "int-bedrooms",
    section: "interior",
    label: "Bedrooms meet size, window, outlet, and heat/cool rules",
    hint: "One person per room; at least 70 sq ft; exterior window; no space heaters as primary heat.",
  },
  {
    id: "int-baths",
    section: "interior",
    label: "Bathrooms are clean, vented, and one is reachable without crossing a bedroom",
  },
  {
    id: "int-kitchen",
    section: "interior",
    label: "Kitchen appliances work; stovetop has a fan or window",
  },
  {
    id: "int-furnace",
    section: "interior",
    label: "Furnace and water heater are clear of flammables and not in general living space",
  },
  {
    id: "int-dryer",
    section: "interior",
    label: "Dryer is vented outdoors, under the house, or to the garage",
  },
  {
    id: "ext-grounds",
    section: "exterior",
    label: "Lawn, stairs, deck, driveway, sidewalk, roof, and siding are maintained",
  },
  {
    id: "ext-access",
    section: "exterior",
    label: "Home is physically accessible for the people who live here",
  },
  {
    id: "hcbs-lease",
    section: "hcbs",
    label: "Lease or residency agreement includes eviction and appeals rights",
  },
  {
    id: "hcbs-privacy",
    section: "hcbs",
    label: "Privacy in the sleeping and living unit",
  },
  {
    id: "hcbs-entrance-lock",
    section: "hcbs",
    label: "Entrance is lockable by the individual; only appropriate staff have keys",
  },
  {
    id: "hcbs-bedroom-lock",
    section: "hcbs",
    label: "Bedroom door is lockable",
  },
  {
    id: "hcbs-bath-lock",
    section: "hcbs",
    label: "Bathroom door locks",
  },
  {
    id: "hcbs-decorate",
    section: "hcbs",
    label: "Freedom to furnish and decorate within the lease",
  },
  {
    id: "hcbs-cameras",
    section: "hcbs",
    label: "No indoor cameras, or Division-approved policy and due process are on file",
  },
  {
    id: "hcbs-phone",
    section: "hcbs",
    label: "Phone, Wi-Fi, or Ethernet is available if the individual wants it",
  },
  {
    id: "hcbs-scrutiny",
    section: "hcbs",
    label: "Heightened scrutiny is not needed, or prior Division approval is on file",
  },
  {
    id: "p2-first-aid",
    section: "part2",
    label: "Basic first aid kit on site (CPR mask recommended)",
    evidence: "monthly-safety",
  },
  {
    id: "p2-extinguisher",
    section: "part2",
    label: "Fire extinguisher in or near the kitchen, charged, with expiration or PM tag",
    evidence: "monthly-safety",
  },
  {
    id: "p2-evac",
    section: "part2",
    label: "Emergency evacuation plan meets each individual’s needs",
    evidence: "monthly-drills",
  },
  {
    id: "p2-shutoffs",
    section: "part2",
    label: "Fuse box, gas shutoff, and water shutoff information is posted; staff and individuals are trained",
  },
];

export const SITE_REVIEW_SECTIONS: { id: SiteReviewSectionId; title: string; help: string }[] = [
  {
    id: "interior",
    title: "Part I · Home interior",
    help: "Support coordinator and provider walk the home before a new lease. PM keeps the working copy current.",
  },
  {
    id: "exterior",
    title: "Part I · Home exterior",
    help: "Grounds and HCBS physical access.",
  },
  {
    id: "hcbs",
    title: "Part I · HCBS settings",
    help: "Privacy, locks, lease rights, cameras, and community access.",
  },
  {
    id: "part2",
    title: "Part II · Before first day of services",
    help: "If these were missing at the first walk-through, support monitoring verifies them within 30 days.",
  },
];

export function canEditSiteReview(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "program_manager",
    "house_manager",
  ].includes(roleKey);
}

export function normalizeSiteFacts(value?: Partial<SiteFacts> | null): SiteFacts {
  return {
    serviceType: value?.serviceType && value.serviceType in SERVICE_TYPE_LABELS
      ? value.serviceType
      : DEFAULT_SITE_FACTS.serviceType,
    staffed24h: Boolean(value?.staffed24h),
    overnightSleepStaff: Boolean(value?.overnightSleepStaff),
    wellWater: Boolean(value?.wellWater),
    lastWaterTestOn: value?.lastWaterTestOn?.trim() ?? "",
    sitePhone: value?.sitePhone?.trim() ?? "",
    contactName: value?.contactName?.trim() ?? "",
    contactPhone: value?.contactPhone?.trim() ?? "",
    city: value?.city?.trim() ?? "",
    county: value?.county?.trim() ?? "",
    zip: value?.zip?.trim() ?? "",
  };
}

export function siteFactsFrom(site: SiteRecord): SiteFacts {
  return normalizeSiteFacts(site);
}

export function wellWaterTestCurrent(lastWaterTestOn: string, today: string) {
  if (!lastWaterTestOn) return false;
  const start = Date.parse(`${lastWaterTestOn.slice(0, 10)}T12:00:00Z`);
  const end = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return end - start <= 365 * 86_400_000 && end >= start;
}

function blankLines(): SiteReviewLine[] {
  return SITE_REVIEW_LINE_DEFS.map((def) => ({
    id: def.id,
    status: "unchecked",
    comment: "",
  }));
}

export function blankSiteReview(input: {
  agencyId: string;
  siteId: string;
  id?: string;
  updatedAt?: string;
}): SiteReview {
  return {
    id: input.id ?? crypto.randomUUID(),
    agencyId: input.agencyId,
    siteId: input.siteId,
    reviewerName: "",
    supportCoordinator: "",
    reviewedOn: "",
    providerOwnedControlled: null,
    heightenedScrutiny: null,
    meetsIndividualNeeds: null,
    part2Verified: false,
    lines: blankLines(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function mergeSiteReviewLines(lines?: SiteReviewLine[]): SiteReviewLine[] {
  const byId = new Map((lines ?? []).map((row) => [row.id, row]));
  return SITE_REVIEW_LINE_DEFS.map((def) => {
    const existing = byId.get(def.id);
    return {
      id: def.id,
      status: existing?.status ?? "unchecked",
      comment: existing?.comment ?? "",
    };
  });
}

export function normalizeSiteReview(review: SiteReview): SiteReview {
  return { ...review, lines: mergeSiteReviewLines(review.lines) };
}

export function ensureSiteReviews(
  db: { sites: SiteRecord[]; siteReviews: SiteReview[] },
) {
  db.siteReviews = db.siteReviews ?? [];
  for (const site of db.sites) {
    const existing = db.siteReviews.find((row) => row.siteId === site.id);
    if (!existing) {
      db.siteReviews.push(
        blankSiteReview({ agencyId: site.agencyId, siteId: site.id }),
      );
      continue;
    }
    existing.lines = mergeSiteReviewLines(existing.lines);
  }
}

export function lineFor(review: SiteReview, id: string) {
  return review.lines.find((row) => row.id === id);
}

function expectedWellWaterStatus(facts: SiteFacts): SiteReviewLineStatus | null {
  if (!facts.wellWater) return "na";
  return null;
}

export function siteReviewGaps(
  review: SiteReview | undefined,
  facts: SiteFacts,
  today: string,
): string[] {
  if (!review) return ["No site review on file"];
  const gaps: string[] = [];
  if (!review.reviewerName.trim() || !review.reviewedOn) {
    gaps.push("Reviewer name and date");
  }
  if (review.meetsIndividualNeeds !== true) {
    gaps.push("Home has not been marked as meeting individual needs");
  }
  if (!review.part2Verified) {
    gaps.push("Part II first-day items are not verified");
  }
  for (const def of SITE_REVIEW_LINE_DEFS) {
    const line = lineFor(review, def.id);
    const status = line?.status ?? "unchecked";
    if (def.id === "int-well-water") {
      if (!facts.wellWater) {
        if (status === "unchecked") gaps.push(def.label);
        continue;
      }
      if (status !== "satisfactory" || !wellWaterTestCurrent(facts.lastWaterTestOn, today)) {
        gaps.push("Annual well-water inspection");
      }
      continue;
    }
    if (status === "unchecked") gaps.push(def.label);
    else if (status === "unsatisfactory") gaps.push(`${def.label} (unsatisfactory)`);
  }
  return gaps;
}

export function isSiteReviewInPlace(
  review: SiteReview | undefined,
  facts: SiteFacts,
  today: string,
) {
  return siteReviewGaps(review, facts, today).length === 0;
}

export function siteReviewTone(
  review: SiteReview | undefined,
  facts: SiteFacts,
  today: string,
): "current" | "overdue" {
  return isSiteReviewInPlace(review, facts, today) ? "current" : "overdue";
}

export function applyWellWaterDefault(review: SiteReview, facts: SiteFacts): SiteReview {
  const expected = expectedWellWaterStatus(facts);
  if (!expected) return review;
  return {
    ...review,
    lines: review.lines.map((line) =>
      line.id === "int-well-water" && line.status === "unchecked"
        ? { ...line, status: expected }
        : line,
    ),
  };
}

export function monthlySafetyOnFile(report: HomeSafetyReport | undefined) {
  return Boolean(report && safetyComplete(report));
}

export function ageOn(dateOfBirth: string, today: string) {
  if (!dateOfBirth) return "";
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (!year || !month || !day || !ty) return "";
  let age = ty - year;
  if (tm < month || (tm === month && td < day)) age -= 1;
  return String(age);
}

export type PreSurveyRow = {
  name: string;
  age: string;
  sex: string;
  medicaid: string;
  diet: string;
  equipment: string;
  specializedMedical: string;
  behaviorSupports: string;
  dailyActivities: string;
  visitHours: string;
};

const MEDICAID_LABELS: Record<string, string> = {
  yes: "Yes",
  no: "No",
  ida: "IDA",
  cd_only: "CD only",
};

export function preSurveyMedicaidLabel(value: string) {
  return MEDICAID_LABELS[value] ?? value ?? "";
}

export function buildPreSurveyRow(input: {
  person: Pick<IndividualRecord, "fullName" | "dateOfBirth">;
  profile: IndividualProfile;
  today: string;
  equipment: AdaptiveEquipment[];
  obligations?: ObligationItem[];
}): PreSurveyRow {
  const diet =
    input.profile.specializedDiet.trim() ||
    input.obligations?.find(
      (item) =>
        item.enabled &&
        !item.proposed &&
        /allerg|diet/i.test(item.title),
    )?.detail ||
    "";
  return {
    name: input.profile.legalName || input.person.fullName,
    age: ageOn(input.person.dateOfBirth, input.today),
    sex: input.profile.sex || "",
    medicaid: preSurveyMedicaidLabel(input.profile.medicaidStatus),
    diet,
    equipment: input.equipment
      .filter((row) => row.active)
      .map((row) => row.name)
      .join(", "),
    specializedMedical: input.profile.specializedMedical,
    behaviorSupports: input.profile.behaviorSupports,
    dailyActivities: input.profile.dailyActivities,
    visitHours: input.profile.visitHours,
  };
}

export function yesNo(value: boolean | null | undefined) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

export function lineStatusLabel(status: SiteReviewLineStatus) {
  if (status === "satisfactory") return "Satisfactory";
  if (status === "unsatisfactory") return "Unsatisfactory";
  if (status === "na") return "N/A";
  return "Not marked";
}
