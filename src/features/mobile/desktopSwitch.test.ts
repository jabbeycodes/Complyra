/**
 * desktopSwitch.test.ts — simulation batch 28: switching from phone
 * view to Desktop view must preserve the current page and house
 * scope instead of landing on whatever the desktop hash last held.
 *
 * Run: node --import tsx --test src/features/mobile/desktopSwitch.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopTargetFor } from "./desktopSwitch";

const allPages = () => true;
const noPages = () => false;

test("site-scoped screens land on the same house's Site detail", () => {
  for (const view of ["home", "mar", "people", "health", "tasks", "quicklog", "housecard", "isp", "notifications"]) {
    assert.deepEqual(
      desktopTargetFor({ view, siteId: "maple", canPage: allPages }),
      { page: "Site detail", siteId: "maple" },
      view,
    );
  }
});

test("without a scoped house, site-scoped screens land on Overview", () => {
  assert.deepEqual(
    desktopTargetFor({ view: "home", siteId: null, canPage: allPages }),
    { page: "Overview", siteId: null },
  );
});

test("screens with a desktop counterpart land on that page", () => {
  assert.deepEqual(
    desktopTargetFor({ view: "messages", siteId: "maple", canPage: allPages }),
    { page: "Messages", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "qa", siteId: "maple", canPage: allPages }),
    { page: "QA Review", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "reports", siteId: "maple", canPage: allPages }),
    { page: "Report Library", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "scheduling", siteId: "maple", canPage: allPages }),
    { page: "Scheduling", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "hub", siteId: "maple", canPage: allPages }),
    { page: "Employee Hub", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "yourshift", siteId: "maple", canPage: allPages }),
    { page: "Employee Hub", siteId: null },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "consents", siteId: "maple", canPage: allPages }),
    { page: "Consents", siteId: null },
  );
});

test("a counterpart the role cannot open falls back to the scoped house", () => {
  assert.deepEqual(
    desktopTargetFor({ view: "scheduling", siteId: "maple", canPage: noPages }),
    { page: "Site detail", siteId: "maple" },
  );
  assert.deepEqual(
    desktopTargetFor({ view: "consents", siteId: null, canPage: noPages }),
    { page: "Overview", siteId: null },
  );
});
