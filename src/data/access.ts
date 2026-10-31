import { canAccessSite } from "./dashboard";
import { hasPermission } from "./permissions";
import { todayStamp } from "./status";
import type { IndividualRecord, SessionUser, StaffAssignment } from "./types";

/**
 * Does an ACTIVE staff assignment place this user at `siteId` — a site
 * assignment there, or an assignment to an Individual who lives there?
 * Active = startsOn <= today and (endsOn null or >= today), mirroring
 * the staff_assignments branch of private.can_read_site.
 */
export function assignmentCoversSite(
  who: Pick<SessionUser, "userId" | "agencyId">,
  siteId: string,
  assignments: StaffAssignment[],
  individuals: Pick<IndividualRecord, "id" | "siteId">[] = [],
  today = todayStamp(),
): boolean {
  const siteOfAssigned = (id: string | null) =>
    id ? individuals.find((row) => row.id === id)?.siteId ?? null : null;
  return assignments.some((a) => a.agencyId === who.agencyId &&
    a.userId === who.userId &&
    a.startsOn <= today &&
    (!a.endsOn || a.endsOn >= today) &&
    (a.siteId ?? siteOfAssigned(a.individualId)) === siteId);
}

/**
 * Site scope for MANAGE actions (delegation creation is the first
 * caller): the viewer's membership home site, an agency-wide role, or —
 * for dsp/nurse/house_manager — a site an active staff assignment
 * places them at. Mirrors private.can_read_site. Deliberately NOT
 * canReadIndividual: manage actions gate on their own permission keys,
 * not individuals.view, and a NULL membership site never implies
 * coverage on its own.
 */
export function canActAtSite(
  session: SessionUser,
  siteId: string,
  assignments: StaffAssignment[],
  individuals: Pick<IndividualRecord, "id" | "siteId">[] = [],
  today = todayStamp(),
): boolean {
  if (canAccessSite(session, siteId)) return true;
  if (!["dsp", "nurse", "house_manager"].includes(session.roleKey)) return false;
  return assignmentCoversSite(session, siteId, assignments, individuals, today);
}

/**
 * The DSP scope rule over one Individual (the DSP branch of
 * canReadIndividual): the DSP's membership home site, or a started
 * assignment to the Individual or to their site. DSP access
 * deliberately ignores assignment endsOn (see canReadIndividual).
 * Used to validate delegation recipients: a recipient must be a DSP
 * this rule covers for the delegation's Individual.
 */
export function dspScopeCoversIndividual(
  member: Pick<SessionUser, "userId" | "agencyId" | "siteId">,
  person: Pick<IndividualRecord, "id" | "agencyId" | "siteId">,
  assignments: StaffAssignment[],
  individuals: Pick<IndividualRecord, "id" | "siteId">[] = [],
  today = todayStamp(),
): boolean {
  if (person.agencyId !== member.agencyId) return false;
  // Membership home: a DSP whose membership names this site works there
  // even before any staff_assignments row exists (mirrors the membership
  // branch of private.dsp_works_at_site).
  if (member.siteId && member.siteId === person.siteId) return true;
  const siteOfIndividual = (id: string | null) =>
    id ? individuals.find((row) => row.id === id)?.siteId ?? null : null;
  return assignments.some((a) => a.agencyId === member.agencyId &&
    a.userId === member.userId &&
    a.startsOn <= today &&
    (a.individualId === person.id ||
      (a.siteId ?? siteOfIndividual(a.individualId)) === person.siteId));
}

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
    return assignmentCoversSite(session, person.siteId, assignments, individuals, today);
  }
  return dspScopeCoversIndividual(session, person, assignments, individuals, today);
}

export function assertCalendarDate(value: string, message = "Use a valid date.") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(message);
  }
}
