/**
 * attentionFeed.test.ts — the management attention feed: overdue first,
 * then due-today, then escalations; repeated misses and unowned actions
 * escalate.
 *
 * Run: node --import tsx --test src/data/attentionFeed.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_KIND_META,
  attentionCounts,
  buildAttentionFeed,
  topAttention,
} from "./attentionFeed";
import type { RiskContext } from "./riskRegistry";
import type { TimelineFacts } from "./deadlineTimeline";

const NOW = new Date("2026-09-14T12:00:00Z");

function riskContext(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    now: NOW,
    certificates: [],
    checklists: [],
    training: [],
    medications: [],
    requirements: [],
    correctiveActions: [],
    ...overrides,
  };
}

function timelineFacts(overrides: Partial<TimelineFacts> = {}): TimelineFacts {
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

test("attention: empty feed when nothing is due", () => {
  const items = buildAttentionFeed({
    riskContext: riskContext(),
    timelineFacts: timelineFacts(),
  });
  assert.deepEqual(items, []);
  assert.equal(topAttention(items), null);
});

test("attention: kind order is overdue, due-today, escalation", () => {
  const items = buildAttentionFeed({
    riskContext: riskContext(),
    timelineFacts: timelineFacts({
      trainings: [
        { id: "t1", userId: "u1", staffName: "A", title: "Late", dueOn: "2026-09-10" },
        { id: "t2", userId: "u1", staffName: "A", title: "Today", dueOn: "2026-09-14" },
      ],
      correctiveActions: [
        { id: "a1", title: "Nobody owns this", dueOn: "2026-09-30", status: "open" },
      ],
    }),
  });
  const kinds = items.map((item) => item.kind);
  const firstOverdue = kinds.indexOf("overdue");
  const firstToday = kinds.indexOf("due-today");
  const firstEscalation = kinds.indexOf("escalation");
  assert.ok(firstOverdue < firstToday, "overdue before due-today");
  assert.ok(firstToday < firstEscalation, "due-today before escalation");
  const counts = attentionCounts(items);
  assert.equal(counts.overdue, 1);
  assert.equal(counts["due-today"], 1);
  assert.equal(counts.escalation, 1);
});

test("attention: critical risks surface as overdue", () => {
  const items = buildAttentionFeed({
    riskContext: riskContext({
      certificates: [
        { id: "c1", userId: "u1", staffName: "Ava", kind: "CPR", expiresOn: "2026-09-01", daysRemaining: -13 },
      ],
    }),
    timelineFacts: timelineFacts(),
  });
  const overdue = items.filter((item) => item.kind === "overdue");
  assert.ok(overdue.length >= 1);
  assert.equal(overdue[0].severity, "critical");
  assert.equal(topAttention(items), overdue[0]);
});

test("attention: repeated missed checklists escalate", () => {
  const items = buildAttentionFeed({
    riskContext: riskContext(),
    timelineFacts: timelineFacts({
      checklists: [
        { id: "w1", siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-06", submitted: false },
        { id: "w2", siteName: "Maple", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: false },
      ],
    }),
  });
  const escalation = items.find(
    (item) => item.kind === "escalation" && item.siteName === "Maple",
  );
  assert.ok(escalation, "Maple escalates after two misses");
  // A single miss elsewhere does not escalate.
  const single = buildAttentionFeed({
    riskContext: riskContext(),
    timelineFacts: timelineFacts({
      checklists: [
        { id: "w1", siteName: "Oak", checklistTitle: "Weekly", dueOn: "2026-09-13", submitted: false },
      ],
    }),
  });
  assert.ok(
    !single.some((item) => item.kind === "escalation" && item.siteName === "Oak"),
    "one miss is overdue, not an escalation",
  );
});

test("attention: kind meta is icon + text, never color alone", () => {
  for (const meta of Object.values(ATTENTION_KIND_META)) {
    assert.ok(meta.label.length > 0);
    assert.ok(meta.icon.length > 0);
    assert.ok(meta.description.length > 0);
  }
});
