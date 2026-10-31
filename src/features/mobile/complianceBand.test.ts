import assert from "node:assert/strict";
import { test } from "node:test";
import type { Requirement } from "../../domain";
import type { SessionUser } from "../../data/types";
import type { PersonalComplianceSummary } from "../personalCompliance/personalCompliance";
import {
  bandHouseRows,
  houseHasDonut,
  houseSlices,
  houseSliceTotal,
  segmentBarParts,
} from "./complianceBand";

function session(roleKey: string, siteId: string | null = null): SessionUser {
  return {
    userId: `user-${roleKey}`,
    roleKey,
    siteId,
    platformAdmin: false,
  } as SessionUser;
}

function req(id: string, site: string, status: Requirement["status"]): Requirement {
  return {
    id,
    title: id,
    category: "Required forms",
    person: "—",
    site,
    owner: "—",
    role: "—",
    due: "2026-09-12",
    status,
    source: "test",
    page: 1,
    frequency: "Once",
    evidence: "",
  };
}

const SITES = [
  { id: "site-willow", name: "Willow House" },
  { id: "site-cedar", name: "Cedar House" },
];

const STAFF = [
  { id: "user-house_manager", siteId: "site-willow" },
  { id: "user-dsp", siteId: "site-cedar" },
];

const ITEMS: Requirement[] = [
  req("w1", "Willow House", "Compliant"),
  req("w2", "Willow House", "Compliant"),
  req("w3", "Willow House", "Overdue"),
  req("w4", "Willow House", "Pending review"),
  req("c1", "Cedar House", "Compliant"),
  req("c2", "Cedar House", "Due soon"),
  req("x1", "Maple House", "Overdue"),
];

test("roles without house scope get no house rows at all", () => {
  for (const roleKey of ["dsp", "nurse", "auditor", "hr", "compliance_admin"]) {
    assert.equal(
      bandHouseRows(session(roleKey), SITES, STAFF, ITEMS),
      null,
      `${roleKey} must not receive house rows`,
    );
  }
});

test("an administrator sees every house with the desktop Overview's numbers", () => {
  const rows = bandHouseRows(session("administrator"), SITES, STAFF, ITEMS)!;
  assert.equal(rows.length, 2);
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  // Same expectations the desktop houseCompliance tests pin: 3 active
  // (review excluded from the base), 2 compliant → 67%, 1 overdue.
  assert.equal(willow.total, 3);
  assert.equal(willow.done, 2);
  assert.equal(willow.score, 67);
  assert.equal(willow.overdue, 1);
  const cedar = rows.find((r) => r.siteName === "Cedar House")!;
  assert.equal(cedar.score, 50);
  assert.equal(cedar.dueSoon, 1);
  // The Maple House item belongs to no visible site and leaks nowhere.
  assert.ok(rows.every((r) => r.items.every((i) => i.id !== "x1")));
});

test("a house manager sees only their assigned house", () => {
  const rows = bandHouseRows(
    session("house_manager", "site-willow"),
    SITES,
    STAFF,
    ITEMS,
  )!;
  assert.deepEqual(
    rows.map((r) => r.siteName),
    ["Willow House"],
  );
});

test("a house-scope role with no house in scope gets an empty list, not null", () => {
  // No session site and no staff assignment anywhere: nothing visible.
  const rows = bandHouseRows(session("house_manager"), SITES, [], ITEMS);
  assert.deepEqual(rows, []);
});

function summary(partial: Partial<PersonalComplianceSummary>): PersonalComplianceSummary {
  return {
    total: 0,
    current: 0,
    dueSoon: 0,
    missingOrExpired: 0,
    percentCurrent: 100,
    attentionCount: 0,
    attention: [],
    ...partial,
  };
}

test("segment bar parts carry counts and shares that sum to the whole", () => {
  const parts = segmentBarParts(
    summary({ total: 10, current: 7, dueSoon: 2, missingOrExpired: 1 }),
  );
  assert.deepEqual(
    parts.map((p) => [p.key, p.count, p.percent]),
    [
      ["current", 7, 70],
      ["dueSoon", 2, 20],
      ["missingOrExpired", 1, 10],
    ],
  );
  assert.equal(
    parts.reduce((sum, p) => sum + p.percent, 0),
    100,
  );
});

test("segment bar parts are all zero when nothing is tracked", () => {
  const parts = segmentBarParts(summary({}));
  assert.ok(parts.every((p) => p.count === 0 && p.percent === 0));
});

test("house slices mirror the desktop donut's status mix", () => {
  const rows = bandHouseRows(session("administrator"), SITES, STAFF, ITEMS)!;
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  const slices = houseSlices(willow);
  // Upcoming has no items at Willow, so it drops out — the desktop rule.
  assert.deepEqual(
    slices.map((s) => [s.key, s.count]),
    [
      ["compliant", 2],
      ["dueSoon", 0],
      ["overdue", 1],
      ["review", 1],
    ],
  );
  assert.equal(houseSliceTotal(slices), 4);
  assert.equal(houseHasDonut(willow), true);
});

test("a house with nothing tracked has no donut to draw", () => {
  const rows = bandHouseRows(session("administrator"), SITES, STAFF, [])!;
  assert.ok(rows.every((r) => !houseHasDonut(r)));
});
