/**
 * PCSP documents UI tests (frontend workstream).
 *
 * Pure logic only — no DB, no DOM, no network.
 * - Upload status machine transitions + labels.
 * - Confidence banding / "Needs human check" flagging.
 * - Risk/deadline mapping from an extraction fixture (incl. the registry).
 * - BAA-gate copy presence (exact wording).
 * - Client-side text-extraction helpers (kind detection, validation,
 *   truncation, loader dispatch). The real pdf.js parser needs browser
 *   globals, so the PDF path is exercised through an injected fake loader;
 *   DOCX is exercised for real through mammoth on a hand-built .docx.
 *
 * Run: node --import tsx --test src/features/documents/documentsUi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  AI_BAA_REQUIRED_COPY,
  aiServiceAccountStatusLabel,
  allowedUploadTransitions,
  canTransitionUpload,
  confidenceBand,
  confidenceLabel,
  documentTypeLabel,
  extractionDatesSection,
  extractionListSections,
  isMissingSignature,
  isTerminalUploadStatus,
  LOW_CONFIDENCE_THRESHOLD,
  needsHumanCheck,
  trackableItemKindLabel,
  uploadStatusLabel,
  type PcspExtraction,
} from "./documents";
import {
  detectDocumentKind,
  extractTextFromBytes,
  truncateForModel,
  validateUploadFile,
  MAX_EXTRACT_CHARS,
  type TextExtractLoaders,
} from "./extractText";
import {
  collectDeadlines,
  collectRisks,
  pcspExtractionDeadlines,
  pcspExtractionRisks,
} from "../../data/riskSources";

/* ------------------------------------------------------------------ */
/* Upload status machine                                                */
/* ------------------------------------------------------------------ */

test("uploadStatusLabel: human-readable labels for every status", () => {
  assert.equal(uploadStatusLabel("uploading"), "Uploading");
  assert.equal(uploadStatusLabel("extracting"), "Extracting");
  assert.equal(uploadStatusLabel("ready_for_review"), "Ready for review");
  assert.equal(uploadStatusLabel("approved"), "Approved");
  assert.equal(uploadStatusLabel("rejected"), "Rejected");
});

test("status machine: the happy path is uploading -> extracting -> ready_for_review -> approved", () => {
  assert.ok(canTransitionUpload("uploading", "extracting"));
  assert.ok(canTransitionUpload("extracting", "ready_for_review"));
  assert.ok(canTransitionUpload("ready_for_review", "approved"));
  assert.ok(canTransitionUpload("ready_for_review", "rejected"));
});

test("status machine: a failed extraction can move extracting -> rejected", () => {
  assert.ok(canTransitionUpload("extracting", "rejected"));
});

test("status machine: no skipping ahead, no going back, terminal states are final", () => {
  assert.ok(!canTransitionUpload("uploading", "ready_for_review"));
  assert.ok(!canTransitionUpload("uploading", "approved"));
  assert.ok(!canTransitionUpload("extracting", "approved"));
  assert.ok(!canTransitionUpload("ready_for_review", "extracting"));
  assert.ok(!canTransitionUpload("approved", "rejected"));
  assert.ok(!canTransitionUpload("rejected", "approved"));
  assert.ok(isTerminalUploadStatus("approved"));
  assert.ok(isTerminalUploadStatus("rejected"));
  assert.ok(!isTerminalUploadStatus("ready_for_review"));
  assert.deepEqual(allowedUploadTransitions("approved"), []);
  assert.deepEqual(allowedUploadTransitions("rejected"), []);
});

test("documentTypeLabel + trackableItemKindLabel: human-readable, no codes", () => {
  assert.equal(documentTypeLabel("pcsp"), "PCSP (person-centered support plan)");
  assert.equal(documentTypeLabel("annual_physician_order"), "Annual physician order");
  assert.equal(trackableItemKindLabel("protocol_needs_delegation"), "Protocol — needs delegation");
  assert.equal(trackableItemKindLabel("physician_order"), "Physician order");
  assert.equal(trackableItemKindLabel("training_requirement"), "Training requirement");
  assert.equal(trackableItemKindLabel("deadline"), "Deadline");
  assert.equal(trackableItemKindLabel("review_task"), "Review task");
});

/* ------------------------------------------------------------------ */
/* Confidence                                                           */
/* ------------------------------------------------------------------ */

test("confidenceBand: thresholds", () => {
  assert.equal(LOW_CONFIDENCE_THRESHOLD, 0.7);
  assert.equal(confidenceBand(0.95), "high");
  assert.equal(confidenceBand(0.85), "high");
  assert.equal(confidenceBand(0.849), "medium");
  assert.equal(confidenceBand(0.7), "medium");
  assert.equal(confidenceBand(0.699), "low");
  assert.equal(confidenceBand(0.2), "low");
  assert.equal(confidenceBand(null), "unknown");
  assert.equal(confidenceBand(undefined), "unknown");
  assert.equal(confidenceBand(NaN), "unknown");
});

test("needsHumanCheck: flags strictly below the threshold (icon + text, never color alone)", () => {
  assert.equal(needsHumanCheck(0.69), true);
  assert.equal(needsHumanCheck(0.3), true);
  assert.equal(needsHumanCheck(0.7), false);
  assert.equal(needsHumanCheck(0.95), false);
  assert.equal(needsHumanCheck(null), false);
  assert.equal(needsHumanCheck(undefined), false);
});

test("confidenceLabel: every band has a human-readable label", () => {
  assert.equal(confidenceLabel(0.95), "High confidence");
  assert.equal(confidenceLabel(0.75), "Medium confidence");
  assert.equal(confidenceLabel(0.4), "Low confidence");
  assert.equal(confidenceLabel(null), "No confidence score");
});

/* ------------------------------------------------------------------ */
/* BAA gate copy                                                        */
/* ------------------------------------------------------------------ */

test("AI_BAA_REQUIRED_COPY: exact blocking notice wording", () => {
  assert.equal(
    AI_BAA_REQUIRED_COPY,
    "AI document processing is disabled for your agency. A signed Google BAA is required before processing documents containing personal health information.",
  );
});

/* ------------------------------------------------------------------ */
/* Extraction fixture                                                   */
/* ------------------------------------------------------------------ */

function extractionFixture(overrides: Partial<PcspExtraction> = {}): PcspExtraction {
  return {
    uploadId: "upload-1",
    individualId: "person-1",
    individualName: "Jordan Ellis",
    documentType: "pcsp",
    fileName: "pcsp-jordan-ellis.pdf",
    status: "approved",
    rejectionReason: null,
    createdAt: "2026-09-10T10:00:00.000Z",
    reviewedAt: "2026-09-11T10:00:00.000Z",
    reviewedBy: "Pat Manager",
    structured: {
      individualName: { value: "Jordan Ellis", confidence: 0.98 },
      planStartDate: { value: "2026-09-01", confidence: 0.9 },
      planEndDate: { value: "2027-08-31", confidence: 0.9 },
      annualReviewDate: { value: "2027-08-01", confidence: 0.62 },
      outcomes: [{ title: "Maintain community employment", confidence: 0.88 }],
      protocols: [{ title: "Seizure protocol", detail: "Call nurse after any seizure", confidence: 0.91 }],
      dietary: [],
      behavioralSupports: [],
      trainingRequirements: [{ title: "Seizure response refresher", confidence: 0.55 }],
      physicianOrders: [],
      signatures: [
        { role: "DPM", name: "Pat Manager", signed: true, signedAt: "2026-09-02", confidence: 0.9 },
        { role: "RN", signed: false, confidence: 0.4 },
        { role: "Guardian", signed: false },
      ],
    },
    items: [
      {
        id: "item-1",
        uploadId: "upload-1",
        individualId: "person-1",
        kind: "protocol_needs_delegation",
        title: "Seizure protocol delegation",
        detail: "Needs RN delegation for site staff",
        dueDate: "2026-10-01",
        confidence: 0.91,
        status: "proposed",
      },
      {
        id: "item-2",
        uploadId: "upload-1",
        individualId: "person-1",
        kind: "training_requirement",
        title: "Seizure response refresher",
        detail: "",
        dueDate: null,
        confidence: 0.55,
        status: "proposed",
      },
      {
        id: "item-3",
        uploadId: "upload-1",
        individualId: "person-1",
        kind: "deadline",
        title: "Annual physical",
        detail: "",
        dueDate: "2026-11-15",
        confidence: null,
        status: "activated",
      },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* Risk / deadline mapping                                              */
/* ------------------------------------------------------------------ */

test("pcspExtractionDeadlines: plan expiry + annual review become deadlines", () => {
  const deadlines = pcspExtractionDeadlines(extractionFixture());
  assert.equal(deadlines.length, 2);
  assert.ok(deadlines.every((d) => d.source === "pcsp-extraction"));
  const expiry = deadlines.find((d) => d.id.includes("plan-expiry"))!;
  assert.equal(expiry.dueDate, "2027-08-31");
  assert.match(expiry.title, /Jordan Ellis/);
  assert.equal(expiry.individualId, "person-1");
  const review = deadlines.find((d) => d.id.includes("annual-review"))!;
  assert.equal(review.dueDate, "2027-08-01");
});

test("pcspExtractionDeadlines: identical plan-end and review dates dedupe to one deadline", () => {
  const ex = extractionFixture();
  ex.structured.annualReviewDate = { value: "2027-08-31", confidence: 0.9 };
  assert.equal(pcspExtractionDeadlines(ex).length, 1);
});

test("pcspExtractionDeadlines: nothing from an unapproved extraction", () => {
  assert.deepEqual(pcspExtractionDeadlines(extractionFixture({ status: "ready_for_review" })), []);
  assert.deepEqual(pcspExtractionDeadlines(extractionFixture({ status: "rejected" })), []);
});

test("isMissingSignature: unsigned (or absent) signatures count as missing", () => {
  const ex = extractionFixture();
  assert.equal(isMissingSignature(ex.structured.signatures[0]), false);
  assert.equal(isMissingSignature(ex.structured.signatures[1]), true);
  assert.equal(isMissingSignature(ex.structured.signatures[2]), true);
});

test("pcspExtractionRisks: missing signatures are high-severity risks", () => {
  const risks = pcspExtractionRisks(extractionFixture());
  const sigRisks = risks.filter((r) => r.id.includes("missing-signature"));
  assert.equal(sigRisks.length, 2);
  assert.ok(sigRisks.every((r) => r.severity === "high"));
  assert.ok(sigRisks.every((r) => r.source === "pcsp-extraction"));
  const rn = sigRisks.find((r) => r.id.endsWith(":RN"))!;
  assert.match(rn.title, /Missing signature: RN/);
  assert.match(rn.title, /Jordan Ellis/);
  assert.match(rn.detail, /survey finding/);
});

test("pcspExtractionRisks: unactivated high-confidence items are medium risks; low-confidence and activated items are not", () => {
  const risks = pcspExtractionRisks(extractionFixture());
  const unactivated = risks.filter((r) => r.id.includes("unactivated"));
  // item-1: proposed, 0.91 -> risk. item-2: proposed, 0.55 -> no risk. item-3: activated -> no risk.
  assert.equal(unactivated.length, 1);
  assert.equal(unactivated[0].id, "pcsp-extraction:unactivated:item-1");
  assert.equal(unactivated[0].severity, "medium");
  assert.match(unactivated[0].title, /Seizure protocol delegation/);
});

test("pcspExtractionRisks: an item with no confidence score is treated as high-confidence", () => {
  const ex = extractionFixture();
  ex.items[1].confidence = null; // item-2, proposed
  const unactivated = pcspExtractionRisks(ex).filter((r) => r.id.includes("unactivated"));
  assert.equal(unactivated.length, 2);
});

test("pcspExtractionRisks: nothing from an unapproved extraction", () => {
  assert.deepEqual(pcspExtractionRisks(extractionFixture({ status: "ready_for_review" })), []);
});

test("collectRisks/collectDeadlines: registry merges the pcsp-extraction source, sorted", () => {
  const ctx = { extractions: [extractionFixture()] };
  const risks = collectRisks(ctx);
  assert.ok(risks.length >= 3);
  // high severity first
  assert.equal(risks[0].severity, "high");
  assert.equal(risks[1].severity, "high");
  assert.equal(risks[risks.length - 1].severity, "medium");
  const deadlines = collectDeadlines(ctx);
  assert.equal(deadlines.length, 2);
  // soonest first
  assert.ok(deadlines[0].dueDate <= deadlines[1].dueDate);
});

test("collectRisks: empty context yields no items (no crashes)", () => {
  assert.deepEqual(collectRisks({}), []);
  assert.deepEqual(collectDeadlines({}), []);
});

/* ------------------------------------------------------------------ */
/* Client-side text extraction helpers                                  */
/* ------------------------------------------------------------------ */

test("detectDocumentKind: by extension and MIME type", () => {
  assert.equal(detectDocumentKind("plan.pdf", "application/pdf"), "pdf");
  assert.equal(detectDocumentKind("PLAN.PDF", ""), "pdf");
  assert.equal(detectDocumentKind("notes.docx", ""), "docx");
  assert.equal(
    detectDocumentKind("notes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "docx",
  );
  assert.equal(detectDocumentKind("notes.txt", "text/plain"), null);
  assert.equal(detectDocumentKind("scan.png", "image/png"), null);
});

test("validateUploadFile: accepts good files, rejects the rest with human messages", () => {
  assert.deepEqual(validateUploadFile({ name: "a.pdf", size: 100, type: "application/pdf" }), {
    ok: true,
    kind: "pdf",
  });
  const bad = validateUploadFile({ name: "a.txt", size: 100, type: "text/plain" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /PDF or DOCX/);
  const empty = validateUploadFile({ name: "a.pdf", size: 0, type: "application/pdf" });
  assert.equal(empty.ok, false);
  const huge = validateUploadFile({ name: "a.pdf", size: 16 * 1024 * 1024, type: "application/pdf" });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.match(huge.error, /15 MB/);
});

test("truncateForModel: short text passes through; long text is capped", () => {
  const short = truncateForModel("hello");
  assert.deepEqual(short, { text: "hello", truncated: false });
  const long = truncateForModel("x".repeat(MAX_EXTRACT_CHARS + 10));
  assert.equal(long.truncated, true);
  assert.equal(long.text.length, MAX_EXTRACT_CHARS);
});

test("extractTextFromBytes: PDF path joins page text with newlines and destroys the document", async () => {
  let destroyed = false;
  const loaders: TextExtractLoaders = {
    async loadPdfJs() {
      return {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage: (n: number) =>
              Promise.resolve({
                getTextContent: () =>
                  Promise.resolve({ items: [{ str: `page${n}-a` }, { str: `page${n}-b` }] }),
              }),
            destroy: () => {
              destroyed = true;
              return Promise.resolve();
            },
          }),
        }),
        GlobalWorkerOptions: { workerSrc: "" },
      };
    },
    async loadMammoth() {
      throw new Error("should not load mammoth for a PDF");
    },
  };
  const result = await extractTextFromBytes(new Uint8Array([1, 2, 3]), "pdf", loaders);
  assert.equal(result.kind, "pdf");
  assert.equal(result.text, "page1-a page1-b\npage2-a page2-b");
  assert.equal(result.charCount, result.text.length);
  assert.equal(result.truncated, false);
  assert.equal(destroyed, true);
});

test("extractTextFromBytes: DOCX path uses mammoth", async () => {
  const loaders: TextExtractLoaders = {
    async loadPdfJs() {
      throw new Error("should not load pdf.js for a DOCX");
    },
    async loadMammoth() {
      return {
        extractRawText: async () => ({ value: "  Hello   DOCX\n\nWorld  " }),
      };
    },
  };
  const result = await extractTextFromBytes(new Uint8Array([1, 2, 3]), "docx", loaders);
  assert.equal(result.kind, "docx");
  assert.equal(result.text, "Hello DOCX\n\nWorld");
});

test("extractTextFromBytes: empty extraction throws a human-readable error", async () => {
  const loaders: TextExtractLoaders = {
    async loadPdfJs() {
      return {
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: () => Promise.resolve({ getTextContent: () => Promise.resolve({ items: [] }) }),
            destroy: () => Promise.resolve(),
          }),
        }),
        GlobalWorkerOptions: { workerSrc: "" },
      };
    },
    async loadMammoth() {
      return { extractRawText: async () => ({ value: "   " }) };
    },
  };
  await assert.rejects(
    extractTextFromBytes(new Uint8Array([1]), "pdf", loaders),
    /scanned image/,
  );
  await assert.rejects(
    extractTextFromBytes(new Uint8Array([1]), "docx", loaders),
    /No readable text/,
  );
});

test("extractTextFromBytes: a real .docx converts through mammoth", async () => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Jordan Ellis PCSP</w:t></w:r></w:p><w:p><w:r><w:t>Goal: community employment</w:t></w:r></w:p></w:body></w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const result = await extractTextFromBytes(new Uint8Array(buffer), "docx");
  assert.match(result.text, /Jordan Ellis PCSP/);
  assert.match(result.text, /community employment/);
});

/* ------------------------------------------------------------------ */
/* Backend adapter (getDocumentsApi)                                    */
/* ------------------------------------------------------------------ */

import { getDocumentsApi } from "./documents";
import type { ComplyraApi } from "../../data/localApi";

const ADAPTER_UPLOAD = {
  id: "upload-1",
  agencyId: "agency-1",
  individualId: "ind-1",
  siteId: "site-1",
  documentType: "pcsp",
  originalFilename: "pcsp-jodie.pdf",
  mimeType: "application/pdf",
  storagePath: "agency-1/upload-1/pcsp-jodie.pdf",
  uploadedBy: "admin-1",
  uploadedAt: "2026-09-14T10:00:00.000Z",
  status: "extracted",
};

const ADAPTER_EXTRACTION_DATA = {
  individual: { full_name: "Jodie Williams", date_of_birth: "1988-04-02", medicaid_id: null, confidence: 0.9 },
  plan: { effective_date: "2026-09-14", expiry_date: "2027-09-13", annual_review_due_date: "2027-08-14", confidence: 0.95 },
  outcomes: [
    { title: "Community participation", description: "Two activities weekly.", support_strategies: ["Staff assist."], confidence: 0.85 },
  ],
  protocols_referenced: [{ name: "Seizure protocol", category: "Health", confidence: 0.7 }],
  dietary: { description: "High fiber diet.", confidence: 0.8 },
  behavioral_supports: null,
  staff_training_requirements: [{ topic: "Seizure protocol", due_date: "2026-10-14", confidence: 0.7 }],
  physician_orders: [{ description: "Multivitamin daily", date: "2026-09-14", confidence: 0.9 }],
  signatures: [{ role: "RN", name: null, signed: false, date: null }],
};

function adapterItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    agencyId: "agency-1",
    extractionId: "ext-1",
    itemType: "deadline",
    title: "PCSP annual review due",
    detail: { description: "Annual review date stated in the PCSP." },
    dueDate: "2027-08-14",
    confidence: 0.95,
    needsHumanCheck: false,
    status: "proposed",
    ...overrides,
  };
}

/** Minimal fake of the ComplyraApi document surface the adapter touches. */
function fakeApi(overrides: Record<string, unknown> = {}) {
  const calls: any[][] = [];
  const api = {
    registerDocumentUpload: async (input: any) => {
      calls.push(["registerDocumentUpload", input]);
      return { ...ADAPTER_UPLOAD, status: "uploaded" };
    },
    extractDocumentUpload: async () => {
      throw new Error("Real AI extraction is hosted-only (extract-pcsp edge function).");
    },
    simulatePcspExtraction: async (uploadId: any) => {
      calls.push(["simulatePcspExtraction", uploadId]);
      return { extraction: { id: "ext-1" }, items: [] };
    },
    getDocumentExtraction: async () => ({
      extraction: {
        id: "ext-1",
        agencyId: "agency-1",
        uploadId: "upload-1",
        schemaVersion: 1,
        extractedData: ADAPTER_EXTRACTION_DATA,
        confidence: {},
        model: "gemini-2.5-flash",
        createdAt: "2026-09-14T10:01:00.000Z",
      },
      items: [adapterItem()],
    }),
    listDocumentUploads: async () => [{ ...ADAPTER_UPLOAD }],
    updateTrackableItem: async (itemId: any, patch: any) => {
      calls.push(["updateTrackableItem", itemId, patch]);
      return { ...adapterItem(), title: patch.title ?? adapterItem().title, detail: patch.detail ?? adapterItem().detail, status: "edited" };
    },
    addTrackableItem: async (input: any) => {
      calls.push(["addTrackableItem", input]);
      return { ...adapterItem(), id: "item-new", itemType: input.itemType, title: input.title, detail: input.detail ?? {}, dueDate: input.dueDate ?? null };
    },
    removeTrackableItem: async (itemId: any) => {
      calls.push(["removeTrackableItem", itemId]);
      return { ...adapterItem(), id: itemId, status: "removed" };
    },
    activateTrackableItem: async (itemId: any) => {
      calls.push(["activateTrackableItem", itemId]);
      return { ...adapterItem(), id: itemId, status: "activated" };
    },
    approveDocumentExtraction: async (uploadId: any) => {
      calls.push(["approveDocumentExtraction", uploadId]);
    },
    rejectDocumentUpload: async (uploadId: any, reason: any) => {
      calls.push(["rejectDocumentUpload", uploadId, reason]);
    },
    getAgencyAiSettings: async () => ({
      agencyId: "agency-1",
      aiProcessingEnabled: true,
      model: "gemini-2.5-flash",
      serviceAccountVerifiedAt: "2026-09-14T09:00:00.000Z",
      vertexProjectId: "demo-project",
    }),
    setAgencyAiSettings: async (input: any) => {
      calls.push(["setAgencyAiSettings", input]);
      return { agencyId: "agency-1", aiProcessingEnabled: input.enabled, model: input.model, serviceAccountVerifiedAt: null, vertexProjectId: null };
    },
    verifyAiServiceAccount: async () => ({ ok: true, projectId: "demo-project" }),
    ...overrides,
  };
  return { api: api as unknown as ComplyraApi, calls };
}

test("adapter: upload statuses map onto the review queue states", async () => {
  const { api } = fakeApi();
  const docs = getDocumentsApi(api, { resolveIndividualName: () => "Jodie Williams" });
  const cases = [
    ["uploaded", "uploading"],
    ["extracting", "extracting"],
    ["extracted", "ready_for_review"],
    ["in_review", "ready_for_review"],
    ["approved", "approved"],
    ["activated", "approved"],
    ["rejected", "rejected"],
  ];
  for (const [backend, expected] of cases) {
    const { api: a } = fakeApi({
      listDocumentUploads: async () => [{ ...ADAPTER_UPLOAD, status: backend }],
    });
    const d = getDocumentsApi(a);
    const ex = (await d.getExtraction("upload-1"))!;
    assert.equal(ex.status, expected, `backend ${backend}`);
  }
  assert.equal(docs !== null, true);
});

test("adapter: getExtraction returns null before the extraction row exists", async () => {
  const { api } = fakeApi({ getDocumentExtraction: async () => null });
  const docs = getDocumentsApi(api);
  assert.equal(await docs.getExtraction("upload-1"), null);
});

test("adapter: item kinds and statuses map; missing_signature -> review_task", async () => {
  const { api } = fakeApi({
    getDocumentExtraction: async () => ({
      extraction: {
        id: "ext-1", agencyId: "agency-1", uploadId: "upload-1", schemaVersion: 1,
        extractedData: ADAPTER_EXTRACTION_DATA, confidence: {}, model: "m", createdAt: "2026-09-14T10:01:00.000Z",
      },
      items: [
        adapterItem({ id: "i1", itemType: "missing_signature", status: "proposed" }),
        adapterItem({ id: "i2", itemType: "protocol_needs_delegation", status: "edited" }),
        adapterItem({ id: "i3", itemType: "other", status: "removed" }),
      ],
    }),
  });
  const docs = getDocumentsApi(api);
  const ex = (await docs.getExtraction("upload-1"))!;
  const byId = Object.fromEntries(ex.items.map((i) => [i.id, i]));
  assert.equal(byId.i1.kind, "review_task");
  assert.equal(byId.i1.status, "proposed");
  assert.equal(byId.i2.kind, "protocol_needs_delegation");
  assert.equal(byId.i2.status, "proposed");
  assert.equal(byId.i3.kind, "review_task");
  assert.equal(byId.i3.status, "dismissed");
  // No name resolver -> falls back to the individual id.
  assert.equal(ex.individualName, "ind-1");
});

test("adapter: detail JSON round-trips through the review form", async () => {
  const { api, calls } = fakeApi();
  const docs = getDocumentsApi(api);
  const ex = (await docs.getExtraction("upload-1"))!;
  // { description } unwraps to the plain string for editing...
  assert.equal(ex.items[0].detail, "Annual review date stated in the PCSP.");
  // ...and plain prose wraps back as { text } on save.
  const updated = await docs.updateTrackableItem("item-1", { title: "Renamed", detail: "New prose detail", dueDate: null });
  const [, , patch] = calls.find(([name]) => name === "updateTrackableItem")!;
  assert.deepEqual(patch.detail, { text: "New prose detail" });
  assert.equal(updated.title, "Renamed");
});

test("adapter: update with status dismissed removes the item", async () => {
  const { api, calls } = fakeApi();
  const docs = getDocumentsApi(api);
  await docs.getExtraction("upload-1"); // populate item context
  const removed = await docs.updateTrackableItem("item-1", { status: "dismissed" });
  assert.equal(removed.status, "dismissed");
  assert.ok(calls.some(([name]) => name === "removeTrackableItem"));
  assert.ok(!calls.some(([name]) => name === "updateTrackableItem"));
});

test("adapter: the v1 PCSP schema maps into review sections with confidence", async () => {
  const { api } = fakeApi();
  const docs = getDocumentsApi(api);
  const ex = (await docs.getExtraction("upload-1"))!;
  assert.equal(ex.structured.individualName.value, "Jodie Williams");
  assert.equal(ex.structured.individualName.confidence, 0.9);
  assert.equal(ex.structured.planEndDate.value, "2027-09-13");
  assert.equal(ex.structured.annualReviewDate.value, "2027-08-14");
  assert.equal(ex.structured.outcomes[0].title, "Community participation");
  assert.equal(ex.structured.outcomes[0].confidence, 0.85);
  assert.equal(ex.structured.protocols[0].title, "Seizure protocol");
  assert.equal(ex.structured.dietary[0].title, "High fiber diet.");
  assert.equal(ex.structured.behavioralSupports.length, 0);
  assert.equal(ex.structured.trainingRequirements[0].title, "Seizure protocol");
  assert.equal(ex.structured.physicianOrders[0].title, "Multivitamin daily");
  assert.equal(ex.structured.signatures.length, 1);
  assert.equal(ex.structured.signatures[0].signed, false);
});

test("adapter: annual physician order maps orders + physician signature", async () => {
  const apoData = {
    individual: { full_name: "Jodie Williams", date_of_birth: null, medicaid_id: null, confidence: 0.8 },
    order_date: "2026-09-01",
    expiry_date: "2027-09-01",
    orders: [{ description: "Lisinopril 10mg daily", frequency: "daily", confidence: 0.9 }],
    physician: { name: "Dr. Smith", signature_present: true, confidence: 0.95 },
  };
  const { api } = fakeApi({
    listDocumentUploads: async () => [{ ...ADAPTER_UPLOAD, documentType: "annual_physician_order" }],
    getDocumentExtraction: async () => ({
      extraction: {
        id: "ext-1", agencyId: "agency-1", uploadId: "upload-1", schemaVersion: 1,
        extractedData: apoData, confidence: {}, model: "m", createdAt: "2026-09-14T10:01:00.000Z",
      },
      items: [],
    }),
  });
  const docs = getDocumentsApi(api);
  const ex = (await docs.getExtraction("upload-1"))!;
  assert.equal(ex.documentType, "annual_physician_order");
  assert.equal(ex.structured.planEndDate.value, "2027-09-01");
  assert.equal(ex.structured.physicianOrders[0].title, "Lisinopril 10mg daily");
  assert.equal(ex.structured.physicianOrders[0].detail, "daily");
  assert.equal(ex.structured.signatures[0].role, "Physician");
  assert.equal(ex.structured.signatures[0].signed, true);
});

test("adapter: reviewer-added items resolve the extraction id from the upload", async () => {
  const { api, calls } = fakeApi();
  const docs = getDocumentsApi(api);
  const created = await docs.addTrackableItem("upload-1", {
    kind: "review_task",
    title: "Hand-added note",
    detail: "Follow up",
    dueDate: null,
  });
  const [, input] = calls.find(([name]) => name === "addTrackableItem")!;
  assert.equal(input.extractionId, "ext-1");
  assert.equal(input.itemType, "other");
  assert.equal(created.kind, "review_task");
  assert.equal(created.status, "proposed");
});

test("adapter: upload falls back to the scripted demo extraction when hosted-only", async () => {
  const { api, calls } = fakeApi();
  const docs = getDocumentsApi(api);
  const bytes = Buffer.from("fake-pdf-bytes").toString("base64");
  const { uploadId } = await docs.uploadDocument({
    individualId: "ind-1",
    documentType: "pcsp",
    fileName: "pcsp.pdf",
    contentType: "application/pdf",
    fileBytesBase64: bytes,
    extractedText: "plan text",
    extractedCharCount: 9,
    textTruncated: false,
  });
  assert.equal(uploadId, "upload-1");
  assert.ok(calls.some(([name]) => name === "simulatePcspExtraction"));
});

test("adapter: AI settings map; service account status derives from last verification", async () => {
  const { api, calls } = fakeApi();
  const docs = getDocumentsApi(api);
  const settings = await docs.getAiSettings();
  assert.equal(settings.model, "gemini-2.5-flash");
  assert.equal(settings.serviceAccountStatus, "configured");
  assert.equal(settings.serviceAccountVerifiedAt, "2026-09-14T09:00:00.000Z");
  assert.equal(settings.vertexProjectId, "demo-project");
  assert.equal(aiServiceAccountStatusLabel(settings), "Configured — verified 2026-09-14");
  const saved = await docs.setAiSettings({ model: "gemini-2.5-pro" });
  const [, input] = calls.find(([name]) => name === "setAgencyAiSettings")!;
  assert.equal(input.model, "gemini-2.5-pro");
  assert.equal(input.enabled, true); // preserves the current flag
  assert.equal(saved.serviceAccountStatus, "not_configured"); // never verified under the new model
  assert.equal(saved.vertexProjectId, null);
  assert.equal(aiServiceAccountStatusLabel(saved), "Not configured");
  const verified = await docs.verifyAiServiceAccount();
  assert.equal(verified.ok, true);
  assert.equal(verified.projectId, "demo-project");
});

test("annual physician order review sections use order wording, not PCSP labels", () => {
  const apoDates = extractionDatesSection("annual_physician_order");
  assert.equal(apoDates.title, "Individual & order dates");
  assert.deepEqual(
    apoDates.rows.map((r) => r.label),
    ["Individual", "Order date", "Order expiry"],
  );
  const apoLists = extractionListSections("annual_physician_order");
  assert.deepEqual(
    apoLists.map((l) => l.title),
    ["Orders"],
  );

  const pcspDates = extractionDatesSection("pcsp");
  assert.equal(pcspDates.title, "Individual & plan dates");
  assert.deepEqual(
    pcspDates.rows.map((r) => r.label),
    ["Individual", "Plan start", "Plan end", "Annual review"],
  );
  const pcspLists = extractionListSections("pcsp");
  assert.ok(pcspLists.some((l) => l.title === "Outcomes & goals"));
  assert.ok(pcspLists.some((l) => l.title === "Physician orders"));
});
