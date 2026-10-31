import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HR_SHIFT_MINUTES, hrShiftSpanProblem } from "./hr";

/**
 * Simulation batch 24: Blake Ford's Scheduling shift displayed
 * 3:00 AM–11:00 PM (~20h) where a 3:00 PM evening start was expected.
 * Verified against production: the stored row really was
 * 2026-10-31T08:00Z → 2026-11-01T04:00Z = 3:00 AM–11:00 PM Central —
 * display conversion is faithful; the hub's Add Shift form saved a
 * 20-hour shift with no duration check (its only rule was end > start).
 * The 16-hour cap matches the shift-span rule the rest of the product
 * already enforces (dueItems MAX_SHIFT_MINUTES).
 */

// The intended evening shift: 3:00 PM–11:00 PM Central on Oct 31
// (CDT, UTC-5) = 20:00Z → 04:00Z.
const EVENING_START = "2026-10-31T20:00:00.000Z";
const EVENING_END = "2026-11-01T04:00:00.000Z";
// What production actually held: 3:00 AM–11:00 PM Central = 08:00Z → 04:00Z.
const SLIPPED_START = "2026-10-31T08:00:00.000Z";

test("a 15:00–23:00 Central evening shift is accepted", () => {
  assert.equal(hrShiftSpanProblem(EVENING_START, EVENING_END), null);
});

test("the 3:00 AM–11:00 PM slip (20h) is refused", () => {
  assert.equal(
    hrShiftSpanProblem(SLIPPED_START, EVENING_END),
    "A shift can run at most 16 hours.",
  );
});

test("exactly 16 hours passes; 16 hours + 1 minute fails", () => {
  const start = "2026-10-31T12:00:00.000Z";
  const atCap = new Date(
    new Date(start).getTime() + MAX_HR_SHIFT_MINUTES * 60_000,
  ).toISOString();
  const overCap = new Date(
    new Date(start).getTime() + (MAX_HR_SHIFT_MINUTES + 1) * 60_000,
  ).toISOString();
  assert.equal(hrShiftSpanProblem(start, atCap), null);
  assert.equal(
    hrShiftSpanProblem(start, overCap),
    "A shift can run at most 16 hours.",
  );
});

test("end at or before start is refused", () => {
  assert.equal(
    hrShiftSpanProblem(EVENING_END, EVENING_START),
    "The end time must be after the start time.",
  );
  assert.equal(
    hrShiftSpanProblem(EVENING_START, EVENING_START),
    "The end time must be after the start time.",
  );
});

test("an ordinary 8-hour day shift is accepted", () => {
  // 8:00 AM–4:00 PM Central = 13:00Z → 21:00Z (matches the sim's
  // "Day coverage" rows).
  assert.equal(
    hrShiftSpanProblem("2026-11-01T13:00:00.000Z", "2026-11-01T21:00:00.000Z"),
    null,
  );
});
