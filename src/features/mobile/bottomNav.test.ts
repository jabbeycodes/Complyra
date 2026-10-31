import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeBottomNavFor,
  bottomNavItems,
  moreSheetTiles,
  shellBottomNavVisible,
} from "./bottomNav";
import { mobileTiles, type MobileTileContext } from "./tiles";

function ctx(partial: Partial<MobileTileContext>): MobileTileContext {
  return {
    roleKey: "dsp",
    permissions: {},
    canPage: () => false,
    ...partial,
  };
}

const navIds = (context: MobileTileContext) =>
  bottomNavItems(mobileTiles(context)).map((item) => item.id);

test("a DSP gets the full pill: Home, Tasks, Meds, People, More", () => {
  const ids = navIds(
    ctx({
      roleKey: "dsp",
      permissions: { "hub.access": true, "individuals.view": true },
      canPage: (page) => page === "Weekly checklist",
    }),
  );
  assert.deepEqual(ids, ["home", "tasks", "meds", "people", "more"]);
});

test("a role without a surface loses that pill destination", () => {
  // HR: only the My Tasks tile exists, so no Meds and no People.
  const ids = navIds(ctx({ roleKey: "hr_admin", permissions: {} }));
  assert.deepEqual(ids, ["home", "tasks", "more"]);
});

test("a role without individuals.view loses People but keeps Meds", () => {
  const ids = navIds(
    ctx({ roleKey: "nurse", permissions: { "hub.access": true } }),
  );
  assert.deepEqual(ids, ["home", "tasks", "meds", "more"]);
});

test("the pill is present on EVERY shell screen (batches 28-30)", () => {
  // The screens that used to drop it: mar (Meds picker), housecard,
  // sites (Select your home), notifications, the per-person sections,
  // yourshift — plus the ISP form and an open message thread.
  const views = [
    "home",
    "tasks",
    "people",
    "health",
    "mar",
    "isp",
    "quicklog",
    "housecard",
    "spending",
    "careplans",
    "consents",
    "lifeevents",
    "scheduling",
    "hub",
    "reports",
    "qa",
    "messages",
    "sites",
    "notifications",
    "yourshift",
  ];
  for (const view of views) {
    assert.equal(shellBottomNavVisible({ view }), true, view);
  }
  assert.equal(
    shellBottomNavVisible({ view: "isp", ispFormActive: true }),
    true,
    "ISP entry form open",
  );
  assert.equal(
    shellBottomNavVisible({ view: "messages", messagesInThread: true }),
    true,
    "message thread open",
  );
  assert.equal(
    shellBottomNavVisible({ view: "mar" }),
    true,
    "Meds picker open (batch 28)",
  );
});

test("each shell screen highlights its pill destination", () => {
  assert.equal(activeBottomNavFor("home"), "home");
  assert.equal(activeBottomNavFor("tasks"), "tasks");
  assert.equal(activeBottomNavFor("people"), "people");
  assert.equal(activeBottomNavFor("health"), "people");
  assert.equal(activeBottomNavFor("spending"), "people");
  assert.equal(activeBottomNavFor("mar"), "meds");
  assert.equal(activeBottomNavFor("quicklog"), "meds");
  assert.equal(activeBottomNavFor("housecard"), "meds");
  assert.equal(activeBottomNavFor("scheduling"), "more");
  assert.equal(activeBottomNavFor("sites"), "more");
  assert.equal(activeBottomNavFor("notifications"), "more");
});

test("the More sheet carries the tiles the pill does not", () => {
  const tiles = mobileTiles(
    ctx({
      roleKey: "administrator",
      permissions: {
        "hub.access": true,
        "individuals.view": true,
        "messages.use": true,
      },
      canPage: () => true,
    }),
  );
  assert.deepEqual(
    moreSheetTiles(tiles).map((tile) => tile.id),
    ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "appointments", "checklists", "houseCard", "reports", "qaReview"],
  );
});
