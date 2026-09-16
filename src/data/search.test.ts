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
