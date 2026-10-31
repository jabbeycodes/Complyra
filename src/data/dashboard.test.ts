import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";
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
    queue.every((item) => !item.detail.includes("Willow") || item.kind !== "requirement"),
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

function fakeSession(roleKey: string, siteId: string | null): SessionUser {
  return {
    userId: `user-${roleKey}`,
    email: `${roleKey}@example.invalid`,
    username: roleKey,
    fullName: `Test ${roleKey}`,
    jobTitle: roleKey,
    role: roleKey,
    roleKey,
    agencyId: "agency-1",
    agencyName: "Agency",
    agencyCode: "AGENCY-MO",
    siteId,
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
  } as SessionUser;
}

const fakeSites = [{ id: "site-a" }, { id: "site-b" }];

test("a nurse with a home site is denied the other site; site lists route through assignedSiteIds", () => {
  // Staff scope repair, corrected design (2026-10-31): a NULL membership
  // site does NOT make a nurse or house manager agency-wide (that
  // inference broke the therap nurse reviewer model in CI). Coverage
  // beyond the membership home comes from staff_assignments, enforced
  // in canReadIndividual / private.can_read_site — sitesVisibleTo keeps
  // its existing routing through assignedSiteIds (the session's home
  // site plus the viewer's own staff-row site), pinned here.
  const nurse = fakeSession("nurse", "site-a");
  assert.equal(canAccessSite(nurse, "site-a"), true);
  assert.equal(canAccessSite(nurse, "site-b"), false);
  assert.equal(lockedSiteIdFor(nurse), "site-a");
  assert.deepEqual(
    sitesVisibleTo(nurse, fakeSites, [{ id: nurse.userId, siteId: "site-a" }]).map((site) => site.id),
    ["site-a"],
  );
});

test("Pass 3: assignment sites union into site lists (assignment-only nurse, DSP beyond home)", () => {
  // A nurse with NO membership home whose coverage comes only from
  // staff_assignments sees both assigned sites — and only those
  // (mirrors the assignment branch of private.can_read_site).
  const nurse = fakeSession("nurse", null);
  assert.deepEqual(
    sitesVisibleTo(nurse, fakeSites, [], ["site-a", "site-b"]).map((site) => site.id),
    ["site-a", "site-b"],
  );
  assert.deepEqual(
    sitesVisibleTo(nurse, fakeSites, [], ["site-a"]).map((site) => site.id),
    ["site-a"],
  );
  // An unassigned third site stays hidden.
  const threeSites = [{ id: "site-a" }, { id: "site-b" }, { id: "site-c" }];
  assert.deepEqual(
    sitesVisibleTo(nurse, threeSites, [], ["site-b"]).map((site) => site.id),
    ["site-b"],
  );
  // A DSP's assignment site beyond their membership home becomes visible.
  const dsp = fakeSession("dsp", "site-a");
  assert.deepEqual(
    sitesVisibleTo(dsp, fakeSites, [{ id: dsp.userId, siteId: "site-a" }], ["site-b"]).map((site) => site.id),
    ["site-a", "site-b"],
  );
  // Default (no assignment ids passed) preserves the previous behavior.
  assert.deepEqual(sitesVisibleTo(nurse, fakeSites, []), []);
});

test("Pass 3: LocalApi workspace carries the viewer's active assignment site ids", async () => {
  const client = api();
  const dsp = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspWorkspace = await client.loadWorkspace(dsp);
  // Demo parity: Evergreen DSPs are assigned to every Individual at their
  // home (Cedar House), so their assignmentSiteIds equal their home site —
  // site lists render exactly as before this plumbing existed.
  const cedar = dspWorkspace.sites.find((site) => site.name === "Cedar House")!;
  assert.deepEqual(dspWorkspace.assignmentSiteIds, [cedar.id]);
  assert.deepEqual(
    sitesVisibleTo(dsp, dspWorkspace.sites, dspWorkspace.staff, dspWorkspace.assignmentSiteIds).map((site) => site.name),
    ["Cedar House"],
  );
  // An administrator stays agency-wide regardless of any seed assignments.
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const adminWorkspace = await client.loadWorkspace(admin);
  assert.equal(
    sitesVisibleTo(admin, adminWorkspace.sites, adminWorkspace.staff, adminWorkspace.assignmentSiteIds).length,
    adminWorkspace.sites.length,
  );
});

test("Pass 3: a nurse assigned at a second site (via an Individual) gets both assignment site ids; an ended assignment does not count", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const nurseProfile = store.db.profiles.find((p) => p.username === DEMO_NURSE_USERNAME)!;
  const nurseMembership = store.db.memberships.find((m) => m.userId === nurseProfile.id)!;
  const homeSiteId = nurseMembership.siteId!;
  const otherSite = store.db.sites.find((s) => s.id !== homeSiteId && s.agencyId === nurseMembership.agencyId)!;
  const otherPerson = store.db.individuals.find((p) => p.siteId === otherSite.id)!;
  // Ended assignment at the other site: must NOT contribute.
  store.db.assignments.push({
    id: "test-assignment-ended",
    agencyId: nurseMembership.agencyId,
    userId: nurseProfile.id,
    individualId: otherPerson.id,
    siteId: null,
    startsOn: "2026-01-01",
    endsOn: "2026-06-01",
  });
  const nurse = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  });
  let workspace = await client.loadWorkspace(nurse);
  assert.deepEqual(workspace.assignmentSiteIds, [homeSiteId]);
  // Active Individual assignment at the other site: its site joins the list.
  store.db.assignments.push({
    id: "test-assignment-active",
    agencyId: nurseMembership.agencyId,
    userId: nurseProfile.id,
    individualId: otherPerson.id,
    siteId: null,
    startsOn: "2026-01-01",
    endsOn: null,
  });
  workspace = await client.loadWorkspace(nurse);
  assert.deepEqual(
    [...workspace.assignmentSiteIds].sort(),
    [homeSiteId, otherSite.id].sort(),
  );
});

test("a nurse or house manager with no home site is NOT agency-wide", () => {
  for (const roleKey of ["nurse", "house_manager"]) {
    const session = fakeSession(roleKey, null);
    assert.equal(canAccessSite(session, "site-a"), false);
    assert.equal(canAccessSite(session, "site-b"), false);
    assert.deepEqual(sitesVisibleTo(session, fakeSites, []), []);
  }
});

test("a DSP with no home site is NOT agency-wide", () => {
  const dsp = fakeSession("dsp", null);
  assert.equal(canAccessSite(dsp, "site-a"), false);
  assert.equal(canAccessSite(dsp, "site-b"), false);
  assert.deepEqual(sitesVisibleTo(dsp, fakeSites, []), []);
});
