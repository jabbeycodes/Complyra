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
import {
  activeIspProgram,
  canEditShiftNoteRow,
  clinicianTimes,
  defaultScoreLevels,
  noteBeginMinutes,
  formatDurationHhmm,
  shiftDurationMinutes,
  formatMonthLabel,
  monthBounds,
  monthsWithNotes,
  progressNoteName,
  progressNoteProblem,
  shiftNotesForMonth,
  shiftNotesForPrint,
} from "./shiftNotes";

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function acceptableProgress(summary: string) {
  return {
    beginTime: "07:00",
    endTime: "15:00",
    waiverService: "Individualized Supported Living",
    staffTitle: "Direct support professional",
    signatureDataUrl: PNG_1X1,
    summary,
    timeSpentMinutes: null as number | null,
    scores: [] as { taskId: string; levelId: string; comment: string }[],
  };
}
import { canConfigureIspTasks, canEnterShiftNotes, canSeeShiftNotes } from "./permissions";
import { ispAccountabilityItems } from "./shiftAccountability";
import { dueItemClock } from "./operatingReminders";

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
  await impl.updateIspProgram(program.id, {
    goalService: "Complete the morning routine with one or fewer prompts.",
  });
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);

  // DSP enters a note.
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-09-17",
    shift: "Day",
    ...acceptableProgress("Quiet morning. Supported the morning-routine goal."),
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
  await impl.updateIspProgram(program.id, {
    goalService: "Evening support named in the current PCSP.",
  });
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-09-17",
    shift: "Evening",
    ...acceptableProgress("Supported the evening goal in the current PCSP."),
    beginTime: "14:00",
    endTime: "22:00",
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

test("a shift note keeps its own clock when another note overlaps it", () => {
  assert.equal(shiftDurationMinutes("06:30", "14:30"), 8 * 60);
  assert.equal(shiftDurationMinutes("14:30", "22:30"), 8 * 60);
  assert.equal(shiftDurationMinutes("22:00", "06:30"), 8 * 60 + 30);
  assert.equal(shiftDurationMinutes("14:30", "14:30"), 0);
  assert.equal(formatDurationHhmm(0), "00:00");
  assert.equal(formatDurationHhmm(89), "01:29");
  const morning = clinicianTimes({
    beginTime: "06:30",
    endTime: "14:30",
    shift: "Day",
    timeSpentMinutes: null,
  });
  const evening = clinicianTimes({
    beginTime: "14:30",
    endTime: "22:30",
    shift: "Evening",
    timeSpentMinutes: null,
  });
  assert.equal(morning.beginLabel, "06:30 AM");
  assert.equal(morning.durationLabel, "08:00");
  assert.equal(evening.beginLabel, "02:30 PM");
  assert.equal(evening.endLabel, "10:30 PM");
  assert.equal(
    clinicianTimes({ shift: "7a–3p", timeSpentMinutes: 60 }).durationLabel,
    "08:00",
  );
  assert.ok(
    noteBeginMinutes({ shift: "7a–3p" }) < noteBeginMinutes({ shift: "3p–11p" }),
  );
  assert.ok(
    noteBeginMinutes({ shift: "3p–11p" }) < noteBeginMinutes({ shift: "11p–7a" }),
  );
});

test("overlapping shift notes both save, including a zero-length note", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const data = await impl.getIspData(ellisId);
  const program = data.programs.find((p) => p.status === "approved");
  assert.ok(program);
  await impl.updateIspProgram(program.id, {
    goalService: "Residential support at Cedar House.",
    completionCriteria: "Complete the morning routine with one or fewer prompts.",
    scheduleComment: "Document every overlapping shift.",
  });
  const morningId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-10-06",
    shift: "Day 6:30 a.m.–3:00 p.m.",
    beginTime: "06:30",
    endTime: "14:30",
    location: "Cedar House",
    staffTitle: "Direct Support Staff",
    waiverService: "Individualized Supported Living",
    signatureDataUrl: PNG_1X1,
    summary: "Morning shift overlapped the evening handoff.",
    timeSpentMinutes: null,
    scores: [],
  });
  const eveningId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-10-06",
    shift: "Evening 2:00–10:30 p.m.",
    beginTime: "14:30",
    endTime: "22:30",
    location: "Cedar House",
    waiverService: "Individualized Supported Living",
    signatureDataUrl: PNG_1X1,
    summary: "Evening shift started while the day note was still open.",
    timeSpentMinutes: null,
    scores: [],
  });
  const zeroId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-10-06",
    shift: "Other",
    beginTime: "14:30",
    endTime: "14:30",
    location: "Cedar House",
    waiverService: "Individualized Supported Living",
    signatureDataUrl: PNG_1X1,
    summary: "Handoff only. Supported the residential goal during the overlap.",
    timeSpentMinutes: null,
    scores: [],
  });
  const after = await impl.getIspData(ellisId);
  const morning = after.notes.find((note) => note.id === morningId);
  const evening = after.notes.find((note) => note.id === eveningId);
  const zero = after.notes.find((note) => note.id === zeroId);
  assert.equal(morning?.timeSpentMinutes, 480);
  assert.equal(morning?.location, "Cedar House");
  assert.equal(morning?.staffTitle, "Direct Support Staff");
  assert.equal(evening?.beginTime, "14:30");
  assert.equal(evening?.endTime, "22:30");
  assert.equal(zero?.timeSpentMinutes, 0);
  assert.equal(after.programs.find((row) => row.id === program.id)?.goalService, "Residential support at Cedar House.");
});

test("a new progress note needs the current PCSP goal, a waiver service, and a signature", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const data = await impl.getIspData(ellisId);
  const program = data.programs.find((p) => p.status === "approved");
  assert.ok(program);
  assert.equal(progressNoteName("Ellis James Hart"), "Ellis J. Hart");
  assert.equal(progressNoteName("Ellis Hart"), "Ellis Hart");
  assert.match(
    progressNoteProblem({
      goalService: "",
      beginTime: "07:00",
      endTime: "15:00",
      waiverService: "Individualized Supported Living",
      summary: "Supported the goal.",
      staffTitle: "Direct support professional",
      signatureDataUrl: PNG_1X1,
    }) ?? "",
    /current PCSP/,
  );
  await assert.rejects(
    () =>
      impl.saveShiftNote({
        individualId: ellisId,
        programId: program.id,
        noteDate: "2026-10-07",
        shift: "Day",
        ...acceptableProgress("Supported the goal before it was on the program."),
      }),
    /current PCSP/,
  );
  await impl.updateIspProgram(program.id, {
    goalService: "Morning routine in the current PCSP.",
  });
  await assert.rejects(
    () =>
      impl.saveShiftNote({
        individualId: ellisId,
        programId: program.id,
        noteDate: "2026-10-07",
        shift: "Day",
        ...acceptableProgress("Supported the morning routine."),
        signatureDataUrl: "",
      }),
    /signature/,
  );
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: "2026-10-07",
    shift: "Day",
    ...acceptableProgress("Ellis completed the morning routine. I prompted once, which is the support the PCSP asks for."),
  });
  const saved = (await impl.getIspData(ellisId)).notes.find((note) => note.id === noteId);
  assert.equal(saved?.waiverService, "Individualized Supported Living");
  assert.equal(saved?.signatureDataUrl, PNG_1X1);
  assert.equal(saved?.staffTitle, "Direct support professional");
});

test("issue #80: default scoring levels are Yes / No / Refused", () => {
  assert.deepEqual(
    defaultScoreLevels().map((l) => l.caption),
    ["Yes", "No", "Refused"],
  );
});

test("a calendar month is that month's notes and nothing written around it", () => {
  const notes = [
    { noteDate: "2026-09-30" },
    { noteDate: "2026-10-01" },
    { noteDate: "2026-10-31" },
    { noteDate: "2026-11-01" },
  ];
  const october = shiftNotesForMonth(notes, "2026-10");
  assert.deepEqual(
    october.notes.map((note) => note.noteDate),
    ["2026-10-01", "2026-10-31"],
  );
  assert.equal(october.from, "2026-10-01");
  assert.equal(october.to, "2026-10-31");
  assert.equal(formatMonthLabel("2026-10"), "October 2026");
  assert.deepEqual(monthsWithNotes(notes), ["2026-11", "2026-10", "2026-09"]);
  assert.equal(monthBounds("2026-02")?.to, "2026-02-28");
  assert.equal(monthBounds("2024-02")?.to, "2024-02-29");
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(shiftNotesForMonth(notes, "nope").notes.length, 0);
});

test("shift note print window stays on the last 14 days, then falls back to notes on file", () => {
  const live = shiftNotesForPrint(
    [{ noteDate: "2026-10-01" }, { noteDate: "2026-09-01" }],
    "2026-10-13",
  );
  assert.equal(live.coversToday, true);
  assert.deepEqual(live.notes.map((note) => note.noteDate), ["2026-10-01"]);

  const saved = shiftNotesForPrint(
    [{ noteDate: "2026-09-16" }, { noteDate: "2026-09-29" }, { noteDate: "2026-08-01" }],
    "2026-10-13",
  );
  assert.equal(saved.coversToday, false);
  assert.equal(saved.from, "2026-09-16");
  assert.equal(saved.to, "2026-09-29");
  assert.equal(saved.notes.length, 2);
});

test("quick log identity: a note saved through the shared API is the chart's record and today's ISP collection", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const ellisId = await individualId(impl, admin, "Ellis Hart");
  const morganId = await individualId(impl, admin, "Morgan Pruitt");
  // The Central service date the mobile surfaces call "today".
  const today = dueItemClock(new Date()).doseDate;

  // A manager records the plan's goal text first — the API's
  // progress-note rule requires it before any new note can be saved.
  const adminData = await impl.getIspData(ellisId);
  const program = adminData.programs.find((p) => p.status === "approved");
  assert.ok(program);
  await impl.updateIspProgram(program.id, {
    goalService: "Complete the morning routine with one or fewer prompts.",
  });

  // Gather the accountability inputs the way the Quick log chooser
  // does: per-person getIspData reads as the signed-in DSP.
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const people = [
    { id: ellisId, name: "Ellis Hart" },
    { id: morganId, name: "Morgan Pruitt" },
  ];
  const gather = async () => {
    const perPerson = await Promise.all(
      people.map((person) => impl.getIspData(person.id)),
    );
    return {
      programs: perPerson.flatMap((data) => data.programs),
      notes: perPerson.flatMap((data) => data.notes),
    };
  };
  const before = await gather();
  const beforeItems = ispAccountabilityItems({
    people,
    programs: before.programs,
    notes: before.notes,
    dates: [today],
  });
  // Only Ellis carries an expectation (Morgan's program is a draft),
  // and the seeded notes are dated yesterday — nothing written today.
  assert.equal(beforeItems.length, 1);
  assert.equal(beforeItems[0].done, false);

  // The exact save the mobile composer makes (MobileIsp's entry form
  // → api.saveShiftNote — the Quick log mounts that same form; there
  // is no second store and no separate ISP record anywhere).
  const yesLevel = program.scoringMethod!.levels.find(
    (level) => level.caption === "Yes",
  )!;
  const noteId = await impl.saveShiftNote({
    individualId: ellisId,
    programId: program.id,
    noteDate: today,
    shift: "7a–3p",
    beginTime: "07:00",
    endTime: "15:00",
    location: "Cedar House",
    staffTitle: dsp.jobTitle,
    waiverService: "Individualized Supported Living",
    signatureDataUrl: PNG_1X1,
    summary:
      "Supported Ellis through the morning routine and a community outing.",
    timeSpentMinutes: 480,
    scores: [
      { taskId: program.tasks[0].id, levelId: yesLevel.id, comment: "" },
    ],
  });

  // The desktop chart's Shift notes section reads getIspData — the
  // note saved from the phone door is the record it shows.
  const chartData = await impl.getIspData(ellisId);
  const saved = chartData.notes.find((note) => note.id === noteId);
  assert.ok(saved, "the saved note is on the chart's shift-note read");
  assert.equal(saved.noteDate, today);
  assert.equal(saved.programId, program.id);

  // And the accountability engine counts that same note as the
  // Individual's ISP data collection for the service date.
  const after = await gather();
  const afterItems = ispAccountabilityItems({
    people,
    programs: after.programs,
    notes: after.notes,
    dates: [today],
  });
  assert.equal(afterItems.length, 1);
  assert.equal(afterItems[0].done, true);
});
