import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ISP_VAGUE_WORDS,
  auditEchoChecklist,
  blankMonthlySections,
  buildExpectations,
  computeDueAt,
  computeEscalationDecisions,
  expectationStatus,
  hoursOverdue,
  repeatOffenders,
  tallyMonthly,
  validateIspNote,
} from "./ispData";
import type {
  IspExpectationView,
  IspGoal,
  IspMeasurementMethod,
  IspMonthlyTallies,
  IspNote,
  IspNoteDetail,
  IspNoteExpectation,
  IspNoteSettings,
  IspNoteTrackableScore,
  IspObjective,
  IspShiftAssignment,
  IspShiftPattern,
  IspTrackable,
  SubmitIspNoteInput,
} from "./types";

const SETTINGS: IspNoteSettings = {
  agencyId: "agency-1",
  noteGraceMinutes: 0,
  nudgeBeforeMinutes: 60,
  hmAlertAfterMinutes: 60,
  dpmEscalationHours: 24,
  contemporaneousDays: 5,
};

const REQUIRED = [
  { id: "t-yesno", name: "Completed task", measurementMethod: "yes_no" as IspMeasurementMethod, ratingMin: null, ratingMax: null },
  { id: "t-count", name: "Repetitions", measurementMethod: "count" as IspMeasurementMethod, ratingMin: null, ratingMax: null },
  { id: "t-rating", name: "Prompt level", measurementMethod: "rating_scale" as IspMeasurementMethod, ratingMin: 1, ratingMax: 5 },
  { id: "t-narr", name: "Observation", measurementMethod: "narrative" as IspMeasurementMethod, ratingMin: null, ratingMax: null },
  { id: "t-pct", name: "Independence %", measurementMethod: "percentage" as IspMeasurementMethod, ratingMin: null, ratingMax: null },
];

function validInput(): SubmitIspNoteInput {
  return {
    individualId: "ind-1",
    siteId: "site-1",
    workDate: "2026-09-14",
    serviceTitle: "Habilitation supports",
    setting: "2124 Brengman",
    timeIn: "07:00",
    timeOut: "15:00",
    servicesProvided: "Assisted with morning routine and meal preparation.",
    individualResponse: "Smiled and chose cereal, ate with verbal prompts only.",
    objectiveIds: ["obj-1"],
    scores: [
      { trackableId: "t-yesno", yesNo: true },
      { trackableId: "t-count", count: 3 },
      { trackableId: "t-rating", rating: 4 },
      { trackableId: "t-narr", text: "Needed one verbal reminder." },
      { trackableId: "t-pct", percentage: 80 },
    ],
    signatureMark: "sig-mark-1",
  };
}

const CTX = { individualName: "Jodie", individualDob: "1990-01-01", requiredTrackables: REQUIRED };

function checkIds(issues: { checkId: string }[]): string[] {
  return issues.map((i) => i.checkId);
}

test("validateIspNote: clean note passes", () => {
  assert.deepEqual(validateIspNote(validInput(), CTX), []);
});

test("validateIspNote: missing individual name blocks (P.8.2)", () => {
  const issues = validateIspNote(validInput(), { ...CTX, individualName: "  " });
  assert.ok(checkIds(issues).includes("P.8.2"));
});

test("validateIspNote: missing/invalid workDate blocks (P.8.5)", () => {
  let issues = validateIspNote({ ...validInput(), workDate: "" }, CTX);
  assert.ok(checkIds(issues).includes("P.8.5"));
  issues = validateIspNote({ ...validInput(), workDate: "2026-13-99" }, CTX);
  assert.ok(checkIds(issues).includes("P.8.5"));
});

test("validateIspNote: time rules block (P.8.5)", () => {
  for (const patch of [
    { timeIn: "", timeOut: "15:00" },
    { timeIn: "07:00", timeOut: "" },
    { timeIn: "25:00", timeOut: "15:00" },
    { timeIn: "15:00", timeOut: "07:00" },
    { timeIn: "07:00", timeOut: "07:00" },
  ]) {
    const issues = validateIspNote({ ...validInput(), ...patch }, CTX);
    assert.ok(
      checkIds(issues).includes("P.8.5"),
      `expected P.8.5 for ${JSON.stringify(patch)}`,
    );
  }
});

test("validateIspNote: blank setting blocks (13 CSR 70-3.030)", () => {
  const issues = validateIspNote({ ...validInput(), setting: " " }, CTX);
  assert.ok(checkIds(issues).includes("13 CSR 70-3.030"));
});

test("validateIspNote: blank service title blocks (P.8.3)", () => {
  const issues = validateIspNote({ ...validInput(), serviceTitle: "" }, CTX);
  assert.ok(checkIds(issues).includes("P.8.3"));
});

test("validateIspNote: short servicesProvided blocks (P.8.3)", () => {
  const issues = validateIspNote({ ...validInput(), servicesProvided: "Helped out." }, CTX);
  assert.ok(checkIds(issues).includes("P.8.3"));
});

test("validateIspNote: vague individual response rejected (P.8.4)", () => {
  for (const vague of ISP_VAGUE_WORDS) {
    for (const variant of [vague, `  ${vague.toUpperCase()}  `]) {
      const issues = validateIspNote(
        { ...validInput(), individualResponse: variant },
        CTX,
      );
      assert.ok(
        checkIds(issues).includes("P.8.4"),
        `expected P.8.4 for ${JSON.stringify(variant)}`,
      );
    }
  }
  const blank = validateIspNote({ ...validInput(), individualResponse: "" }, CTX);
  assert.ok(checkIds(blank).includes("P.8.4"));
});

test("validateIspNote: missing objective linkage blocks (P.10.1)", () => {
  const issues = validateIspNote({ ...validInput(), objectiveIds: [] }, CTX);
  assert.ok(checkIds(issues).includes("P.10.1"));
});

test("validateIspNote: missing trackable score blocks (P.10.2)", () => {
  const input = validInput();
  input.scores = input.scores.filter((s) => s.trackableId !== "t-count");
  const issues = validateIspNote(input, CTX);
  assert.ok(checkIds(issues).includes("P.10.2"));
});

test("validateIspNote: wrong-type trackable scores block (P.10.2)", () => {
  const cases: Array<{ trackableId: string; score: Record<string, unknown> }> = [
    { trackableId: "t-yesno", score: { yesNo: "yes" } },
    { trackableId: "t-count", score: { count: -1 } },
    { trackableId: "t-count", score: { count: 1.5 } },
    { trackableId: "t-rating", score: { rating: 0 } },
    { trackableId: "t-rating", score: { rating: 6 } },
    { trackableId: "t-narr", score: { text: "   " } },
    { trackableId: "t-pct", score: { percentage: 101 } },
    { trackableId: "t-pct", score: { percentage: -5 } },
  ];
  for (const { trackableId, score } of cases) {
    const input = validInput();
    input.scores = input.scores.map((s) =>
      s.trackableId === trackableId ? { trackableId, ...score } : s,
    );
    const issues = validateIspNote(input, CTX);
    assert.ok(
      checkIds(issues).includes("P.10.2"),
      `expected P.10.2 for ${trackableId} ${JSON.stringify(score)}`,
    );
  }
});

test("validateIspNote: missing signature blocks (P.8.7)", () => {
  const issues = validateIspNote({ ...validInput(), signatureMark: "" }, CTX);
  assert.ok(checkIds(issues).includes("P.8.7"));
});

test("computeDueAt: shift end plus grace", () => {
  assert.equal(computeDueAt("2026-09-14", "15:00", 0), "2026-09-14T15:00:00.000Z");
  assert.equal(computeDueAt("2026-09-14", "15:00", 30), "2026-09-14T15:30:00.000Z");
});

test("buildExpectations: one per assignment x individual, skips inactive patterns", () => {
  const patterns = new Map<string, IspShiftPattern>([
    ["p-day", { id: "p-day", agencyId: "a", siteId: "s1", name: "Day", startTime: "07:00", endTime: "15:00", sortOrder: 0, active: true }],
    ["p-off", { id: "p-off", agencyId: "a", siteId: "s1", name: "Old", startTime: "07:00", endTime: "15:00", sortOrder: 1, active: false }],
  ]);
  const assignments: IspShiftAssignment[] = [
    { id: "as-1", agencyId: "a", siteId: "s1", shiftPatternId: "p-day", workDate: "2026-09-14", userId: "u-1", roleAtShift: "DSP", coverageType: "scheduled", note: null },
    { id: "as-2", agencyId: "a", siteId: "s1", shiftPatternId: "p-off", workDate: "2026-09-14", userId: "u-2", roleAtShift: "DSP", coverageType: "scheduled", note: null },
  ];
  const out = buildExpectations({
    assignments,
    individuals: [{ id: "i-1" }, { id: "i-2" }],
    patterns,
    settings: SETTINGS,
  });
  assert.equal(out.length, 2);
  assert.ok(out.every((e) => e.assignmentId === "as-1"));
  assert.deepEqual(out.map((e) => e.individualId).sort(), ["i-1", "i-2"]);
  assert.equal(out[0].dueAt, "2026-09-14T15:00:00.000Z");
  assert.equal(out[0].noteId, null);
});

test("buildExpectations: overnight shift due_at lands next day", () => {
  const patterns = new Map<string, IspShiftPattern>([
    ["p-night", { id: "p-night", agencyId: "a", siteId: "s1", name: "Night", startTime: "23:00", endTime: "07:00", sortOrder: 2, active: true }],
  ]);
  const assignments: IspShiftAssignment[] = [
    { id: "as-n", agencyId: "a", siteId: "s1", shiftPatternId: "p-night", workDate: "2026-09-14", userId: "u-1", roleAtShift: "DSP", coverageType: "scheduled", note: null },
  ];
  const out = buildExpectations({
    assignments,
    individuals: [{ id: "i-1" }],
    patterns,
    settings: { ...SETTINGS, noteGraceMinutes: 15 },
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].workDate, "2026-09-14");
  assert.equal(out[0].dueAt, "2026-09-15T07:15:00.000Z");
});

test("expectationStatus: lifecycle transitions", () => {
  const due = "2026-09-14T15:00:00.000Z";
  const before = new Date("2026-09-14T14:00:00Z");
  const after = new Date("2026-09-14T16:00:00Z");
  const base = { dueAt: due, noteId: null as string | null, noteSubmittedAt: null as string | null, excused: false };
  assert.equal(expectationStatus(base, before), "pending");
  assert.equal(expectationStatus(base, after), "overdue");
  assert.equal(
    expectationStatus({ ...base, noteId: "n-1", noteSubmittedAt: "2026-09-14T14:30:00.000Z" }, after),
    "submitted",
  );
  assert.equal(
    expectationStatus({ ...base, noteId: "n-1", noteSubmittedAt: "2026-09-14T15:30:00.000Z" }, after),
    "late_submitted",
  );
  assert.equal(expectationStatus({ ...base, excused: true }, after), "excused");
});

test("hoursOverdue: 0 before due, fractional hours after", () => {
  assert.equal(hoursOverdue("2026-09-14T15:00:00.000Z", new Date("2026-09-14T14:00:00Z")), 0);
  assert.equal(hoursOverdue("2026-09-14T15:00:00.000Z", new Date("2026-09-14T17:30:00Z")), 2.5);
});

function view(over: Partial<IspExpectationView>): IspExpectationView {
  return {
    id: "e-1",
    agencyId: "a",
    siteId: "s1",
    individualId: "i-1",
    assignmentId: "as-1",
    workDate: "2026-09-14",
    shiftPatternId: "p-day",
    userId: "u-staff",
    dueAt: "2026-09-14T15:00:00.000Z",
    noteId: null,
    excused: false,
    excusedReason: null,
    status: "pending",
    staffName: "Dana",
    individualName: "Jodie",
    siteName: "2124 Brengman",
    shiftName: "Day",
    shiftStart: "07:00",
    shiftEnd: "15:00",
    noteSubmittedAt: null,
    hoursOverdue: null,
    ...over,
  };
}

test("computeEscalationDecisions: nudge when due within window", () => {
  const now = new Date("2026-09-14T14:30:00Z");
  const decisions = computeEscalationDecisions({
    expectations: [view({ dueAt: "2026-09-14T15:00:00.000Z" })],
    sent: [],
    settings: SETTINGS,
    now,
    houseManagerIds: ["hm-1"],
    dpmIds: ["dpm-1"],
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].kind, "nudge");
  assert.equal(decisions[0].toUserId, "u-staff");
  assert.ok(decisions[0].message.includes("Jodie"));
});

test("computeEscalationDecisions: overdue ladders to hm_alert, idempotent via sent rows", () => {
  const now = new Date("2026-09-14T17:00:00Z"); // 2h past due
  const exp = view({ id: "e-2", dueAt: "2026-09-14T15:00:00.000Z" });
  const first = computeEscalationDecisions({
    expectations: [exp],
    sent: [],
    settings: SETTINGS,
    now,
    houseManagerIds: ["hm-1", "hm-2"],
    dpmIds: ["dpm-1"],
  });
  const kinds = first.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ["hm_alert", "hm_alert", "nudge"]);
  assert.ok(first.filter((d) => d.kind === "hm_alert").every((d) => ["hm-1", "hm-2"].includes(d.toUserId)));

  // Second sweep: sent rows suppress repeats.
  const second = computeEscalationDecisions({
    expectations: [exp],
    sent: first.map((d) => ({ expectationId: d.expectationId, kind: d.kind })),
    settings: SETTINGS,
    now,
    houseManagerIds: ["hm-1", "hm-2"],
    dpmIds: ["dpm-1"],
  });
  assert.deepEqual(second, []);
});

test("computeEscalationDecisions: dpm_escalation after 24h", () => {
  const now = new Date("2026-09-15T16:00:00Z"); // 25h past due
  const decisions = computeEscalationDecisions({
    expectations: [view({ id: "e-3", dueAt: "2026-09-14T15:00:00.000Z" })],
    sent: [
      { expectationId: "e-3", kind: "nudge" },
      { expectationId: "e-3", kind: "hm_alert" },
    ],
    settings: SETTINGS,
    now,
    houseManagerIds: ["hm-1"],
    dpmIds: ["dpm-1", "dpm-2"],
  });
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.kind === "dpm_escalation"));
  assert.deepEqual(decisions.map((d) => d.toUserId).sort(), ["dpm-1", "dpm-2"]);
});

test("computeEscalationDecisions: skips submitted and excused", () => {
  const now = new Date("2026-09-14T20:00:00Z");
  const decisions = computeEscalationDecisions({
    expectations: [
      view({ id: "e-s", dueAt: "2026-09-14T15:00:00.000Z", noteId: "n-1", noteSubmittedAt: "2026-09-14T14:00:00.000Z" }),
      view({ id: "e-x", dueAt: "2026-09-14T15:00:00.000Z", excused: true }),
    ],
    sent: [],
    settings: SETTINGS,
    now,
    houseManagerIds: ["hm-1"],
    dpmIds: ["dpm-1"],
  });
  assert.deepEqual(decisions, []);
});

function tallyFixtures() {
  const goals: IspGoal[] = [
    { id: "g-1", agencyId: "a", individualId: "i-1", title: "Independence", description: "", status: "active", effectiveFrom: "2026-01-01", effectiveTo: null, sortOrder: 0 },
  ];
  const objectives: IspObjective[] = [
    { id: "o-1", agencyId: "a", goalId: "g-1", title: "Prepare a simple meal", measureOfSuccess: "", responsibleParty: "DSP", targetDate: null, status: "active", sortOrder: 0 },
  ];
  const trackables: IspTrackable[] = [
    { id: "t-yesno", agencyId: "a", objectiveId: "o-1", name: "Completed task", prompt: "", measurementMethod: "yes_no", ratingMin: null, ratingMax: null, ratingLabels: null, frequency: "per_shift", maxPerShift: null, active: true, sortOrder: 0 },
    { id: "t-count", agencyId: "a", objectiveId: "o-1", name: "Repetitions", prompt: "", measurementMethod: "count", ratingMin: null, ratingMax: null, ratingLabels: null, frequency: "per_shift", maxPerShift: null, active: true, sortOrder: 1 },
    { id: "t-rating", agencyId: "a", objectiveId: "o-1", name: "Prompt level", prompt: "", measurementMethod: "rating_scale", ratingMin: 1, ratingMax: 5, ratingLabels: null, frequency: "per_shift", maxPerShift: null, active: true, sortOrder: 2 },
  ];
  const note = (id: string, workDate: string, status: IspNote["status"]): IspNote => ({
    id, agencyId: "a", individualId: "i-1", siteId: "s1",
    assignmentId: null, expectationId: id.replace("n-", "e-"), workDate,
    shiftPatternId: null, serviceTitle: "Habilitation", setting: "Home",
    timeIn: "07:00", timeOut: "15:00",
    servicesProvided: "Assisted with morning routine and meal preparation.",
    individualResponse: "Participated with verbal prompts.",
    authorUserId: "u-1", authorName: "Dana", authorTitle: "DSP",
    signatureMark: "sig", signatureEventId: null,
    status, submittedAt: `${workDate}T15:00:00.000Z`, createdAt: `${workDate}T15:00:00.000Z`,
  });
  const notes: IspNote[] = [
    note("n-1", "2026-09-05", "submitted"),
    note("n-2", "2026-09-06", "late"),
    note("n-3", "2026-09-07", "submitted"),
    note("n-4", "2026-09-08", "submitted"),
    note("n-0", "2026-08-20", "submitted"), // outside the month
  ];
  const score = (id: string, noteId: string, trackableId: string, patch: Partial<IspNoteTrackableScore>): IspNoteTrackableScore => ({
    id, noteId, trackableId,
    scoreYesNo: null, scoreCount: null, scoreRating: null,
    scorePercentage: null, scoreText: null, comment: null,
    ...patch,
  });
  const scores: IspNoteTrackableScore[] = [
    // n-1: all success
    score("s-1", "n-1", "t-yesno", { scoreYesNo: true }),
    score("s-2", "n-1", "t-count", { scoreCount: 3 }),
    score("s-3", "n-1", "t-rating", { scoreRating: 4 }),
    // n-2: no success anywhere
    score("s-4", "n-2", "t-yesno", { scoreYesNo: false }),
    score("s-5", "n-2", "t-count", { scoreCount: 0 }),
    score("s-6", "n-2", "t-rating", { scoreRating: 2 }),
    // n-3: refusal heuristic via comment
    score("s-7", "n-3", "t-yesno", { scoreYesNo: false, comment: "Refused to participate" }),
    // n-4: no scores at all -> notOffered
  ];
  const expectations: IspNoteExpectation[] = ["n-1", "n-2", "n-3", "n-4"].map((n, i) => ({
    id: n.replace("n-", "e-"), agencyId: "a", siteId: "s1", individualId: "i-1",
    assignmentId: `as-${i}`, workDate: `2026-09-0${5 + i}`, shiftPatternId: "p-day",
    userId: "u-1", dueAt: `2026-09-0${5 + i}T15:00:00.000Z`, noteId: n,
    excused: false, excusedReason: null,
  }));
  const noteObjectives = ["n-1", "n-2", "n-3", "n-4"].map((noteId) => ({ noteId, objectiveId: "o-1" }));
  return { goals, objectives, trackables, notes, scores, expectations, noteObjectives };
}

test("tallyMonthly: success rates, refusals heuristic, note counts", () => {
  const f = tallyFixtures();
  const tallies = tallyMonthly({
    ...f,
    serviceMonth: "2026-09-01",
    priorTallies: null,
  });
  assert.equal(tallies.serviceMonth, "2026-09-01");
  assert.equal(tallies.notesExpected, 4);
  assert.equal(tallies.notesSubmitted, 4);
  assert.equal(tallies.notesLate, 1);
  assert.equal(tallies.notesMissing, 0);
  assert.equal(tallies.perObjective.length, 1);
  const t = tallies.perObjective[0];
  assert.equal(t.objectiveId, "o-1");
  assert.equal(t.goalTitle, "Independence");
  assert.equal(t.opportunities, 4);
  assert.equal(t.completions, 1);
  assert.equal(t.refusals, 1);
  assert.equal(t.notOffered, 1);
  assert.equal(t.successRate, 0.25);
  assert.equal(t.avgRating, 3);
  assert.equal(t.totalCount, 3);
  assert.equal(t.trend, null);
  assert.ok(tallies.narrativeRollup.includes("4 of 4"));
});

test("tallyMonthly: trend vs prior month", () => {
  const f = tallyFixtures();
  const prior: IspMonthlyTallies = {
    serviceMonth: "2026-08-01",
    notesExpected: 4, notesSubmitted: 4, notesLate: 0, notesMissing: 0,
    perObjective: [{
      objectiveId: "o-1", objectiveTitle: "Prepare a simple meal", goalTitle: "Independence",
      opportunities: 4, completions: 2, refusals: 0, notOffered: 0,
      successRate: 0.5, avgRating: 4, totalCount: 6, trend: null,
    }],
    narrativeRollup: "",
  };
  const tallies = tallyMonthly({ ...f, serviceMonth: "2026-09-01", priorTallies: prior });
  assert.equal(tallies.perObjective[0].trend, "down");

  const priorLow: IspMonthlyTallies = {
    ...prior,
    perObjective: [{ ...prior.perObjective[0], successRate: 0.2 }],
  };
  const tallies2 = tallyMonthly({ ...f, serviceMonth: "2026-09-01", priorTallies: priorLow });
  assert.equal(tallies2.perObjective[0].trend, "up");

  const priorFlat: IspMonthlyTallies = {
    ...prior,
    perObjective: [{ ...prior.perObjective[0], successRate: 0.26 }],
  };
  const tallies3 = tallyMonthly({ ...f, serviceMonth: "2026-09-01", priorTallies: priorFlat });
  assert.equal(tallies3.perObjective[0].trend, "flat");
});

test("tallyMonthly: refusals are not completions and don't need the refus- word elsewhere", () => {
  const f = tallyFixtures();
  // n-3's yesNo=false with refusal comment must not count as completion
  const tallies = tallyMonthly({ ...f, serviceMonth: "2026-09-01", priorTallies: null });
  const t = tallies.perObjective[0];
  assert.equal(t.completions + t.refusals + t.notOffered, 3);
});

test("repeatOffenders: groups, filters, and sorts worst-first", () => {
  const now = new Date("2026-09-14T18:00:00Z");
  const exps: IspExpectationView[] = [
    view({ id: "e-1", userId: "u-a", staffName: "Amy", siteName: "House A", status: "overdue", dueAt: "2026-09-14T10:00:00.000Z" }),
    view({ id: "e-2", userId: "u-a", staffName: "Amy", siteName: "House A", status: "overdue", dueAt: "2026-09-13T10:00:00.000Z" }),
    view({ id: "e-3", userId: "u-a", staffName: "Amy", siteName: "House A", status: "late_submitted", dueAt: "2026-09-12T10:00:00.000Z" }),
    view({ id: "e-4", userId: "u-b", staffName: "Bo", siteName: "House B", status: "late_submitted", dueAt: "2026-09-14T10:00:00.000Z" }),
    view({ id: "e-5", userId: "u-c", staffName: "Cy", siteName: "House C", status: "submitted", dueAt: "2026-09-14T10:00:00.000Z" }),
    view({ id: "e-6", userId: "u-d", staffName: "Dee", siteName: "House D", status: "overdue", dueAt: "2026-06-01T10:00:00.000Z" }),
  ];
  const out = repeatOffenders(exps, 30, now);
  assert.equal(out.length, 2); // Cy (clean) and Dee (too old) excluded
  assert.equal(out[0].userId, "u-a");
  assert.equal(out[0].overdueCount, 2);
  assert.equal(out[0].lateCount, 1);
  assert.equal(out[0].totalExpected, 3);
  assert.equal(out[1].userId, "u-b");
});

test("auditEchoChecklist: maps note to P.8.x / P.10.x", () => {
  const good: IspNoteDetail = {
    note: {
      id: "n-1", agencyId: "a", individualId: "i-1", siteId: "s1",
      assignmentId: null, expectationId: null, workDate: "2026-09-14",
      shiftPatternId: null, serviceTitle: "Habilitation", setting: "Home",
      timeIn: "07:00", timeOut: "15:00",
      servicesProvided: "Assisted with morning routine and meal preparation.",
      individualResponse: "Chose cereal and ate with one verbal prompt.",
      authorUserId: "u-1", authorName: "Dana", authorTitle: "DSP",
      signatureMark: "sig", signatureEventId: null,
      status: "submitted", submittedAt: "2026-09-14T15:00:00.000Z",
      createdAt: "2026-09-14T15:00:00.000Z",
    },
    scores: [{ id: "s-1", noteId: "n-1", trackableId: "t-yesno", scoreYesNo: true, scoreCount: null, scoreRating: null, scorePercentage: null, scoreText: null, comment: null }],
    amendments: [],
    expectation: null,
    individualName: "Jodie",
    shiftName: "Day",
  };
  const checks = auditEchoChecklist(good);
  assert.deepEqual(checks.map((c) => c.checkId), ["P.8.2", "P.8.3", "P.8.4", "P.8.5", "P.8.7", "P.10.1", "P.10.2"]);
  assert.ok(checks.every((c) => c.pass));

  const bad: IspNoteDetail = {
    ...good,
    note: { ...good.note, individualResponse: "good", signatureMark: "" },
    scores: [],
    individualName: "",
  };
  const badChecks = auditEchoChecklist(bad);
  const byId = new Map(badChecks.map((c) => [c.checkId, c.pass]));
  assert.equal(byId.get("P.8.2"), false);
  assert.equal(byId.get("P.8.4"), false);
  assert.equal(byId.get("P.8.7"), false);
  assert.equal(byId.get("P.10.1"), false);
});

test("blankMonthlySections: service title kept, everything else blank", () => {
  const s = blankMonthlySections("Habilitation supports");
  assert.equal(s.serviceTitle, "Habilitation supports");
  assert.deepEqual(s.programProgress, []);
  for (const [k, v] of Object.entries(s)) {
    if (k === "serviceTitle" || k === "programProgress") continue;
    assert.equal(v, "", k);
  }
});
