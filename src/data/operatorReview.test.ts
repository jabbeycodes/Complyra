import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_AGENCY_CODE, DEMO_ADMIN_USERNAME } from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ROLE_TEMPLATES } from "./permissions";

export async function operatorFixture() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  await api.signIn({ agencyCode: "COMPLYRER-MO", username: "platform.owner", password: DEMO_PASSWORD });
  return { store, api };
}
test("all agency roles including administrator are denied operator review", async () => {
  for (const template of ROLE_TEMPLATES) {
    const { store, api } = await operatorFixture();
    const profile = store.db.profiles.find((p) => p.username === DEMO_ADMIN_USERNAME)!;
    const membership = store.db.memberships.find((m) => m.userId === profile.id)!;
    membership.roleKey = template.key; membership.role = template.capability;
    await api.signIn({ agencyCode: DEMO_AGENCY_CODE, username: DEMO_ADMIN_USERNAME, password: DEMO_PASSWORD });
    await assert.rejects(api.setAgencyStatus(store.db.agencies[0].id, "active", "Review"), /operator/i);
    await assert.rejects(api.listAgencies(), /operator/i);
    await assert.rejects(api.listPendingAgencies(), /operator/i);
  }
});
test("review validates transition/reason/concurrency and attributes lifecycle event", async () => {
  const { store, api } = await operatorFixture();
  await api.createAgency({ name:"Review test", stateCode:"MO", slug:"reviewtest", adminFullName:"Review Admin", adminUsername:"review.admin", adminTempPassword:"TempPass!1", provisionedBy:"self" });
  const agency = (await api.listPendingAgencies()).find((a) => a.agencyCode === "REVIEWTEST-MO")!;
  await assert.rejects(api.setAgencyStatus(agency.id, "active", " "), /reason/i);
  await assert.rejects(api.setAgencyStatus(agency.id, "active", "Reviewed", "rejected"), /changed/i);
  await api.setAgencyStatus(agency.id, "active", "Verified provider", "pending");
  const event = store.db.operatorLifecycle!.at(-1)!;
  assert.equal(event.fromStatus, "pending"); assert.equal(event.toStatus, "active");
  assert.equal(event.reason, "Verified provider"); assert.equal(event.actorId, store.sessionUserId);
  await assert.rejects(api.setAgencyStatus(agency.id, "active", "Repeat"), /transition/i);
  assert.equal(store.db.operatorLifecycle!.length, 1);
});
