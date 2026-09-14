import { test } from "node:test";
import assert from "node:assert/strict";
import { getMfaRequirement, isMfaRequired } from "./mfaPolicy";
import {
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_WARNING_MS,
  inactivityPhase,
  logoffCountdownSeconds,
  timeUntilLogoffMs,
} from "./inactivity";
import { STEP_UP_WINDOW_MS, stepUpIsFresh } from "./stepUp";
import { canViewPhiAuditLog, pageVisible } from "../data/status";
import type { SessionUser } from "../data/types";

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: "u1",
    email: "a@example.com",
    username: "test.user",
    fullName: "Test User",
    jobTitle: "DSP",
    role: "dsp",
    roleKey: "dsp",
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

// ---- MFA policy ----

test("MFA is required for administrator and compliance_admin", () => {
  assert.equal(isMfaRequired(session({ roleKey: "administrator" })), true);
  assert.equal(isMfaRequired(session({ roleKey: "compliance_admin" })), true);
  assert.equal(getMfaRequirement(session({ roleKey: "administrator" })), "required");
});

test("MFA is required for the platform operator", () => {
  assert.equal(isMfaRequired(session({ platformAdmin: true, roleKey: "dsp" })), true);
});

test("MFA is optional for care roles and signed-out users", () => {
  for (const roleKey of ["dsp", "house_manager", "auditor", "registered_nurse"]) {
    assert.equal(isMfaRequired(session({ roleKey })), false);
    assert.equal(getMfaRequirement(session({ roleKey })), "optional");
  }
  assert.equal(getMfaRequirement(null), "optional");
});

// ---- Inactivity timeout ----

test("inactivity windows: 15 minutes idle, 60-second warning", () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(INACTIVITY_WARNING_MS, 60 * 1000);
});

test("inactivityPhase transitions at the right boundaries", () => {
  const now = 1_000_000_000;
  // 14:00 idle -> active (warning starts at 14:00... boundary inclusive)
  assert.equal(inactivityPhase(now - 13 * 60_000, now), "active");
  assert.equal(inactivityPhase(now - (15 * 60_000 - 60_000), now), "warning");
  assert.equal(inactivityPhase(now - (15 * 60_000 - 1_000), now), "warning");
  assert.equal(inactivityPhase(now - 15 * 60_000, now), "expired");
  assert.equal(inactivityPhase(now - 60 * 60_000, now), "expired");
});

test("logoff countdown reports whole seconds remaining", () => {
  const now = 1_000_000_000;
  const last = now - (15 * 60_000 - 45_500);
  assert.equal(logoffCountdownSeconds(last, now), 46);
  assert.ok(timeUntilLogoffMs(last, now) > 0);
  assert.equal(timeUntilLogoffMs(now - 20 * 60_000, now), 0);
});

// ---- Step-up grace window ----

test("stepUpIsFresh honors the five-minute grace window", () => {
  const now = 1_000_000_000;
  assert.equal(STEP_UP_WINDOW_MS, 5 * 60_000);
  assert.equal(stepUpIsFresh(null, now), false);
  assert.equal(stepUpIsFresh(now - 4 * 60_000, now), true);
  assert.equal(stepUpIsFresh(now - 6 * 60_000, now), false);
});

// ---- PHI audit log visibility ----

test("Access log is visible to administrator, compliance_admin, auditor", () => {
  for (const roleKey of ["administrator", "compliance_admin", "auditor"]) {
    assert.equal(canViewPhiAuditLog(session({ roleKey })), true);
    assert.equal(pageVisible(session({ roleKey }), "Access log"), true);
  }
});

test("Access log is hidden from the platform operator and care roles", () => {
  // The operator is not an agency: the RLS policy admits only agency
  // administrator, compliance_admin, and auditor, so the UI matches.
  assert.equal(canViewPhiAuditLog(session({ platformAdmin: true })), false);
  assert.equal(pageVisible(session({ platformAdmin: true }), "Access log"), false);
  for (const roleKey of ["dsp", "house_manager", "registered_nurse", "program_manager"]) {
    assert.equal(canViewPhiAuditLog(session({ roleKey })), false);
    assert.equal(pageVisible(session({ roleKey }), "Access log"), false);
  }
});
