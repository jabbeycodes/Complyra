import { test } from "node:test";
import assert from "node:assert/strict";
import { seedRequirements } from "../domain";
import { requirementMatchesQuery, searchRequirements } from "./search";

test("Ellis search does not return five identical current-PCSP rows", () => {
  const hits = searchRequirements(seedRequirements, "Ellis");
  assert.ok(hits.length > 0);
  const ids = hits.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);

  const current = hits.filter((r) => r.title === "Acknowledge current PCSP");
  assert.ok(
    current.length < 5,
    `expected fewer than five current-PCSP rows, got ${current.length}`,
  );
  const fingerprints = hits.map(
    (r) => `${r.title}|${r.status}|${r.due}|${r.page}`,
  );
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test("duplicate ids collapse to one row", () => {
  const first = seedRequirements[0]!;
  const duped = [first, { ...first }, ...seedRequirements];
  const hits = searchRequirements(duped, first.person);
  assert.equal(hits.filter((r) => r.id === first.id).length, 1);
});

test("empty query matches nothing so the empty-state copy stays gated", () => {
  assert.equal(searchRequirements(seedRequirements, "   ").length, 0);
  assert.equal(requirementMatchesQuery(seedRequirements[0]!, ""), false);
});

test("visually identical clones collapse to one search row", () => {
  // Seed titles changed on main ("Acknowledge current PCSP" no longer exists),
  // so build the clone deterministically instead of depending on seed data.
  const base = seedRequirements.find((r) => r.person.includes("Ellis"))!;
  assert.ok(base, "seed has a Ellis requirement");
  const clone = { ...base, id: "CLONE-LOOKALIKE-1" };
  const hits = searchRequirements([base, clone], "Ellis");
  assert.equal(hits.length, 1);
});

test("open work ranks above compliant copies of the same person", () => {
  const hits = searchRequirements(seedRequirements, "Ellis");
  const firstOpen = hits.findIndex((r) => r.status !== "Compliant");
  const firstCompliant = hits.findIndex((r) => r.status === "Compliant");
  if (firstOpen >= 0 && firstCompliant >= 0) {
    assert.ok(firstOpen < firstCompliant);
  }
});

// Batch 13: header search must find people and homes in a real agency
// whose requirement collection may be empty. The caller passes only
// collections already scoped to the caller's readable sites; these
// fixtures model that post-scope input (a Juniper-only caller never
// receives Maple rows at all).
import { directoryNameMatches, searchDirectory } from "./search";

const directoryFixture = {
  individuals: [
    { id: "ind-alex", name: "Alex Rivera", site: "Maple House" },
    { id: "ind-bailey", name: "Bailey Chen", site: "Maple House" },
    { id: "ind-cameron", name: "Cameron Ortiz", site: "Juniper House" },
  ],
  staff: [
    { id: "st-harper", name: "Harper Lane", role: "House Manager", site: "Maple House" },
    { id: "st-avery", name: "Avery Brooks", role: "DSP", site: "Maple House" },
    { id: "st-quinn", name: "Morgan Quinn", role: "Nurse", site: "Agency-wide" },
  ],
  sites: [
    { id: "site-maple", name: "Maple House" },
    { id: "site-juniper", name: "Juniper House" },
  ],
};

test("directory search finds an Individual by first name", () => {
  const hits = searchDirectory(directoryFixture, "Alex");
  assert.deepEqual(
    hits.filter((h) => h.kind === "individual").map((h) => h.id),
    ["ind-alex"],
  );
});

test("directory search finds an Individual by last name and by partial tokens", () => {
  assert.ok(directoryNameMatches("Alex Rivera", "Rivera"));
  assert.ok(directoryNameMatches("Alex Rivera", "alex riv"));
  assert.ok(!directoryNameMatches("Alex Rivera", "Bailey"));
  const hits = searchDirectory(directoryFixture, "Chen");
  assert.deepEqual(
    hits.filter((h) => h.kind === "individual").map((h) => h.id),
    ["ind-bailey"],
  );
});

test("directory search finds staff and sites by name", () => {
  const staffHits = searchDirectory(directoryFixture, "Harper");
  assert.deepEqual(
    staffHits.filter((h) => h.kind === "staff").map((h) => h.id),
    ["st-harper"],
  );
  const siteHits = searchDirectory(directoryFixture, "Juniper");
  assert.ok(siteHits.some((h) => h.kind === "site" && h.id === "site-juniper"));
  // Individuals match on their own name, not their home's name.
  assert.ok(!siteHits.some((h) => h.kind === "individual"));
});

test("directory search cannot leak records the caller never received", () => {
  // A Maple-only caller's scoped input contains no Juniper people; a
  // query for a Juniper Individual must come back empty rather than
  // reaching across the scope boundary.
  const mapleOnly = {
    individuals: directoryFixture.individuals.filter((p) => p.site === "Maple House"),
    staff: directoryFixture.staff.filter((s) => s.site !== "Juniper House"),
    sites: directoryFixture.sites.filter((s) => s.id === "site-maple"),
  };
  assert.equal(searchDirectory(mapleOnly, "Cameron").length, 0);
  assert.equal(searchDirectory(mapleOnly, "Juniper").length, 0);
  assert.ok(searchDirectory(mapleOnly, "Alex").length > 0);
});

test("directory search matches nothing on an empty query", () => {
  assert.equal(searchDirectory(directoryFixture, "   ").length, 0);
  assert.equal(directoryNameMatches("Alex Rivera", ""), false);
});
