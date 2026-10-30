/**
 * newHireBinderStore.test.ts — local-store flows for the New Hire Binder
 * surface on HrStore (src/data/hrStore.ts): snapshot creation, the
 * wallet verification lifecycle, and emergency contacts. Local impl
 * only; the hosted impl is a thin mapper over the binder tables (RLS
 * covered by supabase/tests/new_hire_binder.sql).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHrStore, type HrStore } from "./hrStore";
import { DEFAULT_BINDER_TEMPLATE, binderItemCount } from "./newHireBinder";

const AGENCY = "agency-binder-test";
const STAFF = "staff-binder-1";
const HR = "hr-binder-1";

function staffStore(): HrStore {
  return createHrStore({ agencyId: AGENCY, userId: STAFF });
}

function pdfFile(name = "resume.pdf"): File {
  return new File(["%PDF-1.4 fake"], name, { type: "application/pdf" });
}

describe("binder snapshots", () => {
  test("getBinder creates a binder from the default template, once", async () => {
    const store = staffStore();
    const template = await store.getBinderTemplate();
    assert.equal(template.sections.length, DEFAULT_BINDER_TEMPLATE.sections.length);
    const binder = await store.getBinder(STAFF);
    assert.equal(binder.staffId, STAFF);
    assert.equal(
      binder.sections.flatMap((s) => s.items).length,
      binderItemCount(DEFAULT_BINDER_TEMPLATE),
    );
    const again = await store.getBinder(STAFF);
    assert.equal(again.id, binder.id);
  });
});

describe("wallet verification lifecycle", () => {
  test("upload lands on_file; verify stamps the verifier; return needs a note; re-upload resets", async () => {
    const store = staffStore();
    const doc = await store.uploadBinderDocument({
      staffId: STAFF,
      itemKey: "resume",
      file: pdfFile(),
      uploaderName: "Test Staffer",
    });
    assert.equal(doc.status, "on_file");
    assert.equal(doc.uploadedBy, STAFF);
    assert.equal(doc.verifiedBy, null);

    const listed = await store.listBinderDocuments(STAFF);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].itemKey, "resume");

    const verified = await store.verifyBinderDocument(doc.id, "Harriet HR");
    assert.equal(verified.status, "verified");
    assert.equal(verified.verifiedByName, "Harriet HR");
    assert.ok(verified.verifiedAt);

    await assert.rejects(
      () => store.returnBinderDocument(doc.id, "   "),
      /what needs fixing/,
    );
    const returned = await store.returnBinderDocument(
      doc.id,
      "Please upload the signed copy",
    );
    assert.equal(returned.status, "returned");
    assert.equal(returned.returnNote, "Please upload the signed copy");
    assert.equal(returned.verifiedBy, null);

    const replaced = await store.uploadBinderDocument({
      staffId: STAFF,
      itemKey: "resume",
      file: pdfFile("resume-signed.pdf"),
      uploaderName: "Test Staffer",
    });
    assert.equal(replaced.id, doc.id);
    assert.equal(replaced.status, "on_file");
    assert.equal(replaced.returnNote, null);
    assert.equal(replaced.fileName, "resume-signed.pdf");
  });

  test("dated items keep their obtained-on date", async () => {
    const store = staffStore();
    const doc = await store.uploadBinderDocument({
      staffId: STAFF,
      itemKey: "mvr",
      file: pdfFile("mvr.pdf"),
      obtainedOn: "2026-10-12",
      uploaderName: "Test Staffer",
    });
    assert.equal(doc.obtainedOn, "2026-10-12");
  });

  test("non-PDF/image uploads are rejected", async () => {
    const store = staffStore();
    await assert.rejects(
      () =>
        store.uploadBinderDocument({
          staffId: STAFF,
          itemKey: "resume",
          file: new File(["x"], "resume.exe", { type: "" }),
          uploaderName: "Test Staffer",
        }),
      /PDF or image/,
    );
  });

  test("verifying a missing document throws", async () => {
    const store = staffStore();
    await assert.rejects(
      () => store.verifyBinderDocument("no-such-doc", "Harriet HR"),
      /not found/,
    );
  });
});

describe("emergency contacts", () => {
  test("save + read roundtrip; a second save updates in place", async () => {
    const store = staffStore();
    assert.equal(await store.getEmergencyContact(STAFF), null);
    const saved = await store.saveEmergencyContact(STAFF, {
      contactName: "Jamie Staffer",
      relationship: "Sibling",
      phone: "573-555-0101",
    });
    assert.equal(saved.contactName, "Jamie Staffer");
    const updated = await store.saveEmergencyContact(STAFF, {
      contactName: "Jamie Staffer",
      relationship: "Sister",
      phone: "573-555-0102",
      alternatePhone: "573-555-0103",
    });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.phone, "573-555-0102");
    const read = await store.getEmergencyContact(STAFF);
    assert.equal(read?.alternatePhone, "573-555-0103");
  });

  test("blank fields are rejected", async () => {
    const store = staffStore();
    await assert.rejects(
      () =>
        store.saveEmergencyContact(STAFF, {
          contactName: "",
          relationship: "Sibling",
          phone: "573-555-0101",
        }),
      /name/,
    );
  });
});

// HR working from their own store instance still resolves the same
// in-memory bucket in environments without localStorage only when the
// instance is shared; cross-instance reads are covered by the browser
// merge (agency buckets) and are not asserted here.
void HR;
