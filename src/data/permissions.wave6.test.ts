/**
 * Wave 6 permission pins:
 *  - item 9: HR owns the Employee Hub's Payroll / Timecards / Attendance
 *    by ROLE (founder decision, Joshua 2026-10-31) — a stored template
 *    that lacks or explicitly denies the keys must not lock HR out,
 *    and no other role gains anything.
 *  - item 3: Personal Spending void — closers void any entry; other
 *    recorders only their own (the shipped mobile Undo path).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLE_TEMPLATE_BY_KEY,
  canVoidPersonalSpendingEntry,
  hasHubTeamPermission,
} from "./permissions";

const KEYS = ["hub.view_team", "hub.review_timecards", "hub.approve_payroll"] as const;

test("HR satisfies the hub team gates with NO stored permissions at all", () => {
  const hr = { roleKey: "hr", role: "hr", permissions: {} };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(hr, key), true, key);
});

test("HR satisfies the hub team gates even when the stored template says false", () => {
  const hr = {
    roleKey: "hr",
    role: "hr",
    permissions: {
      "hub.view_team": false,
      "hub.review_timecards": false,
      "hub.approve_payroll": false,
    },
  };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(hr, key), true, key);
});

test("the HR canonical template carries the three keys for new agencies", () => {
  const hr = ROLE_TEMPLATE_BY_KEY["hr"];
  assert.ok(hr, "hr template exists");
  for (const key of KEYS) assert.equal(hr.permissions[key], true, key);
});

test("a DSP gains nothing from the hub team gates", () => {
  const dsp = { roleKey: "dsp", role: "dsp", permissions: { "hub.access": true } };
  for (const key of KEYS) assert.equal(hasHubTeamPermission(dsp, key), false, key);
});

test("other roles still go through their stored permissions", () => {
  const hmWith = {
    roleKey: "house_manager",
    role: "house_manager",
    permissions: { "hub.view_team": true },
  };
  assert.equal(hasHubTeamPermission(hmWith, "hub.view_team"), true);
  assert.equal(hasHubTeamPermission(hmWith, "hub.approve_payroll"), false);
  const adminDenied = {
    roleKey: "administrator",
    role: "administrator",
    permissions: { "hub.view_team": false },
  };
  assert.equal(hasHubTeamPermission(adminDenied, "hub.view_team"), false);
});

test("personal spending void: closers void any entry, recorders only their own", () => {
  const entry = { recordedBy: "user-dsp" };
  assert.equal(
    canVoidPersonalSpendingEntry({ roleKey: "house_manager", userId: "user-hm" }, entry),
    true,
    "house manager (closer) voids a DSP's entry",
  );
  assert.equal(
    canVoidPersonalSpendingEntry({ roleKey: "administrator", userId: "user-admin" }, entry),
    true,
    "administrator (closer) voids any entry",
  );
  assert.equal(
    canVoidPersonalSpendingEntry({ roleKey: "dsp", userId: "user-dsp" }, entry),
    true,
    "the recorder undoes their own entry",
  );
  assert.equal(
    canVoidPersonalSpendingEntry({ roleKey: "dsp", userId: "user-other-dsp" }, entry),
    false,
    "another DSP cannot void it",
  );
  assert.equal(
    canVoidPersonalSpendingEntry(
      { roleKey: "dsp", userId: "user-dsp" },
      { recordedBy: "user-admin" },
    ),
    false,
    "a DSP cannot void the admin's entry (simulation batch 38)",
  );
  assert.equal(
    canVoidPersonalSpendingEntry(
      { roleKey: "dsp", userId: "user-dsp" },
      { recordedBy: "user-hm" },
    ),
    false,
    "a DSP cannot void a house manager's entry (simulation batch 38)",
  );
});
