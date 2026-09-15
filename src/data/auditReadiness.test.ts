/**
 * auditReadiness.test.ts — readiness checklist logic: item statuses,
 * readiness % math (unknowns excluded), unknown rule names, and the
 * category grouping.
 *
 * Run: node --import tsx --test src/data/auditReadiness.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_RULES,
  evaluateReadiness,
  readinessByCategory,
  readinessCounts,
  readinessPercent,
  type ReadinessEvidence,
} from "./auditReadiness";
import { DMH_REQUIREMENTS } from "./dmhRequirements";

const NOW = new Date("2026-09-14T12:00:00Z");

function evidence(overrides: Partial<ReadinessEvidence> = {}): ReadinessEvidence {
  return {
    providerCertificate: null,
    administrator: null,
    staffTraining: [],
    medAides: [],
    incidents: [],
    correctiveActions: [],
    pocSurveyExitOn: null,
    pocSubmittedOn: null,
    pocFinalCorrectionOn: null,
    ...overrides,
  };
}

test("readiness: every requirement's checkRule is implemented", () => {
  const missing = DMH_REQUIREMENTS.filter((item) => !CHECK_RULES[item.checkRule]);
  assert.deepEqual(
    missing.map((item) => item.id),
    [],
    "all checkRules resolve to a checker",
  );
});

test("readiness: empty evidence evaluates to unknown, % is null (never fake)", () => {
  const results = evaluateReadiness(evidence(), DMH_REQUIREMENTS, NOW);
  assert.ok(results.every((row) => row.status === "unknown"));
  assert.equal(readinessPercent(results), null);
});

test("readiness: % counts met over evaluated only", () => {
  const results = evaluateReadiness(
    evidence({
      providerCertificate: { expiresOn: "2028-01-01", recertificationSubmittedOn: null },
      administrator: { degreeOnFile: true, ddSupervisoryYears: 3, qmrpBackupNamed: true },
    }),
    DMH_REQUIREMENTS,
    NOW,
  );
  const counts = readinessCounts(results);
  // providerCertificateCurrent=met, recertificationFiledOnTime=met (window not open),
  // certificationPeriodTwoYears=met, administratorQualified=met.
  assert.equal(counts.met, 4);
  assert.equal(counts.unknown, DMH_REQUIREMENTS.length - 4);
  assert.equal(readinessPercent(results), 100);
});

test("readiness: unmet items drag the % down", () => {
  const results = evaluateReadiness(
    evidence({
      providerCertificate: { expiresOn: "2026-08-01", recertificationSubmittedOn: null },
    }),
    DMH_REQUIREMENTS,
    NOW,
  );
  const byId = Object.fromEntries(results.map((row) => [row.requirement.id, row]));
  assert.equal(byId["provider-certification-olc"].status, "unmet");
  assert.equal(byId["recertification-filed-60-days"].status, "unmet");
  assert.equal(readinessPercent(results), 0);
});

test("readiness: expiring certificate is at-risk, not unmet", () => {
  const results = evaluateReadiness(
    evidence({
      providerCertificate: { expiresOn: "2026-10-14", recertificationSubmittedOn: null },
    }),
    DMH_REQUIREMENTS,
    NOW,
  );
  const byId = Object.fromEntries(results.map((row) => [row.requirement.id, row]));
  assert.equal(byId["provider-certification-olc"].status, "at-risk");
  // 60-day filing rule: 30d remaining, no application -> unmet.
  assert.equal(byId["recertification-filed-60-days"].status, "unmet");
});

test("readiness: FCSR rule enforces the 15-day window for post-2009 hires", () => {
  const staff = {
    userId: "u1",
    name: "Ava",
    hireDate: "2026-01-10",
    abuseNeglectOn: null,
    hipaaOn: null,
    eventReportingOn: null,
    firstAidCprExpiresOn: null,
    fcsrAppliedOn: "2026-01-20",
    personnelEligibilityOnFile: true,
    trainingDocsComplete: true,
  };
  const ok = evaluateReadiness(evidence({ staffTraining: [staff] }), DMH_REQUIREMENTS, NOW);
  assert.equal(
    ok.find((row) => row.requirement.id === "fcsr-background-check")!.status,
    "met",
  );
  const late = evaluateReadiness(
    evidence({ staffTraining: [{ ...staff, fcsrAppliedOn: "2026-02-10" }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    late.find((row) => row.requirement.id === "fcsr-background-check")!.status,
    "unmet",
  );
  // Pre-2009 hire is out of scope -> unknown, not unmet.
  const old = evaluateReadiness(
    evidence({ staffTraining: [{ ...staff, hireDate: "2005-03-01", fcsrAppliedOn: null }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    old.find((row) => row.requirement.id === "fcsr-background-check")!.status,
    "unknown",
  );
});

test("readiness: med-aide scope rule is an absolute prohibition (no RN-delegation exception)", () => {
  const aide = {
    userId: "u1",
    name: "Ben",
    courseCompletedOn: "2024-01-01",
    certificateOn: "2024-02-01",
    retrainingDueOn: "2028-02-01",
    administersInsulinOrTubeFeeds: true,
  };
  // The verified rule (9 CSR 45-3.070(1)) does not permit medication aides to
  // administer insulin or tube-feeding medications. The RN-delegation
  // exception was never verified, so it cannot make this compliant.
  const results = evaluateReadiness(evidence({ medAides: [aide] }), DMH_REQUIREMENTS, NOW);
  assert.equal(
    results.find((row) => row.requirement.id === "med-aide-scope-limits")!.status,
    "unmet",
  );
  const clean = evaluateReadiness(
    evidence({ medAides: [{ ...aide, administersInsulinOrTubeFeeds: false }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    clean.find((row) => row.requirement.id === "med-aide-scope-limits")!.status,
    "met",
  );
});

test("readiness: incident timelines — critical same-day, standard next-business-day", () => {
  const critical = {
    id: "i1",
    severity: "critical" as const,
    occurredOn: "2026-09-14",
    reportedOn: "2026-09-14",
    parentGuardianNotifiedOn: "2026-09-14",
    followupOn: null,
  };
  const met = evaluateReadiness(evidence({ incidents: [critical] }), DMH_REQUIREMENTS, NOW);
  assert.equal(
    met.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "met",
  );
  const lateCritical = evaluateReadiness(
    evidence({
      incidents: [{ ...critical, reportedOn: "2026-09-15", parentGuardianNotifiedOn: null }],
    }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    lateCritical.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "unmet",
  );
});

test("readiness: standard incidents use real next-business-day deadlines", () => {
  const standard = {
    id: "i2",
    severity: "standard" as const,
    occurredOn: "2026-09-11", // Friday
    reportedOn: "2026-09-12", // Saturday — within the Monday deadline
    parentGuardianNotifiedOn: null,
    followupOn: null,
  };
  // Friday occurrence, filed Saturday: next business day is Monday 2026-09-14.
  const onTime = evaluateReadiness(evidence({ incidents: [standard] }), DMH_REQUIREMENTS, NOW);
  assert.equal(
    onTime.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "met",
  );
  // Filed Tuesday: past the Monday deadline.
  const late = evaluateReadiness(
    evidence({ incidents: [{ ...standard, reportedOn: "2026-09-15" }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    late.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "unmet",
  );
  // Sunday occurrence is due Monday.
  const sunday = evaluateReadiness(
    evidence({ incidents: [{ ...standard, occurredOn: "2026-09-13", reportedOn: "2026-09-14" }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    sunday.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "met",
  );
  // Saturday occurrence filed Tuesday is PAST Monday's deadline. The old
  // 3-calendar-day approximation wrongly called this on time.
  const weekendLate = evaluateReadiness(
    evidence({ incidents: [{ ...standard, occurredOn: "2026-09-12", reportedOn: "2026-09-15" }] }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    weekendLate.find((row) => row.requirement.id === "event-reporting-timelines")!.status,
    "unmet",
  );
});

test("readiness: POC 180-day window enforced", () => {
  const inFlight = evaluateReadiness(
    evidence({ pocSurveyExitOn: "2026-09-01", pocSubmittedOn: "2026-09-10", pocFinalCorrectionOn: null }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    inFlight.find((row) => row.requirement.id === "plan-of-correction")!.status,
    "met",
  );
  const blown = evaluateReadiness(
    evidence({ pocSurveyExitOn: "2026-01-01", pocSubmittedOn: "2026-02-01", pocFinalCorrectionOn: null }),
    DMH_REQUIREMENTS,
    NOW,
  );
  assert.equal(
    blown.find((row) => row.requirement.id === "plan-of-correction")!.status,
    "unmet",
  );
});

test("readiness: unknown checkRule names evaluate to unknown, never met", () => {
  const results = evaluateReadiness(
    evidence(),
    [
      {
        id: "future-item",
        title: "Future",
        category: "training",
        evidence: "TBD",
        checkRule: "notImplementedYet",
        cite: "9 CSR 99-9.999",
        verified: true,
      },
    ],
    NOW,
  );
  assert.equal(results[0].status, "unknown");
  assert.equal(readinessPercent(results), null);
});

test("readiness: category grouping covers every requirement once", () => {
  const results = evaluateReadiness(evidence(), DMH_REQUIREMENTS, NOW);
  const grouped = readinessByCategory(results);
  const seen = grouped.flatMap((group) => group.items.map((row) => row.requirement.id));
  assert.deepEqual([...seen].sort(), DMH_REQUIREMENTS.map((item) => item.id).sort());
  for (const group of grouped) {
    assert.ok(group.items.length > 0, `category ${group.key} is not empty`);
  }
});
