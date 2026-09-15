import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAV_GROUPS,
  defaultNavGroupOpen,
  emptyNavGroupOpen,
  isNavAdminSession,
  navBreadcrumbGroup,
  navGroupContainsPage,
  navGroupIdForPage,
  readNavGroupOpen,
  writeNavGroupOpen,
} from "./navGroups";

test("sidebar groups match Programs / Care / Compliance / Admin and Staff is not in Programs", () => {
  assert.deepEqual(
    NAV_GROUPS.map((group) => group.id),
    ["programs", "care", "compliance", "admin"],
  );
  assert.deepEqual(NAV_GROUPS[0]?.pages, [
    "Overview",
    "Sites & programs",
    "Individuals",
    "Intake",
    "Appointments",
  ]);
  assert.equal(navGroupContainsPage(NAV_GROUPS[0]!, "Staff"), false);
  assert.equal(navGroupContainsPage(NAV_GROUPS[3]!, "Staff"), true);
  assert.equal(navGroupContainsPage(NAV_GROUPS[3]!, "AI settings"), true);
  assert.equal(navGroupContainsPage(NAV_GROUPS[1]!, "Mileage"), true);
  assert.equal(navGroupContainsPage(NAV_GROUPS[2]!, "QA Review"), true);
});

test("page names resolve to the expected sidebar group", () => {
  assert.equal(navGroupIdForPage("Overview"), "programs");
  assert.equal(navGroupIdForPage("Mileage"), "care");
  assert.equal(navGroupIdForPage("QA Review"), "compliance");
  assert.equal(navGroupIdForPage("Staff"), "admin");
  assert.equal(navGroupIdForPage("Individual chart"), null);
});

test("breadcrumb group follows Programs / Care / Compliance / Admin, never Workspace", () => {
  assert.equal(navBreadcrumbGroup("Overview"), "Programs");
  assert.equal(navBreadcrumbGroup("Mileage"), "Care");
  assert.equal(navBreadcrumbGroup("QA Review"), "Compliance");
  assert.equal(navBreadcrumbGroup("Staff"), "Admin");
  assert.equal(navBreadcrumbGroup("Site detail"), "Programs");
  assert.equal(navBreadcrumbGroup("PCSP acknowledgments", true), "Compliance");
});

test("Admin is collapsed for non-admins and open for agency admins", () => {
  assert.equal(isNavAdminSession({ roleKey: "house_manager" }), false);
  assert.equal(isNavAdminSession({ roleKey: "dsp" }), false);
  assert.equal(isNavAdminSession({ roleKey: "administrator" }), true);
  assert.equal(isNavAdminSession({ roleKey: "compliance_admin" }), true);
  assert.equal(isNavAdminSession({ roleKey: "dsp", platformAdmin: true }), true);
  assert.equal(defaultNavGroupOpen("admin", false), false);
  assert.equal(defaultNavGroupOpen("admin", true), true);
  assert.equal(defaultNavGroupOpen("programs", false), true);
  assert.equal(emptyNavGroupOpen(false).admin, false);
  assert.equal(emptyNavGroupOpen(true).admin, true);
});

test("nav open state persists in sessionStorage", () => {
  const memory = new Map<string, string>();
  const stub = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    clear: () => memory.clear(),
    removeItem: (key: string) => {
      memory.delete(key);
    },
    key: () => null,
    length: 0,
  };
  const previous = globalThis.sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: stub,
  });
  try {
    const initial = readNavGroupOpen(false);
    assert.equal(initial.admin, false);
    assert.equal(initial.care, true);
    writeNavGroupOpen({ ...initial, care: false, admin: true });
    const next = readNavGroupOpen(false);
    assert.equal(next.care, false);
    assert.equal(next.admin, true);
  } finally {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: previous,
    });
  }
});
