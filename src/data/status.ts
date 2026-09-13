import type { Status } from "../domain";
import type { SessionUser } from "./types";
import {
  ROLE_TEMPLATE_BY_KEY,
  hasPermission,
  isRoleKey,
  type PermissionKey,
} from "./permissions";

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
  if (page === "Overview" || page === "Settings" || page === "Sites & programs") {
    return true;
  }
  if (
    page === "Individuals" ||
    page === "Requirements" ||
    page === "Individual chart"
  ) {
    return can(session, "individuals.view");
  }
  if (page === "Staff") {
    return (
      can(session, "hr.view_staff") ||
      can(session, "members.invite") ||
      can(session, "members.assign_roles")
    );
  }
  if (page === "Documents") return can(session, "documents.view");
  if (page === "Review queue") return can(session, "requirements.approve");
  if (page === "Audit center") return can(session, "audit.read");
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
  if (page === "Roles & access") return can(session, "members.assign_roles");
  // LIFEPATH-P2-PAGEVIS (training engine)
  if (page === "Training")
    return can(session, "hr.view_staff") || can(session, "acknowledgments.sign_own");
  // LIFEPATH-P3-PAGEVIS (delegation forms)
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
      session.roleKey === "degreed_professional_manager" ||
      isAgencyAdmin(session.role) ||
      Boolean(session.platformAdmin)
    );
  }
  // LIFEPATH-P6-PAGEVIS (med inventory)
  return can(session, "individuals.view");
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
