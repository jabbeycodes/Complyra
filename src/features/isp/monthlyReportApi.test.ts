/**
 * Issue #96 — API-level tests for the monthly summary report lifecycle:
 * draft save (upsert), sign lock, re-open, and the PM/administrator gate.
 * Runs against the in-memory LocalApi (the hosted path mirrors it).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "../../data/localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "../../data/seed";
import { DEMO_PASSWORD } from "../../data/types";
import type { SessionUser } from "../../data/types";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function signInAs(impl: LocalApi, username: string): Promise<SessionUser> {
  return impl.signIn(login(username));
}

async function approvedProgramId(impl: LocalApi, individualId: string): Promise<string> {
  const data = await impl.getIspData(individualId);
  const methodId = data.scoringMethods[0].id;
  const programId = await impl.createIspProgram(individualId, {
    name: "2026 ISP — Monthly report test",
    planYear: "2026",
    effectiveOn: "2026-01-01",
    expiresOn: "2026-12-31",
    schedule: "per_shift",
    maxEntriesPerDay: 3,
    scoringMethodId: methodId,
  });
  await impl.saveIspProgramTasks(programId, [{ title: "Community outing", instructions: "" }]);
  await impl.approveIspProgram(programId);
  return programId;
}

async function individualId(impl: LocalApi, name: string): Promise<string> {
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const workspace = await impl.loadWorkspace(admin);
  const person = workspace.individuals.find((i) => i.name === name);
  assert.ok(person, `individual ${name} exists in the demo seed`);
  return person.id;
}

test("issue #96: monthly report draft save / sign / re-open lifecycle", async () => {
  const impl = api();
  const morganId = await individualId(impl, "Morgan Pruitt");
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const programId = await approvedProgramId(impl, morganId);

  // No report yet.
  assert.equal(await impl.getShiftNoteMonthlyReport(morganId, "2026-09"), null);

  // Draft save.
  const draft = await impl.saveShiftNoteMonthlyReport({
    individualId: morganId,
    programId,
    monthKey: "2026-09",
    narrative: "First draft.",
  });
  assert.equal(draft.narrative, "First draft.");
  assert.equal(draft.signedAt, "");

  // Second save updates the same row (one report per individual + month).
  const updated = await impl.saveShiftNoteMonthlyReport({
    individualId: morganId,
    programId,
    monthKey: "2026-09",
    narrative: "Revised draft.",
  });
  assert.equal(updated.id, draft.id);
  assert.equal(updated.narrative, "Revised draft.");

  // Signing an empty narrative fails.
  await impl.saveShiftNoteMonthlyReport({
    individualId: morganId,
    programId,
    monthKey: "2026-10",
    narrative: "   ",
  });
  const emptyReport = await impl.getShiftNoteMonthlyReport(morganId, "2026-10");
  assert.ok(emptyReport);
  await assert.rejects(() => impl.signShiftNoteMonthlyReport(emptyReport.id), /before signing/);

  // Sign locks the report.
  const signed = await impl.signShiftNoteMonthlyReport(draft.id);
  assert.ok(signed.signedAt);
  assert.ok(signed.signedByName);
  assert.ok(signed.signedByTitle);
  await assert.rejects(
    () =>
      impl.saveShiftNoteMonthlyReport({
        individualId: morganId,
        programId,
        monthKey: "2026-09",
        narrative: "Sneaky edit.",
      }),
    /signed/,
  );

  // Re-open clears the lock and allows edits again.
  const reopened = await impl.reopenShiftNoteMonthlyReport(draft.id);
  assert.equal(reopened.signedAt, "");
  const afterReopen = await impl.saveShiftNoteMonthlyReport({
    individualId: morganId,
    programId,
    monthKey: "2026-09",
    narrative: "Edited after re-open.",
  });
  assert.equal(afterReopen.narrative, "Edited after re-open.");

  // Invalid month is rejected.
  await assert.rejects(
    () =>
      impl.saveShiftNoteMonthlyReport({
        individualId: morganId,
        programId,
        monthKey: "2026-13",
        narrative: "x",
      }),
    /valid month/,
  );
});

test("issue #96: DSPs cannot write or sign the monthly summary", async () => {
  const impl = api();
  const morganId = await individualId(impl, "Morgan Pruitt");
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const programId = await approvedProgramId(impl, morganId);

  await signInAs(impl, DEMO_DSP_USERNAME);
  await assert.rejects(
    () =>
      impl.saveShiftNoteMonthlyReport({
        individualId: morganId,
        programId,
        monthKey: "2026-09",
        narrative: "DSP draft.",
      }),
    /PM or administrator/,
  );

  // A DSP can still read the report once it exists.
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const draft = await impl.saveShiftNoteMonthlyReport({
    individualId: morganId,
    programId,
    monthKey: "2026-09",
    narrative: "Manager draft.",
  });
  await signInAs(impl, DEMO_DSP_USERNAME);
  const seen = await impl.getShiftNoteMonthlyReport(morganId, "2026-09");
  assert.equal(seen?.id, draft.id);
  await assert.rejects(() => impl.signShiftNoteMonthlyReport(draft.id), /PM or administrator/);
  await assert.rejects(() => impl.reopenShiftNoteMonthlyReport(draft.id), /PM or administrator/);
});

test("issue #96: getShiftNotesForMonth returns the full month without the 30-note cap", async () => {
  const impl = api();
  const morganId = await individualId(impl, "Morgan Pruitt");
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  const programId = await approvedProgramId(impl, morganId);
  const data = await impl.getIspData(morganId);
  const approved = data.programs.find((p) => p.id === programId)!;
  const yesLevel = approved.scoringMethod!.levels.find((l) => l.caption === "Yes")!;

  await impl.saveShiftNote({
    individualId: morganId,
    programId,
    noteDate: "2026-09-02",
    shift: "7a–3p",
    summary: "",
    timeSpentMinutes: null,
    scores: [{ taskId: approved.tasks[0].id, levelId: yesLevel.id, comment: "" }],
  });
  await impl.saveShiftNote({
    individualId: morganId,
    programId,
    noteDate: "2026-08-30",
    shift: "7a–3p",
    summary: "",
    timeSpentMinutes: null,
    scores: [],
  });

  const september = await impl.getShiftNotesForMonth(morganId, "2026-09");
  assert.equal(september.length, 1);
  assert.equal(september[0].noteDate, "2026-09-02");
  assert.equal(september[0].scores.length, 1);
  assert.equal(september[0].scores[0].taskTitle, "Community outing");
});
