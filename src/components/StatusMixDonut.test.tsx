/**
 * Aria-prefix contract for the status-mix donut: the figure's label
 * names the population it actually renders. A requirements-only pool
 * keeps the original "Requirement status mix" wording byte-identical;
 * a pool that includes scored consent items reads "Requirements and
 * consents status mix", matching requirementPopulation's scopeName.
 * Detection is the population contract's own — an item carrying
 * CONSENT_ITEM_CATEGORY flips includesConsents — plumbed in as a prop
 * because this component sits below features and cannot import it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Requirement } from "../domain";
import StatusMixDonut from "./StatusMixDonut";
import { requirementPopulation } from "../features/overview/requirementPopulation";
import { CONSENT_ITEM_CATEGORY } from "../features/overview/consentCompliance";

const requirement = {
  id: "r1",
  site: "Juniper",
  status: "Compliant",
  category: "Required forms",
} as Requirement;
const consent = {
  id: "consent:p1:medication",
  site: "Juniper",
  status: "Expired",
  category: CONSENT_ITEM_CATEGORY,
} as Requirement;

test("status mix donut: requirements-only pool keeps the original aria prefix", () => {
  const html = renderToStaticMarkup(<StatusMixDonut items={[requirement]} />);
  assert.match(html, /aria-label="Requirement status mix\./);
  assert.ok(!html.includes("consents status mix"));
});

test("status mix donut: population detection on a requirements-only pool leaves the prefix unchanged", () => {
  const population = requirementPopulation([requirement]);
  assert.equal(population.includesConsents, false);
  const html = renderToStaticMarkup(
    <StatusMixDonut
      items={[requirement]}
      includesConsents={population.includesConsents}
    />,
  );
  assert.match(html, /aria-label="Requirement status mix\./);
  assert.ok(!html.includes("consents status mix"));
});

test("status mix donut: combined pool names requirements and consents in the aria prefix", () => {
  const items = [requirement, consent];
  const population = requirementPopulation(items);
  assert.equal(population.includesConsents, true);
  assert.equal(population.scopeName, "Requirements and consents");
  const html = renderToStaticMarkup(
    <StatusMixDonut items={items} includesConsents={population.includesConsents} />,
  );
  assert.match(html, /aria-label="Requirements and consents status mix\./);
});
