import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReadinessResult } from "../../data/hr";
import {
  personalComplianceSegments,
  readinessStatusLabel,
  summarizePersonalCompliance,
  teamComplianceSummary,
} from "./personalCompliance";

function result(
  id: string,
  status: ReadinessResult["status"],
  dueOn: string | null = null,
): ReadinessResult {
  return {
    requirement: {
      id,
      agencyId: "agency-1",
      key: id,
      label: `Requirement ${id}`,
      kind: "certificate",
      dueEveryDays: null,
      requiredRoleKeys: [],
      active: true,
    },
    status,
    evidenceNote: null,
    dueOn,
  };
}

test("summary counts each status and computes percent current", () => {
  const summary = summarizePersonalCompliance([
    result("a", "complete", "2027-06-01"),
    result("b", "complete", null),
    result("c", "complete", "2027-01-15"),
    result("d", "due_soon", "2026-11-10"),
    result("e", "missing_or_expired", "2026-09-01"),
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.current, 3);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.missingOrExpired, 1);
  assert.equal(summary.percentCurrent, 60);
  assert.equal(summary.attentionCount, 2);
});

test("attention order: missing/expired first (earliest due first), then due soon", () => {
  const summary = summarizePersonalCompliance([
    result("soon-late", "due_soon", "2026-11-20"),
    result("missing-later", "missing_or_expired", "2026-10-01"),
    result("ok", "complete", "2027-05-01"),
    result("soon-early", "due_soon", "2026-11-05"),
    result("missing-nofile", "missing_or_expired", null),
    result("missing-earlier", "missing_or_expired", "2026-08-15"),
  ]);
  assert.deepEqual(
    summary.attention.map((i) => i.requirement.id),
    ["missing-nofile", "missing-earlier", "missing-later", "soon-early", "soon-late"],
  );
});

test("empty roll-up: zero totals, percent reads 100, no attention", () => {
  const summary = summarizePersonalCompliance([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.current, 0);
  assert.equal(summary.percentCurrent, 100);
  assert.equal(summary.attentionCount, 0);
  assert.deepEqual(summary.attention, []);
});

test("segments carry the donut's labels, order, and counts", () => {
  const summary = summarizePersonalCompliance([
    result("a", "complete"),
    result("b", "due_soon", "2026-11-01"),
    result("c", "missing_or_expired"),
    result("d", "missing_or_expired"),
  ]);
  const segments = personalComplianceSegments(summary);
  assert.deepEqual(
    segments.map((s) => [s.label, s.count]),
    [
      ["Current", 1],
      ["Due soon", 1],
      ["Missing or expired", 2],
    ],
  );
});

test("status labels are text, never color alone", () => {
  assert.equal(readinessStatusLabel("complete"), "Current");
  assert.equal(readinessStatusLabel("due_soon"), "Due soon");
  assert.equal(readinessStatusLabel("missing_or_expired"), "Missing or expired");
});

test("team summary: missing/expired drives attention; due-soon-only counts current", () => {
  const summary = teamComplianceSummary([
    [result("a", "complete")],
    [result("b", "due_soon", "2026-11-01")], // due soon only → current
    [result("c", "missing_or_expired")], // → attention
    [], // no applicable requirements → current
    [result("d", "complete"), result("e", "missing_or_expired", "2026-01-01")],
  ]);
  assert.equal(summary.total, 5);
  assert.equal(summary.fullyCurrent, 3);
  assert.equal(summary.needAttention, 2);
  assert.equal(summary.fullyCurrent + summary.needAttention, summary.total);
});

test("team summary: nobody assigned means zero totals", () => {
  assert.deepEqual(teamComplianceSummary([]), {
    total: 0,
    fullyCurrent: 0,
    needAttention: 0,
  });
});
