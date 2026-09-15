import { normalizeAgencyCode } from "./agencyCode";

/** Production agencies: hard max Individuals living at one program site. */
export const PRODUCTION_SITE_INDIVIDUAL_CAP = 3;

/** Evergreen demo houses: hard max 2 per site so the 2×2 roster stays honest. */
export const DEMO_SITE_INDIVIDUAL_CAP = 2;

/** Seeded preview agency. Any other provider code uses the production cap. */
export const DEMO_SITE_CAPACITY_AGENCY_CODE = "EVERGREEN-MO";

export function isDemoAgencyCode(agencyCode: string) {
  return normalizeAgencyCode(agencyCode) === DEMO_SITE_CAPACITY_AGENCY_CODE;
}

export function siteIndividualCap(agencyCode: string) {
  return isDemoAgencyCode(agencyCode)
    ? DEMO_SITE_INDIVIDUAL_CAP
    : PRODUCTION_SITE_INDIVIDUAL_CAP;
}

export function countIndividualsAtSite<T extends { siteId?: string | null }>(
  people: T[],
  siteId: string,
) {
  return people.filter((person) => person.siteId === siteId).length;
}

export function siteAtCapacityMessage(currentCount: number, cap: number) {
  return `This site already has ${currentCount} Individuals (max ${cap}).`;
}

/**
 * Block Intake / add / reassign onto a site that is already at cap.
 * `currentCount` is everyone currently on that site, excluding the person
 * being moved when this is a reassign of someone already there.
 */
export function assertSiteHasCapacity(input: {
  siteName: string;
  agencyCode: string;
  currentCount: number;
  adding?: number;
}) {
  const cap = siteIndividualCap(input.agencyCode);
  const next = input.currentCount + (input.adding ?? 1);
  if (next <= cap) return;
  throw new Error(siteAtCapacityMessage(input.currentCount, cap));
}
