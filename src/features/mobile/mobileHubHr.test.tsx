import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MobileHub from "./MobileHub";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";

/**
 * Wave 7S pins (simulation batch 103): on the phone, HR's Employee Hub
 * had no Attendance or Payroll doors at all — the hub home listed only
 * self-service sections. The three team tools HR owns (Attendance,
 * Timecards, Payroll — HR hub rule, Joshua 2026-10-31) now render as
 * doors gated by hasHubTeamPermission, the desktop hub's own rule:
 * the HR role sees them even when the stored template denies the
 * keys; a DSP sees none of them.
 */
function session(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: "user-1",
    email: "user@example.invalid",
    username: "user",
    fullName: "Test User",
    jobTitle: "Staff",
    role: "dsp",
    roleKey: "dsp",
    agencyId: "agency-1",
    agencyName: "Evergreen Care",
    agencyCode: "EVERGREEN-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: { "hub.access": true },
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  } as unknown as SessionUser;
}

function renderHub(sessionUser: SessionUser): string {
  return renderToStaticMarkup(
    React.createElement(MobileHub, {
      api: {} as ComplyraApi,
      session: sessionUser,
      onOpenFullHub: () => {},
    }),
  );
}

test("HR sees Attendance, Timecards and Payroll doors even when the stored template denies the keys", () => {
  const html = renderHub(
    session({
      userId: "user-riley",
      fullName: "Riley Hart",
      role: "hr",
      roleKey: "hr",
      permissions: {
        "hub.access": true,
        "hub.view_team": false,
        "hub.review_timecards": false,
        "hub.approve_payroll": false,
      },
    }),
  );
  assert.ok(html.includes("<strong>Attendance</strong>"), "Attendance door");
  assert.ok(html.includes("<strong>Timecards</strong>"), "Timecards door");
  assert.ok(html.includes("<strong>Payroll</strong>"), "Payroll door");
});

test("a DSP sees none of the team-tool doors", () => {
  const html = renderHub(session({}));
  assert.ok(!html.includes("<strong>Attendance</strong>"), "no Attendance door");
  assert.ok(!html.includes("<strong>Timecards</strong>"), "no Timecards door");
  assert.ok(!html.includes("<strong>Payroll</strong>"), "no Payroll door");
  // …while the self-service hub still renders.
  assert.ok(html.includes("<strong>My compliance</strong>"), "self-service hub intact");
});

test("a non-HR role holding a hub team permission sees just that door", () => {
  const html = renderHub(
    session({
      role: "manager",
      roleKey: "house_manager",
      permissions: {
        "hub.access": true,
        "hub.view_team": true,
        "hub.review_timecards": false,
        "hub.approve_payroll": false,
      },
    }),
  );
  assert.ok(html.includes("<strong>Attendance</strong>"), "Attendance door via hub.view_team");
  assert.ok(!html.includes("<strong>Timecards</strong>"), "no Timecards door");
  assert.ok(!html.includes("<strong>Payroll</strong>"), "no Payroll door");
});
