/**
 * OBLIGATIONS REGISTER — every recurring duty a residential agency carries,
 * with who owns it, how often it comes due, where it is done in Complyrer,
 * and where its verifiable history lives.
 *
 * Wave 1 audit (2026-11-03). The duties below were already tracked, but in
 * separate modules with no single map: a manager could not answer "what are
 * all the things my house owes, who does each, and where is the proof?"
 * without knowing the product. This register is that map. It is DATA:
 * the navigation, dashboards, and the audit-readiness checks read it, and
 * obligations.test.ts pins it against the real pages, roles, and DMH
 * requirement ids so it cannot drift from the product.
 *
 * BASIS — two kinds, never mixed:
 *  - `regulation`: the duty maps to a verified entry in DMH_REQUIREMENTS
 *    (src/data/dmhRequirements.ts), which carries the citation and its
 *    verification note. Only ids that exist there may be named here.
 *  - `agency-policy`: a duty the agency runs as good practice or its own
 *    policy (or one whose Missouri citation is not yet verified — see the
 *    VERIFICATION POLICY in dmhRequirements.ts). These are never presented
 *    as regulatory requirements.
 *
 * Not legal advice. Agencies confirm frequencies against their own
 * certification, contracts, and the current Missouri DMH rules.
 */
import type { RoleKey } from "./permissions";

export type ObligationFrequency =
  | "per-shift"
  | "per-event"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "biennial"
  | "on-hire"
  | "per-plan-version"
  | "per-order";

export type ObligationScope = "individual" | "site" | "staff" | "agency";

export type ObligationBasis =
  | { kind: "regulation"; dmhRequirementId: string }
  | { kind: "agency-policy"; note: string };

export interface Obligation {
  /** Stable slug. Never rename once shipped. */
  id: string;
  title: string;
  /** One plain sentence: what has to happen. */
  summary: string;
  frequency: ObligationFrequency;
  /** What one occurrence is attached to. */
  scope: ObligationScope;
  /** Roles that do the work (role keys from ROLE_TEMPLATES). */
  ownerRoles: RoleKey[];
  /** Roles that review, approve, or countersign it. */
  reviewerRoles: RoleKey[];
  /** The nav page where the work is done (a CANONICAL_PAGE_ORDER entry or "Consents"). */
  page: string;
  /** Where inside the page, when it is a tab or a chart section. */
  location?: string;
  /** What the verifiable history is (who, when, signed). */
  history: string;
  basis: ObligationBasis;
}

export const OBLIGATIONS: readonly Obligation[] = [
  // ------------------------------------------------------------- the house
  {
    id: "weekly-house-checklist",
    title: "Weekly house checklist",
    summary: "The house manager completes and signs the 26-line weekly home checklist.",
    frequency: "weekly",
    scope: "site",
    ownerRoles: ["house_manager"],
    reviewerRoles: ["program_manager", "administrator"],
    page: "Weekly checklist",
    history: "One signed checklist per home per week (Sunday week), with each line's answer and note.",
    basis: { kind: "agency-policy", note: "Agency home-operations practice." },
  },
  {
    id: "monthly-home-safety-report",
    title: "Monthly home safety inspection",
    summary: "Each home records its monthly safety inspection by the agency's due day.",
    frequency: "monthly",
    scope: "site",
    ownerRoles: ["house_manager"],
    reviewerRoles: ["program_manager", "administrator"],
    page: "Sites & programs",
    location: "Site → Checklists → Monthly home checks",
    history: "One dated safety report per home per month, line by line.",
    basis: { kind: "agency-policy", note: "Frequency set per agency (Monthly due settings)." },
  },
  {
    id: "monthly-emergency-drills",
    title: "Emergency drills",
    summary: "Each home records its drills — type, date, time, evacuation time, leader, and who took part.",
    frequency: "monthly",
    scope: "site",
    ownerRoles: ["house_manager"],
    reviewerRoles: ["program_manager", "administrator"],
    page: "Sites & programs",
    location: "Sites & programs → This month’s checks (recording); Site → Checklists (schedule)",
    history: "Dated drill rows per home per month, with the drill schedule.",
    basis: {
      kind: "agency-policy",
      note: "Drill frequency is agency-set; a Missouri citation is not yet verified in DMH_REQUIREMENTS.",
    },
  },
  {
    id: "monthly-adaptive-equipment",
    title: "Adaptive equipment checks",
    summary: "Every Individual's adaptive equipment is checked and initialed each month.",
    frequency: "monthly",
    scope: "individual",
    ownerRoles: ["house_manager", "dsp"],
    reviewerRoles: ["house_manager", "program_manager"],
    page: "Sites & programs",
    location: "Site → Checklists → Monthly home checks",
    history: "Per-equipment monthly log: checked-on date, initials, staffer, comments.",
    basis: { kind: "agency-policy", note: "Agency equipment-safety practice." },
  },
  {
    id: "site-pre-survey-review",
    title: "Site review / pre-survey",
    summary: "Program managers walk each home with the site-review pack before a survey.",
    frequency: "annual",
    scope: "site",
    ownerRoles: ["program_manager"],
    reviewerRoles: ["administrator"],
    page: "Sites & programs",
    location: "Site → Overview → Site review",
    history: "Saved site review with facts, findings, and the live pre-survey sheet.",
    basis: {
      kind: "agency-policy",
      note: "Agency survey preparation ahead of DMH recertification.",
    },
  },
  {
    id: "quarterly-qa-review",
    title: "Quarterly QA review",
    summary: "Each home gets a scored quality-assurance review every quarter.",
    frequency: "quarterly",
    scope: "site",
    ownerRoles: ["program_manager"],
    reviewerRoles: ["auditor", "administrator"],
    page: "QA Review",
    history: "One QA audit per home per quarter: system-verified items, scores, disputes, finalize.",
    basis: { kind: "agency-policy", note: "Agency quality program." },
  },

  // ------------------------------------------------------------- medication
  {
    id: "mar-dose-recording",
    title: "Medication administration (MAR)",
    summary: "Every scheduled dose is marked given, refused, or missed in its window; PRNs get a follow-up.",
    frequency: "per-shift",
    scope: "individual",
    ownerRoles: ["dsp", "nurse", "house_manager"],
    reviewerRoles: ["nurse", "house_manager"],
    page: "Individuals",
    location: "Chart → Medications",
    history: "Dose marks with giver, time, late reason, and corrections archived to mark history.",
    basis: {
      kind: "agency-policy",
      note: "MAR documentation practice; who may administer is pinned by DMH entry med-aide-scope-limits.",
    },
  },
  {
    id: "medication-counts",
    title: "Medication counts",
    summary: "Deliveries and refill counts set the baseline; given doses count down; variances are explained.",
    frequency: "per-event",
    scope: "individual",
    ownerRoles: ["house_manager", "nurse"],
    reviewerRoles: ["nurse", "program_manager"],
    page: "Supply forecast",
    history: "Delivery and count records, dose-exception (wasted/refused/lost) log, variance history.",
    basis: { kind: "agency-policy", note: "Agency medication-control practice." },
  },
  {
    id: "physician-order-review",
    title: "Physician / medication orders",
    summary: "Orders are approved, kept current, and reviewed before they expire.",
    frequency: "per-order",
    scope: "individual",
    ownerRoles: ["nurse"],
    reviewerRoles: ["program_manager"],
    page: "Medication orders",
    history: "Order lifecycle (draft → active → discontinued) with expiry and the reconciliation pass.",
    basis: { kind: "agency-policy", note: "Order-review cadence is agency/prescriber-set." },
  },
  {
    id: "nursing-delegations",
    title: "Nursing delegations",
    summary: "The delegating RN signs first, staff sign their delegation, and expiring delegations are renewed.",
    frequency: "annual",
    scope: "individual",
    ownerRoles: ["nurse"],
    reviewerRoles: ["program_manager"],
    page: "Delegations",
    history: "Delegation forms with RN and staff signatures, activation, and expiry.",
    basis: {
      kind: "agency-policy",
      note: "RN delegation rules for specific tasks are not yet verified in DMH_REQUIREMENTS.",
    },
  },

  // ------------------------------------------------------ the person's plan
  {
    id: "isp-shift-notes",
    title: "ISP documentation (shift notes)",
    summary: "Each shift documents progress on the Individual's ISP programs.",
    frequency: "per-shift",
    scope: "individual",
    ownerRoles: ["dsp", "house_manager"],
    reviewerRoles: ["house_manager", "program_manager"],
    page: "Individuals",
    location: "Chart → ISP data",
    history: "Signed shift notes per program, with late-filing flags and the monthly report.",
    basis: { kind: "agency-policy", note: "Documentation cadence follows the ISP and agency policy." },
  },
  {
    id: "pcsp-acknowledgments",
    title: "Staff plan acknowledgments",
    summary: "Every assigned staffer reads and signs each new version of an Individual's plan.",
    frequency: "per-plan-version",
    scope: "individual",
    ownerRoles: ["dsp", "house_manager", "nurse"],
    reviewerRoles: ["house_manager", "program_manager"],
    page: "Acknowledgments",
    history: "One acknowledgment sheet per plan version: every assigned staffer's signature and date.",
    basis: { kind: "agency-policy", note: "Agency practice for plan changes." },
  },
  {
    id: "consents-current",
    title: "Consents and authorizations",
    summary: "Each required consent type is on file, signed, and reviewed before its review date.",
    frequency: "annual",
    scope: "individual",
    ownerRoles: ["house_manager", "program_manager"],
    reviewerRoles: ["program_manager", "administrator"],
    page: "Consents",
    history: "Consent versions with giver, signed/effective/review dates, revocations, and packets.",
    basis: { kind: "agency-policy", note: "Required consent types are agency-configured." },
  },
  {
    id: "rights-packet-annual",
    title: "Annual rights packet",
    summary: "Each Individual's rights packet is signed every year.",
    frequency: "annual",
    scope: "individual",
    ownerRoles: ["house_manager", "program_manager"],
    reviewerRoles: ["program_manager"],
    page: "Consents",
    location: "Rights packets",
    history: "Signed rights packet per Individual per year, immutable once signed.",
    basis: { kind: "agency-policy", note: "Agency rights practice." },
  },

  // --------------------------------------------------------------- events
  {
    id: "event-reports",
    title: "Event reports (GER) and follow-up",
    summary: "Events are reported on time, reviewed, and every follow-up is resolved with a closing note.",
    frequency: "per-event",
    scope: "individual",
    ownerRoles: ["dsp", "house_manager"],
    reviewerRoles: ["program_manager", "administrator"],
    page: "Sites & programs",
    location: "Site → Reporting",
    history: "Event report (draft → submitted → approved/returned) and its resolution lifecycle.",
    basis: { kind: "regulation", dmhRequirementId: "event-reporting-timelines" },
  },
  {
    id: "corrective-actions",
    title: "Corrective actions",
    summary: "Findings get an owner, a due date, and a recorded resolution.",
    frequency: "per-event",
    scope: "agency",
    ownerRoles: ["house_manager", "program_manager"],
    reviewerRoles: ["administrator"],
    page: "Overview",
    location: "Compliance command center",
    history: "Corrective action rows with status, owner, due date, and resolution.",
    basis: { kind: "regulation", dmhRequirementId: "corrective-action-tracking" },
  },

  // ------------------------------------------------------------- the staff
  {
    id: "background-check-on-hire",
    title: "Background screening on hire",
    summary: "Every new staffer's background screening is on file before they work.",
    frequency: "on-hire",
    scope: "staff",
    ownerRoles: ["hr"],
    reviewerRoles: ["administrator"],
    page: "Employee Hub",
    location: "New Hire Binder",
    history: "New-hire binder evidence with the screening document.",
    basis: { kind: "regulation", dmhRequirementId: "fcsr-background-check" },
  },
  {
    id: "abuse-neglect-training",
    title: "Abuse and neglect training",
    summary: "Staff complete abuse and neglect training every year.",
    frequency: "annual",
    scope: "staff",
    ownerRoles: ["dsp", "house_manager", "nurse"],
    reviewerRoles: ["hr", "house_manager"],
    page: "Training",
    history: "Training lines with sign-offs and house-manager countersignatures.",
    basis: { kind: "regulation", dmhRequirementId: "abuse-neglect-training-annual" },
  },
  {
    id: "first-aid-cpr",
    title: "First aid and CPR",
    summary: "Direct-care staff keep first aid and CPR current.",
    frequency: "biennial",
    scope: "staff",
    ownerRoles: ["dsp", "house_manager", "nurse"],
    reviewerRoles: ["hr"],
    page: "Certificates",
    history: "Certificate records with issue and expiry dates and the uploaded card.",
    basis: { kind: "regulation", dmhRequirementId: "first-aid-cpr-biennial" },
  },
  {
    id: "medication-aide-course",
    title: "Medication aide course",
    summary: "Staff who pass medications complete the medication aide course before they do.",
    frequency: "on-hire",
    scope: "staff",
    ownerRoles: ["dsp"],
    reviewerRoles: ["nurse", "hr"],
    page: "Training",
    history: "Training clearance; uncleared staff are blocked from recording doses.",
    basis: { kind: "regulation", dmhRequirementId: "med-aide-16-hour-course" },
  },
  {
    id: "hipaa-training",
    title: "Privacy (HIPAA) training",
    summary: "Staff complete privacy training every year.",
    frequency: "annual",
    scope: "staff",
    ownerRoles: ["dsp", "house_manager", "nurse", "hr"],
    reviewerRoles: ["hr"],
    page: "Training",
    history: "Training lines with sign-offs.",
    basis: { kind: "regulation", dmhRequirementId: "hipaa-training-annual" },
  },
];

export function obligationById(id: string): Obligation | undefined {
  return OBLIGATIONS.find((row) => row.id === id);
}

/** The obligations a role owns (does the work for). */
export function obligationsOwnedBy(roleKey: string): Obligation[] {
  return OBLIGATIONS.filter((row) => (row.ownerRoles as string[]).includes(roleKey));
}

export const OBLIGATION_FREQUENCY_LABELS: Record<ObligationFrequency, string> = {
  "per-shift": "Every shift",
  "per-event": "Each time it happens",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
  biennial: "Every two years",
  "on-hire": "On hire",
  "per-plan-version": "Each new plan version",
  "per-order": "Each order",
};
