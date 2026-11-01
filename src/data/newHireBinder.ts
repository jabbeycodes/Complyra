/**
 * newHireBinder.ts — the digital New Hire Binder (founder commission
 * 2026-10-30, from the agency's paper "New Hire Binder Content List").
 *
 * A binder is a per-staff-member checklist of everything a new hire's file
 * must hold, organized ComplyRer-style into sections. Items come in five
 * kinds:
 *
 *  - "certificate"   — LINKED to staff certificate records. Status is
 *                      derived from the certificate of record (present +
 *                      unexpired), never copied.
 *  - "training"      — LINKED to the training engine. Satisfied when the
 *                      staff training checklist is complete under the
 *                      engine's own in-ratio gate rule.
 *  - "acknowledgment"— LINKED to the HR document library: satisfied when
 *                      the staff member has signed the matching document.
 *                      Wave 7I: derivation also resolves the signature
 *                      LINK (documentState) — signable only when a
 *                      matching document exists with readable content;
 *                      a missing or content-less document is reported
 *                      plainly as the agency's gap, never as a pending
 *                      signature with a dead sign path behind it.
 *  - "document"      — a WALLET file: the staff member (or HR on their
 *                      behalf) uploads it; HR verifies it or returns it
 *                      with a note. States: missing → on file → verified,
 *                      or returned.
 *  - "profile"       — satisfied by structured profile data (the staff
 *                      member's emergency contact).
 *  - "records"       — INFORMATIONAL pointers at the performance file
 *                      (build 3: performance reviews + corrective
 *                      actions). The note reports what is on file
 *                      ("2 reviews · latest Oct 12, 2026" / "None on
 *                      file"); these items NEVER count toward the
 *                      binder's % complete — they are ongoing file
 *                      records, not onboarding items. Snapshots issued
 *                      before build 3 simply do not contain them.
 *
 * The agency default template below covers every item on the paper list.
 * Creating a binder snapshots the template, so a later template edit
 * never rewrites an existing hire's binder. Build 2 adds the HR binder
 * board, the template editor, and role presets (DSP / House Manager /
 * Nurse) — new binders snapshot the preset for the hire's role.
 *
 * This module is pure: derivation takes an evidence bundle assembled by
 * the caller (the same records the linked systems already own) and
 * returns display-ready statuses. Status is always text — never color
 * alone.
 */
import { daysRemaining } from "./certificates";
import {
  BINDER_DOCUMENT_MISSING_NOTE,
  BINDER_DOCUMENT_UNREADABLE_NOTE,
} from "./starterDocuments";
import type { PerformanceRecordsSummary } from "./performanceRecords";
import type { StaffTrainingProfile } from "./types";

/**
 * One certificate of record, as the compliance evidence feed reports it
 * (name + renewal date — all a status derivation needs). The feed is the
 * same projection the readiness roll-up reads, so a binder item and a
 * readiness requirement never disagree about a certificate.
 */
export interface BinderCertEvidence {
  certName: string;
  expiresOn: string;
}

/* ------------------------------------------------------------------ */
/* Template model                                                      */
/* ------------------------------------------------------------------ */

export type BinderItemKind =
  | "certificate"
  | "training"
  | "acknowledgment"
  | "document"
  | "profile"
  | "records";

export interface BinderTemplateItem {
  /** Stable key inside the binder snapshot (also the wallet document key). */
  key: string;
  label: string;
  kind: BinderItemKind;
  /**
   * For linked kinds: candidate names matched (case-insensitive contains,
   * either direction — the same rule the readiness roll-up uses) against
   * certificate names or HR document titles. Unused for wallet/profile
   * items.
   */
  matchKeys: string[];
  /** Wallet documents may carry an "obtained on" date (e.g. an MVR pull). */
  withObtainedDate?: boolean;
  /**
   * Required items count against the binder's % complete and the board's
   * chase list; optional items are tracked and shown but never counted
   * against the staff member. Undefined = required (build 1 snapshots
   * predate the flag and stay all-required).
   */
  required?: boolean;
}

/** An item counts against completeness unless the template marks it optional. */
export function isRequiredBinderItem(item: BinderTemplateItem): boolean {
  return item.required !== false;
}

export interface BinderTemplateSection {
  key: string;
  title: string;
  items: BinderTemplateItem[];
}

export interface BinderTemplate {
  sections: BinderTemplateSection[];
}

/**
 * The seeded agency default: every line of the paper binder, grouped the
 * ComplyRer way. Agencies edit their own copy later (build 2); binders
 * snapshot this at creation.
 */
export const DEFAULT_BINDER_TEMPLATE: BinderTemplate = {
  sections: [
    {
      key: "background",
      title: "Background & screening",
      items: [
        { key: "fcsr-record", label: "FCSR record", kind: "document", matchKeys: [] },
        {
          key: "background-authorization",
          label: "Background authorization",
          kind: "document",
          matchKeys: [],
        },
        {
          key: "fcsr-registration",
          label: "FCSR registration",
          kind: "document",
          matchKeys: [],
        },
      ],
    },
    {
      key: "certifications",
      title: "Certifications",
      items: [
        {
          key: "l1ma",
          label: "L1MA — Level 1 Medication Aide",
          kind: "certificate",
          matchKeys: ["L1MA", "Level 1 Medication Aide", "Medication Aide"],
        },
        {
          key: "insulin",
          label: "Insulin administration",
          kind: "certificate",
          matchKeys: ["Insulin"],
        },
        {
          key: "cpr-first-aid",
          label: "CPR & First Aid",
          kind: "certificate",
          matchKeys: ["CPR", "First Aid"],
        },
        {
          key: "cpi-pbs",
          label: "CPI / PBS",
          kind: "certificate",
          matchKeys: ["CPI", "PBS", "Crisis Prevention", "Positive Behavior Support"],
        },
        {
          key: "relias-driving",
          label: "Relias driving certificate",
          kind: "certificate",
          matchKeys: ["Relias Driving", "Relias"],
        },
      ],
    },
    {
      key: "policies",
      title: "Company policies",
      items: [
        {
          key: "onboarding-packet",
          label: "Onboarding packet",
          kind: "acknowledgment",
          matchKeys: ["Onboarding Packet", "Onboarding"],
        },
        {
          key: "hipaa-107",
          label: "HIPAA (107)",
          kind: "acknowledgment",
          matchKeys: ["HIPAA"],
        },
        {
          key: "help-protocol-207",
          label: "HELP Protocol (207)",
          kind: "acknowledgment",
          matchKeys: ["HELP Protocol"],
        },
        {
          key: "abuse-neglect-200",
          label: "Abuse & Neglect (200)",
          kind: "acknowledgment",
          matchKeys: ["Abuse & Neglect 200", "Abuse and Neglect"],
        },
        {
          key: "event-reporting-205",
          label: "Event Reporting (205)",
          kind: "acknowledgment",
          matchKeys: ["Event Reporting"],
        },
        {
          key: "infection-control-210",
          label: "Infection Control (210)",
          kind: "acknowledgment",
          matchKeys: ["Infection Control"],
        },
        {
          key: "emergency-preparedness-204",
          label: "Emergency Preparedness (204)",
          kind: "acknowledgment",
          matchKeys: ["Emergency Preparedness"],
        },
        {
          key: "dress-code-203",
          label: "Dress Code (203)",
          kind: "acknowledgment",
          matchKeys: ["Dress Code"],
        },
        {
          key: "vehicle-use-agreement",
          label: "Vehicle Use Agreement",
          kind: "acknowledgment",
          matchKeys: ["Vehicle Use"],
        },
      ],
    },
    {
      key: "hiring-packet",
      title: "Hiring packet",
      items: [
        {
          key: "ee01-voluntary-info",
          label: "EE-01 voluntary information",
          kind: "document",
          matchKeys: [],
        },
        { key: "interview-packet", label: "Interview packet", kind: "document", matchKeys: [] },
        { key: "resume", label: "Resume", kind: "document", matchKeys: [] },
      ],
    },
    {
      key: "driver-file",
      title: "Driver file",
      items: [
        {
          key: "drivers-license",
          label: "Driver's license copy",
          kind: "certificate",
          matchKeys: ["Driver's License", "Drivers License", "Driver License"],
        },
        {
          key: "mvr",
          label: "Motor vehicle record (MVR)",
          kind: "document",
          matchKeys: [],
          withObtainedDate: true,
        },
      ],
    },
    {
      key: "payroll-tax",
      title: "Payroll & tax",
      items: [
        { key: "direct-deposit", label: "Direct deposit form", kind: "document", matchKeys: [] },
        { key: "missouri-w4", label: "Missouri W-4", kind: "document", matchKeys: [] },
        { key: "federal-w4", label: "Federal W-4", kind: "document", matchKeys: [] },
      ],
    },
    {
      key: "offer-role",
      title: "Offer & role",
      items: [
        { key: "offer-letter", label: "Offer letter", kind: "document", matchKeys: [] },
        { key: "job-description", label: "Job description", kind: "document", matchKeys: [] },
      ],
    },
    {
      key: "benefits",
      title: "Benefits",
      items: [
        {
          key: "benefits-enrollment",
          label: "Benefits enrollment",
          kind: "document",
          matchKeys: [],
        },
      ],
    },
    {
      key: "hcbs-rights",
      title: "HCBS & rights",
      items: [
        { key: "hcbs", label: "HCBS", kind: "acknowledgment", matchKeys: ["HCBS"] },
        {
          key: "individual-rights",
          label: "Individual Rights cover page",
          kind: "acknowledgment",
          matchKeys: ["Individual Rights"],
        },
      ],
    },
    {
      key: "education",
      title: "Education",
      items: [
        { key: "education-record", label: "Education record", kind: "document", matchKeys: [] },
      ],
    },
    {
      key: "emergency-contact",
      title: "Emergency contact",
      items: [
        {
          key: "emergency-contact",
          label: "Emergency contact",
          kind: "profile",
          matchKeys: [],
        },
      ],
    },
    {
      key: "training",
      title: "Training",
      items: [
        {
          key: "staff-training-checklist",
          label: "Staff training checklist",
          kind: "training",
          matchKeys: [],
        },
        {
          key: "isp-acknowledgment",
          label: "ISP Acknowledgement",
          kind: "acknowledgment",
          matchKeys: ["ISP Acknowledgment", "ISP Acknowledgement"],
        },
      ],
    },
    {
      key: "performance",
      title: "Performance",
      items: [
        {
          key: "performance-reviews",
          label: "Performance reviews",
          kind: "records",
          matchKeys: [],
        },
        {
          key: "corrective-actions",
          label: "Corrective actions",
          kind: "records",
          matchKeys: [],
        },
      ],
    },
  ],
};

/** Every item key in a template, in display order. */
export function binderItemKeys(template: BinderTemplate): string[] {
  return template.sections.flatMap((s) => s.items.map((i) => i.key));
}

export function binderItemCount(template: BinderTemplate): number {
  return binderItemKeys(template).length;
}

/** Deep copy (templates are plain JSON — snapshots must never alias). */
export function cloneBinderTemplate(template: BinderTemplate): BinderTemplate {
  return JSON.parse(JSON.stringify(template)) as BinderTemplate;
}

/** A copy of the default template with the named items marked optional. */
function presetFromDefault(optionalKeys: string[]): BinderTemplate {
  const template = cloneBinderTemplate(DEFAULT_BINDER_TEMPLATE);
  for (const section of template.sections) {
    for (const item of section.items) {
      if (optionalKeys.includes(item.key)) item.required = false;
    }
  }
  return template;
}

/* ------------------------------------------------------------------ */
/* Role presets + the agency template library (build 2)                */
/* ------------------------------------------------------------------ */

/**
 * A starter template bound to a staff role. New binders snapshot the
 * preset for the hire's role; roles without a preset use the agency
 * default. Presets are ordinary templates — HR edits them in the same
 * editor, and editing one never rewrites an issued binder.
 */
export interface BinderTemplatePreset {
  /** Stable id used to address the template on save ("preset-dsp", …). */
  key: string;
  name: string;
  /** The staff role this preset binds to (SessionUser roleKey). */
  roleKey: string;
  /** How this preset differs from the agency default, in plain words. */
  differences: string;
  template: BinderTemplate;
}

export const BINDER_TEMPLATE_PRESETS: BinderTemplatePreset[] = [
  {
    key: "preset-dsp",
    name: "Direct Support Professional",
    roleKey: "dsp",
    differences:
      "The full default, with one change: insulin administration is optional — it is a delegated task only some DSPs perform, so it is tracked without counting against completeness. L1MA stays required (every DSP passes medications).",
    template: presetFromDefault(["insulin"]),
  },
  {
    key: "preset-house-manager",
    name: "House Manager",
    roleKey: "house_manager",
    differences:
      "The full default with nothing removed and nothing optional — house managers are hired to the complete standard, including the full driver file.",
    template: presetFromDefault([]),
  },
  {
    key: "preset-nurse",
    name: "Nurse",
    roleKey: "nurse",
    differences:
      "L1MA and insulin stay required (medication administration is the core of the role), but the driver file — Relias driving certificate, driver's license copy, and MVR — is optional: nurses are not hired to transport Individuals unless assigned.",
    template: presetFromDefault(["relias-driving", "drivers-license", "mvr"]),
  },
];

/** Everything the template editor works with: the agency default plus
 *  the role presets (stored edits already merged over the starters). */
export interface BinderTemplateLibrary {
  defaultTemplate: BinderTemplate;
  presets: BinderTemplatePreset[];
}

/** The seeded library: default template + untouched starter presets. */
export function defaultBinderTemplateLibrary(): BinderTemplateLibrary {
  return {
    defaultTemplate: cloneBinderTemplate(DEFAULT_BINDER_TEMPLATE),
    presets: BINDER_TEMPLATE_PRESETS.map((p) => ({
      ...p,
      template: cloneBinderTemplate(p.template),
    })),
  };
}

/** The template a NEW binder snapshots for a staff member of this role. */
export function binderTemplateForRole(
  library: BinderTemplateLibrary,
  roleKey: string | null | undefined,
): BinderTemplate {
  if (roleKey) {
    const preset = library.presets.find((p) => p.roleKey === roleKey);
    if (preset) return preset.template;
  }
  return library.defaultTemplate;
}

/* ------------------------------------------------------------------ */
/* Template validation + key minting (the editor's rules)              */
/* ------------------------------------------------------------------ */

const BINDER_ITEM_KINDS: BinderItemKind[] = [
  "certificate",
  "training",
  "acknowledgment",
  "document",
  "profile",
  "records",
];

/**
 * The editor's save gate. Templates feed future binder snapshots, so
 * keys must stay unique across the whole template (a wallet document is
 * addressed by item key) and every section/item needs a real label.
 */
export function validateBinderTemplate(template: BinderTemplate): void {
  if (!template.sections || template.sections.length === 0) {
    throw new Error("A binder template needs at least one section.");
  }
  const sectionKeys = new Set<string>();
  const itemKeys = new Set<string>();
  for (const section of template.sections) {
    if (!section.title.trim()) throw new Error("Every section needs a title.");
    if (sectionKeys.has(section.key)) {
      throw new Error(`Duplicate section key "${section.key}".`);
    }
    sectionKeys.add(section.key);
    if (section.items.length === 0) {
      throw new Error(`Section "${section.title}" needs at least one item.`);
    }
    for (const item of section.items) {
      if (!item.label.trim()) throw new Error("Every item needs a label.");
      if (itemKeys.has(item.key)) {
        throw new Error(`Duplicate item key "${item.key}".`);
      }
      itemKeys.add(item.key);
      if (!BINDER_ITEM_KINDS.includes(item.kind)) {
        throw new Error(`"${item.label}" has an unknown item kind.`);
      }
      if (
        (item.kind === "certificate" || item.kind === "acknowledgment") &&
        item.matchKeys.map((k) => k.trim()).filter(Boolean).length === 0
      ) {
        throw new Error(
          `"${item.label}" is a linked item — give it at least one name to match records against.`,
        );
      }
    }
  }
}

/** Mint a unique slug key for an editor-created section or item. */
export function mintBinderKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}-${n++}`;
  taken.add(key);
  return key;
}

/* ------------------------------------------------------------------ */
/* Stored records                                                      */
/* ------------------------------------------------------------------ */

/** One staff member's binder: a snapshot of the template at creation. */
export interface StaffBinder {
  id: string;
  agencyId: string;
  staffId: string;
  /** Snapshot sections (the template as it stood when the binder opened). */
  sections: BinderTemplateSection[];
  createdAt: string;
  updatedAt: string;
}

export type BinderDocumentStatus = "on_file" | "verified" | "returned";

/**
 * A wallet file for one "document" item. The file itself lives in the
 * binder-documents storage bucket (hosted) or as a data URL (local);
 * this row is the metadata + verification state either way.
 */
export interface BinderDocument {
  id: string;
  agencyId: string;
  binderId: string;
  staffId: string;
  itemKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** Storage bucket path (hosted); null when the file rides as a data URL. */
  storagePath: string | null;
  /** Data URL copy (local mode); null in hosted mode. */
  dataUrl: string | null;
  /** "Obtained on" date for dated pulls (MVR); null for other items. */
  obtainedOn: string | null;
  status: BinderDocumentStatus;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  /** HR's note when a document is sent back; null otherwise. */
  returnNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The staff member's emergency contact (profile data behind that item). */
export interface StaffEmergencyContact {
  id: string;
  agencyId: string;
  staffId: string;
  contactName: string;
  relationship: string;
  phone: string;
  alternatePhone: string | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyContactInput {
  contactName: string;
  relationship: string;
  phone: string;
  alternatePhone?: string | null;
}

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export type BinderItemStatus =
  | "missing"
  | "on_file"
  | "verified"
  | "returned"
  | "expired"
  | "due_soon"
  | "in_progress"
  | "informational";

export const BINDER_STATUS_LABELS: Record<BinderItemStatus, string> = {
  missing: "Missing",
  on_file: "On file",
  verified: "Verified",
  returned: "Returned",
  expired: "Expired",
  due_soon: "Due soon",
  in_progress: "In progress",
  informational: "File record",
};

export interface DerivedBinderItem {
  item: BinderTemplateItem;
  status: BinderItemStatus;
  /** Counts toward the binder's % complete. */
  satisfied: boolean;
  /** Required items count against completeness; optional ones never do. */
  required: boolean;
  /** Human-readable evidence line ("CPR — current through May 1, 2027"). */
  note: string;
  /** The wallet document, for "document" items that have one. */
  document: BinderDocument | null;
  /** The certificate of record, for "certificate" items that matched. */
  certificate: BinderCertEvidence | null;
  /**
   * For "acknowledgment" items, whether the signature link resolves —
   * computed only when the evidence bundle carries the agency's library
   * (all live callers do; bundles assembled without it keep null):
   *  - "signable"   — a matching ACTIVE document exists AND has
   *                   readable content the signer can open before
   *                   signing;
   *  - "missing"    — no matching active document in the library at
   *                   all (never added, or deactivated since);
   *  - "unreadable" — a matching active document exists but carries
   *                   no readable content (title-only shell).
   * Null for every other kind. A binder must never offer a sign action
   * for a "missing" or "unreadable" item (wave 7I).
   */
  documentState: BinderDocumentLinkState | null;
}

/** Whether an acknowledgment item's signature link resolves (wave 7I). */
export type BinderDocumentLinkState = "signable" | "missing" | "unreadable";

export interface DerivedBinderSection {
  section: BinderTemplateSection;
  items: DerivedBinderItem[];
  /** Required items satisfied / required items total (% math basis). */
  satisfied: number;
  total: number;
  /** Optional items in the section (shown, never counted). */
  optional: number;
  /** "records" items in the section (informational, never counted). */
  informational: number;
}

export interface DerivedBinder {
  sections: DerivedBinderSection[];
  /** Required items only — the completeness denominator. */
  totalItems: number;
  /** Required items satisfied. */
  satisfiedItems: number;
  /** satisfied / total as a whole percent; 100 when the binder is empty. */
  percentComplete: number;
  /** Optional items across the binder (shown, never counted). */
  optionalItems: number;
  /** "records" items across the binder (informational, never counted). */
  informationalItems: number;
  /** Wallet documents uploaded but not yet verified by HR. */
  awaitingVerification: number;
}

/** The records a derivation reads — assembled by the caller from the
 *  systems of record: the compliance evidence feed (certificates +
 *  document acknowledgments, the same projection the readiness roll-up
 *  reads), the training profile, the binder wallet, and the emergency
 *  contact. */
export interface BinderEvidence {
  certificates: BinderCertEvidence[];
  trainingProfile: StaffTrainingProfile | null;
  /** Document acknowledgments for this staff member: library title + when signed. */
  documentAcks: Array<{ docKey: string; ackedAt: string }>;
  /**
   * The agency's HR library as the binder needs it: each document's
   * title + whether it carries readable content + whether it is active
   * (wave 7I). Optional so evidence bundles assembled before 7I keep
   * deriving the legacy note; every live caller passes it, and with it
   * an unsigned acknowledgment item reports whether its document is
   * signable, missing, or an unreadable shell instead of always
   * claiming the signature is merely pending. A document flagged
   * `active: false` is excluded from matching entirely — a deactivated
   * document is not a signable target, so an item whose only matches
   * are deactivated derives "missing", the same honest surface as a
   * document the agency never added. Entries without the flag
   * (pre-fix-up bundles) count as active.
   */
  libraryDocuments?: Array<{ title: string; hasContent: boolean; active?: boolean }>;
  walletDocuments: BinderDocument[];
  emergencyContact: StaffEmergencyContact | null;
  /**
   * Performance-file summary for "records" items (build 3): counts +
   * latest dates from the performance records store. Optional so
   * evidence bundles assembled before build 3 keep working — a missing
   * summary derives the same "None on file" note as an empty file.
   */
  performance?: PerformanceRecordsSummary;
}

/**
 * Case-insensitive contains-match, either direction — the same rule the
 * readiness roll-up uses, so a binder item and a readiness requirement
 * with the same key read the same evidence the same way.
 */
export function binderKeyMatches(matchKeys: string[], candidate: string): boolean {
  const have = candidate.toLowerCase().trim();
  if (!have) return false;
  return matchKeys.some((raw) => {
    const want = raw.toLowerCase().trim();
    return want.length > 0 && (have.includes(want) || want.includes(have));
  });
}

function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function deriveCertificateItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
  today: string,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const matches = evidence.certificates.filter((cert) =>
    binderKeyMatches(item.matchKeys, cert.certName),
  );
  if (matches.length === 0) {
    return {
      item,
      status: "missing",
      satisfied: false,
      note: "No certificate on file",
      document: null,
      certificate: null,
    };
  }
  // The certificate with the latest renewal date is the live one.
  const cert = matches
    .slice()
    .sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0];
  const remaining = daysRemaining(cert.expiresOn, today);
  if (remaining < 0) {
    return {
      item,
      status: "expired",
      satisfied: false,
      note: `${cert.certName} — expired ${shortDate(cert.expiresOn)}`,
      document: null,
      certificate: cert,
    };
  }
  if (remaining <= 30) {
    return {
      item,
      status: "due_soon",
      satisfied: true,
      note: `${cert.certName} — renews ${shortDate(cert.expiresOn)}`,
      document: null,
      certificate: cert,
    };
  }
  return {
    item,
    status: "on_file",
    satisfied: true,
    note: `${cert.certName} — current through ${shortDate(cert.expiresOn)}`,
    document: null,
    certificate: cert,
  };
}

function deriveTrainingItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const profile = evidence.trainingProfile;
  if (!profile || profile.counts.required === 0) {
    return {
      item,
      status: "missing",
      satisfied: false,
      note: "Training checklist not started",
      document: null,
      certificate: null,
    };
  }
  const done = profile.counts.complete + profile.counts.waived;
  const total = profile.counts.required + profile.counts.waived;
  if (profile.clearedForInRatio) {
    return {
      item,
      status: "verified",
      satisfied: true,
      note: `Checklist complete — ${done} of ${total} topics, countersigned`,
      document: null,
      certificate: null,
    };
  }
  const reason =
    profile.gateReasons.find((r) => !r.startsWith("No training")) ??
    `${done} of ${total} topics complete`;
  return {
    item,
    status: "in_progress",
    satisfied: false,
    note: reason,
    document: null,
    certificate: null,
  };
}

/**
 * Whether an acknowledgment item's signature link resolves, from the
 * evidence bundle's library projection (wave 7I). Null when the bundle
 * carries no library (pre-7I callers) — the item then derives exactly
 * as it did before.
 */
export function acknowledgmentDocumentState(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): BinderDocumentLinkState | null {
  const library = evidence.libraryDocuments;
  if (!library) return null;
  // Deactivated documents are excluded before matching: they are not
  // in the signable library anymore, so they can neither make an item
  // signable nor turn it "unreadable" — an item left with no active
  // match is "missing", exactly as if the document had never been
  // added.
  const matches = library.filter(
    (doc) => doc.active !== false && binderKeyMatches(item.matchKeys, doc.title),
  );
  if (matches.length === 0) return "missing";
  return matches.some((doc) => doc.hasContent) ? "signable" : "unreadable";
}

function deriveAcknowledgmentItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const ack = evidence.documentAcks
    .filter((a) => binderKeyMatches(item.matchKeys, a.docKey))
    .sort((a, b) => (a.ackedAt < b.ackedAt ? 1 : -1))[0];
  if (!ack) {
    // Wave 7I: when the library is known, say plainly WHY there is
    // nothing to sign instead of always claiming a signature is
    // pending — a document the agency never added (or added without
    // readable text) is the agency's gap, not the new hire's.
    const linkState = acknowledgmentDocumentState(item, evidence);
    const note =
      linkState === "missing"
        ? BINDER_DOCUMENT_MISSING_NOTE
        : linkState === "unreadable"
          ? BINDER_DOCUMENT_UNREADABLE_NOTE
          : "Waiting for the staff member's signature";
    return {
      item,
      status: "missing",
      satisfied: false,
      note,
      document: null,
      certificate: null,
    };
  }
  return {
    item,
    status: "verified",
    satisfied: true,
    note: `Signed ${shortDate(ack.ackedAt)}`,
    document: null,
    certificate: null,
  };
}

function deriveDocumentItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const doc = evidence.walletDocuments.find((d) => d.itemKey === item.key) ?? null;
  if (!doc) {
    return {
      item,
      status: "missing",
      satisfied: false,
      note: "Nothing uploaded yet",
      document: null,
      certificate: null,
    };
  }
  const obtained = doc.obtainedOn ? ` · obtained ${shortDate(doc.obtainedOn)}` : "";
  if (doc.status === "verified") {
    return {
      item,
      status: "verified",
      satisfied: true,
      note: `Verified by ${doc.verifiedByName ?? "HR"} on ${shortDate(doc.verifiedAt ?? doc.updatedAt)}${obtained}`,
      document: doc,
      certificate: null,
    };
  }
  if (doc.status === "returned") {
    return {
      item,
      status: "returned",
      satisfied: false,
      note: doc.returnNote
        ? `Sent back by HR: ${doc.returnNote}`
        : "Sent back by HR — upload a corrected copy",
      document: doc,
      certificate: null,
    };
  }
  return {
    item,
    status: "on_file",
    satisfied: false,
    note: `Uploaded ${shortDate(doc.uploadedAt)} by ${doc.uploadedByName} — awaiting verification${obtained}`,
    document: doc,
    certificate: null,
  };
}

function deriveProfileItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const contact = evidence.emergencyContact;
  if (!contact) {
    return {
      item,
      status: "missing",
      satisfied: false,
      note: "No emergency contact on the staff record",
      document: null,
      certificate: null,
    };
  }
  return {
    item,
    status: "on_file",
    satisfied: true,
    note: `${contact.contactName} (${contact.relationship}) · ${contact.phone}`,
    document: null,
    certificate: null,
  };
}

/**
 * A "records" item (build 3): a pointer at the performance file. The
 * note reports what is on file; the item is NEVER satisfied and NEVER
 * required — performance records are an ongoing file, not an onboarding
 * task, so they stay out of the % math and the gap list entirely.
 */
function deriveRecordsItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): Omit<DerivedBinderItem, "required" | "documentState"> {
  const summary = evidence.performance;
  const describe = (
    count: number,
    latestOn: string | null,
    singular: string,
    plural: string,
  ): string => {
    if (!summary || count === 0) return "None on file";
    const noun = count === 1 ? singular : plural;
    return latestOn
      ? `${count} ${noun} · latest ${shortDate(latestOn)}`
      : `${count} ${noun} on file`;
  };
  const note =
    item.key === "performance-reviews"
      ? describe(
          summary?.reviewCount ?? 0,
          summary?.latestReviewOn ?? null,
          "review",
          "reviews",
        )
      : item.key === "corrective-actions"
        ? describe(
            summary?.actionCount ?? 0,
            summary?.latestActionOn ?? null,
            "corrective action",
            "corrective actions",
          )
        : "Performance file records — see the Performance tab";
  return {
    item,
    status: "informational",
    satisfied: false,
    note,
    document: null,
    certificate: null,
  };
}

export function deriveBinderItem(
  item: BinderTemplateItem,
  staffId: string,
  evidence: BinderEvidence,
  today: string,
): DerivedBinderItem {
  void staffId; // identity only — the evidence bundle is pre-scoped per staff.
  const derived = ((): Omit<DerivedBinderItem, "required" | "documentState"> => {
    switch (item.kind) {
      case "certificate":
        return deriveCertificateItem(item, evidence, today);
      case "training":
        return deriveTrainingItem(item, evidence);
      case "acknowledgment":
        return deriveAcknowledgmentItem(item, evidence);
      case "document":
        return deriveDocumentItem(item, evidence);
      case "profile":
        return deriveProfileItem(item, evidence);
      case "records":
        return deriveRecordsItem(item, evidence);
    }
  })();
  // "records" items never count against the staff member, whatever the
  // template's required flag says — they are not onboarding items.
  return {
    ...derived,
    required: item.kind === "records" ? false : isRequiredBinderItem(item),
    documentState:
      item.kind === "acknowledgment"
        ? acknowledgmentDocumentState(item, evidence)
        : null,
  };
}

/** Derive every item in a binder snapshot against the evidence bundle. */
export function deriveBinder(
  binder: StaffBinder,
  evidence: BinderEvidence,
  today: string,
): DerivedBinder {
  const sections: DerivedBinderSection[] = binder.sections.map((section) => {
    const items = section.items.map((item) =>
      deriveBinderItem(item, binder.staffId, evidence, today),
    );
    return {
      section,
      items,
      satisfied: items.filter((i) => i.required && i.satisfied).length,
      total: items.filter((i) => i.required).length,
      optional: items.filter((i) => !i.required && i.item.kind !== "records").length,
      informational: items.filter((i) => i.item.kind === "records").length,
    };
  });
  const totalItems = sections.reduce((n, s) => n + s.total, 0);
  const satisfiedItems = sections.reduce((n, s) => n + s.satisfied, 0);
  const optionalItems = sections.reduce((n, s) => n + s.optional, 0);
  const informationalItems = sections.reduce((n, s) => n + s.informational, 0);
  const awaitingVerification = evidence.walletDocuments.filter(
    (d) => d.status === "on_file",
  ).length;
  return {
    sections,
    totalItems,
    satisfiedItems,
    percentComplete: totalItems
      ? Math.round((satisfiedItems / totalItems) * 100)
      : 100,
    optionalItems,
    informationalItems,
    awaitingVerification,
  };
}

/* ------------------------------------------------------------------ */
/* Gap analysis (the HR board's chase list)                            */
/* ------------------------------------------------------------------ */

/**
 * Chase-list urgency ranking. An expired certificate is a live
 * compliance breach, so it outranks a merely missing item; a document
 * HR sent back outranks training still in progress. Wallet documents
 * sitting "on file" are NOT gaps — HR already holds them (they are the
 * board's awaiting-verification count, HR's own queue, not something
 * to chase the staff member for).
 */
export const BINDER_GAP_RANK: Partial<Record<BinderItemStatus, number>> = {
  expired: 0,
  missing: 1,
  returned: 2,
  in_progress: 3,
};

/**
 * The required items still standing between this binder and complete,
 * most urgent first (template order breaks ties). Optional items and
 * satisfied items never appear; neither do documents awaiting HR's own
 * verification.
 */
export function binderGaps(derived: DerivedBinder): DerivedBinderItem[] {
  const gaps: Array<{ row: DerivedBinderItem; order: number }> = [];
  let order = 0;
  for (const section of derived.sections) {
    for (const row of section.items) {
      const position = order++;
      if (!row.required || row.satisfied) continue;
      const rank = BINDER_GAP_RANK[row.status];
      if (rank === undefined) continue;
      gaps.push({ row, order: position + rank * 1000 });
    }
  }
  return gaps.sort((a, b) => a.order - b.order).map((g) => g.row);
}

/** The single most urgent gap, or null when the binder has none. */
export function mostUrgentBinderGap(derived: DerivedBinder): DerivedBinderItem | null {
  return binderGaps(derived)[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export const BINDER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Wallet files: PDF or image scans, up to 10 MB (mirrors certificates). */
export function validateBinderDocumentFile(file: {
  name: string;
  type: string;
  size: number;
}): void {
  const okType =
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    throw new Error("Choose a PDF or image scan of the document.");
  }
  if (file.size > BINDER_DOCUMENT_MAX_BYTES) {
    throw new Error("Choose a document file smaller than 10 MB.");
  }
}

export function validateEmergencyContact(input: EmergencyContactInput): void {
  if (!input.contactName.trim()) throw new Error("Enter the contact's name.");
  if (!input.relationship.trim()) throw new Error("Enter the contact's relationship.");
  if (!input.phone.trim()) throw new Error("Enter the contact's phone number.");
}
