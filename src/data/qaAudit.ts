/**
 * QA AUDIT — program-site quality assurance reviews with system-verified items,
 * auditor scoring, dispute resolution, per-site scoring, and site ranking.
 *
 * Design contract (Joshua, 2026-09-14):
 *  - The system pre-fills every item it can genuinely prove from Complyrer's
 *    own data. Those items are LOCKED: the auditor cannot change, skip, or
 *    dispute them. Auto-verification is pass-only — anything the system cannot
 *    prove stays auditor-scored (never an automatic fail).
 *  - The auditor scores the rest Yes / No / N/A, or skips an item (skipped =
 *    excluded from scoring, tracked as not-assessed).
 *  - DPMs and HMs may dispute an auditor-scored item with photo evidence + a
 *    note. The auditor approves (score flips) or rejects (score stands, reason
 *    recorded). Locked system items cannot be disputed.
 *  - Scoring: Yes = pass, No = fail, N/A and skipped excluded. Section scores
 *    plus one overall score per audit; critical fails are flagged as blockers
 *    regardless of the percentage.
 *  - Program sites are ranked by latest QA score (Joshua explicitly approved
 *    ranking on this surface).
 *
 * All checklist wording is Complyrer-original. Never copy LifePath's QA form
 * wording into this module. QA_COVERAGE_MAP (internal) records which original
 * topic each item covers, in paraphrase only.
 */
import { drillComplete, drillsForMonth } from "./monthlyChecks";
import type { EmergencyDrill } from "./monthlyChecks";

/* ------------------------------------------------------------------ */
/* Checklist definition (Complyrer-original wording)                   */
/* ------------------------------------------------------------------ */

export type QaAutoVerifyKind =
  | "drills_on_schedule"
  | "mileage_log_current"
  | "isp_ack_all_staff"
  | "delegations_all_staff"
  | "safety_report_filed";

export interface QaChecklistSection {
  id: string;
  title: string;
  blurb: string;
}

export interface QaChecklistItemDef {
  /** Stable key, e.g. "home.clean-odor-free". */
  id: string;
  sectionId: string;
  /** Complyrer-original item text shown to the auditor. */
  text: string;
  /** What the auditor should look for. */
  hint?: string;
  /** A "no" here is a blocker no matter the overall score. */
  critical?: boolean;
  /** Repeated once per individual at the site. */
  perIndividual?: boolean;
  /** When set, the system may lock in a passing result with evidence. */
  autoVerify?: QaAutoVerifyKind;
}

export const QA_SECTIONS: QaChecklistSection[] = [
  { id: "home", title: "Home environment", blurb: "What the home looks and feels like on the day." },
  { id: "safety", title: "Health & safety", blurb: "Safety equipment, supplies, and checks." },
  { id: "record", title: "Individual record", blurb: "One section per person living at the site." },
  { id: "emergency", title: "Emergency book", blurb: "The red book: plans, drills, and logs." },
  { id: "docs", title: "Other documentation", blurb: "Binders, postings, and service notes." },
  { id: "finance", title: "Finances", blurb: "Cash, spending funds, and receipts." },
  { id: "vehicle", title: "Vehicle", blurb: "Binder, equipment, and condition of the home vehicle." },
];

export const QA_ITEMS: QaChecklistItemDef[] = [
  // ---- Home environment (8) ----
  { id: "home.personalized-decor", sectionId: "home", text: "Living spaces feel personal and home-like", hint: "Decor reflects the people who live here" },
  { id: "home.clean-odor-free", sectionId: "home", text: "Home is clean and free of odors" },
  { id: "home.no-maintenance-hazards", sectionId: "home", text: "No outstanding maintenance or safety hazards" },
  { id: "home.individuals-neat-clean", sectionId: "home", text: "Individuals appear neat, clean, and well groomed" },
  { id: "home.no-phi-visible", sectionId: "home", text: "No protected health information visible in shared areas or trash", critical: true },
  { id: "home.no-med-labels-visible", sectionId: "home", text: "No medication labels or packaging left in view" },
  { id: "home.computer-secured", sectionId: "home", text: "Home computer is password protected with no records left open" },
  { id: "home.rights-limits-documented", sectionId: "home", text: "Any limits on individual rights are documented and approved", hint: "Locks, chimes, or other restrictions" },
  // ---- Health & safety (13) ----
  { id: "safety.evac-maps-posted", sectionId: "safety", text: "Evacuation maps are posted where everyone can see them" },
  { id: "safety.emergency-numbers-posted", sectionId: "safety", text: "Emergency numbers are posted, including the home address", hint: "911, poison control, HM, DPM, guardian" },
  { id: "safety.water-temp-log", sectionId: "safety", text: "Hot-water temperature checks are done and the log is current" },
  { id: "safety.detectors-tested", sectionId: "safety", text: "Smoke and carbon-monoxide detectors are tested with fresh batteries" },
  { id: "safety.extinguisher-inspected", sectionId: "safety", text: "Fire extinguisher is inspected and in date" },
  { id: "safety.flashlight", sectionId: "safety", text: "A working flashlight is available" },
  { id: "safety.first-aid-kit", sectionId: "safety", text: "First-aid kit is stocked and in date", critical: true },
  { id: "safety.cpr-shields", sectionId: "safety", text: "CPR face shields are available" },
  { id: "safety.vitals-equipment", sectionId: "safety", text: "Vitals equipment is on hand with spare batteries" },
  { id: "safety.food-supply", sectionId: "safety", text: "Enough food is on hand and nothing is expired" },
  { id: "safety.drinking-water", sectionId: "safety", text: "Fresh drinking water is available" },
  { id: "safety.prescribed-meds", sectionId: "safety", text: "All prescribed medications are on hand and in date" },
  { id: "safety.prn-meds", sectionId: "safety", text: "All as-needed (PRN) medications are on hand and in date" },
  // ---- Individual record (20, per individual) ----
  { id: "record.profile-current", sectionId: "record", perIndividual: true, text: "Profile has a current photo and up-to-date information" },
  { id: "record.guardianship", sectionId: "record", perIndividual: true, text: "Guardianship paperwork is on file" },
  { id: "record.identifying-docs", sectionId: "record", perIndividual: true, text: "Identifying documents are on file", hint: "Social Security card, birth certificate, benefits card" },
  { id: "record.insurance", sectionId: "record", perIndividual: true, text: "Health insurance information is on file" },
  { id: "record.guardian-consents", sectionId: "record", perIndividual: true, text: "Annual consents are signed by the guardian", hint: "Photos, social media, information sharing" },
  { id: "record.rights-signed", sectionId: "record", perIndividual: true, text: "Annual rights acknowledgment is signed by the guardian" },
  { id: "record.rights-limits-due-process", sectionId: "record", perIndividual: true, text: "Due process is documented for any rights limitations" },
  { id: "record.isp-signed", sectionId: "record", perIndividual: true, text: "Current ISP is signed by the individual, guardian, case manager, and provider", critical: true },
  { id: "record.isp-ack-all-staff", sectionId: "record", perIndividual: true, text: "Current ISP acknowledgment is signed by all staff", critical: true, autoVerify: "isp_ack_all_staff" },
  { id: "record.iep", sectionId: "record", perIndividual: true, text: "Current IEP is on file, if the individual attends school" },
  { id: "record.monthly-reviews", sectionId: "record", perIndividual: true, text: "Monthly reviews are signed and current" },
  { id: "record.rn-reviews", sectionId: "record", perIndividual: true, text: "Nursing reviews are signed and current" },
  { id: "record.assessments", sectionId: "record", perIndividual: true, text: "Assessments are on file and current" },
  { id: "record.annual-physical", sectionId: "record", perIndividual: true, text: "Annual physical is documented with the full physician report" },
  { id: "record.vision-dental", sectionId: "record", perIndividual: true, text: "Annual vision and dental records are on file" },
  { id: "record.immunizations", sectionId: "record", perIndividual: true, text: "Immunization records or declinations are current" },
  { id: "record.med-orders", sectionId: "record", perIndividual: true, text: "Current medication and medical-equipment orders are on file" },
  { id: "record.delegations-signed", sectionId: "record", perIndividual: true, text: "Nursing delegations are signed by all staff", autoVerify: "delegations_all_staff" },
  { id: "record.lease", sectionId: "record", perIndividual: true, text: "Signed lease or residency agreement is on file" },
  { id: "record.inventory", sectionId: "record", perIndividual: true, text: "Personal belongings inventory is kept current" },
  // ---- Emergency book (11) ----
  { id: "emergency.contacts", sectionId: "emergency", text: "Emergency contacts are current", hint: "House manager, DPM, guardian" },
  { id: "emergency.site-plans", sectionId: "emergency", text: "Site-specific emergency plans are on file", hint: "Including hazardous-material storage" },
  { id: "emergency.evac-map", sectionId: "emergency", text: "Evacuation map is in the book" },
  { id: "emergency.drills-on-schedule", sectionId: "emergency", text: "Emergency drills are completed on schedule", autoVerify: "drills_on_schedule" },
  { id: "emergency.new-admission-drills", sectionId: "emergency", text: "New admissions complete drills within the first week" },
  { id: "emergency.safety-report", sectionId: "emergency", text: "Monthly safety report is filed", autoVerify: "safety_report_filed" },
  { id: "emergency.cleaning-checklists", sectionId: "emergency", text: "Cleaning checklists are completed" },
  { id: "emergency.menus", sectionId: "emergency", text: "Menus are planned and posted" },
  { id: "emergency.census", sectionId: "emergency", text: "Daily census is recorded" },
  { id: "emergency.equipment-log", sectionId: "emergency", text: "Adaptive-equipment log is maintained" },
  { id: "emergency.meeting-minutes", sectionId: "emergency", text: "House-meeting and individual-meeting minutes are filed" },
  // ---- Other documentation (4) ----
  { id: "docs.policy-binder", sectionId: "docs", text: "Policy and procedure binder is available to staff" },
  { id: "docs.labor-posters", sectionId: "docs", text: "Labor-law postings are available to staff" },
  { id: "docs.notes-match-isp", sectionId: "docs", text: "Service notes tie back to ISP outcomes and goals" },
  { id: "docs.controlled-med-count", sectionId: "docs", text: "Controlled-medication counts are done and co-initialed by two staff" },
  // ---- Finances (3) ----
  { id: "finance.petty-cash", sectionId: "finance", text: "Petty cash and benefits-card access is controlled" },
  { id: "finance.personal-funds", sectionId: "finance", text: "Individuals can access their personal spending funds" },
  { id: "finance.receipts", sectionId: "finance", text: "Receipts are organized and complete" },
  // ---- Vehicle (15) ----
  { id: "vehicle.face-sheet", sectionId: "vehicle", text: "Vehicle binder has a current face sheet and health passport for each individual" },
  { id: "vehicle.mileage-log", sectionId: "vehicle", text: "Vehicle binder mileage log is current", autoVerify: "mileage_log_current" },
  { id: "vehicle.phone-numbers", sectionId: "vehicle", text: "Vehicle binder has current important phone numbers" },
  { id: "vehicle.emergency-procedure", sectionId: "vehicle", text: "Vehicle binder has the emergency preparedness procedure" },
  { id: "vehicle.accident-forms", sectionId: "vehicle", text: "Vehicle binder has accident forms and the individual-safety procedure" },
  { id: "vehicle.insurance", sectionId: "vehicle", text: "Vehicle binder has current insurance and registration" },
  { id: "vehicle.clean", sectionId: "vehicle", text: "Vehicle is clean and free of trash" },
  { id: "vehicle.first-aid-kit", sectionId: "vehicle", text: "Vehicle first-aid kit is stocked and in date", critical: true },
  { id: "vehicle.cpr-shields", sectionId: "vehicle", text: "CPR face shields are in the vehicle" },
  { id: "vehicle.flashlight", sectionId: "vehicle", text: "Flashlight is in the vehicle" },
  { id: "vehicle.ice-scraper", sectionId: "vehicle", text: "Ice scraper is in the vehicle" },
  { id: "vehicle.blankets-gloves", sectionId: "vehicle", text: "Emergency blankets and gloves are in the vehicle" },
  { id: "vehicle.fire-extinguisher", sectionId: "vehicle", text: "Fire extinguisher is in the vehicle (lift-equipped vehicles)" },
  { id: "vehicle.oil-change", sectionId: "vehicle", text: "Oil change is current" },
  { id: "vehicle.no-phi-visible", sectionId: "vehicle", text: "No PHI is visible inside the vehicle or through windows", critical: true },
];

/** Lookup of checklist item definitions by id. */
export const QA_ITEM_BY_ID: Record<string, QaChecklistItemDef> = Object.fromEntries(
  QA_ITEMS.map((item) => [item.id, item]),
);

/** Alias used by the API layers. */
export const QA_ITEM_MAP = QA_ITEM_BY_ID;

/**
 * INTERNAL coverage map — paraphrased original topics only, never original
 * wording. Proves no LifePath QA topic was dropped in the Complyrer rewrite.
 */
export const QA_COVERAGE_MAP: Record<string, string> = {
  "decor reflects residents": "home.personalized-decor",
  "cleanliness / odors": "home.clean-odor-free",
  "maintenance or safety concerns": "home.no-maintenance-hazards",
  "resident hygiene / appearance": "home.individuals-neat-clean",
  "PHI in common areas / trash": "home.no-phi-visible",
  "medication labels visible": "home.no-med-labels-visible",
  "computer password / open PHI": "home.computer-secured",
  "rights restrictions evidence": "home.rights-limits-documented",
  "evacuation maps posted": "safety.evac-maps-posted",
  "emergency numbers posted": "safety.emergency-numbers-posted",
  "water temperature checks": "safety.water-temp-log",
  "smoke / CO detector checks": "safety.detectors-tested",
  "fire extinguisher check": "safety.extinguisher-inspected",
  "flashlight": "safety.flashlight",
  "first aid kit / expiry": "safety.first-aid-kit",
  "CPR face shields": "safety.cpr-shields",
  "vitals equipment / batteries": "safety.vitals-equipment",
  "food supply / expirations": "safety.food-supply",
  "fresh water supply": "safety.drinking-water",
  "prescribed meds available": "safety.prescribed-meds",
  "PRN meds available": "safety.prn-meds",
  "profile with photo": "record.profile-current",
  "guardianship papers": "record.guardianship",
  "identifying documents": "record.identifying-docs",
  "health insurance info": "record.insurance",
  "guardian consents incl. photo/social media": "record.guardian-consents",
  "guardian-signed rights": "record.rights-signed",
  "due process for rights restrictions": "record.rights-limits-due-process",
  "ISP signed by all parties": "record.isp-signed",
  "ISP acknowledgment signed by all staff": "record.isp-ack-all-staff",
  "IEP if in school": "record.iep",
  "signed monthly reviews": "record.monthly-reviews",
  "signed RN reviews": "record.rn-reviews",
  "assessments": "record.assessments",
  "annual physical + physician report": "record.annual-physical",
  "vision and dental": "record.vision-dental",
  "immunizations / declinations": "record.immunizations",
  "medication / equipment orders": "record.med-orders",
  "nursing delegations signed": "record.delegations-signed",
  "signed lease": "record.lease",
  "inventory list": "record.inventory",
  "emergency phone numbers": "emergency.contacts",
  "site emergency plans / hazmat": "emergency.site-plans",
  "evacuation map copy": "emergency.evac-map",
  "drills per schedule": "emergency.drills-on-schedule",
  "new admission drills in 7 days": "emergency.new-admission-drills",
  "monthly safety report": "emergency.safety-report",
  "cleaning checklists": "emergency.cleaning-checklists",
  "menus": "emergency.menus",
  "daily census": "emergency.census",
  "adaptive equipment log": "emergency.equipment-log",
  "meeting minutes": "emergency.meeting-minutes",
  "policy binder": "docs.policy-binder",
  "labor law posters": "docs.labor-posters",
  "ISP data matches outcomes": "docs.notes-match-isp",
  "controlled med count dual-initialed": "docs.controlled-med-count",
  "petty cash / EBT access": "finance.petty-cash",
  "personal spending access": "finance.personal-funds",
  "receipts organized": "finance.receipts",
  "vehicle binder face sheet / health passport": "vehicle.face-sheet",
  "vehicle mileage log": "vehicle.mileage-log",
  "vehicle binder phone numbers": "vehicle.phone-numbers",
  "vehicle emergency procedure": "vehicle.emergency-procedure",
  "vehicle accident forms": "vehicle.accident-forms",
  "vehicle insurance / registration": "vehicle.insurance",
  "vehicle clean": "vehicle.clean",
  "vehicle first aid kit": "vehicle.first-aid-kit",
  "vehicle CPR shields": "vehicle.cpr-shields",
  "vehicle flashlight": "vehicle.flashlight",
  "vehicle ice scraper": "vehicle.ice-scraper",
  "vehicle blankets / gloves": "vehicle.blankets-gloves",
  "vehicle fire extinguisher": "vehicle.fire-extinguisher",
  "oil change current": "vehicle.oil-change",
  "PHI visible in vehicle": "vehicle.no-phi-visible",
};

/* ------------------------------------------------------------------ */
/* Audit state                                                         */
/* ------------------------------------------------------------------ */

export type QaItemSource = "system" | "auditor";
export type QaItemResult = "yes" | "no" | "na" | "skipped";
export type QaItemStatus = "pending" | "scored" | "disputed" | "resolved";
export type QaAuditStatus = "draft" | "in_progress" | "finalized";

export interface QaPhotoInput {
  id: string;
  name: string;
  /** Local: data URL. Hosted: data URL under the per-photo size cap. */
  dataUrl: string;
  capturedAt: string;
  capturedBy: string;
}

export interface QaDisputeResolution {
  approved: boolean;
  reason: string;
  resolvedBy: string;
  resolvedByName: string;
  resolvedAt: string;
}

export interface QaAuditItemState {
  /** Unique within the audit: item id, or `${itemId}::${individualId}`. */
  key: string;
  itemId: string;
  individualId: string | null;
  individualName: string | null;
  source: QaItemSource;
  /** System-verified items are locked: no scoring, skipping, or disputes. */
  locked: boolean;
  result: QaItemResult | null;
  comment: string;
  status: QaItemStatus;
  /** Human-readable proof for locked items, e.g. "3/3 required drills complete". */
  systemEvidence: string | null;
  scoredBy: string | null;
  scoredByName: string | null;
  scoredAt: string | null;
  /** Dispute raised by DPM/HM with photo evidence. */
  disputeNote: string | null;
  disputePhotos: QaPhotoInput[];
  disputeRaisedBy: string | null;
  disputeRaisedByName: string | null;
  disputeRaisedAt: string | null;
  disputeResolution: QaDisputeResolution | null;
  history: QaItemHistoryEntry[];
}

export interface QaItemHistoryEntry {
  at: string;
  actor: string;
  actorName: string;
  action: string;
  detail: string;
}

export interface QaAudit {
  id: string;
  agencyId: string;
  siteId: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  status: QaAuditStatus;
  auditorId: string | null;
  auditorName: string | null;
  auditorSignatureName: string | null;
  auditorSignatureMark: string | null;
  signedAt: string | null;
  score: QaScore | null;
  createdAt: string;
  updatedAt: string;
}

export interface QaSectionScore {
  pass: number;
  fail: number;
  excluded: number;
  /** 0-100, null when nothing was scored. */
  pct: number | null;
}

export interface QaScore {
  pass: number;
  fail: number;
  excluded: number;
  pct: number | null;
  /** Item keys of critical "no" answers — blockers regardless of pct. */
  criticalFails: string[];
  sections: Record<string, QaSectionScore>;
}

/** Stored QA item row: item state plus its row ids (local + hosted share this). */
export interface StoredQaAuditItem extends QaAuditItemState {
  id: string;
  auditId: string;
  agencyId: string;
}

export interface QaAuditSchedule {
  id: string;
  agencyId: string;
  siteId: string;
  /** ISO date of the next due audit. */
  nextDue: string;
  assignedAuditorId: string | null;
  assignedAuditorName: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QaRankedSite {
  siteId: string;
  siteName: string;
  /** Latest finalized score, 0-100 (null when never audited). */
  score: number | null;
  previousScore: number | null;
  /** score - previousScore, null when not comparable. */
  trend: number | null;
  criticalFails: number;
  auditId: string | null;
  finalizedAt: string | null;
  /** 1-based position after sorting (ties share nothing — strict order). */
  rank: number;
}

/* ------------------------------------------------------------------ */
/* Period helpers                                                      */
/* ------------------------------------------------------------------ */

export function qaQuarterMonths(year: number, quarter: number): string[] {
  const startMonth = (quarter - 1) * 3 + 1;
  return [0, 1, 2].map((offset) => {
    const month = startMonth + offset;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

export function qaPeriodLabel(year: number, quarter: 1 | 2 | 3 | 4): string {
  return `${year} Q${quarter}`;
}

export function qaItemKey(itemId: string, individualId: string | null): string {
  return individualId ? `${itemId}::${individualId}` : itemId;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

function emptySectionScore(): QaSectionScore {
  return { pass: 0, fail: 0, excluded: 0, pct: null };
}

function finalizeSectionScore(score: QaSectionScore): QaSectionScore {
  const decided = score.pass + score.fail;
  return { ...score, pct: decided > 0 ? Math.round((score.pass / decided) * 100) : null };
}

/**
 * Scores an audit's items. Yes = pass, No = fail. N/A, skipped, and
 * undecided items are excluded. Critical "no" answers are collected as
 * blockers regardless of the percentage.
 */
export function scoreQaAudit(items: QaAuditItemState[]): QaScore {
  const sections: Record<string, QaSectionScore> = {};
  for (const section of QA_SECTIONS) sections[section.id] = emptySectionScore();
  const criticalFails: string[] = [];
  let pass = 0;
  let fail = 0;
  let excluded = 0;

  for (const item of items) {
    const def = QA_ITEM_BY_ID[item.itemId];
    const section = sections[def?.sectionId ?? "home"] ?? (sections.home = emptySectionScore());
    if (item.result === "yes") {
      pass += 1;
      section.pass += 1;
    } else if (item.result === "no") {
      fail += 1;
      section.fail += 1;
      if (def?.critical) criticalFails.push(item.key);
    } else {
      excluded += 1;
      section.excluded += 1;
    }
  }

  const finalized: Record<string, QaSectionScore> = {};
  for (const [id, score] of Object.entries(sections)) finalized[id] = finalizeSectionScore(score);
  const decided = pass + fail;
  return {
    pass,
    fail,
    excluded,
    pct: decided > 0 ? Math.round((pass / decided) * 100) : null,
    criticalFails,
    sections: finalized,
  };
}

/**
 * Returns the item keys blocking finalization: unlocked items with no
 * result yet (disputed items count as decided — the auditor's score stands
 * until they resolve the dispute).
 */
export function qaUndecidedItems(items: QaAuditItemState[]): string[] {
  return items.filter((item) => !item.locked && (item.result === null || item.status === "disputed")).map((item) => item.key);
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Ranks program sites by latest QA score. Tie-breaks: improving trend first,
 * then fewer critical fails, then site name. Sites never audited sort last.
 */
export function rankQaSites(entries: Array<Omit<QaRankedSite, "rank">>): QaRankedSite[] {
  return [...entries]
    .sort((a, b) => {
      const aScore = a.score ?? -1;
      const bScore = b.score ?? -1;
      if (bScore !== aScore) return bScore - aScore;
      const aTrend = a.trend ?? 0;
      const bTrend = b.trend ?? 0;
      if (bTrend !== aTrend) return bTrend - aTrend;
      if (a.criticalFails !== b.criticalFails) return a.criticalFails - b.criticalFails;
      return a.siteName.localeCompare(b.siteName);
    })
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Auto-verification (pass-only, locked)                               */
/* ------------------------------------------------------------------ */

export interface QaAckRow {
  staffName: string;
  signedAt: string | null;
}

export interface QaAutoVerifyContext {
  siteId: string;
  months: string[];
  auditYear: number;
  drills: EmergencyDrill[];
  /** Minimal trip shape: site + ISO date. */
  trips: Array<{ siteId: string; date: string }>;
  /** Acknowledgment packets with their rows. */
  packets: Array<{ individualId: string; startsOn: string; rows: QaAckRow[] }>;
  /** Delegation assignments with their acknowledgment rows. */
  assignments: Array<{ individualId: string; status: string; acks: Array<{ signedAt: string | null }> }>;
  safetyReports: Array<{
    siteId: string;
    monthKey: string;
    lines: Array<{ dateChecked: string | null }>;
  }>;
}

export interface QaAutoVerifyPass {
  pass: true;
  evidence: string;
}

/**
 * Attempts to prove an auto-verifiable item from Complyrer's own data.
 * Returns a pass with human-readable evidence, or null when the system
 * cannot prove it — the item then stays auditor-scored. NEVER returns a
 * fail: absence of proof is not proof of failure.
 */
export function autoVerifyItem(
  kind: QaAutoVerifyKind,
  ctx: QaAutoVerifyContext,
  individualId: string | null,
): QaAutoVerifyPass | null {
  switch (kind) {
    case "drills_on_schedule": {
      const missing: string[] = [];
      let done = 0;
      let required = 0;
      for (const month of ctx.months) {
        const needed = drillsForMonth(month);
        required += needed.length;
        for (const type of needed) {
          const ok = ctx.drills.some(
            (d) => d.siteId === ctx.siteId && d.monthKey === month && d.drillType === type && drillComplete(d),
          );
          if (ok) done += 1;
          else missing.push(month);
        }
      }
      if (missing.length > 0) return null;
      return { pass: true, evidence: `${done}/${required} required drills complete across ${ctx.months.length} months` };
    }
    case "mileage_log_current": {
      for (const month of ctx.months) {
        const hasTrip = ctx.trips.some((t) => t.siteId === ctx.siteId && t.date.slice(0, 7) === month);
        if (!hasTrip) return null;
      }
      return { pass: true, evidence: `Trips logged in all ${ctx.months.length} months of the audit period` };
    }
    case "isp_ack_all_staff": {
      if (!individualId) return null;
      const packets = ctx.packets.filter(
        (p) => p.individualId === individualId && Number(p.startsOn.slice(0, 4)) === ctx.auditYear,
      );
      const fullySigned = packets.filter((p) => {
        const named = p.rows.filter((r) => r.staffName.trim().length > 0);
        return named.length > 0 && named.every((r) => r.signedAt);
      });
      if (fullySigned.length === 0) return null;
      const rows = fullySigned[0].rows.filter((r) => r.staffName.trim().length > 0).length;
      return { pass: true, evidence: `ISP acknowledgment signed by all ${rows} staff` };
    }
    case "delegations_all_staff": {
      if (!individualId) return null;
      const active = ctx.assignments.filter((a) => a.individualId === individualId && a.status === "assigned");
      if (active.length === 0) return null;
      const allSigned = active.every((a) => a.acks.length > 0 && a.acks.every((ack) => ack.signedAt));
      if (!allSigned) return null;
      return { pass: true, evidence: `All ${active.length} delegation assignment(s) signed by every assigned staff member` };
    }
    case "safety_report_filed": {
      for (const month of ctx.months) {
        const report = ctx.safetyReports.find((r) => r.siteId === ctx.siteId && r.monthKey === month);
        if (!report || report.lines.length === 0) return null;
        if (!report.lines.every((line) => line.dateChecked)) return null;
      }
      return { pass: true, evidence: `Safety reports filed with all lines checked for ${ctx.months.length} months` };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Item lifecycle (pure — the API layer persists + enforces roles)      */
/* ------------------------------------------------------------------ */

/** Build the initial (unscored, unlocked) item states for a site audit. */
export function buildQaAuditItems(
  individuals: Array<{ id: string; fullName: string }>,
): QaAuditItemState[] {
  const rows: QaAuditItemState[] = [];
  for (const def of QA_ITEMS) {
    if (def.perIndividual) {
      for (const person of individuals) {
        rows.push(blankQaItemState(def.id, person.id, person.fullName));
      }
    } else {
      rows.push(blankQaItemState(def.id, null, null));
    }
  }
  return rows;
}

/** Fresh item state for one checklist item. */
export function blankQaItemState(
  itemId: string,
  individualId: string | null,
  individualName: string | null,
): QaAuditItemState {
  return {
    key: qaItemKey(itemId, individualId),
    itemId,
    individualId,
    individualName,
    source: "auditor",
    locked: false,
    result: null,
    comment: "",
    status: "pending",
    systemEvidence: null,
    scoredBy: null,
    scoredByName: null,
    scoredAt: null,
    disputeNote: null,
    disputePhotos: [],
    disputeRaisedBy: null,
    disputeRaisedByName: null,
    disputeRaisedAt: null,
    disputeResolution: null,
    history: [],
  };
}

function historyEntry(actor: string, actorName: string, action: string, detail: string): QaItemHistoryEntry {
  return { at: new Date().toISOString(), actor, actorName, action, detail };
}

/** Applies a system pass to a fresh item row. Throws if misused. */
export function applySystemPass(
  item: QaAuditItemState,
  evidence: string,
  actorName = "Complyrer system",
): QaAuditItemState {
  const def = QA_ITEM_BY_ID[item.itemId];
  if (!def?.autoVerify) throw new Error("Item is not system-verifiable.");
  if (item.locked) throw new Error("Item is already locked.");
  return {
    ...item,
    source: "system",
    locked: true,
    result: "yes",
    systemEvidence: evidence,
    status: "scored",
    scoredBy: "system",
    scoredByName: actorName,
    scoredAt: new Date().toISOString(),
    history: [...item.history, historyEntry("system", actorName, "system_verified", evidence)],
  };
}

/** Auditor scores an unlocked item. Locked items throw — enforced here and in the API. */
export function scoreQaItemState(
  item: QaAuditItemState,
  result: QaItemResult,
  comment: string,
  auditorId: string,
  auditorName: string,
): QaAuditItemState {
  if (item.locked) throw new Error("System-verified items are locked and cannot be scored.");
  if (item.status === "disputed") throw new Error("Resolve the open dispute before re-scoring.");
  const action = result === "skipped" ? "skipped" : "scored";
  return {
    ...item,
    source: "auditor",
    result,
    comment,
    status: "scored",
    scoredBy: auditorId,
    scoredByName: auditorName,
    scoredAt: new Date().toISOString(),
    history: [...item.history, historyEntry(auditorId, auditorName, action, `${result}${comment ? ` — ${comment}` : ""}`)],
  };
}

/** Auditor skips an unlocked item: excluded from scoring, tracked as not-assessed. */
export function skipQaItemState(
  item: QaAuditItemState,
  skipped: boolean,
  auditorId: string,
  auditorName: string,
): QaAuditItemState {
  if (item.locked) throw new Error("System-verified items are locked and cannot be skipped.");
  if (skipped) {
    return {
      ...item,
      result: "skipped",
      status: "scored",
      scoredBy: auditorId,
      scoredByName: auditorName,
      scoredAt: new Date().toISOString(),
      history: [...item.history, historyEntry(auditorId, auditorName, "skipped", "Excluded from scoring — not assessed")],
    };
  }
  return {
    ...item,
    result: null,
    status: "pending",
    history: [...item.history, historyEntry(auditorId, auditorName, "unskipped", "Returned to pending")],
  };
}

/**
 * DPM/HM raises a dispute on an auditor-scored item with photo evidence.
 * Locked system items cannot be disputed — they are system facts.
 */
export function raiseQaDisputeState(
  item: QaAuditItemState,
  note: string,
  photos: QaPhotoInput[],
  raiserId: string,
  raiserName: string,
): QaAuditItemState {
  if (item.locked) throw new Error("System-verified items cannot be disputed.");
  if (item.source !== "auditor" || item.result === null) {
    throw new Error("Only scored items can be disputed.");
  }
  if (item.status === "disputed") throw new Error("A dispute is already open on this item.");
  if (!note.trim()) throw new Error("A dispute needs a note explaining the challenge.");
  if (photos.length === 0) throw new Error("A dispute needs at least one photo as evidence.");
  return {
    ...item,
    status: "disputed",
    disputeNote: note.trim(),
    disputePhotos: photos,
    disputeRaisedBy: raiserId,
    disputeRaisedByName: raiserName,
    disputeRaisedAt: new Date().toISOString(),
    disputeResolution: null,
    history: [
      ...item.history,
      historyEntry(raiserId, raiserName, "dispute_raised", `${note.trim()} (${photos.length} photo${photos.length === 1 ? "" : "s"})`),
    ],
  };
}

/**
 * The auditor resolves a dispute. Approving flips a "no" to "yes";
 * rejecting keeps the score and records the reason.
 */
export function resolveQaDisputeState(
  item: QaAuditItemState,
  approve: boolean,
  reason: string,
  resolverId: string,
  resolverName: string,
): QaAuditItemState {
  if (item.status !== "disputed") throw new Error("No open dispute on this item.");
  if (!reason.trim()) throw new Error("A resolution needs a recorded reason.");
  const flipped = approve && item.result === "no";
  return {
    ...item,
    status: "resolved",
    result: flipped ? "yes" : item.result,
    disputeResolution: {
      approved: approve,
      reason: reason.trim(),
      resolvedBy: resolverId,
      resolvedByName: resolverName,
      resolvedAt: new Date().toISOString(),
    },
    history: [
      ...item.history,
      historyEntry(
        resolverId,
        resolverName,
        approve ? "dispute_approved" : "dispute_rejected",
        `${reason.trim()}${flipped ? " — score corrected to yes" : ""}`,
      ),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/** Default cadence: one QA audit per site per quarter. */
export function nextQaDueDate(fromIso: string): string {
  const day = Number(fromIso.slice(8, 10));
  let year = Number(fromIso.slice(0, 4));
  let month = Number(fromIso.slice(5, 7)) + 3;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  // Clamp to the last day of the target month (e.g. Nov 30 -> Feb 28).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clamped = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

export type QaScheduleTone = "current" | "due_soon" | "overdue";

export function qaScheduleTone(nextDue: string, todayIso: string): QaScheduleTone {
  if (todayIso > nextDue) return "overdue";
  const msPerDay = 86400000;
  const days = Math.round((new Date(nextDue).getTime() - new Date(todayIso).getTime()) / msPerDay);
  return days <= 14 ? "due_soon" : "current";
}

/** Max photo payload per dispute photo (hosted jsonb guardrail). */
export const QA_MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export function qaFileName(siteName: string, year: number, quarter: number): string {
  const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site";
  return `complyrer-qa-audit-${slug}-${year}-q${quarter}.pdf`;
}
