import type { Requirement } from "../domain";
import type { PacketDetail, SessionUser } from "./types";
import type { PlanStackView } from "./planStack";
import { staffCanSignDelegation } from "./planStack";
import { centralTodayIso } from "./menuRecords";
import {
  asMonthlyCollections,
  drillComplete,
  equipmentViewForPerson,
  monthDueOn,
  monthKeyFrom,
  monthLabel,
  safetyComplete,
  DEFAULT_MONTHLY_DUE,
  type MonthlyDueSettings,
  type MonthlyWorkspace,
} from "./monthlyChecks";
import {
  canEditSiteReview,
  isSiteReviewInPlace,
  normalizeSiteFacts,
  type SiteFacts,
  type SiteReview,
} from "./siteReview";

export const AGENCY_WIDE_ROLE_KEYS = [
  "administrator",
  "compliance_admin",
  "program_manager",
  "auditor",
  "hr",
] as const;

export type VisibleSite = {
  id: string;
  name: string;
  address: string;
  program: string;
  manager: string;
  color: string;
};

export type StaffSiteRef = {
  id: string;
  siteId: string | null;
};

export function isAgencyWideViewer(session: SessionUser): boolean {
  if (session.platformAdmin) return true;
  return (AGENCY_WIDE_ROLE_KEYS as readonly string[]).includes(session.roleKey);
}

/**
 * THERAP-CORE-GAPS-1: who sees event-report (GER) rows on the agency
 * dashboard — agency leadership, house managers (their own homes, enforced
 * by the API's site scope), and auditors (Joshua, 2026-09-19: auditors see
 * everything, read-only). DSPs never get the agency dashboard; HR is out.
 */
export function canSeeGerDashboardRows(session: SessionUser | null): boolean {
  if (!session) return false;
  if (session.platformAdmin) return true;
  return [
    "administrator",
    "compliance_admin",
    "program_manager",
    "auditor",
    "house_manager",
    "nurse",
  ].includes(session.roleKey);
}

export function assignedSiteIds(
  session: SessionUser,
  staff: StaffSiteRef[],
  assignmentSiteIds: string[] = [],
): string[] {
  const ids = new Set<string>();
  if (session.siteId) ids.add(session.siteId);
  const member = staff.find((row) => row.id === session.userId);
  if (member?.siteId) ids.add(member.siteId);
  // Pass 3 (simulation Phase D): the viewer's own staff_assignments sites
  // (WorkspaceView.assignmentSiteIds) count toward site-list visibility,
  // mirroring the assignment branch of private.can_read_site — a nurse or
  // DSP whose homes come only from assignments still sees those houses in
  // site lists, not just their Individuals.
  for (const id of assignmentSiteIds) if (id) ids.add(id);
  return [...ids];
}

export function sitesVisibleTo<T extends { id: string }>(
  session: SessionUser,
  sites: T[],
  staff: StaffSiteRef[],
  assignmentSiteIds: string[] = [],
): T[] {
  if (isAgencyWideViewer(session)) return sites;
  const ids = new Set(assignedSiteIds(session, staff, assignmentSiteIds));
  return sites.filter((site) => ids.has(site.id));
}

/** Agency-wide roles may act at every site; everyone else is locked to home site. */
export function canAccessSite(
  session: Pick<SessionUser, "roleKey" | "siteId" | "platformAdmin">,
  siteId: string,
): boolean {
  if (isAgencyWideViewer(session as SessionUser)) return true;
  return Boolean(session.siteId && session.siteId === siteId);
}

/**
 * People at one program site. Prefer `siteId` when the workspace row has it
 * so two homes with similar names cannot leak into each other.
 */
export function individualsAtSite<T extends { site: string; siteId?: string | null }>(
  people: T[],
  site: { id: string; name: string } | null | undefined,
): T[] {
  if (!site) return [];
  return people.filter((person) =>
    person.siteId ? person.siteId === site.id : person.site === site.name,
  );
}

/** Site-scoped staff (HM, nurse, DSP) are forced to their assigned home. */
export function lockedSiteIdFor(
  session: Pick<SessionUser, "roleKey" | "siteId" | "platformAdmin">,
): string | null {
  if (isAgencyWideViewer(session as SessionUser)) return null;
  return session.siteId ?? null;
}

export type PersonalWorkItem = {
  id: string;
  kind: "requirement" | "acknowledgment" | "training" | "review" | "monthly" | "site_review";
  title: string;
  detail: string;
  tone: "overdue" | "due" | "review";
  requirementId?: string;
  personName?: string;
  siteName?: string;
};

function obligationLabel(kind: string, title: string) {
  if (kind === "pcsp") return `Sign ${title}`;
  if (kind === "protocol") return `Sign ${title}`;
  if (kind === "delegation") return `Sign ${title}`;
  return title;
}

/**
 * The canonical "my open tasks" selector. Every surface that counts or
 * lists the signed-in person's open work — the desktop Overview "Your
 * work" panel, the mobile Tasks badge, the platform bottom-nav badge,
 * and the mobile My Tasks list — renders THIS array (App computes it
 * once and passes it down), so the counts cannot disagree. A surface
 * that intentionally shows a subset (the mobile home's per-home slice,
 * the Up next cap) must label the subset in words; it never presents a
 * smaller number as the total.
 *
 * Two counting rules are load-bearing:
 *  - "Today" is the agency's Central date (menuRecords.centralTodayIso),
 *    never the UTC date: at 7 p.m. Central the UTC clock has already
 *    rolled into the next month, and the October monthly checks vanished
 *    from the queue mid-evening (simulation batch 61: badge 5 → 3 with
 *    nothing completed).
 *  - A monthly check is an open obligation until it is completed, so the
 *    scan covers every cycle month the workspace holds up to the current
 *    month — a month rollover can only ADD the new month's items, never
 *    silently drop last month's overdue ones.
 * The list is never silently capped: `limit` exists only for callers
 * that explicitly ask for a cap and label it themselves.
 */
export function personalQueue(input: {
  session: SessionUser;
  items: Requirement[];
  packets: PacketDetail[];
  planStacks: PlanStackView[];
  canApprove: boolean;
  monthly?: MonthlyWorkspace;
  individuals?: { id: string; name: string; site: string }[];
  sites?: Array<{ id: string; name: string } & Partial<SiteFacts>>;
  monthlyDue?: MonthlyDueSettings;
  siteReviews?: SiteReview[];
  /** Agency-local (Central) date to judge due/overdue against. */
  today?: string;
  limit?: number;
}): PersonalWorkItem[] {
  const out: PersonalWorkItem[] = [];
  const seen = new Set<string>();

  const push = (item: PersonalWorkItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  };

  for (const item of input.items) {
    if (item.owner !== input.session.fullName) continue;
    if (item.status !== "Overdue" && item.status !== "Expired" && item.status !== "Due soon") {
      continue;
    }
    push({
      id: `req-${item.id}`,
      kind: "requirement",
      title: item.title,
      detail: `${item.person} · ${item.site}`,
      tone: item.status === "Due soon" ? "due" : "overdue",
      requirementId: item.id,
      personName: item.person === "Site-wide" ? undefined : item.person,
    });
  }

  const today = input.today ?? centralTodayIso();
  const key = monthKeyFrom(today);
  const due = input.monthlyDue ?? DEFAULT_MONTHLY_DUE;

  if (canEditSiteReview(input.session.roleKey) && input.sites) {
    for (const site of input.sites) {
      const review = input.siteReviews?.find((row) => row.siteId === site.id);
      const facts = normalizeSiteFacts(site);
      if (isSiteReviewInPlace(review, facts, today)) continue;
      push({
        id: `site-review-${site.id}`,
        kind: "site_review",
        title: "Confirm site-review checks are in place",
        detail: `${site.name} · PM environmental pack`,
        tone: "overdue",
        siteName: site.name,
      });
    }
  }

  if (input.monthly && input.individuals && input.sites) {
    const collections = asMonthlyCollections(input.monthly);
    // Every cycle month the workspace holds, oldest first, never past the
    // current month: an incomplete cycle stays an open task in its own
    // month until it is completed, and a future month's cycle is not a
    // task yet.
    const monthsThrough = (monthKeys: Iterable<string>): string[] =>
      [...new Set([...monthKeys].filter((monthKey) => monthKey <= key))].sort();
    for (const person of input.individuals) {
      const equipmentIds = new Set(
        collections.adaptiveEquipment
          .filter((row) => row.individualId === person.id && row.active)
          .map((row) => row.id),
      );
      const equipmentMonths = monthsThrough(
        collections.equipmentMonthLogs
          .filter((log) => equipmentIds.has(log.equipmentId))
          .map((log) => log.monthKey),
      );
      for (const monthKey of equipmentMonths) {
        const view = equipmentViewForPerson(
          collections,
          person.id,
          monthKey,
          today,
          due.equipmentDay,
        );
        if (!view.items.length || view.complete) continue;
        const dueOn = monthDueOn(monthKey, due.equipmentDay);
        push({
          id: `eq-${person.id}-${monthKey}`,
          kind: "monthly",
          title: "Check adaptive equipment",
          detail: `${person.name} · due ${dueOn}`,
          tone: today <= dueOn ? "due" : "overdue",
          personName: person.name,
        });
      }
    }
    for (const site of input.sites) {
      const drillMonths = monthsThrough(
        collections.emergencyDrills
          .filter((row) => row.siteId === site.id)
          .map((row) => row.monthKey),
      );
      for (const monthKey of drillMonths) {
        const drills = collections.emergencyDrills.filter(
          (row) => row.siteId === site.id && row.monthKey === monthKey,
        );
        if (!drills.length || drills.every(drillComplete)) continue;
        const dueOn = monthDueOn(monthKey, due.drillDay);
        push({
          id: `drill-${site.id}-${monthKey}`,
          kind: "monthly",
          title:
            monthKey === key
              ? "Record this month’s emergency drills"
              : `Record ${monthLabel(monthKey)}’s emergency drills`,
          detail: `${site.name} · due ${dueOn}`,
          tone: today <= dueOn ? "due" : "overdue",
          siteName: site.name,
        });
      }
      const safetyReports = collections.homeSafetyReports
        .filter((row) => row.siteId === site.id && row.monthKey <= key)
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      for (const safety of safetyReports) {
        if (safetyComplete(safety)) continue;
        const dueOn = monthDueOn(safety.monthKey, due.safetyDay);
        push({
          id: `safety-${site.id}-${safety.monthKey}`,
          kind: "monthly",
          title:
            safety.monthKey === key
              ? "Complete the home safety report"
              : `Complete ${monthLabel(safety.monthKey)}’s home safety report`,
          detail: `${site.name} · due ${dueOn}`,
          tone: today <= dueOn ? "due" : "overdue",
          siteName: site.name,
        });
      }
    }
  }

  for (const stack of input.planStacks) {
    for (const view of stack.required) {
      if (!view.item.enabled || view.item.proposed) continue;
      if (!view.mySignature || view.mySignature.signedAt) continue;
      if (!staffCanSignDelegation(view.item)) continue;
      push({
        id: `ack-${view.item.id}`,
        kind: "acknowledgment",
        title: obligationLabel(view.item.kind, view.item.title),
        detail: stack.individualName,
        tone: "overdue",
        personName: stack.individualName,
      });
    }

    const training = stack.myTraining;
    if (training && training.status !== "complete") {
      push({
        id: `train-${training.checklist.id}`,
        kind: "training",
        title:
          training.status === "staff_signed"
            ? "Waiting on house manager countersign"
            : "Finish in-home training",
        detail: stack.individualName,
        tone: "due",
        personName: stack.individualName,
      });
    }
  }

  for (const packet of input.packets) {
    const row = packet.rows.find(
      (entry) => entry.userId === input.session.userId && !entry.signedAt,
    );
    if (!row) continue;
    push({
      id: `packet-${packet.packet.id}`,
      kind: "acknowledgment",
      title: `Sign ${packet.packet.whatAcknowledging || packet.document.title}`,
      detail: `${packet.individual.fullName} · ${packet.site.name}`,
      tone: "overdue",
      personName: packet.individual.fullName,
    });
  }

  if (input.canApprove) {
    for (const item of input.items.filter((row) => row.status === "Pending review")) {
      push({
        id: `rev-${item.id}`,
        kind: "review",
        title: item.title,
        detail: `${item.person} · ${item.site}`,
        tone: "review",
        requirementId: item.id,
        personName: item.person === "Site-wide" ? undefined : item.person,
      });
    }
  }

  const rank = { overdue: 0, due: 1, review: 2 };
  const sorted = out.sort((a, b) => rank[a.tone] - rank[b.tone]);
  // No silent cap: the surfaces that render this list present its length
  // as the person's total open-task count, so truncating here would make
  // the badge, the home count, and the task list all lie together.
  return input.limit === undefined
    ? sorted
    : sorted.slice(0, Math.max(0, input.limit));
}
