import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE, DEMO_NURSE_USERNAME } from "./seed";
import { DEMO_PASSWORD, LOGIN_FAILED_MESSAGE } from "./types";
import {
  blankDelegationForm,
  DELEGATION_NON_TRANSFERABILITY_CLAUSE,
  DELEGATION_RN_RESPONSIBILITY_CLAUSE,
  delegationFormStatus,
  delegationReviewState,
} from "./types";
import {
  ORIGINAL_NON_TRANSFERABILITY_CLAUSE,
  ORIGINAL_RN_RESPONSIBILITY_CLAUSE,
} from "./complyrerOriginal.fixtures";
import { mapDelegationForm } from "./hostedMappers";
import {
  buildBlankDelegationPdf,
  buildDelegationPdf,
  delegationFileName,
} from "../pdf/delegationPdf";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function nurseLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_NURSE_USERNAME,
password: DEMO_PASSWORD,
  };
}

function adminLogin() {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
password: DEMO_PASSWORD,
  };
}

test("delegation clauses are Complyrer's own wording, not the legacy verbatim text", () => {
  // Same compliance meaning, different words — never the transcribed originals.
  assert.notEqual(DELEGATION_NON_TRANSFERABILITY_CLAUSE, ORIGINAL_NON_TRANSFERABILITY_CLAUSE);
  assert.notEqual(DELEGATION_RN_RESPONSIBILITY_CLAUSE, ORIGINAL_RN_RESPONSIBILITY_CLAUSE);
  for (const clause of [DELEGATION_NON_TRANSFERABILITY_CLAUSE, DELEGATION_RN_RESPONSIBILITY_CLAUSE]) {
    assert.ok(clause.length > 50);
    assert.ok(
      !clause.includes("may not be transferred to other individuals with similar needs"),
    );
    assert.ok(
      !clause.includes("responsible for the provision of guidance and ongoing evaluation"),
    );
  }
  // Non-transferability meaning preserved: individual-specific, not reusable elsewhere.
  assert.match(DELEGATION_NON_TRANSFERABILITY_CLAUSE, /this individual alone/);
  assert.match(DELEGATION_NON_TRANSFERABILITY_CLAUSE, /cannot be used for anyone else/);
  // RN responsibility meaning preserved: guidance, inspection, correct/rescind authority.
  assert.match(DELEGATION_RN_RESPONSIBILITY_CLAUSE, /accountable/);
  assert.match(DELEGATION_RN_RESPONSIBILITY_CLAUSE, /inspections on a schedule the RN sets/);
  assert.match(DELEGATION_RN_RESPONSIBILITY_CLAUSE, /corrective action or end the delegation/);
});

test("blank delegation form defaults to the Complyrer version with 12 roster rows", () => {
  const form = blankDelegationForm();
  assert.equal(form.templateVersion, "complyrer_improved");
  assert.equal(form.roster.length, 12);
  assert.ok(form.roster.every((row) => row.printName === "" && row.signedAt === null));
});

test("delegationFormStatus counts named, signed, and rescinded rows", () => {
  const form = blankDelegationForm();
  form.roster[0].printName = "Alex Morgan";
  form.roster[0].signedAt = "2026-09-01T10:00:00Z";
  form.roster[1].printName = "Sam Rivera";
  form.roster[1].signedAt = "2026-09-01T11:00:00Z";
  form.roster[1].rescindedDate = "2026-09-05";
  const status = delegationFormStatus(form);
  assert.equal(status.rowsNamed, 2);
  assert.equal(status.rowsSigned, 2);
  assert.equal(status.rowsRescinded, 1);
  assert.equal(status.fullySigned, true);
  assert.equal(status.rescinded, false);
  form.rescindReason = "health_status_change";
  assert.equal(delegationFormStatus(form).rescinded, true);
});

test("delegationReviewState reports overdue, due, and missing review dates", () => {
  const form = blankDelegationForm();
  assert.equal(delegationReviewState(form, "2026-09-13"), null);
  form.reviewDate = "2026-09-01";
  const overdue = delegationReviewState(form, "2026-09-13")!;
  assert.equal(overdue.overdue, true);
  assert.match(overdue.label, /overdue/);
  form.reviewDate = "2026-09-20";
  const soon = delegationReviewState(form, "2026-09-13")!;
  assert.equal(soon.dueSoon, true);
  assert.equal(soon.overdue, false);
  form.reviewDate = "2027-01-01";
  assert.equal(delegationReviewState(form, "2026-09-13")!.dueSoon, false);
});

test("mapDelegationForm sanitizes the delegation_form jsonb column", () => {
  assert.equal(mapDelegationForm(null), null);
  assert.equal(mapDelegationForm(undefined), null);
  // Legacy rows keep their recorded version for data compatibility.
  const legacy = mapDelegationForm({})!;
  assert.equal(legacy.templateVersion, "lifepath_exact");
  assert.equal(legacy.roster.length, 12);
  const form = mapDelegationForm({
    templateVersion: "complyrer_improved",
    purpose: "Keep inhaler use safe",
    reviewDate: "2026-12-01",
    rescindReason: "bogus",
    roster: Array.from({ length: 20 }, (_, i) => ({ printName: `Staff ${i}` })),
  })!;
  assert.equal(form.templateVersion, "complyrer_improved");
  assert.equal(form.purpose, "Keep inhaler use safe");
  assert.equal(form.reviewDate, "2026-12-01");
  assert.equal(form.rescindReason, null);
  assert.equal(form.roster.length, 12);
  assert.equal(form.roster[0].printName, "Staff 0");
});

test("delegation PDF builds in the single Complyrer view", () => {
  const pdf = buildBlankDelegationPdf();
  const text = pdf.output("datauristring");
  assert.match(text, /application\/pdf/);
  const form = blankDelegationForm();
  form.roster[0].printName = "Alex Morgan";
  form.roster[0].signatureName = "Alex Morgan";
  form.roster[0].signedAt = "2026-09-01T10:00:00.000Z";
  form.roster[0].initials = "AM";
  const filled = buildDelegationPdf({
    agencyName: "Test Agency",
    individualName: "Andre Drummer",
    dmhId: "",
    individualLocation: "418 Cedar Court",
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    form,
    documentId: "delegation-1",
  });
  assert.match(filled.output("datauristring"), /application\/pdf/);
  assert.equal(
    delegationFileName("PRN Inhaler Self-Administration and Monitoring", "Andre Drummer"),
    "complyrer-delegation-prn-inhaler-self-administration-and-moni-andre-drummer.pdf",
  );
});

test("createDelegation validates and stores the form", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(nurseLogin());
  const workspace = await api.loadWorkspace(nurse);
  const person = workspace.individuals[0];
  await assert.rejects(
    () => api.createDelegation({ individualId: person.id, taskTitle: "", purpose: "x" }),
    /Name the delegated task/,
  );
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    purpose: "Keep inhaler use safe.",
    procedures: "Step one.",
  });
  const refreshed = await api.loadWorkspace(nurse);
  const item = refreshed.planStacks
    .flatMap((s) => s.required)
    .find((v) => v.item.id === id)!.item;
  assert.equal(item.kind, "delegation");
  assert.equal(item.delegationForm?.templateVersion, "complyrer_improved");
  assert.equal(item.delegationForm?.purpose, "Keep inhaler use safe.");
  assert.equal(item.delegationForm?.procedures, "Step one.");
  assert.equal(item.delegationForm?.roster.length, 12);
});

test("staff cannot sign a roster row before the RN", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(nurseLogin());
  const workspace = await api.loadWorkspace(nurse);
  const person = workspace.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily skin integrity checks.",
  });
  await api.updateDelegationForm({
    obligationId: id,
    patch: {
      roster: (() => {
        const form = blankDelegationForm();
        form.roster[0].printName = "Alex Morgan";
        return form.roster;
      })(),
    },
  });
  await assert.rejects(
    () =>
      api.signDelegationRow({
        obligationId: id,
        rowIndex: 0,
        signatureName: "Alex Morgan",
        signatureMark: "mark",
        initials: "AM",
      }),
    /delegating RN must sign before staff/,
  );
  await api.signDelegationRn(id, "Andrea Murdock, RN", "rn-mark");
  await api.signDelegationRow({
    obligationId: id,
    rowIndex: 0,
    signatureName: "Alex Morgan",
    signatureMark: "mark",
    initials: "am",
  });
  const refreshed = await api.loadWorkspace(nurse);
  const item = refreshed.planStacks.flatMap((s) => s.required).find((v) => v.item.id === id)!.item;
  const row = item.delegationForm!.roster[0];
  assert.equal(row.signatureName, "Alex Morgan");
  assert.equal(row.initials, "AM");
  assert.ok(row.signedAt);
  await assert.rejects(
    () =>
      api.signDelegationRow({
        obligationId: id,
        rowIndex: 0,
        signatureName: "Alex Morgan",
        signatureMark: "mark",
        initials: "AM",
      }),
    /already signed/,
  );
});

test("rescindDelegationRow records a per-row rescinded date", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(session);
  const person = workspace.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "G-tube flush",
    purpose: "Flush per orders.",
  });
  await assert.rejects(
    () => api.rescindDelegationRow({ obligationId: id, rowIndex: 0, rescindedDate: "not-a-date" }),
    /valid rescinded date/,
  );
  await api.rescindDelegationRow({ obligationId: id, rowIndex: 0, rescindedDate: "2026-09-10" });
  const refreshed = await api.loadWorkspace(session);
  const item = refreshed.planStacks.flatMap((s) => s.required).find((v) => v.item.id === id)!.item;
  assert.equal(item.delegationForm!.roster[0].rescindedDate, "2026-09-10");
});

test("getDelegationPdf returns a named blob in the single Complyrer view", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(session);
  const person = workspace.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
  });
  const { blob, name } = await api.getDelegationPdf({ obligationId: id });
  assert.ok(blob.size > 0);
  assert.match(name, /^complyrer-delegation-skin-checks-/);
});

test("sign-in still fails with the standard message", async () => {
  const api = new LocalApi(store());
  await assert.rejects(
    () => api.signIn({ agencyCode: DEMO_AGENCY_CODE, username: "nobody", password: "wrong" }),
    new RegExp(LOGIN_FAILED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
