import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileTiles, type MobileTileContext } from "./tiles";

function ctx(partial: Partial<MobileTileContext>): MobileTileContext {
  return {
    roleKey: "dsp",
    permissions: {},
    canPage: () => false,
    ...partial,
  };
}

const ids = (context: MobileTileContext) => mobileTiles(context).map((t) => t.id);

test("a DSP sees the daily-driver tiles and nothing they cannot use", () => {
  const tiles = ids(
    ctx({
      roleKey: "dsp",
      permissions: { "hub.access": true, "individuals.view": true },
      canPage: (page) => page === "Weekly checklist",
    }),
  );
  assert.deepEqual(tiles, [
    "medications",
    "ispData",
    "timeClock",
    "myTasks",
    "individuals",
    "checklists",
  ]);
  // No separate Shift Notes tile: a shift note is an ISP data entry, so
  // ISP Data is the one door for the home's notes.
  assert.ok(!(tiles as string[]).includes("shiftNotes"));
});

test("tiles a role cannot use do not render at all", () => {
  // HR has no chart, shift-note or hub-independent clinical surface here.
  const tiles = ids(ctx({ roleKey: "hr_admin", permissions: {} }));
  assert.deepEqual(tiles, ["myTasks"]);
});

test("an auditor gets read surfaces but no time clock without hub access", () => {
  const tiles = ids(
    ctx({
      roleKey: "auditor",
      permissions: { "individuals.view": true },
      canPage: (page) => page === "Appointments" || page === "Supply forecast",
    }),
  );
  assert.ok(tiles.includes("medications"));
  assert.ok(!(tiles as string[]).includes("shiftNotes"));
  assert.ok(tiles.includes("ispData"));
  assert.ok(tiles.includes("appointments"));
  // No separate Med Count tile: the count lives under Medications.
  assert.ok(!tiles.includes("medCount" as never));
  assert.ok(!tiles.includes("timeClock"));
});

test("page-gated tiles follow the desktop page gate exactly", () => {
  const base = ctx({ roleKey: "house_manager", permissions: { "hub.access": true } });
  assert.ok(!ids(base).includes("appointments"));
  const withPages = ctx({
    roleKey: "house_manager",
    permissions: { "hub.access": true },
    canPage: () => true,
  });
  assert.ok(ids(withPages).includes("appointments"));
  assert.ok(ids(withPages).includes("checklists"));
  assert.ok(ids(withPages).includes("houseCard"));
  assert.ok(!ids(withPages).includes("medCount" as never));
});

test("tile order is daily-driver order, medications first", () => {
  const tiles = mobileTiles(
    ctx({
      roleKey: "administrator",
      permissions: { "hub.access": true, "individuals.view": true },
      canPage: () => true,
    }),
  );
  assert.equal(tiles[0].id, "medications");
  assert.deepEqual(
    tiles.map((t) => t.id),
    [
      "medications",
      "ispData",
      "timeClock",
      "myTasks",
      "individuals",
      "appointments",
      "checklists",
      "houseCard",
    ],
  );
  for (const tile of tiles) {
    assert.ok(tile.label.length > 0);
    assert.ok(tile.hint.length > 0);
  }
});
