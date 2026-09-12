import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_TEMPLATE_BY_KEY,
  capabilityForRoleKey,
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
