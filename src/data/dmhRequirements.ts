/**
 * DMH readiness requirements — data-driven checklist for the compliance
 * command center's "Are we ready for DMH review/recertification?" section.
 *
 * DESIGN: this file is DATA, not logic. Each entry describes one
 * requirement with a stable id, a human title, a category, what evidence
 * proves it, the name of the how-to-check rule (implemented in
 * src/data/auditReadiness.ts), and the regulation cite. New items are added
 * by APPENDING entries to DMH_REQUIREMENTS — no code changes needed; the
 * checklist, readiness %, and missing-requirements view all read this array.
 *
 * VERIFICATION POLICY (2026-09-14, DMH research pass):
 * - Only items verified against published Missouri regulations ship here.
 * - Items the research could NOT verify (total initial DSP training hours,
 *   RN delegation rule for G-tube/injectables, exact CSR number for the
 *   ISP/IHP cycle, record-retention period, unannounced survey
 *   authority/frequency, EVV applicability to ISL) are DELIBERATELY ABSENT.
 * - Every entry carries `verified: true` plus its cite. Never add an entry
 *   without a cite you have actually read.
 * - REGULATORY BASIS NOTE: these items are based on published Missouri
 *   regulations. CSR snapshots on sos.mo.gov are archived editions (through
 *   ~2023); Cornell LII shows 9 CSR 45-5.020 as rescinded even though DMH's
 *   training catalog still cites it. The UI must present the
 *   DMH_REGULATORY_BASIS_NOTE and never present this list as legal advice.
 */

export type DmhRequirementCategory =
  | "certification"
  | "training"
  | "background"
  | "medication"
  | "incident"
  | "documentation"
  | "staffing"
  | "operations";

export const DMH_REQUIREMENT_CATEGORIES: Array<{
  key: DmhRequirementCategory;
  label: string;
}> = [
  { key: "certification", label: "Provider certification" },
  { key: "training", label: "Staff training" },
  { key: "background", label: "Background checks" },
  { key: "medication", label: "Medication administration" },
  { key: "incident", label: "Incident & event reporting" },
  { key: "documentation", label: "Records & documentation" },
  { key: "staffing", label: "Staffing qualifications" },
  { key: "operations", label: "Corrective action & operations" },
];

export interface DmhRequirement {
  /** Stable slug, e.g. "fcsr-background-check". Never rename once shipped. */
  id: string;
  /** Short human title shown in the checklist. */
  title: string;
  category: DmhRequirementCategory;
  /** What evidence proves the requirement is met (Complyrer-original wording). */
  evidence: string;
  /**
   * Name of the how-to-check rule implemented in src/data/auditReadiness.ts
   * (CHECK_RULES). Unknown rule names evaluate to "unknown", never "met".
   */
  checkRule: string;
  /** Regulation cite, e.g. "9 CSR 45-5.060(2), (4)". Always present. */
  cite: string;
  /** True when verified against a published source by the DMH research pass. */
  verified: boolean;
}

/**
 * Shown wherever the checklist renders: these items are based on published
 * Missouri regulations — the provider must confirm the current CSR text.
 * This is not legal advice.
 */
export const DMH_REGULATORY_BASIS_NOTE =
  "Based on published Missouri regulations. Confirm the current CSR text before relying on any item — this list is not legal advice.";

/** Why the list is conservative: archived CSR snapshots and rescinded cites. */
export const DMH_SOURCE_CAVEAT =
  "CSR snapshots on sos.mo.gov are archived editions (through ~2023). " +
  "Some citations (e.g. 9 CSR 45-5.020) appear rescinded in Cornell LII while " +
  "DMH materials still cite them, so items stay out until their cite is verified.";

/**
 * Validates one requirement entry. Throws on any structural problem so a
 * bad append fails fast in tests instead of silently shipping.
 */
export function defineDmhRequirement(input: DmhRequirement): DmhRequirement {
  const missing: string[] = [];
  if (!input.id || !input.id.trim()) missing.push("id");
  if (!input.title || !input.title.trim()) missing.push("title");
  if (!input.category) missing.push("category");
  if (!input.evidence || !input.evidence.trim()) missing.push("evidence");
  if (!input.checkRule || !input.checkRule.trim()) missing.push("checkRule");
  if (!input.cite || !input.cite.trim()) missing.push("cite");
  if (missing.length > 0) {
    throw new Error(
      `DMH requirement "${input.id || "(no id)"}" is missing: ${missing.join(", ")}`,
    );
  }
  if (
    !DMH_REQUIREMENT_CATEGORIES.some((entry) => entry.key === input.category)
  ) {
    throw new Error(
      `DMH requirement "${input.id}" has unknown category "${input.category}"`,
    );
  }
  if (!/^[a-z0-9-]+$/.test(input.id)) {
    throw new Error(
      `DMH requirement id "${input.id}" must be a lowercase slug (letters, digits, hyphens)`,
    );
  }
  return { ...input, verified: input.verified === true };
}

/**
 * The checklist itself. APPEND new verified items here — the readiness
 * checklist, readiness %, and missing-requirements view pick them up with
 * no code changes.
 */
export const DMH_REQUIREMENTS: DmhRequirement[] = [
  defineDmhRequirement({
    id: "provider-certification-olc",
    title: "Provider certification issued by the DMH Office of Licensure and Certification",
    category: "certification",
    evidence:
      "Current DMH provider certificate on file with issue and expiry dates; OLC application record showing the 30-day review.",
    checkRule: "providerCertificateCurrent",
    cite: "9 CSR 45-5.060(2), (4)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "recertification-filed-60-days",
    title: "Recertification application filed at least 60 calendar days before certificate expiry",
    category: "certification",
    evidence:
      "Recertification application submitted ≥60 calendar days before the current certificate expires; submission receipt kept with the certificate.",
    checkRule: "recertificationFiledOnTime",
    cite: "9 CSR 45-5.060(2)(E)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "certification-period-two-years",
    title: "Certification period is 2 years",
    category: "certification",
    evidence:
      "Certificate issue and expiry dates span the 2-year certification period; recertification is calendared from the expiry date.",
    checkRule: "certificationPeriodTwoYears",
    cite: "9 CSR 45-5.060 (verified via HHS OIG audit A-07-21-03247)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "abuse-neglect-training-annual",
    title: "Abuse/neglect training completed annually, before first contact with individuals",
    category: "training",
    evidence:
      "Annual abuse/neglect training record for every staff member, dated before their first contact with individuals.",
    checkRule: "abuseNeglectTrainingCurrent",
    cite: "9 CSR 10-5.200; 9 CSR 45-5.010(3)(C)2.F.–G.",
    verified: true,
  }),
  defineDmhRequirement({
    id: "first-aid-cpr-biennial",
    title: "First Aid/CPR training every 2 years with a certified trainer and competency demonstration",
    category: "training",
    evidence:
      "Biennial First Aid/CPR certificate from a certified trainer using a Division-approved curriculum, with competency demonstration documented.",
    checkRule: "firstAidCprCurrent",
    cite: "9 CSR 45-5.010(3)(D)2.P.",
    verified: true,
  }),
  defineDmhRequirement({
    id: "fcsr-background-check",
    title: "FCSR background check for staff hired on/after 2009-01-01",
    category: "background",
    evidence:
      "FCSR registration applied for within 15 days of hire for staff hired on/after 2009-01-01; the employer's screening request is on file.",
    checkRule: "fcsrCheckComplete",
    cite: "§210.906, RSMo",
    verified: true,
  }),
  defineDmhRequirement({
    id: "med-aide-16-hour-course",
    title: "Medication aide 16-hour initial course and biennial retraining",
    category: "medication",
    evidence:
      "16-hour medication aide course record (80% written / 100% practicum), DD Medication Aide Certificate via the regional center, and 4 hours retraining every 2 years documented on MO 650-8730 in the personnel file.",
    checkRule: "medAideTrainingCurrent",
    cite: "9 CSR 45-3.070(13)–(14)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "med-aide-scope-limits",
    title: "Medication aides do not administer insulin or tube-feeding medications",
    category: "medication",
    evidence:
      "Personnel and assignment records show insulin and tube-feeding medications are administered only by licensed nursing staff — never by medication aides under the 16-hour program.",
    checkRule: "medAideScopeRespected",
    cite: "9 CSR 45-3.070(1)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "event-reporting-timelines",
    title: "Event reporting meets the immediate / next-business-day timelines",
    category: "incident",
    evidence:
      "Death, abuse/neglect, and critical events: immediate report (verbal on-call after hours, CIMOR-EMT entry next business day). All other events filed electronically by end of next business day. Parent/guardian verbal notice within 24 hours.",
    checkRule: "eventReportingTimely",
    cite: "9 CSR 10-5.206; Division Directive 4.070",
    verified: true,
  }),
  defineDmhRequirement({
    id: "plan-of-correction",
    title: "Plans of correction after surveys name an owner, a monitoring plan, and a systemic fix",
    category: "operations",
    evidence:
      "Every survey finding has a plan of correction naming the responsible job title, a monitoring plan, and a systemic fix; final correction within 180 calendar days of exit; acceptable POC within 60 days of certified-mail notice.",
    checkRule: "planOfCorrectionOnTrack",
    cite: "9 CSR 45-5.060(8)–(9)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "hipaa-training-annual",
    title: "HIPAA/confidentiality training upon hire and annually, plus a written HIPAA policy",
    category: "training",
    evidence:
      "HIPAA/confidentiality training record upon hire and annually for every staff member, plus the provider's written HIPAA policy on file.",
    checkRule: "hipaaTrainingCurrent",
    cite: "9 CSR 45-5.010(3)(C)2.K; 9 CSR 10-5.220",
    verified: true,
  }),
  defineDmhRequirement({
    id: "event-reporting-training",
    title: "Event-reporting training completed initially and annually",
    category: "training",
    evidence:
      "Initial and annual event-reporting training records for every staff member.",
    checkRule: "eventReportingTrainingCurrent",
    cite: "9 CSR 10-5.206 (training requirement)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "administrator-qualifications",
    title: "Administrator meets degree and DD supervisory-experience qualifications",
    category: "staffing",
    evidence:
      "Administrator credentials on file: bachelor's degree plus 1 year of DD supervisory experience, with a QMRP backup designated.",
    checkRule: "administratorQualified",
    cite: "9 CSR 45-5.010(7)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "survey-personnel-records",
    title: "Personnel records complete for survey review",
    category: "documentation",
    evidence:
      "Personnel records complete for every staff member: employment eligibility and training documentation ready for the survey team's personnel-record review.",
    checkRule: "personnelRecordsComplete",
    cite: "9 CSR 45-5.060 (survey procedures)",
    verified: true,
  }),
  // Workflow-adjacent obligations: tracked in Complyrer's corrective-action
  // and incident workflows, grounded in the verified cites above.
  defineDmhRequirement({
    id: "corrective-action-tracking",
    title: "Every corrective action has an owner, a due date, and a monitoring plan inside the 180-day window",
    category: "operations",
    evidence:
      "Corrective-action log shows every open item with an assigned owner, a due date, and a monitoring plan; nothing is past the 180-day correction window.",
    checkRule: "correctiveActionsOnTrack",
    cite: "9 CSR 45-5.060(8)–(9)",
    verified: true,
  }),
  defineDmhRequirement({
    id: "incident-reporting-timeliness",
    title: "Incident log shows next-business-day electronic filing and immediate critical-event reports",
    category: "incident",
    evidence:
      "Incident log shows non-critical events filed electronically by end of next business day and critical events reported immediately.",
    checkRule: "incidentReportsTimely",
    cite: "9 CSR 10-5.206; Division Directive 4.070",
    verified: true,
  }),
];

/** Look up a requirement by id; undefined when unknown. */
export function dmhRequirementById(id: string): DmhRequirement | undefined {
  return DMH_REQUIREMENTS.find((item) => item.id === id);
}

/** Requirements grouped by category, in DMH_REQUIREMENT_CATEGORIES order. */
export function dmhRequirementsByCategory(): Array<{
  key: DmhRequirementCategory;
  label: string;
  items: DmhRequirement[];
}> {
  return DMH_REQUIREMENT_CATEGORIES.map((entry) => ({
    ...entry,
    items: DMH_REQUIREMENTS.filter((item) => item.category === entry.key),
  }));
}
