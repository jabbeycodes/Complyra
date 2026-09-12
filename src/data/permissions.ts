import type { AppRole } from "./types";

export const PERMISSION_KEYS = [
  "members.invite",
  "members.assign_roles",
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
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type PermissionMap = Record<PermissionKey, boolean>;
export type RoleScope = "agency" | "program" | "site" | "assigned";
export type RoleKey =
  | "administrator"
  | "compliance_admin"
  | "house_manager"
  | "degreed_professional_manager"
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

function pack(
  enabled: PermissionKey[],
): PermissionMap {
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
    permissions: pack(ALL),
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
    description: "Runs one home: assigned staff, plan review, and acknowledgments for that site.",
    defaultScope: "site",
    capability: "manager",
    permissions: pack([
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
    ]),
  },
  {
    key: "degreed_professional_manager",
    name: "Degreed professional manager",
    shortCode: "DPM",
    description: "Program-level QIDP/QIP oversight across homes, without HR or role-assignment rights.",
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
    ]),
  },
  {
    key: "nurse",
    name: "Nurse",
    shortCode: "RN",
    description: "Clinical and delegation records for assigned people. No HR files and no role assignment.",
    defaultScope: "site",
    capability: "nurse",
    permissions: pack([
      "individuals.view",
      "documents.view",
      "requirements.complete",
      "acknowledgments.sign_own",
      "clinical.view",
      "audit.read",
    ]),
  },
  {
    key: "hr",
    name: "Human resources",
    shortCode: "HR",
    description: "Staff accounts and employment records only. Does not receive individual care records.",
    defaultScope: "agency",
    capability: "hr",
    permissions: pack(["members.invite", "hr.view_staff"]),
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
      "acknowledgments.manage",
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

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "members.invite": "Add members",
  "members.assign_roles": "Assign and edit roles",
  "hr.view_staff": "View staff records",
  "individuals.view": "View individual records",
  "documents.view": "View plans and documents",
  "documents.upload": "Upload plans",
  "requirements.approve": "Approve requirements",
  "requirements.complete": "Record completions",
  "acknowledgments.manage": "Manage acknowledgment sheets",
  "acknowledgments.sign_own": "Sign own acknowledgments",
  "clinical.view": "View clinical / delegation records",
  "audit.read": "Open Audit center",
  "audit.export": "Export audit packets",
};
