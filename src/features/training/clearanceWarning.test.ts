import { test } from "node:test";
import assert from "node:assert/strict";
import { CLEARANCE_WARNING_TEXT, clearanceWarningFor } from "./clearanceWarning";

// Batch 59 pins: the scheduling warning fires for an uncleared DSP only —
// never for a cleared DSP, never while the profile is still loading, and
// never for nurse/HM/other assignees. It warns; assignment is never blocked
// (there is no blocking surface in this helper at all).
test("uncleared DSP assignee shows the warning", () => {
  assert.equal(clearanceWarningFor({ clearedForInRatio: false }, "dsp"), CLEARANCE_WARNING_TEXT);
});

test("cleared DSP assignee shows no warning", () => {
  assert.equal(clearanceWarningFor({ clearedForInRatio: true }, "dsp"), null);
});

test("no warning while the training profile is still loading", () => {
  assert.equal(clearanceWarningFor(null, "dsp"), null);
  assert.equal(clearanceWarningFor(undefined, "dsp"), null);
});

test("nurse and house manager assignees are unaffected", () => {
  assert.equal(clearanceWarningFor({ clearedForInRatio: false }, "nurse"), null);
  assert.equal(clearanceWarningFor({ clearedForInRatio: false }, "house_manager"), null);
  assert.equal(clearanceWarningFor({ clearedForInRatio: false }, "program_manager"), null);
  assert.equal(clearanceWarningFor({ clearedForInRatio: false }, null), null);
});

test("the warning says assignment can still happen (shadow shifts)", () => {
  assert.match(CLEARANCE_WARNING_TEXT, /can still assign/i);
  assert.match(CLEARANCE_WARNING_TEXT, /shadow/i);
});
