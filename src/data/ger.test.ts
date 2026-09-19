/**
 * Tests for the GER (General Event Report) pure logic: validation, workflow
 * transitions, permission gates, filtering, and escalation payloads.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateGerInput,
  transitionGerStatus,
  canCreateGerReport,
  canReviewGerReport,
  canViewGerReports,
  canEditGerReportBody,
  canDecideGerReport,
  gerEscalatesOnSubmit,
  gerEscalationPayload,
  gerSubmitNotificationTargets,
  filterGerReports,
  sortGerReports,
  GER_STATUS_LABELS,
} from "./ger";
import { defaultPermissions } from "./permissions";
import type { SessionUser } from "./types";

function sessionFor(roleKey: string): SessionUser {
  const roleByKey: Record<string, string> = {
    administrator: "administrator",
    compliance_admin: "compliance_admin",
    house_manager: "manager",
    program_manager: "manager",
    nurse: "nurse",
    hr: "hr",
    auditor: "auditor",
    dsp: "dsp",
  };
  return {
    userId: `u-${roleKey}`,
    email: "user@example.com",
    username: "user1",
    fullName: "Test Staff",
    jobTitle: "Tester",
    role: (roleByKey[roleKey] ?? "staff") as SessionUser["role"],
    roleKey,
    agencyId: "a1",
    agencyName: "Test Agency",
    agencyCode: "TEST",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: defaultPermissions(roleKey),
    platformAdmin: false,
    agencyStatus: "active",
  };
}

const COMPLETE = {
  individualId: "ind1",
  eventDate: "2026-09-17",
  eventTime: "14:30",
  location: "Living room",
  eventType: "fall" as const,
  severity: "moderate" as const,
  description: "Individual slipped near the couch.",
  actionsTaken: "Checked for injury; applied ice; no visible injury.",
  notificationsMade: [],
  witnesses: "Jodie M.",
  reportedByName: "Dana Staff",
  signatureName: "Dana Staff",
};

describe("validateGerInput", () => {
  test("drafts may be partial", () => {
    const errors = validateGerInput({}, { forSubmit: false });
    assert.equal(errors.length, 0);
  });

  test("drafts still reject malformed values", () => {
    const errors = validateGerInput(
      { eventType: "nope" as never, severity: "nope" as never, eventDate: "2026-13-99", eventTime: "99:99" },
      { forSubmit: false },
    );
    assert.ok(errors.some((e) => e.field === "eventType"));
    assert.ok(errors.some((e) => e.field === "severity"));
    assert.ok(errors.some((e) => e.field === "eventDate"));
    assert.ok(errors.some((e) => e.field === "eventTime"));
  });

  test("submit requires the full field set", () => {
    const errors = validateGerInput({}, { forSubmit: true });
    for (const field of [
      "individualId",
      "eventDate",
      "location",
      "description",
      "actionsTaken",
      "reportedByName",
      "signatureName",
    ]) {
      assert.ok(
        errors.some((e) => e.field === field),
        `submit requires ${field}`,
      );
    }
  });

  test("a complete report passes submit validation", () => {
    const errors = validateGerInput(COMPLETE, { forSubmit: true });
    assert.deepEqual(errors, []);
  });
});

describe("transitionGerStatus", () => {
  test("draft -> submitted -> approved", () => {
    assert.equal(transitionGerStatus("draft", "submit"), "submitted");
    assert.equal(transitionGerStatus("submitted", "approve"), "approved");
  });

  test("submitted -> returned -> resubmitted", () => {
    assert.equal(transitionGerStatus("submitted", "return"), "returned");
    assert.equal(transitionGerStatus("returned", "submit"), "submitted");
  });

  test("approved reports are final", () => {
    assert.throws(() => transitionGerStatus("approved", "submit"), /Cannot/);
    assert.throws(() => transitionGerStatus("approved", "approve"), /Cannot/);
    assert.throws(() => transitionGerStatus("approved", "return"), /Cannot/);
  });

  test("illegal moves throw with a readable message", () => {
    assert.throws(() => transitionGerStatus("draft", "approve"), /Cannot approve a report that is Draft/);
    assert.throws(() => transitionGerStatus("returned", "return"), /Cannot/);
  });

  test("every status has a label", () => {
    for (const status of ["draft", "submitted", "approved", "returned"] as const) {
      assert.ok(GER_STATUS_LABELS[status].length > 0);
    }
  });
});

describe("GER permission gates", () => {
  test("DSP can create but not review", () => {
    assert.ok(canCreateGerReport(sessionFor("dsp")));
    assert.ok(!canReviewGerReport(sessionFor("dsp")));
  });

  test("HM, PM, and nurse can create and review", () => {
    for (const role of ["house_manager", "program_manager", "nurse"]) {
      assert.ok(canCreateGerReport(sessionFor(role)), `${role} creates`);
      assert.ok(canReviewGerReport(sessionFor(role)), `${role} reviews`);
    }
  });

  test("auditor is read-only (can view, cannot create or review)", () => {
    assert.ok(canViewGerReports(sessionFor("auditor")));
    assert.ok(!canCreateGerReport(sessionFor("auditor")));
    assert.ok(!canReviewGerReport(sessionFor("auditor")));
    // 2026-09-19 founder ruling: auditors see everything, but read-only —
    // they cannot edit, submit, decide, or be alerted.
    const draft = { status: "draft" as const, createdBy: "u-other" };
    const submitted = { status: "submitted" as const, createdBy: "u-other" };
    const auditor = sessionFor("auditor");
    assert.ok(!canEditGerReportBody(auditor, draft));
    assert.ok(!canEditGerReportBody(auditor, submitted));
    assert.ok(!canDecideGerReport(auditor, submitted));
    assert.ok(!canDecideGerReport(auditor, draft));
    const targets = gerSubmitNotificationTargets(["hm-1"]);
    assert.ok(
      targets.every((t) => t.roleKey !== "auditor"),
      "auditors get no submit alerts",
    );
  });

  test("HR sees nothing (no GER or individuals access)", () => {
    assert.ok(!canViewGerReports(sessionFor("hr")));
    assert.ok(!canCreateGerReport(sessionFor("hr")));
    assert.ok(!canReviewGerReport(sessionFor("hr")));
  });

  test("no session sees nothing", () => {
    assert.ok(!canViewGerReports(null));
    assert.ok(!canCreateGerReport(null));
    assert.ok(!canReviewGerReport(null));
  });

  test("edit rules: author edits draft/returned, reviewers edit pre-approval, approved locks", () => {
    const dsp = sessionFor("dsp");
    const pm = sessionFor("program_manager");
    const other = { ...dsp, userId: "u-someone-else" };

    assert.ok(canEditGerReportBody(dsp, { status: "draft", createdBy: "u-dsp" }));
    assert.ok(canEditGerReportBody(dsp, { status: "returned", createdBy: "u-dsp" }));
    assert.ok(!canEditGerReportBody(other, { status: "draft", createdBy: "u-dsp" }));
    // Submitted: only reviewers may touch (author locked out).
    assert.ok(!canEditGerReportBody(dsp, { status: "submitted", createdBy: "u-dsp" }));
    assert.ok(canEditGerReportBody(pm, { status: "submitted", createdBy: "u-dsp" }));
    // Approved: locked for everyone.
    assert.ok(!canEditGerReportBody(pm, { status: "approved", createdBy: "u-dsp" }));
  });

  test("review decisions are reviewer-only on submitted reports", () => {
    const pm = sessionFor("program_manager");
    const dsp = sessionFor("dsp");
    assert.ok(canDecideGerReport(pm, { status: "submitted" }));
    assert.ok(!canDecideGerReport(dsp, { status: "submitted" }));
    assert.ok(!canDecideGerReport(pm, { status: "draft" }));
    assert.ok(!canDecideGerReport(pm, { status: "approved" }));
  });
});

describe("escalation payload", () => {
  test("only high and critical escalate", () => {
    assert.ok(gerEscalatesOnSubmit("high"));
    assert.ok(gerEscalatesOnSubmit("critical"));
    assert.ok(!gerEscalatesOnSubmit("low"));
    assert.ok(!gerEscalatesOnSubmit("moderate"));
  });

  test("payload reuses the incident.followup type with a reporting deep link", () => {
    const payload = gerEscalationPayload({
      agencyId: "a1",
      roleKey: "nurse",
      gerId: "ger-1",
      siteId: "s1",
      individualName: "Shawna M.",
      eventType: "fall",
      severity: "high",
      eventDate: "2026-09-17",
    });
    assert.equal(payload.type, "incident.followup");
    assert.equal(payload.roleKey, "nurse");
    assert.equal(payload.deepLink, "/reporting/ger-1");
    assert.ok(payload.title.includes("High"));
    assert.ok(payload.body.includes("Shawna M."));
  });
});

describe("filterGerReports / sortGerReports", () => {
  const rows = [
    { individualId: "i1", eventType: "fall" as const, status: "draft" as const, eventDate: "2026-09-17", createdAt: "a" },
    { individualId: "i2", eventType: "injury" as const, status: "submitted" as const, eventDate: "2026-09-16", createdAt: "b" },
    { individualId: "i1", eventType: "fall" as const, status: "approved" as const, eventDate: "2026-09-15", createdAt: "c" },
  ];

  test("filters combine as AND", () => {
    assert.equal(
      filterGerReports(rows, { individualId: "i1", eventType: "fall", status: "", from: "", to: "" }).length,
      2,
    );
    assert.equal(
      filterGerReports(rows, { individualId: "i1", eventType: "", status: "draft", from: "", to: "" }).length,
      1,
    );
  });

  test("date range is inclusive", () => {
    assert.equal(
      filterGerReports(rows, { individualId: "", eventType: "", status: "", from: "2026-09-16", to: "2026-09-17" }).length,
      2,
    );
  });

  test("sorts newest first", () => {
    const sorted = sortGerReports([...rows].reverse());
    assert.equal(sorted[0].eventDate, "2026-09-17");
    assert.equal(sorted[2].eventDate, "2026-09-15");
  });
});

describe("gerSubmitNotificationTargets", () => {
  test("every submission alerts the home's HM directly, plus PM and nurse", () => {
    const targets = gerSubmitNotificationTargets(["hm-1", "hm-2"]);
    assert.deepEqual(
      targets.map((t) => t.userId),
      ["hm-1", "hm-2", null, null],
    );
    assert.deepEqual(
      targets.map((t) => t.roleKey),
      [null, null, "program_manager", "nurse"],
    );
  });

  test("duplicate HM ids are collapsed", () => {
    const targets = gerSubmitNotificationTargets(["hm-1", "hm-1"]);
    assert.equal(targets.filter((t) => t.userId === "hm-1").length, 1);
  });

  test("with no assigned HM there is no HM broadcast; PM + nurse cover review", () => {
    const targets = gerSubmitNotificationTargets([]);
    // No house_manager role broadcast — that would leak a home's PHI to
    // every HM in the agency. The program manager provides review coverage.
    assert.deepEqual(
      targets.map((t) => t.roleKey),
      ["program_manager", "nurse"],
    );
    assert.ok(targets.every((t) => t.userId === null));
  });
});

describe("submit-time notification payload", () => {
  test("a direct HM alert carries the member id and a member-scoped dedupe key", () => {
    const payload = gerEscalationPayload({
      agencyId: "a1",
      roleKey: "house_manager",
      userId: "hm-1",
      gerId: "ger-9",
      siteId: "s1",
      individualName: "Reese L.",
      eventType: "fall",
      severity: "low",
      eventDate: "2026-09-17",
    });
    assert.equal(payload.type, "incident.followup");
    assert.equal(payload.userId, "hm-1");
    assert.equal(payload.roleKey, null);
    assert.equal(payload.dedupeKey, "incident.followup:ger-9:house_manager:hm-1");
  });

  test("severity reads differently in the title at each level", () => {
    const base = {
      agencyId: "a1",
      roleKey: "nurse",
      gerId: "ger-9",
      siteId: "s1",
      individualName: "Reese L.",
      eventType: "injury" as const,
      eventDate: "2026-09-17",
    };
    const low = gerEscalationPayload({ ...base, severity: "low" });
    const critical = gerEscalationPayload({ ...base, severity: "critical" });
    assert.ok(low.title.startsWith("Low"));
    assert.ok(critical.title.startsWith("Critical"));
    assert.ok(low.body.includes("low severity"));
    assert.ok(critical.body.includes("critical severity"));
    assert.notEqual(low.title, critical.title);
  });

  test("role broadcasts keep the per-gerId+roleKey dedupe scheme", () => {
    const payload = gerEscalationPayload({
      agencyId: "a1",
      roleKey: "program_manager",
      gerId: "ger-9",
      siteId: "s1",
      individualName: "Reese L.",
      eventType: "fall",
      severity: "high",
      eventDate: "2026-09-17",
    });
    assert.equal(payload.roleKey, "program_manager");
    assert.equal(payload.dedupeKey, "incident.followup:ger-9:program_manager");
  });
});
