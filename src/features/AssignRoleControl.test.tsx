/**
 * Wave 7T (simulation batch 158) — Staff-page role-select safety.
 *
 * The role select on a member's Staff row must always open on that member's
 * actual current role. The old initializer fell back to "dsp" whenever the
 * viewer could not grant the member's current role (HR or compliance viewing
 * an administrator's row), so the select read "DSP · Direct support
 * professional" under a role column saying "Agency administrator" — and an
 * untouched Save would have submitted the wrong role.
 *
 * Pins:
 *  - grantable member roles render a select pre-set to the member's role;
 *  - members whose current role the viewer cannot grant (administrator /
 *    compliance-administrator for HR and compliance viewers) render NO
 *    form at all — the actual role, read-only;
 *  - HR keeps its legitimate assignment power over operational roles;
 *  - the administrator's own row stays the static guard it always was.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AssignRoleControl from "./AssignRoleControl";
import { DataContext } from "../data/DataProvider";
import { defaultPermissions } from "../data/permissions";
import type { SessionUser } from "../data/types";
import type { WorkspaceView } from "../data/index";

function makeSession(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: "viewer-1",
    email: "viewer@example.com",
    username: "viewer",
    fullName: "Viewer One",
    jobTitle: "Viewer",
    role: "administrator",
    roleKey: "administrator",
    agencyId: "agency-1",
    agencyName: "Test Agency",
    agencyCode: "TEST-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: defaultPermissions("administrator"),
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as SessionUser;
}

function renderControl(session: SessionUser, memberRoleKey: string, memberUserId = "member-1"): string {
  const value = {
    api: {
      assignMemberRole: async () => {},
    } as never,
    session,
    workspace: {
      sites: [{ id: "site-1", name: "Maple House" }],
    } as unknown as WorkspaceView,
    loading: false,
    error: "",
    usingHostedBackend: false,
    signIn: async () => {},
    changePassword: async () => {},
    signOut: async () => {},
    refresh: async () => {},
  };
  return renderToStaticMarkup(
    <DataContext.Provider value={value}>
      <AssignRoleControl
        userId={memberUserId}
        roleKey={memberRoleKey}
        siteId="site-1"
        expiresOn={null}
        onAssigned={() => {}}
      />
    </DataContext.Provider>,
  );
}

function selectedOptionValue(html: string): string | null {
  const match = html.match(/<option[^>]*value="([^"]+)"[^>]*selected/);
  return match ? match[1] : null;
}

describe("AssignRoleControl role-select initialization (wave 7T)", () => {
  it("administrator viewer: select opens on the member's actual role", () => {
    const admin = makeSession({});
    assert.equal(selectedOptionValue(renderControl(admin, "house_manager")), "house_manager");
    assert.equal(selectedOptionValue(renderControl(admin, "dsp")), "dsp");
  });

  it("HR viewer: an administrator member renders read-only — no form, no select, no Save", () => {
    const hr = makeSession({
      userId: "viewer-hr",
      role: "hr",
      roleKey: "hr",
      permissions: defaultPermissions("hr"),
    });
    const html = renderControl(hr, "administrator");
    assert.ok(!html.includes("<select"), "no select that could submit a wrong role");
    assert.ok(!html.includes("Save"), "no save button");
    assert.ok(html.includes("Agency administrator"), "the member's actual role is shown");
  });

  it("HR viewer keeps assignment power over operational roles, pre-set to the actual role", () => {
    const hr = makeSession({
      userId: "viewer-hr",
      role: "hr",
      roleKey: "hr",
      permissions: defaultPermissions("hr"),
    });
    assert.equal(selectedOptionValue(renderControl(hr, "dsp")), "dsp");
    assert.equal(selectedOptionValue(renderControl(hr, "house_manager")), "house_manager");
  });

  it("the administrator's own row stays the static guard", () => {
    const admin = makeSession({ userId: "member-1" });
    const html = renderControl(admin, "administrator", "member-1");
    assert.ok(!html.includes("<select"), "no select on the admin's own row");
    assert.ok(html.includes("Administrator"), "static label");
  });
});
