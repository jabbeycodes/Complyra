/**
 * complianceScore.test.ts — score math: bands, weights, empty-category
 * renormalization, per-site ordering, snapshot helpers.
 *
 * Run: node --import tsx --test src/data/complianceScore.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SCORE_BAND_META,
  buildScoreSnapshotRow,
  computeComplianceScore,
  computeSiteScores,
  mergeFacts,
  scoreBand,
  snapshotTrend,
  sortSnapshotsOldestFirst,
  type ScoreFacts,
} from "./complianceScore";

function facts(overrides: Partial<ScoreFacts> = {}): ScoreFacts {
  return {
    siteId: null,
    requirements: [],
    certificates: [],
    checklists: [],
    training: [],
    medications: [],
    ...overrides,
  };
}

test("score: all good is 100 and compliant", () => {
  const result = computeComplianceScore(
    facts({
      requirements: ["ok", "ok"],
      certificates: ["ok"],
      checklists: ["submitted"],
      training: ["complete"],
      medications: ["ok"],
    }),
  );
  assert.equal(result.score, 100);
  assert.equal(result.band, "compliant");
});

test("score: bands are 90+ / 70-89 / <70", () => {
  assert.equal(scoreBand(100), "compliant");
  assert.equal(scoreBand(90), "compliant");
  assert.equal(scoreBand(89), "at-risk");
  assert.equal(scoreBand(70), "at-risk");
  assert.equal(scoreBand(69), "non-compliant");
  assert.equal(scoreBand(0), "non-compliant");
});

test("score: band meta has distinct label + icon per band", () => {
  const labels = new Set(Object.values(SCORE_BAND_META).map((m) => m.label));
  const icons = new Set(Object.values(SCORE_BAND_META).map((m) => m.icon));
  assert.equal(labels.size, 3);
  assert.equal(icons.size, 3);
});

test("score: partial credit for warning states", () => {
  // One category with a single "expiring" cert: 50, renormalized to 100% weight.
  const result = computeComplianceScore(facts({ certificates: ["expiring"] }));
  assert.equal(result.score, 50);
  assert.equal(result.breakdown.certificates.partial, 1);
});

test("score: empty categories are excluded and weights renormalize", () => {
  // Only requirements present (all ok) -> 100 even though 4 categories empty.
  const result = computeComplianceScore(facts({ requirements: ["ok", "ok"] }));
  assert.equal(result.score, 100);
  assert.equal(result.breakdown.certificates.total, 0);
  // Mixed: requirements all ok (weight .3), certs all expired (weight .25).
  const mixed = computeComplianceScore(
    facts({ requirements: ["ok"], certificates: ["expired"] }),
  );
  // (100*.3 + 0*.25) / .55 = 54.5 -> 55
  assert.equal(mixed.score, 55);
  assert.equal(mixed.band, "non-compliant");
});

test("score: no facts at all scores 0 (never a fake 100)", () => {
  const result = computeComplianceScore(facts());
  assert.equal(result.score, 0);
  assert.equal(result.factCount, 0);
});

test("score: per-site scores sort worst-first", () => {
  const rows = computeSiteScores([
    { ...facts(), siteId: "a", siteName: "Alpha", requirements: ["ok"] },
    {
      ...facts(),
      siteId: "b",
      siteName: "Beta",
      requirements: ["overdue", "overdue"],
    },
  ]);
  assert.equal(rows[0].siteName, "Beta");
  assert.equal(rows[1].siteName, "Alpha");
});

test("score: mergeFacts combines bundles for the agency score", () => {
  const merged = mergeFacts([
    { ...facts(), siteId: "a", requirements: ["ok"] },
    { ...facts(), siteId: "b", requirements: ["overdue"] },
  ]);
  assert.deepEqual(merged.requirements, ["ok", "overdue"]);
  assert.equal(merged.siteId, null);
});

test("score: snapshot row maps to the table shape", () => {
  const result = computeComplianceScore(facts({ requirements: ["ok"] }));
  const row = buildScoreSnapshotRow({
    agencyId: "agency-1",
    siteId: "site-1",
    result,
    computedAt: "2026-09-14T00:00:00.000Z",
  });
  assert.equal(row.agency_id, "agency-1");
  assert.equal(row.site_id, "site-1");
  assert.equal(row.score, 100);
  assert.equal(row.band, "compliant");
  assert.equal(row.computed_at, "2026-09-14T00:00:00.000Z");
  assert.ok(typeof row.breakdown === "object");
});

test("score: snapshots sort oldest-first; trend needs a 3-point move", () => {
  const rows = sortSnapshotsOldestFirst([
    { computedAt: "2026-09-14T00:00:00Z", score: 90 },
    { computedAt: "2026-09-01T00:00:00Z", score: 80 },
  ]);
  assert.equal(rows[0].score, 80);
  assert.equal(snapshotTrend(rows), "up");
  assert.equal(snapshotTrend([{ score: 80 }]), "flat");
  assert.equal(
    snapshotTrend([{ score: 80 }, { score: 81 }]),
    "flat",
    "1-point wobble is flat",
  );
  assert.equal(snapshotTrend([{ score: 90 }, { score: 80 }]), "down");
});
