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
      permissions: {
        "hub.access": true,
        "individuals.view": true,
        "messages.use": true,
      },
      canPage: (page) => page === "Weekly checklist",
    }),
  );
  assert.deepEqual(tiles, [
    "medications",
    "ispData",
    "health",
    "messages",
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
  // Health is a read surface for auditors too (statuses, no log actions) —
  // the tile gate mirrors the chart's canViewHealthTrack.
  assert.ok(tiles.includes("health"));
  assert.ok(tiles.includes("appointments"));
  // No separate Med Count tile: the count lives under Medications.
  assert.ok(!tiles.includes("medCount" as never));
  assert.ok(!tiles.includes("timeClock"));
  // Messaging is staff communication, not a record surface: no tile.
  assert.ok(!tiles.includes("messages"));
});

test("the messages tile mirrors canUseMessaging, auditors excluded outright", () => {
  // Operational roles with the permission see the tile.
  assert.ok(
    ids(
      ctx({ roleKey: "dsp", permissions: { "messages.use": true } }),
    ).includes("messages"),
  );
  assert.ok(
    ids(
      ctx({ roleKey: "nurse", permissions: { "messages.use": true } }),
    ).includes("messages"),
  );
  // Without the permission there is no tile, whatever the role.
  assert.ok(!ids(ctx({ roleKey: "dsp", permissions: {} })).includes("messages"));
  // HARD RULE (PR #121): an auditor never gets the tile — even if the
  // messages.use permission was mistakenly granted to the auditor
  // template, the role half of canUseMessaging keeps messaging closed.
  assert.ok(
    !ids(
      ctx({
        roleKey: "auditor",
        permissions: { "messages.use": true, "individuals.view": true },
      }),
    ).includes("messages"),
  );
});

test("the health tile mirrors the chart's health-track view gate", () => {
  // canViewHealthTrack: individuals.view required, and HR never sees it.
  assert.ok(
    ids(ctx({ roleKey: "dsp", permissions: { "individuals.view": true } })).includes("health"),
  );
  assert.ok(
    !ids(ctx({ roleKey: "hr", permissions: { "individuals.view": true } })).includes("health"),
  );
  assert.ok(!ids(ctx({ roleKey: "dsp", permissions: {} })).includes("health"));
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
  // Messages is NOT page-gated: it follows the messages.use permission,
  // so a permissive page gate alone never surfaces it.
  assert.ok(!ids(withPages).includes("messages"));
});

test("tile order is daily-driver order, medications first", () => {
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
  assert.equal(tiles[0].id, "medications");
  assert.deepEqual(
    tiles.map((t) => t.id),
    [
      "medications",
      "ispData",
      "health",
      "messages",
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
