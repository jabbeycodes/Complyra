/**
 * Issue #100 — MAR unit tests: permissions, validators, monthly grid,
 * signature log, and the credited-back pill-count wiring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canConfigureMar,
  canRecordMarAdministration,
  canResolveMarConcern,
  collectMarSignatureLog,
  creditedBackForAdministrations,
  defaultMarConfig,
  initialsForName,
  marGridForMonth,
  medicationMarView,
  monthKeyFor,
  shiftMonthKey,
  validateMarAdministration,
  validateMarConcern,
  validateMedicationInput,
  validatePrnAdministration,
  type MarAdministration,
  type MarPrnLog,
  type MedicationMarView,
  type NewMedicationInput,
} from "./mar";
import { projectInventory, projectMedInventory } from "./medInventory";
import type { Medication } from "./chart";

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    agencyId: "a1",
    individualId: "p1",
    name: "Lisinopril",
    strength: "10 mg",
    kind: "scheduled",
    controlled: false,
    pillsPerDay: 2,
    remainingPills: 60,
    lastDeliveryOn: "2026-09-01",
    lastCountdownOn: "2026-09-01",
    ...overrides,
  };
}

function marMed(overrides: Partial<Medication> = {}, configOverrides = {}): MedicationMarView {
  return medicationMarView({
    ...med(overrides),
    marConfig: {
      ...defaultMarConfig(),
      beginAt: "2026-09-01",
      timeSlots: ["08:00", "20:00"],
      ...configOverrides,
    },
  });
}

function administration(overrides: Partial<MarAdministration> = {}): MarAdministration {
  return {
    id: "adm-1",
    agencyId: "a1",
    individualId: "p1",
    medicationId: "med-1",
    administeredOn: "2026-09-10",
    timeSlot: "08:00",
    pillsGiven: 1,
    status: "given",
    initials: "JR",
    administeredByName: "Jordan Reese",
    administeredByUserId: "u1",
    reason: "",
    notifyNurse: false,
    createdAt: "2026-09-10T08:05:00Z",
    ...overrides,
  };
}

function prnLog(overrides: Partial<MarPrnLog> = {}): MarPrnLog {
  return {
    id: "prn-1",
    agencyId: "a1",
    individualId: "p1",
    medicationId: "med-prn",
    givenAt: "2026-09-12T14:30:00Z",
    pillsGiven: 1,
    reasonGiven: "Headache, pain 6/10",
    effectiveness: "Pain reduced to 2/10 within an hour",
    initials: "JR",
    administeredByName: "Jordan Reese",
    createdAt: "2026-09-12T14:35:00Z",
    ...overrides,
  };
}

/* ------------------------------- permissions ------------------------------ */

test("mar permissions: role matrix", () => {
  // nurse and config roles can configure the MAR
  for (const role of ["administrator", "compliance_admin", "program_manager", "nurse"]) {
    assert.equal(canConfigureMar(role), true, role);
  }
  // HMs and DSPs record but do not configure
  for (const role of ["house_manager", "dsp"]) {
    assert.equal(canConfigureMar(role), false, role);
    assert.equal(canRecordMarAdministration(role), true, role);
  }
  // auditors are read-only on the MAR
  assert.equal(canConfigureMar("auditor"), false);
  assert.equal(canRecordMarAdministration("auditor"), false);
  // nurses do both
  assert.equal(canConfigureMar("nurse"), true);
  assert.equal(canRecordMarAdministration("nurse"), true);
  // concern resolution: clinical/supervisory roles only
  for (const role of ["administrator", "compliance_admin", "program_manager", "nurse"]) {
    assert.equal(canResolveMarConcern(role), true, role);
  }
  for (const role of ["house_manager", "dsp", "auditor"]) {
    assert.equal(canResolveMarConcern(role), false, role);
  }
});

/* ------------------------------ validators ------------------------------- */

function validMedicationInput(overrides: Partial<NewMedicationInput> = {}): NewMedicationInput {
  const base = {
    individualId: "p1",
    name: "Lisinopril",
    strength: "10 mg",
    kind: "scheduled" as const,
    controlled: false,
    pillsPerDay: 2,
    remainingPills: 60,
    config: { timeSlots: ["08:00", "20:00"] },
  };
  return {
    ...base,
    ...overrides,
    config: { ...base.config, ...(overrides.config ?? {}) },
  };
}

test("validateMedicationInput: name and strength required", () => {
  assert.throws(() => validateMedicationInput(validMedicationInput({ name: "  " })), /medication name/);
  assert.throws(() => validateMedicationInput(validMedicationInput({ strength: "" })), /strength/);
});

test("validateMedicationInput: scheduled meds need time slots and pills per day", () => {
  assert.throws(
    () => validateMedicationInput(validMedicationInput({ config: { timeSlots: [] } })),
    /at least one time slot/,
  );
  assert.throws(
    () => validateMedicationInput(validMedicationInput({ pillsPerDay: 0 })),
    /pills per day/,
  );
});

test("validateMedicationInput: PRN meds do not need time slots", () => {
  const validated = validateMedicationInput(
    validMedicationInput({ kind: "prn", pillsPerDay: 0, config: {} }),
  );
  assert.equal(validated.kind, "prn");
});

test("validateMedicationInput: future begin date rejected", () => {
  assert.throws(
    () => validateMedicationInput(validMedicationInput({ config: { beginAt: "2999-01-01" } })),
    /cannot be in the future/,
  );
});

test("validateMedicationInput: discontinued needs a discontinued date", () => {
  assert.throws(
    () =>
      validateMedicationInput(
        validMedicationInput({ config: { status: "discontinued" } }),
      ),
    /discontinued date/,
  );
});

test("validateMedicationInput: time slots normalized, deduped, sorted", () => {
  const validated = validateMedicationInput(
    validMedicationInput({ config: { timeSlots: ["20:00", "08:00", " 08:00 "] } }),
  );
  assert.deepEqual(validated.config.timeSlots, ["08:00", "20:00"]);
});

test("validateMarAdministration: refusal without reason throws", () => {
  assert.throws(
    () =>
      validateMarAdministration(
        { medicationId: "med-1", administeredOn: "2026-09-10", timeSlot: "08:00", initials: "JR", status: "refused" },
        "2026-09-01",
        "2026-09-17",
      ),
    /reason/,
  );
});

test("validateMarAdministration: refused auto-notifies the nurse", () => {
  const validated = validateMarAdministration(
    {
      medicationId: "med-1",
      administeredOn: "2026-09-10",
      timeSlot: "08:00",
      initials: "JR",
      status: "refused",
      reason: "Individual spat the dose out",
    },
    "2026-09-01",
    "2026-09-17",
  );
  assert.equal(validated.notifyNurse, true);
});

test("validateMarAdministration: future date throws", () => {
  assert.throws(
    () =>
      validateMarAdministration(
        { medicationId: "med-1", administeredOn: "2999-01-01", timeSlot: "08:00", initials: "JR" },
        null,
        "2026-09-17",
      ),
    /future/,
  );
});

test("validateMarAdministration: date before begin date throws", () => {
  assert.throws(
    () =>
      validateMarAdministration(
        { medicationId: "med-1", administeredOn: "2026-08-31", timeSlot: "08:00", initials: "JR" },
        "2026-09-01",
        "2026-09-17",
      ),
    /begin date/,
  );
});

test("validateMarAdministration: initials required", () => {
  assert.throws(
    () =>
      validateMarAdministration(
        { medicationId: "med-1", administeredOn: "2026-09-10", timeSlot: "08:00", initials: " " },
        null,
        "2026-09-17",
      ),
    /Initials/,
  );
});

test("validatePrnAdministration: reason and effectiveness required", () => {
  assert.throws(
    () =>
      validatePrnAdministration(
        {
          medicationId: "med-prn",
          givenAt: "2026-09-12T14:30:00Z",
          pillsGiven: 1,
          reasonGiven: "",
          effectiveness: "Worked",
        },
        "2026-09-17",
      ),
    /reason/,
  );
  assert.throws(
    () =>
      validatePrnAdministration(
        {
          medicationId: "med-prn",
          givenAt: "2026-09-12T14:30:00Z",
          pillsGiven: 1,
          reasonGiven: "Headache",
          effectiveness: " ",
        },
        "2026-09-17",
      ),
    /effectiveness/,
  );
});

test("validateMarConcern: description and type required", () => {
  assert.throws(
    () =>
      validateMarConcern({
        medicationId: "med-1",
        concernType: "med_error",
        description: " ",
        initials: "JR",
      }),
    /Describe/,
  );
});

/* ------------------------------ monthly grid ------------------------------ */

test("marGridForMonth: rows per med x time slot; cells filled", () => {
  const m = marMed();
  const grid = marGridForMonth({
    meds: [m],
    administrations: [
      administration({ administeredOn: "2026-09-10", timeSlot: "08:00" }),
      administration({ id: "adm-2", administeredOn: "2026-09-10", timeSlot: "20:00" }),
    ],
    prnLogs: [],
    monthKey: "2026-09",
  });
  assert.equal(grid.daysInMonth, 30);
  assert.equal(grid.rows.length, 2);
  const morning = grid.rows.find((row) => row.timeSlot === "08:00")!;
  assert.equal(morning.cells[9].administration?.initials, "JR");
  assert.equal(morning.cells[8].administration, null);
});

test("marGridForMonth: med starting mid-month appears only from begin date", () => {
  const m = marMed({}, { beginAt: "2026-09-15" });
  const grid = marGridForMonth({
    meds: [m],
    administrations: [administration({ administeredOn: "2026-09-10", timeSlot: "08:00" })],
    prnLogs: [],
    monthKey: "2026-09",
  });
  const morning = grid.rows.find((row) => row.timeSlot === "08:00")!;
  // an administration recorded before the begin date is out of window -> no cell
  assert.equal(morning.cells[9].administration, null);
  // days before begin date render no cells at all
  assert.equal(morning.cells[0].administration, null);
  assert.ok(morning.cells[14].day === 15);
});

test("marGridForMonth: discontinued med stops at discontinuedOn", () => {
  const m = marMed(
    {},
    { status: "discontinued", discontinuedOn: "2026-09-20" },
  );
  const grid = marGridForMonth({
    meds: [m],
    administrations: [
      administration({ administeredOn: "2026-09-19", timeSlot: "08:00" }),
      administration({ id: "adm-2", administeredOn: "2026-09-25", timeSlot: "08:00" }),
    ],
    prnLogs: [],
    monthKey: "2026-09",
  });
  const morning = grid.rows.find((row) => row.timeSlot === "08:00")!;
  assert.equal(morning.cells[18].administration?.id, "adm-1");
  assert.equal(morning.cells[24].administration, null);
});

test("marGridForMonth: PRN meds get one row with initials on given days", () => {
  const prn = marMed({ id: "med-prn", kind: "prn" }, { timeSlots: [] });
  const grid = marGridForMonth({
    meds: [prn],
    administrations: [],
    prnLogs: [prnLog()],
    monthKey: "2026-09",
  });
  assert.equal(grid.rows.length, 1);
  assert.equal(grid.rows[0].prn, true);
  assert.equal(grid.rows[0].cells[11].prnLog?.initials, "JR");
  assert.equal(grid.rows[0].cells[10].prnLog, null);
});

test("marGridForMonth: 28/30/31-day months render correct day counts", () => {
  for (const [monthKey, days] of [
    ["2026-02", 28],
    ["2024-02", 29],
    ["2026-09", 30],
    ["2026-10", 31],
  ] as const) {
    const grid = marGridForMonth({ meds: [marMed()], administrations: [], prnLogs: [], monthKey });
    assert.equal(grid.daysInMonth, days, monthKey);
    assert.equal(grid.rows[0].cells.length, days, monthKey);
  }
});

test("shiftMonthKey rolls over years", () => {
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  assert.equal(shiftMonthKey("2026-09", 0), "2026-09");
});

test("monthKeyFor returns current YYYY-MM", () => {
  assert.match(monthKeyFor("2026-09-17"), /^\d{4}-\d{2}$/);
});

/* ----------------------------- signature log ------------------------------ */

test("collectMarSignatureLog: unique initials -> names, sorted", () => {
  const log = collectMarSignatureLog(
    [
      administration({ initials: "JR", administeredByName: "Jordan Reese" }),
      administration({ id: "adm-2", initials: "ak", administeredByName: "Avery Kim" }),
      administration({ id: "adm-3", initials: "jr", administeredByName: "Jordan Reese" }),
    ],
    [prnLog({ initials: "LT", administeredByName: "Lee Turner" })],
  );
  assert.deepEqual(log, [
    { initials: "AK", name: "Avery Kim" },
    { initials: "JR", name: "Jordan Reese" },
    { initials: "LT", name: "Lee Turner" },
  ]);
});

test("initialsForName derives first/last initials", () => {
  assert.equal(initialsForName("Jordan Reese"), "JR");
  assert.equal(initialsForName("Avery Kim Nguyen"), "AK");
  assert.equal(initialsForName("Madonna"), "M");
});

/* ------------------------ countdown credited-back wiring ------------------- */

test("projectInventory: refused/omitted MAR doses credit pills back", () => {
  const base = projectInventory({
    deliveryQty: 60,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-11",
    creditedBack: [{ date: "2026-09-05", pills: 2 }],
  });
  const without = projectInventory({
    deliveryQty: 60,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-11",
  });
  // 10 elapsed days * 2 = 20 used; crediting 2 back raises the count by 2
  assert.equal(base.currentCount, without.currentCount + 2);
  assert.equal(base.currentCount, 42);
});

test("projectInventory: no creditedBack behaves exactly as before", () => {
  const result = projectInventory({
    deliveryQty: 60,
    dosesPerDay: 2,
    deliveredOn: "2026-09-01",
    today: "2026-09-11",
  });
  assert.equal(result.currentCount, 40);
  assert.equal(result.daysRemaining, 20);
});

test("projectMedInventory: non-given administrations credit pills back", () => {
  const medication = med();
  const withRefusal = projectMedInventory({
    med: medication,
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [],
    administrations: [
      administration({ status: "refused", administeredOn: "2026-09-05", pillsGiven: 1 }),
      administration({ id: "adm-2", status: "given", administeredOn: "2026-09-06", pillsGiven: 1 }),
    ],
    today: "2026-09-11",
  });
  const withoutAdmins = projectMedInventory({
    med: medication,
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [],
    today: "2026-09-11",
  });
  // only the refused dose credits back; the given dose stays consumed
  assert.equal(withRefusal.currentCount, withoutAdmins.currentCount + 1);
});

test("creditedBackForAdministrations: maps non-given rows to date/pills", () => {
  const credits = creditedBackForAdministrations([
    administration({ status: "given" }),
    administration({ id: "adm-2", status: "refused", pillsGiven: 2 }),
    administration({ id: "adm-3", status: "omitted", pillsGiven: 1, administeredOn: "2026-09-06" }),
    administration({ id: "adm-4", status: "held", pillsGiven: 0 }),
  ]);
  assert.deepEqual(credits, [
    { date: "2026-09-10", pills: 2 },
    { date: "2026-09-06", pills: 1 },
  ]);
});

test("medicationMarView fills MAR config defaults", () => {
  const view = medicationMarView(med());
  assert.equal(view.mar.status, "active");
  assert.deepEqual(view.mar.timeSlots, []);
  assert.equal(view.mar.orderAttachment, null);
});
