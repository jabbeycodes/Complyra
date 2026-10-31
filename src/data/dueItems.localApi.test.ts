import { test } from "node:test";
import assert from "node:assert/strict";
import { blockForShiftLabel } from "./dueItems";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
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

test("a house manager clock changes the missing-note window", async () => {
  const api = new LocalApi(store());
  const { site } = await cedar(api);
  await api.saveSiteFacts(site.id, {
    dayShiftStart: "07:00",
    dayShiftEnd: "15:00",
    eveningShiftStart: "15:00",
    eveningShiftEnd: "23:00",
    overnightShiftStart: "23:00",
    overnightShiftEnd: "07:00",
  });
  const result = await api.getSiteDueItems(site.id);
  const row = result.items.find((item) => item.kind === "shift_note" && item.line2.startsWith("Morgan · Day"));
  assert.ok(row);
  assert.match(row.line2, /7:00 a.m.–3:00 p.m./);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.saveSiteFacts(site.id, {
    dayShiftStart: "06:30",
    dayShiftEnd: "15:00",
    eveningShiftStart: "14:00",
    eveningShiftEnd: "22:30",
    overnightShiftStart: "22:00",
    overnightShiftEnd: "07:00",
  });
  const overlapped = await api.getSiteDueItems(site.id);
  const overlappedDay = overlapped.items.find(
    (item) => item.kind === "shift_note" && item.line2.startsWith("Morgan · Day"),
  );
  assert.match(overlappedDay?.line2 ?? "", /6:30 a.m.–3:00 p.m./);
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () => api.saveSiteFacts(site.id, { dayShiftStart: "08:00" }),
    /house manager/,
  );
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
  // Oxycodone 9:00 a.m. is seeded Given. The 9:00 p.m. dose stays off the list until its window opens.
  assert.ok(!result.items.some((i) => i.line2.includes("Oxycodone") && i.line2.includes("9:00 a.m.")));
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
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  // Levetiracetam is Ellis' keppra scheduled med. A past day is a late mark:
  // it stays allowed, but it must carry a late reason and is stamped Late.
  const medId = `${ellis.id}-med-keppra`;
  await api.markMedDose({
    medicationId: medId,
    doseDate: day,
    doseTime: "08:00",
    status: "given",
    lateReason: "Recorded from the paper MAR the next morning",
  });
  const marks = await api.getMedDoseMarks(ellis.id, day);
  assert.ok(marks.some((m) => m.doseTime === "08:00" && m.status === "given"));
});

test("two refusals in a row notify the nurse", async () => {
  const api = new LocalApi(store());
  const { ellis } = await cedar(api);
  const medId = `${ellis.id}-med-keppra`;
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.addMedDoseException({
    medicationId: medId,
    kind: "refused",
    pillsAffected: 1,
    reason: "Ellis turned away the morning dose",
  });
  await api.addMedDoseException({
    medicationId: medId,
    kind: "refused",
    pillsAffected: 1,
    reason: "Ellis turned away the next dose",
  });
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const notes = await api.listNotifications();
  assert.ok(notes.some((row) => row.type === "med.refusal_review" && row.body.includes("2 times")));
});

test("a dose cannot be marked before its window opens", async () => {
  const api = new LocalApi(store());
  const { ellis } = await cedar(api);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await assert.rejects(
    () =>
      api.markMedDose({
        medicationId: `${ellis.id}-med-keppra`,
        doseDate: day,
        doseTime: "08:00",
        status: "given",
      }),
    /not open yet/,
  );
});

test("a late clock-in adds a point, and the recognition cap stops the next award", async () => {
  const api = new LocalApi(store());
  const { session, workspace } = await cedar(api);
  const alex = workspace.staff.find((member) => member.name === "Alex Morgan");
  assert.ok(alex);
  await api.noteLateClockIn({
    staffId: session.userId,
    scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
    punchedAt: new Date().toISOString(),
    sourceKey: "late-clock-test",
  });
  await api.noteLateClockIn({
    staffId: session.userId,
    scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
    punchedAt: new Date().toISOString(),
    sourceKey: "late-clock-test",
  });
  const notes = await api.listNotifications();
  assert.equal(notes.filter((row) => row.title === "Late clock-in").length, 1);
  const awarded = await api.awardRecognitionPoints({
    recipientId: alex.id,
    points: 20,
    reason: "Covered the house",
  });
  assert.equal(awarded.usedThisMonth, 20);
  assert.equal(awarded.cap, 20);
  await assert.rejects(
    () => api.awardRecognitionPoints({ recipientId: alex.id, points: 1, reason: "One more" }),
    /all 20/,
  );
});

test("a missing Shift note notifies the writer and the administrator once per day", async () => {
  const api = new LocalApi(store());
  await cedar(api);
  const first = await api.listNotifications();
  const missing = first.filter((row) => row.type === "documentation.missing_note");
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.body ?? "", /Morgan/);
  assert.match(missing[0]?.body ?? "", /Alex Morgan/);
  const second = await api.listNotifications();
  assert.equal(second.filter((row) => row.type === "documentation.missing_note").length, 1);
  await api.signIn(login(DEMO_DSP_USERNAME));
  const alex = await api.listNotifications();
  const owed = alex.filter((row) => row.type === "documentation.missing_note");
  assert.equal(owed.length, 1);
  assert.match(owed[0]?.body ?? "", /Morgan/);
});

test("saving the Shift note stops that shift's missing-note reminder", async () => {
  const api = new LocalApi(store());
  const { site, ellis } = await cedar(api);
  const due = await api.getSiteDueItems(site.id);
  const chart = await api.getIspData(ellis.id);
  const program = chart.programs.find((row) => row.status === "approved");
  assert.ok(program);
  const eveningNote = chart.notes.find(
    (note) =>
      note.noteDate === due.serviceDate &&
      note.staffName === "Alex Morgan" &&
      blockForShiftLabel(note.shift) === "evening",
  );
  assert.ok(eveningNote, "Ellis has an evening note the detector is using");
  await api.updateIspProgram(program.id, {
    goalService: "Evening support named in the current PCSP.",
  });
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.deleteShiftNote(eveningNote.id);
  const opened = await api.listNotifications();
  const owed = opened.filter(
    (row) => row.type === "documentation.missing_note" && row.body.includes("Ellis") && !row.read_at,
  );
  assert.equal(owed.length, 1);
  await api.saveShiftNote({
    individualId: ellis.id,
    programId: program.id,
    noteDate: due.serviceDate,
    shift: "Other",
    beginTime: "14:00",
    endTime: "14:15",
    waiverService: "Individualized Supported Living",
    staffTitle: "Direct support professional",
    signatureDataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    summary: "A handoff note does not cover the evening shift. Supported the PCSP goal during the handoff.",
    timeSpentMinutes: 15,
    scores: [],
  });
  const stillOwed = await api.listNotifications();
  assert.equal(
    stillOwed.filter(
      (row) => row.type === "documentation.missing_note" && row.body.includes("Ellis") && !row.read_at,
    ).length,
    1,
  );
  await api.saveShiftNote({
    individualId: ellis.id,
    programId: program.id,
    noteDate: due.serviceDate,
    shift: eveningNote.shift,
    beginTime: "14:00",
    endTime: "22:00",
    waiverService: "Individualized Supported Living",
    staffTitle: "Direct support professional",
    signatureDataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    summary: eveningNote.summary || "Evening note filed. Supported the PCSP goal on this shift.",
    timeSpentMinutes: eveningNote.timeSpentMinutes,
    scores: [],
  });
  const filed = await api.listNotifications();
  assert.equal(
    filed.filter(
      (row) => row.type === "documentation.missing_note" && row.body.includes("Ellis") && !row.read_at,
    ).length,
    0,
  );
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const managers = await api.listNotifications();
  assert.equal(
    managers.filter(
      (row) => row.type === "documentation.missing_note" && row.body.includes("Ellis") && !row.read_at,
    ).length,
    0,
  );
  assert.ok(
    managers.some((row) => row.type === "documentation.missing_note" && row.body.includes("Morgan") && !row.read_at),
  );
});

test("a late kiosk clock-in adds a point with nobody signed in", async () => {
  const api = new LocalApi(store());
  const { session, workspace, site } = await cedar(api);
  const alex = workspace.staff.find((member) => member.name === "Alex Morgan");
  assert.ok(alex);
  await api.signOut();
  await api.noteKioskLateClockIn({
    agencyId: session.agencyId,
    staffId: alex.id,
    siteId: site.id,
    scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
    punchedAt: new Date().toISOString(),
    sourceKey: "kiosk-late-1",
  });
  await api.noteKioskLateClockIn({
    agencyId: session.agencyId,
    staffId: alex.id,
    siteId: site.id,
    scheduledStart: new Date(Date.now() - 5 * 60_000).toISOString(),
    punchedAt: new Date().toISOString(),
    sourceKey: "kiosk-within-minutes",
  });
  await api.signIn(login(DEMO_DSP_USERNAME));
  const notes = await api.listNotifications();
  assert.equal(notes.filter((row) => row.title === "Late clock-in").length, 1);
  assert.match(notes.find((row) => row.title === "Late clock-in")?.body ?? "", /15/);
});

test("a recorded PRN follow-up is what stops the repeat", async () => {
  const api = new LocalApi(store());
  const { ellis } = await cedar(api);
  const medId = `${ellis.id}-med-lorazepam`;
  await api.logPrnDose(medId, { pills: 1, reason: "Anxiety" });
  await api.recordPrnFollowup(medId, { indication: "Anxiety", result: "Calmer after 20 minutes" });
  const notes = await api.listNotifications();
  assert.equal(notes.filter((row) => row.type === "med.prn_repeat").length, 0);
});
