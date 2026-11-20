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
import {
  defaultBinderTemplateLibrary,
  type StaffBinder,
} from "../data/newHireBinder";
import type { HrStore } from "../data/hrStore";
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

test("binder-templates link carries the templates subview; no other link does", () => {
  // Reviewer HOLD on PR #278: the Binder Board tab opens on its board
  // view, so a tab-only target made "Binder templates" a false
  // destination. The link now names the Templates subview explicitly —
  // the editor's own view — while every other hub-tab link stays a
  // plain tab target (their editors render inside the tab itself).
  const links = settingsDiscoveryLinks(session({}));
  const binder = links.find((l) => l.id === "binder-templates");
  assert.deepEqual(binder?.target, {
    kind: "hub-tab",
    tab: "binder-board",
    subview: "templates",
  });
  for (const id of ["pay-settings", "clock-settings"] as const) {
    const link = links.find((l) => l.id === id);
    assert.ok(link?.target.kind === "hub-tab", id);
    assert.equal(link.target.subview, undefined, id);
  }
  // The subview never outruns the gate: a session that cannot edit
  // binder templates (HR views them read-only from the board itself)
  // receives no binder-templates link at all, so it can never be
  // deep-linked into the editor.
  assert.equal(
    settingsDiscoveryLinks(session({ role: "hr", roleKey: "hr" })).some(
      (l) => l.id === "binder-templates",
    ),
    false,
  );
});

test("the subview is wired from the link through the hub to the board", () => {
  // Source wiring, in the same style as the ownership checks above:
  // App carries the subview beside the focus tab and hands both to the
  // hub page; the hub forwards it to the Binder Board; the board takes
  // it as its initial view and still defaults to "board" without it.
  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  assert.ok(app.includes("setHubFocusSubview(target.subview ?? null)"));
  assert.ok(app.includes("focusSubview={hubFocusSubview}"));
  const hub = readFileSync(
    join(root, "src/features/employeeHub/EmployeeHubPage.tsx"),
    "utf8",
  );
  assert.ok(hub.includes("focusSubview={focusSubview ?? undefined}"));
  assert.ok(
    hub.includes(
      'initialView={focusSubview === "templates" ? "templates" : undefined}',
    ),
  );
  const board = readFileSync(
    join(root, "src/features/newHireBinder/BinderBoardPanel.tsx"),
    "utf8",
  );
  assert.ok(board.includes('initialView ?? "board"'));
});

test("BinderBoardTab honors the templates initial view and defaults to the board", async () => {
  // jsdom render, mirroring BinderBoardPanel.test.tsx's setup. The
  // decisive in-browser proof is the Playwright spec; this pins the
  // component contract the deep link relies on.
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  const setGlobal = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  };
  setGlobal("window", dom.window);
  setGlobal("document", dom.window.document);
  setGlobal("navigator", dom.window.navigator);
  setGlobal("HTMLElement", dom.window.HTMLElement);
  setGlobal("HTMLCanvasElement", dom.window.HTMLCanvasElement);
  setGlobal("Element", dom.window.Element);
  setGlobal("Node", dom.window.Node);
  setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { BinderBoardTab } = await import(
      "./newHireBinder/BinderBoardPanel"
    );
    const { DataContext } = await import("../data/DataProvider");
    const act = React.act;

    const binder: StaffBinder = {
      id: "binder-u1",
      agencyId: "a1",
      staffId: "u1",
      sections: [
        {
          key: "docs",
          title: "Documents",
          items: [
            { key: "id-copy", label: "ID copy", kind: "document", matchKeys: ["id"] },
          ],
        },
      ],
      createdAt: "2026-10-31T00:00:00.000Z",
      updatedAt: "2026-10-31T00:00:00.000Z",
    };
    const store = {
      listDocuments: async () => [],
      listDocumentAcks: async () => [],
      getBinder: async () => binder,
      listBinders: async () => [binder],
      listBinderDocuments: async () => [],
      getEmergencyContact: async () => null,
      getComplianceEvidence: async () => ({
        certs: [],
        trainings: [],
        delegations: [],
        docAcks: [],
      }),
      listBinderTemplates: async () => defaultBinderTemplateLibrary(),
    } as unknown as HrStore;
    const staffList = [
      {
        userId: "u1",
        fullName: "Sarah Mitchell",
        email: "",
        roleKey: "administrator",
        siteId: null,
        siteName: null,
      },
    ];

    async function renderBoard(
      sess: SessionUser,
      initialView?: "board" | "templates",
    ): Promise<{
      text: string;
      html: string;
      templatesBtnClass: string;
      boardBtnClass: string;
    }> {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const value = {
        api: {
          getStaffTrainingProfile: async () => null,
        } as unknown as import("../data/localApi").ComplyraApi,
        session: sess,
        workspace: null as import("../data/localApi").WorkspaceView | null,
        loading: false,
        error: "",
        usingHostedBackend: true,
        loadStalled: false,
        signIn: async () => {},
        changePassword: async () => {},
        signOut: async () => {},
        refresh: async () => {},
      };
      await act(async () => {
        root.render(
          React.createElement(
            DataContext.Provider,
            { value },
            React.createElement(BinderBoardTab, {
              session: sess,
              store,
              staffList,
              sites: [],
              initialView,
              onOpenBinder: () => {},
            }),
          ),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      const viewButtons = Array.from(
        container.querySelectorAll(".binder-board-views button"),
      );
      const btnClass = (label: string) =>
        viewButtons.find((b) => b.textContent?.includes(label))?.className ??
        "";
      const out = {
        text: container.textContent ?? "",
        html: container.innerHTML,
        templatesBtnClass: btnClass("Templates"),
        boardBtnClass: btnClass("Board"),
      };
      await act(async () => root.unmount());
      container.remove();
      return out;
    }

    // Deep-linked (administrator, a template editor): the template
    // EDITOR renders — its snapshot-rule note and Reset to starter
    // control exist only in the editor — the Templates toggle is the
    // active view, and the board itself is not shown.
    const deepLinked = await renderBoard(session({}), "templates");
    assert.match(deepLinked.text, /Snapshot rule/);
    assert.match(deepLinked.text, /Reset to starter/);
    assert.ok(!deepLinked.html.includes("binder-board-summary"));
    assert.ok(deepLinked.templatesBtnClass.includes("primary"));
    assert.ok(!deepLinked.boardBtnClass.includes("primary"));

    // Ordinary arrival (no initial view): the board renders exactly as
    // before and the editor does not.
    const ordinary = await renderBoard(session({}));
    assert.ok(ordinary.html.includes("binder-board-summary"));
    assert.ok(!ordinary.text.includes("Snapshot rule"));
    assert.ok(ordinary.boardBtnClass.includes("primary"));

    // A house manager handed the subview anyway (no template access at
    // all): the board renders and no editor — the initial view never
    // widens the templates gate.
    const hm = await renderBoard(
      session({ roleKey: "house_manager" }),
      "templates",
    );
    assert.ok(hm.html.includes("binder-board-summary"));
    assert.ok(!hm.text.includes("Snapshot rule"));
    assert.ok(!hm.text.includes("Reset to starter"));
  } finally {
    dom.window.close();
  }
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
