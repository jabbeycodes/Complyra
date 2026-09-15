/**
 * dmhRequirements.test.ts — the DMH checklist is data: validate its shape,
 * the append-without-code-changes contract, and the verification policy
 * (no unverified items ship).
 *
 * Run: node --import tsx --test src/data/dmhRequirements.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DMH_REQUIREMENTS,
  DMH_REQUIREMENT_CATEGORIES,
  DMH_REGULATORY_BASIS_NOTE,
  DMH_SOURCE_CAVEAT,
  defineDmhRequirement,
  dmhRequirementById,
  dmhRequirementsByCategory,
  type DmhRequirement,
} from "./dmhRequirements";

test("dmh: every requirement has id, title, category, evidence, checkRule, cite", () => {
  assert.ok(DMH_REQUIREMENTS.length > 0, "checklist is not empty");
  for (const item of DMH_REQUIREMENTS) {
    assert.ok(item.id, "id present");
    assert.ok(item.title, "title present");
    assert.ok(
      DMH_REQUIREMENT_CATEGORIES.some((entry) => entry.key === item.category),
      `${item.id}: known category`,
    );
    assert.ok(item.evidence.length > 10, `${item.id}: evidence description`);
    assert.ok(item.checkRule.length > 0, `${item.id}: checkRule name`);
    assert.ok(item.cite.length > 0, `${item.id}: regulation cite`);
  }
});

test("dmh: ids are unique slugs", () => {
  const ids = DMH_REQUIREMENTS.map((item) => item.id);
  assert.deepEqual([...new Set(ids)].sort(), [...ids].sort());
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/, `slug-shaped id: ${id}`);
  }
});

test("dmh: every shipped item is verified with a cite (no unverified items)", () => {
  for (const item of DMH_REQUIREMENTS) {
    assert.equal(item.verified, true, `${item.id} must be verified`);
    assert.ok(item.cite.trim().length > 0, `${item.id} must carry a cite`);
  }
});

test("dmh: all 14 research-verified items are present with their cites", () => {
  const expected: Array<[string, string]> = [
    ["provider-certification-olc", "9 CSR 45-5.060(2), (4)"],
    ["recertification-filed-60-days", "9 CSR 45-5.060(2)(E)"],
    ["certification-period-two-years", "9 CSR 45-5.060"],
    ["abuse-neglect-training-annual", "9 CSR 10-5.200"],
    ["first-aid-cpr-biennial", "9 CSR 45-5.010(3)(D)2.P."],
    ["fcsr-background-check", "§210.906, RSMo"],
    ["med-aide-16-hour-course", "9 CSR 45-3.070(13)–(14)"],
    ["med-aide-scope-limits", "9 CSR 45-3.070(1)"],
    ["event-reporting-timelines", "9 CSR 10-5.206"],
    ["plan-of-correction", "9 CSR 45-5.060(8)–(9)"],
    ["hipaa-training-annual", "9 CSR 45-5.010(3)(C)2.K"],
    ["event-reporting-training", "9 CSR 10-5.206"],
    ["administrator-qualifications", "9 CSR 45-5.010(7)"],
    ["survey-personnel-records", "9 CSR 45-5.060"],
  ];
  for (const [id, citeFragment] of expected) {
    const item = dmhRequirementById(id);
    assert.ok(item, `verified item present: ${id}`);
    assert.ok(
      item!.cite.includes(citeFragment),
      `${id} cite includes "${citeFragment}"`,
    );
  }
});

test("dmh: workflow-adjacent obligations are present (POC tracking, incident timeliness)", () => {
  assert.ok(dmhRequirementById("corrective-action-tracking"), "POC tracking item");
  assert.ok(dmhRequirementById("incident-reporting-timeliness"), "incident timeliness item");
});

test("dmh: unverified research topics are NOT in the shipped data", () => {
  const blob = JSON.stringify(DMH_REQUIREMENTS).toLowerCase();
  // No invented CSR numbers for topics the research could not verify.
  assert.ok(!blob.includes("isp renewal"), "no ISP-cycle CSR claim");
  assert.ok(!blob.includes("g-tube"), "no G-tube delegation rule");
  assert.ok(!blob.includes("evv"), "no EVV applicability claim");
  assert.ok(
    !blob.includes("unannounced survey"),
    "no unannounced-survey authority claim",
  );
  for (const item of DMH_REQUIREMENTS) {
    assert.ok(
      !/total initial dsp training hours/i.test(item.title + item.evidence),
      `${item.id}: no unverified training-hours claim`,
    );
  }
});

test("dmh: regulatory basis note and source caveat are present for the UI", () => {
  assert.ok(
    DMH_REGULATORY_BASIS_NOTE.toLowerCase().includes("not legal advice"),
    "basis note disclaims legal advice",
  );
  assert.ok(
    DMH_REGULATORY_BASIS_NOTE.toLowerCase().includes("confirm the current csr"),
    "basis note asks providers to confirm current CSR text",
  );
  assert.ok(
    DMH_SOURCE_CAVEAT.includes("9 CSR 45-5.020"),
    "caveat names the rescinded-cite example",
  );
});

test("dmh: defineDmhRequirement rejects bad appends", () => {
  const base: DmhRequirement = {
    id: "example-new-item",
    title: "Example",
    category: "training",
    evidence: "Some evidence description.",
    checkRule: "exampleRule",
    cite: "9 CSR 99-9.999",
    verified: true,
  };
  assert.doesNotThrow(() => defineDmhRequirement(base));
  assert.throws(
    () => defineDmhRequirement({ ...base, id: "Bad ID!" }),
    /slug/,
    "non-slug id rejected",
  );
  assert.throws(
    () => defineDmhRequirement({ ...base, cite: "" }),
    /cite/,
    "missing cite rejected",
  );
  assert.throws(
    () =>
      defineDmhRequirement({
        ...base,
        category: "nope" as DmhRequirement["category"],
      }),
    /category/,
    "unknown category rejected",
  );
});

test("dmh: grouped view covers every item exactly once", () => {
  const grouped = dmhRequirementsByCategory();
  const seen = grouped.flatMap((group) => group.items.map((item) => item.id));
  assert.deepEqual([...seen].sort(), DMH_REQUIREMENTS.map((i) => i.id).sort());
});
