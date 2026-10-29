import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrackingSummary,
  greetingForHour,
  summarizeMedicationDay,
  TRACK_COLOR,
  type TrackingCategory,
} from "./today";

const cat = (partial: Partial<TrackingCategory>): TrackingCategory => ({
  id: "medications",
  label: "Medications",
  color: "#3f5c3b",
  completed: 0,
  total: 0,
  ...partial,
});

test("fractions become segments with their own percent and text", () => {
  const summary = buildTrackingSummary([
    cat({ id: "medications", completed: 8, total: 10 }),
    cat({ id: "ispData", label: "ISP Data", color: "#8b5e3c", completed: 1, total: 4 }),
  ]);
  assert.equal(summary.segments.length, 2);
  assert.equal(summary.segments[0].fractionText, "8 of 10");
  assert.equal(summary.segments[0].percent, 80);
  assert.equal(summary.segments[1].fractionText, "1 of 4");
  assert.equal(summary.segments[1].percent, 25);
});

test("overall percent is completed over total across segments only", () => {
  const summary = buildTrackingSummary([
    cat({ completed: 8, total: 10 }),
    cat({ id: "ispData", completed: 1, total: 4 }),
  ]);
  assert.equal(summary.overallCompleted, 9);
  assert.equal(summary.overallTotal, 14);
  assert.equal(summary.overallPercent, 64); // round(9/14 * 100)
  assert.equal(summary.hasData, true);
});

test("arcs cover the whole ring: completed in color, the rest as track", () => {
  const summary = buildTrackingSummary([
    cat({ completed: 3, total: 5 }),
    cat({ id: "checklists", completed: 0, total: 2 }),
  ]);
  const arcTotal = summary.arcs.reduce((sum, arc) => sum + arc.length, 0);
  assert.equal(arcTotal, summary.overallTotal);
  const colored = summary.arcs.filter((arc) => arc.color !== TRACK_COLOR);
  assert.equal(
    colored.reduce((sum, arc) => sum + arc.length, 0),
    summary.overallCompleted,
  );
  // Arcs are contiguous from 0.
  let cursor = 0;
  for (const arc of summary.arcs) {
    assert.equal(arc.start, cursor);
    cursor += arc.length;
  }
});

test("a zero-total category is not scheduled and drops out", () => {
  const summary = buildTrackingSummary([
    cat({ completed: 0, total: 0 }),
    cat({ id: "ispData", completed: 2, total: 2 }),
  ]);
  assert.equal(summary.segments.length, 1);
  assert.equal(summary.segments[0].id, "ispData");
  assert.equal(summary.overallPercent, 100);
});

test("zero totals everywhere: no data, 0 percent, no arcs", () => {
  const summary = buildTrackingSummary([
    cat({ completed: 0, total: 0 }),
    cat({ id: "ispData", completed: 0, total: 0 }),
  ]);
  assert.equal(summary.hasData, false);
  assert.equal(summary.overallPercent, 0);
  assert.equal(summary.overallTotal, 0);
  assert.deepEqual(summary.arcs, []);
  assert.deepEqual(summary.segments, []);
});

test("completed is clamped so a fraction never exceeds its denominator", () => {
  const summary = buildTrackingSummary([cat({ completed: 12, total: 10 })]);
  assert.equal(summary.segments[0].completed, 10);
  assert.equal(summary.segments[0].fractionText, "10 of 10");
  assert.equal(summary.overallPercent, 100);
});

test("medication day: completed is the marked doses, left is the rest", () => {
  const totals = summarizeMedicationDay([
    { scheduledTotal: 5, markedTotal: 2 },
    { scheduledTotal: 3, markedTotal: 3 },
  ]);
  assert.deepEqual(totals, { total: 8, completed: 5, left: 3 });
});

test("medication day: each person is capped at their own scheduled total", () => {
  // One person's surplus marks must never cover another person's doses.
  const totals = summarizeMedicationDay([
    { scheduledTotal: 2, markedTotal: 5 },
    { scheduledTotal: 4, markedTotal: 0 },
  ]);
  assert.deepEqual(totals, { total: 6, completed: 2, left: 4 });
});

test("medication day: nothing scheduled or marked is all zeroes", () => {
  assert.deepEqual(summarizeMedicationDay([]), {
    total: 0,
    completed: 0,
    left: 0,
  });
  assert.deepEqual(
    summarizeMedicationDay([{ scheduledTotal: 0, markedTotal: 0 }]),
    { total: 0, completed: 0, left: 0 },
  );
});

test("greeting follows the Central day parts", () => {
  assert.equal(greetingForHour(5), "Morning");
  assert.equal(greetingForHour(8), "Morning");
  assert.equal(greetingForHour(11), "Morning");
  assert.equal(greetingForHour(12), "Afternoon");
  assert.equal(greetingForHour(16), "Afternoon");
  assert.equal(greetingForHour(17), "Evening");
  assert.equal(greetingForHour(23), "Evening");
  assert.equal(greetingForHour(2), "Evening");
});
