/**
 * PCSP document-extraction pipeline — shared types + pure validation.
 *
 * When an administrator or DPM uploads a PCSP (or annual physician order),
 * the `extract-pcsp` edge function calls Gemini with a strict response
 * schema, records the structured result in `document_extractions`, and
 * proposes one `document_trackable_items` row per deadline / training
 * requirement / protocol / order / missing signature. A DPM/RN then
 * reviews, edits, approves (nothing becomes tracked before approval), and
 * activates each item. Activating a `protocol_needs_delegation` item hands
 * off into the delegation system: a delegation template is ensured,
 * activated for the site, assigned to the individual, and a training draft
 * enters the draft -> review -> approve -> publish loop.
 *
 * validateExtraction() is the shared shape gate: used by tests and the
 * client before anything is trusted. It never throws — it returns
 * { ok: true, value } or { ok: false, errors }.
 */
import { DIGITAL_RECORD_MARK } from "../delegation/delegation";

export const DOCUMENT_DIGITAL_MARK = DIGITAL_RECORD_MARK;

export const DOCUMENT_TYPES = ["pcsp", "annual_physician_order"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = [
  "uploaded",
  "extracting",
  "extracted",
  "in_review",
  "approved",
  "activated",
  "rejected",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const TRACKABLE_ITEM_TYPES = [
  "deadline",
  "training_requirement",
  "protocol_needs_delegation",
  "physician_order",
  "missing_signature",
  "other",
] as const;
export type TrackableItemType = (typeof TRACKABLE_ITEM_TYPES)[number];

export const TRACKABLE_ITEM_STATUSES = [
  "proposed",
  "edited",
  "approved",
  "activated",
  "removed",
] as const;
export type TrackableItemStatus = (typeof TRACKABLE_ITEM_STATUSES)[number];

/** PCSP extraction schema v1 — mirrors the Gemini responseSchema in
 * supabase/functions/extract-pcsp/index.ts. Every field is nullable. */
export interface PcspIndividual {
  full_name: string | null;
  date_of_birth: string | null;
  medicaid_id: string | null;
  confidence?: number | null;
}

export interface PcspPlan {
  effective_date: string | null;
  expiry_date: string | null;
  annual_review_due_date: string | null;
  confidence?: number | null;
}

export interface PcspOutcome {
  title: string | null;
  description: string | null;
  support_strategies?: string[] | null;
  confidence?: number | null;
}

export interface PcspProtocol {
  name: string | null;
  category: string | null;
  confidence?: number | null;
}

export interface PcspTrainingRequirement {
  topic: string | null;
  due_date: string | null;
  confidence?: number | null;
}

export interface PcspPhysicianOrder {
  description: string | null;
  date: string | null;
  confidence?: number | null;
}

export interface PcspSignature {
  role: string | null;
  name: string | null;
  signed: boolean | null;
  date: string | null;
}

export interface PcspExtraction {
  individual?: PcspIndividual | null;
  plan?: PcspPlan | null;
  outcomes?: PcspOutcome[] | null;
  protocols_referenced?: PcspProtocol[] | null;
  dietary?: { description: string | null; confidence?: number | null } | null;
  behavioral_supports?: { description: string | null; confidence?: number | null } | null;
  staff_training_requirements?: PcspTrainingRequirement[] | null;
  physician_orders?: PcspPhysicianOrder[] | null;
  signatures?: PcspSignature[] | null;
}

/** Annual physician order schema (minimal) — mirrors the edge function. */
export interface AnnualPhysicianOrderExtraction {
  individual?: PcspIndividual | null;
  order_date?: string | null;
  expiry_date?: string | null;
  orders?: { description: string | null; frequency: string | null; confidence?: number | null }[] | null;
  physician?: { name: string | null; signature_present: boolean | null; confidence?: number | null } | null;
}

export interface DocumentUpload {
  id: string;
  agencyId: string;
  individualId: string;
  siteId: string;
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  storagePath: string;
  uploadedBy: string | null;
  uploadedAt: string;
  status: DocumentStatus;
}

export interface TrackableItem {
  id: string;
  agencyId: string;
  extractionId: string;
  itemType: TrackableItemType;
  title: string;
  detail: Record<string, unknown>;
  dueDate: string | null;
  confidence: number | null;
  needsHumanCheck: boolean;
  status: TrackableItemStatus;
}

/** The status machine for trackable items. Anything outside "approved" is
 * NOT tracked — this is the client-side mirror of the SQL gate in
 * approve_extraction() / activate_trackable_item(). */
const TRACKABLE_TRANSITIONS: Record<TrackableItemStatus, TrackableItemStatus[]> = {
  proposed: ["edited", "approved", "removed"],
  edited: ["edited", "approved", "removed"],
  approved: ["activated", "removed"],
  activated: ["removed"],
  removed: [],
};

export function canTransitionTrackableItem(
  from: TrackableItemStatus,
  to: TrackableItemStatus,
): boolean {
  return TRACKABLE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Upload lifecycle transitions (client-side mirror of the SQL RPCs). */
const UPLOAD_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  uploaded: ["extracting", "rejected"],
  extracting: ["extracted", "rejected"],
  extracted: ["in_review", "approved", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["activated"],
  activated: [],
  rejected: [],
};

export function canTransitionUpload(from: DocumentStatus, to: DocumentStatus): boolean {
  return UPLOAD_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True once the item counts as "tracked" (visible to line staff). */
export function isTracked(status: TrackableItemStatus): boolean {
  return status === "activated";
}

// ---------------------------------------------------------------------------
// validateExtraction — pure structural gate for AI output
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  value: PcspExtraction | AnnualPhysicianOrderExtraction | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkConfidence(v: unknown, path: string, errors: string[]): void {
  if (v === null || v === undefined) return;
  if (typeof v !== "number" || Number.isNaN(v) || v < 0 || v > 1) {
    errors.push(`${path}.confidence must be a number between 0 and 1 when present`);
  }
}

function checkNullableString(v: unknown, path: string, errors: string[]): void {
  if (v === null || v === undefined) return;
  if (typeof v !== "string") errors.push(`${path} must be a string or null`);
}

function validatePcsp(data: Record<string, unknown>, errors: string[]): PcspExtraction {
  if (data.individual !== undefined && data.individual !== null) {
    if (!isObject(data.individual)) {
      errors.push("individual must be an object or null");
    } else {
      const i = data.individual;
      checkNullableString(i.full_name, "individual.full_name", errors);
      checkNullableString(i.date_of_birth, "individual.date_of_birth", errors);
      checkNullableString(i.medicaid_id, "individual.medicaid_id", errors);
      checkConfidence(i.confidence, "individual", errors);
    }
  }
  if (data.plan !== undefined && data.plan !== null) {
    if (!isObject(data.plan)) {
      errors.push("plan must be an object or null");
    } else {
      const p = data.plan;
      checkNullableString(p.effective_date, "plan.effective_date", errors);
      checkNullableString(p.expiry_date, "plan.expiry_date", errors);
      checkNullableString(p.annual_review_due_date, "plan.annual_review_due_date", errors);
      checkConfidence(p.confidence, "plan", errors);
    }
  }
  const arrayKeys = [
    "outcomes",
    "protocols_referenced",
    "staff_training_requirements",
    "physician_orders",
    "signatures",
  ];
  for (const key of arrayKeys) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) {
      errors.push(`${key} must be an array or null`);
      continue;
    }
    v.forEach((entry, idx) => {
      if (!isObject(entry)) {
        errors.push(`${key}[${idx}] must be an object`);
        return;
      }
      for (const [k, val] of Object.entries(entry)) {
        if (k === "confidence") {
          checkConfidence(val, `${key}[${idx}]`, errors);
        } else if (k === "signed" || k === "signature_present") {
          if (val !== null && val !== undefined && typeof val !== "boolean") {
            errors.push(`${key}[${idx}].${k} must be a boolean or null`);
          }
        } else if (k === "support_strategies") {
          if (val !== null && val !== undefined) {
            if (!Array.isArray(val) || val.some((s) => typeof s !== "string")) {
              errors.push(`${key}[${idx}].support_strategies must be an array of strings or null`);
            }
          }
        } else {
          checkNullableString(val, `${key}[${idx}].${k}`, errors);
        }
      }
    });
  }
  for (const key of ["dietary", "behavioral_supports"]) {
    const v = data[key];
    if (v === undefined || v === null) continue;
    if (!isObject(v)) {
      errors.push(`${key} must be an object or null`);
      continue;
    }
    checkNullableString(v.description, `${key}.description`, errors);
    checkConfidence(v.confidence, key, errors);
  }
  // Ignore unknown top-level keys (forward-compat with schema v2+).
  return data as PcspExtraction;
}

function validateApo(
  data: Record<string, unknown>,
  errors: string[],
): AnnualPhysicianOrderExtraction {
  if (data.individual !== undefined && data.individual !== null) {
    if (!isObject(data.individual)) {
      errors.push("individual must be an object or null");
    } else {
      checkNullableString(data.individual.full_name, "individual.full_name", errors);
      checkConfidence(data.individual.confidence, "individual", errors);
    }
  }
  checkNullableString(data.order_date, "order_date", errors);
  checkNullableString(data.expiry_date, "expiry_date", errors);
  if (data.orders !== undefined && data.orders !== null) {
    if (!Array.isArray(data.orders)) {
      errors.push("orders must be an array or null");
    } else {
      data.orders.forEach((o, idx) => {
        if (!isObject(o)) {
          errors.push(`orders[${idx}] must be an object`);
          return;
        }
        checkNullableString(o.description, `orders[${idx}].description`, errors);
        checkNullableString(o.frequency, `orders[${idx}].frequency`, errors);
        checkConfidence(o.confidence, `orders[${idx}]`, errors);
      });
    }
  }
  if (data.physician !== undefined && data.physician !== null) {
    if (!isObject(data.physician)) {
      errors.push("physician must be an object or null");
    } else {
      checkNullableString(data.physician.name, "physician.name", errors);
      const sp = data.physician.signature_present;
      if (sp !== null && sp !== undefined && typeof sp !== "boolean") {
        errors.push("physician.signature_present must be a boolean or null");
      }
      checkConfidence(data.physician.confidence, "physician", errors);
    }
  }
  return data as AnnualPhysicianOrderExtraction;
}

/**
 * Validate raw AI output against the v1 schema. Returns errors (not
 * exceptions) so a malformed model response fails safely: the caller can
 * route to the fallback extraction with needs_human_check instead of
 * crashing.
 */
export function validateExtraction(
  documentType: DocumentType | string,
  input: unknown,
): ValidationResult {
  const errors: string[] = [];
  if (documentType !== "pcsp" && documentType !== "annual_physician_order") {
    return { ok: false, errors: [`unknown document type: ${String(documentType)}`], value: null };
  }
  if (!isObject(input)) {
    return { ok: false, errors: ["extraction must be a JSON object"], value: null };
  }
  const value =
    documentType === "pcsp"
      ? validatePcsp(input, errors)
      : validateApo(input, errors);
  if (errors.length > 0) {
    return { ok: false, errors, value: null };
  }
  return { ok: true, errors: [], value };
}
