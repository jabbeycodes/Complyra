import { test } from "node:test";
import assert from "node:assert/strict";
import { hasHubTeamPermission, type HubTeamPermissionKey } from "./permissions";

/**
 * Wave 7S pins (batch 103): the Employee Hub team-tool gate. HR owns
 * Attendance, Timecards and Payroll by ROLE (founder decision,
 * Joshua 2026-10-31) — a stored template that still carries explicit
 * falses for those keys must not lock HR out of the desktop tabs or
 * the phone hub's doors. Every other role goes through the ordinary
 * permission check. Same helper as PR #213 item 9.
 */
const KEYS: HubTeamPermissionKey[] = [
  "hub.view_team",
  "hub.review_timecards",
  "hub.approve_payroll",
];

test("the HR role passes all three gates even when the stored template denies every key", () => {
  const hr = {
    roleKey: "hr",
    role: "hr",
    permissions: {
      "hub.access": true,
      "hub.view_team": false,
      "hub.review_timecards": false,
      "hub.approve_payroll": false,
    },
  };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(hr, key), true, key);
});

test("the HR role passes with no permissions map at all", () => {
  const hr = { roleKey: "hr", role: "hr" };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(hr, key), true, key);
});

test("a DSP gains nothing: all three gates stay shut without the permissions", () => {
  const dsp = { roleKey: "dsp", role: "dsp", permissions: { "hub.access": true } };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(dsp, key), false, key);
});

test("other roles still go through the ordinary permission check, key by key", () => {
  const hm = {
    roleKey: "house_manager",
    role: "house_manager",
    permissions: {
      "hub.view_team": true,
      "hub.review_timecards": false,
      "hub.approve_payroll": false,
    },
  };
  assert.equal(hasHubTeamPermission(hm, "hub.view_team"), true);
  assert.equal(hasHubTeamPermission(hm, "hub.review_timecards"), false);
  assert.equal(hasHubTeamPermission(hm, "hub.approve_payroll"), false);
});
