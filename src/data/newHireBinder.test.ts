/**
 * newHireBinder.test.ts — pure derivation + template coverage for the
 * digital New Hire Binder (src/data/newHireBinder.ts).
 *
 * The coverage test pins every line of the paper "New Hire Binder
 * Content List" (founder photo, 2026-10-30) to a template item, so a
 * future template edit cannot silently drop a required document.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BINDER_TEMPLATE,
  binderItemCount,
  binderKeyMatches,
  deriveBinder,
  validateBinderDocumentFile,
  validateEmergencyContact,
  type BinderDocument,
  type BinderEvidence,
  type StaffBinder,
} from "./newHireBinder";
import type { StaffTrainingProfile } from "./types";

const TODAY = "2026-10-30";

function binderWith(sections = DEFAULT_BINDER_TEMPLATE.sections): StaffBinder {
  return {
    id: "binder-1",
    agencyId: "agency-1",
    staffId: "staff-1",
    sections,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

function evidence(overrides: Partial<BinderEvidence> = {}): BinderEvidence {
  return {
    certificates: [],
    trainingProfile: null,
    documentAcks: [],
    walletDocuments: [],
    emergencyContact: null,
    ...overrides,
  };
}

function trainingProfile(
  overrides: Partial<StaffTrainingProfile> = {},
): StaffTrainingProfile {
  return {
    userId: "staff-1",
    fullName: "Test Staffer",
    siteNames: ["Cedar House"],
    individualNames: [],
    requirements: [],
    countersignatures: [],
    hoursTotal: 26,
    hoursWithHm: 13,
    counts: { required: 26, complete: 26, pending: 0, overdue: 0, waived: 0 },
    clearedForInRatio: true,
    gateReasons: [],
    certificates: [],
    ...overrides,
  };
}

function walletDoc(overrides: Partial<BinderDocument> = {}): BinderDocument {
  return {
    id: "doc-1",
    agencyId: "agency-1",
    binderId: "binder-1",
    staffId: "staff-1",
    itemKey: "resume",
    fileName: "resume.pdf",
    fileSize: 1200,
    mimeType: "application/pdf",
    storagePath: null,
    dataUrl: null,
    obtainedOn: null,
    status: "on_file",
    uploadedBy: "staff-1",
    uploadedByName: "Test Staffer",
    uploadedAt: "2026-10-20T10:00:00.000Z",
    verifiedBy: null,
    verifiedByName: null,
    verifiedAt: null,
    returnNote: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function item(
  derived: ReturnType<typeof deriveBinder>,
  key: string,
) {
  for (const section of derived.sections) {
    const found = section.items.find((i) => i.item.key === key);
    if (found) return found;
  }
  throw new Error(`item ${key} not derived`);
}

describe("default template covers the paper binder", () => {
  test("every content-list line has a template item", () => {
    const labels = DEFAULT_BINDER_TEMPLATE.sections
      .flatMap((s) => s.items.map((i) => i.label))
      .join(" | ");
    const paperLines = [
      "FCSR record",
      "Background authorization",
      "FCSR registration",
      "L1MA",
      "Insulin",
      "CPR & First Aid",
      "CPI / PBS",
      "Relias driving certificate",
      "Onboarding packet",
      "HIPAA (107)",
      "HELP Protocol (207)",
      "Abuse & Neglect (200)",
      "Event Reporting (205)",
      "Infection Control (210)",
      "Emergency Preparedness (204)",
      "Dress Code (203)",
      "Vehicle Use Agreement",
      "EE-01 voluntary information",
      "Interview packet",
      "Resume",
      "Driver's license copy",
      "Motor vehicle record (MVR)",
      "Direct deposit form",
      "Missouri W-4",
      "Federal W-4",
      "Offer letter",
      "Job description",
      "Benefits enrollment",
      "HCBS",
      "Individual Rights cover page",
      "Education record",
      "Emergency contact",
      "Staff training checklist",
      "ISP Acknowledgement",
    ];
    for (const line of paperLines) {
      assert.ok(labels.includes(line), `template is missing: ${line}`);
    }
    assert.equal(binderItemCount(DEFAULT_BINDER_TEMPLATE), paperLines.length);
  });

  test("item keys are unique across the template", () => {
    const keys = DEFAULT_BINDER_TEMPLATE.sections.flatMap((s) =>
      s.items.map((i) => i.key),
    );
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("binderKeyMatches", () => {
  test("contains-match in either direction, case-insensitive", () => {
    assert.equal(binderKeyMatches(["CPR"], "CPR & First Aid Certification"), true);
    assert.equal(binderKeyMatches(["CPR & First Aid"], "CPR"), true);
    assert.equal(binderKeyMatches(["hipaa"], "HIPAA 107"), true);
    assert.equal(binderKeyMatches(["MVR"], "CPR"), false);
    assert.equal(binderKeyMatches([], "CPR"), false);
    assert.equal(binderKeyMatches(["CPR"], ""), false);
  });
});

describe("certificate derivation", () => {
  test("missing when no certificate matches", () => {
    const derived = deriveBinder(binderWith(), evidence(), TODAY);
    const cpr = item(derived, "cpr-first-aid");
    assert.equal(cpr.status, "missing");
    assert.equal(cpr.satisfied, false);
  });

  test("current certificate is on file and satisfied", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [{ certName: "CPR & First Aid", expiresOn: "2027-10-30" }],
      }),
      TODAY,
    );
    const cpr = item(derived, "cpr-first-aid");
    assert.equal(cpr.status, "on_file");
    assert.equal(cpr.satisfied, true);
  });

  test("expired certificate is expired and unsatisfied", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [{ certName: "CPR", expiresOn: "2026-10-17" }],
      }),
      TODAY,
    );
    const cpr = item(derived, "cpr-first-aid");
    assert.equal(cpr.status, "expired");
    assert.equal(cpr.satisfied, false);
  });

  test("certificate renewing within 30 days is due soon but satisfied", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [{ certName: "CPR", expiresOn: "2026-11-15" }],
      }),
      TODAY,
    );
    const cpr = item(derived, "cpr-first-aid");
    assert.equal(cpr.status, "due_soon");
    assert.equal(cpr.satisfied, true);
  });

  test("the certificate with the latest renewal date wins", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [
          { certName: "CPR", expiresOn: "2026-10-17" },
          { certName: "CPR & First Aid", expiresOn: "2028-01-01" },
        ],
      }),
      TODAY,
    );
    assert.equal(item(derived, "cpr-first-aid").status, "on_file");
  });

  test("L1MA matches the long-form certificate name", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [
          { certName: "Level 1 Medication Aide (L1MA)", expiresOn: "2027-06-01" },
        ],
      }),
      TODAY,
    );
    assert.equal(item(derived, "l1ma").satisfied, true);
  });
});

describe("acknowledgment derivation", () => {
  test("signed document is verified", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        documentAcks: [{ docKey: "HIPAA 107", ackedAt: "2026-10-05T15:00:00.000Z" }],
      }),
      TODAY,
    );
    const hipaa = item(derived, "hipaa-107");
    assert.equal(hipaa.status, "verified");
    assert.equal(hipaa.satisfied, true);
  });

  test("unsigned document is missing", () => {
    const derived = deriveBinder(binderWith(), evidence(), TODAY);
    const hipaa = item(derived, "hipaa-107");
    assert.equal(hipaa.status, "missing");
    assert.equal(hipaa.satisfied, false);
  });
});

describe("wallet document derivation", () => {
  test("no upload is missing", () => {
    const derived = deriveBinder(binderWith(), evidence(), TODAY);
    assert.equal(item(derived, "resume").status, "missing");
  });

  test("an unverified upload is on file but does not complete the item", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({ walletDocuments: [walletDoc()] }),
      TODAY,
    );
    const resume = item(derived, "resume");
    assert.equal(resume.status, "on_file");
    assert.equal(resume.satisfied, false);
    assert.equal(derived.awaitingVerification, 1);
  });

  test("a verified upload completes the item", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        walletDocuments: [
          walletDoc({
            status: "verified",
            verifiedBy: "hr-1",
            verifiedByName: "Harriet HR",
            verifiedAt: "2026-10-22T11:00:00.000Z",
          }),
        ],
      }),
      TODAY,
    );
    const resume = item(derived, "resume");
    assert.equal(resume.status, "verified");
    assert.equal(resume.satisfied, true);
    assert.equal(derived.awaitingVerification, 0);
  });

  test("a returned upload shows HR's note", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        walletDocuments: [
          walletDoc({ status: "returned", returnNote: "Please upload the signed copy" }),
        ],
      }),
      TODAY,
    );
    const resume = item(derived, "resume");
    assert.equal(resume.status, "returned");
    assert.equal(resume.satisfied, false);
    assert.match(resume.note, /signed copy/);
  });
});

describe("training + profile derivation", () => {
  test("no training profile reads as not started", () => {
    const derived = deriveBinder(binderWith(), evidence(), TODAY);
    const row = item(derived, "staff-training-checklist");
    assert.equal(row.status, "missing");
    assert.equal(row.satisfied, false);
  });

  test("a cleared checklist is verified", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({ trainingProfile: trainingProfile() }),
      TODAY,
    );
    const row = item(derived, "staff-training-checklist");
    assert.equal(row.status, "verified");
    assert.equal(row.satisfied, true);
  });

  test("a partial checklist is in progress with the gate reason", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        trainingProfile: trainingProfile({
          counts: { required: 26, complete: 15, pending: 11, overdue: 0, waived: 0 },
          clearedForInRatio: false,
          gateReasons: ["House manager countersignature missing"],
        }),
      }),
      TODAY,
    );
    const row = item(derived, "staff-training-checklist");
    assert.equal(row.status, "in_progress");
    assert.equal(row.satisfied, false);
    assert.match(row.note, /countersignature/i);
  });

  test("an emergency contact satisfies the profile item", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        emergencyContact: {
          id: "ec-1",
          agencyId: "agency-1",
          staffId: "staff-1",
          contactName: "Jamie Staffer",
          relationship: "Sibling",
          phone: "573-555-0101",
          alternatePhone: null,
          updatedBy: "staff-1",
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
      }),
      TODAY,
    );
    const row = item(derived, "emergency-contact");
    assert.equal(row.satisfied, true);
    assert.match(row.note, /Jamie Staffer/);
  });

  test("percent complete counts satisfied items only", () => {
    const derived = deriveBinder(
      binderWith(),
      evidence({
        certificates: [{ certName: "CPR & First Aid", expiresOn: "2027-10-30" }],
        documentAcks: [{ docKey: "HIPAA 107", ackedAt: "2026-10-05T15:00:00.000Z" }],
        walletDocuments: [walletDoc({ status: "on_file" })],
      }),
      TODAY,
    );
    assert.equal(derived.satisfiedItems, 2);
    assert.equal(
      derived.percentComplete,
      Math.round((2 / derived.totalItems) * 100),
    );
  });
});

describe("validation", () => {
  test("wallet files must be PDF or image scans under 10 MB", () => {
    assert.throws(
      () => validateBinderDocumentFile({ name: "x.exe", type: "", size: 10 }),
      /PDF or image/,
    );
    assert.throws(
      () =>
        validateBinderDocumentFile({
          name: "x.pdf",
          type: "application/pdf",
          size: 11 * 1024 * 1024,
        }),
      /10 MB/,
    );
    validateBinderDocumentFile({ name: "x.pdf", type: "application/pdf", size: 10 });
  });

  test("emergency contacts need name, relationship, and phone", () => {
    assert.throws(
      () => validateEmergencyContact({ contactName: "", relationship: "Sister", phone: "1" }),
      /name/,
    );
    assert.throws(
      () => validateEmergencyContact({ contactName: "A", relationship: "", phone: "1" }),
      /relationship/,
    );
    assert.throws(
      () => validateEmergencyContact({ contactName: "A", relationship: "Sister", phone: "" }),
      /phone/,
    );
    validateEmergencyContact({ contactName: "A", relationship: "Sister", phone: "1" });
  });
});
