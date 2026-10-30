import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { centralTodayIso } from "./menuRecords";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function sites(api: LocalApi) {
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const cedar = workspace.sites.find((s) => s.name === "Cedar House")!;
  const willow = workspace.sites.find((s) => s.name === "Willow House")!;
  const ellis = workspace.individuals.find((i) => i.name === "Ellis Hart")!;
  await api.signOut();
  return { cedar, willow, ellis };
}

const today = () => centralTodayIso();
const thisMonth = () => centralTodayIso().slice(0, 7);

test("DSP records at their own home and is refused at the other home", async () => {
  const api = new LocalApi(store());
  const { cedar, willow, ellis } = await sites(api);
  await api.signIn(login(DEMO_DSP_USERNAME)); // Alex Morgan, Cedar DSP

  const created = await api.createHouseCardEntry({
    siteId: cedar.id,
    entryDate: today(),
    kind: "purchase",
    location: "Shell",
    amountCents: 4200,
    category: "gas",
    individualId: ellis.id,
  });
  assert.equal(created.recordedByName, "Alex Morgan");
  assert.equal(created.individualName, "Ellis Hart");

  const cedarEntries = await api.listHouseCardEntries(cedar.id);
  assert.ok(cedarEntries.some((entry) => entry.id === created.id));

  await assert.rejects(() => api.listHouseCardEntries(willow.id));
  await assert.rejects(() =>
    api.createHouseCardEntry({
      siteId: willow.id,
      entryDate: today(),
      kind: "credit",
      location: "",
      amountCents: 1000,
    }),
  );
  // A DSP is not a closer.
  await assert.rejects(() =>
    api.closeHouseCardMonth({
      siteId: cedar.id,
      month: thisMonth(),
      signatureText: "Alex Morgan",
    }),
  );
});

test("nurse cannot see the house card at all", async () => {
  const api = new LocalApi(store());
  const { cedar } = await sites(api);
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(() => api.listHouseCardEntries(cedar.id), /permission/i);
  await assert.rejects(() =>
    api.createHouseCardEntry({
      siteId: cedar.id,
      entryDate: today(),
      kind: "credit",
      location: "",
      amountCents: 1000,
    }),
    /permission/i,
  );
});

test("auditor reads and prints but cannot record, void, or close", async () => {
  const db = store();
  const api = new LocalApi(db);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const { cedar } = await sites(api);

  // Seed an auditor directly (the Evergreen demo ships no auditor user).
  const auditorId = "00000000-0000-4000-8000-0000000000au";
  db.db.profiles.push({
    id: auditorId,
    fullName: "Uma Auditor",
    email: "uma.auditor@demo.complyrer.user",
    jobTitle: "Auditor",
    username: "uma.auditor",
    homeAgencyId: admin.agencyId,
    mustChangePassword: false,
  });
  db.db.memberships.push({
    id: "00000000-0000-4000-8000-000000000aum",
    agencyId: admin.agencyId,
    userId: auditorId,
    role: "auditor",
    roleKey: "auditor",
    siteId: null,
    expiresOn: null,
  });
  db.db.credentials.push({
    userId: auditorId,
    email: "uma.auditor@demo.complyrer.user",
    password: DEMO_PASSWORD,
  });
  await api.signOut();

  const session = await api.signIn(login("uma.auditor"));
  assert.equal(session.roleKey, "auditor");
  const entries = await api.listHouseCardEntries(cedar.id);
  assert.ok(entries.length > 0, "auditor sees the seeded ledger");
  const closes = await api.listHouseCardMonthCloses(cedar.id);
  assert.deepEqual(closes, []);

  await assert.rejects(
    () =>
      api.createHouseCardEntry({
        siteId: cedar.id,
        entryDate: today(),
        kind: "credit",
        location: "",
        amountCents: 1000,
      }),
    /permission/i,
  );
  await assert.rejects(
    () => api.voidHouseCardEntry(entries[0].id, "Auditor fix."),
    /permission/i,
  );
  await assert.rejects(
    () =>
      api.closeHouseCardMonth({
        siteId: cedar.id,
        month: thisMonth(),
        signatureText: "Uma Auditor",
      }),
    /permission/i,
  );
});

test("closed month refuses new entries; void/replace stays open as a post-close correction", async () => {
  const api = new LocalApi(store());
  const { willow, cedar } = await sites(api);
  const hm = await api.signIn(login(DEMO_HM_USERNAME)); // James Wilson, Willow HM
  assert.equal(hm.roleKey, "house_manager");

  // The HM's scope is his own home only.
  await assert.rejects(() =>
    api.closeHouseCardMonth({
      siteId: cedar.id,
      month: thisMonth(),
      signatureText: "James Wilson",
    }),
  );

  const before = await api.listHouseCardEntries(willow.id);
  const target = before.find(
    (entry) => !entry.voided && entry.kind === "purchase",
  )!;
  assert.ok(target);

  const close = await api.closeHouseCardMonth({
    siteId: willow.id,
    month: thisMonth(),
    signatureText: "James Wilson",
  });
  assert.equal(close.printedName, "James Wilson");
  assert.equal(close.signedByName, "James Wilson");
  assert.ok(close.closingBalanceCents > 0);

  // No second close for the same month.
  await assert.rejects(() =>
    api.closeHouseCardMonth({
      siteId: willow.id,
      month: thisMonth(),
      signatureText: "James Wilson",
    }),
    /already closed/i,
  );

  // A brand-new entry dated into the signed month is refused, clearly.
  await assert.rejects(
    () =>
      api.createHouseCardEntry({
        siteId: willow.id,
        entryDate: today(),
        kind: "credit",
        location: "",
        amountCents: 5000,
      }),
    /closed and signed/i,
  );

  // But voiding with a replacement still works, and both sides of the
  // correction are marked as post-close corrections.
  const { voided, replacement } = await api.voidHouseCardEntry(
    target.id,
    "Receipt total was read wrong.",
    {
      siteId: willow.id,
      entryDate: target.entryDate,
      kind: target.kind,
      location: target.location,
      amountCents: target.amountCents + 100,
      category: target.category,
      individualId: target.individualId,
      note: target.note,
    },
  );
  assert.equal(voided.voided, true);
  assert.equal(voided.postCloseCorrection, true);
  assert.ok(replacement);
  assert.equal(replacement!.replacesEntryId, target.id);
  assert.equal(replacement!.postCloseCorrection, true);

  // A voided entry cannot be voided again.
  await assert.rejects(
    () => api.voidHouseCardEntry(target.id, "Again."),
    /already voided/i,
  );
});

test("administrator reaches every home in the agency", async () => {
  const api = new LocalApi(store());
  const { cedar, willow } = await sites(api);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const cedarEntries = await api.listHouseCardEntries(cedar.id);
  const willowEntries = await api.listHouseCardEntries(willow.id);
  assert.ok(cedarEntries.length >= 12);
  assert.ok(willowEntries.length >= 12);
  const created = await api.createHouseCardEntry({
    siteId: willow.id,
    entryDate: today(),
    kind: "credit",
    location: "",
    amountCents: 2500,
    note: "Top-up from the agency office.",
  });
  assert.equal(created.siteId, willow.id);
});
