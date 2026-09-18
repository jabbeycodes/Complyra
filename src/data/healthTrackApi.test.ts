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

async function clientAs(username: string) {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username,
    password: DEMO_PASSWORD,
  });
  const site = store.db.sites.find(
    (s) =>
      s.agencyId === session.agencyId &&
      (session.siteId ? s.id === session.siteId : s.name === "Cedar House"),
  )!;
  const people = store.db.individuals.filter(
    (p) => p.agencyId === session.agencyId && p.siteId === site.id,
  );
  assert.ok(people.length >= 2, "seed needs two individuals at the site");
  return { client, store, session, site, people };
}

/** Rewrite the session's role (e.g. to auditor) mid-test. */
function setRole(store: MemoryStore, userId: string, roleKey: string) {
  const membership = store.db.memberships.find((m) => m.userId === userId);
  assert.ok(membership, "membership must exist");
  membership.roleKey = roleKey;
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

function vitalsInput(individualId: string, vitals: Record<string, number>) {
  return {
    individualId,
    kind: "vitals" as const,
    occurredAt: "2026-09-10T08:00:00",
    details: vitals,
  };
}

test("DSP adds a health entry; row stores recorder + agency + site", async () => {
  const { client, site, people, session } = await clientAs(DEMO_DSP_USERNAME);
  const entry = await client.addHealthEntry(mealInput(people[0].id));
  assert.equal(entry.kind, "meal");
  assert.equal(entry.individualId, people[0].id);
  assert.equal(entry.siteId, site.id);
  assert.equal(entry.agencyId, session.agencyId);
  assert.equal(entry.recordedByUserId, session.userId);
  assert.equal(entry.recordedByName, session.fullName);
  assert.equal(entry.flagForNurse, false);
  assert.ok(entry.id);
});

test("an auditor cannot add a health entry", async () => {
  const { client, store, session, people } = await clientAs(DEMO_DSP_USERNAME);
  setRole(store, session.userId, "auditor");
  await assert.rejects(
    () => client.addHealthEntry(mealInput(people[0].id)),
    /permission/i,
  );
});

test("add rejects invalid input", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  // No vital signs recorded at all.
  await assert.rejects(
    () => client.addHealthEntry(vitalsInput(people[0].id, {})),
    /at least one vital sign/i,
  );
  // Fluid without a drink type.
  await assert.rejects(
    () =>
      client.addHealthEntry({
        individualId: people[0].id,
        kind: "fluid",
        occurredAt: "2026-09-10T09:00:00",
        details: { fluidType: " ", ounces: 8 },
      }),
    /Drink type/,
  );
  // Occurred-at must parse.
  await assert.rejects(
    () =>
      client.addHealthEntry({
        ...mealInput(people[0].id),
        occurredAt: "not-a-date",
      }),
    /valid date and time/i,
  );
});

test("a flagged vitals entry alerts the home's HM directly plus PM and nurse broadcasts", async () => {
  const { client, store, session, site, people } = await clientAs(DEMO_DSP_USERNAME);
  store.db.memberships.push({
    id: "test-hm-1",
    agencyId: session.agencyId,
    userId: "test-hm-user",
    role: "manager",
    roleKey: "house_manager",
    siteId: site.id,
    expiresOn: null,
  });
  const entry = await client.addHealthEntry(
    vitalsInput(people[0].id, { tempF: 102 }),
  );
  assert.equal(entry.flagForNurse, true);
  assert.match(entry.flagReason ?? "", /Fever/);
  const notes = store.db.notifications.filter(
    (n) => n.entityId === entry.id,
  );
  assert.equal(notes.length, 3);
  // The home's house manager gets a direct user alert.
  const direct = notes.filter((n) => n.userId != null);
  assert.equal(direct.length, 1);
  assert.equal(direct[0].userId, "test-hm-user");
  assert.equal(direct[0].roleKey, null);
  // PM and nurse get role broadcasts.
  const broadcastRoles = notes
    .filter((n) => n.userId == null)
    .map((n) => n.roleKey)
    .sort();
  assert.deepEqual(broadcastRoles, ["nurse", "program_manager"]);
  for (const note of notes) {
    assert.equal(note.type, "incident.followup");
    assert.match(note.title, /Health alert/);
  }
  // Dedupe keys are unique per target.
  assert.equal(new Set(notes.map((n) => n.dedupeKey)).size, 3);
});

test("re-flagging an entry does not duplicate manager alerts (dedupe holds)", async () => {
  const { client, store, session, site, people } = await clientAs(DEMO_DSP_USERNAME);
  store.db.memberships.push({
    id: "test-hm-2",
    agencyId: session.agencyId,
    userId: "test-hm-user",
    role: "manager",
    roleKey: "house_manager",
    siteId: site.id,
    expiresOn: null,
  });
  const entry = await client.addHealthEntry(
    vitalsInput(people[0].id, { tempF: 102 }),
  );
  assert.equal(
    store.db.notifications.filter((n) => n.entityId === entry.id).length,
    3,
  );
  // Unflag then re-flag: the queue fires again, but dedupe blocks duplicates.
  await client.updateHealthEntry(entry.id, { details: { tempF: 98.6 } });
  const reflagged = await client.updateHealthEntry(entry.id, {
    details: { tempF: 103 },
  });
  assert.equal(reflagged.flagForNurse, true);
  assert.equal(
    store.db.notifications.filter((n) => n.entityId === entry.id).length,
    3,
  );
});

test("list applies filters", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  const [first, second] = people;
  const meal = await client.addHealthEntry({
    ...mealInput(first.id),
    occurredAt: "2026-09-10T12:30:00",
  });
  await client.addHealthEntry({
    ...mealInput(second.id),
    occurredAt: "2026-09-11T12:30:00",
  });
  const flagged = await client.addHealthEntry({
    ...vitalsInput(first.id, { tempF: 102 }),
    occurredAt: "2026-09-12T08:00:00",
  });

  assert.equal((await client.listHealthEntries({})).length, 3);
  assert.deepEqual(
    (await client.listHealthEntries({ individualId: first.id })).map((e) => e.id).sort(),
    [meal.id, flagged.id].sort(),
  );
  assert.deepEqual(
    (await client.listHealthEntries({ kinds: ["vitals"] })).map((e) => e.id),
    [flagged.id],
  );
  assert.deepEqual(
    (await client.listHealthEntries({ flaggedOnly: true })).map((e) => e.id),
    [flagged.id],
  );
  assert.deepEqual(
    (await client.listHealthEntries({ needsNurseReview: true })).map((e) => e.id),
    [flagged.id],
  );
  const secondEntry = (
    await client.listHealthEntries({ individualId: second.id })
  )[0];
  assert.deepEqual(
    (await client.listHealthEntries({ from: "2026-09-11", to: "2026-09-11" })).map(
      (e) => e.id,
    ),
    [secondEntry.id],
  );
  assert.deepEqual(await client.listHealthEntries({ kinds: ["skin"] }), []);
});

test("update re-flags and pages the nurse on a newly abnormal reading", async () => {
  const { client, store, people } = await clientAs(DEMO_DSP_USERNAME);
  const entry = await client.addHealthEntry(
    vitalsInput(people[0].id, { tempF: 98.6 }),
  );
  assert.equal(entry.flagForNurse, false);
  const updated = await client.updateHealthEntry(entry.id, {
    details: { tempF: 103 },
  });
  assert.equal(updated.flagForNurse, true);
  assert.match(updated.flagReason ?? "", /Fever/);
  const notes = store.db.notifications.filter(
    (n) => n.entityId === entry.id && n.roleKey === "nurse",
  );
  assert.equal(notes.length, 1);
});

test("update validates the merged details", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  const entry = await client.addHealthEntry(mealInput(people[0].id));
  await assert.rejects(
    () =>
      client.updateHealthEntry(entry.id, {
        details: { mealType: "lunch", portion: "most", items: " " },
      }),
    /What was served/,
  );
});

test("nurse marks a flagged entry reviewed; DSP cannot", async () => {
  const dsp = await clientAs(DEMO_DSP_USERNAME);
  const flagged = await dsp.client.addHealthEntry(
    vitalsInput(dsp.people[0].id, { tempF: 102 }),
  );

  // DSP lacks health.review.
  await assert.rejects(
    () => dsp.client.markHealthEntryReviewed(flagged.id, "checking"),
    /permission/i,
  );

  // Nurse reviews on the same seeded agency (separate store, same shape).
  const nurse = await clientAs(DEMO_NURSE_USERNAME);
  const nFlagged = await nurse.client.addHealthEntry(
    vitalsInput(nurse.people[0].id, { tempF: 102 }),
  );
  const reviewed = await nurse.client.markHealthEntryReviewed(
    nFlagged.id,
    "Will monitor temperature.",
  );
  assert.ok(reviewed.nurseReviewedAt);
  assert.equal(reviewed.nurseReviewedBy, nurse.session.fullName);
  assert.equal(reviewed.nurseNote, "Will monitor temperature.");
  assert.deepEqual(
    (await nurse.client.listHealthEntries({ needsNurseReview: true })).map((e) => e.id),
    [],
  );
});

test("reviewing an unflagged entry is rejected", async () => {
  const { client, people } = await clientAs(DEMO_NURSE_USERNAME);
  const entry = await client.addHealthEntry(mealInput(people[0].id));
  await assert.rejects(
    () => client.markHealthEntryReviewed(entry.id, "nothing to see"),
    /Only flagged entries/,
  );
});

test("DSP deletes their entry", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  const entry = await client.addHealthEntry(mealInput(people[0].id));
  await client.deleteHealthEntry(entry.id);
  assert.deepEqual(await client.listHealthEntries({}), []);
  await assert.rejects(() => client.deleteHealthEntry(entry.id), /not found/i);
});

test("an auditor cannot list health entries", async () => {
  const { client, store, session } = await clientAs(DEMO_DSP_USERNAME);
  setRole(store, session.userId, "auditor");
  await assert.rejects(() => client.listHealthEntries({}), /permission/i);
});

test("an administrator can also review a flagged entry", async () => {
  const { client, people, session } = await clientAs(DEMO_ADMIN_USERNAME);
  const flagged = await client.addHealthEntry(
    vitalsInput(people[0].id, { tempF: 102 }),
  );
  const reviewed = await client.markHealthEntryReviewed(flagged.id, "admin check");
  assert.ok(reviewed.nurseReviewedAt);
  assert.equal(reviewed.nurseReviewedBy, session.fullName);
});

test("uploadHealthPhoto validates type and size", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  const text = new File(["hello"], "note.txt", { type: "text/plain" });
  await assert.rejects(() => client.uploadHealthPhoto(people[0].id, text), /PNG or JPEG/);
  const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", {
    type: "image/png",
  });
  await assert.rejects(() => client.uploadHealthPhoto(people[0].id, big), /under 5 MB/);
});

test("uploadHealthPhoto round-trips through getHealthPhoto", async () => {
  const { client, people } = await clientAs(DEMO_DSP_USERNAME);
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const file = new File([bytes], "rash photo.png", { type: "image/png" });
  const fileId = await client.uploadHealthPhoto(people[0].id, file);
  assert.match(fileId, /^health\//);
  const got = await client.getHealthPhoto(fileId);
  assert.ok(got);
  assert.equal(got.name, "rash_photo.png");
  assert.equal(got.blob.type, "image/png");
  assert.deepEqual(new Uint8Array(await got.blob.arrayBuffer()), bytes);
  assert.equal(await client.getHealthPhoto("health/missing"), null);
});

test("an auditor cannot fetch a health photo", async () => {
  const { client, store, session, people } = await clientAs(DEMO_DSP_USERNAME);
  const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
  const fileId = await client.uploadHealthPhoto(people[0].id, file);
  setRole(store, session.userId, "auditor");
  await assert.rejects(() => client.getHealthPhoto(fileId), /permission/i);
});

test("two refused meals in one day alerts the home's HM, PM, and nurse once for very low intake", async () => {
  const { client, store, people, session, site } = await clientAs(DEMO_DSP_USERNAME);
  store.db.memberships.push({
    id: "test-hm-3",
    agencyId: session.agencyId,
    userId: "test-hm-user",
    role: "manager",
    roleKey: "house_manager",
    siteId: site.id,
    expiresOn: null,
  });
  const refused = (mealType: "breakfast" | "lunch") => ({
    individualId: people[0].id,
    kind: "meal" as const,
    occurredAt: `2026-09-10T${mealType === "breakfast" ? "08:00" : "12:30"}:00`,
    details: { mealType, portion: "refused" as const, items: "Oatmeal" },
  });
  const before = store.db.notifications.filter((n) =>
    (n.dedupeKey ?? "").includes("daily-intake"),
  ).length;
  await client.addHealthEntry(refused("breakfast"));
  // First refused meal: per-entry flag only, no day-level alert yet.
  assert.equal(
    store.db.notifications.filter((n) =>
      (n.dedupeKey ?? "").includes("daily-intake"),
    ).length,
    before,
  );
  await client.addHealthEntry(refused("lunch"));
  const after = store.db.notifications.filter((n) =>
    (n.dedupeKey ?? "").includes("daily-intake"),
  );
  assert.equal(after.length, before + 3);
  const roles = after.map((n) => n.roleKey ?? `user:${n.userId}`).sort();
  assert.deepEqual(roles, ["nurse", "program_manager", "user:test-hm-user"]);
  assert.match(after[0].body, /Very low intake/);
  // The same pair is idempotent: a third refused meal does not page again.
  await client.addHealthEntry(refused("breakfast"));
  assert.equal(
    store.db.notifications.filter((n) =>
      (n.dedupeKey ?? "").includes("daily-intake"),
    ).length,
    before + 3,
  );
});
