import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";
import {
  medSupplyBadgeLabel,
  medSupplyStatusFromInventory,
} from "./complianceStatus";
import { medCountdown } from "../features/mobile/medcount";

const pw: string = DEMO_PASSWORD;

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: pw };
}

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

async function hmOnEllis(api: LocalApi, st: MemoryStore) {
  const hm = st.db.profiles.find((p) => p.username === DEMO_HM_USERNAME)!;
  st.db.memberships.find((m) => m.userId === hm.id)!.siteId =
    st.db.individuals.find((p) => p.fullName.includes("Ellis"))!.siteId;
  const session = await api.signIn(login(DEMO_HM_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  return { session, ellis };
}

async function expectedFor(
  api: LocalApi,
  individualId: string,
  medicationId: string,
): Promise<number> {
  const today = todayIso();
  const views = await api.getMedInventory(individualId);
  const view = views.find((row) => row.medicationId === medicationId)!;
  const from = new Date(Date.now() - 370 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const marks = await api.getMedDoseMarksInRange(individualId, from, today);
  const countdown = medCountdown(view, marks, today);
  assert.ok(countdown.hasBaseline, "seed med has a count baseline");
  assert.ok(countdown.pillsLeft !== null);
  return countdown.pillsLeft;
}

test("count variance: a differing count needs a note and persists the evidence", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const views = await api.getMedInventory(ellis.id);
  const keppra = views.find((v) => v.medicationName === "Levetiracetam")!;
  const expected = await expectedFor(api, ellis.id, keppra.medicationId);

  await assert.rejects(
    () =>
      api.recordMedDelivery({
        medicationId: keppra.medicationId,
        remainingPills: expected - 2,
        pillsPerDay: 2,
        countedOn: todayIso(),
      }),
    /differs from the expected/,
  );

  await api.recordMedDelivery({
    medicationId: keppra.medicationId,
    remainingPills: expected - 2,
    pillsPerDay: 2,
    countedOn: todayIso(),
    varianceReason: "Two tablets found crushed in the bottle",
  });
  const after = (await api.getMedInventory(ellis.id)).find(
    (v) => v.medicationId === keppra.medicationId,
  )!;
  const latest = after.deliveries.find(
    (d) => d.countedOn === todayIso() && d.remainingPills === expected - 2,
  )!;
  assert.equal(latest.expectedPills, expected);
  assert.equal(
    latest.varianceReason,
    "Two tablets found crushed in the bottle",
  );
  assert.equal(latest.remainingPills, expected - 2);

  // The new baseline is now the expectation: recording it needs no note.
  await api.recordMedDelivery({
    medicationId: keppra.medicationId,
    remainingPills: expected - 2,
    pillsPerDay: 2,
    countedOn: todayIso(),
  });
});

test("PRN dose requires a reason and the per-dose history lists it", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis, session } = await hmOnEllis(api, st);
  const views = await api.getMedInventory(ellis.id);
  const lorazepam = views.find((v) => v.medicationName === "Lorazepam")!;

  await assert.rejects(
    () => api.logPrnDose(lorazepam.medicationId, { pills: 1, reason: "  " }),
    /Say why the PRN was given/,
  );

  const stockBefore = st.db.medications.find(
    (m) => m.id === lorazepam.medicationId,
  )!.remainingPills;
  await api.logPrnDose(lorazepam.medicationId, {
    pills: 1,
    reason: "Agitation at bedtime",
    followUp: "Recheck in 30 minutes",
  });
  const logs = await api.listPrnDoses(ellis.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].medicationId, lorazepam.medicationId);
  assert.equal(logs[0].reason, "Agitation at bedtime");
  assert.equal(logs[0].followUp, "Recheck in 30 minutes");
  assert.equal(logs[0].givenByName, session.fullName);
  assert.equal(logs[0].givenOn, todayIso());
  assert.ok(logs[0].givenAt.length > 0, "the dose carries its actual time");
  assert.equal(logs[0].remainingAfter, stockBefore - 1);
});

test("PRN stock errors are worded for the caller's role", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const views = await api.getMedInventory(ellis.id);
  const lorazepam = views.find((v) => v.medicationName === "Lorazepam")!;

  await assert.rejects(
    () =>
      api.logPrnDose(lorazepam.medicationId, {
        pills: 99,
        reason: "Severe agitation",
      }),
    /Reconcile the count first/,
  );

  const dspApi = new LocalApi(st);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      dspApi.logPrnDose(lorazepam.medicationId, {
        pills: 99,
        reason: "Severe agitation",
      }),
    /Ask your house manager, RN, or PM to record the count first/,
  );
});

test("an uncounted medication reports no-count and blocks PRN by role", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis, session } = await hmOnEllis(api, st);
  st.db.medications.push({
    id: "med-uncounted-prn",
    agencyId: session.agencyId,
    individualId: ellis.id,
    name: "Testoprofen PRN",
    strength: "10 mg",
    kind: "prn",
    controlled: false,
    pillsPerDay: 0,
    remainingPills: 0,
    lastDeliveryOn: null,
    lastCountdownOn: null,
  });

  const view = (await api.getMedInventory(ellis.id)).find(
    (v) => v.medicationId === "med-uncounted-prn",
  )!;
  assert.ok(view, "the uncounted med still lists in inventory");
  assert.equal(view.lastCountedOn, null);

  await assert.rejects(
    () =>
      api.logPrnDose("med-uncounted-prn", { pills: 1, reason: "Headache" }),
    /No count has been recorded.*Record the first count/,
  );

  const dspApi = new LocalApi(st);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      dspApi.logPrnDose("med-uncounted-prn", {
        pills: 1,
        reason: "Headache",
      }),
    /No count has been recorded.*Ask your house manager, RN, or PM/,
  );
});

test("activation requires the first count and records it as the first delivery", async () => {
  const st = store();
  const api = new LocalApi(st);
  const session = await api.signIn(login(DEMO_NURSE_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const ellis = workspace.individuals.find((p) => p.name.includes("Ellis"))!;

  const draft = await api.createMedicationOrder({
    individualId: ellis.id,
    medicationName: "Testavir",
    dose: "10 mg",
    route: "By mouth",
    schedule: "Once daily",
    scheduleTimes: ["08:00"],
    prescriberName: "Dr. Rivera",
    reason: "Cluster test",
    startDate: "2026-10-01",
    endReviewDate: "2026-12-15",
  });
  await assert.rejects(
    () => api.activateMedicationOrder(draft.id),
    /initial count/,
  );
  const active = await api.activateMedicationOrder(draft.id, {
    initialCount: 30,
  });
  assert.equal(active.status, "active");
  const view = (await api.getMedInventory(ellis.id)).find(
    (v) => v.medicationId === active.medicationId,
  )!;
  assert.equal(view.lastCountedOn, todayIso());
  assert.equal(view.deliveries.length, 1);
  assert.equal(view.deliveries[0].remainingPills, 30);
});

test("auditor is read-only for inventory: threshold and correction are refused", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const keppra = (await api.getMedInventory(ellis.id)).find(
    (v) => v.medicationName === "Levetiracetam",
  )!;

  const auditorProfile = st.db.profiles.find(
    (p) => p.fullName === "Mark Delaney",
  )!;
  const auditorApi = new LocalApi(st);
  await auditorApi.signIn(login(auditorProfile.email.split("@")[0]));
  // The auditor can READ the supply record (auditors see everything)…
  const readViews = await auditorApi.getMedInventory(ellis.id);
  assert.ok(readViews.some((v) => v.medicationId === keppra.medicationId));
  // …but the inventory write paths refuse them, matching the UI gate.
  await assert.rejects(
    () =>
      auditorApi.adjustMedInventory({
        medicationId: keppra.medicationId,
        quantityDelta: 5,
        reason: "auditor probe",
      }),
    /House manager, RN, or PM adjusts/,
  );
  await assert.rejects(
    () =>
      auditorApi.setReorderThreshold({
        medicationId: keppra.medicationId,
        lowThresholdDays: 3,
      }),
    /House manager, RN, or PM sets/,
  );
});

test("supply badges: stocked is never Expired, zero stock is Out of stock", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const views = await api.getMedInventory(ellis.id);

  // A stocked PRN med has no days-remaining figure (the old days-based
  // badge read that null as "Expired" with 29 pills on the shelf). Its
  // one supply state is the inventory band: ok → compliant, no override.
  const lorazepam = views.find((v) => v.medicationName === "Lorazepam")!;
  assert.equal(lorazepam.daysRemaining, null);
  assert.equal(lorazepam.status, "ok");
  assert.equal(medSupplyStatusFromInventory(lorazepam.status), "compliant");
  assert.equal(
    medSupplyBadgeLabel(lorazepam.status, lorazepam.lastCountedOn),
    undefined,
  );

  // A stocked scheduled med carries exactly one band too.
  const keppra = views.find((v) => v.medicationName === "Levetiracetam")!;
  assert.ok(["ok", "low", "critical"].includes(keppra.status));

  // Zero stock (with a count on file) is "Out of stock", never "Expired";
  // no count on file is "No count recorded yet", whatever the band.
  assert.equal(medSupplyBadgeLabel("out", todayIso()), "Out of stock");
  assert.equal(medSupplyBadgeLabel("out", null), "No count recorded yet");

  // End to end: a med activated with a zero first count is out of stock.
  const nurseApi = new LocalApi(st);
  const session = await nurseApi.signIn(login(DEMO_NURSE_USERNAME));
  const workspace = await nurseApi.loadWorkspace(session);
  const person = workspace.individuals.find((p) => p.name.includes("Ellis"))!;
  const draft = await nurseApi.createMedicationOrder({
    individualId: person.id,
    medicationName: "Zerocet",
    dose: "5 mg",
    route: "By mouth",
    schedule: "Once daily",
    scheduleTimes: ["08:00"],
    prescriberName: "Dr. Rivera",
    reason: "Badge test",
    startDate: "2026-10-01",
    endReviewDate: "2026-12-15",
  });
  const active = await nurseApi.activateMedicationOrder(draft.id, {
    initialCount: 0,
  });
  const zeroView = (await nurseApi.getMedInventory(person.id)).find(
    (v) => v.medicationId === active.medicationId,
  )!;
  assert.equal(zeroView.status, "out");
  assert.equal(zeroView.lastCountedOn, todayIso());
  assert.equal(
    medSupplyBadgeLabel(zeroView.status, zeroView.lastCountedOn),
    "Out of stock",
  );
});

test("late MAR: a past-window mark needs a reason and is stamped Late", async () => {
  const st = store();
  const api = new LocalApi(st);
  const { ellis } = await hmOnEllis(api, st);
  const medId = `${ellis.id}-med-keppra`;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: medId,
        doseDate: day,
        doseTime: "08:00",
        status: "given",
      }),
    /late entry/,
  );
  await api.markMedDose({
    medicationId: medId,
    doseDate: day,
    doseTime: "08:00",
    status: "given",
    lateReason: "Entered from the paper MAR",
  });
  const marks = await api.getMedDoseMarks(ellis.id, day);
  const late = marks.find((m) => m.doseTime === "08:00")!;
  assert.equal(late.late, true);
  assert.equal(late.lateReason, "Entered from the paper MAR");

  // An in-window mark today needs no reason and is not stamped Late.
  const nowHhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  await api.markMedDose({
    medicationId: medId,
    doseDate: todayIso(),
    doseTime: nowHhmm,
    status: "given",
  });
  const todayMarks = await api.getMedDoseMarks(ellis.id, todayIso());
  const fresh = todayMarks.find((m) => m.doseTime === nowHhmm)!;
  assert.equal(fresh.late ?? false, false);
});
