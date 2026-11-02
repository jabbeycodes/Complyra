/**
 * PM-STAFF-NAV (wave 7U-2, sim batch 181): pageVisible pins for the program
 * manager's Staff page access, plus the Activity log visibility condition
 * behind the HR dead-link fix (batches 171/183).
 *
 * The Staff page gate keyed only on hr.view_staff / members.invite /
 * members.assign_roles — keys the program manager template (TS default AND
 * the stored Northstar agency template, verified against production data
 * 2026-11-02) does not carry — while that same template grants
 * members.reset_password, a control that lives on the Staff page, and
 * hub.view_team. The fix adds ONE path (canViewStaffAsProgramManager:
 * roleKey "program_manager" + hub.view_team or members.reset_password) and
 * changes no other role's outcome and no on-page control gate.
 *
 * The auditor's Staff outcome is deliberately NOT pinned here: the
 * auditor's read path is owned by PR #239 (wave 7U), which carries its own
 * status.test.ts pins. This file pins only that the PM predicate never
 * fires for the auditor (or any non-PM role).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageVisible } from "./status";
import {
  canViewStaffAsProgramManager,
  defaultPermissions,
  type PermissionMap,
} from "./permissions";
import type { SessionUser } from "./types";

function sessionFor(
  roleKey: string,
  permissions: PermissionMap = defaultPermissions(roleKey),
): SessionUser {
  return {
    userId: `u-${roleKey}`,
    email: `${roleKey}@example.invalid`,
    username: roleKey,
    fullName: roleKey,
    jobTitle: roleKey,
    role: roleKey as SessionUser["role"],
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
 * The decisive keys of the program manager permission set as actually
 * stored in the hosted Northstar agency (verified against production
 * data, 2026-11-02): hub.view_team and members.reset_password are held;
 * hr.view_staff, members.invite and members.assign_roles are NOT. The TS
 * default template agrees on all five keys; this fixture applies the
 * stored set explicitly so the pin does not silently depend on the
 * template definition.
 */
const NORTHSTAR_PM_PERMISSIONS: PermissionMap = {
  ...defaultPermissions("program_manager"),
  "hub.view_team": true,
  "members.reset_password": true,
  "hr.view_staff": false,
  "members.invite": false,
  "members.assign_roles": false,
};

test("Staff page: program manager now reaches it; every other seeded role is unchanged", () => {
  const expected: Record<string, boolean> = {
    administrator: true, // hr.view_staff + members.* (pre-existing)
    compliance_admin: true, // members.invite / members.assign_roles (pre-existing)
    house_manager: true, // hr.view_staff (pre-existing)
    hr: true, // hr.view_staff + members.invite (pre-existing)
    program_manager: true, // NEW — the wave 7U-2 path
    dsp: false, // unchanged
    nurse: false, // unchanged
  };
  for (const [roleKey, want] of Object.entries(expected)) {
    assert.equal(
      pageVisible(sessionFor(roleKey), "Staff"),
      want,
      `${roleKey} Staff visibility should be ${want}`,
    );
  }
});

test("Staff page: program manager reaches it under the stored Northstar permission set", () => {
  const pm = sessionFor("program_manager", { ...NORTHSTAR_PM_PERMISSIONS });
  assert.equal(pageVisible(pm, "Staff"), true);
});

test("the PM path needs only one of the two keys the PM actually holds", () => {
  const teamOnly: PermissionMap = {
    ...NORTHSTAR_PM_PERMISSIONS,
    "members.reset_password": false,
  };
  assert.equal(pageVisible(sessionFor("program_manager", teamOnly), "Staff"), true);
  const resetOnly: PermissionMap = {
    ...NORTHSTAR_PM_PERMISSIONS,
    "hub.view_team": false,
  };
  assert.equal(pageVisible(sessionFor("program_manager", resetOnly), "Staff"), true);
});

test("a program manager holding neither hub.view_team nor members.reset_password still cannot see Staff", () => {
  const stripped: PermissionMap = {
    ...NORTHSTAR_PM_PERMISSIONS,
    "hub.view_team": false,
    "members.reset_password": false,
  };
  const pm = sessionFor("program_manager", stripped);
  assert.equal(canViewStaffAsProgramManager(pm), false);
  assert.equal(pageVisible(pm, "Staff"), false);
});

test("the PM path requires the program_manager role — the same keys never widen another role", () => {
  // A nurse hypothetically granted both keys still gets nothing from this
  // predicate, and her Staff outcome is unchanged.
  const nursePerms: PermissionMap = {
    ...defaultPermissions("nurse"),
    "hub.view_team": true,
    "members.reset_password": true,
  };
  const nurse = sessionFor("nurse", nursePerms);
  assert.equal(canViewStaffAsProgramManager(nurse), false);
  assert.equal(pageVisible(nurse, "Staff"), false);
  // Nor does the predicate fire for the roles that already reach Staff by
  // their own keys, or for the auditor (whose read path is PR #239's).
  for (const roleKey of ["administrator", "compliance_admin", "house_manager", "hr", "dsp", "auditor"]) {
    assert.equal(
      canViewStaffAsProgramManager(sessionFor(roleKey)),
      false,
      `predicate must not fire for ${roleKey}`,
    );
  }
});

test("the PM gains no member-admin keys from the nav fix (control gates are untouched)", () => {
  // Add member (members.invite) and Assign role (members.assign_roles) stay
  // out of the PM's hands; only the pre-existing members.reset_password
  // control key is held, exactly as the template already granted it.
  const pm = sessionFor("program_manager", { ...NORTHSTAR_PM_PERMISSIONS });
  assert.equal(pm.permissions["members.invite"], false);
  assert.equal(pm.permissions["members.assign_roles"], false);
  assert.equal(pm.permissions["members.reset_password"], true);
});

test("Activity log visibility (the condition App uses to render the Overview activity controls): HR is the only seeded role excluded", () => {
  const expected: Record<string, boolean> = {
    administrator: true,
    compliance_admin: true,
    house_manager: true,
    program_manager: true,
    dsp: true,
    nurse: true,
    hr: false, // neither audit.read nor individuals.view — the dead-link role
    auditor: true,
  };
  for (const [roleKey, want] of Object.entries(expected)) {
    assert.equal(
      pageVisible(sessionFor(roleKey), "Activity log"),
      want,
      `${roleKey} Activity log visibility should be ${want}`,
    );
  }
});
