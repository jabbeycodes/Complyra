/**
 * trainingOversight.test.ts — simulation batch 25: the Training read
 * gates. A program manager (no hr.view_staff in her role template)
 * must be able to list the staff roster and open a staffer's profile;
 * an HM's roster is scoped to her own homes; a DSP still cannot read
 * anyone else's record.
 *
 * Run: node --import tsx --test src/data/trainingOversight.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import { hasPermission } from "./permissions";

function fixture() {
  const db = createEvergreenSeed();
  const store = new MemoryStore(db);
  const api = new LocalApi(store);
  const byRole = (roleKey: string) =>
    db.memberships.find((m) => m.roleKey === roleKey)!;
  return { db, store, api, byRole };
}

test("PM without hr.view_staff can list the roster and open profiles", async () => {
  const { store, api, byRole } = fixture();
  const pm = byRole("program_manager");
  store.sessionUserId = pm.userId;
  const session = await api.getSession();
  assert.ok(session);
  // Pin the repro condition: the PM template grants no hr.view_staff,
  // so the old gate threw and the page fell back to her own record.
  assert.equal(hasPermission(session, "hr.view_staff"), false);

  const rows = await api.listStaffNeedingClearance();
  assert.ok(rows.length > 0, "roster loads for the PM");
  const dsp = byRole("dsp");
  assert.ok(rows.some((row) => row.userId === dsp.userId));
  const profile = await api.getStaffTrainingProfile(dsp.userId);
  assert.equal(profile.userId, dsp.userId);
});

test("HM roster is scoped to her own homes", async () => {
  const { db, store, api, byRole } = fixture();
  const hm = byRole("house_manager");
  store.sessionUserId = hm.userId;
  const rows = await api.listStaffNeedingClearance();
  const rowIds = new Set(rows.map((row) => row.userId));
  const otherSiteStaff = db.memberships.filter(
    (m) => m.siteId !== null && m.siteId !== hm.siteId,
  );
  assert.ok(otherSiteStaff.length > 0, "seed has staff at another home");
  for (const member of otherSiteStaff) {
    assert.ok(
      !rowIds.has(member.userId),
      `staff from another home (${member.roleKey}) is not on the HM roster`,
    );
  }
  const ownSiteDsp = db.memberships.find(
    (m) => m.roleKey === "dsp" && m.siteId === hm.siteId,
  )!;
  assert.ok(rowIds.has(ownSiteDsp.userId), "her own home's DSP is listed");
  assert.ok(rowIds.has(hm.userId), "the HM herself is listed");
});

test("DSP still cannot read the roster or another staffer's profile", async () => {
  const { store, api, byRole } = fixture();
  const dsp = byRole("dsp");
  const other = byRole("house_manager");
  store.sessionUserId = dsp.userId;
  await assert.rejects(() => api.listStaffNeedingClearance(), /permission/);
  await assert.rejects(() => api.getStaffTrainingProfile(other.userId), /permission/);
  const own = await api.getStaffTrainingProfile(dsp.userId);
  assert.equal(own.userId, dsp.userId);
});
