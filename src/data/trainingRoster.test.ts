import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

/**
 * Wave 7N pins:
 * - Defect 2 (batches 75/76): the clearance roster is the agency's staff
 *   memberships. A member with NO training assigned appears as a
 *   not-cleared row with the "No training assigned yet" reason — the
 *   roster never silently omits the people the Training page exists to
 *   flag. (HostedApi had drifted to a requirements-derived roster; the
 *   hosted half of this contract is pinned in
 *   hostedApi.trainingRoster.test.ts.)
 * - Defect 1 (batches 76/78): LocalApi.resetWorkspace refuses
 *   non-administrator sessions at the data boundary.
 */
function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

test("clearance roster lists every staff member, including one with no training assigned", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);

  // Find a member whose profile has zero training lines.
  let untrainedId: string | null = null;
  for (const person of workspace.staff) {
    const profile = await api.getStaffTrainingProfile(person.id);
    if (profile.requirements.length === 0) {
      untrainedId = person.id;
      break;
    }
  }
  assert.ok(untrainedId, "demo seed has a staff member with no training assigned");

  const rows = await api.listStaffNeedingClearance();
  assert.equal(
    rows.length,
    workspace.staff.length,
    "one roster row per staff member — nobody hidden",
  );
  const untrained = rows.find((row) => row.userId === untrainedId);
  assert.ok(untrained, "the untrained member appears in the roster");
  assert.equal(untrained.clearedForInRatio, false);
  assert.ok(
    untrained.gateReasons.some((reason) => /No training assigned yet/.test(reason)),
    "the row names why they are not cleared",
  );
  // Uncleared rows sort ahead of cleared ones (the page's attention order).
  const firstCleared = rows.findIndex((row) => row.clearedForInRatio);
  const lastUncleared = rows.map((row) => row.clearedForInRatio).lastIndexOf(false);
  assert.ok(firstCleared === -1 || lastUncleared < firstCleared);
});

test("resetWorkspace works for an administrator and refuses a DSP", async () => {
  const adminApi = new LocalApi(store());
  await adminApi.signIn(login(DEMO_ADMIN_USERNAME));
  await adminApi.resetWorkspace();

  const dspApi = new LocalApi(store());
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () => dspApi.resetWorkspace(),
    /Only an administrator can reset the sample workspace/,
  );
});
