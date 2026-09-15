/**
 * riskRegistry.test.ts — risk aggregation, severity ordering, dedupe, and
 * the delegation plug point.
 *
 * Run: node --import tsx --test src/data/riskRegistry.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectRisks,
  registerDelegationRiskProvider,
  clearDelegationRiskProvider,
  registerRiskSource,
  registeredRiskSources,
  riskCounts,
  unregisterRiskSource,
  type RiskContext,
} from "./riskRegistry";

function ctx(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    now: new Date("2026-09-14T12:00:00Z"),
    certificates: [],
    checklists: [],
    training: [],
    medications: [],
    requirements: [],
    correctiveActions: [],
    ...overrides,
  };
}

test("risks: empty context collects nothing", () => {
  assert.deepEqual(collectRisks(ctx()), []);
});

test("risks: expired certs are critical, expiring are warning", () => {
  const items = collectRisks(
    ctx({
      certificates: [
        { id: "c1", userId: "u1", staffName: "Ava", kind: "CPR", expiresOn: "2026-09-01", daysRemaining: -13 },
        { id: "c2", userId: "u2", staffName: "Ben", kind: "CPI", expiresOn: "2026-09-20", daysRemaining: 6 },
        { id: "c3", userId: "u3", staffName: "Cy", kind: "PBS", expiresOn: "2027-01-01", daysRemaining: 100 },
      ],
    }),
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].severity, "critical");
  assert.ok(items[0].title.includes("expired"));
  assert.equal(items[1].severity, "warning");
});

test("risks: worst severity first, then soonest due", () => {
  const items = collectRisks(
    ctx({
      requirements: [
        { id: "r1", title: "Fire drill", person: "Site-wide", site: "Maple", status: "Overdue" },
      ],
      certificates: [
        { id: "c2", userId: "u2", staffName: "Ben", kind: "CPI", expiresOn: "2026-09-20", daysRemaining: 6 },
      ],
    }),
  );
  assert.equal(items[0].source, "requirements");
  assert.equal(items[1].source, "certificates");
  const counts = riskCounts(items);
  assert.equal(counts.critical, 1);
  assert.equal(counts.warning, 1);
});

test("risks: missed checklists, overdue training, low meds, overdue actions", () => {
  const items = collectRisks(
    ctx({
      checklists: [
        { id: "w1", siteId: "s1", siteName: "Maple", weekOf: "2026-09-06", dueAt: "2026-09-07T21:00:00Z", submitted: false, late: true },
      ],
      training: [
        { id: "t1", staffName: "Ava", title: "CPI", status: "overdue", dueOn: "2026-09-01" },
      ],
      medications: [
        { id: "m1", medName: "Ritalin", siteName: "Maple", siteId: "s1", daysRemaining: 1, status: "critical" },
      ],
      correctiveActions: [
        { id: "a1", title: "Fix drill log", assignedToName: "Ben", dueOn: "2026-09-01", overdue: true },
      ],
    }),
  );
  const sources = items.map((item) => item.source).sort();
  assert.deepEqual(sources, ["checklists", "corrective-actions", "medications", "training"]);
  for (const item of items) {
    assert.ok(item.deepLink.startsWith("/"), `${item.id}: in-app deep link`);
  }
});

test("risks: ids dedupe across sources", () => {
  registerRiskSource({
    key: "dup-test",
    label: "Dup",
    collect: () => [
      {
        id: "certificates:c1",
        source: "dup-test",
        sourceLabel: "Dup",
        severity: "warning",
        title: "dup",
        detail: "dup",
        deepLink: "/x",
      },
    ],
  });
  try {
    const items = collectRisks(
      ctx({
        certificates: [
          { id: "c1", userId: "u1", staffName: "Ava", kind: "CPR", expiresOn: "2026-09-20", daysRemaining: 6 },
        ],
      }),
    );
    assert.equal(items.filter((item) => item.id === "certificates:c1").length, 1);
  } finally {
    unregisterRiskSource("dup-test");
  }
});

test("risks: a broken source never takes down the list", () => {
  registerRiskSource({
    key: "boom-test",
    label: "Boom",
    collect: () => {
      throw new Error("boom");
    },
  });
  try {
    const items = collectRisks(
      ctx({
        requirements: [
          { id: "r1", title: "Fire drill", person: "Site-wide", site: "Maple", status: "Overdue" },
        ],
      }),
    );
    assert.equal(items.length, 1);
  } finally {
    unregisterRiskSource("boom-test");
  }
});

test("risks: delegation provider plugs in without code changes", () => {
  // Default: no provider -> no delegation risks.
  assert.ok(
    !collectRisks(ctx()).some((item) => item.source === "delegations"),
    "no delegation risks without a provider",
  );
  registerDelegationRiskProvider({
    collect: () => [
      {
        id: "delegations:ack-1",
        source: "delegations",
        sourceLabel: "Delegations",
        severity: "warning",
        title: "Seizure protocol — unsigned (Cara)",
        detail: "Still waiting on Ben's signature.",
        personName: "Ben",
        deepLink: "/delegations",
      },
    ],
  });
  try {
    const items = collectRisks(ctx());
    assert.ok(
      items.some((item) => item.id === "delegations:ack-1"),
      "provider-supplied risk appears",
    );
  } finally {
    clearDelegationRiskProvider();
  }
  assert.ok(
    registeredRiskSources().some((source) => source.key === "delegations"),
    "delegations source stays registered",
  );
});
