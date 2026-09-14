import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  validateDoseExceptionInput,
  projectMedInventory,
} from "./medInventory";
import {
  validateTrainingLineInput,
  TRAINING_LINE_MAX_HOURS,
} from "../features/training/gate";
import type { Medication } from "./chart";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(here, "..", rel), "utf8");

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

async function adminApi() {
  const mem = store();
  const api = new LocalApi(mem);
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  const dsp = workspace.staff.find((person) => person.username === DEMO_DSP_USERNAME);
  const hm = workspace.staff.find((person) => person.username === DEMO_HM_USERNAME);
  assert.ok(dsp, "demo DSP exists");
  assert.ok(hm, "demo HM exists");
  return { mem, api, session, workspace, dspId: dsp.id, hmId: hm.id };
}

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    agencyId: "a",
    individualId: "i",
    name: "Levetiracetam",
    strength: "500 mg tablet",
    kind: "scheduled",
    controlled: false,
    pillsPerDay: 2,
    remainingPills: 30,
    lastDeliveryOn: "2026-09-01",
    lastCountdownOn: "2026-09-01",
    ...overrides,
  };
}

function exception(overrides: Record<string, unknown> = {}) {
  return {
    id: "exc-1",
    agencyId: "a",
    individualId: "i",
    medicationId: "med-1",
    occurredOn: "2026-09-10",
    kind: "refused" as const,
    pillsAffected: 4,
    reason: "individual refused the evening dose",
    createdBy: "u",
    createdAt: "2026-09-10T20:00:00Z",
    ...overrides,
  };
}

// ---------- P0-6: dose exceptions in the supply forecast ----------

test("dose exceptions subtract pills from the forecast", () => {
  const base = projectMedInventory({
    med: med(),
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [],
    today: "2026-09-13",
  });
  const withException = projectMedInventory({
    med: med(),
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [exception()],
    today: "2026-09-13",
  });
  assert.equal(withException.currentCount, base.currentCount - 4);
  assert.equal(withException.doseExceptions.length, 1);
  assert.equal(withException.daysRemaining, (base.daysRemaining ?? 0) - 2); // 2 pills/day
});

test("dose exceptions before the delivery date are ignored", () => {
  const withException = projectMedInventory({
    med: med(),
    inventory: null,
    deliveries: [],
    prnDoses: [],
    doseExceptions: [exception({ occurredOn: "2026-08-30" })],
    today: "2026-09-13",
  });
  assert.equal(withException.doseExceptions.length, 1); // history still shows
  assert.equal(withException.currentCount, 30 - 2 * 12); // no subtraction
});

test("dose exception validation rejects bad input", () => {
  for (const pills of [0, -1, 1.5]) {
    assert.throws(
      () =>
        validateDoseExceptionInput({
          medicationId: "m",
          kind: "refused",
          pillsAffected: pills,
          reason: "ok",
        }),
      /positive whole number/,
    );
  }
  assert.throws(
    () =>
      validateDoseExceptionInput({
        medicationId: "m",
        kind: "wasted",
        pillsAffected: 1,
        reason: "   ",
      }),
    /reason/,
  );
  assert.throws(
    () =>
      validateDoseExceptionInput({
        medicationId: "m",
        kind: "lost" as never,
        pillsAffected: 1,
        reason: "ok",
      }),
    /refused, held, or wasted/,
  );
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.throws(
    () =>
      validateDoseExceptionInput({
        medicationId: "m",
        kind: "held",
        pillsAffected: 1,
        reason: "ok",
        occurredOn: tomorrow,
      }),
    /future/,
  );
});

test("DSP can log a dose exception; it persists with history and audit", async () => {
  const { mem, api } = await adminApi();
  const dspApi = new LocalApi(mem);
  const dspSession = await dspApi.signIn(login(DEMO_DSP_USERNAME));
  const individualId = mem.db.medications[0].individualId;
  const medicationId = mem.db.medications[0].id;
  await dspApi.addMedDoseException({
    medicationId,
    kind: "wasted",
    pillsAffected: 2,
    reason: "bottle tipped over during the count",
  });
  const views = await dspApi.getMedInventory(individualId);
  const view = views.find((row) => row.medicationId === medicationId);
  assert.ok(view);
  assert.equal(view.doseExceptions.length, 1);
  assert.equal(view.doseExceptions[0].kind, "wasted");
  assert.equal(view.doseExceptions[0].reason, "bottle tipped over during the count");
  assert.equal(view.doseExceptions[0].createdBy, dspSession.userId);
  const audit = mem.db.audit[0];
  assert.equal(audit.action, "medication.dose_exception");
  assert.match(audit.detail, /bottle tipped over during the count/);
});

test("dose exceptions are insert-only: no update or delete API exists", async () => {
  const { api } = await adminApi();
  assert.equal((api as unknown as Record<string, unknown>).updateMedDoseException, undefined);
  assert.equal((api as unknown as Record<string, unknown>).deleteMedDoseException, undefined);
});

// ---------- P0-8: training line validation ----------

test("training lines cap at 8 hours and reject future dates", () => {
  assert.equal(TRAINING_LINE_MAX_HOURS, 8);
  const ok = validateTrainingLineInput({
    initials: "AM",
    signedOn: "2026-09-10",
    trainerUserId: "trainer-1",
    hoursTotal: 8,
    hoursWithHm: 8,
  });
  assert.equal(ok.hoursTotal, 8);
  for (const hoursTotal of [8.5, 40]) {
    assert.throws(
      () =>
        validateTrainingLineInput({
          initials: "AM",
          signedOn: "2026-09-10",
          trainerUserId: "trainer-1",
          hoursTotal,
          hoursWithHm: 0,
        }),
      /8 hours/,
    );
  }
  for (const hoursTotal of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        validateTrainingLineInput({
          initials: "AM",
          signedOn: "2026-09-10",
          trainerUserId: "trainer-1",
          hoursTotal,
          hoursWithHm: 0,
        }),
      /hours/,
    );
  }
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.throws(
    () =>
      validateTrainingLineInput({
        initials: "AM",
        signedOn: tomorrow,
        trainerUserId: "trainer-1",
        hoursTotal: 1,
        hoursWithHm: 0,
      }),
    /future/,
  );
  assert.throws(
    () =>
      validateTrainingLineInput({
        initials: "AM",
        signedOn: "2026-09-10",
        trainerUserId: "",
        hoursTotal: 1,
        hoursWithHm: 0,
      }),
    /trainer/,
  );
  // The contract carries a roster trainer id — free-text trainer names are rejected.
  assert.throws(
    () =>
      validateTrainingLineInput({
        initials: "AM",
        signedOn: "2026-09-10",
        trainerName: "House Manager",
        hoursTotal: 1,
        hoursWithHm: 0,
      } as never),
    /trainer/,
  );
});

test("signoff records trainer name, signer id, and self-training flag", async () => {
  const { mem, api, workspace, dspId, hmId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  const dspApi = new LocalApi(mem);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  const lines = (await dspApi.getStaffTrainingProfile(dspId)).requirements;
  const line = lines[0];
  assert.ok(line);
  const hmName = workspace.staff.find((person) => person.id === hmId)!.name;
  await dspApi.initialRequirementLine(line.id, {
    initials: "AM",
    trainerUserId: hmId,
    hoursTotal: 2,
    hoursWithHm: 1,
  });
  const profile = await dspApi.getStaffTrainingProfile(dspId);
  const signoff = profile.requirements.find((row) => row.id === line.id)!.signoff;
  assert.ok(signoff);
  assert.equal(signoff.trainerUserId, hmId);
  assert.equal(signoff.trainerName, hmName);
  assert.equal(signoff.signedByUserId, dspId);
  assert.equal(signoff.selfTraining, false);
});

test("self-training is flagged when the trainer is the staffer", async () => {
  const { mem, api, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  const dspApi = new LocalApi(mem);
  await dspApi.signIn(login(DEMO_DSP_USERNAME));
  const line = (await dspApi.getStaffTrainingProfile(dspId)).requirements[0];
  assert.ok(line);
  await dspApi.initialRequirementLine(line.id, {
    initials: "AM",
    trainerUserId: dspId,
    hoursTotal: 1,
    hoursWithHm: 0,
  });
  const profile = await dspApi.getStaffTrainingProfile(dspId);
  const signoff = profile.requirements.find((row) => row.id === line.id)!.signoff;
  assert.equal(signoff?.selfTraining, true);
});

test("N/A lines carry trainer and signer attribution", async () => {
  const { mem, api, session, workspace, dspId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  const line = (await api.getStaffTrainingProfile(dspId)).requirements[0];
  assert.ok(line);
  await api.waiveRequirementLine(line.id, "not applicable to this house");
  const profile = await api.getStaffTrainingProfile(dspId);
  const signoff = profile.requirements.find((row) => row.id === line.id)!.signoff;
  assert.ok(signoff?.na);
  assert.equal(signoff.trainerUserId, session.userId);
  assert.equal(signoff.signedByUserId, session.userId);
  assert.equal(signoff.selfTraining, false);
});

// ---------- P0-8: locking, corrections, re-signing ----------

interface CounterRow { id: string; agencyId: string; userId: string; siteId: string }

function countersignatures(mem: MemoryStore): CounterRow[] {
  return (mem.db as unknown as { trainingCountersignatures: CounterRow[] })
    .trainingCountersignatures;
}

// MemoryStore holds one global session, so this signs in sequentially as the
// DSP, then the HM — one role at a time.
async function completedSheet() {
  const { mem, api, workspace, dspId, hmId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  await api.signIn(login(DEMO_DSP_USERNAME));
  const lines = (await api.getStaffTrainingProfile(dspId)).requirements;
  for (const line of lines) {
    await api.initialRequirementLine(line.id, {
      initials: "AM",
      trainerUserId: hmId,
      hoursTotal: 1,
      hoursWithHm: 0.5,
    });
  }
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: "Alex Morgan",
  });
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "hm",
    signatureName: "Jordan Lee",
  });
  const counters = countersignatures(mem).filter(
    (row) => row.userId === dspId && row.siteId === siteId,
  );
  assert.equal(counters.length, 1);
  return { mem, api, dspId, hmId, siteId, countersignatureId: counters[0].id, lineId: lines[0].id };
}

test("locked sheets reject line edits, new initials, and N/A", async () => {
  const { api, hmId, lineId } = await completedSheet();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    api.initialRequirementLine(lineId, {
      initials: "XX",
      trainerUserId: hmId,
      hoursTotal: 1,
      hoursWithHm: 0,
    }),
    /locked/i,
  );
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    api.waiveRequirementLine(lineId, "late change"),
    /already initialed|locked/i,
  );
});

test("correction requires a reason and is denied to the HM", async () => {
  const { api, countersignatureId } = await completedSheet();
  await api.signIn(login(DEMO_HM_USERNAME));
  await assert.rejects(
    api.requestTrainingCorrection({ countersignatureId, reason: "typo" }),
    /Only an administrator, compliance admin, or DPM/,
  );
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    api.requestTrainingCorrection({ countersignatureId, reason: "   " }),
    /reason/,
  );
});

test("admin correction unlocks the sheet, audits the reason, and allows re-edit", async () => {
  const { mem, api, hmId, dspId, siteId, countersignatureId, lineId } = await completedSheet();
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.requestTrainingCorrection({
    countersignatureId,
    reason: "hours were under-counted",
  });
  assert.equal(countersignatures(mem).length, 0);
  const audit = mem.db.audit[0];
  assert.equal(audit.action, "training.correction_requested");
  assert.match(audit.detail, /hours were under-counted/);
  // The sheet is unlocked: an admin may edit the line, then staff re-signs and
  // the HM re-countersigns.
  await api.initialRequirementLine(lineId, {
    initials: "AM",
    trainerUserId: hmId,
    hoursTotal: 3,
    hoursWithHm: 1,
  });
  const profile = await api.getStaffTrainingProfile(dspId);
  const signoff = profile.requirements.find((row) => row.id === lineId)!.signoff;
  assert.equal(signoff?.hoursTotal, 3);
  const edited = mem.db.audit[0];
  assert.equal(edited.action, "training.line_edited");
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "staff",
    signatureName: "Alex Morgan",
  });
  await api.signIn(login(DEMO_HM_USERNAME));
  await api.signStaffChecklist({
    userId: dspId,
    siteId,
    role: "hm",
    signatureName: "Jordan Lee",
  });
  assert.equal(countersignatures(mem).length, 1);
});

test("a waived line can be corrected back to an ordinary signoff", async () => {
  const { mem, api, workspace, dspId, hmId } = await adminApi();
  const siteId = workspace.sites[0].id;
  await api.assignTraining({ userId: dspId, siteId, source: "checklist" });
  const line = (await api.getStaffTrainingProfile(dspId)).requirements[0];
  assert.ok(line);
  await api.waiveRequirementLine(line.id, "wrong line");
  await api.initialRequirementLine(line.id, {
    initials: "AM",
    trainerUserId: hmId,
    hoursTotal: 2,
    hoursWithHm: 0,
  });
  const profile = await api.getStaffTrainingProfile(dspId);
  const row = profile.requirements.find((r) => r.id === line.id)!;
  assert.equal(row.signoff?.na, false);
  assert.equal(row.signoff?.initials, "AM");
  assert.equal(row.resolvedStatus, "complete");
});

// ---------- P0-6/P0-8: copy and contract guarantees ----------

test("medication copy calls it a supply forecast, never a MAR", () => {
  const app = src("App.tsx");
  assert.ok(app.includes('"Supply forecast"'));
  assert.ok(!app.includes('"Med inventory"'));
  const status = src("data/status.ts");
  assert.ok(status.includes('page === "Supply forecast"'));
  const card = src("features/medInventory/MedInventoryCard.tsx");
  assert.ok(card.includes("Medication supply forecast"));
  assert.ok(card.includes("not a medication administration record"));
  assert.ok(card.includes("Log dose exception"));
  const page = src("features/medInventory/MedInventoryPage.tsx");
  assert.ok(page.includes("Medication supply forecast"));
});

test("training UI uses a roster trainer select, not free text", () => {
  const page = src("features/training/StaffCompliancePage.tsx");
  assert.ok(page.includes("Select a trainer"));
  assert.ok(!page.includes("setTrainerName"));
  assert.ok(page.includes("Request correction"));
  assert.ok(page.includes('fieldName="staff_sign"'));
});
