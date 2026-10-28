import { test } from "node:test";
import assert from "node:assert/strict";
import { bottomNavItems, moreSheetTiles } from "./bottomNav";
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

test("the More sheet carries the tiles the pill does not", () => {
  const tiles = mobileTiles(
    ctx({
      roleKey: "administrator",
      permissions: { "hub.access": true, "individuals.view": true },
      canPage: () => true,
    }),
  );
  assert.deepEqual(
    moreSheetTiles(tiles).map((tile) => tile.id),
    ["ispData", "timeClock", "appointments", "checklists"],
  );
});
