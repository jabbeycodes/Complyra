/**
 * Agency-admin slice 4 — Settings discovery links + threshold ownership.
 *
 * The discovery links must mirror each target editor's OWN gate exactly:
 * a link that promises a surface the role cannot open is a false door,
 * and a link shown more widely than the editor's gate would widen a
 * role's reach. The ownership copy must never come with a threshold
 * change — the catalog and HR defaults are pinned below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { settingsDiscoveryLinks } from "./settingsDiscovery";
import { SettingsDiscoverySection } from "./SettingsDiscovery";
import {
  PAYROLL_OVERTIME_OWNERSHIP,
  PUNCH_RULES_OWNERSHIP,
  RULES_ACCOUNTABILITY_OWNERSHIP,
  RULES_OVERTIME_OWNERSHIP,
} from "./ruleOwnership";
import { RULE_CATALOG } from "../data/rules";
import { defaultPermissions } from "../data/permissions";
import { DEFAULT_OVERTIME_RULES, DEFAULT_PUNCH_RULES } from "../data/hr";
import type { SessionUser } from "../data/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The legacy `role` a real session carries for each roleKey (PM and HM
 * both ride on "manager"; roleKey distinguishes them). */
const LEGACY_ROLE: Record<string, SessionUser["role"]> = {
  administrator: "administrator",
  program_manager: "manager",
  house_manager: "manager",
  nurse: "nurse",
  hr: "hr",
  dsp: "dsp",
  auditor: "auditor",
};

function session(partial: Partial<SessionUser>): SessionUser {
  const roleKey = partial.roleKey ?? "administrator";
  return {
    userId: "u1",
    email: "sarah@example.com",
    username: "sarah.mitchell",
    fullName: "Sarah Mitchell",
    jobTitle: "Administrator",
    agencyId: "a1",
    agencyName: "Evergreen Care",
    agencyCode: "EVERGREEN-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    platformAdmin: false,
    agencyStatus: "active",
    ...partial,
    role: partial.role ?? LEGACY_ROLE[roleKey],
    roleKey,
    // Real sessions always carry the full permissions map — both APIs
    // build it as defaultPermissions(roleKey) merged with the agency's
    // configured template — so hasPermission reads stored values, never
    // the legacy-role fallback. Model that shape here.
    permissions: { ...defaultPermissions(roleKey), ...partial.permissions },
  };
}

function ids(s: SessionUser): string[] {
  return settingsDiscoveryLinks(s).map((l) => l.id);
}

test("discovery links follow each editor's own gate, per role", () => {
  // Administrator: edits binder templates, holds the pay keys, sees the
  // delegation library. No consent-types link — that editor's gate is
  // the agency-wide program manager only (Consents.tsx).
  assert.deepEqual(ids(session({})), [
    "binder-templates",
    "pay-settings",
    "clock-settings",
    "delegation-templates",
  ]);
  // Agency-wide program manager: every link, including consent types.
  assert.deepEqual(
    ids(session({ roleKey: "program_manager" })),
    [
      "binder-templates",
      "pay-settings",
      "clock-settings",
      "consent-types",
      "delegation-templates",
    ],
  );
  // House manager and nurse reach the delegation library only.
  assert.deepEqual(
    ids(session({ roleKey: "house_manager" })),
    ["delegation-templates"],
  );
  assert.deepEqual(ids(session({ role: "nurse", roleKey: "nurse" })), [
    "delegation-templates",
  ]);
  // HR opens the Payroll tab by role and holds hub.manage_pay_settings,
  // so the two Payroll editors are honestly reachable; HR only VIEWS
  // binder templates (no editor link) and has no Delegations page.
  assert.deepEqual(ids(session({ role: "hr", roleKey: "hr" })), [
    "pay-settings",
    "clock-settings",
  ]);
  // Auditor: the Delegations read path only — no configuration editors.
  assert.deepEqual(ids(session({ role: "auditor", roleKey: "auditor" })), [
    "delegation-templates",
  ]);
  // DSP: no discovery links at all (no editors, no template library).
  assert.deepEqual(ids(session({ role: "dsp", roleKey: "dsp" })), []);
  assert.deepEqual(settingsDiscoveryLinks(null), []);
});

test("consent-types link matches the Configure consent types gate exactly", () => {
  // A program manager WITH a home site does not get the button in
  // Consents.tsx, so the link must disappear too.
  assert.equal(
    ids(
      session({
        roleKey: "program_manager",
        siteId: "site-1",
      }),
    ).includes("consent-types"),
    false,
  );
  // No other role gets it, including the administrator.
  for (const roleKey of [
    "administrator",
    "house_manager",
    "nurse",
    "hr",
    "auditor",
    "dsp",
  ]) {
    assert.equal(
      ids(session({ roleKey })).includes(
        "consent-types",
      ),
      false,
      roleKey,
    );
  }
});

test("pay links follow the stored permissions the Payroll tab checks", () => {
  // HR with hub.manage_pay_settings removed from its stored template
  // loses both Payroll links — the link follows the editor's gate, not
  // the role name.
  assert.deepEqual(
    ids(
      session({
        role: "hr",
        roleKey: "hr",
        permissions: { "hub.manage_pay_settings": false },
      }),
    ),
    [],
  );
  // A house manager explicitly granted the tab + editor keys gains the
  // links (a grant the Roles UI can already make — nothing new widens).
  assert.deepEqual(
    ids(
      session({
        roleKey: "house_manager",
        permissions: {
          "hub.access": true,
          "hub.approve_payroll": true,
          "hub.manage_pay_settings": true,
        },
      }),
    ),
    ["pay-settings", "clock-settings", "delegation-templates"],
  );
});

test("link targets are the existing surfaces, not new routes", () => {
  const hubSource = readFileSync(
    join(root, "src/features/employeeHub/EmployeeHubPage.tsx"),
    "utf8",
  );
  for (const link of settingsDiscoveryLinks(session({}))) {
    if (link.target.kind === "hub-tab") {
      assert.ok(
        hubSource.includes(`id: "${link.target.tab}"`),
        `hub tab ${link.target.tab} exists in MANAGER_TABS`,
      );
    } else {
      assert.ok(["Consents", "Delegations"].includes(link.target.page));
    }
  }
});

test("the section renders the gated links and nothing for a DSP", () => {
  const adminHtml = renderToStaticMarkup(
    <SettingsDiscoverySection session={session({})} onOpen={() => {}} />,
  );
  assert.ok(adminHtml.includes("Agency configuration"));
  for (const label of [
    "Binder templates",
    "Pay settings",
    "Punch/Clock rules",
    "Delegation templates",
  ]) {
    assert.ok(adminHtml.includes(label), label);
  }
  const dspHtml = renderToStaticMarkup(
    <SettingsDiscoverySection
      session={session({ role: "dsp", roleKey: "dsp" })}
      onOpen={() => {}}
    />,
  );
  assert.equal(dspHtml, "");
});

test("ownership copy states both systems and their independence", () => {
  // Operational overtime (agency rules) vs pay overtime (Payroll).
  assert.match(RULES_OVERTIME_OWNERSHIP, /operational/);
  assert.match(RULES_OVERTIME_OWNERSHIP, /Pay settings/);
  assert.match(RULES_OVERTIME_OWNERSHIP, /independent/);
  assert.match(PAYROLL_OVERTIME_OWNERSHIP, /decide pay/);
  assert.match(PAYROLL_OVERTIME_OWNERSHIP, /Agency rules/);
  assert.match(PAYROLL_OVERTIME_OWNERSHIP, /independent/);
  // Accountability late clock-in (agency rules) vs clock grace (punch rules).
  assert.match(RULES_ACCOUNTABILITY_OWNERSHIP, /accountability/);
  assert.match(RULES_ACCOUNTABILITY_OWNERSHIP, /Clock settings/);
  assert.match(RULES_ACCOUNTABILITY_OWNERSHIP, /independent/);
  assert.match(PUNCH_RULES_OWNERSHIP, /govern the clock itself/);
  assert.match(PUNCH_RULES_OWNERSHIP, /Accountability/);
  assert.match(PUNCH_RULES_OWNERSHIP, /independent/);
});

test("ownership copy is wired into both panels, and the stale claim is gone", () => {
  const rulesPanel = readFileSync(
    join(root, "src/features/AgencyRulesPanel.tsx"),
    "utf8",
  );
  assert.ok(rulesPanel.includes("RULES_OVERTIME_OWNERSHIP"));
  assert.ok(rulesPanel.includes("RULES_ACCOUNTABILITY_OWNERSHIP"));
  assert.ok(
    !rulesPanel.includes("read as those checks connect"),
    "the stale 'saved now' header claim is corrected",
  );
  const hub = readFileSync(
    join(root, "src/features/employeeHub/EmployeeHubPage.tsx"),
    "utf8",
  );
  assert.ok(hub.includes("PAYROLL_OVERTIME_OWNERSHIP"));
  const punch = readFileSync(
    join(root, "src/features/employeeHub/PunchRulesConfig.tsx"),
    "utf8",
  );
  assert.ok(punch.includes("PUNCH_RULES_OWNERSHIP"));
});

test("no threshold moved: catalog and HR defaults are unchanged", () => {
  const byKey = new Map(RULE_CATALOG.map((d) => [d.key, d.platformDefault]));
  // Operational overtime (agency rules catalog).
  assert.equal(byKey.get("overtime.weekly_limit_hours"), 40);
  assert.equal(byKey.get("overtime.tolerance_hours"), 1);
  assert.equal(byKey.get("overtime.approaching_hours"), 36);
  // Accountability late clock-in (agency rules catalog).
  assert.equal(byKey.get("accountability.late_clock_in_minutes"), 15);
  assert.equal(byKey.get("accountability.points_per_late_item"), 1);
  // Pay overtime (hr_overtime_rules defaults) and punch rules defaults.
  assert.equal(DEFAULT_OVERTIME_RULES.weeklyThresholdHours, 40);
  assert.equal(DEFAULT_PUNCH_RULES.graceMinutes, 5);
  assert.equal(DEFAULT_PUNCH_RULES.roundingMinutes, 0);
});
