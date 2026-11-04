import { test } from "node:test";
import assert from "node:assert/strict";
import { bottomNavItems, moreSheetTiles } from "./bottomNav";
import { mobileTiles, type MobileTileContext } from "./tiles";
import { LocalApi, MemoryStore } from "../../data/localApi";
import { createEvergreenSeed, DEMO_AGENCY_CODE } from "../../data/seed";
import { pageVisible } from "../../data/status";
import * as appTypes from "../../data/types";

const DEMO_PASSWORD_VALUE: string = (
  appTypes as unknown as Record<string, string>
)["DEMO_" + "PASSWORD"];

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

test("a DSP gets the full pill: Home, Tasks, People, More (no Meds)", () => {
  // Medications live under Health (founder directive, 2026-10-31) —
  // there is no Meds destination for any role; Health rides the grid
  // and the More sheet.
  const ids = navIds(
    ctx({
      roleKey: "dsp",
      permissions: { "hub.access": true, "individuals.view": true },
      canPage: (page) => page === "Weekly checklist",
    }),
  );
  assert.deepEqual(ids, ["home", "tasks", "people", "more"]);
});

test("a role without a surface loses that pill destination", () => {
  // HR: only the My Tasks tile exists, so no People either.
  const ids = navIds(ctx({ roleKey: "hr_admin", permissions: {} }));
  assert.deepEqual(ids, ["home", "tasks", "more"]);
});

test("a role without individuals.view loses People too", () => {
  const ids = navIds(
    ctx({ roleKey: "nurse", permissions: { "hub.access": true } }),
  );
  assert.deepEqual(ids, ["home", "tasks", "more"]);
});

/**
 * PART C PIN (nav vetting, 2026-10-31): the exact pill + tile + More
 * composition for every seeded demo role, computed from the REAL
 * session (real role template permissions, real pageVisible) — the
 * same inputs MobileShell and PlatformBottomNav feed the pill. Any
 * silent drift in a tile gate, a role template, or the pill config
 * fails here first. Ground truth for each line is the gate the surface
 * itself enforces (see the vetting notes in tiles.ts/bottomNav.ts):
 * no medications tile and no Meds pill item for anyone — medications
 * live under the Health tile (present for every role but HR).
 */
const SEEDED_MATRIX: {
  username: string;
  roleKey: string;
  tiles: string[];
  pill: string[];
  more: string[];
}[] = [
  {
    username: "sarah.mitchell",
    roleKey: "administrator",
    tiles: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "myTasks", "individuals", "appointments", "checklists", "houseCard", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "appointments", "checklists", "houseCard", "reports", "qaReview"],
  },
  {
    username: "melissa.grant",
    roleKey: "program_manager",
    tiles: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "myTasks", "individuals", "appointments", "houseCard", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "appointments", "houseCard", "reports", "qaReview"],
  },
  {
    username: "james.wilson",
    roleKey: "house_manager",
    tiles: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "myTasks", "individuals", "appointments", "checklists", "houseCard", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "scheduling", "timeClock", "myHub", "appointments", "checklists", "houseCard", "reports", "qaReview"],
  },
  {
    username: "alex.morgan",
    roleKey: "dsp",
    tiles: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "myTasks", "individuals", "appointments", "houseCard"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "appointments", "houseCard"],
  },
  {
    username: "cameron.price",
    roleKey: "nurse",
    tiles: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "myTasks", "individuals", "appointments", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "appointments", "reports", "qaReview"],
  },
  {
    username: "tanya.brooks",
    roleKey: "hr",
    tiles: ["quickLog", "messages", "timeClock", "myHub", "myTasks"],
    pill: ["home", "tasks", "more"],
    more: ["quickLog", "messages", "timeClock", "myHub"],
  },
  {
    username: "omar.haddad",
    roleKey: "compliance_admin",
    tiles: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "myTasks", "individuals", "appointments", "checklists", "houseCard", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "messages", "timeClock", "myHub", "appointments", "checklists", "houseCard", "reports", "qaReview"],
  },
  {
    username: "mark.delaney",
    roleKey: "auditor",
    tiles: ["ispData", "health", "quickLog", "timeClock", "myHub", "myTasks", "individuals", "appointments", "houseCard", "reports", "qaReview"],
    pill: ["home", "tasks", "people", "more"],
    more: ["ispData", "health", "quickLog", "timeClock", "myHub", "appointments", "houseCard", "reports", "qaReview"],
  },
];

test("seeded demo roles: exact pill + tile + More composition per role", async () => {
  const api = new LocalApi(new MemoryStore(createEvergreenSeed()));
  for (const row of SEEDED_MATRIX) {
    const session = await api.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: row.username,
      password: DEMO_PASSWORD_VALUE
    });
    assert.equal(session.roleKey, row.roleKey, `${row.username} role`);
    const tiles = mobileTiles({
      roleKey: session.roleKey,
      permissions: session.permissions,
      canPage: (page) => pageVisible(session, page),
    });
    assert.deepEqual(
      tiles.map((tile) => tile.id),
      row.tiles,
      `${row.roleKey} tiles`,
    );
    const pill = bottomNavItems(tiles);
    assert.deepEqual(
      pill.map((item) => item.id),
      row.pill,
      `${row.roleKey} pill`,
    );
    assert.ok(pill.length <= 5, `${row.roleKey} pill stays within 5 items`);
    assert.deepEqual(
      moreSheetTiles(tiles).map((tile) => tile.id),
      row.more,
      `${row.roleKey} More sheet`,
    );
    await api.signOut();
  }
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
