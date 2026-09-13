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

test("verbatim clauses match the LifePath paper form word-for-word", () => {
  assert.equal(
    DELEGATION_NON_TRANSFERABILITY_CLAUSE,
    "The following agency employees have been trained by a licensed person, demonstrate competency in all instructed procedures and are being delegated the task indicated above. This delegation and individualized instruction is specific to this individual and may not be transferred to other individuals with similar needs within this or other agencies",
  );
  assert.equal(
    DELEGATION_RN_RESPONSIBILITY_CLAUSE,
    "The delegating RN is responsible for the provision of guidance and ongoing evaluation for the delegated nursing task, including periodic inspection based at intervals determined by the delegating RN. The delegating RN maintains authority to require corrective action or rescind delegation of this task.",
  );
});

test("blank delegation form ships 12 roster rows", () => {
  const form = blankDelegationForm("lifepath_exact");
  assert.equal(form.roster.length, 12);
  assert.ok(form.roster.every((row) => row.printName === "" && row.signedAt === null));
  assert.equal(blankDelegationForm("complyrer_improved").templateVersion, "complyrer_improved");
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
  const form = blankDelegationForm("complyrer_improved");
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
  const blank = mapDelegationForm({})!;
  assert.equal(blank.templateVersion, "lifepath_exact");
  assert.equal(blank.roster.length, 12);
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

test("delegation PDFs build in both templates", () => {
  for (const kind of ["exact", "improved"] as const) {
    const pdf = buildBlankDelegationPdf(kind);
    const text = pdf.output("datauristring");
    assert.match(text, /application\/pdf/);
  }
  const form = blankDelegationForm();
  form.roster[0].printName = "Alex Morgan";
  form.roster[0].signatureName = "Alex Morgan";
  form.roster[0].signedAt = "2026-09-01T10:00:00.000Z";
  form.roster[0].initials = "AM";
  const pdf = buildDelegationPdf({
    agencyName: "LifePath of Mid-Missouri",
    individualName: "Sylvester Drummer",
    dmhId: "",
    individualLocation: "3201 Pompey dr",
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    form,
    kind: "exact",
  });
  assert.match(pdf.output("datauristring"), /application\/pdf/);
  assert.equal(
    delegationFileName("PRN Inhaler Self-Administration and Monitoring", "Sylvester Drummer", "exact"),
    "complyrer-delegation-lifepath-prn-inhaler-self-administration-and-moni-sylvester-drummer.pdf",
  );
  assert.match(
    delegationFileName("Task", "Person", "improved"),
    /complyrer-delegation-improved-task-person\.pdf/,
  );
});

test("createDelegation validates and stores the form", async () => {
  const api = new LocalApi(store());
  const nurse = await api.signIn(nurseLogin());
  const workspace = await api.loadWorkspace(nurse);
  const person = workspace.individuals[0];
  await assert.rejects(
    () => api.createDelegation({ individualId: person.id, taskTitle: "", purpose: "x", templateVersion: "lifepath_exact" }),
    /Name the delegated task/,
  );
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "PRN Inhaler Self-Administration and Monitoring",
    purpose: "Keep inhaler use safe.",
    templateVersion: "lifepath_exact",
    procedures: "Step one.",
  });
  const refreshed = await api.loadWorkspace(nurse);
  const item = refreshed.planStacks
    .flatMap((s) => s.required)
    .find((v) => v.item.id === id)!.item;
  assert.equal(item.kind, "delegation");
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
    templateVersion: "lifepath_exact",
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
    templateVersion: "complyrer_improved",
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

test("getDelegationPdf returns a named blob in both templates", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(adminLogin());
  const workspace = await api.loadWorkspace(session);
  const person = workspace.individuals[0];
  const { id } = await api.createDelegation({
    individualId: person.id,
    taskTitle: "Skin checks",
    purpose: "Daily checks.",
    templateVersion: "lifepath_exact",
  });
  for (const kind of ["exact", "improved"] as const) {
    const { blob, name } = await api.getDelegationPdf({ obligationId: id, kind });
    assert.ok(blob.size > 0);
    assert.match(name, new RegExp(`complyrer-delegation-${kind === "exact" ? "lifepath" : "improved"}`));
  }
});

test("sign-in still fails with the standard message", async () => {
  const api = new LocalApi(store());
  await assert.rejects(
    () => api.signIn({ agencyCode: DEMO_AGENCY_CODE, username: "nobody", password: "wrong" }),
    new RegExp(LOGIN_FAILED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
