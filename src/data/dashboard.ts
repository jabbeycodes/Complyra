import type { Requirement } from "../domain";
import type { PacketDetail, SessionUser } from "./types";
import type { PlanStackView } from "./planStack";
import { staffCanSignDelegation } from "./planStack";

export const AGENCY_WIDE_ROLE_KEYS = [
  "administrator",
  "compliance_admin",
  "degreed_professional_manager",
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

export type PersonalWorkItem = {
  id: string;
  kind: "requirement" | "acknowledgment" | "training" | "review";
  title: string;
  detail: string;
  tone: "overdue" | "due" | "review";
  requirementId?: string;
  personName?: string;
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
  limit?: number;
}): PersonalWorkItem[] {
  const limit = input.limit ?? 8;
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
