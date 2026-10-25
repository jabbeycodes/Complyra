import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLatenessPoint,
  clockInIsLate,
  scheduledStartIso,
  notePastGrace,
  prnFollowupStillOpen,
  recognitionAwardProblem,
  recognitionUsedThisMonth,
  reminderSlot,
  type LatenessEntry,
  type LatenessRules,
} from "./lateness";

const rules: LatenessRules = {
  pointsPerLateItem: 1,
  warningLevels: [5, 8, 9],
  writeupThreshold: 10,
  disputeWindowDays: 7,
  resetAfterWriteup: true,
};

function draft(sourceKey: string, occurredAt: string): Omit<LatenessEntry, "points" | "writeup"> {
  return {
    id: sourceKey,
    agencyId: "agency-1",
    userId: "user-1",
    kind: "late_recording",
    occurredAt,
    sourceKey,
  };
}

test("lateness balance warns, writes up, then resets while keeping history", () => {
  let entries: LatenessEntry[] = [];
  let lastWarning: number | null = null;
  for (let n = 1; n <= 9; n += 1) {
    const applied = applyLatenessPoint(entries, draft(`e${n}`, `2026-10-0${n}T12:00:00.000Z`), rules);
    entries = applied.entries;
    lastWarning = applied.result.crossedWarning;
    assert.equal(applied.result.writeupIssued, false);
    assert.equal(applied.result.balance, n);
  }
  assert.equal(lastWarning, 9);
  const writeup = applyLatenessPoint(entries, draft("e10", "2026-10-10T12:00:00.000Z"), rules);
  assert.equal(writeup.result.writeupIssued, true);
  assert.equal(writeup.result.balance, 0);
  assert.equal(writeup.entries.length, 10);
  const again = applyLatenessPoint(writeup.entries, draft("e11", "2026-10-11T12:00:00.000Z"), rules);
  assert.equal(again.result.balance, 1);
  const duplicate = applyLatenessPoint(again.entries, draft("e11", "2026-10-11T13:00:00.000Z"), rules);
  assert.equal(duplicate.result.added, false);
  assert.equal(duplicate.entries.length, again.entries.length);
});

test("the same warning level is not crossed twice", () => {
  let entries: LatenessEntry[] = [];
  const first = applyLatenessPoint(
    entries,
    draft("a", "2026-10-01T12:00:00.000Z"),
    { ...rules, warningLevels: [1], writeupThreshold: 10 },
  );
  entries = first.entries;
  assert.equal(first.result.crossedWarning, 1);
  const second = applyLatenessPoint(entries, draft("b", "2026-10-02T12:00:00.000Z"), {
    ...rules,
    warningLevels: [1],
    writeupThreshold: 10,
  });
  assert.equal(second.result.crossedWarning, null);
  assert.equal(second.result.balance, 2);
});

test("clock-in, note grace, reminder slots, and the recognition cap", () => {
  const start = scheduledStartIso("2026-10-13", "08:00");
  assert.ok(start);
  assert.equal(new Date(start).getHours(), 8);
  assert.equal(scheduledStartIso("2026-10-13", "nope"), null);
  assert.equal(clockInIsLate("2026-10-13T08:00:00.000Z", "2026-10-13T08:16:00.000Z", 15), true);
  assert.equal(clockInIsLate("2026-10-13T08:00:00.000Z", "2026-10-13T08:10:00.000Z", 15), false);
  const during = new Date(2026, 9, 13, 10, 0, 0);
  assert.equal(notePastGrace({ noteDate: "2026-10-13", shift: "7a–3p", now: during, graceMinutes: 30 }), false);
  const after = new Date(2026, 9, 13, 14, 31, 0);
  assert.equal(notePastGrace({ noteDate: "2026-10-13", shift: "Day", now: after, graceMinutes: 30 }), true);
  assert.equal(notePastGrace({ noteDate: "2026-10-13", shift: "custom", now: after, graceMinutes: 30 }), false);
  assert.equal(reminderSlot(0, 60), 0);
  assert.equal(reminderSlot(60 * 60_000, 60), 1);
  assert.equal(reminderSlot(60 * 60_000 + 1, 60), 1);
  const awards = [
    {
      id: "1",
      agencyId: "agency-1",
      managerId: "hm",
      recipientId: "dsp",
      points: 8,
      reason: "Covered a shift",
      month: "2026-10",
      createdAt: "2026-10-02T00:00:00.000Z",
    },
  ];
  assert.equal(recognitionUsedThisMonth(awards, "agency-1", "hm", "2026-10"), 8);
  assert.equal(recognitionAwardProblem(8, 12, 20), null);
  assert.match(recognitionAwardProblem(8, 13, 20) ?? "", /12 left/);
  assert.match(recognitionAwardProblem(20, 1, 20) ?? "", /all 20/);
});

test("a recorded PRN follow-up closes only that dose", () => {
  const events = [
    { action: "medication.prn", targetId: "med-1", createdAt: "2026-10-13T12:00:00.000Z" },
    { action: "medication.prn_effectiveness", targetId: "med-1", createdAt: "2026-10-13T13:00:00.000Z" },
    { action: "medication.prn", targetId: "med-1", createdAt: "2026-10-13T15:00:00.000Z" },
  ];
  assert.equal(prnFollowupStillOpen(events, "med-1", "2026-10-13T12:00:00.000Z"), false);
  assert.equal(prnFollowupStillOpen(events, "med-1", "2026-10-13T15:00:00.000Z"), true);
});
