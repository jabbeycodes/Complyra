import type { Status } from "../domain";
import type { SessionUser } from "./types";
import {
  ROLE_TEMPLATE_BY_KEY,
  canCreateIndividual,
  canSeeShiftNotes,
  hasPermission,
  isRoleKey,
  type PermissionKey,
} from "./permissions";
import { canSeeAppointments } from "./appointments";
import { canSeeHealthTrack } from "./healthTrack";

const MS_PER_DAY = 86400000;

export function startOfDay(isoDate: string) {
  return Date.parse(`${isoDate.slice(0, 10)}T00:00:00`);
}

export function todayStamp(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function computeRequirementStatus(
  dueOn: string,
  category: string,
  now = new Date(),
): Status {
  const days = (startOfDay(dueOn) - startOfDay(todayStamp(now))) / MS_PER_DAY;
  if (days < 0) {
    return /delegat/i.test(category) ? "Expired" : "Overdue";
  }
  if (days <= 7) return "Due soon";
  return "Upcoming";
}

export function isPrivileged(role: string) {
  return (
    role === "administrator" ||
    role === "compliance_admin" ||
    role === "manager"
  );
}

export function isAgencyAdmin(role: string) {
  return role === "administrator" || role === "compliance_admin";
}

export function can(session: SessionUser, key: PermissionKey) {
  return hasPermission(session, key);
}

/** Nav and page gates. Care records stay hidden from HR even if they guess a URL. */
export function pageVisible(session: SessionUser, page: string) {
  // QA-AUDIT (2026-09-14): DSPs get no Overview dashboard.
  if (page === "Overview") return session.roleKey !== "dsp";
  if (page === "Settings" || page === "Sites & programs" || page === "Help") {
    return true;
  }
  // Site detail is a drill-down, not a nav destination: always "visible" as a
  // page; the component itself enforces per-site access (canAccessSite), so
  // HMs land on their own homes and no one else's.
  if (page === "Site detail") {
    return true;
  }
  if (page === "Intake") return canCreateIndividual(session.roleKey);
  if (page === "Individuals" || page === "Requirements" || page === "Individual chart") {
    return can(session, "individuals.view");
  }
  if (page === "Appointments") {
    return can(session, "individuals.view") && canSeeAppointments(session.roleKey);
  }
  if (page === "Staff") {
    return (
      can(session, "hr.view_staff") ||
      can(session, "members.invite") ||
      can(session, "members.assign_roles")
    );
  }
  if (page === "Documents") return can(session, "documents.view");
  // Issue #80: the site-detail "Shift notes" tab mirrors chart visibility.
  if (page === "ShiftNotes") return canSeeShiftNotes(session.roleKey);
  // HEALTH-TRACK (2026-09-18): agency health-logging page.
  if (page === "Health Track") return canSeeHealthTrack(session.roleKey);
  if (page === "Review queue") return can(session, "requirements.approve");
  if (page === "Audit center" || page === "Audit Me") return can(session, "audit.read");
  if (page === "Acknowledgments") {
    return (
      can(session, "acknowledgments.manage") ||
      can(session, "acknowledgments.sign_own") ||
      can(session, "audit.read")
    );
  }
  if (page === "Platform") return Boolean(session.platformAdmin);
  if (page === "Activity log") {
    return can(session, "audit.read") || can(session, "individuals.view");
  }
  // HR-ROLES (2026-09-13): editing role templates is roles.manage, separate
  // from assigning roles to people (members.assign_roles).
  if (page === "Roles & access") return can(session, "roles.manage");
  // LIFEPATH-P2-PAGEVIS (training engine)
  if (page === "Training")
    return can(session, "hr.view_staff") || can(session, "acknowledgments.sign_own");
  // LIFEPATH-P3-PAGEVIS (delegation forms)
  if (page === "Delegations") return can(session, "clinical.view");
  // LIFEPATH-P4-PAGEVIS (certificates)
  if (page === "Certificates") {
    return can(session, "certificates.manage") || can(session, "hr.view_staff");
  }
  // LIFEPATH-P5-PAGEVIS (HM weekly checklist)
  if (page === "Weekly checklist") {
    return (
      session.roleKey === "house_manager" ||
      isAgencyAdmin(session.role) ||
      Boolean(session.platformAdmin)
    );
  }
  if (page === "Checklist assignments") {
    return (
      session.roleKey === "program_manager" ||
      isAgencyAdmin(session.role) ||
      Boolean(session.platformAdmin)
    );
  }
  // LIFEPATH-P6-PAGEVIS (med supply forecast)
  if (page === "Supply forecast") return can(session, "individuals.view");
  // LIFEPATH-P8-PAGEVIS (recognition): every role sees the winners surface.
  if (page === "Recognition") return can(session, "recognition.view_winners");
  if (page === "Mileage") return can(session, "mileage.manage");
  // HR-EMPLOYEE-HUB-PAGEVIS (2026-09-16): the Employee Hub is reachable by
  // everyone with hub.access; each tab is permission-gated in-app.
  if (page === "Employee Hub") return can(session, "hub.access");
  // PCSP-DOCUMENTS-PAGEVIS (AI document ingestion). `documents.review` is
  // owned by the backend workstream — referenced by string until merged.
  if (page === "Document upload") return can(session, "documents.upload");
  if (page === "Extraction review")
    return can(session, "documents.review" as PermissionKey);
  if (page === "AI settings") return Boolean(session.platformAdmin);
  // QA-AUDIT (2026-09-14): QA Review is reachable by auditors, PMs, HMs, and
  // anyone with audit access; every scoring/finalize/dispute action is
  // permission-gated behind qa.audit / qa.dispute / qa.schedule.
  if (page === "QA Review")
    return (
      can(session, "qa.audit") ||
      can(session, "qa.dispute") ||
      can(session, "qa.schedule") ||
      can(session, "audit.read")
    );
  return ["PCSP acknowledgments", "Nursing delegations", "Equipment checks", "Behavior plan training", "Emergency drills", "Required forms"].includes(page) && can(session, "individuals.view");
}

/**
 * QA-AUDIT (2026-09-14): canonical nav page order. `defaultLandingPage` is the
 * first page in this order the session can see — used as the safe redirect
 * target when a requested page is invisible (e.g. a DSP, who gets no Overview
 * dashboard, always lands on the first page they can actually open).
 */
export const CANONICAL_PAGE_ORDER = [
  "Overview",
  "Platform",
  "Individuals",
  "Appointments",
  "Sites & programs",
  "Intake",
  "Staff",
  "Roles & access",
  "Requirements",
  "Documents",
  "Review queue",
  "Audit center",
  "Audit Me",
  "Acknowledgments",
  "Activity log",
  "AI settings",
  "Training",
  "Delegations",
  "Certificates",
  "Weekly checklist",
  "Checklist assignments",
  "Supply forecast",
  "Mileage",
  "QA Review",
  "Recognition",
  "Settings",
  "Employee Hub",
  // HEALTH-TRACK (2026-09-18)
  "Health Track",
] as const;

export function defaultLandingPage(session: SessionUser): string {
  for (const page of CANONICAL_PAGE_ORDER) {
    if (pageVisible(session, page)) return page;
  }
  return "Overview";
}

export function roleLabel(role: string, jobTitle?: string) {
  if (isRoleKey(role)) return ROLE_TEMPLATE_BY_KEY[role].name;
  if (role === "manager") return ROLE_TEMPLATE_BY_KEY.house_manager.name;
  if (role === "administrator") return ROLE_TEMPLATE_BY_KEY.administrator.name;
  if (role === "compliance_admin") return ROLE_TEMPLATE_BY_KEY.compliance_admin.name;
  return jobTitle || ROLE_TEMPLATE_BY_KEY.dsp.name;
}

export function reviewStatusLabel(
  status: "pending_review" | "active" | "archived",
) {
  if (status === "pending_review") return "Pending review";
  if (status === "active") return "Active";
  return "Archived";
}

export function requirementStatusFromDb(status: string): Status {
  const map: Record<string, Status> = {
    pending_review: "Pending review",
    compliant: "Compliant",
    due_soon: "Due soon",
    overdue: "Overdue",
    expired: "Expired",
    upcoming: "Upcoming",
  };
  return map[status] ?? (status as Status);
}

export function requirementStatusToDb(status: Status) {
  const map: Record<Status, string> = {
    "Pending review": "pending_review",
    Compliant: "compliant",
    "Due soon": "due_soon",
    Overdue: "overdue",
    Expired: "expired",
    Upcoming: "upcoming",
  };
  return map[status];
}
