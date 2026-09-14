import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_TOUR_SEEN_KEY,
  TOUR_STEPS,
  isDemoSession,
} from "./tourSteps";
import { DEMO_AGENCY_CODE } from "../data/seed";

const KNOWN_PAGES = new Set([
  "Overview",
  "Training",
  "Delegations",
  "Certificates",
  "Mileage",
  "Weekly checklist",
  "Supply forecast",
]);

test("every tour step has a page, target, title, and body", () => {
  assert.ok(TOUR_STEPS.length >= 8, "tour should have at least 8 stops");
  for (const step of TOUR_STEPS) {
    assert.ok(step.page.trim(), "step needs a page");
    assert.ok(step.target.trim(), "step needs a data-tour target");
    assert.ok(step.title.trim(), "step needs a title");
    assert.ok(step.body.trim(), "step needs body copy");
    assert.ok(
      KNOWN_PAGES.has(step.page),
      `step page "${step.page}" must be a real app page`,
    );
  }
});

test("tour step targets are unique so each stop resolves to one element", () => {
  const targets = TOUR_STEPS.map((s) => s.target);
  assert.equal(new Set(targets).size, targets.length);
});

test("tour covers the core demo surfaces", () => {
  const targets = new Set(TOUR_STEPS.map((s) => s.target));
  for (const expected of [
    "command-center",
    "risk-list",
    "due-next",
    "training",
    "delegations",
    "certificates",
    "mileage",
    "hm-checklist",
    "med-inventory",
  ]) {
    assert.ok(targets.has(expected), `tour should stop at ${expected}`);
  }
});

test("demo tour seen flag key is stable", () => {
  assert.equal(DEMO_TOUR_SEEN_KEY, "complyrer-demo-tour-seen");
});

// Regression: the med-inventory stop once navigated to a page name that
// doesn't exist ("Med inventory"), rendering a blank page on the last step.
test("med inventory stop navigates to the real page name", () => {
  const stop = TOUR_STEPS.find((s) => s.target === "med-inventory");
  assert.ok(stop, "tour should stop at med-inventory");
  assert.equal(stop.page, "Supply forecast");
});

test("isDemoSession detects the fictional demo agency", () => {
  assert.equal(isDemoSession({ agencyCode: DEMO_AGENCY_CODE }), true);
  assert.equal(isDemoSession({ agencyCode: "evergreen-mo" }), false);
  assert.equal(isDemoSession({ agencyCode: "COMPLYRER-MO" }), false);
  assert.equal(isDemoSession({ agencyCode: "SUNRISE-MO" }), false);
  assert.equal(isDemoSession(null), false);
  assert.equal(isDemoSession(undefined), false);
  assert.equal(isDemoSession({}), false);
});
