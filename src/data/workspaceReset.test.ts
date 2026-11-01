import { test } from "node:test";
import assert from "node:assert/strict";
import { canResetSampleWorkspace } from "./workspaceReset";

/**
 * Wave 7N, defect 1 (simulation batches 76/78): the workspace reset is a
 * destructive workspace-level control. Pin the full role × mode matrix —
 * only an administrator in the local/demo workspace may see it; hosted
 * mode and every other role get nothing (the control does not render).
 */
const ROLE_KEYS = [
  "administrator",
  "program_manager",
  "house_manager",
  "dsp",
  "nurse",
  "hr",
  "compliance_admin",
  "auditor",
] as const;

test("workspace reset matrix: administrator + local mode only", () => {
  for (const roleKey of ROLE_KEYS) {
    const session = { roleKey };
    assert.equal(
      canResetSampleWorkspace(session, false),
      roleKey === "administrator",
      `local mode, role ${roleKey}`,
    );
    assert.equal(
      canResetSampleWorkspace(session, true),
      false,
      `hosted mode, role ${roleKey}`,
    );
  }
});

test("workspace reset matrix: no session never sees the reset", () => {
  assert.equal(canResetSampleWorkspace(null, false), false);
  assert.equal(canResetSampleWorkspace(undefined, false), false);
  assert.equal(canResetSampleWorkspace(null, true), false);
});
