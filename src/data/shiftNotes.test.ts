import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import type { SessionUser } from "./types";
import { activeIspProgram, canEditShiftNoteRow, defaultScoreLevels } from "./shiftNotes";
import { canConfigureIspTasks, canEnterShiftNotes, canSeeShiftNotes } from "./permissions";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function signInAs(impl: LocalApi, username: string): Promise<SessionUser> {
  return impl.signIn(login(username));
}

async function individualId(impl: LocalApi, session: SessionUser, name: string) {
  const workspace = await impl.loadWorkspace(session);
  const person = workspace.individuals.find((i) => i.name === name);
  assert.ok(person, `individual ${name} exists in the demo seed`);
  return person.id;
}

test("issue #80 role gates: config is PM/administrator only, entry covers staff", () => {
  assert.equal(canConfigureIspTasks("administrator"), true);
  assert.equal(canConfigureIspTasks("program_manager"), true);
  assert.equal(canConfigureIspTasks("house_manager"), false);
  assert.equal(canConfigureIspTasks("dsp"), false);
  assert.equal(canConfigureIspTasks("nurse"), false);
  assert.equal(canEnterShiftNotes("program_manager"), true);
  assert.equal(canEnterShiftNotes("house_manager"), true);
  assert.equal(canEnterShiftNotes("nurse"), true);
  assert.equal(canEnterShiftNotes("dsp"), true);
  assert.equal(canEnterShiftNotes("auditor"), false);
  assert.equal(canSeeShiftNotes("auditor"), true);
  assert.equal(canSeeShiftNotes("compliance_admin"), true);
});

test("issue #80: draft programs are invisible to staff, approval opens notes", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const morganId = await individualId(impl, admin, "Morgan Pruitt");

  // DSP sees no program for Morgan Pruitt (only a draft exists).
  await signInAs(impl, DEMO_DSP_USERNAME);
  const dspData = await impl.getIspData(morganId);
  assert.equal(dspData.programs.length, 0);
  assert.equal(activeIspProgram(dspData.programs, morganId, "2026"), null);

  // Administrator sees the draft.
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const adminData = await impl.getIspData(morganId);
  assert.equal(adminData.programs.length, 1);
  assert.equal(adminData.programs[0].status, "draft");

  // DSP cannot save a note against the draft program.
  await signInAs(impl, DEMO_DSP_USERNAME);
  await assert.rejects(
    () =>
      impl.saveShiftNote({
        individualId: morganId,
        programId: adminData.programs[0].id,
        noteDate: "2026-09-17",
        shift: "Day",
        summary: "",
        timeSpentMinutes: null,
        scores: [],
      }),
    /approved ISP program/,
  );

  // Approving with no tasks fails; adding tasks then approving works.
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const bareId = await impl.createIspProgram(morganId, {
    name: "2026 ISP — Bare draft",
    planYear: "2026",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    schedule: "per_day",
    maxEntriesPerDay: 1,
    scoringMethodId: adminData.scoringMethods[0].id,
  });
  await assert.rejects(() => impl.approveIspProgram(bareId), /task/);
  await impl.saveIspProgramTasks(bareId, [
    { title: "Attend one community outing", instructions: "" },
  ]);
  await impl.approveIspProgram(bareId);

  // Approving Morgan Pruitt's seeded draft (it has a task) works too, and
  // supersedes the bare draft approved just before it.
  await impl.approveIspProgram(adminData.programs[0].id);
  const adminAfterApprove = await impl.getIspData(morganId);
  assert.equal(
    adminAfterApprove.programs.find((p) => p.id === adminData.programs[0].id)?.status,
    "approved",
  );

  // Now the DSP sees it.
  await signInAs(impl, DEMO_DSP_USERNAME);
  const dspAfter = await impl.getIspData(morganId);
  assert.equal(dspAfter.programs.length, 1);
  assert.equal(dspAfter.programs[0].status, "approved");
});

test("issue #80: DSPs edit only their own notes; HM/PM/admin may edit in scope", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const data = await impl.getIspData(ellisId);
  const program = data.programs.find((p) => p.status === "approved");
  assert.ok(program);
  const yesLevel = program.scoringMethod!.levels.find((l) => l.caption === "Yes")!;
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);

  // DSP enters a note.
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-09-17",
    shift: "Day",
    summary: "Quiet morning.",
    timeSpentMinutes: 30,
    scores: [{ taskId: program.tasks[0].id, levelId: yesLevel.id, comment: "Independent" }],
  });
  const note = { staffUserId: dsp.userId };

  // Row-level edit rules.
  assert.equal(canEditShiftNoteRow("dsp", "someone-else", note), false);
  assert.equal(canEditShiftNoteRow("dsp", dsp.userId, note), true);
  assert.equal(canEditShiftNoteRow("nurse", "someone-else", note), false);
  assert.equal(canEditShiftNoteRow("house_manager", "someone-else", note), true);
  assert.equal(canEditShiftNoteRow("program_manager", "someone-else", note), true);
  assert.equal(canEditShiftNoteRow("administrator", "someone-else", note), true);

  // A privileged role edits the DSP's note in scope (admin is agency-wide).
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  await impl.saveShiftNote({
    noteId,
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-09-17",
    shift: "Day",
    summary: "Quiet morning. Reviewed by admin.",
    timeSpentMinutes: 30,
    scores: [],
  });
  const notesAfter = await impl.getIspData(ellisId);
  assert.equal(notesAfter.notes.find((n) => n.id === noteId)?.summary, "Quiet morning. Reviewed by admin.");

  // A different DSP (simulated via the row rule) cannot; the author still can.
  assert.equal(canEditShiftNoteRow("dsp", "other-dsp-id", note), false);
});

test("issue #80: cross-record edit is rejected", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const data = await impl.getIspData(ellisId);
  const program = data.programs.find((p) => p.status === "approved");
  assert.ok(program);
  const otherId = await impl.createIspProgram(ellisId, {
    name: "2026 ISP — Second program",
    planYear: "2026",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    schedule: "per_shift",
    maxEntriesPerDay: 1,
    scoringMethodId: data.scoringMethods[0].id,
  });
  await impl.saveIspProgramTasks(otherId, [{ title: "Other task", instructions: "" }]);
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-09-17",
    shift: "Evening",
    summary: "",
    timeSpentMinutes: null,
    scores: [],
  });
  // Approving the second program supersedes the first; the cross-record
  // attempt uses the still-approved second program id.
  await impl.approveIspProgram(otherId);
  // Same note id, but claimed against a different program → not found.
  await assert.rejects(
    () =>
      impl.saveShiftNote({
        noteId,
        individualId: ellisId,
        programId: otherId,
        noteDate: "2026-09-17",
        shift: "Evening",
        summary: "x",
        timeSpentMinutes: null,
        scores: [],
      }),
    /not found/,
  );
});

test("issue #80: approving a new program supersedes the old approved one", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const before = await impl.getIspData(ellisId);
  const current = before.programs.find((p) => p.status === "approved");
  assert.ok(current);

  const nextId = await impl.createIspProgram(ellisId, {
    name: "2026 ISP — Evening supports",
    planYear: "2026",
    effectiveOn: "2026-07-01",
    expiresOn: "2026-12-31",
    schedule: "per_shift",
    maxEntriesPerDay: 2,
    scoringMethodId: before.scoringMethods[0].id,
  });
  await impl.saveIspProgramTasks(nextId, [{ title: "Evening routine", instructions: "" }]);
  await impl.approveIspProgram(nextId);

  const after = await impl.getIspData(ellisId);
  assert.equal(after.programs.find((p) => p.id === current.id)?.status, "superseded");
  assert.equal(after.programs.find((p) => p.id === nextId)?.status, "approved");
});

test("issue #80: default scoring levels are Yes / No / Refused", () => {
  assert.deepEqual(
    defaultScoreLevels().map((l) => l.caption),
    ["Yes", "No", "Refused"],
  );
});
