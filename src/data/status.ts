import type { Status } from "../domain";

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

export function roleLabel(role: string, jobTitle?: string) {
  if (role === "administrator") return "Agency administrator";
  if (role === "compliance_admin") return "Compliance administrator";
  if (role === "manager") return "House Manager";
  return jobTitle || "DSP";
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
