/**
 * Health trackers — structured day-to-day health logs on an Individual's
 * chart, alongside the Health card's appointments and allergies. This batch
 * adds four tracker kinds, all stored as one entry shape with kind-specific
 * detail fields:
 *
 *  - Immunizations: vaccine, dose, date given, next due date.
 *  - Lab results: test, result, and a staff-set abnormal flag.
 *  - Infection tracking: type, where, start/resolution, symptoms, treatment.
 *  - Sleep: hours, quality, interruptions for a night.
 *
 * Clinically significant entries alert the responsible managers (the home's
 * house manager directly, plus program-manager and nurse broadcasts) — a
 * confirmed infection, a lab result staff flag as abnormal, and an
 * immunization that has gone overdue. Pure domain module: types,
 * validation, gates, alert targets, overdue math, row mappers.
 */

import type { SessionUser } from "./types";

export const HEALTH_TRACK_KINDS = [
  "immunization",
  "lab",
  "infection",
  "sleep",
] as const;
export type HealthTrackKind = (typeof HEALTH_TRACK_KINDS)[number];

export const HEALTH_TRACK_KIND_LABELS: Record<HealthTrackKind, string> = {
  immunization: "Immunizations",
  lab: "Lab results",
  infection: "Infection tracking",
  sleep: "Sleep",
};

export const SLEEP_QUALITIES = ["Good", "Fair", "Poor"] as const;
export type SleepQuality = (typeof SLEEP_QUALITIES)[number];

export interface HealthTrackEntry {
  id: string;
  agencyId: string;
  individualId: string;
  kind: HealthTrackKind;
  /** Primary date of the record (given on / collected on / started / night of). */
  occurredOn: string;
  /** One-line title derived from the kind's detail fields. */
  title: string;
  /** Kind-specific fields (see the per-kind detail interfaces below). */
  details: Record<string, string>;
  /** Staff-flagged as clinically significant (drives the manager alert). */
  flaggedAbnormal: boolean;
  note: string;
  recordedByUserId: string;
  createdAt: string;
}

export interface ImmunizationDetails {
  vaccineName: string;
  doseLabel: string;
  nextDueOn: string;
}

export interface LabDetails {
  testName: string;
  resultValue: string;
  unit: string;
  referenceRange: string;
}

export interface InfectionDetails {
  infectionType: string;
  bodySite: string;
  resolvedOn: string;
  symptoms: string;
  treatment: string;
  confirmedPositive: string; // "yes" | "no"
}

export interface SleepDetails {
  hoursSlept: string;
  quality: SleepQuality | "";
  interruptions: string;
}

export interface HealthTrackEntryDraft {
  kind: HealthTrackKind;
  occurredOn: string;
  details: Record<string, string>;
  flaggedAbnormal?: boolean;
  note?: string;
}

// ───────────────────────────── Permission gates ─────────────────────────────

/** DSP/HM/PM/nurse record health entries. */
export function canRecordHealthEntry(roleKey: string | null | undefined): boolean {
  return (
    roleKey === "dsp" ||
    roleKey === "house_manager" ||
    roleKey === "program_manager" ||
    roleKey === "nurse" ||
    roleKey === "administrator" ||
    roleKey === "compliance_admin"
  );
}

/** Read access rides the chart gates; auditors see everything, read-only. */
export function canViewHealthTrack(session: SessionUser | null): boolean {
  if (!session) return false;
  if (session.permissions["individuals.view"] !== true) return false;
  return session.roleKey !== "hr";
}

// ───────────────────────────── Titles & validation ─────────────────────────────

export function healthTrackTitle(
  kind: HealthTrackKind,
  details: Record<string, string>,
): string {
  switch (kind) {
    case "immunization": {
      const dose = details.doseLabel?.trim();
      return dose
        ? `${details.vaccineName ?? "Immunization"} — ${dose}`
        : details.vaccineName || "Immunization";
    }
    case "lab": {
      const result = [details.resultValue, details.unit]
        .filter((part) => part?.trim())
        .join(" ");
      return result
        ? `${details.testName ?? "Lab result"}: ${result}`
        : details.testName || "Lab result";
    }
    case "infection": {
      const site = details.bodySite?.trim();
      return site
        ? `${details.infectionType ?? "Infection"} (${site})`
        : details.infectionType || "Infection";
    }
    case "sleep": {
      const hours = details.hoursSlept?.trim();
      return hours ? `Slept ${hours} hours` : "Sleep record";
    }
  }
}

export function validateHealthTrackDraft(draft: HealthTrackEntryDraft): string[] {
  const errors: string[] = [];
  if (!HEALTH_TRACK_KINDS.includes(draft.kind)) {
    errors.push("Choose a tracker.");
  }
  if (!draft.occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) {
    errors.push("The record date must be a calendar date (YYYY-MM-DD).");
  }
  const d = draft.details ?? {};
  if (draft.kind === "immunization") {
    if (!d.vaccineName?.trim()) errors.push("Name the vaccine.");
    if (
      d.nextDueOn &&
      !/^\d{4}-\d{2}-\d{2}$/.test(d.nextDueOn)
    ) {
      errors.push("The next due date must be a calendar date (YYYY-MM-DD).");
    }
  }
  if (draft.kind === "lab") {
    if (!d.testName?.trim()) errors.push("Name the lab test.");
    if (!d.resultValue?.trim()) errors.push("Enter the result.");
  }
  if (draft.kind === "infection") {
    if (!d.infectionType?.trim()) errors.push("Name the infection.");
  }
  if (draft.kind === "sleep") {
    const hours = Number(d.hoursSlept);
    if (d.hoursSlept?.trim() && (Number.isNaN(hours) || hours < 0 || hours > 24)) {
      errors.push("Hours slept must be between 0 and 24.");
    }
    if (d.quality && !SLEEP_QUALITIES.includes(d.quality as SleepQuality)) {
      errors.push("Choose a sleep quality (Good, Fair, or Poor).");
    }
  }
  return errors;
}

// ───────────────────────────── Clinical significance & alerts ─────────────────────────────

/**
 * Whether recording this entry should alert the responsible managers right
 * away: a confirmed infection, or a lab result staff flagged abnormal.
 * (Immunization overdue is time-based and handled by the sweep below.)
 */
export function healthEntryNeedsAlert(entry: {
  kind: HealthTrackKind;
  details: Record<string, string>;
  flaggedAbnormal: boolean;
}): boolean {
  if (entry.flaggedAbnormal) return true;
  if (entry.kind === "infection" && entry.details.confirmedPositive === "yes") {
    return true;
  }
  return false;
}

/** An immunization whose next due date has passed, with no newer dose logged. */
export function isImmunizationOverdue(
  entry: Pick<HealthTrackEntry, "kind" | "details" | "occurredOn">,
  siblings: ReadonlyArray<
    Pick<HealthTrackEntry, "kind" | "details" | "occurredOn">
  > = [],
  now: Date = new Date(),
): boolean {
  if (entry.kind !== "immunization") return false;
  const due = entry.details.nextDueOn;
  if (!due) return false;
  if (due >= now.toISOString().slice(0, 10)) return false;
  // A later dose of the same vaccine supersedes this row's next-due date, so
  // an older entry is no longer overdue once a newer dose has been recorded.
  const vaccine = entry.details.vaccineName?.trim().toLowerCase();
  const hasNewerDose = siblings.some(
    (other) =>
      other !== entry &&
      other.kind === "immunization" &&
      other.details.vaccineName?.trim().toLowerCase() === vaccine &&
      other.occurredOn > entry.occurredOn,
  );
  return !hasNewerDose;
}

export interface HealthAlertTarget {
  userId: string | null;
  roleKey: "program_manager" | "nurse" | null;
  dedupeKey: string;
}

/** HM directly + PM/nurse broadcasts, deduped per entry + target. */
export function healthAlertTargets(input: {
  entryId: string;
  houseManagerUserIds: string[];
}): HealthAlertTarget[] {
  const targets: HealthAlertTarget[] = [];
  for (const userId of [...new Set(input.houseManagerUserIds)]) {
    targets.push({
      userId,
      roleKey: null,
      dedupeKey: `incident.followup:health:${input.entryId}:hm:${userId}`,
    });
  }
  targets.push({
    userId: null,
    roleKey: "program_manager",
    dedupeKey: `incident.followup:health:${input.entryId}:role:program_manager`,
  });
  targets.push({
    userId: null,
    roleKey: "nurse",
    dedupeKey: `incident.followup:health:${input.entryId}:role:nurse`,
  });
  return targets;
}

// ───────────────────────────── DB row mapping ─────────────────────────────

export function buildHealthTrackRow(input: {
  agencyId: string;
  individualId: string;
  recordedByUserId: string;
  draft: HealthTrackEntryDraft;
}): Record<string, unknown> {
  const d = input.draft;
  return {
    agency_id: input.agencyId,
    individual_id: input.individualId,
    kind: d.kind,
    occurred_on: d.occurredOn,
    title: healthTrackTitle(d.kind, d.details ?? {}),
    details: d.details ?? {},
    flagged_abnormal: d.flaggedAbnormal === true,
    note: (d.note ?? "").trim(),
    recorded_by_user_id: input.recordedByUserId,
  };
}

export function healthTrackEntryFromRow(
  row: Record<string, unknown>,
): HealthTrackEntry {
  const kind = row.kind as string;
  const details = (row.details as Record<string, string> | null) ?? {};
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    individualId: row.individual_id as string,
    kind: (HEALTH_TRACK_KINDS as readonly string[]).includes(kind)
      ? (kind as HealthTrackKind)
      : "lab",
    occurredOn: row.occurred_on as string,
    title: (row.title as string | null) ?? healthTrackTitle(
      (kind as HealthTrackKind) ?? "lab",
      details,
    ),
    details,
    flaggedAbnormal: row.flagged_abnormal === true,
    note: (row.note as string | null) ?? "",
    recordedByUserId: row.recorded_by_user_id as string,
    createdAt: row.created_at as string,
  };
}
