import type { Requirement } from "../domain";
import type { PacketDetail, SessionUser } from "./types";
import type { PlanStackView } from "./planStack";
import { staffCanSignDelegation } from "./planStack";
import { todayIso } from "./chart";
import {
  asMonthlyCollections,
  drillComplete,
  equipmentViewForPerson,
  monthDueOn,
  monthKeyFrom,
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
import { capabilityForRoleKey, hasPermission } from "./permissions";

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
 * Who sees submitted event reports on the agency dashboard. Reviewers
 * (`ger.review`) see rows they are expected to act on; auditors see the same
 * rows read-only under Joshua's 2026-09-19 "auditors see everything" ruling.
 * In practice that means administrators, compliance admins, program
 * managers, house managers, nurses, and auditors qualify, while HR and DSPs
 * do not. Reviewers without an agency-wide scope (house managers, nurses)
 * are further limited to their assigned homes by the data layer. DSPs have
 * no agency dashboard at all — that is enforced by the Overview pageVisible
 * gate. Auditors are read-only here: the detail link opens the same
 * read-only GER view the Reporting tab already gives them.
 */
export function canSeeGerDashboardRows(session: SessionUser): boolean {
  if (session.platformAdmin) return true;
  return (
    hasPermission(session, "ger.review") ||
    capabilityForRoleKey(session.roleKey) === "auditor"
  );
}

export function assignedSiteIds(session: SessionUser, staff: StaffSiteRef[]): string[] {
  const ids = new Set<string>();
  if (session.siteId) ids.add(session.siteId);
  const member = staff.find((row) => row.id === session.userId);
  if (member?.siteId) ids.add(member.siteId);
  return [...ids];
}

export function sitesVisibleTo<T extends { id: string }>(
  session: SessionUser,
  sites: T[],
  staff: StaffSiteRef[],
): T[] {
  if (isAgencyWideViewer(session)) return sites;
  const ids = new Set(assignedSiteIds(session, staff));
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
  limit?: number;
}): PersonalWorkItem[] {
  const limit = input.limit ?? 12;
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

  const today = todayIso();
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
    for (const person of input.individuals) {
      const view = equipmentViewForPerson(
        collections,
        person.id,
        key,
        today,
        due.equipmentDay,
      );
      if (!view.items.length || view.complete) continue;
      const dueOn = monthDueOn(key, due.equipmentDay);
      push({
        id: `eq-${person.id}-${key}`,
        kind: "monthly",
        title: "Check adaptive equipment",
        detail: `${person.name} · due ${dueOn}`,
        tone: today <= dueOn ? "due" : "overdue",
        personName: person.name,
      });
    }
    for (const site of input.sites) {
      const drills = collections.emergencyDrills.filter(
        (row) => row.siteId === site.id && row.monthKey === key,
      );
      if (drills.length && !drills.every(drillComplete)) {
        const dueOn = monthDueOn(key, due.drillDay);
        push({
          id: `drill-${site.id}-${key}`,
          kind: "monthly",
          title: "Record this month’s emergency drills",
          detail: `${site.name} · due ${dueOn}`,
          tone: today <= dueOn ? "due" : "overdue",
          siteName: site.name,
        });
      }
      const safety = collections.homeSafetyReports.find(
        (row) => row.siteId === site.id && row.monthKey === key,
      );
      if (safety && !safetyComplete(safety)) {
        const dueOn = monthDueOn(key, due.safetyDay);
        push({
          id: `safety-${site.id}-${key}`,
          kind: "monthly",
          title: "Complete the home safety report",
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
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, limit);
}
