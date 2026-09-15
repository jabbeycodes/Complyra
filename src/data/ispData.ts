/**
 * ISP DATA — pure logic for Missouri ISP shift notes, plan tracking, and
 * monthly program-progress reports.
 *
 * Everything here is deterministic and side-effect free: the API layers
 * (localApi/hostedApi, stream B) and the UI (stream C) reuse these exact
 * functions so validation, due-date math, escalation decisions, and monthly
 * tallies behave identically everywhere.
 *
 * DMH check references (P.8.x / P.10.x) mirror the audit-echo checklist in
 * the QA audit workstream; the wording is Complyrer's own.
 */
import type {
  IspEscalationKind,
  IspExpectationStatus,
  IspExpectationView,
  IspGoal,
  IspMeasurementMethod,
  IspMonthlySections,
  IspMonthlyTallies,
  IspNote,
  IspNoteDetail,
  IspNoteExpectation,
  IspNoteSettings,
  IspNoteTrackableScore,
  IspObjective,
  IspObjectiveTally,
  IspRepeatOffender,
  IspShiftAssignment,
  IspShiftPattern,
  IspTrackable,
  SubmitIspNoteInput,
} from "./types";

/** Words that describe nothing — P.8.4 requires describing, not labeling. */
export const ISP_VAGUE_WORDS = [
  "good",
  "bad",
  "fine",
  "ok",
  "okay",
  "no problems",
  "n/a",
];

export interface IspValidationIssue {
  /** checkId: "P.8.2" etc. */
  field: string;
  message: string;
  checkId: string;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function isVagueResponse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ISP_VAGUE_WORDS.some((w) => w === normalized);
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * DMH shift-note validation. Every rule is blocking: the API throws listing
 * all issues, and the UI shows the live audit-echo checklist beside the form.
 */
export function validateIspNote(
  input: SubmitIspNoteInput,
  ctx: {
    individualName: string;
    individualDob: string;
    requiredTrackables: Array<{
      id: string;
      name: string;
      measurementMethod: IspMeasurementMethod;
      ratingMin: number | null;
      ratingMax: number | null;
    }>;
  },
): IspValidationIssue[] {
  const issues: IspValidationIssue[] = [];
  const push = (field: string, message: string, checkId: string) =>
    issues.push({ field, message, checkId });

  if (isBlank(ctx.individualName)) {
    push(
      "individualId",
      "The note must name the individual it documents.",
      "P.8.2",
    );
  }
  if (isBlank(input.workDate) || !isValidDate(input.workDate)) {
    push(
      "workDate",
      "Enter the date the shift happened (yyyy-mm-dd).",
      "P.8.5",
    );
  }
  if (isBlank(input.timeIn) || !isValidTime(input.timeIn)) {
    push(
      "timeIn",
      "Enter a valid shift start time (HH:MM).",
      "P.8.5",
    );
  }
  if (isBlank(input.timeOut) || !isValidTime(input.timeOut)) {
    push(
      "timeOut",
      "Enter a valid shift end time (HH:MM).",
      "P.8.5",
    );
  }
  if (
    isValidTime(input.timeIn) &&
    isValidTime(input.timeOut) &&
    input.timeIn >= input.timeOut
  ) {
    push(
      "timeOut",
      "Shift end must be after shift start.",
      "P.8.5",
    );
  }
  if (isBlank(input.setting)) {
    push("setting", "Record where the service was provided.", "13 CSR 70-3.030");
  }
  if (isBlank(input.serviceTitle)) {
    push("serviceTitle", "Give the note a service title.", "P.8.3");
  }
  if (isBlank(input.servicesProvided) || input.servicesProvided.trim().length < 20) {
    push(
      "servicesProvided",
      "Describe the services provided in at least 20 characters.",
      "P.8.3",
    );
  }
  if (isBlank(input.individualResponse)) {
    push(
      "individualResponse",
      "Describe the individual's response to the service.",
      "P.8.4",
    );
  } else if (isVagueResponse(input.individualResponse)) {
    push(
      "individualResponse",
      `Describe the individual's response — "${input.individualResponse.trim()}" alone doesn't say what happened.`,
      "P.8.4",
    );
  }
  if (!input.objectiveIds || input.objectiveIds.length < 1) {
    push(
      "objectiveIds",
      "Link the note to at least one ISP objective.",
      "P.10.1",
    );
  }
  const scoresByTrackable = new Map(
    (input.scores ?? []).map((s) => [s.trackableId, s]),
  );
  for (const t of ctx.requiredTrackables) {
    const score = scoresByTrackable.get(t.id);
    const label = `Score for "${t.name}"`;
    if (!score) {
      push("scores", `${label} is missing.`, "P.10.2");
      continue;
    }
    switch (t.measurementMethod) {
      case "yes_no":
        if (typeof score.yesNo !== "boolean") {
          push("scores", `${label} needs a yes/no answer.`, "P.10.2");
        }
        break;
      case "count":
        if (
          typeof score.count !== "number" ||
          !Number.isInteger(score.count) ||
          score.count < 0
        ) {
          push("scores", `${label} needs a whole number 0 or higher.`, "P.10.2");
        }
        break;
      case "rating_scale": {
        const min = t.ratingMin ?? 1;
        const max = t.ratingMax ?? 5;
        if (
          typeof score.rating !== "number" ||
          !Number.isInteger(score.rating) ||
          score.rating < min ||
          score.rating > max
        ) {
          push(
            "scores",
            `${label} needs a rating between ${min} and ${max}.`,
            "P.10.2",
          );
        }
        break;
      }
      case "narrative":
        if (isBlank(score.text)) {
          push("scores", `${label} needs a written observation.`, "P.10.2");
        }
        break;
      case "percentage":
        if (
          typeof score.percentage !== "number" ||
          score.percentage < 0 ||
          score.percentage > 100
        ) {
          push("scores", `${label} needs a percentage from 0 to 100.`, "P.10.2");
        }
        break;
    }
  }
  if (isBlank(input.signatureMark)) {
    push(
      "signatureMark",
      "Sign the note — an unsigned note isn't a record.",
      "P.8.7",
    );
  }
  return issues;
}

/**
 * Audit-echo checklist: maps a saved note to the DMH checks (P.8.2, P.8.3,
 * P.8.4, P.8.5, P.8.7, P.10.1, P.10.2) with plain-language hints for the
 * auditor. Rendered live beside the note form.
 */
export function auditEchoChecklist(
  detail: IspNoteDetail,
): Array<{ checkId: string; label: string; pass: boolean; hint: string }> {
  const note = detail.note;
  const hasTime = isValidTime(note.timeIn) && isValidTime(note.timeOut);
  const timeOrder = hasTime && note.timeIn < note.timeOut;
  const checks: Array<{
    checkId: string;
    label: string;
    pass: boolean;
    hint: string;
  }> = [
    {
      checkId: "P.8.2",
      label: "Names the individual",
      pass: !isBlank(detail.individualName),
      hint: "Every note must identify who it documents.",
    },
    {
      checkId: "P.8.3",
      label: "Complete — no blank required fields",
      pass:
        !isBlank(note.serviceTitle) &&
        !isBlank(note.setting) &&
        note.servicesProvided.trim().length >= 20 &&
        !isBlank(note.individualResponse),
      hint: "Title, setting, a real description of services (20+ characters), and the individual's response.",
    },
    {
      checkId: "P.8.4",
      label: "Describes the response, doesn't just label it",
      pass:
        !isBlank(note.individualResponse) &&
        !isVagueResponse(note.individualResponse),
      hint: `"${ISP_VAGUE_WORDS.join('", "')}" alone don't count — say what the person did or said.`,
    },
    {
      checkId: "P.8.5",
      label: "Date and times in order",
      pass: isValidDate(note.workDate) && hasTime && timeOrder,
      hint: "Service date plus a start time before the end time.",
    },
    {
      checkId: "P.8.7",
      label: "Signed by the author",
      pass: !isBlank(note.signatureMark),
      hint: "Staff name and title come from the signed-in session, plus the author's signature mark.",
    },
    {
      checkId: "P.10.1",
      label: "Tied to ISP objectives",
      pass: detail.scores.length > 0,
      hint: "The note must link to at least one ISP objective.",
    },
    {
      checkId: "P.10.2",
      label: "Objective data recorded",
      pass: detail.scores.length > 0,
      hint: "Each required trackable gets a score of the right type.",
    },
  ];
  return checks;
}

/** Parse "HH:MM" into minutes since midnight. */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Due-at for a note expectation: shift end on `workDate` plus the agency's
 * grace minutes, as an ISO timestamp (UTC). Callers pass the *end* date for
 * overnight shifts (see buildExpectations).
 */
export function computeDueAt(
  workDate: string,
  shiftEnd: string,
  graceMinutes: number,
): string {
  const due = new Date(`${workDate}T${shiftEnd}:00Z`);
  due.setUTCMinutes(due.getUTCMinutes() + graceMinutes);
  return due.toISOString();
}

/**
 * Build one note expectation per (shift assignment × individual). Inactive
 * shift patterns are skipped. Overnight patterns (end <= start, e.g.
 * 23:00–07:00) get a due_at on the next calendar day.
 */
export function buildExpectations(args: {
  assignments: IspShiftAssignment[];
  individuals: Array<{ id: string }>;
  patterns: Map<string, IspShiftPattern>;
  settings: IspNoteSettings;
}): Array<
  Omit<
    IspNoteExpectation,
    "id" | "agencyId" | "siteId" | "excused" | "excusedReason"
  > & { siteId: string }
> {
  const out: Array<
    Omit<
      IspNoteExpectation,
      "id" | "agencyId" | "siteId" | "excused" | "excusedReason"
    > & { siteId: string }
  > = [];
  for (const a of args.assignments) {
    const pattern = args.patterns.get(a.shiftPatternId);
    if (!pattern || !pattern.active) continue;
    const overnight = timeToMinutes(pattern.endTime) <= timeToMinutes(pattern.startTime);
    const endDate = overnight ? addDaysIso(a.workDate, 1) : a.workDate;
    const dueAt = computeDueAt(
      endDate,
      pattern.endTime,
      args.settings.noteGraceMinutes,
    );
    for (const ind of args.individuals) {
      out.push({
        siteId: a.siteId,
        individualId: ind.id,
        assignmentId: a.id,
        workDate: a.workDate,
        shiftPatternId: a.shiftPatternId,
        userId: a.userId,
        dueAt,
        noteId: null,
      });
    }
  }
  return out;
}

/**
 * Expectation lifecycle: pending → submitted | late_submitted | overdue,
 * or excused at any point.
 */
export function expectationStatus(
  exp: {
    dueAt: string;
    noteId: string | null;
    noteSubmittedAt: string | null;
    excused: boolean;
  },
  now: Date,
): IspExpectationStatus {
  if (exp.excused) return "excused";
  if (exp.noteId) {
    const submittedAt = exp.noteSubmittedAt ? Date.parse(exp.noteSubmittedAt) : NaN;
    if (!Number.isNaN(submittedAt) && submittedAt > Date.parse(exp.dueAt)) {
      return "late_submitted";
    }
    return "submitted";
  }
  return now.getTime() > Date.parse(exp.dueAt) ? "overdue" : "pending";
}

/** Whole hours past due_at (0 when not yet due). */
export function hoursOverdue(dueAt: string, now: Date): number {
  const ms = now.getTime() - Date.parse(dueAt);
  if (ms <= 0) return 0;
  return Math.round((ms / 3600000) * 100) / 100;
}

export interface IspEscalationDecision {
  expectationId: string;
  kind: IspEscalationKind;
  toUserId: string;
  message: string;
}

function formatDueAt(dueAt: string): { date: string; time: string } {
  const d = new Date(dueAt);
  const date = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return { date, time: `${hh}:${mm}` };
}

/**
 * Escalation sweep decisions. Idempotent via the `sent` rows: a kind is only
 * ever decided once per expectation.
 *
 * - pending and due within the nudge window (or already overdue) with no
 *   prior nudge → nudge to the assigned staffer.
 * - past due_at + hm_alert_after_minutes with no hm_alert → hm_alert to
 *   each house manager.
 * - past due_at + dpm_escalation_hours with no dpm_escalation → escalation
 *   to each DPM.
 */
export function computeEscalationDecisions(args: {
  expectations: IspExpectationView[];
  sent: Array<{ expectationId: string | null; kind: IspEscalationKind }>;
  settings: IspNoteSettings;
  now: Date;
  houseManagerIds: string[];
  dpmIds: string[];
}): IspEscalationDecision[] {
  const sentKinds = new Map<string, Set<IspEscalationKind>>();
  for (const s of args.sent) {
    if (!s.expectationId) continue;
    let set = sentKinds.get(s.expectationId);
    if (!set) {
      set = new Set();
      sentKinds.set(s.expectationId, set);
    }
    set.add(s.kind);
  }
  const decisions: IspEscalationDecision[] = [];
  const nowMs = args.now.getTime();
  const nudgeWindowMs = args.settings.nudgeBeforeMinutes * 60000;
  const hmAlertAfterMs = args.settings.hmAlertAfterMinutes * 60000;
  const dpmAfterMs = args.settings.dpmEscalationHours * 3600000;

  for (const exp of args.expectations) {
    const status = expectationStatus(
      {
        dueAt: exp.dueAt,
        noteId: exp.noteId,
        noteSubmittedAt: exp.noteSubmittedAt,
        excused: exp.excused,
      },
      args.now,
    );
    if (status === "submitted" || status === "late_submitted" || status === "excused") {
      continue;
    }
    const dueMs = Date.parse(exp.dueAt);
    const already = sentKinds.get(exp.id) ?? new Set<IspEscalationKind>();
    const { date, time } = formatDueAt(exp.dueAt);

    if (!already.has("nudge") && dueMs - nowMs <= nudgeWindowMs) {
      decisions.push({
        expectationId: exp.id,
        kind: "nudge",
        toUserId: exp.userId,
        message:
          `Your shift note for ${exp.individualName} (${exp.shiftName}, ${date}) ` +
          `is due at ${time} — please write and sign it before the shift ends.`,
      });
      already.add("nudge");
    }
    if (!already.has("hm_alert") && nowMs - dueMs >= hmAlertAfterMs) {
      const hours = hoursOverdue(exp.dueAt, args.now);
      for (const hmId of args.houseManagerIds) {
        decisions.push({
          expectationId: exp.id,
          kind: "hm_alert",
          toUserId: hmId,
          message:
            `${exp.staffName} hasn't submitted the shift note for ${exp.individualName} ` +
            `(${exp.shiftName}, ${date}) — ${hours} hours past due. Please follow up with them.`,
        });
      }
      already.add("hm_alert");
    }
    if (!already.has("dpm_escalation") && nowMs - dueMs >= dpmAfterMs) {
      const hours = hoursOverdue(exp.dueAt, args.now);
      for (const dpmId of args.dpmIds) {
        decisions.push({
          expectationId: exp.id,
          kind: "dpm_escalation",
          toUserId: dpmId,
          message:
            `The shift note for ${exp.individualName} (${exp.shiftName}, ${date}) ` +
            `at ${exp.siteName} is still missing ${hours} hours after it was due. ` +
            `Assigned to ${exp.staffName}. Please intervene.`,
        });
      }
      already.add("dpm_escalation");
    }
  }
  return decisions;
}

/** Heuristic: a score comment mentioning refusal counts as a refusal. */
function isRefusalComment(comment: string | null | undefined): boolean {
  return !!comment && /refus/i.test(comment);
}

function trackableById(
  trackables: IspTrackable[],
  id: string,
): IspTrackable | undefined {
  return trackables.find((t) => t.id === id);
}

/**
 * Monthly rollup per objective.
 *
 * Per objective O over the service month:
 * - opportunities: notes in the month linked to O (via noteObjectives).
 * - A linked note counts as a completion when at least one of O's trackable
 *   scores on that note shows success (yes_no true, count > 0, rating at or
 *   above the scale midpoint, non-blank narrative, percentage >= 50).
 * - refusals: HEURISTIC — a note counts as a refusal when any of its scores
 *   for O has a comment containing "refus" (case-insensitive). A refusal
 *   note is not also a completion.
 * - notOffered: linked notes with no scores at all for O's trackables.
 * - successRate = completions / opportunities (null when 0 opportunities).
 * - avgRating: mean of rating_scale scores; totalCount: sum of count scores.
 * - trend: compares successRate to the prior month's tallies (±3pp →
 *   up/down, else flat; null without a prior rate).
 */
export function tallyMonthly(args: {
  notes: IspNote[];
  scores: IspNoteTrackableScore[];
  trackables: IspTrackable[];
  objectives: IspObjective[];
  goals: IspGoal[];
  expectations: IspNoteExpectation[];
  serviceMonth: string;
  priorTallies: IspMonthlyTallies | null;
  noteObjectives: Array<{ noteId: string; objectiveId: string }>;
}): IspMonthlyTallies {
  const month = args.serviceMonth.slice(0, 7);
  const notesInMonth = args.notes.filter((n) =>
    n.workDate.startsWith(month),
  );
  const expectationsInMonth = args.expectations.filter((e) =>
    e.workDate.startsWith(month),
  );
  const notesById = new Map(notesInMonth.map((n) => [n.id, n]));
  const scoresByNote = new Map<string, IspNoteTrackableScore[]>();
  for (const s of args.scores) {
    if (!notesById.has(s.noteId)) continue;
    const list = scoresByNote.get(s.noteId) ?? [];
    list.push(s);
    scoresByNote.set(s.noteId, list);
  }
  const objectiveIdsByNote = new Map<string, Set<string>>();
  for (const link of args.noteObjectives) {
    if (!notesById.has(link.noteId)) continue;
    let set = objectiveIdsByNote.get(link.noteId);
    if (!set) {
      set = new Set();
      objectiveIdsByNote.set(link.noteId, set);
    }
    set.add(link.objectiveId);
  }
  const goalById = new Map(args.goals.map((g) => [g.id, g]));

  const notesExpected = expectationsInMonth.length;
  let notesSubmitted = 0;
  let notesLate = 0;
  for (const e of expectationsInMonth) {
    if (!e.noteId) continue;
    notesSubmitted += 1;
    const note = notesById.get(e.noteId);
    if (note && note.status === "late") notesLate += 1;
  }
  const notesMissing = notesExpected - notesSubmitted;

  const perObjective: IspObjectiveTally[] = args.objectives.map((obj) => {
    const activeTrackables = args.trackables.filter(
      (t) => t.objectiveId === obj.id && t.active,
    );
    const linkedNotes = notesInMonth.filter((n) =>
      objectiveIdsByNote.get(n.id)?.has(obj.id),
    );
    const opportunities = linkedNotes.length;
    let completions = 0;
    let refusals = 0;
    let notOffered = 0;
    const ratings: number[] = [];
    let totalCount = 0;
    for (const note of linkedNotes) {
      const noteScores = (scoresByNote.get(note.id) ?? []).filter((s) =>
        activeTrackables.some((t) => t.id === s.trackableId),
      );
      if (noteScores.length === 0) {
        notOffered += 1;
        continue;
      }
      if (noteScores.some((s) => isRefusalComment(s.comment))) {
        refusals += 1;
        continue;
      }
      let noteCompleted = false;
      for (const s of noteScores) {
        const t = trackableById(args.trackables, s.trackableId);
        if (!t) continue;
        switch (t.measurementMethod) {
          case "yes_no":
            if (s.scoreYesNo === true) noteCompleted = true;
            break;
          case "count":
            if (typeof s.scoreCount === "number") {
              totalCount += s.scoreCount;
              if (s.scoreCount > 0) noteCompleted = true;
            }
            break;
          case "rating_scale":
            if (typeof s.scoreRating === "number") {
              ratings.push(s.scoreRating);
              const min = t.ratingMin ?? 1;
              const max = t.ratingMax ?? 5;
              if (s.scoreRating >= (min + max) / 2) noteCompleted = true;
            }
            break;
          case "narrative":
            if (s.scoreText && s.scoreText.trim().length > 0) noteCompleted = true;
            break;
          case "percentage":
            if (typeof s.scorePercentage === "number" && s.scorePercentage >= 50) {
              noteCompleted = true;
            }
            break;
        }
      }
      if (noteCompleted) completions += 1;
    }
    const successRate =
      opportunities > 0
        ? Math.round((completions / opportunities) * 1000) / 1000
        : null;
    const avgRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100
        : null;
    const prior = args.priorTallies?.perObjective.find(
      (p) => p.objectiveId === obj.id,
    );
    let trend: "up" | "down" | "flat" | null = null;
    if (prior && prior.successRate !== null && successRate !== null) {
      const delta = successRate - prior.successRate;
      trend = delta >= 0.03 ? "up" : delta <= -0.03 ? "down" : "flat";
    }
    return {
      objectiveId: obj.id,
      objectiveTitle: obj.title,
      goalTitle: goalById.get(obj.goalId)?.title ?? "",
      opportunities,
      completions,
      refusals,
      notOffered,
      successRate,
      avgRating,
      totalCount,
      trend,
    };
  });

  const objectiveBits = perObjective.map((t) => {
    const rate =
      t.successRate === null ? "no data" : `${Math.round(t.successRate * 100)}% success`;
    return `${t.objectiveTitle}: ${rate} across ${t.opportunities} note${t.opportunities === 1 ? "" : "s"}`;
  });
  const narrativeRollup = [
    `In ${args.serviceMonth.slice(0, 7)}, ${notesSubmitted} of ${notesExpected} expected shift notes were submitted` +
      (notesLate > 0 ? ` (${notesLate} late)` : "") +
      (notesMissing > 0 ? `; ${notesMissing} still missing` : "."),
    objectiveBits.length > 0
      ? `Objective progress — ${objectiveBits.join("; ")}.`
      : "No objectives were tracked this month.",
  ]
    .join(" ")
    .slice(0, 2000);

  return {
    serviceMonth: args.serviceMonth,
    notesExpected,
    notesSubmitted,
    notesLate,
    notesMissing,
    perObjective,
    narrativeRollup,
  };
}

/**
 * Staff with the worst missing-note record over the last `days` days,
 * sorted worst first. Only staff with at least one overdue or late note
 * are listed.
 */
export function repeatOffenders(
  expectations: IspExpectationView[],
  days: number,
  now: Date,
): IspRepeatOffender[] {
  const cutoffMs = now.getTime() - days * 86400000;
  const byUser = new Map<
    string,
    { staffName: string; siteName: string; overdue: number; late: number; total: number }
  >();
  for (const exp of expectations) {
    if (Date.parse(exp.dueAt) < cutoffMs) continue;
    let row = byUser.get(exp.userId);
    if (!row) {
      row = {
        staffName: exp.staffName,
        siteName: exp.siteName,
        overdue: 0,
        late: 0,
        total: 0,
      };
      byUser.set(exp.userId, row);
    }
    row.total += 1;
    if (exp.status === "overdue") row.overdue += 1;
    else if (exp.status === "late_submitted") row.late += 1;
  }
  return [...byUser.entries()]
    .filter(([, r]) => r.overdue + r.late > 0)
    .map(([userId, r]) => ({
      userId,
      staffName: r.staffName,
      siteName: r.siteName,
      overdueCount: r.overdue,
      lateCount: r.late,
      totalExpected: r.total,
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.lateCount - a.lateCount);
}

/** Fresh monthly-report sections; the preparer fills in the narrative. */
export function blankMonthlySections(serviceTitle: string): IspMonthlySections {
  return {
    serviceTitle,
    selfDetermination: "",
    healthMedical: "",
    rights: "",
    communityActivities: "",
    programProgress: [],
    supportCoordinator: "",
    personVisitedDates: "",
    overallConcerns: "",
    changesNeeded: "",
    rnFollowUp: "",
  };
}
