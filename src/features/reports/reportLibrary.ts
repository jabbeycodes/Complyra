import type { RoleKey } from "../../data/permissions";

/**
 * Report Library registry (Therap gap: "Report library").
 *
 * One typed catalog over the reports that ALREADY exist across the app —
 * the library invents no new report content. Every entry names the real
 * builder or API runner that produces it (see reportRunners.ts, keyed by
 * the same ids; reportLibrary.test.ts proves the two never drift apart).
 *
 * Reports whose modules are still on open PR branches (event reports,
 * health trackers, care plans/screening, medication orders, consents,
 * life events) are NOT listed here — a catalog entry that cannot run is a
 * dead entry. They slot in through REPORT_LIBRARY_EXTENSION_POINTS below
 * when those PRs merge.
 */

export type ReportScopeKind =
  | "agency"
  | "site"
  | "individual"
  | "staff"
  | "dateRange"
  | "month"
  | "year"
  | "record";

/** Record pickers an entry can require once its site/Individual is chosen. */
export type ReportRecordKind =
  | "packet"
  | "weeklyChecklist"
  | "qaAudit"
  | "appointment"
  | "delegation"
  | "trainingChecklist";

export interface ReportDefinition {
  id: string;
  title: string;
  /** Plain-language, one line: what the report is and when you would run it. */
  description: string;
  /** Catalog group heading. */
  module: string;
  /** Scope controls the entry supports — the page renders exactly these. */
  scopes: ReportScopeKind[];
  /** Set when one of the scopes is "record": which picker to show. */
  recordKind?: ReportRecordKind;
  /** Roles that may run this report — mirrors the gate of its home surface. */
  roles: RoleKey[];
}

/**
 * Roles with any Report Library access at all. DSP and HR are excluded:
 * every report in the catalog is a management/audit record, and the few
 * staff-facing prints those roles use (their own training sheet, mileage
 * sheets) stay on their home surfaces. Auditors are read-only by role and
 * included — reports are records, and auditors see the agency's records.
 */
export const REPORT_LIBRARY_ROLES: RoleKey[] = [
  "administrator",
  "compliance_admin",
  "program_manager",
  "house_manager",
  "nurse",
  "auditor",
];

const ALL_LIBRARY_ROLES = REPORT_LIBRARY_ROLES;

export function canAccessReportLibrary(roleKey: string): boolean {
  return (REPORT_LIBRARY_ROLES as string[]).includes(roleKey);
}

export function canRunReport(def: ReportDefinition, roleKey: string): boolean {
  return canAccessReportLibrary(roleKey) && def.roles.includes(roleKey as RoleKey);
}

/** Catalog entries visible to a role, in catalog order. */
export function reportsForRole(roleKey: string): ReportDefinition[] {
  if (!canAccessReportLibrary(roleKey)) return [];
  return REPORT_LIBRARY.filter((def) => def.roles.includes(roleKey as RoleKey));
}

export const REPORT_LIBRARY: ReportDefinition[] = [
  // ----- Agency & compliance -----
  {
    id: "compliance-report",
    title: "Compliance report",
    description:
      "Agency-wide compliance scorecard: every requirement, its status, and what is overdue — the Audit center export, for one home or all homes.",
    module: "Agency & compliance",
    scopes: ["agency", "site"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "acknowledgment-sheet",
    title: "PCSP acknowledgment sheet",
    description:
      "The signed acknowledgment roster for one Individual's plan packet — who has signed, who has not, and when.",
    module: "Agency & compliance",
    scopes: ["record"],
    recordKind: "packet",
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager", "auditor"],
  },

  // ----- Home checks & safety -----
  {
    id: "hm-checklists",
    title: "House manager checklists",
    description:
      "Every weekly house-manager checklist on file for a home, one month or all months.",
    module: "Home checks & safety",
    scopes: ["site", "month"],
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "service-logs",
    title: "Service logs",
    description:
      "The service-log entries recorded on a home's weekly checklists, one month or all months.",
    module: "Home checks & safety",
    scopes: ["site", "month"],
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "weekly-checklist",
    title: "Weekly checklist (one week)",
    description: "A single week's house-manager checklist for a home, as submitted.",
    module: "Home checks & safety",
    scopes: ["site", "record"],
    recordKind: "weeklyChecklist",
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "weekly-service-log",
    title: "Weekly service log (one week)",
    description: "The service log attached to one week's house-manager checklist.",
    module: "Home checks & safety",
    scopes: ["site", "record"],
    recordKind: "weeklyChecklist",
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "drill-schedule",
    title: "Drill schedule",
    description: "The year's emergency-drill schedule for a home — planned drills by month and type.",
    module: "Home checks & safety",
    scopes: ["site", "year"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "monthly-drills",
    title: "Monthly drills check",
    description:
      "One month's completed emergency drills for a home. The month must be fully recorded before it downloads.",
    module: "Home checks & safety",
    scopes: ["site", "month"],
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "monthly-safety",
    title: "Monthly home safety check",
    description:
      "One month's home safety check for a home. The month must be fully recorded before it downloads.",
    module: "Home checks & safety",
    scopes: ["site", "month"],
    roles: ["administrator", "compliance_admin", "program_manager", "house_manager"],
  },
  {
    id: "site-review",
    title: "Site review report",
    description: "The recorded site review for a home — facts, findings, and the monthly safety summary.",
    module: "Home checks & safety",
    scopes: ["site"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "pre-survey",
    title: "Pre-survey worksheet",
    description: "Survey-readiness worksheet for a home: every Individual, their plan status, and equipment on file.",
    module: "Home checks & safety",
    scopes: ["site"],
    roles: ALL_LIBRARY_ROLES,
  },

  // ----- Individual records -----
  {
    id: "individual-profile",
    title: "Individual profile (face sheet)",
    description:
      "One Individual's face sheet: identity, diagnosis, medications, guardians, providers, and agency contacts.",
    module: "Individual records",
    scopes: ["site", "individual"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "shift-notes-report",
    title: "Shift notes report",
    description:
      "An Individual's shift notes for a date range, in the clinician report format with program and scoring detail.",
    module: "Individual records",
    scopes: ["site", "individual", "dateRange"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "equipment-check",
    title: "Monthly equipment check",
    description:
      "One month's adaptive-equipment checks for an Individual. Every item must be checked before it downloads.",
    module: "Individual records",
    scopes: ["site", "individual", "month"],
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "consultation-packet",
    title: "Consultation packet",
    description:
      "The fillable consultation packet for one of an Individual's appointments, with profile and medications filled in.",
    module: "Individual records",
    scopes: ["site", "individual", "record"],
    recordKind: "appointment",
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "delegation-form",
    title: "Nursing delegation form",
    description: "One RN nursing delegation form for an Individual, as recorded on the chart.",
    module: "Individual records",
    scopes: ["site", "individual", "record"],
    recordKind: "delegation",
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "training-checklist",
    title: "Individual training checklist",
    description: "A staff member's signed training checklist for one Individual.",
    module: "Individual records",
    scopes: ["site", "individual", "record"],
    recordKind: "trainingChecklist",
    roles: ALL_LIBRARY_ROLES,
  },
  {
    id: "care-plan",
    title: "Care plan document",
    description: "The current care plan document version on an Individual's chart.",
    module: "Individual records",
    scopes: ["site", "individual"],
    roles: ALL_LIBRARY_ROLES,
  },

  // ----- Quality assurance -----
  {
    id: "qa-audit-report",
    title: "QA audit report",
    description: "One quarterly QA audit for a home — every item, its score, and its evidence.",
    module: "Quality assurance",
    scopes: ["site", "record"],
    recordKind: "qaAudit",
    roles: ALL_LIBRARY_ROLES,
  },

  // ----- Mileage (mirrors the Mileage page's own download gates) -----
  {
    id: "mileage-month",
    title: "Monthly mileage sheet",
    description: "One month's mileage sheet for a home — trips and per-Individual totals.",
    module: "Mileage",
    scopes: ["site", "month"],
    roles: ["administrator", "house_manager"],
  },
  {
    id: "mileage-week",
    title: "Weekly mileage sheet",
    description: "A month's mileage for a home broken into its four weekly columns.",
    module: "Mileage",
    scopes: ["site", "month"],
    roles: ["administrator", "house_manager"],
  },
  {
    id: "mileage-year",
    title: "Yearly mileage summary",
    description: "A full year of mileage for a home — per-Individual monthly totals and the grand total.",
    module: "Mileage",
    scopes: ["site", "year"],
    roles: ["administrator", "program_manager"],
  },

  // ----- Staff -----
  {
    id: "staff-training-checklist",
    title: "Staff training checklist",
    description:
      "One staff member's agency training checklist — required topics, initials, signatures, and hours.",
    module: "Staff",
    scopes: ["staff"],
    roles: ["administrator", "house_manager"],
  },
];

/**
 * Extension points — reports that join this catalog when their module's
 * PR merges. They are deliberately NOT registry entries today: their
 * builders do not exist on main, and a catalog entry that cannot run is a
 * dead entry. When a module merges, add its entry above and its runner in
 * reportRunners.ts in the same change.
 */
export const REPORT_LIBRARY_EXTENSION_POINTS: {
  module: string;
  plannedReports: string[];
  blockedOn: string;
}[] = [
  {
    module: "Event reports (GER)",
    plannedReports: ["Event report summaries by home and date range"],
    blockedOn: "PR #117 (feature/therap-core-gaps-1)",
  },
  {
    module: "Health tracking",
    plannedReports: ["Health tracker summaries by Individual and date range"],
    blockedOn: "PRs #117/#118 (feature/therap-core-gaps-1/-2)",
  },
  {
    module: "Care plans & health screening",
    plannedReports: ["Screening due/overdue report"],
    blockedOn: "PR #119 (feature/care-plans-screening)",
  },
  {
    module: "Medication orders & reconciliation",
    plannedReports: ["Expiring medication orders report", "Reconciliation history"],
    blockedOn: "PR #120 (feature/medication-orders)",
  },
  {
    module: "Consents register",
    plannedReports: ["Consent register print summary"],
    blockedOn: "PR #122 (feature/consents-register)",
  },
  {
    module: "Life events",
    plannedReports: ["Life events timeline (already prints inside the chart profile packet)"],
    blockedOn: "PR #131 (feature/life-events)",
  },
];
