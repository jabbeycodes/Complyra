import { canAccessSite } from "./dashboard";
import { hasPermission } from "./permissions";
import { todayStamp } from "./status";
import type { IndividualRecord, SessionUser, StaffAssignment } from "./types";

/**
 * Care records require both a permission and a current assignment/scope.
 * DSPs see every Individual at any program site where they have been
 * assigned (a site assignment, or one Individual there), because staff cover
 * each other's Individuals during a shift, e.g. when the second staff member
 * leaves early. Access does not end when the DSP is reassigned, so they can
 * always go back and correct their own notes and MAR entries; it ends only
 * when their agency membership ends. Mirrors private.can_read_individual.
 */
export function canReadIndividual(
  session: SessionUser,
  person: Pick<IndividualRecord, "id" | "agencyId" | "siteId">,
  assignments: StaffAssignment[],
  individuals: Pick<IndividualRecord, "id" | "siteId">[] = [],
  today = todayStamp(),
): boolean {
  if (person.agencyId !== session.agencyId || !hasPermission(session, "individuals.view")) return false;
  if (session.roleKey !== "dsp") return canAccessSite(session, person.siteId);
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
