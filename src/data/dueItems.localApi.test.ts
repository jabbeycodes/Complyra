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

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function cedar(api: LocalApi) {
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const site = workspace.sites.find((s) => s.name === "Cedar House")!;
  const ellis = workspace.individuals.find((i) => i.name === "Ellis Hart")!;
  const morgan = workspace.individuals.find((i) => i.name === "Morgan Pruitt")!;
  return { session, workspace, site, ellis, morgan };
}

test("Cedar Overview shows exactly one missing Shift note: Morgan · Day from Alex Morgan", async () => {
  const api = new LocalApi(store());
  const { site } = await cedar(api);
  const result = await api.getSiteDueItems(site.id);
  const shiftRows = result.items.filter((i) => i.kind === "shift_note");
  assert.equal(shiftRows.length, 1, "one intentional gap remains after the demo notes");
  assert.equal(result.shiftNoteCount, 1);
  const row = shiftRows[0];
  assert.equal(row.title, "Missing Shift note");
  assert.equal(row.line2, "Morgan · Day · 6:00 a.m.–2:00 p.m.");
  assert.equal(row.line3, "Needed from Alex Morgan");
  assert.equal(result.basedOnAssignedStaff, true);
});

test("full-morning alone time suppresses every Ellis Day row (non-flag)", async () => {
  const api = new LocalApi(store());
  const { site } = await cedar(api);
  const result = await api.getSiteDueItems(site.id);
  const ellisRows = result.items.filter(
    (i) => i.kind === "shift_note" && i.individualName.startsWith("Ellis"),
  );
  assert.equal(ellisRows.length, 0, "Ellis is covered + alone-time suppressed");
});

test("Willow is fully documented — no shift-note due items", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const willow = workspace.sites.find((s) => s.name === "Willow House")!;
  const result = await api.getSiteDueItems(willow.id);
  assert.equal(result.items.filter((i) => i.kind === "shift_note").length, 0);
});

test("a marked dose never appears; PRN meds never appear", async () => {
  const api = new LocalApi(store());
  const { site } = await cedar(api);
  const result = await api.getSiteDueItems(site.id);
  // Oxycodone 9:00 a.m. is seeded Given → it must never be a due item.
  assert.ok(!result.items.some((i) => i.line2.includes("Oxycodone")));
  // Lorazepam is PRN → never scheduled, never a due item.
  assert.ok(!result.items.some((i) => i.line2.includes("Lorazepam")));
});

test("alone-time CRUD is HM/Admin only and soft-deletes", async () => {
  const api = new LocalApi(store());
  const { ellis } = await cedar(api);
  const seeded = await api.listAloneTime(ellis.id);
  assert.equal(seeded.length, 1, "the demo morning window is seeded");

  const id = await api.saveAloneTimeWindow({
    individualId: ellis.id,
    recurrence: "once",
    onDate: "2026-09-25",
    startTime: "14:00",
    endTime: "16:00",
    note: "Family visit",
  });
  assert.equal((await api.listAloneTime(ellis.id)).length, 2);

  await api.deleteAloneTimeWindow(id);
  const after = await api.listAloneTime(ellis.id);
  assert.equal(after.length, 1, "soft-deleted window drops from the active list");
});

test("a DSP cannot edit alone-time windows", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  const ellis = workspace.individuals.find((i) => i.name === "Ellis Hart")!;
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.saveAloneTimeWindow({
        individualId: ellis.id,
        recurrence: "weekly",
        weekday: 2,
        startTime: "14:00",
        endTime: "16:00",
      }),
    /house manager or administrator/i,
  );
});

test("marking a scheduled dose is recorded and readable", async () => {
  const api = new LocalApi(store());
  const { ellis } = await cedar(api);
  const today = new Date().toISOString().slice(0, 10);
  // Levetiracetam is Ellis' keppra scheduled med.
  const medId = `${ellis.id}-med-keppra`;
  await api.markMedDose({
    medicationId: medId,
    doseDate: today,
    doseTime: "08:00",
    status: "given",
  });
  const marks = await api.getMedDoseMarks(ellis.id, today);
  assert.ok(marks.some((m) => m.doseTime === "08:00" && m.status === "given"));
});
