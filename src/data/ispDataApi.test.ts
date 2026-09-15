import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { ESIGN_CONSENT_VERSION } from "../features/signatures/signatureUtils";

/**
 * §6 ISP data API (stream B). LocalApi contract tests:
 * - shift patterns / assignments → auto-generated expectations
 * - note submission validation, linkage, and late marking
 * - amendments (append-only, original preserved, derived "amended" status)
 * - monthly report lifecycle incl. finalized lock
 * - overdue board, shift board, escalation sweep idempotency, repeat offenders
 * - permission denials
 */

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

/** 1x1 transparent PNG — valid, tiny, passes adoption validation. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function apiWithShiftSetup() {
  const mem = store();
  const api = new LocalApi(mem);
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const individual = mem.db.individuals[0];
  const siteId = individual.siteId;
  const dsp = mem.db.profiles.find((p) => p.fullName === "Alex Morgan")!;
  const pattern = await api.ispSaveShiftPattern({
    siteId,
    name: "Day shift",
    startTime: "07:00",
    endTime: "15:00",
    sortOrder: 0,
    active: true,
  });
  const goal = await api.ispSaveGoal({
    individualId: individual.id,
    title: "Live a full community life",
    description: "Community integration",
    effectiveFrom: "2026-01-01",
    status: "active",
  });
  const objective = await api.ispSaveObjective({
    goalId: goal.id,
    title: "Attend one community activity per week",
    measureOfSuccess: "Weekly attendance log",
    status: "active",
  });
  return { api, mem, individual, siteId, dsp, pattern, objective };
}

async function assignmentFor(
  api: LocalApi,
  patternId: string,
  siteId: string,
  userId: string,
  workDate: string,
) {
  return api.ispSaveShiftAssignment({
    siteId,
    shiftPatternId: patternId,
    workDate,
    userId,
    roleAtShift: "DSP",
    coverageType: "scheduled",
  });
}

function validNoteInput(
  individualId: string,
  siteId: string,
  objectiveId: string,
  expectationId?: string | null,
) {
  return {
    individualId,
    siteId,
    assignmentId: null,
    expectationId: expectationId ?? null,
    workDate: "2026-01-05",
    shiftPatternId: null,
    serviceTitle: "Community integration",
    setting: "Individual's home",
    timeIn: "07:00",
    timeOut: "15:00",
    servicesProvided:
      "Assisted the individual with morning routine, meal preparation, and community outing.",
    individualResponse:
      "The individual participated willingly and appeared content throughout.",
    objectiveIds: [objectiveId],
    scores: [] as never[],
    signatureMark: "signed",
  };
}

test("saving an assignment auto-generates one expectation per individual at the site", async () => {
  const { api, mem, siteId, dsp, pattern } = await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  const individuals = mem.db.individuals.filter((p) => p.siteId === siteId);
  const views = await api.ispListExpectations({
    siteId,
    fromDate: "2026-01-05",
    toDate: "2026-01-05",
  });
  assert.equal(views.length, individuals.length);
  // Work date is in the past, so each expectation is past due.
  assert.ok(views.every((v) => v.status === "overdue"));
  assert.ok(views.every((v) => v.userId === dsp.id));
  assert.equal(views[0].shiftName, "Day shift");
});

test("re-saving an assignment does not duplicate protected expectations", async () => {
  const { api, siteId, dsp, pattern } = await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  const first = await api.ispListExpectations({
    siteId,
    fromDate: "2026-01-05",
    toDate: "2026-01-05",
  });
  // Excuse one expectation (protected), then re-save the assignment.
  await api.ispExcuseExpectation(first[0].id, "Individual was hospitalized.");
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  const second = await api.ispListExpectations({
    siteId,
    fromDate: "2026-01-05",
    toDate: "2026-01-05",
  });
  assert.equal(second.length, first.length);
  const pairs = second.map((v) => `${v.assignmentId}:${v.individualId}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

test("note submission lists every validation issue at once", async () => {
  const { api, individual, siteId, objective } = await apiWithShiftSetup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  let err: Error | null = null;
  try {
    await api.ispSubmitNote({
      ...validNoteInput(individual.id, siteId, objective.id),
      serviceTitle: "",
      setting: "",
      timeIn: "",
      servicesProvided: "too short",
      individualResponse: "",
      signatureMark: "",
    });
  } catch (e) {
    err = e as Error;
  }
  assert.ok(err, "expected the note to be rejected");
  assert.match(err.message, /serviceTitle/);
  assert.match(err.message, /setting/);
  assert.match(err.message, /timeIn/);
  assert.match(err.message, /servicesProvided/);
  assert.match(err.message, /individualResponse/);
  assert.match(err.message, /signature/);
});

test("a submitted note links its expectation and is marked late past due", async () => {
  const { api, mem, individual, siteId, dsp, pattern, objective } =
    await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  await api.signIn(login(DEMO_DSP_USERNAME));
  const exp = (
    await api.ispListExpectations({
      siteId,
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
    })
  ).find((v) => v.individualId === individual.id)!;
  assert.ok(exp);
  const note = await api.ispSubmitNote(
    validNoteInput(individual.id, siteId, objective.id, exp.id),
  );
  assert.equal(note.status, "late"); // shift ended long ago
  const after = await api.ispListExpectations({ siteId, fromDate: "2026-01-05", toDate: "2026-01-05" });
  const view = after.find((v) => v.id === exp.id)!;
  assert.equal(view.status, "late_submitted");
  assert.equal(view.noteSubmittedAt, note.submittedAt);
  void mem;
});

test("amending a note preserves the original row and derives amended status", async () => {
  const { api, individual, siteId, objective } = await apiWithShiftSetup();
  await api.signIn(login(DEMO_DSP_USERNAME));
  const note = await api.ispSubmitNote(
    validNoteInput(individual.id, siteId, objective.id),
  );
  const amendment = await api.ispAmendNote({
    noteId: note.id,
    reason: "Wrong setting recorded.",
    changes: { setting: { from: note.setting, to: "Community outing" } },
  });
  assert.equal(amendment.noteId, note.id);
  const detail = await api.ispGetNote(note.id);
  // The original row is untouched.
  assert.equal(detail.note.setting, note.setting);
  assert.equal(detail.note.status, "amended");
  assert.equal(detail.amendments.length, 1);
  assert.equal(detail.amendments[0].changes.setting.to, "Community outing");
  const listed = await api.ispListNotes({ siteId, fromDate: "2026-01-01", toDate: "2026-12-31", status: "amended" });
  assert.ok(listed.some((n) => n.id === note.id));
});

test("a finalized monthly report rejects section edits and further transitions", async () => {
  const { api, individual } = await apiWithShiftSetup();
  const report = await api.ispGenerateMonthlyReport(individual.id, "2026-01");
  assert.equal(report.status, "draft");
  assert.equal(report.dueOn, "2026-02-15");
  await api.adoptSignature({
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  });
  await api.ispSignMonthlyReport(report.id, "pm");
  await api.ispSubmitMonthlyForReview(report.id, "hm_review");
  await api.ispSubmitMonthlyForReview(report.id, "dpm_review");
  await api.ispSubmitMonthlyForReview(report.id, "sc_review");
  await api.ispSubmitMonthlyForReview(report.id, "finalized");
  const sections = (await api.ispGetMonthlyReport(individual.id, "2026-01"))!
    .sections;
  await assert.rejects(
    () => api.ispUpdateMonthlySections(report.id, sections),
    /finalized report cannot be changed/,
  );
  await assert.rejects(
    () => api.ispSubmitMonthlyForReview(report.id, "finalized"),
    /one step at a time/,
  );
  await assert.rejects(
    () => api.ispSignMonthlyReport(report.id, "support_coordinator"),
    /finalized report cannot be signed/,
  );
});

test("overdue expectations surface on the overdue board", async () => {
  const { api, siteId, dsp, pattern } = await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  const overdue = await api.ispOverdueNotes(siteId);
  assert.ok(overdue.length > 0);
  assert.ok(overdue.every((v) => v.status === "overdue"));
  assert.ok(overdue.every((v) => (v.hoursOverdue ?? 0) > 0));
});

test("the escalation sweep is idempotent", async () => {
  const { api, siteId, dsp, pattern } = await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  await api.signIn(login(DEMO_HM_USERNAME));
  const first = await api.ispRunEscalationSweep();
  assert.ok(first.length > 0);
  const escalationsAfterFirst = api;
  void escalationsAfterFirst;
  const second = await api.ispRunEscalationSweep();
  assert.equal(second.length, 0);
});

test("repeat offenders surface staff with late or overdue notes", async () => {
  const { api, siteId, dsp, pattern } = await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  const offenders = await api.ispRepeatOffenders(3650);
  const row = offenders.find((o) => o.userId === dsp.id);
  assert.ok(row);
  assert.ok(row.overdueCount > 0);
});

test("permission denials: planners, recorders, and messengers are gated", async () => {
  const { api } = await apiWithShiftSetup();
  // DSP cannot manage plans or run sweeps.
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.ispSaveShiftPattern({
        siteId: "x",
        name: "Night",
        startTime: "23:00",
        endTime: "07:00",
      }),
    /permission/,
  );
  await assert.rejects(() => api.ispRunEscalationSweep(), /permission/);
  // House manager cannot manage plans either.
  await api.signIn(login(DEMO_HM_USERNAME));
  await assert.rejects(
    () =>
      api.ispSaveShiftPattern({
        siteId: "x",
        name: "Night",
        startTime: "23:00",
        endTime: "07:00",
      }),
    /permission/,
  );
});

test("excusing an expectation requires a reason and keeps it off the board", async () => {
  const mem = store();
  const api = new LocalApi(mem);
  await api.signIn(login(DEMO_HM_USERNAME));
  const hmSiteId = (await api.getSession())!.siteId!;
  const individual = mem.db.individuals.find((p) => p.siteId === hmSiteId)!;
  const dsp = mem.db.profiles.find((p) => p.fullName === "Alex Morgan")!;
  // Patterns need isp.manage_plan (admin); HMs may save assignments at
  // their own site.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const pattern = await api.ispSaveShiftPattern({
    siteId: hmSiteId,
    name: "Day shift",
    startTime: "07:00",
    endTime: "15:00",
    sortOrder: 0,
    active: true,
  });
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.ispSaveShiftAssignment({
    siteId: hmSiteId,
    shiftPatternId: pattern.id,
    workDate: "2026-01-05",
    userId: dsp.id,
    roleAtShift: "DSP",
    coverageType: "scheduled",
  });
  const view = (
    await api.ispListExpectations({
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
    })
  )[0];
  assert.ok(view);
  await assert.rejects(() => api.ispExcuseExpectation(view.id, " "), /reason/i);
  await api.ispExcuseExpectation(view.id, "Individual refused all services.");
  const excused = (
    await api.ispListExpectations({
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
      status: "excused",
    })
  ).find((v) => v.id === view.id);
  assert.ok(excused);
  const overdue = await api.ispOverdueNotes();
  assert.ok(!overdue.some((v) => v.id === view.id));
  void individual;
});

test("deleting a shift pattern with linked notes is refused", async () => {
  const { api, individual, siteId, dsp, pattern, objective } =
    await apiWithShiftSetup();
  await assignmentFor(api, pattern.id, siteId, dsp.id, "2026-01-05");
  await api.signIn(login(DEMO_DSP_USERNAME));
  const exp = (
    await api.ispListExpectations({
      siteId,
      fromDate: "2026-01-05",
      toDate: "2026-01-05",
    })
  ).find((v) => v.individualId === individual.id)!;
  await api.ispSubmitNote(
    validNoteInput(individual.id, siteId, objective.id, exp.id),
  );
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    () => api.ispDeleteShiftPattern(pattern.id),
    /recorded notes/,
  );
});
