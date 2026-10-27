/**
 * ger.test.ts — event report domain rules: validation, permission gates,
 * the follow-up lifecycle, and submit-notification targets.
 *
 * Run: node --import tsx --test src/data/ger.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCreateGerReport,
  canDecideGerReport,
  canEditGerReportBody,
  canReviewGerReport,
  canViewGerReports,
  deriveGerResolutionDisplay,
  gerNeedsFollowUp,
  gerSubmitNotificationTargets,
  validateGerDraft,
  validateGerResolution,
  type GerReport,
  type GerReportDraft,
} from "./ger";
import { ROLE_TEMPLATE_BY_KEY } from "./permissions";
import type { SessionUser } from "./types";

function sessionFor(roleKey: string): SessionUser {
  const template = ROLE_TEMPLATE_BY_KEY[roleKey as keyof typeof ROLE_TEMPLATE_BY_KEY];
  return {
    userId: `${roleKey}-user`,
    email: "",
    username: roleKey,
    fullName: roleKey,
    jobTitle: "",
    role: template.capability,
    roleKey,
    agencyId: "agency-1",
    agencyName: "Test",
    agencyCode: "TEST",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: { ...template.permissions },
    platformAdmin: false,
    agencyStatus: "active",
  } as SessionUser;
}

const draft: GerReportDraft = {
  siteId: "site-1",
  individualId: "person-1",
  eventDate: "2026-10-20",
  eventTime: "14:30",
  location: "Living room",
  eventType: "Fall",
  severity: "High",
  description: "Slipped in the living room.",
  immediateActions: "First aid given; vitals checked.",
  reporterName: "Sam Staff",
  reporterSignature: "Sam Staff",
  reporterDate: "2026-10-20",
};

function report(patch: Partial<GerReport>): GerReport {
  return {
    id: "ger-1",
    agencyId: "agency-1",
    siteId: "site-1",
    individualId: "person-1",
    linkedIndividualIds: [],
    eventDate: "2026-10-20",
    eventTime: "14:30",
    location: "Living room",
    eventType: "Fall",
    severity: "High",
    description: "Slipped.",
    immediateActions: "First aid.",
    notificationsMade: [],
    witnesses: "",
    reporterName: "Sam Staff",
    reporterSignature: "Sam Staff",
    reporterDate: "2026-10-20",
    status: "submitted",
    reviewNote: "",
    reviewedByUserId: null,
    reviewedAt: null,
    resolutionStatus: "unaddressed",
    investigationRequired: false,
    investigationNotes: "",
    assignedManagerUserId: null,
    resolutionDueOn: null,
    closureNote: "",
    resolvedByUserId: null,
    resolvedAt: null,
    createdByUserId: "dsp-user",
    createdAt: "2026-10-20T15:00:00Z",
    updatedAt: "2026-10-20T15:00:00Z",
    ...patch,
  };
}

test("ger: a complete draft validates; missing pieces are named", () => {
  assert.deepEqual(validateGerDraft(draft), []);
  const errors = validateGerDraft({ ...draft, description: " ", reporterSignature: "" });
  assert.ok(errors.some((e) => e.includes("what happened")));
  assert.ok(errors.some((e) => e.includes("sign")));
});

test("ger: role gates — DSP files, managers review, auditors read only", () => {
  assert.equal(canCreateGerReport("dsp"), true);
  assert.equal(canCreateGerReport("house_manager"), true);
  assert.equal(canCreateGerReport("auditor"), false);
  assert.equal(canCreateGerReport("hr"), false);
  assert.equal(canReviewGerReport("nurse"), true);
  assert.equal(canReviewGerReport("dsp"), false);

  assert.equal(canViewGerReports(sessionFor("auditor")), true);
  assert.equal(canViewGerReports(sessionFor("house_manager")), true);
  assert.equal(canViewGerReports(sessionFor("hr")), false);
  assert.equal(canViewGerReports(null), false);
});

test("ger: edit and decide rules follow the workflow", () => {
  const author = sessionFor("dsp");
  author.userId = "dsp-user";
  const draftReport = report({ status: "draft" });
  assert.equal(canEditGerReportBody(draftReport, author), true);
  assert.equal(canEditGerReportBody(report({ status: "submitted" }), author), false);
  assert.equal(canEditGerReportBody(report({ status: "approved" }), sessionFor("nurse")), false);
  assert.equal(canDecideGerReport(report({ status: "submitted" }), sessionFor("nurse")), true);
  assert.equal(canDecideGerReport(report({ status: "submitted" }), author), false);
  assert.equal(canDecideGerReport(report({ status: "approved" }), sessionFor("nurse")), false);
});

test("ger: resolution lifecycle — overdue derives from the due date", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(
    deriveGerResolutionDisplay(report({ resolutionDueOn: "2026-10-26" }), now),
    "overdue",
  );
  assert.equal(
    deriveGerResolutionDisplay(report({ resolutionDueOn: "2026-10-28" }), now),
    "unaddressed",
  );
  assert.equal(
    deriveGerResolutionDisplay(
      report({ resolutionStatus: "resolved", resolutionDueOn: "2026-10-26" }),
      now,
    ),
    "resolved",
  );
  assert.equal(gerNeedsFollowUp(report({ status: "draft" }), now), false);
  assert.equal(gerNeedsFollowUp(report({}), now), true);
  assert.equal(
    gerNeedsFollowUp(report({ resolutionStatus: "resolved" }), now),
    false,
  );
});

test("ger: resolving requires a closure note", () => {
  const errors = validateGerResolution(
    { resolutionStatus: "resolved", closureNote: " " },
    report({}),
  );
  assert.ok(errors.some((e) => e.includes("closure note")));
  assert.deepEqual(
    validateGerResolution(
      { resolutionStatus: "resolved", closureNote: "Spoke with guardian; plan updated." },
      report({}),
    ),
    [],
  );
});

test("ger: submit targets HM directly plus PM and nurse broadcasts, deduped", () => {
  const targets = gerSubmitNotificationTargets({
    gerId: "ger-1",
    houseManagerUserIds: ["hm-1", "hm-1", "hm-2"],
  });
  assert.equal(targets.length, 4);
  assert.deepEqual(
    targets.map((t) => t.dedupeKey),
    [
      "incident.followup:ger:ger-1:hm:hm-1",
      "incident.followup:ger:ger-1:hm:hm-2",
      "incident.followup:ger:ger-1:role:program_manager",
      "incident.followup:ger:ger-1:role:nurse",
    ],
  );
  assert.ok(!targets.some((t) => (t.roleKey as string) === "auditor"));
});

test("ger: site context rejects an Individual from a different home", () => {
  // Without a context, presence/format validation is unchanged.
  assert.deepEqual(validateGerDraft(draft), []);
  // The Individual lives at site-2 but the draft claims site-1.
  const errors = validateGerDraft(draft, { individualSiteId: "site-2" });
  assert.ok(errors.some((e) => e.includes("must be filed under the home")));
  // Matching home passes.
  assert.deepEqual(validateGerDraft(draft, { individualSiteId: "site-1" }), []);
  // A missing Individual is an error, not a silent pass.
  const missing = validateGerDraft(draft, { individualSiteId: null });
  assert.ok(missing.some((e) => e.includes("could not be found")));
});

test("ger: site context rejects linked Individuals from other homes", () => {
  const linked = { ...draft, linkedIndividualIds: ["person-2", "person-3"] };
  const errors = validateGerDraft(linked, {
    individualSiteId: "site-1",
    linkedSiteIds: { "person-2": "site-1", "person-3": "site-2" },
  });
  assert.ok(errors.some((e) => e.includes("linked Individual must live")));
  const unknown = validateGerDraft(linked, {
    individualSiteId: "site-1",
    linkedSiteIds: { "person-2": "site-1", "person-3": null },
  });
  assert.ok(unknown.some((e) => e.includes("could not be found")));
  assert.deepEqual(
    validateGerDraft(linked, {
      individualSiteId: "site-1",
      linkedSiteIds: { "person-2": "site-1", "person-3": "site-1" },
    }),
    [],
  );
});
