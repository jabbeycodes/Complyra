import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  individualsAtSite,
  isAgencyWideViewer,
  canAccessSite,
  lockedSiteIdFor,
  personalQueue,
  sitesVisibleTo,
} from "./dashboard";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

test("agency-wide roles see every site; site-scoped staff only see assigned homes", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const adminWorkspace = await client.loadWorkspace(admin);
  assert.equal(isAgencyWideViewer(admin), true);
  assert.equal(
    sitesVisibleTo(admin, adminWorkspace.sites, adminWorkspace.staff).length,
    adminWorkspace.sites.length,
  );
  assert.ok(adminWorkspace.sites.length >= 2);

  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspWorkspace = await client.loadWorkspace(dsp);
  assert.equal(isAgencyWideViewer(dsp), false);
  const dspSites = sitesVisibleTo(dsp, dspWorkspace.sites, dspWorkspace.staff);
  assert.deepEqual(
    dspSites.map((site) => site.name),
    ["Cedar House"],
  );

  const hm = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const hmWorkspace = await client.loadWorkspace(hm);
  assert.deepEqual(
    sitesVisibleTo(hm, hmWorkspace.sites, hmWorkspace.staff).map((site) => site.name),
    ["Willow House"],
  );
});

test("personal queue lists work owned by or assigned to the signed-in user", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(dsp);
  const queue = personalQueue({
    session: dsp,
    items: workspace.requirements,
    packets: workspace.packets,
    planStacks: workspace.planStacks,
    canApprove: false,
  });
  assert.ok(queue.length > 0);
  assert.ok(queue.some((item) => item.title.includes("PCSP") || item.kind === "acknowledgment"));
  assert.ok(queue.some((item) => item.kind === "training" || item.kind === "requirement"));
  assert.equal(
    queue.every((item) => !item.detail.includes("Oakwood") || item.kind !== "requirement"),
    true,
  );

  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const adminWorkspace = await client.loadWorkspace(admin);
  const adminQueue = personalQueue({
    session: admin,
    items: adminWorkspace.requirements,
    packets: adminWorkspace.packets,
    planStacks: adminWorkspace.planStacks,
    canApprove: true,
  });
  assert.ok(
    adminQueue.some(
      (item) =>
        item.kind === "review" || item.title.includes("emergency drill"),
    ),
  );
});

test("individualsAtSite keeps Cedar people off a Willow list", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(admin);
  const cedar = workspace.sites.find((site) => site.name === "Cedar House")!;
  const willow = workspace.sites.find((site) => site.name === "Willow House")!;
  const cedarPeople = individualsAtSite(workspace.individuals, cedar);
  const willowPeople = individualsAtSite(workspace.individuals, willow);
  assert.equal(cedarPeople.length, 2);
  assert.equal(willowPeople.length, 2);
  assert.deepEqual(
    cedarPeople.map((row) => row.name).sort(),
    ["Ellis Hart", "Morgan Pruitt"],
  );
  assert.deepEqual(
    willowPeople.map((row) => row.name).sort(),
    ["Harper Soto", "Reese Lang"],
  );
  assert.deepEqual(individualsAtSite(workspace.individuals, undefined), []);
});

test("site-scoped staff are locked to their home site; admins are not", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const adminWorkspace = await client.loadWorkspace(admin);
  const maple = adminWorkspace.sites.find((site) => site.name === "Cedar House")!;
  const oakwood = adminWorkspace.sites.find((site) => site.name === "Willow House")!;
  assert.equal(canAccessSite(admin, maple.id), true);
  assert.equal(canAccessSite(admin, oakwood.id), true);
  assert.equal(lockedSiteIdFor(admin), null);

  const hm = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  assert.equal(canAccessSite(hm, oakwood.id), true);
  assert.equal(canAccessSite(hm, maple.id), false);
  assert.equal(lockedSiteIdFor(hm), oakwood.id);
});
