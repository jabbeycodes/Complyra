import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SITE_DETAIL_TAB_IDS,
  getSiteDetailTabs,
  type SiteDetailTabId,
} from "./siteTabs";
import { auditPeriodLabel, auditScoreDisplay } from "./SiteDetailPage";
import { defaultPermissions } from "../../data/permissions";
import type { SessionUser } from "../../data/types";

function sessionFor(
  roleKey: string,
  overrides: Partial<SessionUser> = {},
): SessionUser {
  const roleByKey: Record<string, string> = {
    administrator: "administrator",
    compliance_admin: "compliance_admin",
    house_manager: "manager",
    degreed_professional_manager: "manager",
    program_manager: "manager",
    nurse: "nurse",
    hr: "hr",
    auditor: "auditor",
    dsp: "dsp",
  };
  return {
    userId: "user-1",
    email: "user@example.com",
    username: "user1",
    fullName: "Test User",
    jobTitle: "Tester",
    role: roleByKey[roleKey] ?? "staff",
    roleKey,
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: defaultPermissions(roleKey),
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

const EXPECTED_ORDER: SiteDetailTabId[] = [
  "overview",
  "individuals",
  "isp_data",
  "audits",
  "checklists",
  "training",
  "medications",
  "mileage",
  "drills",
  "documents",
  "staff",
];

describe("site detail tabs", () => {
  it("defines the canonical tab order with staff last", () => {
    assert.deepEqual([...SITE_DETAIL_TAB_IDS], EXPECTED_ORDER);
    assert.equal(
      SITE_DETAIL_TAB_IDS[SITE_DETAIL_TAB_IDS.length - 1],
      "staff",
      "staff tab must be last",
    );
  });

  it("every tab has a label (no empty placeholder tabs)", () => {
    for (const tab of getSiteDetailTabs(sessionFor("administrator"))) {
      assert.ok(tab.label && tab.label.length > 0, `tab ${tab.id} has a label`);
      assert.equal(typeof tab.visible, "function", `tab ${tab.id} has a gate`);
    }
  });

  it("keeps staff last even when permission filtering removes tabs", () => {
    // DSP: no hr.view_staff / members.invite / assign_roles -> no staff tab.
    const dspTabs = getSiteDetailTabs(sessionFor("dsp"));
    const ids = dspTabs.map((t) => t.id);
    assert.ok(!ids.includes("staff"), "DSP does not see the staff tab");
    assert.ok(ids.includes("overview"), "DSP still sees overview");
    assert.equal(
      ids[ids.length - 1],
      "documents",
      "last visible tab for DSP is documents",
    );
    // Administrator sees everything, staff still last.
    const adminIds = getSiteDetailTabs(sessionFor("administrator")).map((t) => t.id);
    assert.deepEqual(adminIds, EXPECTED_ORDER);
    assert.equal(adminIds[adminIds.length - 1], "staff");
  });

  it("gates restricted tabs for a non-privileged role", () => {
    const dspTabs = getSiteDetailTabs(sessionFor("dsp")).map((t) => t.id);
    // DSP has no audit.read, so no audits tab; checklists need HM/DPM scope.
    assert.ok(!dspTabs.includes("audits"), "DSP does not see audits");
    assert.ok(!dspTabs.includes("checklists"), "DSP does not see checklists");
    // DSP does see documents (documents.view is in the template).
    assert.ok(dspTabs.includes("documents"), "DSP sees documents");
  });

  it("shows audits to the auditor role", () => {
    const ids = getSiteDetailTabs(sessionFor("auditor")).map((t) => t.id);
    assert.ok(ids.includes("audits"), "auditor sees audits");
  });

  it("shows only overview when there is no session", () => {
    assert.deepEqual(
      getSiteDetailTabs(null).map((t) => t.id),
      ["overview"],
    );
  });

  it("house manager sees checklists and the staff tab still last", () => {
    const ids = getSiteDetailTabs(sessionFor("house_manager")).map((t) => t.id);
    assert.ok(ids.includes("checklists"), "HM sees checklists");
    // HM template carries hr.view_staff, so the staff tab shows — and it must
    // still be last.
    assert.ok(ids.includes("staff"), "HM sees the staff tab");
    assert.equal(ids[ids.length - 1], "staff", "staff remains last for HM");
  });
});

describe("audit score display", () => {
  it("reads numeric snapshots", () => {
    assert.equal(auditScoreDisplay(87.4), "87%");
  });

  it("reads common snapshot object shapes defensively", () => {
    assert.equal(auditScoreDisplay({ overall: 92 }), "92%");
    assert.equal(auditScoreDisplay({ overallScore: 81.2 }), "81%");
    assert.equal(auditScoreDisplay({ percent: 77 }), "77%");
  });

  it("returns null for missing or unrecognized snapshots", () => {
    assert.equal(auditScoreDisplay(null), null);
    assert.equal(auditScoreDisplay(undefined), null);
    assert.equal(auditScoreDisplay({ sections: [] }), null);
    assert.equal(auditScoreDisplay("high"), null);
  });

  it("labels audit periods", () => {
    assert.equal(
      auditPeriodLabel({
        id: "a1",
        year: 2026,
        quarter: 3,
        status: "finalized",
        auditorName: "",
        signedAt: null,
        createdAt: "",
        scoreJson: null,
      }),
      "Q3 2026",
    );
  });
});
