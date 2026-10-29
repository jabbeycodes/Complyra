import assert from "node:assert/strict";
import { test } from "node:test";
import type { Requirement } from "../../domain";
import { houseComplianceRows } from "./houseCompliance";

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

const ITEMS: Requirement[] = [
  req("w1", "Willow House", "Compliant"),
  req("w2", "Willow House", "Compliant"),
  req("w3", "Willow House", "Overdue"),
  req("w4", "Willow House", "Pending review"),
  req("c1", "Cedar House", "Compliant"),
  req("c2", "Cedar House", "Due soon"),
  req("x1", "Maple House", "Overdue"),
];

test("one row per visible site, items sliced to that house only", () => {
  const rows = houseComplianceRows(SITES, ITEMS, "All sites");
  assert.equal(rows.length, 2);
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  assert.deepEqual(
    willow.items.map((i) => i.id),
    ["w1", "w2", "w3", "w4"],
  );
  const cedar = rows.find((r) => r.siteName === "Cedar House")!;
  assert.deepEqual(
    cedar.items.map((i) => i.id),
    ["c1", "c2"],
  );
});

test("scores reuse the product metrics (pending review excluded from the base)", () => {
  const rows = houseComplianceRows(SITES, ITEMS, "All sites");
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  // 3 active (review excluded), 2 compliant → 67%; 1 overdue.
  assert.equal(willow.total, 3);
  assert.equal(willow.done, 2);
  assert.equal(willow.score, 67);
  assert.equal(willow.overdue, 1);
  assert.equal(willow.review, 1);
  const cedar = rows.find((r) => r.siteName === "Cedar House")!;
  assert.equal(cedar.score, 50);
  assert.equal(cedar.dueSoon, 1);
});

test("a specific focus narrows the rows to that house", () => {
  const rows = houseComplianceRows(SITES, ITEMS, "Cedar House");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].siteName, "Cedar House");
});

test("an unknown focus yields no rows rather than another house's data", () => {
  assert.deepEqual(houseComplianceRows(SITES, ITEMS, "Nowhere House"), []);
});

test("a house with no requirements scores as fully current with zero totals", () => {
  const rows = houseComplianceRows([{ id: "s9", name: "Empty House" }], ITEMS, "All sites");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 0);
  assert.equal(rows[0].score, 100);
  assert.deepEqual(rows[0].items, []);
});
