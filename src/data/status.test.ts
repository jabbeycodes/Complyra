/**
 * AUDITOR-NAV (wave 7U, sim batches 159/172): pageVisible pins for the
 * auditor's read-only nav parity.
 *
 * The founder's rule: auditors see everything read-only (exceptions:
 * Internal Messaging and Time-Off). Five pages were gated on write-ish keys
 * the auditor template deliberately never holds (Delegations → clinical.view,
 * Staff → hr.view_staff/members.*, Review queue → requirements.approve,
 * Training → hr.view_staff/acknowledgments.sign_own, Certificates →
 * certificates.manage/hr.view_staff), so the whole pages were unreachable.
 * The fix adds ONE read path — roleKey "auditor" + the audit.read key
 * (canReadAsAuditor) — and changes no other role's outcome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageVisible } from "./status";
import { canReadAsAuditor, defaultPermissions, type PermissionMap } from "./permissions";
import type { SessionUser } from "./types";

const FIVE_PAGES = ["Delegations", "Training", "Staff", "Certificates", "Review queue"];

function sessionFor(roleKey: string, role: string, permissions: PermissionMap = defaultPermissions(roleKey)): SessionUser {
  return {
    userId: `u-${roleKey}`,
    email: `${roleKey}@example.invalid`,
    username: roleKey,
    fullName: roleKey,
    jobTitle: roleKey,
    role: role as SessionUser["role"],
    roleKey,
    agencyId: "agency-1",
    agencyName: "Evergreen Care",
    agencyCode: "EVERGREEN-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions,
    platformAdmin: false,
    agencyStatus: "active",
  };
}

/**
 * The auditor permission set as actually stored in the hosted Northstar
 * agency (verified against production data, 2026-11-02). Its TRUE keys are:
 * audit.export, audit.read, delegation.templates.view, documents.view,
 * hub.access, individuals.view, isp.view, qa.audit, recognition.view_winners
 * — crucially NO clinical.view (the stored map carries isp.view instead,
 * a key the TS PermissionMap does not even define), no hr.view_staff, no
 * requirements.approve, no certificates.manage, no acknowledgments.sign_own.
 * Real sessions carry a complete map, so the fixture starts from the full
 * TS map and applies the one difference that matters here. The nav fix must
 * work with THIS set, not only with the TS default template.
 */
const NORTHSTAR_AUDITOR_PERMISSIONS: PermissionMap = {
  ...defaultPermissions("auditor"),
  "clinical.view": false,
};

test("auditor (TS default template) reaches all five pages read-only", () => {
  const auditor = sessionFor("auditor", "auditor");
  for (const page of FIVE_PAGES) {
    assert.equal(pageVisible(auditor, page), true, `auditor should see ${page}`);
  }
});

test("auditor (stored Northstar permission set) reaches all five pages read-only", () => {
  const auditor = sessionFor("auditor", "auditor", { ...NORTHSTAR_AUDITOR_PERMISSIONS });
  for (const page of FIVE_PAGES) {
    assert.equal(pageVisible(auditor, page), true, `auditor (stored set) should see ${page}`);
  }
});

test("auditor stays out of Messages (designed exclusion)", () => {
  const auditor = sessionFor("auditor", "auditor");
  assert.equal(pageVisible(auditor, "Messages"), false);
  const stored = sessionFor("auditor", "auditor", { ...NORTHSTAR_AUDITOR_PERMISSIONS });
  assert.equal(pageVisible(stored, "Messages"), false);
});

test("the read path requires BOTH the auditor role and audit.read", () => {
  // Auditor role without audit.read (e.g. an agency stripped the key): no path.
  const stripped = sessionFor("auditor", "auditor", {
    ...NORTHSTAR_AUDITOR_PERMISSIONS,
    "audit.read": false,
  });
  assert.equal(canReadAsAuditor(stripped), false);
  for (const page of FIVE_PAGES) {
    assert.equal(pageVisible(stripped, page), false, `stripped auditor should not see ${page}`);
  }
  // A non-auditor holding audit.read does NOT gain the five pages from it:
  // a nurse whose template lost its clinical/approve keys stays out of
  // Delegations and the Review queue.
  const nurse = sessionFor("nurse", "nurse", {
    ...defaultPermissions("nurse"),
    "clinical.view": false,
    "requirements.approve": false,
    "acknowledgments.sign_own": false,
  });
  assert.equal(canReadAsAuditor(nurse), false);
  assert.equal(pageVisible(nurse, "Delegations"), false);
  assert.equal(pageVisible(nurse, "Review queue"), false);
  assert.equal(pageVisible(nurse, "Staff"), false);
  assert.equal(pageVisible(nurse, "Certificates"), false);
});

test("non-auditor outcomes on the five pages are unchanged", () => {
  // Expected values are the pre-7U outcomes under each role's TS default
  // template — pinned so the auditor clause cannot widen another role.
  const expected: Record<string, Record<string, boolean>> = {
    administrator: { Delegations: true, Training: true, Staff: true, Certificates: true, "Review queue": true },
    compliance_admin: { Delegations: true, Training: true, Staff: true, Certificates: true, "Review queue": true },
    program_manager: { Delegations: true, Training: true, Staff: false, Certificates: false, "Review queue": true },
    house_manager: { Delegations: true, Training: true, Staff: true, Certificates: true, "Review queue": false },
    nurse: { Delegations: true, Training: true, Staff: false, Certificates: false, "Review queue": true },
    hr: { Delegations: false, Training: true, Staff: true, Certificates: true, "Review queue": false },
    dsp: { Delegations: true, Training: true, Staff: false, Certificates: false, "Review queue": false },
  };
  const roleOf: Record<string, string> = {
    administrator: "administrator",
    compliance_admin: "compliance_admin",
    program_manager: "manager",
    house_manager: "manager",
    nurse: "nurse",
    hr: "hr",
    dsp: "dsp",
  };
  for (const [roleKey, pages] of Object.entries(expected)) {
    const session = sessionFor(roleKey, roleOf[roleKey]);
    for (const [page, want] of Object.entries(pages)) {
      assert.equal(
        pageVisible(session, page),
        want,
        `${roleKey} / ${page} should stay ${want}`,
      );
    }
  }
});
