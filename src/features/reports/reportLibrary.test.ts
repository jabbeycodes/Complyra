import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_LIBRARY,
  REPORT_LIBRARY_EXTENSION_POINTS,
  REPORT_LIBRARY_ROLES,
  canAccessReportLibrary,
  canRunReport,
  reportsForRole,
  type ReportScopeKind,
} from "./reportLibrary";
import { REPORT_RUNNERS } from "./reportRunners";
import { ROLE_KEYS, ROLE_TEMPLATE_BY_KEY, type RoleKey } from "../../data/permissions";
import { pageVisible } from "../../data/status";
import type { SessionUser } from "../../data/types";

const VALID_SCOPE_KINDS: ReportScopeKind[] = [
  "agency",
  "site",
  "individual",
  "staff",
  "dateRange",
  "month",
  "year",
  "record",
];

function sessionFor(roleKey: RoleKey): SessionUser {
  return {
    userId: `user-${roleKey}`,
    email: `${roleKey}@example.invalid`,
    username: roleKey,
    fullName: `Test ${roleKey}`,
    jobTitle: roleKey,
    role: ROLE_TEMPLATE_BY_KEY[roleKey].capability,
    roleKey,
    agencyId: "agency-1",
    agencyName: "Agency",
    agencyCode: "AGENCY-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: ROLE_TEMPLATE_BY_KEY[roleKey].permissions,
    platformAdmin: false,
    agencyStatus: "active",
  };
}

test("registry ids are unique and every entry resolves to a real runner", () => {
  const ids = REPORT_LIBRARY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate registry ids");
  for (const entry of REPORT_LIBRARY) {
    assert.equal(
      typeof REPORT_RUNNERS[entry.id],
      "function",
      `entry ${entry.id} has no runner — dead entries are not allowed`,
    );
  }
  for (const runnerId of Object.keys(REPORT_RUNNERS)) {
    assert.ok(
      ids.includes(runnerId),
      `runner ${runnerId} has no registry entry`,
    );
  }
});

test("every entry declares valid scopes, a record kind when it needs one, and library roles", () => {
  for (const entry of REPORT_LIBRARY) {
    assert.ok(entry.title.trim(), `${entry.id}: title missing`);
    assert.ok(entry.description.trim(), `${entry.id}: description missing`);
    assert.ok(entry.module.trim(), `${entry.id}: module missing`);
    assert.ok(entry.scopes.length > 0, `${entry.id}: no scopes declared`);
    for (const scope of entry.scopes) {
      assert.ok(
        VALID_SCOPE_KINDS.includes(scope),
        `${entry.id}: invalid scope kind ${scope}`,
      );
    }
    if (entry.scopes.includes("record")) {
      assert.ok(entry.recordKind, `${entry.id}: record scope without a recordKind`);
    }
    if (entry.recordKind) {
      assert.ok(
        entry.scopes.includes("record"),
        `${entry.id}: recordKind set but record scope not declared`,
      );
    }
    assert.ok(entry.roles.length > 0, `${entry.id}: no roles declared`);
    for (const role of entry.roles) {
      assert.ok(
        (ROLE_KEYS as string[]).includes(role),
        `${entry.id}: unknown role ${role}`,
      );
      assert.ok(
        REPORT_LIBRARY_ROLES.includes(role),
        `${entry.id}: role ${role} is outside the library's role set`,
      );
    }
  }
});

test("extension points are marked follow-ups, never runnable entries", () => {
  const entryIds = new Set(REPORT_LIBRARY.map((entry) => entry.id));
  for (const point of REPORT_LIBRARY_EXTENSION_POINTS) {
    assert.ok(point.module.trim(), "extension point without a module");
    assert.ok(point.plannedReports.length > 0, `${point.module}: no planned reports`);
    assert.ok(point.blockedOn.trim(), `${point.module}: no blocker noted`);
    assert.ok(!entryIds.has(point.module), `${point.module} is both live and an extension point`);
  }
});

test("library access is limited to management, nurse, and auditor roles", () => {
  for (const role of ["administrator", "compliance_admin", "program_manager", "house_manager", "nurse", "auditor"]) {
    assert.equal(canAccessReportLibrary(role), true, `${role} should have library access`);
  }
  for (const role of ["dsp", "hr", "manager", ""]) {
    assert.equal(canAccessReportLibrary(role), false, `${role} should not have library access`);
    assert.deepEqual(reportsForRole(role), [], `${role} should see no entries`);
  }
});

test("per-entry roles mirror the home surfaces' gates", () => {
  const byId = new Map(REPORT_LIBRARY.map((entry) => [entry.id, entry]));
  // Mileage PDF downloads: monthly/weekly sheets are HM + administrator;
  // the yearly summary is administrator + PM (mirrors data/mileage gates).
  assert.deepEqual(byId.get("mileage-month")?.roles, ["administrator", "house_manager"]);
  assert.deepEqual(byId.get("mileage-week")?.roles, ["administrator", "house_manager"]);
  assert.deepEqual(byId.get("mileage-year")?.roles, ["administrator", "program_manager"]);
  // Staff training profiles require hr.view_staff to view someone else's.
  assert.deepEqual(byId.get("staff-training-checklist")?.roles, ["administrator", "house_manager"]);
  // Auditors are read-only and included on record reports.
  const compliance = byId.get("compliance-report");
  assert.ok(compliance && canRunReport(compliance, "auditor"));
  const mileageMonth = byId.get("mileage-month");
  assert.ok(mileageMonth && !canRunReport(mileageMonth, "auditor"));
});

test("reportsForRole only returns entries the role may run", () => {
  for (const roleKey of ROLE_KEYS) {
    const visible = reportsForRole(roleKey);
    for (const entry of visible) {
      assert.ok(canRunReport(entry, roleKey), `${entry.id} visible to ${roleKey} but not runnable`);
    }
    const expected = canAccessReportLibrary(roleKey)
      ? REPORT_LIBRARY.filter((entry) => entry.roles.includes(roleKey)).length
      : 0;
    assert.equal(visible.length, expected, `${roleKey} sees the wrong catalog size`);
  }
});

test("pageVisible gate in data/status agrees with the library role set", () => {
  for (const roleKey of ROLE_KEYS) {
    assert.equal(
      pageVisible(sessionFor(roleKey), "Report Library"),
      canAccessReportLibrary(roleKey),
      `page gate disagrees for ${roleKey}`,
    );
  }
});
