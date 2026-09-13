import type { ObligationItem } from "./planStack";

export type ChartFileKind = "renewal" | "discontinue" | "training" | "other";

export interface ChartFile {
  id: string;
  agencyId: string;
  individualId: string;
  kind: ChartFileKind;
  name: string;
  mime: string;
  storagePath: string;
}

export type MedicationKind = "scheduled" | "prn";

export interface Medication {
  id: string;
  agencyId: string;
  individualId: string;
  name: string;
  strength: string;
  kind: MedicationKind;
  controlled: boolean;
  pillsPerDay: number;
  remainingPills: number;
  lastDeliveryOn: string | null;
  lastCountdownOn: string | null;
}

export interface MedicationDelivery {
  id: string;
  medicationId: string;
  countedOn: string;
  remainingPills: number;
  pillsPerDay: number;
  recordedBy: string;
}

export interface TrainingLine {
  id: string;
  title: string;
  initialedAt: string | null;
}

export interface TrainingChecklist {
  id: string;
  agencyId: string;
  individualId: string;
  staffUserId: string;
  staffName: string;
  documentVersionId: string | null;
  items: TrainingLine[];
  staffSignedAt: string | null;
  staffSignatureName: string | null;
  hmSignedAt: string | null;
  hmSignatureName: string | null;
}

export interface MedicationView extends Medication {
  daysLeft: number | null;
  low: boolean;
}

export interface TrainingRowView {
  checklist: TrainingChecklist;
  status: "unsigned" | "staff_signed" | "complete";
}

export interface CarePlanView {
  title: string;
  versionLabel: string | null;
  documentVersionId: string | null;
  signedCount: number;
  assignedCount: number;
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function daysUntil(isoDate: string, today = todayIso()) {
  return daysBetween(today, isoDate);
}

export function countdownLabel(nextDueOn: string, today = todayIso()) {
  const days = daysUntil(nextDueOn, today);
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Expires today";
  return `${days} days left`;
}

export function canSeeChartWidgets(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
    "program_manager",
    "nurse",
    "auditor",
  ].includes(roleKey);
}

export function canSeeMeds(roleKey: string) {
  return canSeeChartWidgets(roleKey) || roleKey === "dsp";
}

export function canRecordDelivery(roleKey: string) {
  return [
    "administrator",
    "house_manager",
    "degreed_professional_manager",
    "nurse",
  ].includes(roleKey);
}

export function canLogPrnDose(roleKey: string) {
  return canRecordDelivery(roleKey) || roleKey === "dsp";
}

/**
 * Who may log a refused / held / wasted dose exception. Matches the
 * med_dose_exceptions RLS insert policy: DSPs record exceptions during the
 * med pass, alongside administrators, compliance admins, house managers,
 * DPMs, and nurses.
 */
export function canLogDoseException(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
    "nurse",
    "dsp",
  ].includes(roleKey);
}

/**
 * Who may edit a completed (but unlocked) training signoff line. Mirrors the
 * training_signoffs RLS update policy; the app enforces it before the API
 * so staff get a clear message instead of a database error.
 */
export function canEditTrainingLine(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
  ].includes(roleKey);
}

/**
 * Who may void a locked training sheet via the correction flow (delete the
 * HM countersignature with a written reason). Matches the
 * training_countersignatures_delete RLS policy — house managers are
 * deliberately excluded; they ask an administrator, compliance admin, or
 * DPM instead.
 */
export function canRequestTrainingCorrection(roleKey: string) {
  return ["administrator", "compliance_admin", "degreed_professional_manager"].includes(
    roleKey,
  );
}

export function canSignTrainingAsHm(roleKey: string) {
  return [
    "administrator",
    "house_manager",
    "degreed_professional_manager",
  ].includes(roleKey);
}

export function applyDailyMedDrop(med: Medication, today = todayIso()): Medication {
  if (med.kind === "prn") return med;
  if (med.pillsPerDay <= 0) return med;
  const start = med.lastCountdownOn || med.lastDeliveryOn || today;
  const elapsed = Math.max(0, daysBetween(start, today));
  if (elapsed === 0) {
    return { ...med, lastCountdownOn: today };
  }
  return {
    ...med,
    remainingPills: Math.max(0, med.remainingPills - elapsed * med.pillsPerDay),
    lastCountdownOn: today,
  };
}

export function medDaysLeft(med: Medication) {
  if (med.kind === "prn" || med.pillsPerDay <= 0) return null;
  return Math.floor(med.remainingPills / med.pillsPerDay);
}

export function medIsLow(med: Medication) {
  const days = medDaysLeft(med);
  if (days === null) return false;
  return days <= (med.controlled ? 10 : 7);
}

export function toMedicationView(med: Medication, today = todayIso()): MedicationView {
  const next = applyDailyMedDrop(med, today);
  return {
    ...next,
    daysLeft: medDaysLeft(next),
    low: medIsLow(next),
  };
}

export function allLinesInitialed(row: TrainingChecklist) {
  return row.items.length > 0 && row.items.every((line) => Boolean(line.initialedAt));
}

export function trainingStatus(row: TrainingChecklist): TrainingRowView["status"] {
  if (row.staffSignedAt && row.hmSignedAt) return "complete";
  if (row.staffSignedAt) return "staff_signed";
  return "unsigned";
}

export function trainingProgress(row: TrainingChecklist) {
  const done = row.items.filter((line) => line.initialedAt).length;
  return { done, total: row.items.length };
}

export function trainingLinesFromObligations(items: ObligationItem[]): TrainingLine[] {
  const fromPlan = items
    .filter(
      (item) =>
        item.mode === "required" &&
        (item.enabled || item.kind === "delegation") &&
        ["pcsp", "protocol"].includes(item.kind),
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      initialedAt: null as string | null,
    }));
  const extras = [
    "Medication administration / MAR location",
    "Diet, texture, and choking response",
    "Emergency contacts and 911",
    "Adaptive equipment in the home",
  ].map((title) => ({
    id: `line-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    title,
    initialedAt: null as string | null,
  }));
  const seen = new Set<string>();
  return [...fromPlan, ...extras].filter((line) => {
    if (seen.has(line.title)) return false;
    seen.add(line.title);
    return true;
  });
}

export function mergeTrainingLines(existing: TrainingLine[], nextTitles: TrainingLine[]) {
  const byTitle = new Map(existing.map((line) => [line.title, line]));
  return nextTitles.map((line) => byTitle.get(line.title) ?? line);
}

export function defaultJodieMedications(agencyId: string, individualId: string): Medication[] {
  return [
    {
      id: `${individualId}-med-keppra`,
      agencyId,
      individualId,
      name: "Levetiracetam",
      strength: "500 mg tablet",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 2,
      remainingPills: 28,
      lastDeliveryOn: "2026-09-01",
      lastCountdownOn: "2026-09-01",
    },
    {
      id: `${individualId}-med-lorazepam`,
      agencyId,
      individualId,
      name: "Lorazepam",
      strength: "0.5 mg tablet",
      kind: "prn",
      controlled: true,
      pillsPerDay: 0,
      remainingPills: 12,
      lastDeliveryOn: "2026-09-08",
      lastCountdownOn: "2026-09-08",
    },
    {
      id: `${individualId}-med-oxycodone`,
      agencyId,
      individualId,
      name: "Oxycodone",
      strength: "5 mg tablet",
      kind: "scheduled",
      controlled: true,
      pillsPerDay: 2,
      remainingPills: 16,
      lastDeliveryOn: "2026-09-05",
      lastCountdownOn: "2026-09-05",
    },
  ];
}
