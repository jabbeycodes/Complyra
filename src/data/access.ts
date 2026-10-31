import { canAccessSite } from "./dashboard";
import { hasPermission } from "./permissions";
import { todayStamp } from "./status";
import type { IndividualRecord, SessionUser, StaffAssignment } from "./types";

/**
 * Care records require both a permission and a current assignment/scope.
 * DSPs see every Individual at any program site where they have been
 * assigned (a site assignment, or one Individual there) or whose site is
 * the home site named on their membership, because staff cover
 * each other's Individuals during a shift, e.g. when the second staff member
 * leaves early. Access does not end when the DSP is reassigned, so they can
 * always go back and correct their own notes and MAR entries; it ends only
 * when their agency membership ends. Nurses and house managers read their
 * membership home site plus any site a staff assignment places them at.
 * Mirrors private.can_read_individual.
 */
export function canReadIndividual(
  session: SessionUser,
  person: Pick<IndividualRecord, "id" | "agencyId" | "siteId">,
  assignments: StaffAssignment[],
  individuals: Pick<IndividualRecord, "id" | "siteId">[] = [],
  today = todayStamp(),
): boolean {
  if (person.agencyId !== session.agencyId || !hasPermission(session, "individuals.view")) return false;
  if (session.roleKey !== "dsp") {
    if (canAccessSite(session, person.siteId)) return true;
    // Assignment caseload (staff scope repair, corrected design
    // 2026-10-31): a nurse or house manager also reads the Individuals
    // at a site a staff assignment places them at — a site assignment
    // there, or an assignment to an Individual who lives there.
    // Coverage is never inferred from a NULL membership site: nurses
    // are agency-wide clinical reviewers through explicit role
    // widenings elsewhere, and canReadIndividual staying false for an
    // unassigned nurse is load-bearing (the hosted GER scope guard
    // relies on it). Mirrors the staff_assignments branch of
    // private.can_read_site.
    if (session.roleKey !== "nurse" && session.roleKey !== "house_manager") return false;
    const siteOfAssigned = (id: string | null) =>
      id ? individuals.find((row) => row.id === id)?.siteId ?? null : null;
    return assignments.some((a) => a.agencyId === session.agencyId &&
      a.userId === session.userId &&
      a.startsOn <= today &&
      (!a.endsOn || a.endsOn >= today) &&
      (a.siteId ?? siteOfAssigned(a.individualId)) === person.siteId);
  }
  // Membership home: a DSP whose membership names this site works there
  // even before any staff_assignments row exists (mirrors the membership
  // branch of private.dsp_works_at_site).
  if (session.siteId && session.siteId === person.siteId) return true;
  const siteOfIndividual = (id: string | null) =>
    id ? individuals.find((row) => row.id === id)?.siteId ?? null : null;
  return assignments.some((a) => a.agencyId === session.agencyId &&
    a.userId === session.userId &&
    a.startsOn <= today &&
    (a.individualId === person.id ||
      (a.siteId ?? siteOfIndividual(a.individualId)) === person.siteId));
}

export function assertCalendarDate(value: string, message = "Use a valid date.") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(message);
  }
}
