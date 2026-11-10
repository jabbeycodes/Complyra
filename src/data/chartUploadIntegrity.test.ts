import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";
import {
  applyRenewalEvidence,
  applyRenewalFileRemoval,
  canRemoveRenewalFile,
  type ClinicalRenewal,
} from "./planStack";

// Retest batches 286/289/291: a replacement upload on a chart's Vision exam
// card reset its due date and cleared its overdue state, and no role could
// remove an uploaded chart file.

function setup() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  return { store, client: new LocalApi(store) };
}

async function signIn(client: LocalApi, username: string) {
  return client.signIn({ agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD });
}

async function ellisVision(
  client: LocalApi,
  session: Awaited<ReturnType<typeof signIn>>,
  who = "Ellis",
) {
  const stack = (await client.loadWorkspace(session)).planStacks.find((item) =>
    item.individualName.includes(who),
  )!;
  return stack.renewals.find((row) => row.kind === "vision")!;
}

function pdf(name = "vision-exam.pdf", bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

test("a replacement upload is evidence: due date, date done, and overdue state are untouched", async () => {
  const { client } = setup();
  const nurse = await signIn(client, DEMO_NURSE_USERNAME);
  const before = await ellisVision(client, nurse);
  assert.equal(before.status, "overdue", "seed: the Vision exam is overdue");
  // First file, then a replacement — neither is a renewal.
  for (const name of ["vision-first.pdf", "vision-replacement.pdf"]) {
    await client.uploadRenewalEvidence({
      renewalId: before.id,
      evidenceKind: "pdf",
      documentTitle: name,
      file: pdf(name),
    });
  }
  const after = await ellisVision(client, nurse);
  assert.equal(after.nextDueOn, before.nextDueOn);
  assert.equal(after.lastUploadedOn, before.lastUploadedOn);
  assert.equal(after.status, "overdue");
  assert.equal(after.lastDocumentTitle, "vision-replacement.pdf");
  assert.ok(after.fileId && after.fileId !== before.fileId);
});

test("passing a date without mode: \"renewal\" still does not move the due date", async () => {
  const { client } = setup();
  const nurse = await signIn(client, DEMO_NURSE_USERNAME);
  const before = await ellisVision(client, nurse);
  await client.uploadRenewalEvidence({
    renewalId: before.id,
    evidenceKind: "doctor_notes",
    documentTitle: "Notes",
    uploadedOn: todayIso(),
  });
  const after = await ellisVision(client, nurse);
  assert.equal(after.nextDueOn, before.nextDueOn);
  assert.equal(after.status, "overdue");
});

test("only the explicit renewal flow moves the dates, and never from a future date", async () => {
  const { client, store } = setup();
  const nurse = await signIn(client, DEMO_NURSE_USERNAME);
  const before = await ellisVision(client, nurse);
  await assert.rejects(
    client.uploadRenewalEvidence({
      renewalId: before.id,
      evidenceKind: "pdf",
      documentTitle: "Exam",
      uploadedOn: "2999-01-01",
      mode: "renewal",
    }),
    /cannot be in the future/,
  );
  await client.uploadRenewalEvidence({
    renewalId: before.id,
    evidenceKind: "pdf",
    documentTitle: "Exam",
    uploadedOn: "2026-09-12",
    mode: "renewal",
    file: pdf(),
  });
  const after = await ellisVision(client, nurse);
  assert.equal(after.lastUploadedOn, "2026-09-12");
  assert.equal(after.nextDueOn, "2027-09-12");
  assert.equal(store.db.audit[0].action, "renewal.renewed");
});

test("an administrator can remove an uploaded chart file; dates stay put and it is audited", async () => {
  const { client, store } = setup();
  const nurse = await signIn(client, DEMO_NURSE_USERNAME);
  const vision = await ellisVision(client, nurse);
  // A 5 MB test file (within this surface's 10 MB limit).
  await client.uploadRenewalEvidence({
    renewalId: vision.id,
    evidenceKind: "pdf",
    documentTitle: "test-5mb.pdf",
    file: pdf("test-5mb.pdf", 5 * 1024 * 1024),
  });
  const uploaded = await ellisVision(client, nurse);
  assert.ok(uploaded.fileId);
  const fileId = uploaded.fileId!;

  const admin = await signIn(client, DEMO_ADMIN_USERNAME);
  await client.removeRenewalFile(vision.id);
  const after = await ellisVision(client, admin);
  assert.equal(after.fileId, null);
  assert.equal(after.lastDocumentTitle, null);
  assert.equal(after.nextDueOn, vision.nextDueOn);
  assert.equal(after.lastUploadedOn, vision.lastUploadedOn);
  assert.equal(after.status, "overdue");
  assert.equal(store.db.chartFiles.some((file) => file.id === fileId), false);
  assert.equal(store.db.audit[0].action, "renewal.file_removed");
  assert.match(store.db.audit[0].detail, /test-5mb\.pdf/);
  await assert.rejects(client.removeRenewalFile(vision.id), /no uploaded file/);
});

test("the uploader is recorded on the view; HM may remove; DSP and auditor may not", async () => {
  const { client } = setup();
  const hm = await signIn(client, DEMO_HM_USERNAME);
  // The HM's own home: the first chart they can see with renewals.
  const who = (await client.loadWorkspace(hm)).planStacks.find((s) => s.renewals.length > 0)!
    .individualName;
  const vision = await ellisVision(client, hm, who);
  await client.uploadRenewalEvidence({
    renewalId: vision.id,
    evidenceKind: "pdf",
    documentTitle: "hm.pdf",
    file: pdf("hm.pdf"),
  });
  const withFile = await ellisVision(client, hm, who);
  assert.equal(withFile.fileUploadedBy, hm.userId);

  await signIn(client, DEMO_DSP_USERNAME);
  await assert.rejects(client.removeRenewalFile(vision.id));
  await signIn(client, "mark.delaney"); // auditor
  await assert.rejects(client.removeRenewalFile(vision.id), /can remove it/);

  await signIn(client, DEMO_HM_USERNAME);
  await client.removeRenewalFile(vision.id);
  assert.equal((await ellisVision(client, hm, who)).fileId, null);
});

test("canRemoveRenewalFile: manager roles, or the file's own uploader", () => {
  for (const role of ["administrator", "program_manager", "nurse", "house_manager"]) {
    assert.equal(canRemoveRenewalFile(role, { userId: "u1", uploadedBy: null }), true, role);
  }
  assert.equal(canRemoveRenewalFile("dsp", { userId: "u1", uploadedBy: null }), false);
  assert.equal(canRemoveRenewalFile("dsp", { userId: "u1", uploadedBy: "u2" }), false);
  assert.equal(canRemoveRenewalFile("dsp", { userId: "u1", uploadedBy: "u1" }), true);
  assert.equal(canRemoveRenewalFile("compliance_admin", { userId: "u1", uploadedBy: null }), false);
  assert.equal(canRemoveRenewalFile("auditor", { userId: "u1", uploadedBy: "u1" }), false);
});

test("applyRenewalEvidence / applyRenewalFileRemoval never touch dates", () => {
  const row: ClinicalRenewal = {
    id: "r1",
    agencyId: "a",
    individualId: "i",
    kind: "vision",
    title: "Vision exam",
    intervalMonths: 12,
    lastUploadedOn: "2025-03-12",
    nextDueOn: "2026-03-12",
    lastDocumentTitle: null,
    lastEvidenceKind: null,
    fileId: null,
  };
  const filed = applyRenewalEvidence(row, { documentTitle: "x", evidenceKind: "pdf", fileId: "f1" });
  assert.equal(filed.nextDueOn, row.nextDueOn);
  assert.equal(filed.lastUploadedOn, row.lastUploadedOn);
  assert.equal(filed.fileId, "f1");
  const removed = applyRenewalFileRemoval(filed);
  assert.equal(removed.fileId, null);
  assert.equal(removed.nextDueOn, row.nextDueOn);
  assert.equal(removed.lastUploadedOn, row.lastUploadedOn);
});

test("local parity: a future-dated renewal stores nothing; every uploaded file stays listed and is removable on its own", async () => {
  const { store, client } = setup();
  const nurse = await signIn(client, DEMO_NURSE_USERNAME);
  const before = await ellisVision(client, nurse);
  const filesBefore = store.db.chartFiles.length;
  const future = new Date(`${todayIso()}T00:00:00Z`);
  future.setUTCDate(future.getUTCDate() + 1);
  await assert.rejects(
    () =>
      client.uploadRenewalEvidence({
        renewalId: before.id,
        evidenceKind: "pdf",
        documentTitle: "Vision exam",
        file: pdf("future.pdf"),
        mode: "renewal",
        uploadedOn: future.toISOString().slice(0, 10),
      }),
    /cannot be in the future/,
  );
  assert.equal(store.db.chartFiles.length, filesBefore, "no chart record was written");
  assert.equal((await ellisVision(client, nurse)).fileId, before.fileId);

  await client.uploadRenewalEvidence({
    renewalId: before.id,
    evidenceKind: "pdf",
    documentTitle: "first.pdf",
    file: pdf("first.pdf"),
  });
  const first = (await ellisVision(client, nurse)).fileId!;
  await client.uploadRenewalEvidence({
    renewalId: before.id,
    evidenceKind: "pdf",
    documentTitle: "second.pdf",
    file: pdf("second.pdf"),
  });
  const second = (await ellisVision(client, nurse)).fileId!;
  assert.notEqual(first, second);
  // Wave 4E: the first file is NOT discarded — the card lists both,
  // oldest first, with the newest flagged current.
  const listed = await ellisVision(client, nurse);
  assert.deepEqual(
    listed.files.map((file) => file.id),
    [first, second],
  );
  assert.deepEqual(
    listed.files.map((file) => file.isCurrent),
    [false, true],
  );
  assert.ok(store.db.chartFiles.some((row) => row.id === first));
  assert.ok(store.db.chartFiles.some((row) => row.id === second));

  // Removing the older file leaves the current one and the dates alone.
  await client.removeRenewalFile(before.id, first);
  const afterFirst = await ellisVision(client, nurse);
  assert.equal(afterFirst.fileId, second);
  assert.equal(afterFirst.nextDueOn, listed.nextDueOn);
  assert.deepEqual(
    afterFirst.files.map((file) => file.id),
    [second],
  );
  assert.ok(!store.db.chartFiles.some((row) => row.id === first));

  // Removing the last file clears the card.
  await client.removeRenewalFile(before.id, second);
  const cleared = await ellisVision(client, nurse);
  assert.equal(cleared.fileId, null);
  assert.deepEqual(cleared.files, []);
});

test("local removal refuses a file that belongs to another renewal, individual, or site", async () => {
  const { store, client } = setup();
  const admin = await signIn(client, DEMO_ADMIN_USERNAME);
  // Ellis Hart is at Cedar; Harper Soto is at Willow — different
  // individual, different site. The administrator can open both renewals,
  // so the association gate is the only thing that may stop the call.
  const ellis = await ellisVision(client, admin, "Ellis");
  const harper = await ellisVision(client, admin, "Harper");
  await client.uploadRenewalEvidence({
    renewalId: harper.id,
    evidenceKind: "pdf",
    documentTitle: "harper-vision.pdf",
    file: pdf("harper-vision.pdf"),
  });
  const harperFileId = (await ellisVision(client, admin, "Harper")).fileId!;
  const harperRowBefore = store.db.chartFiles.find((row) => row.id === harperFileId);
  assert.ok(harperRowBefore, "Harper's file row exists before the attempt");

  await assert.rejects(
    client.removeRenewalFile(ellis.id, harperFileId),
    /not attached to this item/,
  );

  // Harper's file row, her renewal's pointer, and her file list are
  // exactly as they were; Ellis's renewal is untouched too.
  assert.deepEqual(
    store.db.chartFiles.find((row) => row.id === harperFileId),
    harperRowBefore,
  );
  const harperAfter = await ellisVision(client, admin, "Harper");
  assert.equal(harperAfter.fileId, harperFileId);
  assert.deepEqual(
    harperAfter.files.map((file) => file.id),
    [harperFileId],
  );
  const ellisAfter = await ellisVision(client, admin, "Ellis");
  assert.equal(ellisAfter.fileId, ellis.fileId);
});
