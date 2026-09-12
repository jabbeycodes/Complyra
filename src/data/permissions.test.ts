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
  assert.equal(
    hasPermission({ role: "hr" }, "individuals.view"),
    false,
  );
});
