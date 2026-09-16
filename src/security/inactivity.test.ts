import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_WARNING_MS,
  idleMs,
  inactivityPhase,
  logoffCountdownSeconds,
  timeUntilLogoffMs,
} from "./inactivity";

test("inactivity windows: 15 minutes idle, 60-second warning", () => {
  assert.equal(INACTIVITY_TIMEOUT_MS, 15 * 60 * 1000);
  assert.equal(INACTIVITY_WARNING_MS, 60 * 1000);
});

test("inactivityPhase transitions at the right boundaries", () => {
  const now = 1_000_000_000;
  assert.equal(inactivityPhase(now - 13 * 60_000, now), "active");
  assert.equal(inactivityPhase(now - (15 * 60_000 - 60_000), now), "warning");
  assert.equal(inactivityPhase(now - (15 * 60_000 - 1_000), now), "warning");
  assert.equal(inactivityPhase(now - 15 * 60_000, now), "expired");
  assert.equal(inactivityPhase(now - 60 * 60_000, now), "expired");
});

test("idleMs never goes negative", () => {
  assert.equal(idleMs(1_000_000_005, 1_000_000_000), 0);
  assert.equal(idleMs(999_999_000, 1_000_000_000), 1000);
});

test("timeUntilLogoffMs counts down to zero", () => {
  const now = 1_000_000_000;
  assert.equal(timeUntilLogoffMs(now - 60_000, now), 14 * 60_000);
  assert.equal(timeUntilLogoffMs(now - 15 * 60_000, now), 0);
  assert.equal(timeUntilLogoffMs(now - 60 * 60_000, now), 0);
});

test("logoffCountdownSeconds rounds up whole seconds", () => {
  const now = 1_000_000_000;
  assert.equal(logoffCountdownSeconds(now - (15 * 60_000 - 60_000), now), 60);
  assert.equal(logoffCountdownSeconds(now - (15 * 60_000 - 500), now), 1);
  assert.equal(logoffCountdownSeconds(now - 15 * 60_000, now), 0);
});
