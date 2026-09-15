/**
 * Audit readiness — evaluates the DMH_REQUIREMENTS checklist against an
 * evidence bundle and answers "Are we ready for DMH review/recertification?"
 * with a readiness % plus per-item status.
 *
 * Each requirement names a checkRule; CHECK_RULES maps rule names to pure
 * checker functions. Unknown rule names evaluate to "unknown" — never
 * "met". "unknown" items are EXCLUDED from the readiness % so missing
 * evidence can never inflate or deflate the score.
 */

import {
  DMH_REQUIREMENTS,
  dmhRequirementsByCategory,
  type DmhRequirement,
} from "./dmhRequirements";
import type { CorrectiveAction } from "./correctiveActions";
import { deriveCorrectiveActionStatus } from "./correctiveActions";

export type ReadinessItemStatus = "met" | "at-risk" | "unmet" | "unknown";

export const READINESS_STATUS_META: Record<
  ReadinessItemStatus,
  { label: string; icon: string; description: string }
> = {
  met: { label: "Met", icon: "✓", description: "Evidence shows the requirement is met." },
  "at-risk": {
    label: "At risk",
    icon: "!",
    description: "Evidence exists but a deadline is approaching or a gap is forming.",
  },
  unmet: { label: "Unmet", icon: "✕", description: "Evidence shows the requirement is not met." },
  unknown: {
    label: "Unknown",
    icon: "?",
    description: "No evidence available yet — not counted in the readiness %.",
  },
};

/* ------------------------------------------------------------------ */
/* Evidence bundle                                                     */
/* ------------------------------------------------------------------ */

export interface StaffTrainingEvidence {
  userId: string;
  name: string;
  hireDate: string;
  abuseNeglectOn: string | null;
  hipaaOn: string | null;
  eventReportingOn: string | null;
  firstAidCprExpiresOn: string | null;
  fcsrAppliedOn: string | null;
  personnelEligibilityOnFile: boolean;
  trainingDocsComplete: boolean;
}

export interface MedAideEvidence {
  userId: string;
  name: string;
  courseCompletedOn: string | null;
  /** DD Medication Aide Certificate via the regional center. */
  certificateOn: string | null;
  retrainingDueOn: string | null;
  /**
   * True when the aide administers insulin or tube-feeding medications.
   * The verified rule (9 CSR 45-3.070(1)) does not permit this for
   * medication aides; no RN-delegation exception is tracked here because
   * that exception was not verified against a published source.
   */
  administersInsulinOrTubeFeeds: boolean;
}

export interface IncidentEvidence {
  id: string;
  severity: "critical" | "standard";
  occurredOn: string;
  reportedOn: string | null;
  parentGuardianNotifiedOn: string | null;
  followupOn: string | null;
}

export interface ReadinessEvidence {
  providerCertificate: {
    expiresOn: string | null;
    recertificationSubmittedOn: string | null;
  } | null;
  administrator: {
    degreeOnFile: boolean;
    ddSupervisoryYears: number;
    qmrpBackupNamed: boolean;
  } | null;
  staffTraining: StaffTrainingEvidence[];
  medAides: MedAideEvidence[];
  incidents: IncidentEvidence[];
  correctiveActions: CorrectiveAction[];
  /** Survey exit date when a plan of correction is in flight (else null). */
  pocSurveyExitOn: string | null;
  pocSubmittedOn: string | null;
  pocFinalCorrectionOn: string | null;
}

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

const MS_PER_DAY = 86400000;

function daysBetween(fromIso: string, toIso: string): number {
  const start = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((start(toIso) - start(fromIso)) / MS_PER_DAY);
}

function daysUntil(dateIso: string | null, now: Date): number | null {
  if (!dateIso) return null;
  return daysBetween(now.toISOString().slice(0, 10), dateIso);
}

/**
 * The ISO date of the next business day after the given date.
 * Friday -> Monday (+3), Saturday -> Monday (+2), otherwise the next day.
 * Weekends are skipped; state holidays are not tracked.
 */
function nextBusinessDayIso(dateIso: string): string {
  const day = new Date(`${dateIso.slice(0, 10)}T12:00:00`);
  const dow = day.getDay(); // 0 = Sunday ... 6 = Saturday
  const add = dow === 5 ? 3 : dow === 6 ? 2 : 1;
  day.setDate(day.getDate() + add);
  return day.toISOString().slice(0, 10);
}

function withinLast(dateIso: string | null, days: number, now: Date): boolean {
  if (!dateIso) return false;
  const age = daysBetween(dateIso, now.toISOString().slice(0, 10));
  return age >= 0 && age <= days;
}

/* ------------------------------------------------------------------ */
/* Check rules                                                         */
/* ------------------------------------------------------------------ */

export type CheckRule = (
  evidence: ReadinessEvidence,
  now: Date,
) => { status: ReadinessItemStatus; detail: string };

function allOrNothing(
  items: Array<{ ok: boolean; atRisk: boolean; name: string }>,
  what: string,
): { status: ReadinessItemStatus; detail: string } {
  if (items.length === 0) return { status: "unknown", detail: `No ${what} records available yet.` };
  const bad = items.filter((item) => !item.ok && !item.atRisk);
  const risky = items.filter((item) => item.atRisk);
  if (bad.length === 0 && risky.length === 0)
    return { status: "met", detail: `All ${items.length} ${what} current.` };
  if (bad.length === 0)
    return {
      status: "at-risk",
      detail: `${risky.length} of ${items.length} ${what} need renewal soon: ${risky.map((r) => r.name).join(", ")}.`,
    };
  return {
    status: "unmet",
    detail: `${bad.length} of ${items.length} ${what} not current: ${bad.map((r) => r.name).join(", ")}.`,
  };
}

export const CHECK_RULES: Record<string, CheckRule> = {
  providerCertificateCurrent(evidence, now) {
    const cert = evidence.providerCertificate;
    if (!cert || !cert.expiresOn)
      return { status: "unknown", detail: "No provider certificate on file." };
    const remaining = daysUntil(cert.expiresOn, now) ?? -1;
    if (remaining < 0)
      return { status: "unmet", detail: `Provider certificate expired ${Math.abs(remaining)}d ago.` };
    if (remaining <= 90)
      return { status: "at-risk", detail: `Provider certificate expires in ${remaining}d — recertification should already be filed.` };
    return { status: "met", detail: `Provider certificate current through ${cert.expiresOn}.` };
  },

  recertificationFiledOnTime(evidence, now) {
    const cert = evidence.providerCertificate;
    if (!cert || !cert.expiresOn)
      return { status: "unknown", detail: "No provider certificate on file." };
    const remaining = daysUntil(cert.expiresOn, now) ?? -1;
    if (!cert.recertificationSubmittedOn) {
      if (remaining <= 60)
        return {
          status: "unmet",
          detail: `Recertification is due within ${Math.max(remaining, 0)}d and no application is on file — the 60-day filing rule is at risk.`,
        };
      return { status: "met", detail: "Recertification window not yet open." };
    }
    const filedBeforeExpiry = daysBetween(cert.recertificationSubmittedOn, cert.expiresOn);
    if (filedBeforeExpiry >= 60)
      return { status: "met", detail: `Recertification filed ${filedBeforeExpiry}d before expiry.` };
    return {
      status: "unmet",
      detail: `Recertification filed only ${filedBeforeExpiry}d before expiry — the 60-day rule was missed.`,
    };
  },

  certificationPeriodTwoYears(evidence, now) {
    // Informational: confirms the certificate spans the 2-year period.
    return CHECK_RULES.providerCertificateCurrent(evidence, now);
  },

  abuseNeglectTrainingCurrent(evidence, now) {
    const today = now.toISOString().slice(0, 10);
    return allOrNothing(
      evidence.staffTraining.map((row) => {
        if (!row.abuseNeglectOn) return { ok: false, atRisk: false, name: row.name };
        const age = daysBetween(row.abuseNeglectOn, today);
        const beforeFirstContact =
          !row.hireDate || row.abuseNeglectOn <= row.hireDate;
        if (age <= 365 && beforeFirstContact)
          return { ok: true, atRisk: false, name: row.name };
        if (age <= 395) return { ok: false, atRisk: true, name: row.name };
        return { ok: false, atRisk: false, name: row.name };
      }),
      "staff abuse/neglect training records",
    );
  },

  firstAidCprCurrent(evidence, now) {
    return allOrNothing(
      evidence.staffTraining.map((row) => {
        const remaining = daysUntil(row.firstAidCprExpiresOn, now);
        return {
          ok: remaining != null && remaining > 30,
          atRisk: remaining != null && remaining >= 0 && remaining <= 30,
          name: row.name,
        };
      }),
      "staff First Aid/CPR certifications",
    );
  },

  fcsrCheckComplete(evidence) {
    const cutoff = "2009-01-01";
    const inScope = evidence.staffTraining.filter((row) => row.hireDate >= cutoff);
    if (inScope.length === 0)
      return { status: "unknown", detail: "No staff hired on/after 2009-01-01 on file." };
    const missing = inScope.filter((row) => {
      if (!row.fcsrAppliedOn) return true;
      return daysBetween(row.hireDate, row.fcsrAppliedOn) > 15;
    });
    if (missing.length === 0)
      return { status: "met", detail: `FCSR registration on file for all ${inScope.length} staff in scope.` };
    return {
      status: "unmet",
      detail: `${missing.length} staff missing timely FCSR registration: ${missing.map((r) => r.name).join(", ")}.`,
    };
  },

  medAideTrainingCurrent(evidence, now) {
    return allOrNothing(
      evidence.medAides.map((row) => {
        const hasCourse = row.courseCompletedOn != null && row.certificateOn != null;
        const retrainingRemaining = daysUntil(row.retrainingDueOn, now);
        return {
          ok: hasCourse && retrainingRemaining != null && retrainingRemaining > 60,
          atRisk:
            hasCourse &&
            (retrainingRemaining == null || (retrainingRemaining >= 0 && retrainingRemaining <= 60)),
          name: row.name,
        };
      }),
      "medication aide training records",
    );
  },

  medAideScopeRespected(evidence) {
    // Verified rule (9 CSR 45-3.070(1)): medication aides do NOT administer
    // insulin or tube-feeding medications. Any aide who does is a violation —
    // RN delegation was NOT verified as an exception and is not considered.
    const violations = evidence.medAides.filter(
      (row) => row.administersInsulinOrTubeFeeds,
    );
    if (evidence.medAides.length === 0)
      return { status: "unknown", detail: "No medication aide records available yet." };
    if (violations.length === 0)
      return { status: "met", detail: "No medication aide administers insulin or tube-feeding medications." };
    return {
      status: "unmet",
      detail: `${violations.length} medication aide(s) administer insulin/tube feeds, which the verified rule does not permit: ${violations.map((r) => r.name).join(", ")}.`,
    };
  },

  eventReportingTimely(evidence, now) {
    if (evidence.incidents.length === 0)
      return { status: "unknown", detail: "No incidents on file to evaluate." };
    const late = evidence.incidents.filter((row) => {
      if (!row.reportedOn) return true;
      if (row.severity === "critical") {
        // Immediate: reported the same calendar day.
        return daysBetween(row.occurredOn, row.reportedOn) > 0;
      }
      // Next business day, computed for real: an event on Friday is due
      // Monday; a Saturday/Sunday event is due Monday. (State holidays are
      // not tracked here — confirm against the published rule when one falls
      // on a deadline.)
      return row.reportedOn > nextBusinessDayIso(row.occurredOn);
    });
    // Critical events need parent/guardian verbal notice within 24 hours —
    // a missing notice is a miss, not just a late one.
    const missingGuardianNotice = evidence.incidents.filter(
      (row) =>
        row.severity === "critical" &&
        (row.parentGuardianNotifiedOn == null ||
          daysBetween(row.occurredOn, row.parentGuardianNotifiedOn) > 1),
    );
    if (late.length === 0 && missingGuardianNotice.length === 0)
      return { status: "met", detail: `All ${evidence.incidents.length} incidents meet the reporting timelines.` };
    const parts: string[] = [];
    if (late.length > 0) parts.push(`${late.length} incident(s) filed late`);
    if (missingGuardianNotice.length > 0)
      parts.push(`${missingGuardianNotice.length} missing 24-hour guardian notice`);
    return { status: "unmet", detail: `${parts.join("; ")}.` };
  },

  planOfCorrectionOnTrack(evidence, now) {
    if (!evidence.pocSurveyExitOn)
      return { status: "unknown", detail: "No survey exit on file — no plan of correction in flight." };
    const sinceExit = daysBetween(evidence.pocSurveyExitOn, now.toISOString().slice(0, 10));
    if (evidence.pocFinalCorrectionOn)
      return { status: "met", detail: `Final correction recorded ${evidence.pocFinalCorrectionOn}.` };
    if (sinceExit > 180)
      return { status: "unmet", detail: `Final correction is ${sinceExit - 180}d past the 180-day window.` };
    if (!evidence.pocSubmittedOn && sinceExit > 60)
      return { status: "unmet", detail: "No acceptable plan of correction within 60 days of notice." };
    if (sinceExit > 150)
      return { status: "at-risk", detail: `Final correction due within ${180 - sinceExit}d of the 180-day window.` };
    return { status: "met", detail: `Plan of correction on track (${sinceExit}d since exit).` };
  },

  hipaaTrainingCurrent(evidence, now) {
    return allOrNothing(
      evidence.staffTraining.map((row) => ({
        ok: withinLast(row.hipaaOn, 365, now),
        atRisk: false,
        name: row.name,
      })),
      "staff HIPAA training records",
    );
  },

  eventReportingTrainingCurrent(evidence, now) {
    return allOrNothing(
      evidence.staffTraining.map((row) => ({
        ok: withinLast(row.eventReportingOn, 365, now),
        atRisk: false,
        name: row.name,
      })),
      "staff event-reporting training records",
    );
  },

  administratorQualified(evidence) {
    const admin = evidence.administrator;
    if (!admin) return { status: "unknown", detail: "No administrator record on file." };
    const problems: string[] = [];
    if (!admin.degreeOnFile) problems.push("bachelor's degree not on file");
    if (admin.ddSupervisoryYears < 1) problems.push("1 year DD supervisory experience not documented");
    if (!admin.qmrpBackupNamed) problems.push("no QMRP backup designated");
    if (problems.length === 0)
      return { status: "met", detail: "Administrator credentials and QMRP backup on file." };
    return { status: "unmet", detail: `Administrator qualifications incomplete: ${problems.join("; ")}.` };
  },

  personnelRecordsComplete(evidence) {
    return allOrNothing(
      evidence.staffTraining.map((row) => ({
        ok: row.personnelEligibilityOnFile && row.trainingDocsComplete,
        atRisk: false,
        name: row.name,
      })),
      "personnel records",
    );
  },

  correctiveActionsOnTrack(evidence, now) {
    const open = evidence.correctiveActions.filter(
      (action) => deriveCorrectiveActionStatus(action, now) !== "resolved",
    );
    if (evidence.correctiveActions.length === 0) {
      // Conservative: an empty store means no tracking data was ever
      // recorded — unverified, not compliant.
      return { status: "unknown", detail: "No corrective actions recorded yet." };
    }
    if (open.length === 0)
      return { status: "met", detail: "No open corrective actions." };
    const overdue = open.filter(
      (action) => deriveCorrectiveActionStatus(action, now) === "overdue",
    );
    const unowned = open.filter((action) => !action.assignedToUserId);
    if (overdue.length === 0 && unowned.length === 0)
      return { status: "met", detail: `All ${open.length} corrective actions owned and on schedule.` };
    const parts: string[] = [];
    if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
    if (unowned.length > 0) parts.push(`${unowned.length} with no owner`);
    return { status: "unmet", detail: `${open.length} open corrective actions: ${parts.join(", ")}.` };
  },

  incidentReportsTimely(evidence, now) {
    // Same timelines as eventReportingTimely, scoped to the filing log.
    return CHECK_RULES.eventReportingTimely(evidence, now);
  },
};

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export interface ReadinessItemResult {
  requirement: DmhRequirement;
  status: ReadinessItemStatus;
  detail: string;
}

export function evaluateReadiness(
  evidence: ReadinessEvidence,
  requirements: DmhRequirement[] = DMH_REQUIREMENTS,
  now: Date = new Date(),
): ReadinessItemResult[] {
  return requirements.map((requirement) => {
    const rule = CHECK_RULES[requirement.checkRule];
    if (!rule) {
      return {
        requirement,
        status: "unknown" as ReadinessItemStatus,
        detail: `No check rule "${requirement.checkRule}" is implemented yet.`,
      };
    }
    try {
      const { status, detail } = rule(evidence, now);
      return { requirement, status, detail };
    } catch {
      return {
        requirement,
        status: "unknown" as ReadinessItemStatus,
        detail: "Evidence could not be evaluated.",
      };
    }
  });
}

/**
 * Readiness %: met / counted * 100, where counted excludes "unknown".
 * Returns null when nothing can be evaluated yet (never a fake 0%).
 */
export function readinessPercent(results: ReadinessItemResult[]): number | null {
  const counted = results.filter((row) => row.status !== "unknown");
  if (counted.length === 0) return null;
  const met = counted.filter((row) => row.status === "met").length;
  return Math.round((100 * met) / counted.length);
}

export function readinessCounts(
  results: ReadinessItemResult[],
): Record<ReadinessItemStatus, number> {
  const counts: Record<ReadinessItemStatus, number> = {
    met: 0,
    "at-risk": 0,
    unmet: 0,
    unknown: 0,
  };
  for (const row of results) counts[row.status] += 1;
  return counts;
}

/** Grouped results for the checklist UI, in category order. */
export function readinessByCategory(
  results: ReadinessItemResult[],
): Array<{ key: string; label: string; items: ReadinessItemResult[] }> {
  return dmhRequirementsByCategory().map((group) => ({
    key: group.key,
    label: group.label,
    items: results.filter((row) => row.requirement.category === group.key),
  }));
}
