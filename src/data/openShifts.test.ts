import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeDays,
  evaluatePickup,
  permanentWeeklyHours,
  validateOpenShiftInput,
  type HrOpenShift,
} from "./openShifts";
import { LocalOpenShiftStore } from "./openShiftStore";
import { rankBids, temporaryWindow } from "../features/employeeHub/OpenShiftsTab";

const NOW = new Date("2026-09-25T12:00:00");

function temp(overrides: Partial<HrOpenShift> = {}): HrOpenShift {
  return {
    id: "os-1",
    agencyId: "agency",
    siteId: "lawton",
    kind: "temporary",
    audience: "site",
    title: "Evening",
    startsAt: new Date("2026-10-02T14:30:00").toISOString(),
    endsAt: new Date("2026-10-02T22:30:00").toISOString(),
    days: [],
    windowStart: null,
    windowEnd: null,
    effectiveFrom: null,
    weeklyHours: 0,
    notes: "",
    slots: 1,
    filledCount: 0,
    pickupMode: "first_come",
    status: "open",
    postedBy: "hm",
    postedByName: "Dana HM",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

test("validation explains what's missing in plain words", () => {
  const problems = validateOpenShiftInput(
    { siteId: "", kind: "permanent", audience: "site", title: " ", days: [], windowStart: "", windowEnd: "", effectiveFrom: "" },
    NOW,
  );
  assert.ok(problems.includes("Choose a program site."));
  assert.ok(problems.includes("Choose at least one day of the week."));
  assert.ok(problems.includes("Choose the date the permanent shift starts."));
});

test("temporary shifts must be in the future; agency-wide postings must be permanent", () => {
  const past = validateOpenShiftInput(
    { siteId: "s", kind: "temporary", audience: "agency", title: "x", startsAt: "2026-09-24T14:30:00Z", endsAt: "2026-09-24T22:30:00Z" },
    NOW,
  );
  assert.ok(past.includes("Temporary shifts must start in the future."));
  assert.ok(past.includes("Agency-wide postings are for permanent shifts."));
});

test("permanent weekly hours count overnight windows fully", () => {
  assert.equal(permanentWeeklyHours([1, 2, 3, 4, 5], "14:30", "22:30"), 40);
  assert.equal(permanentWeeklyHours([0, 6], "22:30", "06:30"), 16);
  assert.equal(describeDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(describeDays([6, 0]), "Sat, Sun");
});

test("first come is immediate within 40 hours", () => {
  const r = evaluatePickup({ shift: temp(), trainedAtSite: true, existingShifts: [] });
  assert.deepEqual([r.blocker, r.direct, r.wouldBeOvertime], [null, true, false]);
});

test("a pickup that would pass 40 hours becomes a bid, never automatic", () => {
  const existing = [0, 1, 2, 3].map((d) => ({
    startsAt: new Date(`2026-09-${28 + d}T06:00:00`).toISOString(),
    endsAt: new Date(`2026-09-${28 + d}T15:00:00`).toISOString(),
    status: "published" as const,
  }));
  const r = evaluatePickup({ shift: temp(), trainedAtSite: true, existingShifts: existing });
  assert.equal(r.weekHours, 36);
  assert.equal(r.wouldBeOvertime, true);
  assert.equal(r.direct, false);
});

test("untrained staff and overlapping shifts are blocked", () => {
  assert.equal(
    evaluatePickup({ shift: temp(), trainedAtSite: false, existingShifts: [] }).blocker,
    "Not trained at this program site yet.",
  );
  const overlap = [{ startsAt: temp().startsAt!, endsAt: temp().endsAt!, status: "published" as const }];
  assert.equal(
    evaluatePickup({ shift: temp(), trainedAtSite: true, existingShifts: overlap }).blocker,
    "Already scheduled during this time.",
  );
});

test("agency-wide permanent openings accept staff not yet trained at the site", () => {
  const shift = temp({ kind: "permanent", audience: "agency", pickupMode: "approval", weeklyHours: 16, startsAt: null, endsAt: null });
  const r = evaluatePickup({ shift, trainedAtSite: false, existingShifts: [], recurringHours: 32 });
  assert.equal(r.blocker, null);
  assert.equal(r.wouldBeOvertime, true);
  assert.equal(r.direct, false);
});

test("overnight temporary windows end the next day", () => {
  const w = temporaryWindow("2026-10-02", "22:30", "06:30")!;
  assert.equal(new Date(w.endsAt).getTime() - new Date(w.startsAt).getTime(), 8 * 3_600_000);
});

test("bids rank within-40-hours, trained, fewest hours, then earliest", () => {
  const base = { openShiftId: "os", response: "requested" as const, decision: null, respondedAt: "2026-09-25T10:00:00Z" };
  const ranked = rankBids([
    { ...base, id: "a", staffId: "a", staffName: "Over", trainedAtSite: true, wouldBeOvertime: true, weekHoursBefore: 10 },
    { ...base, id: "b", staffId: "b", staffName: "Busy", trainedAtSite: true, wouldBeOvertime: false, weekHoursBefore: 30 },
    { ...base, id: "c", staffId: "c", staffName: "Light", trainedAtSite: true, wouldBeOvertime: false, weekHoursBefore: 8 },
    { ...base, id: "d", staffId: "d", staffName: "New", trainedAtSite: false, wouldBeOvertime: false, weekHoursBefore: 0 },
  ]);
  assert.deepEqual(ranked.map((r) => r.staffName), ["Light", "Busy", "New", "Over"]);
});

test("local store: post, pick up, the slot fills, and a second pickup is refused", async () => {
  const clock = () => NOW;
  const hm = new LocalOpenShiftStore({ agencyId: "demo-a", userId: "hm", fullName: "Dana HM", canManageSchedule: true, canPostAgencyWide: false }, clock);
  const id = await hm.postOpenShift({
    siteId: "lawton", kind: "temporary", audience: "site", title: "Evening",
    startsAt: temp().startsAt, endsAt: temp().endsAt, pickupMode: "first_come", slots: 1,
  });
  const dsp = new LocalOpenShiftStore({ agencyId: "demo-a", userId: "dsp1", fullName: "Alex DSP", canManageSchedule: false, canPostAgencyWide: false }, clock);
  assert.equal(await dsp.respond(id, "pick_up"), "picked_up");
  const second = new LocalOpenShiftStore({ agencyId: "demo-a", userId: "dsp2", fullName: "Sam DSP", canManageSchedule: false, canPostAgencyWide: false }, clock);
  await assert.rejects(second.respond(id, "pick_up"), /no longer open/);
});

test("local store: permanent postings are bids the manager approves", async () => {
  const clock = () => NOW;
  const hm = new LocalOpenShiftStore({ agencyId: "demo-b", userId: "hm", fullName: "Dana HM", canManageSchedule: true, canPostAgencyWide: false }, clock);
  const id = await hm.postOpenShift({
    siteId: "lawton", kind: "permanent", audience: "site", title: "Weekday evenings",
    days: [1, 2, 3, 4, 5], windowStart: "14:30", windowEnd: "22:30", effectiveFrom: "2026-10-05", pickupMode: "first_come",
  });
  const dsp = new LocalOpenShiftStore({ agencyId: "demo-b", userId: "dsp1", fullName: "Alex DSP", canManageSchedule: false, canPostAgencyWide: false }, clock);
  assert.equal(await dsp.respond(id, "pick_up"), "requested");
  const bid = (await hm.listResponses()).find((r) => r.staffId === "dsp1")!;
  assert.equal(await hm.decideBid(bid.id, true), "approved");
  assert.equal((await hm.listOpenShifts())[0].status, "filled");
});

test("local store: only HR/administrators post agency-wide", async () => {
  const hm = new LocalOpenShiftStore({ agencyId: "demo-c", userId: "hm", fullName: "Dana HM", canManageSchedule: true, canPostAgencyWide: false }, () => NOW);
  await assert.rejects(
    hm.postOpenShift({ siteId: "lawton", kind: "permanent", audience: "agency", title: "Weekends", days: [0, 6], windowStart: "06:30", windowEnd: "14:30", effectiveFrom: "2026-10-05" }),
    /Only HR/,
  );
});
