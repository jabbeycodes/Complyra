import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso, type Medication } from "./chart";
import {
  inventoryCountdownLabel,
  projectInventory,
  projectMedInventory,
  summarizeMedSupply,
} from "./medInventory";
import type { MedInventoryView } from "./types";

function hmLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
password: DEMO_PASSWORD,
  };
}

function dspLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
password: DEMO_PASSWORD,
  };
}

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    agencyId: "a",
    individualId: "i",
    name: "Levetiracetam",
    strength: "500 mg tablet",
    kind: "scheduled",
    controlled: false,
    pillsPerDay: 2,
    remainingPills: 30,
    lastDeliveryOn: "2026-09-01",
    lastCountdownOn: "2026-09-01",
    ...overrides,
  };
}

// ---------- projectInventory: the projection math ----------

test("scheduled meds drop by doses-per-day per elapsed day", () => {
  const out = projectInventory({
    deliveryQty: 30,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-06",
  });
  assert.equal(out.currentCount, 20);
  assert.equal(out.daysRemaining, 10);
  assert.equal(out.status, "ok");
  assert.equal(out.alertActive, false);
});

test("delivery day itself counts zero elapsed days", () => {
  const out = projectInventory({
    deliveryQty: 30,
    dosesPerDay: 2,
    deliveredOn: "2026-09-06",
    today: "2026-09-06",
  });
  assert.equal(out.currentCount, 30);
  assert.equal(out.daysRemaining, 15);
});

test("status moves ok -> low -> critical -> out as supply drains", () => {
  const base = {
    deliveryQty: 30,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    lowThresholdDays: 7,
  };
  assert.equal(projectInventory({ ...base, today: "2026-09-01" }).status, "ok");
  // 8 days left after 7 elapsed -> still ok (threshold is 7)
  assert.equal(projectInventory({ ...base, today: "2026-09-08" }).status, "ok");
  // 7 days left -> low
  assert.equal(projectInventory({ ...base, today: "2026-09-09" }).status, "low");
  // 2 days left -> critical
  assert.equal(projectInventory({ ...base, today: "2026-09-14" }).status, "critical");
  // 0 pills -> out
  assert.equal(projectInventory({ ...base, today: "2026-09-16" }).status, "out");
  const out = projectInventory({ ...base, today: "2026-09-16" });
  assert.equal(out.currentCount, 0);
  assert.equal(out.daysRemaining, 0);
});

test("count never goes negative past the run-out date", () => {
  const out = projectInventory({
    deliveryQty: 10,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-10-01",
  });
  assert.equal(out.currentCount, 0);
  assert.equal(out.status, "out");
});

test("logged PRN doses decrement; scheduled meds ignore dose logs", () => {
  const prn = projectInventory({
    deliveryQty: 12,
    dosesPerDay: 0,
    deliveredOn: "2026-09-01",
    today: "2026-09-10",
    dosesLogged: [
      { date: "2026-09-03", pills: 2 },
      { date: "2026-09-05", pills: 1 },
    ],
  });
  assert.equal(prn.currentCount, 9);
  assert.equal(prn.daysRemaining, null);
  assert.equal(prn.status, "ok");

  const scheduled = projectInventory({
    deliveryQty: 30,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-06",
    dosesLogged: [{ date: "2026-09-03", pills: 99 }],
  });
  assert.equal(scheduled.currentCount, 20);
});

test("doses outside the delivery window are ignored", () => {
  const out = projectInventory({
    deliveryQty: 12,
    dosesPerDay: 0,
    deliveredOn: "2026-09-05",
    today: "2026-09-10",
    dosesLogged: [
      { date: "2026-09-01", pills: 4 },
      { date: "2026-09-20", pills: 4 },
      { date: "2026-09-06", pills: 3 },
    ],
  });
  assert.equal(out.currentCount, 9);
});

test("PRN status uses pill thresholds (critical at <= 2 pills)", () => {
  const low = projectInventory({
    deliveryQty: 12,
    dosesPerDay: 0,
    deliveredOn: "2026-09-01",
    today: "2026-09-10",
    dosesLogged: [{ date: "2026-09-06", pills: 6 }],
    lowThresholdDays: 7,
  });
  assert.equal(low.currentCount, 6);
  assert.equal(low.status, "low");

  const critical = projectInventory({
    deliveryQty: 12,
    dosesPerDay: 0,
    deliveredOn: "2026-09-01",
    today: "2026-09-10",
    dosesLogged: [{ date: "2026-09-06", pills: 10 }],
  });
  assert.equal(critical.status, "critical");
});

test("acknowledging silences the alert until the next day", () => {
  const input = {
    deliveryQty: 14,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-09",
    lowThresholdDays: 7,
  };
  assert.equal(projectInventory(input).alertActive, true);
  assert.equal(
    projectInventory({ ...input, reorderAcknowledgedOn: "2026-09-09" }).alertActive,
    false,
  );
  assert.equal(
    projectInventory({ ...input, today: "2026-09-10", reorderAcknowledgedOn: "2026-09-09" })
      .alertActive,
    true,
  );
});

test("custom threshold moves the low boundary and the reorder point", () => {
  const out = projectInventory({
    deliveryQty: 30,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-06",
    lowThresholdDays: 14,
  });
  assert.equal(out.daysRemaining, 10);
  assert.equal(out.status, "low");
  assert.equal(out.reorderPointPills, 28);
});

// ---------- projectMedInventory: view assembly ----------

test("newest delivery anchors the projection; history is newest-first", () => {
  const view = projectMedInventory({
    med: med(),
    inventory: null,
    deliveries: [
      { id: "d1", medicationId: "med-1", countedOn: "2026-09-01", remainingPills: 30, pillsPerDay: 2, recordedBy: "u" },
      { id: "d2", medicationId: "med-1", countedOn: "2026-09-08", remainingPills: 40, pillsPerDay: 2, recordedBy: "u" },
    ],
    prnDoses: [],
    doseExceptions: [],
    today: "2026-09-10",
  });
  assert.equal(view.quantityOnDelivery, 40);
  assert.equal(view.deliveredOn, "2026-09-08");
  assert.equal(view.currentCount, 36);
  assert.equal(view.daysRemaining, 18);
  assert.equal(view.deliveries[0].id, "d2");
  assert.equal(view.lowThresholdDays, 7);
});

test("stored threshold and acknowledgment flow into the view", () => {
  const view = projectMedInventory({
    med: med(),
    inventory: {
      id: "inv-1",
      agencyId: "a",
      individualId: "i",
      medicationId: "med-1",
      lowThresholdDays: 14,
      doseTimes: [],
      reorderAcknowledgedOn: "2026-09-10",
      updatedAt: "2026-09-10T00:00:00Z",
    },
    deliveries: [],
    prnDoses: [],
    doseExceptions: [],
    today: "2026-09-10",
  });
  // 30 pills, 2/day, delivered 2026-09-01 -> 12 left, 6 days, low at 14-day threshold
  assert.equal(view.status, "low");
  assert.equal(view.alertActive, false);
  assert.equal(inventoryCountdownLabel(view), "12 pills remaining · ~6 days left");
});

test("PRN meds without dose logs fall back to the decremented row count", () => {
  const view = projectMedInventory({
    med: med({ kind: "prn", pillsPerDay: 0, remainingPills: 7 }),
    inventory: null,
    deliveries: [
      { id: "d1", medicationId: "med-1", countedOn: "2026-09-01", remainingPills: 12, pillsPerDay: 0, recordedBy: "u" },
    ],
    prnDoses: [],
    doseExceptions: [],
    today: "2026-09-10",
  });
  assert.equal(view.currentCount, 7);
  assert.equal(view.daysRemaining, null);
  assert.equal(view.status, "low");
});

// ---------- summarizeMedSupply ----------

function viewWithStatus(status: MedInventoryView["status"], individualId = "i"): MedInventoryView {
  return {
    id: `inv-${status}`,
    agencyId: "a",
    individualId,
    medicationId: `med-${status}`,
    medicationName: `Med ${status}`,
    strength: "1 mg",
    kind: "scheduled",
    dosesPerDay: 1,
    doseTimes: [],
    quantityOnDelivery: 10,
    deliveredOn: "2026-09-01",
    lowThresholdDays: 7,
    reorderAcknowledgedOn: null,
    updatedAt: null,
    currentCount: 1,
    daysRemaining: 1,
    reorderPointPills: 7,
    status,
    alertActive: status !== "ok",
    prnDosesSinceDelivery: 0,
    deliveries: [],
    doseExceptions: [],
  };
}

test("supply summary counts by status and flags the home", () => {
  const summary = summarizeMedSupply("s1", "Maple House", [
    viewWithStatus("ok"),
    viewWithStatus("low"),
    viewWithStatus("critical"),
    viewWithStatus("out"),
  ]);
  assert.equal(summary.totalMeds, 4);
  assert.equal(summary.okCount, 1);
  assert.equal(summary.lowCount, 1);
  assert.equal(summary.criticalCount, 1);
  assert.equal(summary.outCount, 1);
  assert.equal(summary.allClear, false);
  assert.deepEqual(
    summary.alerts.map((a) => a.status),
    ["out", "critical", "low"],
  );
  assert.match(summary.summary, /Maple House/);
});

test("all-clear summary reads clean", () => {
  const summary = summarizeMedSupply("s1", "Maple House", [viewWithStatus("ok")]);
  assert.equal(summary.allClear, true);
  assert.match(summary.summary, /all 1 medication stocked/);
});

// ---------- LocalApi integration ----------

async function hmClient() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const hm = store.db.profiles.find((p) => p.username === DEMO_HM_USERNAME)!;
  store.db.memberships.find((m) => m.userId === hm.id)!.siteId =
    store.db.individuals.find((p) => p.fullName.includes("Jodie"))!.siteId;
  const client = new LocalApi(store);
  const session = await client.signIn(hmLogin());
  const workspace = await client.loadWorkspace(session);
  const jodie = workspace.individuals.find((p) => p.name.includes("Jodie"))!;
  const siteId = store.db.sites.find((s) => s.agencyId === session.agencyId)!.id;
  return { client, store, session, jodie, siteId };
}

test("delivery-day count drives the projection; new delivery refreshes it", async () => {
  const { client, jodie } = await hmClient();
  const today = todayIso();
  const before = await client.getMedInventory(jodie.id);
  const keppra = before.find((v) => v.medicationName === "Levetiracetam")!;
  assert.ok(keppra);

  await client.recordMedDelivery({
    medicationId: keppra.medicationId,
    remainingPills: 60,
    pillsPerDay: 2,
    countedOn: today,
  });
  const after = await client.getMedInventory(jodie.id);
  const view = after.find((v) => v.medicationId === keppra.medicationId)!;
  assert.equal(view.currentCount, 60);
  assert.equal(view.daysRemaining, 30);
  assert.equal(view.status, "ok");
  assert.equal(view.deliveredOn, today);
  assert.ok(view.deliveries.some((d) => d.countedOn === today && d.remainingPills === 60));
});

test("adjustMedInventory corrects the count and requires a reason", async () => {
  const { client, jodie } = await hmClient();
  const today = todayIso();
  const [keppra] = await client.getMedInventory(jodie.id).then((rows) =>
    rows.filter((v) => v.medicationName === "Levetiracetam"),
  );
  await client.recordMedDelivery({
    medicationId: keppra.medicationId,
    remainingPills: 60,
    pillsPerDay: 2,
    countedOn: today,
  });
  await assert.rejects(
    client.adjustMedInventory({ medicationId: keppra.medicationId, quantityDelta: -5, reason: "  " }),
    /reason/i,
  );
  await assert.rejects(
    client.adjustMedInventory({ medicationId: keppra.medicationId, quantityDelta: 0, reason: "recount" }),
    /non-zero/i,
  );
  await client.adjustMedInventory({
    medicationId: keppra.medicationId,
    quantityDelta: -5,
    reason: "recount found 5 fewer",
  });
  const view = (await client.getMedInventory(jodie.id)).find(
    (v) => v.medicationId === keppra.medicationId,
  )!;
  assert.equal(view.currentCount, 55);
  assert.equal(view.daysRemaining, 27);
});

test("threshold, acknowledge, and supply status work end to end", async () => {
  const { client, jodie, siteId } = await hmClient();
  const today = todayIso();
  const keppra = (await client.getMedInventory(jodie.id)).find(
    (v) => v.medicationName === "Levetiracetam",
  )!;
  await client.recordMedDelivery({
    medicationId: keppra.medicationId,
    remainingPills: 60,
    pillsPerDay: 2,
    countedOn: today,
  });
  await assert.rejects(
    client.setReorderThreshold({ medicationId: keppra.medicationId, lowThresholdDays: 0 }),
    /1–90/,
  );
  await client.setReorderThreshold({ medicationId: keppra.medicationId, lowThresholdDays: 30 });
  let view = (await client.getMedInventory(jodie.id)).find(
    (v) => v.medicationId === keppra.medicationId,
  )!;
  assert.equal(view.lowThresholdDays, 30);
  assert.equal(view.status, "low");
  assert.equal(view.alertActive, true);

  await client.acknowledgeReorderAlert(keppra.medicationId);
  view = (await client.getMedInventory(jodie.id)).find(
    (v) => v.medicationId === keppra.medicationId,
  )!;
  assert.equal(view.alertActive, false);

  const status = await client.getMedicationSupplyStatus(siteId);
  assert.equal(status.siteId, siteId);
  assert.ok(status.totalMeds >= 3);
  assert.equal(status.allClear, false);
  assert.ok(status.alerts.some((a) => a.medicationId === keppra.medicationId));
  assert.match(status.summary, /need/);
});

test("DSP can view inventory but cannot adjust it", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const session = await client.signIn(dspLogin());
  const workspace = await client.loadWorkspace(session);
  const jodie = workspace.individuals.find((p) => p.name.includes("Jodie"))!;
  const views = await client.getMedInventory(jodie.id);
  assert.ok(views.length > 0);
  await assert.rejects(
    client.adjustMedInventory({
      medicationId: views[0].medicationId,
      quantityDelta: 1,
      reason: "dsp correction",
    }),
    /House manager, RN, or DPM/,
  );
  await assert.rejects(
    client.setReorderThreshold({ medicationId: views[0].medicationId, lowThresholdDays: 10 }),
    /House manager, RN, or DPM/,
  );
});
