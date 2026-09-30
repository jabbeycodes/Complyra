/**
 * healthTrackSecurity.test.ts — security remediation tests for Health Track
 * (PR-review follow-up, 2026-09-19).
 *
 * Covers: alert-delivery failure visibility + retry (outbox ledger), review
 * notes that cannot be empty, site isolation (DSP/HM/PM/nurse stay at their
 * own sites), auditor agency-wide READ-ONLY access (entries + photos, no
 * writes/reviews/alerts), HR exclusion, photo path binding, void-never-delete,
 * and the surviving review obligation.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_ADMIN_USERNAME,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import type { NotificationPayload } from "./healthTrack";

async function clientAs(username: string, store?: MemoryStore) {
  const mem = store ?? new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(mem);
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username,
password: DEMO_PASSWORD,
  });
  const site = mem.db.sites.find(
    (s) =>
      s.agencyId === session.agencyId &&
      (session.siteId ? s.id === session.siteId : s.name === "Cedar House"),
  )!;
  const people = mem.db.individuals.filter(
    (p) => p.agencyId === session.agencyId && p.siteId === site.id,
  );
  return { client, store: mem, session, site, people };
}

function setRole(store: MemoryStore, userId: string, roleKey: string) {
  const membership = store.db.memberships.find((m) => m.userId === userId);
  assert.ok(membership, "membership must exist");
  membership.roleKey = roleKey;
}

function vitalsInput(individualId: string, vitals: Record<string, number>) {
  return {
    individualId,
    kind: "vitals" as const,
    occurredAt: "2026-09-10T08:00:00",
    details: vitals,
  };
}

function mealInput(individualId: string) {
  return {
    individualId,
    kind: "meal" as const,
    occurredAt: "2026-09-10T12:30:00",
    details: {
      mealType: "lunch" as const,
      portion: "most" as const,
      items: "Chicken and rice",
    },
  };
}

/** A LocalApi whose notification delivery can be forced to fail. */
class FlakyApi extends LocalApi {
  failWhen: ((payload: NotificationPayload) => boolean) | null = null;
  protected override deliverNotificationPayload(payload: NotificationPayload): void {
    if (this.failWhen?.(payload)) {
      throw new Error("notify-event exploded");
    }
    super.deliverNotificationPayload(payload);
  }
}

async function flakyClientAs(store: MemoryStore) {
  // The store already has a signed-in session; a second client over the same
  // store shares it.
  return new FlakyApi(store);
}

test("failed alert deliveries stay visible on the entry and outbox — never silently swallowed", async () => {
  const { store, session, site, people } = await clientAs(DEMO_DSP_USERNAME);
  store.db.memberships.push({
    id: "sec-hm-1",
    agencyId: session.agencyId,
    userId: "sec-hm-user",
    role: "manager",
    roleKey: "house_manager",
    siteId: site.id,
    expiresOn: null,
  });
  const client = await flakyClientAs(store);
  client.failWhen = () => true; // every target fails

  const entry = await client.addHealthEntry(vitalsInput(people[0].id, { tempF: 102 }));
  assert.equal(entry.flagForNurse, true);
  // Nothing was delivered, so no notifications exist…
  assert.equal(
    store.db.notifications.filter((n) => n.entityId === entry.id).length,
    0,
  );
  // …but the failure is visible: entry-level status + per-target ledger.
  assert.equal(entry.alertDelivery, "failed");
  assert.match(entry.alertDeliveryError ?? "", /exploded/);
  const outbox = await client.listHealthAlertOutbox(entry.id);
  assert.equal(outbox.length, 3);
  for (const item of outbox) {
    assert.equal(item.status, "failed");
    assert.equal(item.attempts, 1);
    assert.match(item.lastError ?? "", /exploded/);
  }
  // Targets still cover the home's HM directly + PM and nurse broadcasts.
  const direct = outbox.filter((i) => i.targetUserId);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].targetUserId, "sec-hm-user");
  assert.deepEqual(
    outbox.filter((i) => !i.targetUserId).map((i) => i.targetRoleKey).sort(),
    ["nurse", "program_manager"],
  );

  // Retry with delivery working: status moves to ok, attempts accumulate.
  client.failWhen = null;
  const retried = await client.retryHealthAlerts(entry.id);
  assert.equal(retried.alertDelivery, "ok");
  assert.equal(retried.alertDeliveryError, null);
  const after = await client.listHealthAlertOutbox(entry.id);
  assert.ok(after.every((i) => i.status === "sent" && i.attempts === 2));
  assert.equal(
    store.db.notifications.filter((n) => n.entityId === entry.id).length,
    3,
  );
  // Nothing left to retry.
  await assert.rejects(() => client.retryHealthAlerts(entry.id), /no failed/i);
});

test("partial delivery is reported as partial and only failures retry", async () => {
  const { store, session, site, people } = await clientAs(DEMO_DSP_USERNAME);
  store.db.memberships.push({
    id: "sec-hm-2",
    agencyId: session.agencyId,
    userId: "sec-hm-user",
    role: "manager",
    roleKey: "house_manager",
    siteId: site.id,
    expiresOn: null,
  });
  const client = await flakyClientAs(store);
  client.failWhen = (payload) => payload.roleKey === "program_manager";

  const entry = await client.addHealthEntry(vitalsInput(people[0].id, { tempF: 102 }));
  assert.equal(entry.alertDelivery, "partial");
  const outbox = await client.listHealthAlertOutbox(entry.id);
  assert.equal(outbox.filter((i) => i.status === "sent").length, 2);
  assert.equal(outbox.filter((i) => i.status === "failed").length, 1);

  client.failWhen = null;
  const retried = await client.retryHealthAlerts(entry.id);
  assert.equal(retried.alertDelivery, "ok");
});

test("an abnormal entry corrected to normal stays flagged until explicitly reviewed", async () => {
  const nurse = await clientAs(DEMO_NURSE_USERNAME);
  const flagged = await nurse.client.addHealthEntry(
    vitalsInput(nurse.people[0].id, { tempF: 102 }),
  );
  assert.deepEqual(
    (await nurse.client.listHealthEntries({ needsNurseReview: true })).map((e) => e.id),
    [flagged.id],
  );
  // Correct the reading down to a normal value, with a reason.
  const corrected = await nurse.client.updateHealthEntry(flagged.id, {
    details: { tempF: 98.6 },
    reason: "rechecked with a second thermometer",
  });
  assert.equal(corrected.flagForNurse, true, "review obligation survives the correction");
  assert.match(corrected.flagReason ?? "", /Fever/);
  assert.deepEqual(
    (await nurse.client.listHealthEntries({ needsNurseReview: true })).map((e) => e.id),
    [flagged.id],
  );
  // Only an explicit, noted review clears it.
  await nurse.client.markHealthEntryReviewed(flagged.id, "Rechecked — afebrile now.");
  assert.deepEqual(await nurse.client.listHealthEntries({ needsNurseReview: true }), []);
});

test("empty review notes are rejected", async () => {
  const { client, people } = await clientAs(DEMO_NURSE_USERNAME);
  const flagged = await client.addHealthEntry(vitalsInput(people[0].id, { tempF: 102 }));
  for (const note of ["", "   ", "x"]) {
    await assert.rejects(
      () => client.markHealthEntryReviewed(flagged.id, note),
      /auditable/i,
      `note ${JSON.stringify(note)} must be rejected`,
    );
  }
  assert.equal((await client.getHealthEntry(flagged.id)).nurseReviewedAt, null);
});

test("site A staff cannot read site B entries or photos", async () => {
  const admin = await clientAs(DEMO_ADMIN_USERNAME);
  // A second program site with its own individual.
  const siteB = { ...admin.site, id: "sec-site-b", name: "Birch House" };
  admin.store.db.sites.push(siteB);
  const personB = {
    ...admin.people[0],
    id: "sec-person-b",
    siteId: siteB.id,
    fullName: "Robin Birch",
  };
  admin.store.db.individuals.push(personB);
  const entryB = await admin.client.addHealthEntry(mealInput(personB.id));
  assert.equal(entryB.siteId, siteB.id);

  // DSP is locked to Cedar House (site A).
  const dspStore = admin.store;
  const dsp = new LocalApi(dspStore);
  await dsp.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
password: DEMO_PASSWORD,
  });
  const visible = await dsp.listHealthEntries({});
  assert.ok(
    visible.every((e) => e.siteId !== siteB.id),
    "site B rows must not leak into site A lists",
  );
  await assert.rejects(() => dsp.getHealthEntry(entryB.id), /not found/i);

  // Photos are bound the same way: a site B path is rejected for site A staff.
  const pathB = `${admin.session.agencyId}/${personB.id}/abc-photo.png`;
  await assert.rejects(() => dsp.getHealthPhoto(pathB), /site you can manage/i);
  // And a forged path for a site A individual the DSP cannot reach is rejected too.
  await assert.rejects(
    () => dsp.getHealthPhoto(`${admin.session.agencyId}/no-such-person/x.png`),
    /not found|Individual not found/i,
  );
});

test("auditor CAN retrieve site B records/photos read-only, and cannot write or review", async () => {
  const admin = await clientAs(DEMO_ADMIN_USERNAME);
  // A second program site with its own individual, entry, and photo.
  const siteB = { ...admin.site, id: "sec-site-b2", name: "Birch House" };
  admin.store.db.sites.push(siteB);
  const personB = {
    ...admin.people[0],
    id: "sec-person-b2",
    siteId: siteB.id,
    fullName: "Robin Birch",
  };
  admin.store.db.individuals.push(personB);
  const entryB = await admin.client.addHealthEntry(mealInput(personB.id));
  const flaggedB = await admin.client.addHealthEntry(
    vitalsInput(personB.id, { tempF: 102 }),
  );
  const photoFile = new File([new Uint8Array([7])], "site-b.png", {
    type: "image/png",
  });
  const photoB = await admin.client.uploadHealthPhoto(personB.id, photoFile);
  // Alert fan-out never targets auditors: no auditor role broadcast.
  const outboxB = await admin.client.listHealthAlertOutbox(flaggedB.id);
  assert.ok(outboxB.length > 0);
  assert.ok(
    outboxB.every((item) => item.targetRoleKey !== "auditor"),
    "alerts never broadcast to the auditor role",
  );

  // Auditor session over the same store (sign in as the DSP user, then
  // rewrite their role — the same pattern the other tests use).
  const auditorClient = new LocalApi(admin.store);
  const auditorSession = await auditorClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  setRole(admin.store, auditorSession.userId, "auditor");

  // Agency-wide reads: site B rows are visible, exempt from site scoping.
  const listed = await auditorClient.listHealthEntries({});
  assert.ok(
    listed.some((e) => e.id === entryB.id),
    "auditor sees site B entries",
  );
  assert.equal((await auditorClient.getHealthEntry(entryB.id)).id, entryB.id);
  assert.ok(
    (await auditorClient.listHealthEntries({ needsNurseReview: true })).some(
      (e) => e.id === flaggedB.id,
    ),
    "auditor sees flagged entries too",
  );
  assert.ok(
    await auditorClient.getHealthPhoto(photoB),
    "auditor reads site B photos",
  );
  assert.ok(
    (await auditorClient.listHealthEntryRevisions(entryB.id)).length >= 1,
  );
  // Every write, review, and upload action stays blocked.
  await assert.rejects(
    () => auditorClient.addHealthEntry(mealInput(personB.id)),
    /permission/i,
  );
  await assert.rejects(
    () =>
      auditorClient.updateHealthEntry(entryB.id, {
        details: { mealType: "lunch", portion: "all", items: "x" },
        reason: "auditor attempt",
      }),
    /permission/i,
  );
  await assert.rejects(
    () => auditorClient.markHealthEntryReviewed(flaggedB.id, "auditor note"),
    /permission/i,
  );
  await assert.rejects(
    () => auditorClient.voidHealthEntry(entryB.id, "auditor void"),
    /permission/i,
  );
  await assert.rejects(
    () => auditorClient.uploadHealthPhoto(personB.id, photoFile),
    /permission/i,
  );
});

test("HR cannot read health entries or photos", async () => {
  const { client, store, session, people } = await clientAs(DEMO_DSP_USERNAME);
  const entry = await client.addHealthEntry(mealInput(people[0].id));
  const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
  const fileId = await client.uploadHealthPhoto(people[0].id, file);
  setRole(store, session.userId, "hr");
  await assert.rejects(() => client.listHealthEntries({}), /permission/i);
  await assert.rejects(() => client.getHealthEntry(entry.id), /permission/i);
  await assert.rejects(() => client.getHealthPhoto(fileId), /permission/i);
  await assert.rejects(
    () => client.listHealthEntryRevisions(entry.id),
    /permission/i,
  );
});

test("photo attach binds the path to the entry's own agency + individual", async () => {
  const { client, session, people } = await clientAs(DEMO_DSP_USERNAME);
  const [first, second] = people;
  const skinA = await client.addHealthEntry({
    individualId: first.id,
    kind: "skin",
    occurredAt: "2026-09-10T09:00:00",
    details: {
      bodyLocation: "Left forearm",
      observation: "redness",
      description: "Red patch",
      worsening: false,
    },
  });
  const skinB = await client.addHealthEntry({
    individualId: second.id,
    kind: "skin",
    occurredAt: "2026-09-10T09:00:00",
    details: {
      bodyLocation: "Right knee",
      observation: "redness",
      description: "Red patch",
      worsening: false,
    },
  });
  const file = new File([new Uint8Array([1, 2, 3])], "rash.png", {
    type: "image/png",
  });
  const pathA = await client.uploadHealthPhoto(first.id, file);
  // Attaching A's photo to B's entry is rejected.
  await assert.rejects(
    () => client.attachHealthPhoto(skinB.id, pathA),
    /does not belong/i,
  );
  // A forged cross-agency path is rejected too.
  await assert.rejects(
    () => client.attachHealthPhoto(skinA.id, `other-agency/${first.id}/x.png`),
    /does not belong/i,
  );
  // The right pairing attaches.
  const attached = await client.attachHealthPhoto(skinA.id, pathA);
  assert.equal(
    (attached.details as { photoId?: string }).photoId,
    pathA,
  );
  const trail = await client.listHealthEntryRevisions(skinA.id);
  assert.ok(trail.some((r) => r.action === "amended" && r.reason === "Photo attached"));
});

test("orphaned uploads can be cleaned up with deleteHealthPhoto", async () => {
  const { client, session, people } = await clientAs(DEMO_DSP_USERNAME);
  const file = new File([new Uint8Array([9])], "orphan.png", { type: "image/png" });
  const path = await client.uploadHealthPhoto(people[0].id, file);
  await client.deleteHealthPhoto(path);
  assert.equal(await client.getHealthPhoto(path), null);
  // Foreign paths cannot be deleted through this API.
  await assert.rejects(
    () => client.deleteHealthPhoto(`other-agency/${people[0].id}/x.png`),
    /does not belong/i,
  );
  void session;
});
