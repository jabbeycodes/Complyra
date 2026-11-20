import { test } from "node:test";
import assert from "node:assert/strict";
import { punchDayRange } from "./hrStore";

test("punchDayRange: bounds are real UTC instants for the Central calendar day", () => {
  // 2026-11-03 22:53 UTC is 16:53 CST on Nov 3 — the Central day is Nov 3,
  // whose bounds are 06:00:00.000Z Nov 3 .. 05:59:59.999Z Nov 4.
  const now = new Date("2026-11-03T22:53:00.000Z");
  const { from, to } = punchDayRange(now);
  assert.ok(from.endsWith("Z") && to.endsWith("Z"), "both bounds carry a zone");
  assert.equal(from, "2026-11-03T06:00:00.000Z");
  assert.equal(to, "2026-11-04T05:59:59.999Z");
});

test("punchDayRange: an evening punch (UTC date already rolled) is inside today's window", () => {
  // 2026-11-04 01:30 UTC is 19:30 CST on Nov 3 — the UTC date has rolled
  // to Nov 4 but the agency day is still Nov 3, and the punch belongs to it.
  const now = new Date("2026-11-04T01:30:00.000Z");
  const punchedAt = now.toISOString(); // how punches are stored
  const { from, to } = punchDayRange(now);
  assert.equal(from, "2026-11-03T06:00:00.000Z");
  assert.ok(punchedAt >= from && punchedAt <= to, `${punchedAt} within ${from}..${to}`);
});
