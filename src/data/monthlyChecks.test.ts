import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";
import {
  DRILLS_BY_MONTH,
  clampDueDay,
  drillsForMonth,
  equipmentFromInventoryDetail,
  monthDueOn,
  monthKeyFrom,
  monthlyTone,
  normalizeMonthlyDue,
} from "./monthlyChecks";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

test("equipment names split out of a PCSP inventory line", () => {
  assert.deepEqual(
    equipmentFromInventoryDetail(
      "Wheelchair, shower chair, lift, and other listed equipment.",
    ),
    ["Wheelchair", "shower chair", "lift"],
  );
});

test("monthly tone is due soon through the configured day and overdue after", () => {
  assert.equal(monthKeyFrom("2026-09-11"), "2026-09");
  assert.equal(monthDueOn("2026-09"), "2026-09-07");
  assert.equal(monthDueOn("2026-09", 15), "2026-09-15");
  assert.equal(monthlyTone(true, "2026-09-11", "2026-09"), "current");
  assert.equal(monthlyTone(false, "2026-09-07", "2026-09"), "due_soon");
  assert.equal(monthlyTone(false, "2026-09-11", "2026-09"), "overdue");
  assert.equal(monthlyTone(false, "2026-09-11", "2026-09", 15), "due_soon");
  assert.equal(clampDueDay(40), 28);
  assert.deepEqual(normalizeMonthlyDue({ equipmentDay: 12 }), {
    equipmentDay: 12,
    drillDay: 7,
    safetyDay: 7,
  });
});

test("September requires fire, tornado, and severe weather", () => {
  assert.deepEqual(drillsForMonth("2026-09"), [
    "fire",
    "tornado",
    "severe_weather",
  ]);
  assert.ok(DRILLS_BY_MONTH[4].includes("medical_emergency"));
});

test("people with equipment get a current-month log; a new month starts blank", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const ellis = workspace.individuals.find((row) => row.name === "Ellis Hart");
  assert.ok(ellis);
  const current = workspace.monthly.equipment.filter(
    (row) => row.individualId === ellis.id && row.active,
  );
  assert.ok(current.length >= 2);
  const thisMonth = monthKeyFrom(todayIso());
  const logs = workspace.monthly.equipmentLogs.filter((log) =>
    current.some((item) => item.id === log.equipmentId && log.monthKey === thisMonth),
  );
  assert.equal(logs.length, current.length);
  assert.equal(
    logs.every((log) => !log.checkedOn),
    true,
  );

  const sylvester = workspace.individuals.find((row) => row.name === "Reese Lang");
  assert.ok(sylvester);
  assert.equal(
    workspace.monthly.equipment.some(
      (row) => row.individualId === sylvester.id && row.active,
    ),
    false,
  );
});

test("checking equipment, drills, and safety unlocks that month’s downloads", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  let workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const ellis = workspace.individuals.find((row) => row.name === "Ellis Hart")!;
  const augustEquipment = await client.downloadMonthlyCheck({
    kind: "equipment",
    id: ellis.id,
    monthKey: "2026-08",
  });
  assert.match(augustEquipment.name, /adaptive-equipment-ellis-hart-2026-08/);

  const thisMonth = monthKeyFrom(todayIso());
  const items = workspace.monthly.equipment.filter(
    (row) => row.individualId === ellis.id && row.active,
  );
  for (const item of items) {
    await client.checkEquipmentLog({
      equipmentId: item.id,
      monthKey: thisMonth,
      checkedOn: `${thisMonth}-04`,
      initials: "AM",
      comments: "",
    });
  }
  workspace = await client.loadWorkspace(session);
  const drills = workspace.monthly.drills.filter(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth,
  );
  assert.equal(drills.length, drillsForMonth(thisMonth).length);
  for (const [i, drill] of drills.entries()) {
    await client.recordEmergencyDrill({
      id: drill.id,
      date: `${thisMonth}-${String(3 + i).padStart(2, "0")}`,
      time: "10:15",
      evacTime: "2:10",
      leaderName: "Alex Morgan",
      participants: "Alex Morgan, Taylor Reed, Ellis Hart",
      awakeOrSleep: "awake",
    });
  }
  const safety = workspace.monthly.safetyReports.find(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth,
  )!;
  await client.recordHomeSafety({
    id: safety.id,
    lines: safety.lines.map((line) => ({
      ...line,
      dateChecked: `${thisMonth}-02`,
      location:
        line.key.includes("faucet") || line.key.includes("smoke") || line.key === "co_1"
          ? "Hall"
          : line.location,
      temp: line.key.includes("faucet") ? "118 F" : "",
      extra: line.key === "fire_extinguisher" ? "2027-01 / full" : "",
      checkedBy: "Alex Morgan",
      signature: "Alex Morgan",
    })),
  });

  const equipmentPdf = await client.downloadMonthlyCheck({
    kind: "equipment",
    id: ellis.id,
    monthKey: thisMonth,
  });
  const drillPdf = await client.downloadMonthlyCheck({
    kind: "drills",
    id: maple.id,
    monthKey: thisMonth,
  });
  const safetyPdf = await client.downloadMonthlyCheck({
    kind: "safety",
    id: maple.id,
    monthKey: thisMonth,
  });
  assert.match(equipmentPdf.name, new RegExp(`adaptive-equipment-ellis-hart-${thisMonth}`));
  assert.match(drillPdf.name, new RegExp(`emergency-drills-cedar-house-${thisMonth}`));
  assert.match(safetyPdf.name, new RegExp(`home-safety-cedar-house-${thisMonth}`));
  assert.equal(equipmentPdf.blob.type, "application/pdf");
});

test("a new month does not clear last month’s completed log", async () => {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const client = new LocalApi(store);
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const item = workspace.monthly.equipment.find((row) => row.name === "Wheelchair")!;
  await client.checkEquipmentLog({
    equipmentId: item.id,
    monthKey: "2026-08",
    checkedOn: "2026-08-03",
    initials: "SM",
    comments: "",
  });
  store.db.equipmentMonthLogs.push({
    id: "00000000-0000-4000-8000-000000009901",
    equipmentId: item.id,
    monthKey: "2026-10",
    checkedOn: null,
    initials: null,
    checkedByUserId: null,
    comments: "",
  });
  const next = await client.loadWorkspace(session);
  const august = next.monthly.equipmentLogs.find(
    (row) => row.equipmentId === item.id && row.monthKey === "2026-08",
  );
  const october = next.monthly.equipmentLogs.find(
    (row) => row.equipmentId === item.id && row.monthKey === "2026-10",
  );
  assert.equal(august?.checkedOn, "2026-08-03");
  assert.equal(october?.checkedOn, null);
});

test("a PM or admin can change monthly due days; a DSP cannot", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  let workspace = await client.loadWorkspace(admin);
  assert.equal(workspace.monthlyDue.equipmentDay, 7);
  await client.updateMonthlyDueSettings({
    equipmentDay: 15,
    drillDay: 10,
    safetyDay: 5,
  });
  workspace = await client.loadWorkspace(admin);
  assert.deepEqual(workspace.monthlyDue, {
    equipmentDay: 15,
    drillDay: 10,
    safetyDay: 5,
  });

  await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await assert.rejects(
    () =>
      client.updateMonthlyDueSettings({
        equipmentDay: 1,
        drillDay: 1,
        safetyDay: 1,
      }),
    /PM or administrator/,
  );
});

test("a second drill type cannot share a date with a fire drill", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const thisMonth = monthKeyFrom(todayIso());
  const drills = workspace.monthly.drills.filter(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth,
  );
  const fire = drills.find((row) => row.drillType === "fire")!;
  const other = drills.find((row) => row.drillType !== "fire")!;
  const base = {
    time: "10:15",
    evacTime: "2:10",
    leaderName: "Alex Morgan",
    participants: "Alex Morgan, Taylor Reed",
    awakeOrSleep: "awake" as const,
  };
  await client.recordEmergencyDrill({ id: fire.id, date: `${thisMonth}-05`, ...base });
  await assert.rejects(
    () => client.recordEmergencyDrill({ id: other.id, date: `${thisMonth}-05`, ...base }),
    (err: unknown) => {
      const message = (err as Error).message;
      assert.match(message, /Fire drill is already recorded/);
      assert.match(message, new RegExp(`${thisMonth}-05`));
      assert.ok(!/constraint|unique|violates/i.test(message), "message should be human-readable");
      return true;
    },
  );
});

test("a fire drill cannot share a date with another drill type", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const thisMonth = monthKeyFrom(todayIso());
  const drills = workspace.monthly.drills.filter(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth,
  );
  const fire = drills.find((row) => row.drillType === "fire")!;
  const other = drills.find((row) => row.drillType !== "fire")!;
  const base = {
    time: "10:15",
    evacTime: "2:10",
    leaderName: "Alex Morgan",
    participants: "Alex Morgan, Taylor Reed",
    awakeOrSleep: "awake" as const,
  };
  await client.recordEmergencyDrill({ id: other.id, date: `${thisMonth}-06`, ...base });
  await assert.rejects(
    () => client.recordEmergencyDrill({ id: fire.id, date: `${thisMonth}-06`, ...base }),
    /is already recorded on/,
  );
});

test("the same drills on different dates are allowed", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const thisMonth = monthKeyFrom(todayIso());
  const drills = workspace.monthly.drills.filter(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth,
  );
  const fire = drills.find((row) => row.drillType === "fire")!;
  const other = drills.find((row) => row.drillType !== "fire")!;
  const base = {
    time: "10:15",
    evacTime: "2:10",
    leaderName: "Alex Morgan",
    participants: "Alex Morgan, Taylor Reed",
    awakeOrSleep: "awake" as const,
  };
  await client.recordEmergencyDrill({ id: fire.id, date: `${thisMonth}-07`, ...base });
  await client.recordEmergencyDrill({ id: other.id, date: `${thisMonth}-08`, ...base });
  const updated = await client.loadWorkspace(session);
  const saved = updated.monthly.drills.filter((row) => row.siteId === maple.id);
  assert.equal(saved.find((row) => row.id === fire.id)?.date, `${thisMonth}-07`);
  assert.equal(saved.find((row) => row.id === other.id)?.date, `${thisMonth}-08`);
});

test("re-saving a drill on its own date is allowed", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const thisMonth = monthKeyFrom(todayIso());
  const fire = workspace.monthly.drills.find(
    (row) => row.siteId === maple.id && row.monthKey === thisMonth && row.drillType === "fire",
  )!;
  const base = {
    time: "10:15",
    evacTime: "2:10",
    leaderName: "Alex Morgan",
    participants: "Alex Morgan, Taylor Reed",
    awakeOrSleep: "awake" as const,
  };
  await client.recordEmergencyDrill({ id: fire.id, date: `${thisMonth}-09`, ...base });
  await client.recordEmergencyDrill({
    id: fire.id,
    date: `${thisMonth}-09`,
    ...base,
    leaderName: "Taylor Reed",
  });
  const updated = await client.loadWorkspace(session);
  assert.equal(
    updated.monthly.drills.find((row) => row.id === fire.id)?.leaderName,
    "Taylor Reed",
  );
});
