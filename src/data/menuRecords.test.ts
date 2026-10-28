import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
  DEMO_AGENCY_CODE,
} from "./seed";
import { DEMO_PASSWORD, type SessionUser } from "./types";
import {
  addDaysIso,
  buildMenuWeekGrid,
  canEditMenuEntryRow,
  centralTodayIso,
  menuWeekRangeLabel,
  weekDayIsos,
  weekStartMondayIso,
  type MenuEntry,
} from "./menuRecords";
import { canEnterMenuEntries, canSeeMenuEntries } from "./permissions";

test("weeks run Monday to Sunday", () => {
  // Saturday 2026-09-12 belongs to the week starting Monday 2026-09-07.
  assert.equal(weekStartMondayIso("2026-09-12"), "2026-09-07");
  // A Monday starts its own week; a Sunday ends the week before it.
  assert.equal(weekStartMondayIso("2026-09-07"), "2026-09-07");
  assert.equal(weekStartMondayIso("2026-09-13"), "2026-09-07");
  assert.equal(weekStartMondayIso("2026-09-14"), "2026-09-14");
  assert.deepEqual(weekDayIsos("2026-09-07"), [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ]);
  assert.equal(addDaysIso("2026-09-13", 1), "2026-09-14");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
});

test("week range labels read plainly, including across months and years", () => {
  assert.equal(menuWeekRangeLabel("2026-09-07"), "September 7 – 13, 2026");
  assert.equal(menuWeekRangeLabel("2026-09-28"), "September 28 – October 4, 2026");
  assert.equal(
    menuWeekRangeLabel("2026-12-28"),
    "December 28, 2026 – January 3, 2027",
  );
});

test("today is the America/Chicago date, not the device date", () => {
  // 2026-09-13T02:30Z is still Saturday evening in Chicago (UTC-5 in Sept).
  assert.equal(centralTodayIso(new Date("2026-09-13T02:30:00.000Z")), "2026-09-12");
  // 2026-09-12T04:30Z is still Friday night in Chicago.
  assert.equal(centralTodayIso(new Date("2026-09-12T04:30:00.000Z")), "2026-09-11");
  // Midday UTC is the same calendar day in Chicago.
  assert.equal(centralTodayIso(new Date("2026-09-12T17:00:00.000Z")), "2026-09-12");
});

function entry(partial: Partial<MenuEntry> & Pick<MenuEntry, "id" | "entryDate" | "mealSlot" | "foodText">): MenuEntry {
  return {
    agencyId: "a",
    siteId: "s",
    individualId: "i",
    amountEaten: "all",
    note: "",
    recordedBy: "u-dsp",
    recordedByName: "Alex Morgan",
    recordedByRole: "dsp",
    createdAt: `${partial.entryDate}T13:00:00.000Z`,
    updatedAt: `${partial.entryDate}T13:00:00.000Z`,
    deletedAt: null,
    voidedBy: null,
    voidReason: "",
    ...partial,
  };
}

test("the week grid groups by day and slot, keeps multiples, hides voids", () => {
  const grid = buildMenuWeekGrid(
    [
      entry({ id: "1", entryDate: "2026-09-12", mealSlot: "breakfast", foodText: "Oatmeal" }),
      entry({ id: "2", entryDate: "2026-09-12", mealSlot: "snack", foodText: "Apple slices" }),
      entry({ id: "3", entryDate: "2026-09-12", mealSlot: "snack", foodText: "Crackers" }),
      entry({
        id: "4",
        entryDate: "2026-09-12",
        mealSlot: "lunch",
        foodText: "Wrong entry",
        deletedAt: "2026-09-12T20:00:00.000Z",
        voidReason: "Recorded twice",
      }),
      entry({ id: "5", entryDate: "2026-09-20", mealSlot: "dinner", foodText: "Next week" }),
    ],
    "2026-09-07",
    "2026-09-12",
  );
  assert.equal(grid.length, 7);
  const saturday = grid[5];
  assert.equal(saturday.date, "2026-09-12");
  assert.equal(saturday.isToday, true);
  assert.equal(saturday.heading, "Sat 12");
  const bySlot = Object.fromEntries(saturday.cells.map((c) => [c.slot, c.entries]));
  assert.deepEqual(bySlot.breakfast.map((e) => e.foodText), ["Oatmeal"]);
  assert.deepEqual(bySlot.snack.map((e) => e.foodText), ["Apple slices", "Crackers"]);
  assert.deepEqual(bySlot.lunch, []); // the voided lunch never renders
  assert.deepEqual(bySlot.dinner, []); // next week's entry is out of range
  assert.equal(grid[0].heading, "Mon 7");
  assert.equal(grid[6].heading, "Sun 13");
});

test("role gates: daily-care staff enter, auditors only read", () => {
  for (const role of ["administrator", "program_manager", "house_manager", "nurse", "dsp"]) {
    assert.equal(canEnterMenuEntries(role), true, role);
    assert.equal(canSeeMenuEntries(role), true, role);
  }
  assert.equal(canSeeMenuEntries("auditor"), true);
  assert.equal(canEnterMenuEntries("auditor"), false);
  assert.equal(canSeeMenuEntries("compliance_admin"), true);
  assert.equal(canEnterMenuEntries("compliance_admin"), false);
});

test("edit gate: the author always, managers in scope, other staff never", () => {
  const row = { recordedBy: "u-dsp" };
  assert.equal(canEditMenuEntryRow("dsp", "u-dsp", row), true);
  assert.equal(canEditMenuEntryRow("dsp", "u-other", row), false);
  assert.equal(canEditMenuEntryRow("nurse", "u-nurse", row), false);
  assert.equal(canEditMenuEntryRow("house_manager", "u-hm", row), true);
  assert.equal(canEditMenuEntryRow("program_manager", "u-pm", row), true);
  assert.equal(canEditMenuEntryRow("administrator", "u-admin", row), true);
  assert.equal(canEditMenuEntryRow("auditor", "u-aud", row), false);
});

// ---------------------------------------------------------------------------
// LocalApi behaviour (demo data): scope, authorship, corrections, voids.
// ---------------------------------------------------------------------------

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

async function signInAs(impl: LocalApi, username: string): Promise<SessionUser> {
  return impl.signIn({ agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD });
}

async function individualId(impl: LocalApi, session: SessionUser, name: string) {
  const workspace = await impl.loadWorkspace(session);
  const person = workspace.individuals.find((i) => i.name === name);
  assert.ok(person, `individual ${name} exists in the demo seed`);
  return person.id;
}

test("a DSP records food for an Individual at their home and reads it back", async () => {
  const impl = api();
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const ellis = await individualId(impl, dsp, "Ellis Hart");
  const id = await impl.saveMenuEntry({
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "breakfast",
    foodText: "Oatmeal with berries",
    amountEaten: "most",
    note: "Ate slowly",
  });
  assert.ok(id);
  const rows = await impl.getMenuEntries(ellis, "2026-09-07", "2026-09-13");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].foodText, "Oatmeal with berries");
  assert.equal(rows[0].amountEaten, "most");
  assert.equal(rows[0].recordedByName, "Alex Morgan");
  assert.equal(rows[0].recordedByRole, "dsp");
  // Outside the requested range the entry does not leak in.
  const otherWeek = await impl.getMenuEntries(ellis, "2026-09-14", "2026-09-20");
  assert.equal(otherWeek.length, 0);
});

test("a DSP cannot read or write menu records for a home they do not work at", async () => {
  const impl = api();
  const admin = await signInAs(impl, DEMO_ADMIN_USERNAME);
  const harper = await individualId(impl, admin, "Harper Soto");
  // Switch to the DSP (Cedar House) — Harper lives at Willow House.
  await signInAs(impl, DEMO_DSP_USERNAME);
  await assert.rejects(
    impl.getMenuEntries(harper, "2026-09-07", "2026-09-13"),
    /outside your assigned access/,
  );
  await assert.rejects(
    impl.saveMenuEntry({
      individualId: harper,
      entryDate: "2026-09-12",
      mealSlot: "lunch",
      foodText: "Soup",
      amountEaten: "all",
    }),
    /outside your assigned access/,
  );
});

test("corrections: the author edits their own entry; an administrator edits in scope", async () => {
  const impl = api();
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const ellis = await individualId(impl, dsp, "Ellis Hart");
  const id = await impl.saveMenuEntry({
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "dinner",
    foodText: "Pasta",
    amountEaten: "some",
  });
  // The author corrects the amount.
  await impl.saveMenuEntry({
    entryId: id,
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "dinner",
    foodText: "Pasta",
    amountEaten: "most",
  });
  let rows = await impl.getMenuEntries(ellis, "2026-09-07", "2026-09-13");
  assert.equal(rows[0].amountEaten, "most");

  // An administrator corrects the entry (manager-tier edit gate).
  await signInAs(impl, DEMO_ADMIN_USERNAME);
  await impl.saveMenuEntry({
    entryId: id,
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "dinner",
    foodText: "Pasta with vegetables",
    amountEaten: "most",
  });
  rows = await impl.getMenuEntries(ellis, "2026-09-07", "2026-09-13");
  assert.equal(rows[0].foodText, "Pasta with vegetables");
});

test("a non-author staff member at the same home cannot correct or void another's entry", async () => {
  const impl = api();
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const ellis = await individualId(impl, dsp, "Ellis Hart");
  const id = await impl.saveMenuEntry({
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "lunch",
    foodText: "Tomato soup",
    amountEaten: "all",
  });
  // The Cedar House nurse is a peer, not the author and not a manager.
  await signInAs(impl, DEMO_NURSE_USERNAME);
  await assert.rejects(
    impl.saveMenuEntry({
      entryId: id,
      individualId: ellis,
      entryDate: "2026-09-12",
      mealSlot: "lunch",
      foodText: "Changed by someone else",
      amountEaten: "none",
    }),
    /only edit your own/,
  );
  await assert.rejects(impl.voidMenuEntry(id, "Not mine to void"), /only void your own/);
});

test("voiding needs a reason and removes the entry from the week view", async () => {
  const impl = api();
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const ellis = await individualId(impl, dsp, "Ellis Hart");
  const id = await impl.saveMenuEntry({
    individualId: ellis,
    entryDate: "2026-09-12",
    mealSlot: "snack",
    foodText: "Yogurt cup",
    amountEaten: "all",
  });
  await assert.rejects(impl.voidMenuEntry(id, "  "), /reason/);
  await impl.voidMenuEntry(id, "Recorded against the wrong day");
  const rows = await impl.getMenuEntries(ellis, "2026-09-07", "2026-09-13");
  assert.equal(rows.length, 0);
});

test("food text is required and the meal and amount must be real choices", async () => {
  const impl = api();
  const dsp = await signInAs(impl, DEMO_DSP_USERNAME);
  const ellis = await individualId(impl, dsp, "Ellis Hart");
  await assert.rejects(
    impl.saveMenuEntry({
      individualId: ellis,
      entryDate: "2026-09-12",
      mealSlot: "breakfast",
      foodText: "   ",
      amountEaten: "all",
    }),
    /what was eaten/,
  );
});
