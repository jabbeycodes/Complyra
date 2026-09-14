import type { SessionUser } from "../data/types";

/**
 * HIPAA §164.312(d) — person or entity authentication.
 *
 * Multi-factor authentication is REQUIRED for platform operators,
 * administrators, and compliance administrators. Other roles may enroll
 * optionally. This module is the single source of truth for that policy;
 * both the enrollment prompt (MfaGate) and the settings UI read it.
 */

export type MfaRequirement = "required" | "optional";

/** Role keys for which MFA enrollment is mandatory. */
export const MFA_REQUIRED_ROLE_KEYS: ReadonlySet<string> = new Set([
  "administrator",
  "compliance_admin",
]);

export function getMfaRequirement(session: SessionUser | null): MfaRequirement {
  if (!session) return "optional";
  if (session.platformAdmin) return "required";
  if (MFA_REQUIRED_ROLE_KEYS.has(session.roleKey)) return "required";
  return "optional";
}

export function isMfaRequired(session: SessionUser | null): boolean {
  return getMfaRequirement(session) === "required";
}
