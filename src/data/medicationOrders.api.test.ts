/**
 * LocalApi coverage for medication orders + reconciliation: lifecycle,
 * MAR feed, and role gates. Domain math lives in medicationOrders.test.ts;
 * this file checks the store actually wires those rules into the API.
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
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function nurseOnEllis(api: LocalApi) {
  const session = await api.signIn(login(DEMO_NURSE_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((person) => person.name === "Ellis Hart");
  assert.ok(ellis, "seed includes Ellis Hart");
  return { session, workspace, ellis };
}

test("a DSP cannot view medication orders and does not see the worklist page data", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_DSP_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const person = workspace.individuals[0];
  assert.ok(person);
  await assert.rejects(() => api.listMedicationOrders(person.id), /cannot view medication orders/i);
  await assert.rejects(() => api.listMedicationOrderWorklist(), /cannot view medication orders/i);
});

test("activating an order projects it onto the MAR; discontinuing takes it off", async () => {
  const api = new LocalApi(store());
  const { ellis } = await nurseOnEllis(api);
  const before = await api.getMedInventory(ellis.id);
  const beforeIds = new Set(before.map((row) => row.medicationId));

  const draft = await api.createMedicationOrder({
    individualId: ellis.id,
    medicationName: "Levetiracetam",
    dose: "500 mg",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    prescriberName: "Dr. Rivera",
    reason: "Seizure control",
    startDate: "2026-10-01",
    endReviewDate: "2026-11-15",
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.medicationId, null);

  const active = await api.activateMedicationOrder(draft.id, { initialCount: 30 });
  assert.equal(active.status, "active");
  assert.ok(active.medicationId);

  const inventory = await api.getMedInventory(ellis.id);
  const fed = inventory.find((row) => row.medicationId === active.medicationId);
  assert.ok(fed, "activated order appears on the MAR inventory");
  assert.equal(fed.medicationName, "Levetiracetam");
  assert.deepEqual(fed.doseTimes, ["08:00", "20:00"]);
  assert.ok(!beforeIds.has(fed.medicationId), "the MAR row is new, not a reused seed med");

  const discontinued = await api.discontinueMedicationOrder(
    active.id,
    "Prescriber stopped the medication.",
  );
  assert.equal(discontinued.status, "discontinued");

  const after = await api.getMedInventory(ellis.id);
  assert.equal(
    after.find((row) => row.medicationId === active.medicationId),
    undefined,
    "discontinued order leaves the MAR",
  );
});

test("a house manager can start a reconciliation for their home; only a nurse signs it off", async () => {
  const api = new LocalApi(store());
  // James Wilson (demo HM) is assigned to Willow House — use a Willow Individual.
  // The demo nurse is Cedar-only, so an administrator creates the order first.
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  const reese = workspace.individuals.find((person) => person.name === "Reese Lang");
  assert.ok(reese);

  await api.createMedicationOrder({
    individualId: reese.id,
    medicationName: "Melatonin",
    dose: "3 mg",
    route: "By mouth",
    schedule: "At bedtime",
    scheduleTimes: ["21:00"],
    prescriberName: "Dr. Rivera",
    reason: "Sleep",
    startDate: "2026-10-01",
  }).then((order) => api.activateMedicationOrder(order.id, { initialCount: 30 }));

  await api.signIn(login(DEMO_HM_USERNAME));
  const started = await api.startReconciliation({
    individualId: reese.id,
    trigger: "admission",
  });
  assert.equal(started.status, "in_progress");
  assert.ok(started.items.length > 0);

  await assert.rejects(
    () => api.signOffReconciliation(started.id, { note: "Reviewed." }),
    /nurse or Program Manager/i,
  );

  // The demo nurse is assigned to Cedar House and cannot open a Willow Individual;
  // an administrator may sign off agency-wide.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const completed = await api.signOffReconciliation(started.id, {
    note: "Reviewed against active orders.",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.signOffNote, "Reviewed against active orders.");
  assert.ok(completed.signedOffAt);
  assert.ok(completed.signedOffByName);
});

test("a nurse can start and sign off a reconciliation on their Individual", async () => {
  const api = new LocalApi(store());
  const { ellis } = await nurseOnEllis(api);
  const started = await api.startReconciliation({
    individualId: ellis.id,
    trigger: "hospital_return",
  });
  assert.equal(started.status, "in_progress");
  assert.ok(started.items.length > 0);
  const completed = await api.signOffReconciliation(started.id, {
    note: "Orders match the MAR after hospital return.",
  });
  assert.equal(completed.status, "completed");
  assert.ok(completed.signedOffByName);
  assert.ok(completed.signedOffAt);
});

test("the worklist lists drafts and flags an expired active order", async () => {
  const api = new LocalApi(store());
  const { ellis } = await nurseOnEllis(api);
  const draft = await api.createMedicationOrder({
    individualId: ellis.id,
    medicationName: "Valproate",
    dose: "250 mg",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    prescriberName: "Dr. Rivera",
    reason: "Mood",
    startDate: "2025-01-01",
    endReviewDate: "2025-06-01",
  });
  await api.activateMedicationOrder(draft.id, { initialCount: 30 });

  const worklist = await api.listMedicationOrderWorklist();
  const row = worklist.find((order) => order.id === draft.id);
  assert.ok(row);
  assert.equal(row.expiry, "expired");
  assert.equal(row.individualName, "Ellis Hart");
});

test("the worklist queues one order-expired notice per role, deduped per role", async () => {
  const s = store();
  const api = new LocalApi(s);
  const { ellis } = await nurseOnEllis(api);
  const draft = await api.createMedicationOrder({
    individualId: ellis.id,
    medicationName: "Carbamazepine",
    dose: "200 mg",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    prescriberName: "Dr. Rivera",
    reason: "Seizure control",
    startDate: "2025-01-01",
    endReviewDate: "2025-06-01",
  });
  await api.activateMedicationOrder(draft.id, { initialCount: 30 });

  const expiredNotices = () =>
    s.db.notifications.filter(
      (n) => n.type === "med.order_expired" && n.entityId === draft.id,
    );

  await api.listMedicationOrderWorklist();
  // Both audiences get their own copy: the dedupe key is role-scoped, so
  // the program_manager notice is not swallowed as a duplicate of the
  // nurse one.
  assert.deepEqual(
    expiredNotices().map((n) => n.roleKey).sort(),
    ["nurse", "program_manager"],
  );
  assert.equal(
    new Set(expiredNotices().map((n) => n.dedupeKey)).size,
    2,
    "each role copy carries a distinct dedupe key",
  );

  // Reopening the worklist queues nothing new for the same review date.
  await api.listMedicationOrderWorklist();
  assert.equal(expiredNotices().length, 2);
});

test("the worklist also notifies the house manager of the order's home — and only that home's HM", async () => {
  const s = store();
  const api = new LocalApi(s);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  const reese = workspace.individuals.find((person) => person.name === "Reese Lang");
  const ellis = workspace.individuals.find((person) => person.name === "Ellis Hart");
  assert.ok(reese && ellis, "seed includes Reese Lang (Willow) and Ellis Hart (Cedar)");
  // James Wilson is the Willow house manager — the only HM membership in
  // the demo seed (Cedar's house-manager staff row is the administrator).
  const jamesId = s.db.memberships.find((m) => m.roleKey === "house_manager")?.userId;
  assert.ok(jamesId, "seed includes a house manager membership");

  async function activeOrder(individualId: string, name: string, endReviewDate: string) {
    const draft = await api.createMedicationOrder({
      individualId,
      medicationName: name,
      dose: "100 mg",
      route: "By mouth",
      schedule: "Once daily",
      scheduleTimes: ["08:00"],
      prescriberName: "Dr. Rivera",
      reason: "Test order",
      startDate: "2025-01-01",
      endReviewDate,
    });
    return api.activateMedicationOrder(draft.id, { initialCount: 30 });
  }

  const expiredWillow = await activeOrder(reese.id, "WillowExpiredMed", "2025-06-01");
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const expiringWillow = await activeOrder(reese.id, "WillowExpiringMed", inFiveDays);
  const expiredCedar = await activeOrder(ellis.id, "CedarExpiredMed", "2025-06-01");

  const orderNotices = (orderId: string) =>
    s.db.notifications.filter(
      (n) =>
        n.entityId === orderId &&
        (n.type === "med.order_expired" || n.type === "med.order_expiring"),
    );

  await api.listMedicationOrderWorklist();

  // The role audiences are unchanged for the Willow order…
  assert.deepEqual(
    orderNotices(expiredWillow.id)
      .filter((n) => n.roleKey)
      .map((n) => n.roleKey)
      .sort(),
    ["nurse", "program_manager"],
  );
  // …and its house manager now holds a personal copy of each type.
  const jamesExpired = orderNotices(expiredWillow.id).filter((n) => n.userId === jamesId);
  assert.equal(jamesExpired.length, 1);
  assert.equal(jamesExpired[0].type, "med.order_expired");
  const jamesExpiring = orderNotices(expiringWillow.id).filter((n) => n.userId === jamesId);
  assert.equal(jamesExpiring.length, 1);
  assert.equal(jamesExpiring[0].type, "med.order_expiring");
  // The Cedar order is not his home: no copy for James.
  assert.equal(
    orderNotices(expiredCedar.id).filter((n) => n.userId === jamesId).length,
    0,
  );

  // Reopening the worklist dedupes every audience.
  const total = s.db.notifications.length;
  await api.listMedicationOrderWorklist();
  assert.equal(s.db.notifications.length, total);

  // And the copies are in the HM's own bell.
  await api.signIn(login(DEMO_HM_USERNAME));
  const bell = await api.listNotifications();
  const mine = bell.filter(
    (n) => n.entity_id === expiredWillow.id || n.entity_id === expiringWillow.id,
  );
  assert.equal(mine.length, 2);
  assert.deepEqual(
    mine.map((n) => n.type).sort(),
    ["med.order_expired", "med.order_expiring"],
  );
});
