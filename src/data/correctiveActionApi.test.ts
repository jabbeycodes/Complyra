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
