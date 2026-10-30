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
 *  - "document"      — a WALLET file: the staff member (or HR on their
 *                      behalf) uploads it; HR verifies it or returns it
 *                      with a note. States: missing → on file → verified,
 *                      or returned.
 *  - "profile"       — satisfied by structured profile data (the staff
 *                      member's emergency contact).
 *
 * The agency default template below covers every item on the paper list.
 * Creating a binder snapshots the template, so a later template edit
 * (build 2) never rewrites an existing hire's binder.
 *
 * This module is pure: derivation takes an evidence bundle assembled by
 * the caller (the same records the linked systems already own) and
 * returns display-ready statuses. Status is always text — never color
 * alone.
 */
import { daysRemaining } from "./certificates";
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
  | "profile";

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
  ],
};

/** Every item key in a template, in display order. */
export function binderItemKeys(template: BinderTemplate): string[] {
  return template.sections.flatMap((s) => s.items.map((i) => i.key));
}

export function binderItemCount(template: BinderTemplate): number {
  return binderItemKeys(template).length;
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
  | "in_progress";

export const BINDER_STATUS_LABELS: Record<BinderItemStatus, string> = {
  missing: "Missing",
  on_file: "On file",
  verified: "Verified",
  returned: "Returned",
  expired: "Expired",
  due_soon: "Due soon",
  in_progress: "In progress",
};

export interface DerivedBinderItem {
  item: BinderTemplateItem;
  status: BinderItemStatus;
  /** Counts toward the binder's % complete. */
  satisfied: boolean;
  /** Human-readable evidence line ("CPR — current through May 1, 2027"). */
  note: string;
  /** The wallet document, for "document" items that have one. */
  document: BinderDocument | null;
  /** The certificate of record, for "certificate" items that matched. */
  certificate: BinderCertEvidence | null;
}

export interface DerivedBinderSection {
  section: BinderTemplateSection;
  items: DerivedBinderItem[];
  satisfied: number;
  total: number;
}

export interface DerivedBinder {
  sections: DerivedBinderSection[];
  totalItems: number;
  satisfiedItems: number;
  /** satisfied / total as a whole percent; 100 when the binder is empty. */
  percentComplete: number;
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
  walletDocuments: BinderDocument[];
  emergencyContact: StaffEmergencyContact | null;
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
): DerivedBinderItem {
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
): DerivedBinderItem {
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

function deriveAcknowledgmentItem(
  item: BinderTemplateItem,
  evidence: BinderEvidence,
): DerivedBinderItem {
  const ack = evidence.documentAcks
    .filter((a) => binderKeyMatches(item.matchKeys, a.docKey))
    .sort((a, b) => (a.ackedAt < b.ackedAt ? 1 : -1))[0];
  if (!ack) {
    return {
      item,
      status: "missing",
      satisfied: false,
      note: "Waiting for the staff member's signature",
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
): DerivedBinderItem {
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
): DerivedBinderItem {
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

export function deriveBinderItem(
  item: BinderTemplateItem,
  staffId: string,
  evidence: BinderEvidence,
  today: string,
): DerivedBinderItem {
  void staffId; // identity only — the evidence bundle is pre-scoped per staff.
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
  }
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
      satisfied: items.filter((i) => i.satisfied).length,
      total: items.length,
    };
  });
  const totalItems = sections.reduce((n, s) => n + s.total, 0);
  const satisfiedItems = sections.reduce((n, s) => n + s.satisfied, 0);
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
    awaitingVerification,
  };
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
