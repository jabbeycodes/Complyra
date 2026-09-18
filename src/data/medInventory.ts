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
  creditedBackForAdministrations,
  type MarAdministration,
} from "./mar";
import {
  DEFAULT_MED_LOW_THRESHOLD_DAYS,
  type AddMedDoseExceptionInput,
  type DoseExceptionKind,
  type MedDoseException,
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
  /** Refused / held / wasted dose exceptions in the window: their pills are subtracted. */
  doseExceptions?: Array<{ date: string; pills: number }>;
  /**
   * Issue #100 — credited-back pills: refused / omitted / held MAR
   * administrations whose pills were NOT consumed. The deterministic
   * projection assumes scheduled days consume pills, so these are credited
   * back. Dated outside [deliveredOn, today] are ignored.
   */
  creditedBack?: Array<{ date: string; pills: number }>;
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
 * decrement them. Refused / held / wasted dose exceptions subtract pills for
 * any med kind. Credited-back pills (refused / omitted / held MAR doses) are
 * added back, since the scheduled drop assumed they were consumed. Status:
 * "out" at zero pills, "critical" at <= 2 days (or <= 2 pills for PRN), "low"
 * at or under the reorder threshold, else "ok".
 */
export function projectInventory(input: ProjectInventoryInput): InventoryProjection {
  const {
    deliveryQty,
    dosesPerDay,
    today = todayIso(),
    dosesLogged = [],
    doseExceptions = [],
    creditedBack = [],
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
  // Refused / held / wasted dose exceptions subtract pills for scheduled AND
  // PRN meds — a wasted dose is gone regardless of schedule. Out-of-window
  // exceptions (before delivery or after today) are ignored.
  let exceptionUsed = 0;
  for (const exception of doseExceptions) {
    const on = exception.date.slice(0, 10);
    if (on >= deliveredOn && on <= today && exception.pills > 0) {
      exceptionUsed += exception.pills;
    }
  }
  // Issue #100: refused / omitted / held MAR administrations credit their
  // pills back — the scheduled drop assumed they were consumed, but the
  // Individual never took them. Out-of-window credits are ignored.
  let credited = 0;
  for (const credit of creditedBack) {
    const on = credit.date.slice(0, 10);
    if (on >= deliveredOn && on <= today && credit.pills > 0) {
      credited += credit.pills;
    }
  }
  const currentCount = Math.max(
    0,
    Math.round((deliveryQty - scheduledUsed - prnUsed - exceptionUsed + credited) * 100) / 100,
  );
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
  /** Refused / held / wasted dose exceptions (subtracted from the forecast). */
  doseExceptions: MedDoseException[];
  /** Issue #100 — MAR administrations; non-given ones credit pills back. */
  administrations?: MarAdministration[];
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
  const inWindowExceptions = input.doseExceptions
    .filter((exception) => {
      const on = exception.occurredOn.slice(0, 10);
      return on >= anchorDate.slice(0, 10) && on <= today;
    })
    .map((exception) => ({ date: exception.occurredOn.slice(0, 10), pills: exception.pillsAffected }));
  // Issue #100: non-given MAR administrations credit their pills back so the
  // countdown (and the site-tab supply alerts built from it) reflects that
  // the Individual never consumed those doses. This intentionally duplicates
  // the creditedBackForAdministrations helper shape (pure, in-window) so the
  // mapping stays beside the projection that consumes it.
  const inWindowAdmins = (input.administrations ?? []).filter(
    (row) =>
      row.medicationId === med.id &&
      row.administeredOn.slice(0, 10) >= anchorDate.slice(0, 10) &&
      row.administeredOn.slice(0, 10) <= today,
  );
  const credits = creditedBackForAdministrations(inWindowAdmins);

  const projection = projectInventory({
    deliveryQty,
    dosesPerDay,
    deliveredOn: anchorDate,
    today,
    dosesLogged: inWindow,
    doseExceptions: inWindowExceptions,
    creditedBack: credits,
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
    doseExceptions: [...input.doseExceptions].sort((a, b) =>
      a.occurredOn < b.occurredOn ? 1 : -1,
    ),
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

/**
 * Supply-specific badge label. Pill-count supply is never "expired" — that
 * word is reserved for actual order/lifecycle expiry. A stocked PRN med
 * reads "Stocked", never "Expired".
 */
export function medSupplyStatusLabel(status: MedInventoryStatus): string {
  switch (status) {
    case "ok":
      return "Stocked";
    case "low":
      return "Reorder soon";
    case "critical":
      return "Reorder now";
    case "out":
      return "Out of stock";
  }
}

/** Supply-specific badge description (tooltip + screen-reader context). */
export function medSupplyStatusDescription(
  status: MedInventoryStatus,
  reorderPointPills: number,
): string {
  switch (status) {
    case "ok":
      return "In stock — supply is above the reorder point.";
    case "low":
      return `Low stock — reorder at ${reorderPointPills} pills.`;
    case "critical":
      return "Critically low — reorder now.";
    case "out":
      return "Out of stock — no pills projected on hand. Reorder immediately.";
  }
}

export interface ValidatedDoseExceptionInput {
  kind: DoseExceptionKind;
  pillsAffected: number;
  reason: string;
  occurredOn: string;
}

/** Human label for a dose exception kind, e.g. "Refused". */
export function doseExceptionKindLabel(kind: DoseExceptionKind): string {
  return kind === "refused" ? "Refused" : kind === "held" ? "Held" : "Wasted";
}

/**
 * Shared validator for refused / held / wasted dose exceptions (local +
 * hosted APIs and unit tests). Throws a human-readable Error on the first
 * problem. Rows are insert-only: there is no update/delete path, so this
 * runs exactly once per exception at write time.
 */
export function validateDoseExceptionInput(
  input: AddMedDoseExceptionInput,
  today = todayIso(),
): ValidatedDoseExceptionInput {
  const kind = input.kind;
  if (kind !== "refused" && kind !== "held" && kind !== "wasted") {
    throw new Error("Choose refused, held, or wasted.");
  }
  if (!Number.isInteger(input.pillsAffected) || input.pillsAffected <= 0) {
    throw new Error("Pills affected must be a positive whole number.");
  }
  const reason = input.reason.trim();
  if (!reason) throw new Error("Write the reason for this dose exception.");
  const occurredOn = (input.occurredOn ?? today).slice(0, 10);
  if (occurredOn > today) throw new Error("The exception date cannot be in the future.");
  return { kind, pillsAffected: input.pillsAffected, reason, occurredOn };
}
