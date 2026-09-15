/**
 * PCSP document-ingestion domain layer (frontend workstream).
 *
 * Covers the AI document pipeline:
 *  1. An admin/DPM uploads a PCSP (or annual physician order). The browser
 *     extracts plain text client-side (see extractText.ts) so only TEXT —
 *     never raw files — is sent for AI processing (PHI minimization). The
 *     raw bytes are stored in the `pcsp-documents` storage bucket for
 *     retention.
 *  2. The `extract-pcsp` edge function returns structured data plus proposed
 *     trackable items.
 *  3. A DPM/RN reviews side-by-side, edits items, then approves or rejects.
 *     NOTHING becomes tracked or visible to staff before approval — the UI
 *     gates every mutating action on the extraction status.
 *  4. Approved items are activated one by one, wiring into existing systems
 *     (delegation training drafts, deadlines/risks via src/data/riskSources).
 *
 * Backend contract: the real document surface lives on ComplyraApi
 * (src/data/localApi, implemented by the local demo store and the hosted
 * Supabase API). `getDocumentsApi(api, opts)` adapts it onto the view
 * models in this module — components must use the adapter, never cast the
 * raw api. Assumed names from the early UI draft (uploadDocument,
 * getExtraction, listUploads, updateTrackableItem, approveExtraction,
 * activateTrackableItem, rejectUpload, getAiSettings, setAiSettings,
 * verifyAiServiceAccount, addTrackableItem) are preserved as the adapter's method
 * names so the UI code below is unchanged.
 *
 * Permissions: `documents.upload` gates upload (admin/DPM); `documents.review`
 * gates review (admin/DPM/RN). `documents.review` is owned by the backend
 * workstream — it is referenced by string here so this UI does not touch the
 * shared permissions.ts.
 */
import type { SessionUser } from "../../data/types";
import { can } from "../../data/status";
import type { PermissionKey } from "../../data/permissions";

/** Owned by the backend workstream; referenced by string until merged. */
const DOCUMENTS_REVIEW = "documents.review" as PermissionKey;

export function canUploadDocuments(session: SessionUser | null): boolean {
  return !!session && can(session, "documents.upload");
}

export function canReviewDocuments(session: SessionUser | null): boolean {
  return !!session && can(session, DOCUMENTS_REVIEW);
}

export function canManageAiSettings(session: SessionUser | null): boolean {
  // Vertex / model / verify are platform-operator only — not agency admins
  // and not anyone who happens to hold roles.manage.
  return Boolean(session?.platformAdmin);
}

/* ------------------------------------------------------------------ */
/* BAA gate — single source of truth for the blocking notice copy.      */
/* ------------------------------------------------------------------ */

/**
 * Shown (and blocking) whenever the agency's `ai_processing_enabled` is off.
 * Asserted verbatim by tests — keep the wording stable.
 */
export const AI_BAA_REQUIRED_COPY =
  "AI document processing is disabled for your agency. A signed Google BAA is required before processing documents containing personal health information.";

/* ------------------------------------------------------------------ */
/* Document types                                                      */
/* ------------------------------------------------------------------ */

export type DocumentType = "pcsp" | "annual_physician_order";

export const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: "pcsp", label: "PCSP (person-centered support plan)" },
  { value: "annual_physician_order", label: "Annual physician order" },
];

export function documentTypeLabel(type: DocumentType): string {
  return DOCUMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

/* ------------------------------------------------------------------ */
/* Upload / extraction status machine                                  */
/* ------------------------------------------------------------------ */

export type UploadStatus =
  | "uploading"
  | "extracting"
  | "ready_for_review"
  | "approved"
  | "rejected";

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  uploading: "Uploading",
  extracting: "Extracting",
  ready_for_review: "Ready for review",
  approved: "Approved",
  rejected: "Rejected",
};

export function uploadStatusLabel(status: UploadStatus): string {
  return UPLOAD_STATUS_LABELS[status];
}

/**
 * Allowed transitions. `extracting -> rejected` is the machine path for a
 * failed extraction (reason recorded); `ready_for_review -> approved |
 * rejected` is the human review decision. Terminal states have no exits.
 */
const UPLOAD_TRANSITIONS: Record<UploadStatus, UploadStatus[]> = {
  uploading: ["extracting"],
  extracting: ["ready_for_review", "rejected"],
  ready_for_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function allowedUploadTransitions(from: UploadStatus): UploadStatus[] {
  return [...UPLOAD_TRANSITIONS[from]];
}

export function canTransitionUpload(
  from: UploadStatus,
  to: UploadStatus,
): boolean {
  return UPLOAD_TRANSITIONS[from].includes(to);
}

export function isTerminalUploadStatus(status: UploadStatus): boolean {
  return UPLOAD_TRANSITIONS[status].length === 0;
}

/* ------------------------------------------------------------------ */
/* Trackable items                                                     */
/* ------------------------------------------------------------------ */

export type TrackableItemKind =
  | "protocol_needs_delegation"
  | "physician_order"
  | "training_requirement"
  | "deadline"
  | "review_task";

export const TRACKABLE_ITEM_KIND_LABELS: Record<TrackableItemKind, string> = {
  protocol_needs_delegation: "Protocol — needs delegation",
  physician_order: "Physician order",
  training_requirement: "Training requirement",
  deadline: "Deadline",
  review_task: "Review task",
};

export function trackableItemKindLabel(kind: TrackableItemKind): string {
  return TRACKABLE_ITEM_KIND_LABELS[kind] ?? kind;
}

export type TrackableItemStatus = "proposed" | "activated" | "dismissed";

export const TRACKABLE_ITEM_STATUS_LABELS: Record<TrackableItemStatus, string> = {
  proposed: "Proposed",
  activated: "Activated",
  dismissed: "Removed",
};

export interface TrackableItem {
  id: string;
  uploadId: string;
  individualId: string;
  kind: TrackableItemKind;
  title: string;
  detail: string;
  /** ISO date (YYYY-MM-DD) or null. */
  dueDate: string | null;
  /** 0..1 when the model reported one. */
  confidence?: number | null;
  status: TrackableItemStatus;
  delegationAssignmentId?: string | null;
}

/* ------------------------------------------------------------------ */
/* Confidence                                                          */
/* ------------------------------------------------------------------ */

/** Below this the UI flags a field "Needs human check" (icon + text). */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export type ConfidenceBand = "high" | "medium" | "low" | "unknown";

export function confidenceBand(confidence?: number | null): ConfidenceBand {
  if (confidence == null || Number.isNaN(confidence)) return "unknown";
  if (confidence >= 0.85) return "high";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

export function confidenceLabel(confidence?: number | null): string {
  switch (confidenceBand(confidence)) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "low":
      return "Low confidence";
    case "unknown":
      return "No confidence score";
  }
}

/** True when the field must be flagged "Needs human check" (icon + text). */
export function needsHumanCheck(confidence?: number | null): boolean {
  return confidence != null && confidence < LOW_CONFIDENCE_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* Extraction shape                                                    */
/* ------------------------------------------------------------------ */

export interface ExtractedField<T> {
  value: T;
  confidence?: number | null;
}

export interface ExtractionListItem {
  title: string;
  detail?: string;
  confidence?: number | null;
}

export interface ExtractionSignature {
  role: string;
  name?: string;
  signed: boolean;
  signedAt?: string;
  confidence?: number | null;
}

/** A signature the model could not find in the document. */
export function isMissingSignature(sig: ExtractionSignature): boolean {
  return !sig.signed;
}

export interface ExtractedStructuredData {
  individualName: ExtractedField<string>;
  planStartDate: ExtractedField<string | null>;
  planEndDate: ExtractedField<string | null>;
  annualReviewDate: ExtractedField<string | null>;
  outcomes: ExtractionListItem[];
  protocols: ExtractionListItem[];
  dietary: ExtractionListItem[];
  behavioralSupports: ExtractionListItem[];
  trainingRequirements: ExtractionListItem[];
  physicianOrders: ExtractionListItem[];
  signatures: ExtractionSignature[];
}

export interface PcspExtraction {
  uploadId: string;
  individualId: string;
  individualName: string;
  documentType: DocumentType;
  fileName: string;
  status: UploadStatus;
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  structured: ExtractedStructuredData;
  items: TrackableItem[];
}

export interface DocumentUploadSummary {
  uploadId: string;
  individualId: string;
  individualName: string;
  documentType: DocumentType;
  fileName: string;
  status: UploadStatus;
  createdAt: string;
}

/** Review-page section wording, driven by document type so an annual
 *  physician order never shows PCSP labels ("Plan start", "Outcomes"). */
export type StructuredDateField =
  | "individualName"
  | "planStartDate"
  | "planEndDate"
  | "annualReviewDate";

export function extractionDatesSection(documentType: DocumentType): {
  title: string;
  rows: Array<{ label: string; field: StructuredDateField }>;
} {
  if (documentType === "annual_physician_order") {
    return {
      title: "Individual & order dates",
      rows: [
        { label: "Individual", field: "individualName" },
        { label: "Order date", field: "planStartDate" },
        { label: "Order expiry", field: "planEndDate" },
      ],
    };
  }
  return {
    title: "Individual & plan dates",
    rows: [
      { label: "Individual", field: "individualName" },
      { label: "Plan start", field: "planStartDate" },
      { label: "Plan end", field: "planEndDate" },
      { label: "Annual review", field: "annualReviewDate" },
    ],
  };
}

export interface ExtractionListSection {
  title: string;
  key:
    | "outcomes"
    | "protocols"
    | "dietary"
    | "behavioralSupports"
    | "trainingRequirements"
    | "physicianOrders";
  emptyText: string;
}

/** Which extracted-data list sections the review page renders. An annual
 *  physician order shows only its orders — the PCSP sections do not apply. */
export function extractionListSections(
  documentType: DocumentType,
): ExtractionListSection[] {
  if (documentType === "annual_physician_order") {
    return [
      { title: "Orders", key: "physicianOrders", emptyText: "No orders extracted." },
    ];
  }
  return [
    { title: "Outcomes & goals", key: "outcomes", emptyText: "No outcomes extracted." },
    { title: "Protocols", key: "protocols", emptyText: "No protocols extracted." },
    { title: "Dietary", key: "dietary", emptyText: "No dietary items extracted." },
    {
      title: "Behavioral supports",
      key: "behavioralSupports",
      emptyText: "No behavioral supports extracted.",
    },
    {
      title: "Training requirements",
      key: "trainingRequirements",
      emptyText: "No training requirements extracted.",
    },
    {
      title: "Physician orders",
      key: "physicianOrders",
      emptyText: "No physician orders extracted.",
    },
  ];
}

/* ------------------------------------------------------------------ */
/* AI settings                                                         */
/* ------------------------------------------------------------------ */

export interface AiSettings {
  model: string;
  serviceAccountStatus: "configured" | "not_configured";
  serviceAccountVerifiedAt: string | null;
  /** GCP project id recorded at verification (Vertex AI). */
  vertexProjectId: string | null;
  aiProcessingEnabled: boolean;
}

/** Human-readable service-account status — no credential is ever displayed. */
export function aiServiceAccountStatusLabel(settings: AiSettings): string {
  // The app cannot inspect the server-side service-account secret: the only
  // honest signal is whether a verification succeeded and was recorded.
  if (settings.serviceAccountVerifiedAt) {
    return `Configured — verified ${settings.serviceAccountVerifiedAt.slice(0, 10)}`;
  }
  return "Not configured";
}

/* ------------------------------------------------------------------ */
/* Adapter input types                                                  */
/* ------------------------------------------------------------------ */

export interface UploadDocumentInput {
  individualId: string;
  documentType: DocumentType;
  fileName: string;
  contentType: string;
  /** Raw file bytes (base64) — stored in the `pcsp-documents` bucket. */
  fileBytesBase64: string;
  /**
   * Client-extracted plain text — the ONLY thing sent to the AI model.
   * Truncated to MAX_EXTRACT_CHARS client-side before upload.
   */
  extractedText: string;
  extractedCharCount: number;
  textTruncated: boolean;
}

export interface UpdateTrackableItemPatch {
  title?: string;
  detail?: string;
  dueDate?: string | null;
  /** Remove = dismiss. */
  status?: "dismissed";
}

export interface AddTrackableItemInput {
  kind: TrackableItemKind;
  title: string;
  detail: string;
  dueDate: string | null;
}

export interface VerifyAiServiceAccountResult {
  ok: boolean;
  serviceAccountVerifiedAt: string | null;
  projectId: string | null;
  error?: string;
}

/**
 * The UI-facing document contract. Implemented by getDocumentsApi() below
 * on top of the real ComplyraApi; the method names mirror the early UI
 * draft so the components below are unchanged.
 */
export interface DocumentsLibraryApi {
  uploadDocument(input: UploadDocumentInput): Promise<{ uploadId: string }>;
  getExtraction(uploadId: string): Promise<PcspExtraction | null>;
  listUploads(filter?: { individualId?: string }): Promise<DocumentUploadSummary[]>;
  updateTrackableItem(
    itemId: string,
    patch: UpdateTrackableItemPatch,
  ): Promise<TrackableItem>;
  addTrackableItem(
    uploadId: string,
    input: AddTrackableItemInput,
  ): Promise<TrackableItem>;
  activateTrackableItem(itemId: string): Promise<TrackableItem>;
  approveExtraction(uploadId: string): Promise<PcspExtraction>;
  rejectUpload(uploadId: string, reason: string): Promise<void>;
  getAiSettings(): Promise<AiSettings>;
  setAiSettings(patch: { model: string }): Promise<AiSettings>;
  verifyAiServiceAccount(): Promise<VerifyAiServiceAccountResult>;
}

/* ------------------------------------------------------------------ */
/* Backend adapter                                                      */
/*                                                                      */
/* The real document surface lives on ComplyraApi (src/data/localApi,  */
/* implemented by the local demo store and the hosted Supabase API).   */
/* This adapter maps it onto the view models above so UI components    */
/* never touch backend shapes directly. Components must call            */
/* getDocumentsApi(api, opts) — never cast the raw api.                 */
/* ------------------------------------------------------------------ */

import type { ComplyraApi } from "../../data/localApi";
import type {
  DocumentStatus,
  DocumentUpload as BackendDocumentUpload,
  TrackableItem as BackendTrackableItem,
  TrackableItemType,
  TrackableItemStatus as BackendItemStatus,
  PcspExtraction as BackendPcspExtraction,
  AnnualPhysicianOrderExtraction,
} from "../../data/documents";
import type {
  LocalDocumentExtraction,
  LocalAgencyAiSettings,
} from "../../data/seed";

export interface DocumentsAdapterOptions {
  /** Resolve an individual display name for queue/review rows. */
  resolveIndividualName?: (individualId: string) => string | undefined;
}

/* ------------------------- status / type maps ----------------------- */

function mapUploadStatus(status: DocumentStatus): UploadStatus {
  switch (status) {
    case "uploaded":
      return "uploading";
    case "extracting":
      return "extracting";
    case "extracted":
    case "in_review":
      return "ready_for_review";
    case "approved":
    case "activated":
      return "approved";
    case "rejected":
      return "rejected";
  }
}

function mapItemTypeToKind(itemType: TrackableItemType): TrackableItemKind {
  switch (itemType) {
    case "protocol_needs_delegation":
      return "protocol_needs_delegation";
    case "physician_order":
      return "physician_order";
    case "training_requirement":
      return "training_requirement";
    case "deadline":
      return "deadline";
    case "missing_signature":
    case "other":
      return "review_task";
  }
}

function mapKindToItemType(kind: TrackableItemKind): TrackableItemType {
  switch (kind) {
    case "protocol_needs_delegation":
      return "protocol_needs_delegation";
    case "physician_order":
      return "physician_order";
    case "training_requirement":
      return "training_requirement";
    case "deadline":
      return "deadline";
    case "review_task":
      return "other";
  }
}

/**
 * Backend items move proposed -> edited -> approved -> activated; the review
 * UI only distinguishes "still actionable" from "activated" / "removed".
 */
function mapItemStatus(status: BackendItemStatus): TrackableItemStatus {
  if (status === "removed") return "dismissed";
  if (status === "activated") return "activated";
  return "proposed";
}

/** Backend jsonb detail -> the single string the review form edits. */
function detailToString(detail: Record<string, unknown>): string {
  const d = detail ?? {};
  const keys = Object.keys(d);
  if (keys.length === 0) return "";
  if (keys.length === 1 && typeof d.text === "string") return d.text;
  if (keys.length === 1 && typeof d.description === "string")
    return d.description;
  return JSON.stringify(d);
}

/**
 * Review-form string -> backend jsonb detail. JSON the model wrote
 * round-trips untouched; plain prose is wrapped as { text }.
 */
function stringToDetail(detail: string): Record<string, unknown> {
  const trimmed = detail.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not JSON — wrapped below */
  }
  return { text: detail };
}

/* --------------------- structured extraction map -------------------- */

function extractedField<T>(
  value: T,
  confidence?: number | null,
): ExtractedField<T> {
  return { value, confidence: confidence ?? null };
}

/**
 * Backend snake_case extraction (schema v1) -> the flattened sections the
 * review page renders. Annual physician orders reuse the same sections;
 * sections the schema has no data for simply render empty.
 */
function mapStructuredData(
  data: BackendPcspExtraction | AnnualPhysicianOrderExtraction,
  documentType: DocumentType,
): ExtractedStructuredData {
  if (documentType === "annual_physician_order") {
    const apo = data as AnnualPhysicianOrderExtraction;
    return {
      individualName: extractedField(
        apo.individual?.full_name?.trim() || "Unknown",
        apo.individual?.confidence ?? null,
      ),
      planStartDate: extractedField(apo.order_date ?? null, null),
      planEndDate: extractedField(apo.expiry_date ?? null, null),
      annualReviewDate: extractedField(apo.expiry_date ?? null, null),
      outcomes: [],
      protocols: [],
      dietary: [],
      behavioralSupports: [],
      trainingRequirements: [],
      physicianOrders: (apo.orders ?? []).map((o) => ({
        title: o.description?.trim() || "Physician order",
        detail: o.frequency?.trim() || undefined,
        confidence: o.confidence ?? null,
      })),
      signatures: apo.physician
        ? [
            {
              role: "Physician",
              name: apo.physician.name ?? undefined,
              signed: apo.physician.signature_present ?? false,
              confidence: apo.physician.confidence ?? null,
            },
          ]
        : [],
    };
  }
  const pcsp = data as BackendPcspExtraction;
  return {
    individualName: extractedField(
      pcsp.individual?.full_name?.trim() || "Unknown",
      pcsp.individual?.confidence ?? null,
    ),
    planStartDate: extractedField(
      pcsp.plan?.effective_date ?? null,
      pcsp.plan?.confidence ?? null,
    ),
    planEndDate: extractedField(
      pcsp.plan?.expiry_date ?? null,
      pcsp.plan?.confidence ?? null,
    ),
    annualReviewDate: extractedField(
      pcsp.plan?.annual_review_due_date ?? null,
      pcsp.plan?.confidence ?? null,
    ),
    outcomes: (pcsp.outcomes ?? []).map((o) => ({
      title: o.title?.trim() || "Outcome",
      detail:
        [o.description?.trim(), (o.support_strategies ?? []).filter(Boolean).join("; ")]
          .filter(Boolean)
          .join(" — ") || undefined,
      confidence: o.confidence ?? null,
    })),
    protocols: (pcsp.protocols_referenced ?? []).map((p) => ({
      title: p.name?.trim() || "Protocol",
      detail: p.category?.trim() || undefined,
      confidence: p.confidence ?? null,
    })),
    dietary: pcsp.dietary?.description?.trim()
      ? [
          {
            title: pcsp.dietary.description.trim(),
            confidence: pcsp.dietary.confidence ?? null,
          },
        ]
      : [],
    behavioralSupports: pcsp.behavioral_supports?.description?.trim()
      ? [
          {
            title: pcsp.behavioral_supports.description.trim(),
            confidence: pcsp.behavioral_supports.confidence ?? null,
          },
        ]
      : [],
    trainingRequirements: (pcsp.staff_training_requirements ?? []).map((t) => ({
      title: t.topic?.trim() || "Training requirement",
      detail: t.due_date?.trim() ? `Due ${t.due_date.trim()}` : undefined,
      confidence: t.confidence ?? null,
    })),
    physicianOrders: (pcsp.physician_orders ?? []).map((o) => ({
      title: o.description?.trim() || "Physician order",
      detail: o.date?.trim() ? `Dated ${o.date.trim()}` : undefined,
      confidence: o.confidence ?? null,
    })),
    signatures: (pcsp.signatures ?? []).map((s) => ({
      role: s.role?.trim() || "Unknown role",
      name: s.name ?? undefined,
      signed: s.signed ?? false,
      signedAt: s.date ?? undefined,
    })),
  };
}

function emptyStructured(name: string): ExtractedStructuredData {
  return {
    individualName: extractedField(name, null),
    planStartDate: extractedField<string | null>(null, null),
    planEndDate: extractedField<string | null>(null, null),
    annualReviewDate: extractedField<string | null>(null, null),
    outcomes: [],
    protocols: [],
    dietary: [],
    behavioralSupports: [],
    trainingRequirements: [],
    physicianOrders: [],
    signatures: [],
  };
}

interface ItemContext {
  uploadId: string;
  individualId: string;
  /** Last title the adapter saw — the backend patch requires a title. */
  title: string;
}

function mapTrackableItem(
  item: BackendTrackableItem,
  ctx: ItemContext,
): TrackableItem {
  return {
    id: item.id,
    uploadId: ctx.uploadId,
    individualId: ctx.individualId,
    kind: mapItemTypeToKind(item.itemType),
    title: item.title,
    detail: detailToString(item.detail),
    dueDate: item.dueDate,
    confidence: item.confidence ?? null,
    status: mapItemStatus(item.status),
    delegationAssignmentId: null,
  };
}

function mapExtraction(
  upload: BackendDocumentUpload,
  extraction: LocalDocumentExtraction | null,
  items: TrackableItem[],
  opts: DocumentsAdapterOptions,
): PcspExtraction {
  const name = opts.resolveIndividualName?.(upload.individualId);
  return {
    uploadId: upload.id,
    individualId: upload.individualId,
    individualName: name ?? upload.individualId,
    documentType: upload.documentType,
    fileName: upload.originalFilename,
    status: mapUploadStatus(upload.status),
    // The backend records the rejection reason on the audit log, not the
    // upload row; the review queue shows the terminal status.
    rejectionReason: null,
    createdAt: upload.uploadedAt,
    reviewedAt: null,
    reviewedBy: null,
    structured: extraction
      ? mapStructuredData(extraction.extractedData, upload.documentType)
      : emptyStructured(name ?? "Unknown"),
    items,
  };
}

function mapUploadSummary(
  upload: BackendDocumentUpload,
  opts: DocumentsAdapterOptions,
): DocumentUploadSummary {
  return {
    uploadId: upload.id,
    individualId: upload.individualId,
    individualName:
      opts.resolveIndividualName?.(upload.individualId) ?? upload.individualId,
    documentType: upload.documentType,
    fileName: upload.originalFilename,
    status: mapUploadStatus(upload.status),
    createdAt: upload.uploadedAt,
  };
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: contentType });
}

function mapAiSettings(s: LocalAgencyAiSettings): AiSettings {
  return {
    model: s.model,
    // The service-account JSON is never stored or readable; a successful
    // verification timestamp is the only signal the API exposes — report
    // "configured", never claim a credential is present.
    serviceAccountStatus: s.serviceAccountVerifiedAt ? "configured" : "not_configured",
    serviceAccountVerifiedAt: s.serviceAccountVerifiedAt,
    vertexProjectId: s.vertexProjectId,
    aiProcessingEnabled: s.aiProcessingEnabled,
  };
}

/**
 * Build the DocumentsLibraryApi the UI components consume from the real
 * ComplyraApi.
 *
 * Upload flow: the raw bytes go to the private `pcsp-documents` bucket, the
 * upload row is registered, then extraction is invoked with the
 * client-extracted text — the text is the ONLY thing sent to the AI model.
 * The caller polls getExtraction() (null until the extraction row exists).
 */
export function getDocumentsApi(
  api: ComplyraApi,
  opts: DocumentsAdapterOptions = {},
): DocumentsLibraryApi {
  // itemId -> owning upload/individual/title. The backend item carries only
  // an extraction id, so the adapter remembers the context it mapped; this
  // also supplies the title the backend update patch requires.
  const itemContext = new Map<string, ItemContext>();
  // uploadId -> extractionId, for reviewer-added items.
  const extractionForUpload = new Map<string, string>();

  function contextFor(
    upload: BackendDocumentUpload,
    item: BackendTrackableItem,
  ): ItemContext {
    const ctx: ItemContext = {
      uploadId: upload.id,
      individualId: upload.individualId,
      title: item.title,
    };
    itemContext.set(item.id, ctx);
    return ctx;
  }

  async function findUpload(
    uploadId: string,
  ): Promise<BackendDocumentUpload | undefined> {
    const uploads = await api.listDocumentUploads();
    return uploads.find((u) => u.id === uploadId);
  }

  async function reloadExtraction(uploadId: string): Promise<PcspExtraction> {
    const payload = await api.getDocumentExtraction(uploadId);
    if (!payload) throw new Error("Extraction not found.");
    const upload = await findUpload(uploadId);
    if (!upload) throw new Error("The upload could not be found.");
    extractionForUpload.set(uploadId, payload.extraction.id);
    const items = payload.items.map((i) =>
      mapTrackableItem(i, contextFor(upload, i)),
    );
    return mapExtraction(upload, payload.extraction, items, opts);
  }

  const docs: DocumentsLibraryApi = {
    async uploadDocument(
      input: UploadDocumentInput,
    ): Promise<{ uploadId: string }> {
      const upload = await api.registerDocumentUpload({
        individualId: input.individualId,
        documentType: input.documentType,
        originalFilename: input.fileName,
        mimeType: input.contentType,
        file: base64ToBlob(input.fileBytesBase64, input.contentType),
      });
      try {
        await api.extractDocumentUpload(upload.id, input.extractedText);
      } catch (err) {
        // The local/demo backend has no Gemini key: extractDocumentUpload
        // throws a hosted-only error there. Run the scripted demo
        // extraction instead so the review UI is demoable end to end.
        if (/hosted-only/i.test((err as Error)?.message ?? "")) {
          await api.simulatePcspExtraction(upload.id);
        } else {
          throw err;
        }
      }
      return { uploadId: upload.id };
    },

    async getExtraction(uploadId: string): Promise<PcspExtraction | null> {
      try {
        return await reloadExtraction(uploadId);
      } catch (err) {
        // No extraction row yet — still uploading/extracting. The caller polls.
        if (/not found/i.test((err as Error)?.message ?? "")) return null;
        throw err;
      }
    },

    async listUploads(
      filter?: { individualId?: string },
    ): Promise<DocumentUploadSummary[]> {
      const uploads = await api.listDocumentUploads(filter);
      return uploads.map((u) => mapUploadSummary(u, opts));
    },

    async updateTrackableItem(
      itemId: string,
      patch: UpdateTrackableItemPatch,
    ): Promise<TrackableItem> {
      if (patch.status === "dismissed") {
        const removed = await api.removeTrackableItem(itemId);
        const ctx = itemContext.get(itemId) ?? {
          uploadId: "",
          individualId: "",
          title: removed.title,
        };
        return mapTrackableItem(removed, ctx);
      }
      const cached = itemContext.get(itemId);
      const title = patch.title ?? cached?.title;
      if (!title) throw new Error("A title is required to save the item.");
      const updated = await api.updateTrackableItem(itemId, {
        title,
        detail:
          patch.detail !== undefined
            ? stringToDetail(patch.detail)
            : undefined,
        dueDate: patch.dueDate,
      });
      const ctx: ItemContext = {
        uploadId: cached?.uploadId ?? "",
        individualId: cached?.individualId ?? "",
        title: updated.title,
      };
      itemContext.set(itemId, ctx);
      return mapTrackableItem(updated, ctx);
    },

    async addTrackableItem(
      uploadId: string,
      input: AddTrackableItemInput,
    ): Promise<TrackableItem> {
      let extractionId = extractionForUpload.get(uploadId);
      if (!extractionId) {
        const payload = await api.getDocumentExtraction(uploadId);
        if (!payload) throw new Error("Extraction not found.");
        extractionId = payload.extraction.id;
        extractionForUpload.set(uploadId, extractionId);
      }
      const created = await api.addTrackableItem({
        extractionId,
        itemType: mapKindToItemType(input.kind),
        title: input.title,
        detail: stringToDetail(input.detail),
        dueDate: input.dueDate,
      });
      const upload = await findUpload(uploadId);
      const ctx: ItemContext = {
        uploadId,
        individualId: upload?.individualId ?? "",
        title: created.title,
      };
      itemContext.set(created.id, ctx);
      return mapTrackableItem(created, ctx);
    },

    async activateTrackableItem(itemId: string): Promise<TrackableItem> {
      const activated = await api.activateTrackableItem(itemId);
      const cached = itemContext.get(itemId);
      const ctx: ItemContext = {
        uploadId: cached?.uploadId ?? "",
        individualId: cached?.individualId ?? "",
        title: activated.title,
      };
      itemContext.set(itemId, ctx);
      return mapTrackableItem(activated, ctx);
    },

    async approveExtraction(uploadId: string): Promise<PcspExtraction> {
      await api.approveDocumentExtraction(uploadId);
      return reloadExtraction(uploadId);
    },

    async rejectUpload(uploadId: string, reason: string): Promise<void> {
      await api.rejectDocumentUpload(uploadId, reason);
    },

    async getAiSettings(): Promise<AiSettings> {
      return mapAiSettings(await api.getAgencyAiSettings());
    },

    async setAiSettings(patch: { model: string }): Promise<AiSettings> {
      const current = await api.getAgencyAiSettings();
      return mapAiSettings(
        await api.setAgencyAiSettings({
          enabled: current.aiProcessingEnabled,
          model: patch.model,
        }),
      );
    },

    async verifyAiServiceAccount(): Promise<VerifyAiServiceAccountResult> {
      const result = await api.verifyAiServiceAccount();
      const settings = result.ok ? await api.getAgencyAiSettings() : null;
      return {
        ok: result.ok,
        serviceAccountVerifiedAt: settings?.serviceAccountVerifiedAt ?? null,
        projectId: result.projectId ?? settings?.vertexProjectId ?? null,
        error: result.error,
      };
    },
  };

  return docs;
}
