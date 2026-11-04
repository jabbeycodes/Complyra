import { isAgencyWideViewer } from "./dashboard";
import type { SessionUser } from "./types";

/**
 * TRAINING-ROSTER (simulation batches 195/196/197): the one rule for WHO is on
 * the Training roster, shared by HostedApi and LocalApi so they cannot drift.
 *
 * The roster comes from staff memberships, never from training_requirements:
 * a requirements-derived roster is empty for an agency with no lines assigned
 * yet, which is exactly when the page matters most.
 *
 * - agency-wide viewers (administrator, program manager, HR, ...) get everyone;
 * - site-scoped viewers (house manager) get the staff of their houses plus
 *   themselves; "their houses" is membership home + active assignments, the
 *   same set as sitesVisibleTo;
 * - a staffer belongs to a house through their membership home or an active
 *   staff assignment there.
 */
export interface RosterMembershipRef {
  userId: string;
  siteId: string | null;
}

export interface RosterAssignmentRef {
  userId: string;
  siteId: string | null;
  individualId: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface TrainingRosterEntry {
  userId: string;
  /** Membership home first, then active-assignment sites. */
  siteIds: string[];
}

export function trainingRosterEntries(input: {
  session: Pick<SessionUser, "userId" | "roleKey" | "siteId" | "platformAdmin">;
  memberships: RosterMembershipRef[];
  assignments: RosterAssignmentRef[];
  individualSiteById: ReadonlyMap<string, string | null>;
  today: string;
  siteId?: string;
}): TrainingRosterEntry[] {
  const { session, memberships, assignments, individualSiteById, today, siteId } = input;

  const assignedSites = new Map<string, string[]>();
  for (const row of assignments) {
    if (row.startsOn > today || (row.endsOn && row.endsOn < today)) continue;
    const site =
      row.siteId ?? (row.individualId ? (individualSiteById.get(row.individualId) ?? null) : null);
    if (!site) continue;
    assignedSites.set(row.userId, [...(assignedSites.get(row.userId) ?? []), site]);
  }

  const entries = new Map<string, Set<string>>();
  for (const row of memberships) {
    const sites = entries.get(row.userId) ?? new Set<string>();
    if (row.siteId) sites.add(row.siteId);
    entries.set(row.userId, sites);
  }
  for (const [userId, sites] of entries) {
    for (const site of assignedSites.get(userId) ?? []) sites.add(site);
  }

  const agencyWide = isAgencyWideViewer(session as SessionUser);
  const viewerSites = new Set<string>(entries.get(session.userId) ?? []);
  if (session.siteId) viewerSites.add(session.siteId);

  const inScope = (userId: string, sites: Set<string>) => {
    if (siteId) return sites.has(siteId) && (agencyWide || viewerSites.has(siteId));
    if (agencyWide || userId === session.userId) return true;
    return [...sites].some((site) => viewerSites.has(site));
  };

  return [...entries]
    .filter(([userId, sites]) => inScope(userId, sites))
    .map(([userId, sites]) => ({ userId, siteIds: [...sites] }));
}
