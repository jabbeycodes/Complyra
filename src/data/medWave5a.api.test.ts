/**
 * Wave 5A (medication display truth) — LocalApi integration coverage.
 *
 * Item 1: a variance count's history entry resolves the recorder's name
 * and carries expected/counted/reason — never a raw user id.
 * Item 2: a never-counted med has one count state everywhere — the
 * forecast tally excludes it and the board's countdown agrees there is
 * no baseline (steady state, same view object).
 * Item 3: a medication claimed by a discontinued order (order ->
 * medication link) leaves every active list even when the row's own
 * source-order link was never written (the batch 24 state), while the
 * order stays visible in the record view labeled discontinued.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso, type Medication } from "./chart";
import {
  deliveryHistoryLabel,
  medHasCountOnFile,
  medSupplyDisplayState,
  summarizeMedSupply,
} from "./medInventory";
import { medicationStaysOnMar } from "./medicationOrders";
import { medCountdown } from "../features/mobile/medcount";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

async function nurseOnEllis(api: LocalApi) {
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD
  });
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find(
    (person) => person.name === "Ellis Hart",
  );
  assert.ok(ellis, "seed includes Ellis Hart");
  return { session, workspace, ellis };
}

// ---------- Item 3: medicationStaysOnMar, both link directions ----------

test("medicationStaysOnMar: the source-order link governs when present", () => {
  const med = { id: "m1", sourceOrderId: "o1" };
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o1", status: "active", medicationId: "m1" },
    ]),
    true,
  );
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o1", status: "discontinued", medicationId: "m1" },
    ]),
    false,
  );
});

test("medicationStaysOnMar: a discontinued order's claim hides a row whose back-link was never written", () => {
  // The batch 24 state: the medication row carries no sourceOrderId, but
  // the order activated against it points at it via medicationId.
  const med = { id: "m1", sourceOrderId: null };
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o9", status: "discontinued", medicationId: "m1" },
    ]),
    false,
  );
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o9", status: "active", medicationId: "m1" },
    ]),
    true,
  );
  // A later active order claiming the same row keeps it on the MAR.
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o9", status: "discontinued", medicationId: "m1" },
      { id: "o10", status: "active", medicationId: "m1" },
    ]),
    true,
  );
  // Unclaimed legacy rows always stay.
  assert.equal(
    medicationStaysOnMar(med, [
      { id: "o9", status: "discontinued", medicationId: "other-med" },
    ]),
    true,
  );
  assert.equal(medicationStaysOnMar(med, []), true);
});

// ---------- Item 3: the batch 24 state, end to end ----------

test("a med claimed by a discontinued order leaves inventory, plan stack and forecasts; the order stays in the record view", async () => {
  const memStore = store();
  const api = new LocalApi(memStore);
  const { session, ellis } = await nurseOnEllis(api);
  const seedMed = memStore.db.medications.find(
    (row) => row.id === `${ellis.id}-med-keppra`,
  );
  assert.ok(seedMed, "seed includes Ellis's Levetiracetam row");
  assert.equal(
    seedMed.sourceOrderId ?? null,
    null,
    "the seed row has no source-order back-link — the batch 24 shape",
  );

  // The seed's own showcase order claims this row via medicationId while
  // the row's sourceOrderId was never written — the exact batch 24 link
  // shape (order -> med claim present, med -> order back-link absent).
  const claim = (memStore.db.medicationOrders ?? []).find(
    (order) => order.medicationId === seedMed.id,
  );
  assert.ok(claim, "the seed order claims the Levetiracetam row");
  assert.equal(claim.status, "active");

  const stackMedIds = async () => {
    const workspace = await api.loadWorkspace(session);
    const stack = workspace.planStacks.find(
      (row) => row.individualId === ellis.id,
    );
    return new Set((stack?.medications ?? []).map((med) => med.id));
  };

  // While the claiming order is active, the med is everywhere it should be.
  assert.ok(
    (await api.getMedInventory(ellis.id)).some(
      (view) => view.medicationId === seedMed.id,
    ),
  );
  assert.ok((await stackMedIds()).has(seedMed.id));

  // The order is discontinued (the write the sim performed).
  claim.status = "discontinued";
  claim.discontinuedBy = session.userId;
  claim.discontinuedAt = "2026-10-31T12:00:00.000Z";
  claim.discontinueReason = "Prescriber stopped the medication.";

  const inventory = await api.getMedInventory(ellis.id);
  assert.equal(
    inventory.some((view) => view.medicationId === seedMed.id),
    false,
    "discontinued-claimed med leaves the inventory / forecast views",
  );
  assert.equal(
    (await stackMedIds()).has(seedMed.id),
    false,
    "discontinued-claimed med leaves the chart / MAR plan stack",
  );
  const siteId = memStore.db.individuals.find(
    (person) => person.id === ellis.id,
  )!.siteId;
  const supply = await api.getMedicationSupplyStatus(siteId);
  assert.equal(
    supply.alerts.some((alert) => alert.medicationId === seedMed.id),
    false,
    "discontinued-claimed med leaves the supply forecast alerts",
  );

  // The record view keeps the order, labeled discontinued.
  const orders = await api.listMedicationOrders(ellis.id);
  const record = orders.find((order) => order.id === claim.id);
  assert.ok(record, "the order remains in the record view");
  assert.equal(record.status, "discontinued");
});

// ---------- Item 1: variance history resolves the recorder ----------

test("a variance count's history entry names the recorder and the figures — never the raw user id", async () => {
  const memStore = store();
  const api = new LocalApi(memStore);
  const { session, ellis } = await nurseOnEllis(api);
  const nurseName = memStore.db.profiles.find(
    (profile) => profile.id === session.userId,
  )!.fullName;

  const draft = await api.createMedicationOrder({
    individualId: ellis.id,
    medicationName: "Simulamine",
    dose: "10 mg",
    route: "By mouth",
    schedule: "Twice daily",
    scheduleTimes: ["08:00", "20:00"],
    prescriberName: "Dr. Rivera",
    reason: "Simulation",
    startDate: "2026-10-01",
    endReviewDate: "2026-11-15",
  });
  const active = await api.activateMedicationOrder(draft.id, {
    initialCount: 30,
  });
  assert.ok(active.medicationId);

  await api.recordMedDelivery({
    medicationId: active.medicationId,
    remainingPills: 28,
    pillsPerDay: 2,
    varianceReason: "Two tablets missing at count",
  });

  const views = await api.getMedInventory(ellis.id);
  const view = views.find((row) => row.medicationId === active.medicationId);
  assert.ok(view);
  const entry = view.deliveries.find((row) => row.varianceReason);
  assert.ok(entry, "the variance delivery is in the history");
  assert.equal(entry.expectedPills, 30);
  assert.equal(entry.recordedBy, session.userId);
  assert.equal(
    entry.recordedByName,
    nurseName,
    "the read path resolves the recorder's display name",
  );

  const label = deliveryHistoryLabel(entry, {
    medicationName: "Simulamine",
    individualName: "Ellis Hart",
  });
  assert.match(label, /Simulamine for Ellis Hart/);
  assert.match(label, /expected 30, counted 28/);
  assert.match(label, /Two tablets missing at count/);
  assert.ok(label.includes(`recorded by ${nurseName}`));
  assert.ok(
    !label.includes(session.userId),
    "the raw user id must never render in history",
  );
});

// ---------- Item 2: never-counted meds, one state everywhere ----------

test("a never-counted med: forecast tally excludes it and the countdown agrees there is no baseline", async () => {
  const memStore = store();
  const api = new LocalApi(memStore);
  const { ellis } = await nurseOnEllis(api);
  const neverCounted: Medication = {
    id: `${ellis.id}-med-testoprofen`,
    agencyId: memStore.db.agencies[0].id,
    individualId: ellis.id,
    name: "Testoprofen",
    strength: "200 mg",
    kind: "scheduled",
    controlled: false,
    pillsPerDay: 2,
    remainingPills: 0,
    lastDeliveryOn: null,
    lastCountdownOn: null,
  };
  memStore.db.medications.push(neverCounted);

  const views = await api.getMedInventory(ellis.id);
  const view = views.find((row) => row.medicationId === neverCounted.id);
  assert.ok(view, "the never-counted med still has an inventory view");
  assert.equal(view.lastCountedOn, null);
  assert.equal(medHasCountOnFile(view), false);
  // Steady-state agreement: the board's countdown (from this same view)
  // has no baseline, so the board renders "No count recorded yet" — the
  // forecast's state — never a fabricated "0 pills left".
  const countdown = medCountdown(view, [], todayIso());
  assert.equal(countdown.hasBaseline, false);
  assert.equal(countdown.label, "No count recorded yet");

  const siteId = memStore.db.individuals.find(
    (person) => person.id === ellis.id,
  )!.siteId;
  const supply = await api.getMedicationSupplyStatus(siteId);
  assert.equal(
    supply.alerts.some((alert) => alert.medicationId === neverCounted.id),
    false,
    "never-counted meds never appear as reorder alerts",
  );
  const onlyUncounted = summarizeMedSupply(siteId, "Cedar House", [view]);
  assert.equal(onlyUncounted.outCount, 0);
  assert.match(onlyUncounted.summary, /not counted/);
});

// ---------- Item 2, batch 37: the failure was role-shaped ----------

test("DSP-shaped and HM-shaped sessions: the board's count source resolves on its own and reads never-counted", async () => {
  // Batch 37: the never-counted med's board read "0 pills left · Due
  // soon" persistently for the HM and the DSP while the nurse's board
  // settled correctly — the board's old all-or-nothing load (inventory +
  // dose marks + PRN logs in one Promise.all) meant a role-shaped
  // failure in either auxiliary load left the board rendering stored-row
  // figures forever. The board now loads the inventory views on their
  // own; this pins that, per role, the inventory load alone yields the
  // single computed never-counted state.
  for (const username of [DEMO_DSP_USERNAME, DEMO_HM_USERNAME]) {
    const memStore = store();
    if (username === DEMO_HM_USERNAME) {
      // The demo HM belongs to the other home; seat them at Ellis's home
      // (the same relocation the existing HM fixtures use).
      const hm = memStore.db.profiles.find((p) => p.username === username)!;
      memStore.db.memberships.find((m) => m.userId === hm.id)!.siteId =
        memStore.db.individuals.find((p) => p.fullName.includes("Ellis"))!
          .siteId;
    }
    const api = new LocalApi(memStore);
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username,
      password: DEMO_PASSWORD,
    });
    const workspace = await api.loadWorkspace(session);
    const ellis = workspace.individuals.find(
      (person) => person.name === "Ellis Hart",
    );
    assert.ok(ellis, `${username} sees Ellis Hart`);
    const neverCounted: Medication = {
      id: `${ellis.id}-med-testoprofen`,
      agencyId: session.agencyId,
      individualId: ellis.id,
      name: "Testoprofen",
      strength: "200 mg",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 2,
      remainingPills: 0,
      lastDeliveryOn: null,
      lastCountdownOn: null,
    };
    memStore.db.medications.push(neverCounted);

    // The auxiliary loads the old board coupled to the inventory load:
    // run them first, settled either way — they must not matter.
    const today = todayIso();
    const from = new Date(Date.now() - 370 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await Promise.allSettled([
      api.getMedDoseMarksInRange(ellis.id, from, today),
      api.listPrnDoses(ellis.id),
    ]);

    // The board's own load: inventory views, independently.
    const views = await api.getMedInventory(ellis.id);
    const view = views.find((row) => row.medicationId === neverCounted.id);
    assert.ok(view, `${username}: inventory carries the never-counted med`);
    assert.deepEqual(
      medSupplyDisplayState(view, "ready"),
      { kind: "never-counted" },
      `${username}: the single computed source reads never-counted`,
    );
    assert.equal(
      medCountdown(view, [], today).hasBaseline,
      false,
      `${username}: the board countdown agrees — no baseline, no "0 pills left"`,
    );
  }
});
