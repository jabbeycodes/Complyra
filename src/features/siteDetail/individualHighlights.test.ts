/**
 * Issue #78 unit tests:
 *  - per-Individual highlight selection from EXISTING profile fields
 *  - "Site facts" filtering (Water is dropped, actionable facts kept)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { individualHighlights } from "./individualHighlights";
import {
  siteFactRows,
  siteFactVisible,
  HIDDEN_SITE_FACT_TERMS,
} from "./siteDetailCopy";
import type { IndividualProfile } from "../../data/planStack";
import type { AdaptiveEquipment } from "../../data/monthlyChecks";

function profile(overrides: Partial<IndividualProfile>): IndividualProfile {
  return {
    legalName: "",
    goesBy: "",
    dmhId: "",
    diagnosis: "",
    waiver: "",
    address: "",
    phone: "",
    language: "",
    implementationStart: "",
    implementationEnd: "",
    serviceCoordinator: "",
    guardians: [],
    providerContacts: [],
    sex: "",
    medicaidStatus: "",
    specializedDiet: "",
    specializedMedical: "",
    behaviorSupports: "",
    dailyActivities: "",
    visitHours: "",
    enrolledOn: "",
    allergies: [],
    allergiesStamp: null,
    ...overrides,
  };
}

function equipment(
  overrides: Partial<AdaptiveEquipment>,
): AdaptiveEquipment {
  return {
    id: "eq-1",
    agencyId: "agency-1",
    individualId: "ind-1",
    name: "Wheelchair",
    source: "manual",
    active: true,
    ...overrides,
  };
}

describe("individualHighlights (issue #78)", () => {
  it("lists safety-critical highlights first from existing profile fields", () => {
    const highlights = individualHighlights(
      "ind-1",
      profile({
        diagnosis: "Unspecified intellectual disability",
        specializedDiet: "No concentrated sweets.",
        specializedMedical: "Seizure protocol.",
        behaviorSupports: "Positive behavior supports on file",
        dailyActivities: "Day habilitation, weekdays",
        allergies: [
          { allergen: "Tree nuts", reaction: "hives", status: "active" },
        ],
      }),
      [equipment({})],
    );
    const labels = highlights.map((h) => h.label);
    assert.deepEqual(labels, [
      "Allergies",
      "Diagnosis",
      "Diet",
      "Medical",
      "Adaptive equipment",
      "Behavior supports",
      "Daily routine",
    ]);
    assert.equal(highlights[0].value, "Tree nuts (hives)");
    assert.equal(highlights[0].tone, "alert");
    assert.ok(
      highlights.slice(1).every((h) => h.tone === "neutral"),
      "only allergies use the alert tone",
    );
  });

  it("skips blank/placeholder values instead of rendering empty rows", () => {
    const highlights = individualHighlights(
      "ind-1",
      profile({
        diagnosis: "None",
        specializedDiet: "n/a",
        specializedMedical: "",
        behaviorSupports: "-",
        dailyActivities: "unknown",
      }),
      [],
    );
    assert.deepEqual(highlights, []);
  });

  it("skips placeholder allergen and equipment names like None or n/a", () => {
    const highlights = individualHighlights(
      "ind-1",
      profile({
        allergies: [{ allergen: "None", reaction: "n/a", status: "active" }],
      }),
      [equipment({ name: "n/a" }), equipment({ id: "eq-dash", name: "-" })],
    );
    assert.deepEqual(highlights, []);
  });

  it("ignores resolved allergies and inactive/other-individual equipment", () => {
    const highlights = individualHighlights(
      "ind-1",
      profile({
        allergies: [
          { allergen: "Penicillin", reaction: "", status: "resolved" },
        ],
      }),
      [
        equipment({ id: "eq-off", name: "Walker", active: false }),
        equipment({ id: "eq-other", name: "Shower chair", individualId: "ind-2" }),
      ],
    );
    assert.deepEqual(highlights, []);
  });

  it("returns an empty list when there is no profile", () => {
    assert.deepEqual(individualHighlights("ind-1", null, [equipment({})]), [
      { label: "Adaptive equipment", value: "Wheelchair", tone: "neutral" },
    ]);
    assert.deepEqual(individualHighlights("ind-1", null, []), []);
  });
});

describe("site facts filtering (issue #78)", () => {
  it("marks Water as non-actionable and keeps the rest visible", () => {
    assert.ok(HIDDEN_SITE_FACT_TERMS.has("Water"));
    assert.equal(siteFactVisible("Water"), false);
    for (const term of [
      "Program",
      "House manager",
      "Location",
      "Staffing",
      "Site contact",
    ]) {
      assert.equal(siteFactVisible(term), true, `${term} stays visible`);
    }
  });

  it("siteFactRows drops Water but keeps every actionable fact", () => {
    const rows = siteFactRows({
      program: "ISL",
      manager: "Sarah Mitchell",
      location: "Cedar House · Boone County",
      staffing: "Staffed 24 hours",
      water: "Municipal water",
      contact: "sarah@example.com",
    });
    const terms = rows.map((r) => r.term);
    assert.deepEqual(terms, [
      "Program",
      "House manager",
      "Location",
      "Staffing",
      "Site contact",
    ]);
    assert.ok(
      !terms.includes("Water"),
      "Water must never render in Site facts",
    );
  });

  it("siteFactRows omits the contact row when no contact is recorded", () => {
    const rows = siteFactRows({
      program: "ISL",
      manager: "—",
      location: "—",
      staffing: "Not staffed 24 hours",
      water: "Well water",
      contact: null,
    });
    assert.ok(!rows.some((r) => r.term === "Site contact"));
    assert.ok(!rows.some((r) => r.term === "Water"));
  });
});
