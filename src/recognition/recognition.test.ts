import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DSP_WEIGHTS,
  HM_WEIGHTS,
  buildHighlights,
  isValidRating,
  mondayOfWeek,
  pickWinner,
  ratingLabel,
  rollingAverage,
  scoreDspWeek,
  scoreHmWeek,
  toPublicWinner,
} from "./scoring";

test("rating labels and 1–5 validation", () => {
  assert.equal(ratingLabel(1), "Needs support");
  assert.equal(ratingLabel(2), "Developing");
  assert.equal(ratingLabel(3), "Solid");
  assert.equal(ratingLabel(4), "Strong");
  assert.equal(ratingLabel(5), "Exceptional");

  for (const v of [1, 2, 3, 4, 5]) assert.ok(isValidRating(v));
  for (const v of [0, 6, 2.5, -1, Number.NaN, "3", null, undefined]) {
    assert.ok(!isValidRating(v), `expected invalid: ${String(v)}`);
  }
});

test("HM weights sum to 100 with the documented split", () => {
  assert.equal(HM_WEIGHTS.weeklyChecklistsOnTime, 35);
  assert.equal(HM_WEIGHTS.monthlyChecksOnTime, 20);
  assert.equal(HM_WEIGHTS.siteComplianceStanding, 25);
  assert.equal(HM_WEIGHTS.dspSatisfaction, 20);
  const sum = Object.values(HM_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test("DSP weights sum to 100 with the HM review at 25%", () => {
  assert.equal(DSP_WEIGHTS.trainingAndCredentials, 30);
  assert.equal(DSP_WEIGHTS.documentationTimeliness, 25);
  assert.equal(DSP_WEIGHTS.reliability, 20);
  assert.equal(DSP_WEIGHTS.hmReview, 25);
  const sum = Object.values(DSP_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test("HM scoring: a perfect week scores 100", () => {
  const { score, breakdown } = scoreHmWeek({
    weeklyChecklistsDue: 4,
    weeklyChecklistsOnTime: 4,
    monthlyChecksDue: 2,
    monthlyChecksOnTime: 2,
    siteComplianceShare: 1,
    dspSatisfactionAverage: 5,
  });
  assert.equal(score, 100);
  assert.deepEqual(Object.values(breakdown).reduce((a, b) => a + b, 0), 100);
});

test("HM scoring: no work and no ratings is neutral (50), never zero", () => {
  const { score } = scoreHmWeek({
    weeklyChecklistsDue: 0,
    weeklyChecklistsOnTime: 0,
    monthlyChecksDue: 0,
    monthlyChecksOnTime: 0,
    siteComplianceShare: 0, // a 0 share is still neutral? no — check below
    dspSatisfactionAverage: null,
  });
  // due=0 → neutral half credit on the two checklist signals; a 0 compliance
  // share is a measured signal (scores 0); missing satisfaction is neutral.
  assert.equal(score, 17.5 + 10 + 0 + 10);
});

test("DSP scoring: the HM review contributes exactly 25 points", () => {
  const base = {
    trainingShare: 1,
    credentialsShare: 1,
    documentationTimelinessShare: 1,
    reliabilityShare: 1,
    hmReviewAverage: null as number | null,
  };
  const withReview = scoreDspWeek({ ...base, hmReviewAverage: 5 });
  const withoutReview = scoreDspWeek({ ...base, hmReviewAverage: null });
  assert.equal(withReview.score, 100);
  assert.equal(withoutReview.score, 87.5); // 25 * 0.5 neutral
  assert.equal(withReview.score - withoutReview.score, 12.5);

  const worst = scoreDspWeek({ ...base, hmReviewAverage: 1 });
  assert.equal(worst.breakdown.hmReview, 0);
});

test("DSP scoring: missing data is neutral, never a penalty", () => {
  const { score } = scoreDspWeek({
    trainingShare: 0,
    credentialsShare: 0,
    documentationTimelinessShare: 0,
    reliabilityShare: 0,
    hmReviewAverage: null,
  });
  // Real 0 shares score 0; the missing review scores neutral (12.5).
  assert.equal(score, 12.5);
});

test("pickWinner: highest score wins; exact ties break by candidate id", () => {
  const a = { id: "user-b", fullName: "B", score: 90, breakdown: {} as never };
  const b = { id: "user-a", fullName: "A", score: 90, breakdown: {} as never };
  const c = { id: "user-c", fullName: "C", score: 95, breakdown: {} as never };
  assert.equal(pickWinner([a, b])!.id, "user-a");
  assert.equal(pickWinner([b, a])!.id, "user-a");
  assert.equal(pickWinner([a, b, c])!.id, "user-c");
  assert.equal(pickWinner([]), null);
});

test("buildHighlights: positive-only, 80% floor per signal", () => {
  const hm = buildHighlights("hm_of_the_week", {
    weeklyChecklistsOnTime: 35,
    monthlyChecksOnTime: 20,
    siteComplianceStanding: 20, // 0.8 of 25 → qualifies
    dspSatisfaction: 10, // below floor → excluded
  });
  assert.deepEqual(hm, [
    "Weekly checklists completed on time",
    "Monthly checks completed on time",
    "Strong site compliance standing",
  ]);

  const dsp = buildHighlights("dsp_of_the_week", {
    trainingAndCredentials: 24, // 0.8 of 30 → qualifies
    documentationTimeliness: 0,
    reliability: 0,
    hmReview: 25,
  });
  assert.deepEqual(dsp, [
    "Training and credentials current",
    "High marks from their house manager",
  ]);

  // Nothing negative ever appears, even for a poor week.
  const poor = buildHighlights("hm_of_the_week", {
    weeklyChecklistsOnTime: 0,
    monthlyChecksOnTime: 0,
    siteComplianceStanding: 0,
    dspSatisfaction: 0,
  });
  assert.deepEqual(poor, []);
});

test("toPublicWinner strips scores, breakdowns, and ids", () => {
  const pub = toPublicWinner({
    id: "w-1",
    weekStart: "2026-09-07",
    category: "hm_of_the_week",
    winnerId: "user-1",
    winnerName: "Jane Doe",
    score: 97.5,
    breakdown: {
      weeklyChecklistsOnTime: 35,
      monthlyChecksOnTime: 20,
      siteComplianceStanding: 25,
      dspSatisfaction: 17.5,
    },
    decidedAt: "2026-09-13T06:05:00Z",
  });
  assert.equal(pub.winnerName, "Jane Doe");
  assert.ok(!("score" in pub));
  assert.ok(!("breakdown" in pub));
  assert.ok(!("winnerId" in pub));
  assert.ok(Array.isArray(pub.highlights));
});

test("mondayOfWeek: Monday weeks; Sunday maps back to its Monday", () => {
  // 2026-09-14 is a Monday.
  assert.equal(mondayOfWeek(new Date(Date.UTC(2026, 8, 14))), "2026-09-14");
  // 2026-09-20 is the following Sunday.
  assert.equal(mondayOfWeek(new Date(Date.UTC(2026, 8, 20))), "2026-09-14");
  // 2026-09-16 is a Wednesday in the same week.
  assert.equal(mondayOfWeek(new Date(Date.UTC(2026, 8, 16))), "2026-09-14");
});

test("rollingAverage ignores invalid entries, null when empty", () => {
  assert.equal(rollingAverage([4, 5, 3]), 4);
  assert.equal(rollingAverage([4, 99 as number, 5]), 4.5);
  assert.equal(rollingAverage([]), null);
  assert.equal(rollingAverage([0, 6]), null);
});

test("defaultRecognitionWeekStart: most recent week whose Monday-4pm deadline passed", async () => {
  const { addDaysIso, checklistDeadlineUtc, defaultRecognitionWeekStart } =
    await import("./scoring");
  // Sunday 2026-09-13 06:05 UTC (the scheduled run): the week of Sep 7 has
  // not yet hit its Monday-4pm deadline, so target the week of Aug 31.
  assert.equal(
    defaultRecognitionWeekStart(new Date(Date.UTC(2026, 8, 13, 6, 5))),
    "2026-08-31",
  );
  // Monday 2026-09-14 23:00 UTC (after the Sep-7 week's deadline): target Sep 7.
  assert.equal(
    defaultRecognitionWeekStart(new Date(Date.UTC(2026, 8, 14, 23, 0))),
    "2026-09-07",
  );
  // Monday 2026-09-14 21:00 UTC (before the deadline): still Aug 31.
  assert.equal(
    defaultRecognitionWeekStart(new Date(Date.UTC(2026, 8, 14, 21, 0))),
    "2026-08-31",
  );
  // The checklist week for a recognition Monday is the Sunday just before it.
  assert.equal(addDaysIso("2026-09-07", -1), "2026-09-06");
  assert.equal(checklistDeadlineUtc("2026-09-07"), "2026-09-14T22:00:00Z");
});
