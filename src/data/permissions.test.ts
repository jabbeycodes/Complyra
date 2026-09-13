import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERMISSION_KEYS,
  canGrantRole,
  PERMISSION_LABELS,
  ROLE_TEMPLATE_BY_KEY,
  capabilityForRoleKey,
  defaultPermissions,
  hasPermission,
} from "./permissions";

test("template roles map to the right capability class", () => {
  assert.equal(capabilityForRoleKey("house_manager"), "manager");
  assert.equal(capabilityForRoleKey("degreed_professional_manager"), "manager");
  assert.equal(capabilityForRoleKey("dsp"), "dsp");
  assert.equal(capabilityForRoleKey("program_manager"), "manager");
  assert.equal(capabilityForRoleKey("nurse"), "nurse");
  assert.equal(capabilityForRoleKey("hr"), "hr");
  assert.equal(capabilityForRoleKey("auditor"), "auditor");
});

test("HR stays out of care records and auditors stay read-only", () => {
  assert.equal(ROLE_TEMPLATE_BY_KEY.hr.permissions["individuals.view"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.hr.permissions["members.invite"], true);
  assert.equal(ROLE_TEMPLATE_BY_KEY.auditor.permissions["requirements.approve"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.auditor.permissions["audit.export"], true);
  assert.equal(ROLE_TEMPLATE_BY_KEY.nurse.permissions["members.assign_roles"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.nurse.permissions["documents.upload"], true);
  assert.equal(ROLE_TEMPLATE_BY_KEY.nurse.permissions["requirements.approve"], true);
  assert.equal(ROLE_TEMPLATE_BY_KEY.house_manager.permissions["requirements.approve"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.house_manager.permissions["acknowledgments.sign_own"], true);
  assert.equal(
    ROLE_TEMPLATE_BY_KEY.degreed_professional_manager.permissions["members.reset_password"],
    true,
  );
  assert.equal(ROLE_TEMPLATE_BY_KEY.administrator.permissions["sites.create"], true);
  assert.equal(
    ROLE_TEMPLATE_BY_KEY.degreed_professional_manager.permissions["sites.create"],
    true,
  );
  assert.equal(ROLE_TEMPLATE_BY_KEY.dsp.permissions["sites.create"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.house_manager.permissions["sites.create"], false);
  assert.equal(ROLE_TEMPLATE_BY_KEY.program_manager.permissions["sites.create"], false);
  assert.equal(
    hasPermission({ role: "hr" }, "individuals.view"),
    false,
  );
});

test("LIFEPATH-P4: certificates.manage defaults — HR on, administrator off", () => {
  assert.ok(PERMISSION_KEYS.includes("certificates.manage"));
  assert.equal(PERMISSION_LABELS["certificates.manage"], "Manage staff certificates");
  assert.equal(defaultPermissions("hr")["certificates.manage"], true);
  assert.equal(defaultPermissions("administrator")["certificates.manage"], false);
  // Other roles do not get it by default (administrator explicit grant path).
  assert.equal(defaultPermissions("dsp")["certificates.manage"], false);
});

test("LIFEPATH-P4: hasPermission honors the new key from session packs and role templates", () => {
  assert.equal(hasPermission({ permissions: { "certificates.manage": true } }, "certificates.manage"), true);
  assert.equal(hasPermission({ permissions: { "certificates.manage": false } }, "certificates.manage"), false);
  assert.equal(hasPermission({ role: "hr" }, "certificates.manage"), true);
  assert.equal(hasPermission({ role: "administrator" }, "certificates.manage"), false);
});

test("HR-ROLES: HR can assign roles to staff but cannot manage role templates", () => {
  assert.ok(PERMISSION_KEYS.includes("roles.manage"));
  assert.equal(PERMISSION_LABELS["roles.manage"], "Edit role access levels");
  assert.equal(PERMISSION_LABELS["members.assign_roles"], "Assign roles to staff");
  assert.equal(defaultPermissions("hr")["members.assign_roles"], true);
  assert.equal(defaultPermissions("hr")["roles.manage"], false);
  assert.equal(defaultPermissions("hr")["members.invite"], true);
  assert.equal(defaultPermissions("administrator")["roles.manage"], true);
  assert.equal(defaultPermissions("compliance_admin")["roles.manage"], true);
  assert.equal(defaultPermissions("administrator")["members.assign_roles"], true);
});

test("HR-ROLES: canGrantRole keeps administrator grants with administrators", () => {
  // HR can grant operational roles…
  assert.equal(canGrantRole("hr", "dsp"), true);
  assert.equal(canGrantRole("hr", "house_manager"), true);
  assert.equal(canGrantRole("hr", "hr"), true);
  assert.equal(canGrantRole("hr", "nurse"), true);
  // …but never administrator…
  assert.equal(canGrantRole("hr", "administrator"), false);
  assert.equal(canGrantRole("hr", "compliance_admin"), false);
  // …administrators can grant anything…
  assert.equal(canGrantRole("administrator", "administrator"), true);
  assert.equal(canGrantRole("administrator", "compliance_admin"), true);
  assert.equal(canGrantRole("administrator", "hr"), true);
  // …compliance admins can grant compliance_admin but not administrator…
  assert.equal(canGrantRole("compliance_admin", "compliance_admin"), true);
  assert.equal(canGrantRole("compliance_admin", "administrator"), false);
  assert.equal(canGrantRole("compliance_admin", "dsp"), true);
  // …and unknown targets are rejected.
  assert.equal(canGrantRole("administrator", "superuser"), false);
});
