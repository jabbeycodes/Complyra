import { canAccessSite } from "./dashboard";
import { hasPermission } from "./permissions";
import { todayStamp } from "./status";
import type { IndividualRecord, SessionUser, StaffAssignment } from "./types";

/** Care records require both a permission and a current assignment/scope. */
export function canReadIndividual(
  session: SessionUser,
  person: Pick<IndividualRecord, "id" | "agencyId" | "siteId">,
  assignments: StaffAssignment[],
  today = todayStamp(),
): boolean {
  if (person.agencyId !== session.agencyId || !hasPermission(session, "individuals.view")) return false;
  if (session.roleKey !== "dsp") return canAccessSite(session, person.siteId);
  return assignments.some((a) => a.agencyId === session.agencyId &&
    a.userId === session.userId && a.individualId === person.id &&
    a.startsOn <= today && (!a.endsOn || a.endsOn >= today));
}

export function assertCalendarDate(value: string, message = "Use a valid date.") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(message);
  }
}
