import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Dashboard from "./Dashboard";
import type { Requirement } from "./domain";
import { todayIso } from "./data/chart";
import type { DashboardFilters } from "./data/dashboardFilters";

function isoPlusDays(days: number): string {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SITES = [
  {
    id: "s1",
    name: "Maple House",
    address: "3201 Pompey Drive",
    program: "Residential services",
    manager: "Sarah Mitchell",
  },
  {
    id: "s2",
    name: "Oakwood House",
    address: "1840 Oakwood Lane",
    program: "Day services",
    manager: "James Wilson",
  },
];

const ITEMS: Requirement[] = [
  {
    id: "r1",
    title: "Fire drill",
    person: "Site-wide",
    site: "Maple House",
    category: "Emergency drills",
    owner: "Sarah Mitchell",
    role: "HM",
    due: isoPlusDays(60),
    status: "Compliant",
    source: "test",
    page: 1,
    frequency: "Monthly",
    evidence: "test",
  },
  {
    id: "r2",
    title: "Extinguisher check",
    person: "Site-wide",
    site: "Oakwood House",
    category: "Equipment checks",
    owner: "James Wilson",
    role: "HM",
    due: isoPlusDays(-2),
    status: "Overdue",
    source: "test",
    page: 1,
    frequency: "Monthly",
    evidence: "test",
  },
  {
    id: "r3",
    title: "First-aid kit check",
    person: "Site-wide",
    site: "Maple House",
    category: "Equipment checks",
    owner: "Sarah Mitchell",
    role: "HM",
    due: isoPlusDays(3),
    status: "Due soon",
    source: "test",
    page: 1,
    frequency: "Monthly",
    evidence: "test",
  },
];

function render(
  overrides: {
    site?: string;
    initialFilters?: Partial<DashboardFilters>;
  } = {},
): string {
  const noop = () => {};
  return renderToStaticMarkup(
    <Dashboard
      items={ITEMS}
      allItems={ITEMS}
      activity={[]}
      sites={SITES}
      individuals={[]}
      site={overrides.site ?? "All sites"}
      personalItems={[]}
      onSite={noop}
      onNavigate={noop}
      onRequirement={noop}
      onOpenPerson={noop}
      onCopilot={noop}
      onActivity={noop}
      initialFilters={overrides.initialFilters}
    />,
  );
}

describe("Dashboard filter bar", () => {
  it("renders labeled selects with real options from the data", () => {
    const html = render();
    for (const label of [
      'aria-label="Filter by site"',
      'aria-label="Filter by program"',
      'aria-label="Filter by category"',
      'aria-label="Filter by requirement status"',
      'aria-label="Filter by due window"',
    ]) {
      assert.ok(html.includes(label), label);
    }
    for (const option of [
      "All programs",
      "Residential services",
      "Day services",
      "All categories",
      "Emergency drills",
      "Equipment checks",
      "All statuses",
      "Compliant",
      "Overdue",
      "Pending review",
      "All time",
      "Overdue only",
      "Due in 7 days",
      "Due in 14 days",
      "Due in 30 days",
    ]) {
      assert.ok(html.includes(`>${option}<`), `option "${option}"`);
    }
  });

  it("hides the reset control until a filter is active", () => {
    assert.ok(!render().includes("Reset filters"), "no reset by default");
    assert.ok(
      render({ initialFilters: { category: "Emergency drills" } }).includes(
        "Reset filters",
      ),
      "reset appears when filtered",
    );
  });

  it("narrows the donut and stat cards when a filter is applied", () => {
    const html = render({ initialFilters: { category: "Emergency drills" } });
    assert.ok(
      html.includes("Compliant 1 (100%)"),
      "donut reflects the filtered set",
    );
    assert.ok(
      html.includes(">100<span>%</span>"),
      "agency score reflects the filtered set",
    );
  });

  it("combines filters with AND", () => {
    const html = render({
      initialFilters: { program: "Day services", status: "Overdue" },
    });
    assert.ok(
      html.includes("Overdue or expired 1 (100%)"),
      "donut shows only the intersection",
    );
    // The Maple House overdue-free program slice is excluded.
    assert.ok(!html.includes("Compliant 1"), "non-matching slice excluded");
  });

  it("combines the new filters with the site selector", () => {
    const html = render({
      site: "Maple House",
      initialFilters: { category: "Equipment checks" },
    });
    assert.ok(
      html.includes("Due soon 1 (100%)"),
      "site + category intersection",
    );
  });

  it("renders an empty state with a reset action when nothing matches", () => {
    const html = render({ initialFilters: { status: "Expired" } });
    assert.ok(
      html.includes("No matching requirements"),
      "empty-state title",
    );
    assert.ok(html.includes("Reset filters"), "reset action offered");
    assert.ok(
      !html.includes("Agency current"),
      "stat cards hidden on empty result",
    );
  });

  it("keeps the unfiltered dashboard identical without initial filters", () => {
    const html = render();
    assert.ok(html.includes(">33<span>%</span>"), "agency score 33%");
    assert.ok(
      html.includes("Compliant 1 (33%)"),
      "donut covers the full set",
    );
  });
});
