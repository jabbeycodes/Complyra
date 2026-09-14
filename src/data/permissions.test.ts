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

// ---------------------------------------------------------------------------
// Workstream 4 — single permission source of truth
// ---------------------------------------------------------------------------
import {
  GRANT_RULES,
  OPERATIONAL_ROLE_KEYS,
  PERMISSION_REGISTRY,
  PRIVILEGED_ROLE_KEYS,
  ROLE_KEYS,
  TEMPLATE_LOCKED_PERMISSIONS,
  assertNoDrift,
  canAssignOperationalRole,
  canEditRoleTemplates,
  checkRoleTemplateUpdate,
  grantableRoleTemplates,
  isTemplatePermissionLocked,
} from "./permissions";

test("WS4: registry covers every permission key with description + derived defaults", () => {
  assert.equal(ROLE_KEYS.length, 9);
  for (const key of PERMISSION_KEYS) {
    const entry = PERMISSION_REGISTRY[key];
    assert.ok(entry, `registry entry for ${key}`);
    assert.equal(entry.key, key);
    assert.ok(entry.description.length > 0, `description for ${key}`);
    // defaultRoles must exactly match the templates that enable the key.
    const expected = ROLE_KEYS.filter(
      (roleKey) => ROLE_TEMPLATE_BY_KEY[roleKey].permissions[key],
    );
    assert.deepEqual(entry.defaultRoles, expected, `defaultRoles for ${key}`);
  }
  // Spot-checks: certificates.manage defaults to HR + compliance_admin;
  // roles.manage to administrator + compliance_admin.
  assert.deepEqual(PERMISSION_REGISTRY["certificates.manage"].defaultRoles, [
    "compliance_admin",
    "hr",
  ]);
  assert.deepEqual(PERMISSION_REGISTRY["roles.manage"].defaultRoles, [
    "administrator",
    "compliance_admin",
  ]);
  // Descriptions mirror PERMISSION_LABELS.
  for (const key of PERMISSION_KEYS) {
    assert.equal(PERMISSION_REGISTRY[key].description, PERMISSION_LABELS[key]);
  }
});

test("WS4: GRANT_RULES data matches canGrantRole behavior", () => {
  assert.deepEqual([...PRIVILEGED_ROLE_KEYS], ["administrator", "compliance_admin"]);
  assert.equal(OPERATIONAL_ROLE_KEYS.length, 7);
  assert.ok(!OPERATIONAL_ROLE_KEYS.includes("administrator"));
  assert.ok(!OPERATIONAL_ROLE_KEYS.includes("compliance_admin"));
  for (const target of ROLE_KEYS) {
    const rule = GRANT_RULES[target];
    for (const granter of ROLE_KEYS) {
      const expected = rule === "any" ? true : rule.includes(granter);
      assert.equal(
        canGrantRole(granter, target),
        expected,
        `canGrantRole(${granter}, ${target})`,
      );
    }
  }
});

test("WS4: grant rules — the required truth table", () => {
  assert.equal(canGrantRole("administrator", "administrator"), true);
  assert.equal(canGrantRole("hr", "administrator"), false);
  assert.equal(canGrantRole("compliance_admin", "compliance_admin"), true);
  assert.equal(canGrantRole("hr", "compliance_admin"), false);
  assert.equal(canGrantRole("dsp", "administrator"), false);
  assert.equal(canGrantRole("dsp", "compliance_admin"), false);
  // Operational grants stay open (permission gates live in the API layer).
  assert.equal(canGrantRole("hr", "dsp"), true);
  assert.equal(canGrantRole("dsp", "nurse"), true);
  assert.equal(canGrantRole(undefined, "dsp"), true);
  assert.equal(canGrantRole("administrator", "nope"), false);
});

test("WS4: canEditRoleTemplates — only administrator / compliance_admin", () => {
  assert.equal(canEditRoleTemplates("administrator"), true);
  assert.equal(canEditRoleTemplates("compliance_admin"), true);
  assert.equal(canEditRoleTemplates("hr"), false);
  assert.equal(canEditRoleTemplates("house_manager"), false);
  assert.equal(canEditRoleTemplates("dsp"), false);
  assert.equal(canEditRoleTemplates("nurse"), false);
  assert.equal(canEditRoleTemplates(undefined), false);
  assert.equal(canEditRoleTemplates("superuser"), false);
});

test("WS4: canAssignOperationalRole — HR path excludes privileged roles", () => {
  assert.equal(canAssignOperationalRole("hr", "dsp"), true);
  assert.equal(canAssignOperationalRole("hr", "house_manager"), true);
  assert.equal(canAssignOperationalRole("hr", "hr"), true);
  assert.equal(canAssignOperationalRole("hr", "administrator"), false);
  assert.equal(canAssignOperationalRole("hr", "compliance_admin"), false);
  assert.equal(canAssignOperationalRole("administrator", "administrator"), false);
  assert.equal(canAssignOperationalRole("administrator", "dsp"), true);
});

test("WS4: grantableRoleTemplates mirrors the inline filters it replaces", () => {
  const hrRoles = grantableRoleTemplates("hr").map((row) => row.key);
  assert.deepEqual(hrRoles, [
    "house_manager",
    "degreed_professional_manager",
    "program_manager",
    "dsp",
    "nurse",
    "hr",
    "auditor",
  ]);
  const adminRoles = grantableRoleTemplates("administrator").map((row) => row.key);
  assert.equal(adminRoles.length, 9);
});

test("WS4: template locks — administrator keeps assign_roles + roles.manage", () => {
  assert.equal(isTemplatePermissionLocked("administrator", "members.assign_roles"), true);
  assert.equal(isTemplatePermissionLocked("administrator", "roles.manage"), true);
  assert.equal(isTemplatePermissionLocked("administrator", "audit.read"), false);
  assert.equal(isTemplatePermissionLocked("hr", "roles.manage"), false);
  assert.deepEqual(TEMPLATE_LOCKED_PERMISSIONS.administrator, [
    "members.assign_roles",
    "roles.manage",
  ]);
  // checkRoleTemplateUpdate returns the exact legacy messages.
  const stripped = {
    ...ROLE_TEMPLATE_BY_KEY.administrator.permissions,
    "members.assign_roles": false,
  } as typeof ROLE_TEMPLATE_BY_KEY.administrator.permissions;
  assert.equal(
    checkRoleTemplateUpdate("administrator", stripped),
    "The administrator role must keep role-assignment access.",
  );
  const stripped2 = {
    ...ROLE_TEMPLATE_BY_KEY.administrator.permissions,
    "roles.manage": false,
  } as typeof ROLE_TEMPLATE_BY_KEY.administrator.permissions;
  assert.equal(
    checkRoleTemplateUpdate("administrator", stripped2),
    "The administrator role must keep role-management access.",
  );
  assert.equal(
    checkRoleTemplateUpdate(
      "administrator",
      ROLE_TEMPLATE_BY_KEY.administrator.permissions,
    ),
    null,
  );
  assert.equal(
    checkRoleTemplateUpdate("hr", ROLE_TEMPLATE_BY_KEY.hr.permissions),
    null,
  );
});

test("WS4: assertNoDrift catches undeclared permission strings", () => {
  assert.doesNotThrow(() => assertNoDrift([...PERMISSION_KEYS]));
  assert.throws(() => assertNoDrift(["members.invite", "bogus.key"]), /bogus\.key/);
});

test("AUDIT-READINESS: correctiveActions.manage defaults — managers on, field staff off", () => {
  assert.ok(PERMISSION_KEYS.includes("correctiveActions.manage"));
  assert.equal(PERMISSION_LABELS["correctiveActions.manage"], "Manage corrective actions");
  // Granted: administrator, compliance_admin, degreed_professional_manager, program_manager.
  assert.equal(defaultPermissions("administrator")["correctiveActions.manage"], true);
  assert.equal(defaultPermissions("compliance_admin")["correctiveActions.manage"], true);
  assert.equal(
    defaultPermissions("degreed_professional_manager")["correctiveActions.manage"],
    true,
  );
  assert.equal(defaultPermissions("program_manager")["correctiveActions.manage"], true);
  // Not granted: house_manager, dsp, nurse, hr, auditor.
  assert.equal(defaultPermissions("house_manager")["correctiveActions.manage"], false);
  assert.equal(defaultPermissions("dsp")["correctiveActions.manage"], false);
  assert.equal(defaultPermissions("nurse")["correctiveActions.manage"], false);
  assert.equal(defaultPermissions("hr")["correctiveActions.manage"], false);
  assert.equal(defaultPermissions("auditor")["correctiveActions.manage"], false);
  // hasPermission honors it from both session packs and role templates.
  assert.equal(
    hasPermission({ permissions: { "correctiveActions.manage": true } }, "correctiveActions.manage"),
    true,
  );
  assert.equal(
    hasPermission({ role: "program_manager" }, "correctiveActions.manage"),
    true,
  );
  assert.equal(hasPermission({ role: "house_manager" }, "correctiveActions.manage"), false);
});
