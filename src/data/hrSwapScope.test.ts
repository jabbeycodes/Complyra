/**
 * hrSwapScope.test.ts — batch 47: createShiftSwap must refuse a target
 * outside the requester's staffVisibleTo scope, not merely hide them in
 * the picker. Local store (the Supabase store shares swapTargetVisible
 * and adds a memberships fallback when no scope is injected).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHrStore, type HrStore, type HrSwapScope } from "./hrStore";

const AGENCY = "agency-swap-scope";
const JUNIPER_DSP = "dsp-juniper";
const MAPLE_DSP = "dsp-maple";
const JUNIPER_HM = "hm-juniper";

const DIRECTORY = [
  { id: JUNIPER_DSP, siteId: "site-juniper" },
  { id: JUNIPER_HM, siteId: "site-juniper" },
  { id: MAPLE_DSP, siteId: "site-maple" },
];

function futureAt(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function seededStore(swapScope?: HrSwapScope): Promise<HrStore> {
  const store = createHrStore({ agencyId: AGENCY, userId: JUNIPER_DSP, swapScope });
  await store.createShift({
    siteId: "site-juniper",
    staffId: JUNIPER_DSP,
    title: "Juniper day",
    startsAt: futureAt(2, 8),
    endsAt: futureAt(2, 16),
    status: "published",
    notes: null,
  });
  await store.createShift({
    siteId: "site-juniper",
    staffId: JUNIPER_HM,
    title: "Juniper HM day",
    startsAt: futureAt(3, 8),
    endsAt: futureAt(3, 16),
    status: "published",
    notes: null,
  });
  await store.createShift({
    siteId: "site-maple",
    staffId: MAPLE_DSP,
    title: "Maple day",
    startsAt: futureAt(4, 8),
    endsAt: futureAt(4, 16),
    status: "published",
    notes: null,
  });
  return store;
}

async function shiftIdOf(store: HrStore, staffId: string): Promise<string> {
  const shifts = await store.listShifts(futureAt(1, 0), futureAt(7, 0));
  const shift = shifts.find((s) => s.staffId === staffId);
  assert.ok(shift, `shift for ${staffId}`);
  return shift.id;
}

const dspScope: HrSwapScope = {
  roleKey: "dsp",
  siteId: "site-juniper",
  staffDirectory: DIRECTORY,
};

test("createShiftSwap refuses a coworker at another home", async () => {
  const store = await seededStore(dspScope);
  const offeredShiftId = await shiftIdOf(store, JUNIPER_DSP);
  await assert.rejects(
    () => store.createShiftSwap({ offeredShiftId, targetStaffId: MAPLE_DSP }),
    /only offer a shift swap to a coworker at your own home/,
  );
  assert.equal((await store.listShiftSwaps()).length, 0);
});

test("createShiftSwap allows a coworker at the same home and an open posting", async () => {
  const store = await seededStore(dspScope);
  const offeredShiftId = await shiftIdOf(store, JUNIPER_DSP);
  const targeted = await store.createShiftSwap({ offeredShiftId, targetStaffId: JUNIPER_HM });
  assert.equal(targeted.targetStaffId, JUNIPER_HM);
  const open = await store.createShiftSwap({ offeredShiftId });
  assert.equal(open.targetStaffId, null);
});

test("an agency-wide requester may target any home", async () => {
  const store = await seededStore({ ...dspScope, roleKey: "program_manager", siteId: null });
  const offeredShiftId = await shiftIdOf(store, JUNIPER_DSP);
  const swap = await store.createShiftSwap({ offeredShiftId, targetStaffId: MAPLE_DSP });
  assert.equal(swap.targetStaffId, MAPLE_DSP);
});

test("without an injected scope the local store keeps its legacy behavior", async () => {
  const store = await seededStore(undefined);
  const offeredShiftId = await shiftIdOf(store, JUNIPER_DSP);
  const swap = await store.createShiftSwap({ offeredShiftId, targetStaffId: MAPLE_DSP });
  assert.equal(swap.targetStaffId, MAPLE_DSP);
});
