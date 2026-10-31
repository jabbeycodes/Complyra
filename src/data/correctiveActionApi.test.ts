/**
 * correctiveActionApi.test.ts — corrective-action persistence through the
 * local API: create/assign/update/resolve, permission gating, and the
 * derived overdue status in listings.
 *
 * Run: node --import tsx --test src/data/correctiveActionApi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function adminLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
password: DEMO_PASSWORD
  };
}

function dspLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
password: DEMO_PASSWORD
  };
}

function hmLogin() {
  return { ...dspLogin(), username: DEMO_HM_USERNAME };
}

test("actions api: admin creates, lists, updates, and resolves", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());

  const created = await api.addCorrectiveAction({
    title: "Fix the fire-drill log",
    description: "Add the missing signatures.",
    dueOn: "2026-09-20",
  });
  assert.equal(created.title, "Fix the fire-drill log");
  assert.equal(created.storedStatus, "open");
  assert.equal(created.dueOn, "2026-09-20");

  const listed = await api.listCorrectiveActions();
  assert.ok(listed.some((row) => row.id === created.id));

  const inProgress = await api.updateCorrectiveAction(created.id, {
    storedStatus: "in_progress",
  });
  assert.equal(inProgress.storedStatus, "in_progress");

  const resolved = await api.resolveCorrectiveAction(created.id);
  assert.equal(resolved.storedStatus, "resolved");
  assert.ok(resolved.resolvedAt, "resolve stamps resolved_at");

  const openOnly = await api.listCorrectiveActions({ status: "open" });
  assert.ok(!openOnly.some((row) => row.id === created.id));
  const resolvedOnly = await api.listCorrectiveActions({ status: "resolved" });
  assert.ok(resolvedOnly.some((row) => row.id === created.id));
});

test("actions api: assignee must be an agency member", async () => {
  const mem = store();
  const api = new LocalApi(mem);
  const session = await api.signIn(adminLogin());
  const assignee = mem.db.profiles.find(
    (row) => row.homeAgencyId === session.agencyId && row.id !== session.userId,
  )!;
  const created = await api.addCorrectiveAction({
    title: "Assign this one",
    assignedToUserId: assignee.id,
  });
  assert.equal(created.assignedToUserId, assignee.id);
  assert.equal(created.assignedToName, assignee.fullName);

  await assert.rejects(
    () => api.addCorrectiveAction({ title: "Bad assignee", assignedToUserId: "nope" }),
    /Staff member not found/,
  );
});

test("actions api: validation rejects a blank title", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  await assert.rejects(() => api.addCorrectiveAction({ title: "   " }), /title/i);
});

test("actions api: staff without the permission cannot write", async () => {
  const api = new LocalApi(store());
  await api.signIn(dspLogin());
  await assert.rejects(
    () => api.addCorrectiveAction({ title: "Sneaky" }),
    /permission/i,
  );
  // Reads are agency-member-wide.
  const listed = await api.listCorrectiveActions();
  assert.ok(Array.isArray(listed));
});

test("actions api: house manager can create and resolve (simulation batch 7)", async () => {
  // Batch 7: the HM — the role that owns QA follow-up at a home — could
  // not create a corrective action anywhere. correctiveActions.manage is
  // now in the house_manager pack (permissions.ts + the
  // 20261031170000 seed refresh).
  const api = new LocalApi(store());
  const session = await api.signIn(hmLogin());
  assert.equal(session.roleKey, "house_manager");

  const created = await api.addCorrectiveAction({
    title: "Re-train night shift on incident reporting",
    description: "Raised by the Q3 QA review.",
    dueOn: "2026-10-15",
  });
  assert.equal(created.storedStatus, "open");
  assert.equal(created.createdByUserId, session.userId);

  const listed = await api.listCorrectiveActions();
  assert.ok(
    listed.some((row) => row.id === created.id),
    "the HM sees the action they just created",
  );

  const resolved = await api.resolveCorrectiveAction(created.id);
  assert.equal(resolved.storedStatus, "resolved");
});

// ===== Site scope (reviewer HOLD fix-up, PR #199) =====
// Corrective actions belong to a home: a house manager reaches only
// their own home's actions, assignees must currently work at the home,
// and site-less (agency-level) actions are management-only.

const CEDAR_HM_ID = "00000000-0000-4000-8000-00000000h001";
const CEDAR_HM_USERNAME = "cedar.hm";

/** Seed a second house manager whose home is Cedar House. */
function seedCedarHm(mem: MemoryStore, agencyId: string, cedarSiteId: string) {
  mem.db.profiles.push({
    id: CEDAR_HM_ID,
    fullName: "Carol Cedar",
    email: "cedar.hm@demo.complyrer.user",
    jobTitle: "House Manager",
    username: CEDAR_HM_USERNAME,
    homeAgencyId: agencyId,
    mustChangePassword: false,
  });
  mem.db.memberships.push({
    id: "00000000-0000-4000-8000-00000000h001m",
    agencyId,
    userId: CEDAR_HM_ID,
    role: "manager",
    roleKey: "house_manager",
    siteId: cedarSiteId,
    expiresOn: null,
  });
  mem.db.credentials.push({
    userId: CEDAR_HM_ID,
    email: "cedar.hm@demo.complyrer.user",
    password: DEMO_PASSWORD
  });
}

function siteIdByName(mem: MemoryStore, name: string): string {
  return mem.db.sites.find((row) => row.name === name)!.id;
}

function userIdByUsername(mem: MemoryStore, username: string): string {
  return mem.db.profiles.find((row) => row.username === username)!.id;
}

async function twoHmSetup() {
  const mem = store();
  const probe = new LocalApi(mem);
  const admin = await probe.signIn(adminLogin());
  seedCedarHm(mem, admin.agencyId, siteIdByName(mem, "Cedar House"));
  await probe.signOut();
  return mem;
}

test("site scope: each HM sees and manages only their own home's actions", async () => {
  const mem = await twoHmSetup();
  const api = new LocalApi(mem);

  const cedarSession = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: CEDAR_HM_USERNAME,
    password: DEMO_PASSWORD
  });
  const cedarAction = await api.addCorrectiveAction({
    title: "Cedar: fix the drill log",
    dueOn: "2026-11-15",
  });
  assert.equal(cedarAction.siteId, siteIdByName(mem, "Cedar House"), "creator's home is inferred");
  await api.signOut();

  const willowSession = await api.signIn(hmLogin());
  const willowAction = await api.addCorrectiveAction({
    title: "Willow: re-train night shift",
    dueOn: "2026-11-15",
  });
  assert.equal(willowAction.siteId, siteIdByName(mem, "Willow House"));
  const willowList = await api.listCorrectiveActions();
  assert.ok(willowList.some((row) => row.id === willowAction.id), "own home's action listed");
  assert.ok(
    !willowList.some((row) => row.id === cedarAction.id),
    "the other home's action is NOT listed for this HM",
  );
  await assert.rejects(
    () => api.resolveCorrectiveAction(cedarAction.id),
    /not found/i,
    "an HM cannot resolve another home's action",
  );
  await assert.rejects(
    () => api.updateCorrectiveAction(cedarAction.id, { title: "Hijacked" }),
    /not found/i,
    "an HM cannot edit another home's action",
  );
  const resolved = await api.resolveCorrectiveAction(willowAction.id);
  assert.equal(resolved.storedStatus, "resolved", "own home's action still resolves");
  await api.signOut();

  // A DSP at Willow reads Willow's actions (house team visibility) but
  // never Cedar's.
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "casey.adams",
    password: DEMO_PASSWORD
  });
  const dspList = await api.listCorrectiveActions();
  assert.ok(dspList.some((row) => row.id === willowAction.id), "Willow DSP sees Willow's action");
  assert.ok(!dspList.some((row) => row.id === cedarAction.id), "Willow DSP cannot see Cedar's");
  assert.ok(cedarSession.userId);
  assert.ok(willowSession.userId);
});

test("site scope: assignee must currently work at the action's home", async () => {
  const mem = await twoHmSetup();
  const api = new LocalApi(mem);
  const willow = siteIdByName(mem, "Willow House");
  const willowDsp = userIdByUsername(mem, "jordan.lee");
  const cedarDsp = userIdByUsername(mem, "alex.morgan");

  await api.signIn(hmLogin()); // Willow HM
  const ok = await api.addCorrectiveAction({
    title: "Willow med-count retraining",
    assignedToUserId: willowDsp,
  });
  assert.equal(ok.assignedToUserId, willowDsp);
  assert.equal(ok.siteId, willow);
  await assert.rejects(
    () => api.addCorrectiveAction({ title: "Wrong house", assignedToUserId: cedarDsp }),
    /work at that home/,
    "a Cedar DSP cannot be assigned a Willow action",
  );
  await api.signOut();

  // The rule binds agency management too.
  await api.signIn(adminLogin());
  await assert.rejects(
    () =>
      api.addCorrectiveAction({
        title: "Wrong house, from admin",
        siteId: willow,
        assignedToUserId: cedarDsp,
      }),
    /work at that home/,
  );
  // Reassigning an existing action across homes is refused the same way.
  await assert.rejects(
    () => api.updateCorrectiveAction(ok.id, { assignedToUserId: cedarDsp }),
    /work at that home/,
  );
});

test("site scope: an HM cannot create an action at another home", async () => {
  const mem = await twoHmSetup();
  const api = new LocalApi(mem);
  await api.signIn(hmLogin()); // Willow HM
  await assert.rejects(
    () =>
      api.addCorrectiveAction({
        title: "Cedar action from the Willow HM",
        siteId: siteIdByName(mem, "Cedar House"),
      }),
    /home you manage/,
  );
});

test("site scope: site-less actions are agency-level — management and auditors only", async () => {
  const mem = await twoHmSetup();
  const api = new LocalApi(mem);

  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "melissa.grant", // program manager
    password: DEMO_PASSWORD
  });
  const agencyAction = await api.addCorrectiveAction({
    title: "Agency-wide policy refresh",
  });
  assert.equal(agencyAction.siteId, null, "no site inferred for a manager's unassigned action");
  const pmList = await api.listCorrectiveActions();
  assert.ok(pmList.some((row) => row.id === agencyAction.id), "PM sees the agency-level action");
  await api.signOut();

  await api.signIn(hmLogin()); // Willow HM
  const hmList = await api.listCorrectiveActions();
  assert.ok(
    !hmList.some((row) => row.id === agencyAction.id),
    "an HM does not see agency-level actions",
  );
  await assert.rejects(
    () => api.resolveCorrectiveAction(agencyAction.id),
    /not found/i,
    "an HM cannot resolve an agency-level action",
  );
  await api.signOut();

  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "mark.delaney", // auditor: sees everything, read-only
    password: DEMO_PASSWORD
  });
  const auditorList = await api.listCorrectiveActions();
  assert.ok(
    auditorList.some((row) => row.id === agencyAction.id),
    "the auditor reads agency-level actions",
  );
});

test("site scope: a QA-audit link stamps the audit's home on the action", async () => {
  const mem = store();
  const api = new LocalApi(mem);
  await api.signIn(adminLogin());
  const cedarAudit = mem.db.qaAudits.find(
    (row) => row.siteId === siteIdByName(mem, "Cedar House"),
  )!;
  const created = await api.addCorrectiveAction({
    title: "Follow up the Cedar QA finding",
    qaAuditId: cedarAudit.id,
  });
  assert.equal(created.siteId, cedarAudit.siteId);
  assert.equal(created.qaAuditId, cedarAudit.id);
  await assert.rejects(
    () =>
      api.addCorrectiveAction({
        title: "Mismatched link",
        qaAuditId: cedarAudit.id,
        siteId: siteIdByName(mem, "Willow House"),
      }),
    /must match its QA review/,
  );
});

test("actions api: overdue items sort first in listings", async () => {
  const api = new LocalApi(store());
  await api.signIn(adminLogin());
  const overdue = await api.addCorrectiveAction({ title: "Overdue one", dueOn: "2026-09-01" });
  const later = await api.addCorrectiveAction({ title: "Later one", dueOn: "2026-09-30" });
  const listed = await api.listCorrectiveActions();
  assert.equal(listed[0].id, overdue.id, "past-due action first");
  assert.equal(listed[listed.length - 1].id, later.id, "future action last");
  const overdueOnly = await api.listCorrectiveActions({ status: "overdue" });
  assert.ok(overdueOnly.some((row) => row.id === overdue.id));
});
