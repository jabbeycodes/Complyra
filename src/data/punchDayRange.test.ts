import { test } from "node:test";
import assert from "node:assert/strict";
import { punchDayRange } from "./hrStore";

test("punchDayRange: bounds are real UTC instants for the local calendar day", () => {
  const now = new Date(2026, 10, 3, 22, 53, 0); // 10:53 PM local
  const { from, to } = punchDayRange(now);
  assert.ok(from.endsWith("Z") && to.endsWith("Z"), "both bounds carry a zone");
  assert.equal(Date.parse(from), new Date(2026, 10, 3, 0, 0, 0, 0).getTime());
  assert.equal(Date.parse(to), new Date(2026, 10, 3, 23, 59, 59, 999).getTime());
});

test("punchDayRange: an evening punch (UTC date already rolled) is inside today's window", () => {
  const now = new Date(2026, 10, 3, 22, 53, 0);
  const punchedAt = now.toISOString(); // how punches are stored
  const { from, to } = punchDayRange(now);
  assert.ok(punchedAt >= from && punchedAt <= to, `${punchedAt} within ${from}..${to}`);
});
