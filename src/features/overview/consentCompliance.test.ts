import assert from "node:assert/strict";
import { test } from "node:test";
import type { Requirement } from "../../domain";
import type {
  ConsentRecord,
  ConsentRegister,
  ConsentRevocation,
} from "../../data/consents";
import { houseComplianceRows } from "./houseCompliance";
import {
  CONSENT_SCORE_UNKNOWN,
  consentProblemsText,
  consentRequirementItems,
  consentScoreStatus,
  consentTalliesFromItems,
  individualConsentStanding,
  type ConsentScoreInput,
} from "./consentCompliance";

/**
 * Founder decision, 2026-11-02: consent currency counts in compliance
 * scores. These pins lock the composition: expired or missing required
 * consents dent the house and flip the Individual's verdict; expiring
 * soon stays fully current; the shared consentStatus derivation is the
 * only status source; an unloaded register marks rows unknown instead
 * of fabricating a score.
 */

const TODAY = "2026-11-02";

const TYPES = [
  { id: "service", label: "Service consent", required: true, medication: false },
  { id: "medication", label: "Medication administration consent", required: true, medication: true },
  { id: "media", label: "Photo/media release", required: true, medication: false },
  { id: "other", label: "Other", required: false, medication: false },
];

const PEOPLE = [
  { id: "p-willow", agencyId: "a1", siteId: "site-willow", fullName: "Wren Willow" },
  { id: "p-cedar", agencyId: "a1", siteId: "site-cedar", fullName: "Carl Cedar" },
];

const SITE_NAMES = new Map([
  ["site-willow", "Willow House"],
  ["site-cedar", "Cedar House"],
]);

const SITES = [
  { id: "site-willow", name: "Willow House" },
  { id: "site-cedar", name: "Cedar House" },
];

let seq = 0;
function record(
  individualId: string,
  typeId: string,
  overrides: Partial<ConsentRecord> = {},
): ConsentRecord {
  seq += 1;
  return {
    id: `rec-${seq}`,
    agencyId: "a1",
    individualId,
    typeId,
    covers: "covers",
    giver: "guardian",
    giverName: "Guardian",
    relationship: "Guardian",
    signedOn: "2026-01-01",
    effectiveOn: "2026-01-01",
    reviewOn: "2027-01-01",
    supersedesId: null,
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    activatedBy: "admin",
    activatedAt: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

function register(
  records: ConsentRecord[],
  revocations: ConsentRevocation[] = [],
  individuals = PEOPLE,
): ConsentRegister {
  return { types: TYPES, records, revocations, individuals };
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

/* ------------------------------ status mapping ----------------------------- */

test("status mapping: current bands stay Compliant, lapsed bands join the attention side", () => {
  assert.equal(consentScoreStatus("Active"), "Compliant");
  // The decision's explicit band: expiring soon stays CURRENT — it must
  // not map to "Due soon", which sits outside the compliant count.
  assert.equal(consentScoreStatus("Expiring soon"), "Compliant");
  assert.equal(consentScoreStatus("Expired"), "Expired");
  assert.equal(consentScoreStatus("Revoked"), "Expired");
  assert.equal(consentScoreStatus("Missing"), "Overdue");
  assert.equal(consentScoreStatus("Draft"), "Overdue");
  assert.equal(consentScoreStatus("Scheduled"), "Overdue");
  assert.equal(consentScoreStatus("Superseded"), "Overdue");
});

/* ------------------------------ item synthesis ----------------------------- */

test("one scored item per Individual per REQUIRED type; optional types never score", () => {
  const reg = register([
    record("p-willow", "service"),
    record("p-willow", "medication"),
    record("p-willow", "media"),
  ]);
  const items = consentRequirementItems(reg, SITE_NAMES, TODAY);
  // 2 people x 3 required types; the optional "other" type is absent.
  assert.equal(items.length, 6);
  assert.ok(items.every((i) => i.category === "Consents"));
  assert.ok(items.every((i) => i.title !== "Other"));
  const wren = items.filter((i) => i.person === "Wren Willow");
  assert.equal(wren.length, 3);
  assert.ok(wren.every((i) => i.site === "Willow House"));
  assert.ok(wren.every((i) => i.status === "Compliant"));
  // Carl has no records at all: every required type is Missing.
  const carl = items.filter((i) => i.person === "Carl Cedar");
  assert.equal(carl.length, 3);
  assert.ok(carl.every((i) => i.status === "Overdue"));
  assert.ok(carl.every((i) => i.evidence === "Consent status: Missing"));
});

test("expired, expiring-soon, revoked, and draft records map through the shared derivation", () => {
  const revoked = record("p-willow", "media", { reviewOn: "2027-06-01" });
  const reg = register(
    [
      record("p-willow", "service", { reviewOn: "2026-10-01" }), // expired
      record("p-willow", "medication", { reviewOn: "2026-11-20" }), // expiring soon (<= 30d)
      revoked, // revoked below
      record("p-cedar", "service", { activatedAt: null, activatedBy: null }), // draft only
      record("p-cedar", "medication", { effectiveOn: "2026-12-01", reviewOn: "2027-12-01" }), // scheduled
      record("p-cedar", "media"), // active
    ],
    [{ consentId: revoked.id, revokedOn: "2026-10-15", revokedBy: "admin", revokedByName: "Admin", reason: "Withdrawn" }],
  );
  const items = consentRequirementItems(reg, SITE_NAMES, TODAY);
  const byKey = new Map(items.map((i) => [`${i.person}:${i.title}`, i.status]));
  assert.equal(byKey.get("Wren Willow:Service consent"), "Expired");
  assert.equal(byKey.get("Wren Willow:Medication administration consent"), "Compliant");
  assert.equal(byKey.get("Wren Willow:Photo/media release"), "Expired");
  assert.equal(byKey.get("Carl Cedar:Service consent"), "Overdue");
  assert.equal(byKey.get("Carl Cedar:Medication administration consent"), "Overdue");
  assert.equal(byKey.get("Carl Cedar:Photo/media release"), "Compliant");
});

test("a renewed consent scores by its current version, not the superseded one", () => {
  const old = record("p-willow", "service", { reviewOn: "2026-10-01" });
  const renewal = record("p-willow", "service", {
    effectiveOn: "2026-09-15",
    reviewOn: "2027-09-15",
    supersedesId: old.id,
    createdAt: "2026-09-15T00:00:00.000Z",
  });
  const reg = register([
    old,
    renewal,
    record("p-willow", "medication"),
    record("p-willow", "media"),
  ]);
  const items = consentRequirementItems(reg, SITE_NAMES, TODAY);
  const service = items.find(
    (i) => i.person === "Wren Willow" && i.title === "Service consent",
  )!;
  assert.equal(service.status, "Compliant");
  assert.equal(service.due, "2027-09-15");
});

/* --------------------------- per-Individual verdict ------------------------ */

test("individual standing: mixed current / expiring / expired / missing", () => {
  const reg = register([
    record("p-willow", "service", { reviewOn: "2026-10-01" }), // expired
    record("p-willow", "medication", { reviewOn: "2026-11-20" }), // expiring soon = current
    // media: no record = missing
  ]);
  const standing = individualConsentStanding(reg, "p-willow", TODAY);
  assert.equal(standing.required, 3);
  assert.equal(standing.current, 1);
  assert.equal(standing.expired, 1);
  assert.equal(standing.missing, 1);
  assert.equal(standing.compliant, false);
  assert.equal(consentProblemsText(standing), "1 expired · 1 missing");
  // DSP masking follows the register rule: never the word "Missing".
  assert.equal(consentProblemsText(standing, true), "1 expired · 1 not on file");
});

test("individual standing: all current (incl. expiring soon) is Compliant", () => {
  const reg = register([
    record("p-willow", "service"),
    record("p-willow", "medication", { reviewOn: "2026-11-20" }),
    record("p-willow", "media"),
  ]);
  const standing = individualConsentStanding(reg, "p-willow", TODAY);
  assert.equal(standing.compliant, true);
  assert.equal(standing.current, 3);
  assert.deepEqual(standing.problems, []);
});

/* ------------------------------ house scoring ------------------------------ */

const HOUSE_REQS: Requirement[] = [
  req("w1", "Willow House", "Compliant"),
  req("w2", "Willow House", "Compliant"),
  req("c1", "Cedar House", "Compliant"),
  req("c2", "Cedar House", "Compliant"),
];

test("an expired consent dents only its own house's score", () => {
  const reg = register([
    record("p-willow", "service", { reviewOn: "2026-10-01" }), // expired
    record("p-willow", "medication"),
    record("p-willow", "media"),
    record("p-cedar", "service"),
    record("p-cedar", "medication"),
    record("p-cedar", "media"),
  ]);
  const consent: ConsentScoreInput = {
    kind: "ready",
    items: consentRequirementItems(reg, SITE_NAMES, TODAY),
  };
  const rows = houseComplianceRows(SITES, HOUSE_REQS, "All sites", consent);
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  const cedar = rows.find((r) => r.siteName === "Cedar House")!;
  // Willow: 2 requirements + 3 consents = 5 active, 4 compliant, 1 overdue.
  assert.equal(willow.total, 5);
  assert.equal(willow.done, 4);
  assert.equal(willow.score, 80);
  assert.equal(willow.overdue, 1);
  assert.equal(willow.consentTotal, 3);
  assert.equal(willow.consentCurrent, 2);
  assert.equal(willow.consentNotCurrent, 1);
  assert.equal(willow.consentUnknown, false);
  // Cedar is untouched by Willow's expired consent.
  assert.equal(cedar.score, 100);
  assert.equal(cedar.overdue, 0);
  assert.equal(cedar.consentNotCurrent, 0);
});

test("expiring-soon consents do not dent the house score", () => {
  const reg = register([
    record("p-willow", "service", { reviewOn: "2026-11-20" }),
    record("p-willow", "medication", { reviewOn: "2026-11-20" }),
    record("p-willow", "media", { reviewOn: "2026-11-20" }),
    record("p-cedar", "service"),
    record("p-cedar", "medication"),
    record("p-cedar", "media"),
  ]);
  const consent: ConsentScoreInput = {
    kind: "ready",
    items: consentRequirementItems(reg, SITE_NAMES, TODAY),
  };
  const rows = houseComplianceRows(SITES, HOUSE_REQS, "All sites", consent);
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  assert.equal(willow.score, 100);
  assert.equal(willow.dueSoon, 0);
  assert.equal(willow.consentCurrent, 3);
});

test("a loaded register with no records scores every required consent as missing", () => {
  const reg = register([]);
  const consent: ConsentScoreInput = {
    kind: "ready",
    items: consentRequirementItems(reg, SITE_NAMES, TODAY),
  };
  const rows = houseComplianceRows(SITES, [], "All sites", consent);
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  assert.equal(willow.total, 3);
  assert.equal(willow.done, 0);
  assert.equal(willow.score, 0);
  assert.equal(willow.overdue, 3);
});

test("unknown register marks rows unknown and keeps consents out of the figures", () => {
  const rows = houseComplianceRows(SITES, HOUSE_REQS, "All sites", CONSENT_SCORE_UNKNOWN);
  for (const row of rows) {
    assert.equal(row.consentUnknown, true);
    assert.equal(row.consentTotal, 0);
    assert.ok(row.items.every((i) => i.category !== "Consents"));
  }
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  assert.equal(willow.score, 100); // requirements-only — flagged, not final
});

test("excluded (default) leaves the composition exactly as before", () => {
  const rows = houseComplianceRows(SITES, HOUSE_REQS, "All sites");
  const willow = rows.find((r) => r.siteName === "Willow House")!;
  assert.equal(willow.consentUnknown, false);
  assert.equal(willow.total, 2);
  assert.equal(willow.score, 100);
});

test("tallies over a person's scored items agree with their standing", () => {
  const reg = register([
    record("p-willow", "service", { reviewOn: "2026-10-01" }),
    record("p-willow", "medication"),
    record("p-willow", "media"),
  ]);
  const items = consentRequirementItems(reg, SITE_NAMES, TODAY).filter(
    (i) => i.person === "Wren Willow",
  );
  const tallies = consentTalliesFromItems(items);
  const standing = individualConsentStanding(reg, "p-willow", TODAY);
  assert.equal(tallies.total, standing.required);
  assert.equal(tallies.current, standing.current);
  assert.equal(tallies.notCurrent, standing.problems.length);
});
