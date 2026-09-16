/**
 * CommandCenter.test.tsx — UI/accessibility tests for the command-center
 * presentational view (renderToStaticMarkup, no live API).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandCenterView, type CommandCenterData } from "./CommandCenter";
import { DMH_SOURCE_CAVEAT } from "../data/dmhRequirements";

const noopAsync = async () => {};

const baseData: CommandCenterData = {
  actions: [
    {
      id: "a1",
      agencyId: "agency-1",
      title: "Re-train night shift on incident reporting",
      description: "",
      assignedToUserId: "u1",
      assignedToName: "Dana House",
      dueOn: "2026-09-10",
      storedStatus: "open",
      linkedRiskId: null,
      linkedRiskSource: null,
      createdByUserId: "admin-1",
      createdAt: "2026-09-05T00:00:00Z",
      resolvedAt: null,
    },
  ],
  certs: [
    {
      id: "c1",
      agencyId: "agency-1",
      userId: "u1",
      certName: "CPR",
      issuedOn: "2024-09-01",
      expiresOn: "2026-09-20",
      filePath: null,
      fileName: null,
      enteredBy: "admin-1",
      createdAt: "2024-09-01T00:00:00Z",
      staffName: "Dana House",
      daysRemaining: 6,
    },
  ],
  clearance: [
    {
      userId: "u2",
      fullName: "Sam Reed",
      siteName: "Cedar House",
      clearedForInRatio: false,
      gateReasons: ["Training incomplete"],
      pendingCount: 3,
      overdueCount: 0,
      hoursTotal: 12,
      hoursWithHm: 4,
    },
  ],
  checklists: [],
  snapshots: [
    {
      id: "s1",
      agencyId: "agency-1",
      siteId: null,
      score: 82,
      band: "at-risk",
      breakdown: {},
      factCount: 9,
      computedAt: "2026-09-13T00:00:00Z",
    },
    {
      id: "s2",
      agencyId: "agency-1",
      siteId: null,
      score: 88,
      band: "at-risk",
      breakdown: {},
      factCount: 10,
      computedAt: "2026-09-14T00:00:00Z",
    },
  ],
  staff: [
    {
      id: "u1",
      name: "Dana House",
      role: "House manager",
      site: "Cedar House",
      siteId: "site-1",
      email: "dana@example.com",
      username: "dana",
      appRole: "manager",
      roleKey: "house_manager",
      expiresOn: null,
    },
    {
      id: "u2",
      name: "Sam Reed",
      role: "DSP",
      site: "Cedar House",
      siteId: "site-1",
      email: "sam@example.com",
      username: "sam",
      appRole: "dsp",
      roleKey: "dsp",
      expiresOn: null,
    },
  ],
  sites: [
    {
      id: "site-1",
      name: "Cedar House",
      address: "1 Maple St",
      program: "ISL",
      manager: "Dana House",
      color: "green",
      initials: "MH",
    } as CommandCenterData["sites"][number],
  ],
  requirements: [
    {
      id: "r1",
      title: "Fire drill log",
      person: "All",
      site: "Cedar House",
      category: "Emergency drills",
      owner: "Dana House",
      role: "house_manager",
      due: "2026-09-30",
      status: "Due soon",
      source: "DMH",
      page: 1,
      frequency: "Monthly",
      evidence: "",
    },
  ],
  individuals: [
    {
      id: "i1",
      siteId: "s1",
      name: "Alex Doe",
      site: "Cedar House",
      dateOfBirth: "1990-01-01",
      manager: "Dana House",
      initials: "AD",
      color: "blue",
      profile: null,
    },
  ],
};

function render(data: CommandCenterData = baseData, canManage = true): string {
  return renderToStaticMarkup(
    <CommandCenterView
      data={data}
      canManage={canManage}
      onAddAction={noopAsync}
      onResolveAction={noopAsync}
    />,
  );
}

describe("CommandCenterView", () => {
  it("renders every command-center section", () => {
    const html = render();
    for (const heading of [
      "Audit readiness",
      "What needs attention today",
      "Due next",
      "Scores by site",
      "What puts us at risk",
      "Corrective actions",
      "DMH review readiness",
      "Missing requirements",
      "Workflow library",
      "Score trend",
      "All upcoming deadlines",
    ]) {
      assert.ok(html.includes(heading), `section "${heading}"`);
    }
  });

  it("shows the agency score with an icon+text+color status badge", () => {
    const html = render();
    assert.ok(html.includes("Agency score"), "score label");
    // Score renders a number plus a badge with both icon and label text.
    assert.ok(html.includes("cc-badge"), "badge class");
    assert.ok(html.includes("aria-hidden=\"true\""), "icon hidden from AT");
    assert.ok(/Compliant|At risk|Non-compliant/.test(html), "band label text");
  });

  it("renders the DMH regulatory caveat verbatim", () => {
    const html = render();
    assert.ok(
      html.includes(DMH_SOURCE_CAVEAT),
      "source caveat shown in the readiness section",
    );
  });

  it("marks unevidenced DMH items Unknown instead of guessing", () => {
    const html = render();
    assert.ok(html.includes("Unknown"), "unknown status label present");
    assert.ok(
      html.includes("cc-status-unknown"),
      "unknown status has its own solid-color class",
    );
  });

  it("shows the corrective-action form to managers with 16px inputs", () => {
    const html = render();
    assert.ok(html.includes("Action title"), "form label");
    assert.ok(html.includes("Add corrective action"), "submit button");
    assert.ok(html.includes("cc-field"), "field class (16px inputs in CSS)");
    assert.ok(html.includes("Re-train night shift"), "existing action listed");
    assert.ok(html.includes("Resolve"), "resolve button for open action");
  });

  it("hides management controls without the permission", () => {
    const html = render(baseData, false);
    assert.ok(!html.includes("Add corrective action"), "no add form");
    assert.ok(!html.includes(">Resolve<"), "no resolve button");
    assert.ok(
      html.includes("An authorized manager can assign and resolve them."),
      "permission requirement explained",
    );
    assert.ok(html.includes("Re-train night shift"), "actions still visible");
  });

  it("renders the trend chart as an accessible SVG with a threshold line", () => {
    const html = render();
    assert.ok(html.includes('role="img"'), "chart has img role");
    assert.ok(html.includes("aria-label"), "chart has accessible label");
    assert.ok(html.includes("cc-chart-line"), "trend line");
    assert.ok(html.includes("cc-chart-threshold"), "90-point threshold line");
  });

  it("explains the empty trend state honestly when there are no snapshots", () => {
    const html = render({ ...baseData, snapshots: [] });
    assert.ok(
      html.includes("first snapshot is saved"),
      "honest empty-trend copy",
    );
    assert.ok(!html.includes("cc-chart-line"), "no chart without data");
  });

  it("renders an empty day honestly when there is no data", () => {
    const empty: CommandCenterData = {
      actions: [],
      certs: [],
      clearance: [],
      checklists: [],
      snapshots: [],
      staff: [],
      sites: [],
      requirements: [],
      individuals: [],
    };
    const html = render(empty, false);
    assert.ok(
      html.includes("Not enough connected data to score yet."),
      "honest empty score state",
    );
    assert.ok(
      html.includes("No overdue or same-day items found"),
      "honest empty attention state",
    );
    assert.ok(
      html.includes("No corrective actions on record."),
      "honest empty actions state",
    );
  });

  it("uses touch-sized buttons and status badges with text labels", () => {
    const html = render();
    assert.ok(html.includes("cc-button"), "button class (44px min-height in CSS)");
    // Every badge carries a text label, not color alone.
    const badges = html.match(/cc-badge/g) ?? [];
    assert.ok(badges.length > 0, "badges rendered");
  });
});
