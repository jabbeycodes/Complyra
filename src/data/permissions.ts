/**
 * ============================================================================
 * SOURCE OF TRUTH — Complyrer permission model
 * ============================================================================
 *
 * This module is the single canonical definition of every permission,
 * role template, and grant rule in the app. All guards — client API layers
 * (src/data/hostedApi.ts, src/data/localApi.ts), UI components, edge
 * functions, and the `role_permission_matrix` SQL seed
 * (supabase/migrations/20260914040000_permission_source_of_truth.sql) —
 * mirror THIS module. Change it here first, then regenerate the seed.
 *
 * Rules encoded here (do not scatter conditionals elsewhere):
 *  - PERMISSION_KEYS: every permission string the app may reference.
 *  - ROLE_TEMPLATES / ROLE_TEMPLATE_BY_KEY: default permission maps per role.
 *  - GRANT_RULES: who may grant which role (data, not conditionals).
 *  - TEMPLATE_LOCKED_PERMISSIONS: template permissions the UI/API refuse to
 *    strip (e.g. administrator keeps members.assign_roles + roles.manage).
 *
 * The Postgres layer (supabase/migrations/20260913191500_phase0_security.sql)
 * enforces the same hierarchy server-side — private.can_grant_role_key(),
 * private.guard_last_administrator(), and the memberships/agency_roles
 * triggers. That SQL is the backstop; this module is the authoring source.
 */
import type { AppRole } from "./types";

export const PERMISSION_KEYS = [
  "members.invite",
  "members.assign_roles",
  "members.reset_password",
  "roles.manage",
  "hr.view_staff",
  "individuals.view",
  "documents.view",
  "documents.upload",
  // PCSP-EXTRACTION (documents.review goes here)
  "documents.review",
  "requirements.approve",
  "requirements.complete",
  "acknowledgments.manage",
  "acknowledgments.sign_own",
  "clinical.view",
  "audit.read",
  "audit.export",
  // QA-AUDIT (qa.* goes here)
  "qa.audit",
  "qa.dispute",
  "qa.schedule",
  "sites.create",
  // AUDIT-READINESS (corrective actions)
  "correctiveActions.manage",
  // LIFEPATH-P4-PERM (certificates.manage goes here)
  "certificates.manage",
  // LIFEPATH-P7-PERM (mileage.manage goes here)
  "mileage.manage",
  // RECOGNITION (winners-only recognition: ratings/reviews + weekly winners)
  "recognition.rate_hm",
  "recognition.review_dsp",
  "recognition.view_winners",
  "recognition.manage",
  // DELEGATION (delegation.* goes here)
  "delegation.templates.view",
  "delegation.templates.manage",
  "delegation.activate",
  "delegation.assign",
  "delegation.training.review",
  "delegation.training.approve",
  "delegation.acknowledge",
  // HR-EMPLOYEE-HUB (hub.* goes here)
  "hub.access",
  "hub.manage_schedule",
  "hub.review_timecards",
  "hub.approve_time_off",
  "hub.view_team",
  "hub.approve_payroll",
  "hub.manage_documents",
  "hub.manage_staffing",
  // HR-PHASE2 (pto accrual / overtime rules go here)
  "hub.manage_pay_settings",
  // KIOSK (remote punch is individually granted per staff, never role-default)
  "hub.remote_punch",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;
export type RoleScope = "agency" | "program" | "site" | "assigned";
export type RoleKey =
  | "administrator"
  | "compliance_admin"
  | "house_manager"
  | "program_manager"
  | "dsp"
  | "nurse"
  | "hr"
  | "auditor";

export interface RoleTemplate {
  key: RoleKey;
  name: string;
  shortCode: string;
  description: string;
  defaultScope: RoleScope;
  capability: AppRole;
  permissions: PermissionMap;
}

export interface AgencyRole extends RoleTemplate {
  agencyId: string;
}

function pack(enabled: PermissionKey[]): PermissionMap {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, enabled.includes(key)]),
  ) as PermissionMap;
}

const ALL = [...PERMISSION_KEYS];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "administrator",
    name: "Agency administrator",
    shortCode: "ADMIN",
    description: "Creates the agency workspace, assigns roles, and can do every operational action.",
    defaultScope: "agency",
    capability: "administrator",
    // LIFEPATH-P4 (certificates): certificates.manage is NOT in the
    // administrator default set — it is grantable explicitly via Roles & access.
    permissions: pack(ALL.filter((key) => key !== "certificates.manage")),
  },
  {
    key: "compliance_admin",
    name: "Compliance administrator",
    shortCode: "CA",
    description: "Owns the compliance loop: plans, approvals, acknowledgments, and audit exports.",
    defaultScope: "agency",
    capability: "compliance_admin",
    // QA-AUDIT (2026-09-14): qa.audit / qa.dispute / qa.schedule stay out of
    // the compliance_admin defaults — the auditor role owns scoring, PM/HM
    // own disputes and schedules. Grantable explicitly via Roles & access.
    // HR-EMPLOYEE-HUB: hub.access only — scheduling, timecard review,
    // time-off approval, team view, payroll lock, and HR documents stay with
    // the operational managers (administrator / program_manager / house_manager).
    permissions: pack(
      ALL.filter(
        (key) =>
          key !== "hr.view_staff" &&
          !key.startsWith("qa.") &&
          (key === "hub.access" || !key.startsWith("hub.")),
      ),
    ),
  },
  {
    key: "house_manager",
    name: "House manager",
    shortCode: "HM",
    description: "Runs one home, creates plans for PM approval, and signs acknowledgments for that site.",
    defaultScope: "site",
    capability: "manager",
    permissions: pack([
      "hr.view_staff",
      "individuals.view",
      "documents.view",
      "documents.upload",
      "requirements.complete",
      "acknowledgments.manage",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "mileage.manage",
      "recognition.review_dsp",
      "recognition.view_winners",
      // QA-AUDIT (2026-09-14): dispute findings with photo evidence.
      "qa.dispute",
      // DELEGATION: view templates + sign own site's acknowledgments.
      "delegation.templates.view",
      "delegation.acknowledge",
      // HR-EMPLOYEE-HUB: hub access plus the scheduling/timecard/time-off
      // duties a house manager owns for their home.
      "hub.access",
      "hub.manage_schedule",
      "hub.review_timecards",
      "hub.approve_time_off",
      "hub.view_team",
      // HR-STAFFING (2026-09-16): recurring staffing patterns for their home.
      "hub.manage_staffing",
    ]),
  },
  {
    key: "program_manager",
    name: "Program Manager",
    shortCode: "PM",
    description:
      "Program-level oversight across homes: creates and approves ISPs/PCSPs, uploads and signs plans, reviews delegation training, and resets staff passwords.",
    defaultScope: "program",
    capability: "manager",
    permissions: pack([
      "members.reset_password",
      "individuals.view",
      "documents.view",
      "documents.upload",
      // PCSP-EXTRACTION: review/approve AI-extracted items.
      "documents.review",
      "requirements.approve",
      "requirements.complete",
      "acknowledgments.manage",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "audit.export",
      "sites.create",
      "correctiveActions.manage",
      "mileage.manage",
      "recognition.view_winners",
      "recognition.manage",
      // QA-AUDIT (2026-09-14): schedule audits + dispute findings with evidence.
      "qa.dispute",
      "qa.schedule",
      // DELEGATION: full delegation workflow (activate/assign/review/approve).
      "delegation.templates.view",
      "delegation.activate",
      "delegation.assign",
      "delegation.training.review",
      "delegation.training.approve",
      "delegation.acknowledge",
      // HR-EMPLOYEE-HUB: full hub management (scheduling, timecards, time-off,
      // team view, payroll lock, HR documents).
      "hub.access",
      "hub.manage_schedule",
      "hub.review_timecards",
      "hub.approve_time_off",
      "hub.view_team",
      "hub.approve_payroll",
      "hub.manage_documents",
      // HR-STAFFING (2026-09-16): recurring staffing patterns agency-wide.
      "hub.manage_staffing",
      // HR-PHASE2 (2026-09-16): accrual policies + overtime rules.
      "hub.manage_pay_settings",
    ]),
  },
  {
    key: "dsp",
    name: "Direct support professional",
    shortCode: "DSP",
    description: "Sees assigned individuals, completes assigned work, and signs their own acknowledgments.",
    defaultScope: "assigned",
    capability: "dsp",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "requirements.complete",
      "acknowledgments.sign_own",
      "clinical.view",
      "mileage.manage",
      "recognition.rate_hm",
      "recognition.view_winners",
      // DELEGATION: view templates + sign own acknowledgments.
      "delegation.templates.view",
      "delegation.acknowledge",
      // HR-EMPLOYEE-HUB: every employee opens their own hub.
      "hub.access",
    ]),
  },
  {
    key: "nurse",
    name: "Nurse",
    shortCode: "RN",
    description: "Creates and approves clinical plans, uploads ISPs, and signs acknowledgments.",
    defaultScope: "site",
    capability: "nurse",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "documents.upload",
      // PCSP-EXTRACTION: review/approve AI-extracted items.
      "documents.review",
      "requirements.approve",
      "requirements.complete",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "mileage.manage",
      "recognition.view_winners",
      // DELEGATION: assign to individuals + review/approve training + sign own.
      "delegation.templates.view",
      "delegation.assign",
      "delegation.training.review",
      "delegation.training.approve",
      "delegation.acknowledge",
      // HR-EMPLOYEE-HUB: every employee opens their own hub.
      "hub.access",
    ]),
  },
  {
    key: "hr",
    name: "Human resources",
    shortCode: "HR",
    description: "Staff accounts and employment records only. Sees the agency score, not individual care files.",
    defaultScope: "agency",
    capability: "hr",
    // LIFEPATH-P4 (certificates): certificates.manage granted to HR by default.
    // HR-ROLES (2026-09-13): members.assign_roles lets HR assign staff roles.
    // roles.manage (edit the role templates themselves) stays administrator-only.
    permissions: pack([
      "members.invite",
      "members.assign_roles",
      "hr.view_staff",
      "certificates.manage",
      "mileage.manage",
      "recognition.view_winners",
      // DELEGATION: view templates only.
      "delegation.templates.view",
      // HR-EMPLOYEE-HUB: every employee opens their own hub.
      "hub.access",
      // HR-STAFFING (2026-09-16): recurring staffing patterns agency-wide.
      "hub.manage_staffing",
      // HR-PHASE2 (2026-09-16): accrual policies + overtime rules.
      "hub.manage_pay_settings",
    ]),
  },
  {
    key: "auditor",
    name: "Auditor",
    shortCode: "AUD",
    description: "Time-limited read and export access. Cannot change records or add staff.",
    defaultScope: "agency",
    capability: "auditor",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "clinical.view",
      "audit.read",
      "audit.export",
      // QA-AUDIT (2026-09-14): conduct QA audits — system-verified items stay
      // locked; the auditor scores the rest and resolves disputes.
      "qa.audit",
      "recognition.view_winners",
      // DELEGATION: view templates only.
      "delegation.templates.view",
      // HR-EMPLOYEE-HUB: every employee opens their own hub.
      "hub.access",
    ]),
  },
];

export const ROLE_TEMPLATE_BY_KEY = Object.fromEntries(
  ROLE_TEMPLATES.map((row) => [row.key, row]),
) as Record<RoleKey, RoleTemplate>;

/** All nine role keys, in template order. */
export const ROLE_KEYS = ROLE_TEMPLATES.map((row) => row.key);

/** Roles whose grant must stay with privileged granters — never HR / line staff. */
export const PRIVILEGED_ROLE_KEYS = [
  "administrator",
  "compliance_admin",
] as const satisfies readonly RoleKey[];

/**
 * GRANT_RULES — the role-grant hierarchy as DATA.
 *
 * `"any"` marks operational roles: any caller may be evaluated for them and
 * the permission gates (members.invite / members.assign_roles) live in the
 * API layer. Explicit granter lists restrict privileged targets:
 *  - only `administrator` may grant `administrator`;
 *  - `administrator` and `compliance_admin` may grant `compliance_admin`.
 *
 * This mirrors the Postgres backstop private.can_grant_role_key() in
 * 20260913191500_phase0_security.sql — keep both in sync.
 */
export const GRANT_RULES: Record<RoleKey, readonly RoleKey[] | "any"> = {
  administrator: ["administrator"],
  compliance_admin: ["administrator", "compliance_admin"],
  house_manager: "any",
  program_manager: "any",
  dsp: "any",
  nurse: "any",
  hr: "any",
  auditor: "any",
};

/** Role keys grantable through the operational (HR) path — everything not privileged. */
export const OPERATIONAL_ROLE_KEYS: readonly RoleKey[] = ROLE_KEYS.filter(
  (key) => GRANT_RULES[key] === "any",
);

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "members.invite": "Add members",
  // HR-ROLES (2026-09-13): assigning roles to people is separate from editing
  // the role templates themselves (roles.manage).
  "members.assign_roles": "Assign roles to staff",
  "members.reset_password": "Reset staff passwords",
  "roles.manage": "Edit role access levels",
  "hr.view_staff": "View staff records",
  "individuals.view": "View individual records",
  "documents.view": "View plans and documents",
  "documents.upload": "Create and upload plans",
  // PCSP-EXTRACTION (2026-09-14): review/approve AI-extracted document items.
  "documents.review": "Review and approve extracted document items",
  "requirements.approve": "Approve requirements",
  "requirements.complete": "Record completions",
  "acknowledgments.manage": "Manage acknowledgment sheets",
  "acknowledgments.sign_own": "Sign own acknowledgments",
  "clinical.view": "View clinical / delegation records",
  "audit.read": "Open Audit center",
  "audit.export": "Export audit packets",
  // QA-AUDIT (2026-09-14)
  "qa.audit": "Conduct QA audits (score items, finalize)",
  "qa.dispute": "Dispute QA findings with photo evidence",
  "qa.schedule": "Schedule QA audits for program sites",
  "sites.create": "Add program sites",
  // AUDIT-READINESS (corrective actions)
  "correctiveActions.manage": "Manage corrective actions",
  // LIFEPATH-P4 (certificates)
  "certificates.manage": "Manage staff certificates",
  // LIFEPATH-P7 (mileage)
  "mileage.manage": "Log vehicle mileage",
  // RECOGNITION
  "recognition.rate_hm": "Rate assigned house managers",
  "recognition.review_dsp": "Review assigned DSPs",
  "recognition.view_winners": "See weekly winners",
  "recognition.manage": "Manage recognition scoring",
  // DELEGATION
  "delegation.templates.view": "View delegation templates",
  "delegation.templates.manage": "Manage delegation templates",
  "delegation.activate": "Activate delegation templates for sites",
  "delegation.assign": "Assign delegation to individuals",
  "delegation.training.review": "Review delegation training drafts",
  "delegation.training.approve": "Approve delegation training materials",
  "delegation.acknowledge": "Sign delegation acknowledgments",
  // HR-EMPLOYEE-HUB
  "hub.access": "Open Employee Hub",
  "hub.manage_schedule": "Create and publish staff schedules",
  "hub.review_timecards": "Review and correct staff timecards",
  "hub.approve_time_off": "Approve or deny time-off requests",
  "hub.view_team": "View team schedules and attendance",
  "hub.approve_payroll": "Lock pay periods and prepare payroll",
  "hub.manage_documents": "Manage HR documents",
  "hub.manage_staffing": "Configure recurring staffing patterns",
  // HR-PHASE2
  "hub.manage_pay_settings": "Configure accrual policies and overtime rules",
  // KIOSK — granted per staff member by admins (see hr_staff_permission_grants),
  // never enabled by default in any role pack.
  "hub.remote_punch": "Clock in/out from a personal device",
};

/**
 * PERMISSION_REGISTRY — human-readable metadata for every permission, so UI
 * (RolesAccessPage) renders from the registry instead of hardcoded lists.
 * `defaultRoles` is derived from the role templates above.
 */
export interface PermissionRegistryEntry {
  key: PermissionKey;
  description: string;
  /** Role keys whose DEFAULT template enables this permission. */
  defaultRoles: RoleKey[];
}

export const PERMISSION_REGISTRY: Record<PermissionKey, PermissionRegistryEntry> =
  Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key,
      {
        key,
        description: PERMISSION_LABELS[key],
        defaultRoles: ROLE_TEMPLATES.filter((row) => row.permissions[key]).map(
          (row) => row.key,
        ),
      },
    ]),
  ) as Record<PermissionKey, PermissionRegistryEntry>;

/**
 * TEMPLATE_LOCKED_PERMISSIONS — template permissions the Roles UI locks and
 * the API refuses to strip, so an agency can never lock itself out of
 * administering roles. Data, not scattered conditionals.
 */
export const TEMPLATE_LOCKED_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  administrator: ["members.assign_roles", "roles.manage"],
  compliance_admin: [],
  house_manager: [],
  program_manager: [],
  dsp: [],
  nurse: [],
  hr: [],
  auditor: [],
};

export function isRoleKey(value: string): value is RoleKey {
  return value in ROLE_TEMPLATE_BY_KEY;
}

export function capabilityForRoleKey(roleKey: string): AppRole {
  return ROLE_TEMPLATE_BY_KEY[roleKey as RoleKey]?.capability ?? "dsp";
}

export function defaultPermissions(roleKey: string): PermissionMap {
  return { ...(ROLE_TEMPLATE_BY_KEY[roleKey as RoleKey]?.permissions ?? pack([])) };
}

export function hasPermission(
  session: { permissions?: Partial<PermissionMap>; role?: string },
  key: PermissionKey,
) {
  if (session.permissions && key in session.permissions) {
    return Boolean(session.permissions[key]);
  }
  if (session.role && isRoleKey(session.role)) {
    return ROLE_TEMPLATE_BY_KEY[session.role].permissions[key];
  }
  if (session.role === "manager") {
    return ROLE_TEMPLATE_BY_KEY.house_manager.permissions[key];
  }
  if (session.role === "administrator" || session.role === "compliance_admin") {
    return ROLE_TEMPLATE_BY_KEY[session.role].permissions[key];
  }
  return ROLE_TEMPLATE_BY_KEY.dsp.permissions[key];
}

/**
 * Who may grant which role — derived from GRANT_RULES.
 *
 * HR can grant operational roles (invite + assign), but the administrator and
 * compliance-administrator roles can only be granted by someone who already
 * holds equivalent-or-higher standing — otherwise HR could silently promote
 * anyone (including themselves) to full administrator.
 *
 * Operational targets return true for any caller (including undefined): the
 * members.invite / members.assign_roles permission gates are enforced in the
 * API layer, not here. Unknown targets are rejected.
 */
export function canGrantRole(
  callerRoleKey: string | undefined,
  targetRoleKey: string,
): boolean {
  if (!isRoleKey(targetRoleKey)) return false;
  const rule = GRANT_RULES[targetRoleKey];
  if (rule === "any") return true;
  return callerRoleKey !== undefined && rule.includes(callerRoleKey as RoleKey);
}

/** Roles the caller may offer in invite/assign dropdowns, derived from GRANT_RULES. */
export function grantableRoleTemplates(
  callerRoleKey: string | undefined,
): RoleTemplate[] {
  return ROLE_TEMPLATES.filter((row) => canGrantRole(callerRoleKey, row.key));
}

/**
 * May this role assign operational (non-privileged) roles to staff?
 * HR's members.assign_roles path: operational targets are always grantable;
 * administrator / compliance_admin are never in reach through this function.
 */
export function canAssignOperationalRole(
  granterRoleKey: string | undefined,
  targetRoleKey: string,
): boolean {
  return (
    isRoleKey(targetRoleKey) &&
    GRANT_RULES[targetRoleKey] === "any" &&
    canGrantRole(granterRoleKey, targetRoleKey)
  );
}

/**
 * May this role edit role templates (the roles.manage permission)?
 * Derived from the default templates: only administrator and
 * compliance_admin hold it. HR (members.assign_roles) may assign roles to
 * people but may NOT redefine templates.
 */
export function canEditRoleTemplates(roleKey: string | undefined): boolean {
  return (
    roleKey !== undefined &&
    isRoleKey(roleKey) &&
    ROLE_TEMPLATE_BY_KEY[roleKey].permissions["roles.manage"] === true
  );
}

/** Is this template permission locked against edits (UI checkbox + API guard)? */
export function isTemplatePermissionLocked(
  roleKey: string,
  key: PermissionKey,
): boolean {
  return (
    isRoleKey(roleKey) &&
    (TEMPLATE_LOCKED_PERMISSIONS[roleKey] as readonly string[]).includes(key)
  );
}

/**
 * Validates a role-template permission update against TEMPLATE_LOCKED_PERMISSIONS.
 * Returns the exact rejection message, or null when the update is allowed.
 * Callers throw the returned string unchanged.
 */
export function checkRoleTemplateUpdate(
  roleKey: string,
  permissions: PermissionMap,
): string | null {
  if (roleKey === "administrator") {
    if (!permissions["members.assign_roles"]) {
      return "The administrator role must keep role-assignment access.";
    }
    if (!permissions["roles.manage"]) {
      return "The administrator role must keep role-management access.";
    }
  }
  return null;
}

/**
 * Throws when any permission string is referenced anywhere but missing from
 * PERMISSION_KEYS — the no-drift guard used by tests.
 */
export function assertNoDrift(allKnownKeys: string[]): void {
  const known = new Set<string>(PERMISSION_KEYS);
  const missing = allKnownKeys.filter((key) => !known.has(key));
  if (missing.length > 0) {
    throw new Error(
      `Permission key drift: not declared in PERMISSION_KEYS: ${missing.join(", ")}`,
    );
  }
}


export const PLAN_SIGNER_ROLE_KEYS: RoleKey[] = [
  "house_manager",
  "program_manager",
];

export function canCreateSite(roleKey: string) {
  return Boolean(
    isRoleKey(roleKey) && ROLE_TEMPLATE_BY_KEY[roleKey].permissions["sites.create"],
  );
}

export function canCreateIndividual(roleKey: string) {
  return (
    canCreateSite(roleKey) ||
    roleKey === "program_manager" ||
    roleKey === "house_manager" ||
    roleKey === "nurse"
  );
}
