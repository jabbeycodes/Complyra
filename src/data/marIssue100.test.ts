/**
 * Issue #100 follow-up regression tests (2026-09-18):
 * - begin date survives add / update / reload (the QA-observed "Begin: —" case)
 * - MAR safety notifications reach the nurse AND the acting house manager.
 *   In the demo, Sarah Mitchell is the Cedar House HM by job title + site
 *   assignment, but her membership is intentionally `administrator` with a null
 *   site — routing must still reach her (med.dose_refused, med.concern_flagged)
 *   without changing her membership.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function sarahLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  };
}

function nurseLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
    password: DEMO_PASSWORD,
  };
}

async function sarahAndEllis(api: LocalApi) {
  await api.signIn(sarahLogin());
  const db = (api as unknown as { store: MemoryStore }).store.db;
  const sarah = db.profiles.find((p) => p.fullName === "Sarah Mitchell");
  const ellis = db.individuals.find((p) => p.fullName === "Ellis Hart");
  assert.ok(sarah, "seed has Sarah Mitchell");
  assert.ok(ellis, "seed has Ellis Hart");
  // Guard the intentional demo design: Sarah is administrator / null-site.
  const membership = db.memberships.find((m) => m.userId === sarah.id);
  assert.equal(membership?.roleKey, "administrator");
  assert.equal(membership?.siteId, null);
  return { db, sarah, ellis };
}

test("medication begin date survives add, update, and reload", async () => {
  const api = new LocalApi(store());
  const { ellis } = await sarahAndEllis(api);
  const medId = await api.addMedication({
    individualId: ellis.id,
    name: "Test Multivitamin",
    strength: "1 tablet",
    kind: "scheduled",
    pillsPerDay: 1,
    remainingPills: 30,
    config: { timeSlots: ["08:00"], beginAt: "2026-09-01" },
  });
  let month = await api.getMarMonth(ellis.id, "2026-09");
  assert.equal(month.meds.find((m) => m.id === medId)?.mar.beginAt, "2026-09-01");

  await api.updateMedication(medId, { config: { beginAt: "2026-09-05" } });
  month = await api.getMarMonth(ellis.id, "2026-09");
  assert.equal(month.meds.find((m) => m.id === medId)?.mar.beginAt, "2026-09-05");
});

test("refused dose notifies the nurse and the acting HM (Sarah Mitchell)", async () => {
  const api = new LocalApi(store());
  const { db, sarah, ellis } = await sarahAndEllis(api);
  const today = todayIso();
  const medId = await api.addMedication({
    individualId: ellis.id,
    name: "Test Antibiotic",
    strength: "250 mg",
    kind: "scheduled",
    pillsPerDay: 2,
    remainingPills: 20,
    config: { timeSlots: ["08:00", "20:00"], beginAt: today },
  });
  await api.recordMarAdministration({
    medicationId: medId,
    administeredOn: today,
    timeSlot: "08:00",
    status: "refused",
    initials: "SM",
    reason: "Individual refused the morning dose.",
    notifyNurse: true,
  });

  const refused = db.notifications.filter((n) => n.type === "med.dose_refused");
  assert.ok(
    refused.some((n) => n.roleKey === "nurse"),
    "nurse role is notified of the refused dose",
  );
  assert.ok(
    refused.some((n) => n.userId === sarah.id),
    "acting HM Sarah Mitchell is notified even though her membership is administrator/null-site",
  );

  // Nurse visibility in the notification center.
  await api.signIn(nurseLogin());
  const nurseNotes = await api.listNotifications();
  assert.ok(
    nurseNotes.some((n) => n.type === "med.dose_refused"),
    "nurse sees med.dose_refused in the notification center",
  );

  // Acting-HM visibility in the notification center.
  await api.signIn(sarahLogin());
  const sarahNotes = await api.listNotifications();
  assert.ok(
    sarahNotes.some((n) => n.type === "med.dose_refused" && n.user_id === sarah.id),
    "Sarah sees the HM-targeted med.dose_refused in the notification center",
  );
});

test("flagged medication concern notifies the nurse", async () => {
  const api = new LocalApi(store());
  const { db, ellis } = await sarahAndEllis(api);
  const today = todayIso();
  const medId = await api.addMedication({
    individualId: ellis.id,
    name: "Test Antibiotic",
    strength: "250 mg",
    kind: "scheduled",
    pillsPerDay: 2,
    remainingPills: 20,
    config: { timeSlots: ["08:00"], beginAt: today },
  });
  await api.flagMarConcern({
    medicationId: medId,
    concernType: "med_error",
    description: "Wrong pill count observed.",
    initials: "SM",
  });

  const flagged = db.notifications.filter((n) => n.type === "med.concern_flagged");
  assert.ok(
    flagged.some((n) => n.roleKey === "nurse"),
    "nurse role is notified of the flagged concern",
  );

  await api.signIn(nurseLogin());
  const nurseNotes = await api.listNotifications();
  assert.ok(
    nurseNotes.some((n) => n.type === "med.concern_flagged"),
    "nurse sees med.concern_flagged in the notification center",
  );
});
