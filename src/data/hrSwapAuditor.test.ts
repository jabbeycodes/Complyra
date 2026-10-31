/**
 * Wave 6 item 3a: auditors are read-only — the HrStore itself refuses
 * shift-swap writes for an auditor session (the swap board also hides
 * the actions, but the store is the backstop). A non-auditor store must
 * NOT produce the read-only refusal.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHrStore } from "./hrStore";

const AGENCY = "agency-swap-auditor-test";

function auditorStore() {
  return createHrStore({ agencyId: AGENCY, userId: "user-auditor", roleKey: "auditor" });
}

describe("auditor shift-swap writes are refused in the store", () => {
  test("createShiftSwap refuses", async () => {
    await assert.rejects(
      () => auditorStore().createShiftSwap({ offeredShiftId: "shift-1" }),
      /Auditors are read-only/,
    );
  });

  test("claimShiftSwap refuses", async () => {
    await assert.rejects(
      () => auditorStore().claimShiftSwap("swap-1", "user-auditor"),
      /Auditors are read-only/,
    );
  });

  test("decideShiftSwap refuses", async () => {
    await assert.rejects(
      () => auditorStore().decideShiftSwap("swap-1", true, "user-auditor"),
      /Auditors are read-only/,
    );
  });

  test("cancelShiftSwap refuses", async () => {
    await assert.rejects(
      () => auditorStore().cancelShiftSwap("swap-1"),
      /Auditors are read-only/,
    );
  });

  test("a DSP store does not produce the read-only refusal", async () => {
    const dsp = createHrStore({ agencyId: AGENCY, userId: "user-dsp", roleKey: "dsp" });
    await assert.rejects(
      () => dsp.createShiftSwap({ offeredShiftId: "no-such-shift" }),
      (err: Error) => {
        assert.ok(!/Auditors are read-only/.test(err.message), "not the auditor refusal");
        return true;
      },
    );
  });
});
