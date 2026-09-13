/**
 * Med inventory countdown — deterministic projection of medication supply.
 *
 * No cron, no background job: the current count is derived from the
 * delivery-day quantity, the dosing schedule, elapsed calendar days, and PRN
 * doses logged since delivery. Same inputs always give the same output, so
 * every render recomputes it on the fly.
 */
import { daysBetween, todayIso, type Medication, type MedicationDelivery } from "./chart";
import {
  DEFAULT_MED_LOW_THRESHOLD_DAYS,
  type MedInventoryRecord,
  type MedInventoryStatus,
  type MedInventoryView,
  type MedSupplyStatus,
} from "./types";

export { DEFAULT_MED_LOW_THRESHOLD_DAYS };
export type { MedInventoryStatus };

export interface ProjectInventoryInput {
  /** Pill count on the day of delivery (the counted bottle). */
  deliveryQty: number;
  /** Scheduled pills per day; 0 for PRN meds. */
  dosesPerDay: number;
  /** ISO date of the delivery-day count. */
  deliveredOn: string | null;
  /** ISO date to project to; defaults to today. */
  today?: string;
  /** PRN doses given since delivery. Dated outside [deliveredOn, today] are ignored. */
  dosesLogged?: Array<{ date: string; pills: number }>;
  /** Days of doses remaining that trigger a reorder alert. */
  lowThresholdDays?: number;
  /** ISO date the reorder alert was last acknowledged, if any. */
  reorderAcknowledgedOn?: string | null;
}

export interface InventoryProjection {
  currentCount: number;
  daysRemaining: number | null;
  reorderPointPills: number;
  status: MedInventoryStatus;
  alertActive: boolean;
}

/**
 * projectInventory(deliveryQty, dosesPerDay, deliveryDate, today, dosesLogged)
 * -> { currentCount, daysRemaining, status }.
 *
 * Scheduled meds drop by dosesPerDay for each full calendar day since the
 * delivery-day count. PRN meds never auto-drop; only logged PRN doses
 * decrement them. Status: "out" at zero pills, "critical" at <= 2 days (or
 * <= 2 pills for PRN), "low" at or under the reorder threshold, else "ok".
 */
export function projectInventory(input: ProjectInventoryInput): InventoryProjection {
  const {
    deliveryQty,
    dosesPerDay,
    today = todayIso(),
    dosesLogged = [],
    lowThresholdDays = DEFAULT_MED_LOW_THRESHOLD_DAYS,
    reorderAcknowledgedOn = null,
  } = input;
  const deliveredOn = (input.deliveredOn ?? today).slice(0, 10);
  const elapsed = Math.max(0, daysBetween(deliveredOn, today));
  const scheduledUsed = dosesPerDay > 0 ? elapsed * dosesPerDay : 0;
  // Dose logs only apply to PRN meds: scheduled consumption is purely
  // time-based (logPrnDose only ever targets PRN medications).
  let prnUsed = 0;
  if (dosesPerDay === 0) {
    for (const dose of dosesLogged) {
      const on = dose.date.slice(0, 10);
      if (on >= deliveredOn && on <= today && dose.pills > 0) prnUsed += dose.pills;
    }
  }
  const currentCount = Math.max(0, Math.round((deliveryQty - scheduledUsed - prnUsed) * 100) / 100);
  const daysRemaining = dosesPerDay > 0 ? Math.floor(currentCount / dosesPerDay) : null;
  const threshold = Math.max(1, Math.floor(lowThresholdDays));
  const reorderPointPills = dosesPerDay > 0 ? Math.ceil(threshold * dosesPerDay) : threshold;

  let status: MedInventoryStatus;
  if (currentCount <= 0) {
    status = "out";
  } else if (daysRemaining !== null) {
    status = daysRemaining <= 2 ? "critical" : daysRemaining <= threshold ? "low" : "ok";
  } else {
    status = currentCount <= 2 ? "critical" : currentCount <= threshold ? "low" : "ok";
  }
  const alertActive =
    status !== "ok" && (reorderAcknowledgedOn == null || reorderAcknowledgedOn < today);
  return { currentCount, daysRemaining, reorderPointPills, status, alertActive };
}

export interface ProjectMedInventoryInput {
  med: Medication;
  /** Stored Phase-6 row, if one exists for this medication. */
  inventory: MedInventoryRecord | null;
  /** Delivery/count records, any order; the newest anchors the projection. */
  deliveries: MedicationDelivery[];
  /** PRN doses logged since delivery (hosted backend reads prn_dose_logs). */
  prnDoses: Array<{ date: string; pills: number }>;
  today?: string;
}

/**
 * Build the full inventory view for one medication. The projection anchors on
 * the newest delivery record (falling back to the medication row for meds
 * counted before any delivery record exists). PRN meds: when no per-dose log
 * is available (local backend), the medication row's remainingPills — which
 * logPrnDose decrements directly — is the exact count, so the lower of the
 * two anchors wins instead of double-counting.
 */
export function projectMedInventory(input: ProjectMedInventoryInput): MedInventoryView {
  const today = input.today ?? todayIso();
  const { med } = input;
  const latest = [...input.deliveries].sort((a, b) =>
    a.countedOn < b.countedOn ? 1 : -1,
  )[0];
  const anchorQty = latest ? latest.remainingPills : med.remainingPills;
  const anchorDate = latest ? latest.countedOn || today : med.lastDeliveryOn || today;
  const anchorPerDay = latest ? latest.pillsPerDay : med.pillsPerDay;
  const dosesPerDay = med.kind === "prn" ? 0 : anchorPerDay;

  let deliveryQty = anchorQty;
  let dosesLogged = med.kind === "prn" ? input.prnDoses : [];
  if (med.kind === "prn" && dosesLogged.length === 0 && med.remainingPills < anchorQty) {
    deliveryQty = med.remainingPills;
  }
  const inWindow = dosesLogged.filter((dose) => {
    const on = dose.date.slice(0, 10);
    return on >= anchorDate.slice(0, 10) && on <= today;
  });

  const projection = projectInventory({
    deliveryQty,
    dosesPerDay,
    deliveredOn: anchorDate,
    today,
    dosesLogged: inWindow,
    lowThresholdDays: input.inventory?.lowThresholdDays ?? DEFAULT_MED_LOW_THRESHOLD_DAYS,
    reorderAcknowledgedOn: input.inventory?.reorderAcknowledgedOn ?? null,
  });

  return {
    id: input.inventory?.id ?? `pending-${med.id}`,
    agencyId: med.agencyId,
    individualId: med.individualId,
    medicationId: med.id,
    medicationName: med.name,
    strength: med.strength,
    kind: med.kind,
    dosesPerDay,
    doseTimes: input.inventory?.doseTimes ?? [],
    quantityOnDelivery: deliveryQty,
    deliveredOn: anchorDate.slice(0, 10),
    lowThresholdDays:
      input.inventory?.lowThresholdDays ?? DEFAULT_MED_LOW_THRESHOLD_DAYS,
    reorderAcknowledgedOn: input.inventory?.reorderAcknowledgedOn ?? null,
    updatedAt: input.inventory?.updatedAt ?? null,
    ...projection,
    prnDosesSinceDelivery: inWindow.length,
    deliveries: [...input.deliveries]
      .sort((a, b) => (a.countedOn < b.countedOn ? 1 : -1))
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        countedOn: row.countedOn,
        remainingPills: row.remainingPills,
        pillsPerDay: row.pillsPerDay,
        recordedBy: row.recordedBy,
      })),
  };
}

const SEVERITY: Record<MedInventoryStatus, number> = {
  out: 0,
  critical: 1,
  low: 2,
  ok: 3,
};

/** Worst status first, then fewest days remaining. */
export function compareMedInventory(a: MedInventoryView, b: MedInventoryView) {
  const byStatus = SEVERITY[a.status] - SEVERITY[b.status];
  if (byStatus !== 0) return byStatus;
  return (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0);
}

/**
 * Aggregate one home's medication supply for the HM weekly checklist
 * ("Adequate supply of medications in the home").
 */
export function summarizeMedSupply(
  siteId: string,
  siteName: string,
  views: MedInventoryView[],
  today = todayIso(),
): MedSupplyStatus {
  const counts = { ok: 0, low: 0, critical: 0, out: 0 };
  for (const view of views) {
    if (view.status === "low") counts.low += 1;
    else if (view.status === "critical") counts.critical += 1;
    else if (view.status === "out") counts.out += 1;
    else counts.ok += 1;
  }
  const alerts = views
    .filter((view) => view.status !== "ok")
    .sort(compareMedInventory);
  const allClear = alerts.length === 0;
  const summary = allClear
    ? `${siteName}: all ${views.length} medication${views.length === 1 ? "" : "s"} stocked.`
    : `${siteName}: ${alerts.length} of ${views.length} medication${views.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} reorder` +
      ` (${counts.out} out, ${counts.critical} critical, ${counts.low} low).`;
  return {
    siteId,
    siteName,
    checkedOn: today,
    totalMeds: views.length,
    okCount: counts.ok,
    lowCount: counts.low,
    criticalCount: counts.critical,
    outCount: counts.out,
    allClear,
    alerts,
    summary,
  };
}

/** Human-readable countdown, e.g. "24 pills remaining · ~12 days left". */
export function inventoryCountdownLabel(view: MedInventoryView): string {
  const pills = `${view.currentCount} pill${view.currentCount === 1 ? "" : "s"} remaining`;
  if (view.kind === "prn" || view.daysRemaining === null) return `${pills} · PRN`;
  return `${pills} · ~${view.daysRemaining} day${view.daysRemaining === 1 ? "" : "s"} left`;
}
