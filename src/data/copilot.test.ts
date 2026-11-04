import { test } from "node:test";
import assert from "node:assert/strict";
import type { Requirement } from "../domain";
import {
  copilotDisclosure,
  copilotEmptyText,
  copilotFallbackText,
  copilotScopeLabel,
  copilotSuggestions,
} from "./copilot";

// Batch 13: Ask Complyrer showed the Evergreen demo's content — the
// suggestion "Who needs to acknowledge Ellis's PCSP?" and "sample
// records" framing — to a real hosted agency. These fixtures model a
// real agency (Northstar-style names) and pin the hard separation: a
// non-demo session's assistant payload contains no demo/showcase
// records or wording, and a suggestion only ever names a person in the
// caller's own scoped Individual list.

function requirement(partial: Partial<Requirement>): Requirement {
  return {
    id: "req-1",
    title: "Acknowledge current PCSP",
    person: "Alex Rivera",
    site: "Maple House",
    category: "PCSP acknowledgments",
    owner: "Harper Lane",
    role: "House Manager",
    due: "2026-11-01",
    status: "Due soon",
    frequency: "Annual",
    source: "PCSP 2026",
    page: 1,
    evidence: "",
    ...partial,
  } as Requirement;
}

const realAgency = {
  demoMode: false,
  individuals: [{ name: "Alex Rivera" }, { name: "Bailey Chen" }],
  requirements: [requirement({})],
};

test("hosted session suggestions name the agency's own Individual, never Ellis", () => {
  const suggestions = copilotSuggestions(realAgency);
  assert.ok(
    suggestions.includes("Who needs to acknowledge Alex’s PCSP?"),
    `expected an Alex PCSP suggestion, got ${JSON.stringify(suggestions)}`,
  );
  for (const s of suggestions) {
    assert.ok(!/Ellis/i.test(s), `demo name leaked into suggestion: ${s}`);
    assert.ok(!/sample/i.test(s), `sample wording leaked into suggestion: ${s}`);
  }
});

test("hosted session framing contains no sample/demo wording anywhere", () => {
  const payload = [
    copilotDisclosure(false, "All sites"),
    copilotEmptyText(false),
    copilotFallbackText(false),
    copilotScopeLabel(false, "All sites"),
    ...copilotSuggestions(realAgency),
  ].join("\n");
  assert.ok(!/sample/i.test(payload), `sample wording leaked:\n${payload}`);
  assert.ok(!/Ellis/i.test(payload), `demo name leaked:\n${payload}`);
  assert.match(copilotDisclosure(false, "All sites"), /your agency’s records/);
  assert.equal(copilotScopeLabel(false, "All sites"), "your agency");
  assert.equal(copilotScopeLabel(false, "Maple House"), "Maple House");
});

test("a suggestion never names a person outside the caller's scoped list", () => {
  // The requirement references Ellis Hart, but Ellis is not among the
  // Individuals this caller can see — no Ellis suggestion may appear.
  const suggestions = copilotSuggestions({
    demoMode: false,
    individuals: [{ name: "Alex Rivera" }],
    requirements: [requirement({ person: "Ellis Hart" })],
  });
  assert.ok(!suggestions.some((s) => /Ellis/i.test(s)));
  assert.ok(suggestions.includes("What’s overdue right now?"));
});

test("without PCSP work in scope, the third suggestion stays generic", () => {
  const suggestions = copilotSuggestions({
    demoMode: false,
    individuals: [{ name: "Alex Rivera" }],
    requirements: [requirement({ category: "Nursing delegations" })],
  });
  assert.equal(suggestions.length, 3);
  assert.ok(suggestions.includes("What’s overdue right now?"));
});

test("demo session keeps the sample framing and its own Ellis suggestion", () => {
  const suggestions = copilotSuggestions({
    demoMode: true,
    individuals: [{ name: "Ellis Hart" }, { name: "Morgan Pruitt" }],
    requirements: [requirement({ person: "Ellis Hart" })],
  });
  assert.ok(suggestions.includes("Who needs to acknowledge Ellis’s PCSP?"));
  assert.match(copilotDisclosure(true, "All sites"), /sample records/);
  assert.equal(copilotScopeLabel(true, "All sites"), "the sample agency");
});
