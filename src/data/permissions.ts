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
  "requirements.approve",
  "requirements.complete",
  "acknowledgments.manage",
  "acknowledgments.sign_own",
  "clinical.view",
  "audit.read",
  "audit.export",
  "sites.create",
  // LIFEPATH-P4-PERM (certificates.manage goes here)
  "certificates.manage",
  // LIFEPATH-P7-PERM (mileage.manage goes here)
  "mileage.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;
export type RoleScope = "agency" | "program" | "site" | "assigned";
export type RoleKey =
  | "administrator"
  | "compliance_admin"
  | "house_manager"
  | "degreed_professional_manager"
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
    permissions: pack(ALL.filter((key) => key !== "hr.view_staff")),
  },
  {
    key: "house_manager",
    name: "House manager",
    shortCode: "HM",
    description: "Runs one home, creates plans for DPM approval, and signs acknowledgments for that site.",
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
    ]),
  },
  {
    key: "degreed_professional_manager",
    name: "Degreed professional manager",
    shortCode: "DPM",
    description: "Program-level QIDP/QIP oversight: upload, approve, sign, and reset staff passwords.",
    defaultScope: "program",
    capability: "manager",
    permissions: pack([
      "members.reset_password",
      "individuals.view",
      "documents.view",
      "documents.upload",
      "requirements.approve",
      "requirements.complete",
      "acknowledgments.manage",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "audit.export",
      "sites.create",
      "mileage.manage",
    ]),
  },
  {
    key: "program_manager",
    name: "Program manager",
    shortCode: "PM",
    description: "Creates and approves ISPs/PCSPs across homes, and signs the plans they oversee.",
    defaultScope: "program",
    capability: "manager",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "documents.upload",
      "requirements.approve",
      "requirements.complete",
      "acknowledgments.manage",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "audit.export",
      "mileage.manage",
    ]),
  },
  {
    key: "dsp",
    name: "Direct support professional",
    shortCode: "DSP",
    description: "Sees assigned people, completes assigned work, and signs their own acknowledgments.",
    defaultScope: "assigned",
    capability: "dsp",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "requirements.complete",
      "acknowledgments.sign_own",
      "clinical.view",
      "mileage.manage",
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
      "requirements.approve",
      "requirements.complete",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
      "mileage.manage",
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
    ]),
  },
];

export const ROLE_TEMPLATE_BY_KEY = Object.fromEntries(
  ROLE_TEMPLATES.map((row) => [row.key, row]),
) as Record<RoleKey, RoleTemplate>;

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
 * HR-ROLES (2026-09-13): who may grant which role to a staff member.
 * HR can assign operational roles, but the administrator and
 * compliance-administrator roles can only be granted by someone who already
 * holds equivalent-or-higher standing — otherwise HR could silently promote
 * anyone (including themselves) to full administrator.
 */
export function canGrantRole(
  callerRoleKey: string | undefined,
  targetRoleKey: string,
): boolean {
  if (!isRoleKey(targetRoleKey)) return false;
  if (targetRoleKey === "administrator") return callerRoleKey === "administrator";
  if (targetRoleKey === "compliance_admin")
    return callerRoleKey === "administrator" || callerRoleKey === "compliance_admin";
  return true;
}

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
  "requirements.approve": "Approve requirements",
  "requirements.complete": "Record completions",
  "acknowledgments.manage": "Manage acknowledgment sheets",
  "acknowledgments.sign_own": "Sign own acknowledgments",
  "clinical.view": "View clinical / delegation records",
  "audit.read": "Open Audit center",
  "audit.export": "Export audit packets",
  "sites.create": "Add program sites",
  // LIFEPATH-P4 (certificates)
  "certificates.manage": "Manage staff certificates",
  // LIFEPATH-P7 (mileage)
  "mileage.manage": "Log vehicle mileage",
};

export const PLAN_SIGNER_ROLE_KEYS: RoleKey[] = [
  "house_manager",
  "degreed_professional_manager",
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
