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
  drillsForMonth,
  equipmentFromInventoryDetail,
  monthDueOn,
  monthKeyFrom,
  monthlyTone,
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

test("monthly tone is due soon through the 7th and overdue after", () => {
  assert.equal(monthKeyFrom("2026-09-11"), "2026-09");
  assert.equal(monthDueOn("2026-09"), "2026-09-07");
  assert.equal(monthlyTone(true, "2026-09-11", "2026-09"), "current");
  assert.equal(monthlyTone(false, "2026-09-07", "2026-09"), "due_soon");
  assert.equal(monthlyTone(false, "2026-09-11", "2026-09"), "overdue");
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
  const jodie = workspace.individuals.find((row) => row.name === "Jodie Williams");
  assert.ok(jodie);
  const current = workspace.monthly.equipment.filter(
    (row) => row.individualId === jodie.id && row.active,
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

  const sylvester = workspace.individuals.find((row) => row.name === "Sylvester Jones");
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
  const maple = workspace.sites.find((row) => row.name === "Maple House")!;
  const jodie = workspace.individuals.find((row) => row.name === "Jodie Williams")!;
  const augustEquipment = await client.downloadMonthlyCheck({
    kind: "equipment",
    id: jodie.id,
    monthKey: "2026-08",
  });
  assert.match(augustEquipment.name, /adaptive-equipment-jodie-williams-2026-08/);

  const thisMonth = monthKeyFrom(todayIso());
  const items = workspace.monthly.equipment.filter(
    (row) => row.individualId === jodie.id && row.active,
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
  for (const drill of drills) {
    await client.recordEmergencyDrill({
      id: drill.id,
      date: `${thisMonth}-03`,
      time: "10:15",
      evacTime: "2:10",
      leaderName: "Alex Morgan",
      participants: "Alex Morgan, Taylor Reed, Jodie Williams",
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
    id: jodie.id,
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
  assert.match(equipmentPdf.name, new RegExp(`adaptive-equipment-jodie-williams-${thisMonth}`));
  assert.match(drillPdf.name, new RegExp(`emergency-drills-maple-house-${thisMonth}`));
  assert.match(safetyPdf.name, new RegExp(`home-safety-maple-house-${thisMonth}`));
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
