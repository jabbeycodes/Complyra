/**
 * deadlineTimeline.test.ts — chronological ordering, urgency buckets,
 * the 60-day recertification filing deadline, and submitted-checklist
 * exclusion.
 *
 * Run: node --import tsx --test src/data/deadlineTimeline.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeline,
  dueNext,
  timelineCounts,
  type TimelineFacts,
} from "./deadlineTimeline";

const NOW = new Date("2026-09-14T12:00:00Z");

function facts(overrides: Partial<TimelineFacts> = {}): TimelineFacts {
  return {
    now: NOW,
    certificates: [],
    trainings: [],
    planRenewals: [],
    checklists: [],
    medications: [],
    correctiveActions: [],
    providerRecertification: null,
    ...overrides,
  };
}

test("timeline: soonest first across kinds", () => {
  const items = buildTimeline(
    facts({
      certificates: [
        { id: "c1", userId: "u1", staffName: "Ava", kind: "CPR", expiresOn: "2026-10-14" },
      ],
      trainings: [
        { id: "t1", userId: "u2", staffName: "Ben", title: "CPI", dueOn: "2026-09-20" },
      ],
      medications: [{ id: "m1", medName: "Ritalin", siteName: "Maple", runsOutOn: "2026-09-15" }],
    }),
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["medication:m1", "training:t1", "certificate:c1"],
  );
});

test("timeline: urgency buckets — overdue, today, this-week, upcoming", () => {
  const items = buildTimeline(
    facts({
      trainings: [
        { id: "t1", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-10" },
        { id: "t2", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-14" },
        { id: "t3", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-18" },
        { id: "t4", userId: "u1", staffName: "A", title: "T", dueOn: "2026-10-14" },
      ],
    }),
  );
  const counts = timelineCounts(items);
  assert.deepEqual(counts, { overdue: 1, today: 1, "this-week": 1, upcoming: 1 });
  assert.equal(items[0].daysRemaining, -4);
});

test("timeline: submitted checklists and resolved actions are excluded", () => {
  const items = buildTimeline(
    facts({
      checklists: [
        { id: "w1", siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: true },
        { id: "w2", siteName: "Oak", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: false },
      ],
      correctiveActions: [
        { id: "a1", title: "Done", dueOn: "2026-09-01", status: "resolved" },
        { id: "a2", title: "Open", dueOn: "2026-09-20", status: "open" },
      ],
    }),
  );
  assert.deepEqual(
    items.map((item) => item.id).sort(),
    ["checklist:w2", "corrective-action:a2"],
  );
});

test("timeline: provider recertification lands on the 60-day filing deadline", () => {
  const items = buildTimeline(
    facts({
      providerRecertification: { expiresOn: "2026-12-13", submitted: false },
    }),
  );
  assert.equal(items.length, 1);
  // 2026-12-13 minus 60 days = 2026-10-14.
  assert.equal(items[0].dueOn, "2026-10-14");
  assert.equal(items[0].kind, "provider-recertification");
});

test("timeline: dueNext caps the list", () => {
  const items = dueNext(
    facts({
      trainings: [
        { id: "t1", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-15" },
        { id: "t2", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-16" },
        { id: "t3", userId: "u1", staffName: "A", title: "T", dueOn: "2026-09-17" },
      ],
    }),
    2,
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].dueOn, "2026-09-15");
});

test("timeline: every item carries an in-app deep link and icon meta", () => {
  const items = buildTimeline(
    facts({
      planRenewals: [
        { id: "p1", individualName: "Cara", planTitle: "ISP", dueOn: "2026-10-01" },
      ],
    }),
  );
  assert.ok(items[0].deepLink.startsWith("/"));
  assert.ok(items[0].title.length > 0);
  assert.ok(items[0].detail.length > 0);
});
