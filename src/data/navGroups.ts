export const NAV_STORAGE_KEY = "complyrer.navGroups.open";

export type NavGroupId = "programs" | "care" | "compliance" | "admin";

export type NavGroupDef = {
  id: NavGroupId;
  title: string;
  pages: readonly string[];
};

/**
 * Sidebar groups from #53. Appointments is listed so it appears when H1
 * ships; `pageVisible` still hides it until that page exists.
 */
export const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    id: "programs",
    title: "Programs",
    pages: ["Overview", "Sites & programs", "Individuals", "Intake", "Appointments"],
  },
  {
    id: "care",
    title: "Care",
    pages: [
      "Training",
      "Delegations",
      "Certificates",
      "Weekly checklist",
      "Checklist assignments",
      "Supply forecast",
      "Mileage",
    ],
  },
  {
    id: "compliance",
    title: "Compliance",
    pages: [
      "Requirements",
      "Documents",
      "Review queue",
      "Audit center",
      "Audit Me",
      "QA Review",
      "Acknowledgments",
      "Activity log",
    ],
  },
  {
    id: "admin",
    title: "Admin",
    pages: ["Staff", "Roles & access", "Platform", "AI settings"],
  },
] as const;

export function isNavAdminSession(session: {
  roleKey: string;
  platformAdmin?: boolean;
}) {
  return (
    session.roleKey === "administrator" ||
    session.roleKey === "compliance_admin" ||
    Boolean(session.platformAdmin)
  );
}

export function defaultNavGroupOpen(id: NavGroupId, adminSession: boolean) {
  if (id === "admin") return adminSession;
  return true;
}

export function emptyNavGroupOpen(adminSession: boolean): Record<NavGroupId, boolean> {
  return {
    programs: defaultNavGroupOpen("programs", adminSession),
    care: defaultNavGroupOpen("care", adminSession),
    compliance: defaultNavGroupOpen("compliance", adminSession),
    admin: defaultNavGroupOpen("admin", adminSession),
  };
}

export function readNavGroupOpen(adminSession: boolean): Record<NavGroupId, boolean> {
  const defaults = emptyNavGroupOpen(adminSession);
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<NavGroupId, boolean>>;
    return {
      programs: typeof parsed.programs === "boolean" ? parsed.programs : defaults.programs,
      care: typeof parsed.care === "boolean" ? parsed.care : defaults.care,
      compliance:
        typeof parsed.compliance === "boolean" ? parsed.compliance : defaults.compliance,
      admin: typeof parsed.admin === "boolean" ? parsed.admin : defaults.admin,
    };
  } catch {
    return defaults;
  }
}

export function writeNavGroupOpen(state: Record<NavGroupId, boolean>) {
  try {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / SSR */
  }
}

export function navGroupContainsPage(group: NavGroupDef, page: string) {
  return group.pages.includes(page);
}

export function navGroupIdForPage(page: string): NavGroupId | null {
  return NAV_GROUPS.find((group) => group.pages.includes(page))?.id ?? null;
}

/** Topbar section label. Site/chart drill-ins live under Programs, not a "Workspace" stack. */
export function navBreadcrumbGroup(page: string, isCategory = false) {
  if (isCategory) return "Compliance";
  if (page === "Site detail" || page === "Individual chart") return "Programs";
  return NAV_GROUPS.find((group) => group.pages.includes(page))?.title ?? "Programs";
}
