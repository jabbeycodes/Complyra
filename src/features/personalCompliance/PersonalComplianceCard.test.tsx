/**
 * Static-markup tests for the personal compliance Views (the pure
 * presentations behind the Overview card/strip and the mobile card).
 * The wrappers load through usePersonalCompliance; here the state is
 * fabricated from real ReadinessResults via the production summary math.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReadinessResult } from "../../data/hr";
import { MobileComplianceCardView } from "../mobile/MobileComplianceCard";
import {
  PersonalComplianceCardView,
  PersonalComplianceStripView,
} from "./PersonalComplianceCard";
import { summarizePersonalCompliance } from "./personalCompliance";
import type { PersonalComplianceState } from "./usePersonalCompliance";

function result(
  id: string,
  label: string,
  status: ReadinessResult["status"],
  dueOn: string | null = null,
): ReadinessResult {
  return {
    requirement: {
      id,
      agencyId: "agency-1",
      key: id,
      label,
      kind: "certificate",
      dueEveryDays: null,
      requiredRoleKeys: [],
      active: true,
    },
    status,
    evidenceNote: null,
    dueOn,
  };
}

function state(items: ReadinessResult[]): PersonalComplianceState {
  return {
    loading: false,
    error: "",
    items,
    summary: summarizePersonalCompliance(items),
  };
}

const noop = () => {};

const MIXED = [
  result("cpr", "CPR certification", "missing_or_expired", "2026-09-30"),
  result("fire", "Fire safety training", "complete", "2027-03-01"),
  result("med", "Medication administration", "complete", "2027-01-01"),
  result("hipaa", "HIPAA acknowledgment", "complete", null),
  result("aid", "First aid certificate", "due_soon", "2026-11-15"),
  result("bg", "Background check", "missing_or_expired", null),
];

test("card: headline grammar matches the house donuts, attention capped at three", () => {
  const html = renderToStaticMarkup(
    <PersonalComplianceCardView state={state(MIXED)} onView={noop} />,
  );
  assert.match(html, /50%<\/strong> current · 3 of 6 complete/);
  assert.match(html, /3 need your attention/);
  // Donut legend spells every segment out as text.
  assert.match(html, /Current/);
  assert.match(html, /Due soon/);
  assert.match(html, /Missing or expired/);
  // Attention items: missing first, with the status as text.
  const bgAt = html.indexOf("Background check");
  const cprAt = html.indexOf("CPR certification");
  const aidAt = html.indexOf("First aid certificate");
  assert.ok(bgAt > -1 && cprAt > -1 && aidAt > -1);
  assert.ok(bgAt < cprAt && cprAt < aidAt);
  assert.match(html, /View my compliance/);
});

test("card: zero requirements renders the calm empty state, no donut", () => {
  const html = renderToStaticMarkup(
    <PersonalComplianceCardView state={state([])} onView={noop} />,
  );
  assert.match(html, /No requirements assigned/);
  assert.doesNotMatch(html, /status-mix/);
});

test("card: loading and error states stay textual", () => {
  const loading = renderToStaticMarkup(
    <PersonalComplianceCardView
      state={{ loading: true, error: "", items: [], summary: summarizePersonalCompliance([]) }}
      onView={noop}
    />,
  );
  assert.match(loading, /Loading your compliance/);
  const errored = renderToStaticMarkup(
    <PersonalComplianceCardView
      state={{ loading: false, error: "Boom.", items: [], summary: summarizePersonalCompliance([]) }}
      onView={noop}
    />,
  );
  assert.match(errored, /role="alert"/);
  assert.match(errored, /Boom\./);
});

test("strip: mini donut plus counts and the attention call-out", () => {
  const html = renderToStaticMarkup(
    <PersonalComplianceStripView state={state(MIXED)} onView={noop} />,
  );
  assert.match(html, /My compliance/);
  assert.match(html, /50%<\/strong> current · 3 of 6 complete/);
  assert.match(html, /3 items need your attention/);
  assert.match(html, /View my compliance/);
});

test("strip: all current reads as nothing needing attention", () => {
  const html = renderToStaticMarkup(
    <PersonalComplianceStripView
      state={state([result("a", "A", "complete")])}
      onView={noop}
    />,
  );
  assert.match(html, /100%<\/strong> current · 1 of 1 complete/);
  assert.match(html, /nothing needs your attention/);
});

test("mobile card: percent, attention count, and the single next item", () => {
  const html = renderToStaticMarkup(
    <MobileComplianceCardView state={state(MIXED)} onOpen={noop} />,
  );
  assert.match(html, /My compliance/);
  assert.match(html, /50% current · 3 of 6 complete · 3 need attention/);
  // Next item is the first attention item (missing, no due date on file).
  assert.match(html, /Next: Background check · Missing or expired/);
});

test("mobile card: empty roll-up stays calm", () => {
  const html = renderToStaticMarkup(
    <MobileComplianceCardView state={state([])} onOpen={noop} />,
  );
  assert.match(html, /No requirements assigned to your role right now\./);
});
