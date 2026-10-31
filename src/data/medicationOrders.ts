/**
 * Medication Orders + Reconciliation — pure domain logic.
 *
 * No I/O here: validation, order-expiry classification, the projection of an
 * active order onto the existing MAR medication row, and the reconciliation
 * comparison between active orders and the current MAR list. Both the local
 * and hosted API layers call into this module so the two backends agree, and
 * the unit tests exercise it directly.
 */
import { daysBetween, todayIso } from "./chart";
import type { Medication } from "./chart";
import type {
  CreateMedicationOrderInput,
  MedicationOrder,
  MedicationOrderExpiry,
  ReconciliationDecision,
  ReconciliationItemInput,
  ReconciliationTrigger,
} from "./types";

/**
 * Lead time (days) before an active order's end / review date at which it
 * starts surfacing on the expiring-orders worklist and alerting the nurse and
 * Program Manager. Chosen to give a working week of notice — long enough to
 * chase a prescriber renewal, short enough not to cry wolf.
 */
export const ORDER_REVIEW_LEAD_DAYS = 14;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ValidatedOrderDraft {
  medicationName: string;
  dose: string;
  route: string;
  schedule: string;
  scheduleTimes: string[];
  isPrn: boolean;
  startDate: string;
  endReviewDate: string | null;
  prescriberName: string;
  reason: string;
}

/** Normalize + sort HH:MM dose times, dropping blanks and duplicates. */
export function normalizeScheduleTimes(times: readonly string[] | undefined): string[] {
  if (!times) return [];
  const cleaned = times
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const t of cleaned) {
    if (!HHMM.test(t)) {
      throw new Error(`Dose time "${t}" must be in 24-hour HH:MM form.`);
    }
  }
  return [...new Set(cleaned)].sort();
}

/**
 * Shared validator for creating / editing an order. Throws a human-readable
 * Error on the first problem so the UI shows a clear message before any write.
 */
export function validateOrderInput(
  input: CreateMedicationOrderInput,
  today = todayIso(),
): ValidatedOrderDraft {
  const medicationName = input.medicationName.trim();
  if (!medicationName) throw new Error("Enter the medication name.");
  const dose = input.dose.trim();
  if (!dose) throw new Error("Enter the dose.");
  const route = input.route.trim();
  if (!route) throw new Error("Enter the route (for example, by mouth).");
  const prescriberName = input.prescriberName.trim();
  if (!prescriberName) throw new Error("Enter the prescriber's name.");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter the reason for the medication.");

  const isPrn = Boolean(input.isPrn);
  const scheduleTimes = isPrn ? [] : normalizeScheduleTimes(input.scheduleTimes);
  const schedule = input.schedule.trim();
  if (!isPrn && scheduleTimes.length === 0 && !schedule) {
    throw new Error("Enter the schedule, or add at least one dose time.");
  }

  const startDate = (input.startDate ?? today).slice(0, 10);
  const endReviewDate = input.endReviewDate ? input.endReviewDate.slice(0, 10) : null;
  if (endReviewDate && endReviewDate < startDate) {
    throw new Error("The end / review date cannot be before the start date.");
  }

  return {
    medicationName,
    dose,
    route,
    schedule,
    scheduleTimes,
    isPrn,
    startDate,
    endReviewDate,
    prescriberName,
    reason,
  };
}

/**
 * Classify how close an order is to its end / review date. Only active orders
 * are ever flagged; drafts and discontinued orders are always "ok".
 */
export function orderExpiry(
  order: Pick<MedicationOrder, "status" | "endReviewDate">,
  today = todayIso(),
  leadDays = ORDER_REVIEW_LEAD_DAYS,
): MedicationOrderExpiry {
  if (order.status !== "active" || !order.endReviewDate) return "ok";
  const days = daysBetween(today, order.endReviewDate);
  if (days < 0) return "expired";
  if (days <= leadDays) return "expiring";
  return "ok";
}

/** Whole days until the end / review date; negative once passed, null when open-ended. */
export function daysUntilReview(
  order: Pick<MedicationOrder, "endReviewDate">,
  today = todayIso(),
): number | null {
  if (!order.endReviewDate) return null;
  return daysBetween(today, order.endReviewDate);
}

/** An active order needs review attention when it is expiring or already expired. */
export function orderNeedsReview(
  order: Pick<MedicationOrder, "status" | "endReviewDate">,
  today = todayIso(),
  leadDays = ORDER_REVIEW_LEAD_DAYS,
): boolean {
  return orderExpiry(order, today, leadDays) !== "ok";
}

const BOARD_LABEL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The order-expiry line for a MAR medication fed by an order, worded the
 * way the expiry notice describes it: "Order expires Nov 2, 2026" while
 * the review date is approaching, "Order expired Oct 30, 2026" once it has
 * passed. Null when the order needs no review attention (or the med has
 * no dated active order) — the medication board renders this next to the
 * supply line so an expiring order is visible where doses are worked, not
 * only on the orders worklist. Text, never color alone.
 */
export function orderExpiryBoardLabel(
  order: Pick<MedicationOrder, "status" | "endReviewDate">,
  today = todayIso(),
): string | null {
  const expiry = orderExpiry(order, today);
  if (expiry === "ok" || !order.endReviewDate) return null;
  const when = BOARD_LABEL_DATE.format(
    new Date(`${order.endReviewDate.slice(0, 10)}T12:00:00Z`),
  );
  return expiry === "expired" ? `Order expired ${when}` : `Order expires ${when}`;
}

/**
 * The medication-row shape an activated scheduled order projects onto the MAR.
 * PRN orders project a PRN medication (no auto-countdown, no dose times); a
 * scheduled order projects a scheduled medication whose pills-per-day equals
 * the number of daily dose slots.
 */
export interface ProjectedMedicationFields {
  name: string;
  strength: string;
  kind: "scheduled" | "prn";
  pillsPerDay: number;
  doseTimes: string[];
}

export function projectOrderToMedication(
  order: Pick<MedicationOrder, "medicationName" | "dose" | "isPrn" | "scheduleTimes">,
): ProjectedMedicationFields {
  const doseTimes = order.isPrn ? [] : normalizeScheduleTimes(order.scheduleTimes);
  return {
    name: order.medicationName,
    strength: order.dose,
    kind: order.isPrn ? "prn" : "scheduled",
    pillsPerDay: order.isPrn ? 0 : doseTimes.length,
    doseTimes,
  };
}

/**
 * Whether a medication row still belongs on the MAR. A medication fed by an
 * order drops off the MAR once that order is discontinued; legacy / seed
 * medications with no source order always stay. This is what makes the MAR
 * medication list derive from the active orders.
 */
export function medicationStaysOnMar(
  med: { sourceOrderId?: string | null },
  orders: readonly Pick<MedicationOrder, "id" | "status">[] | undefined,
): boolean {
  if (!med.sourceOrderId) return true;
  const order = (orders ?? []).find((o) => o.id === med.sourceOrderId);
  return !order || order.status === "active";
}

export const RECONCILIATION_TRIGGER_LABEL: Record<ReconciliationTrigger, string> = {
  admission: "Admission",
  hospital_return: "ER / hospital return",
  order_change: "Order change",
};

export const RECONCILIATION_DECISION_LABEL: Record<ReconciliationDecision, string> = {
  continue: "Continue",
  change: "Change",
  stop: "Stop",
};

export function isReconciliationTrigger(value: string): value is ReconciliationTrigger {
  return value === "admission" || value === "hospital_return" || value === "order_change";
}

/**
 * Build the starting checklist for a reconciliation by comparing the active
 * orders against the current MAR medication list.
 *
 *  - An active order whose medication is already on the MAR → one line,
 *    pre-set to "continue", no discrepancy.
 *  - An active order with no matching MAR medication → "change" + discrepancy
 *    (the order is not reflected on the MAR yet).
 *  - A MAR medication with no active order behind it → "stop" + discrepancy
 *    (the MAR is carrying something no active order supports).
 *
 * The nurse edits these before signing off; this is only the suggested start.
 */
export function buildReconciliationChecklist(input: {
  activeOrders: Pick<MedicationOrder, "id" | "medicationName" | "dose" | "medicationId">[];
  marMedications: Pick<Medication, "id" | "name" | "strength" | "sourceOrderId">[];
}): ReconciliationItemInput[] {
  const { activeOrders, marMedications } = input;
  const items: ReconciliationItemInput[] = [];
  const matchedMedIds = new Set<string>();

  for (const order of activeOrders) {
    const med = marMedications.find(
      (m) =>
        (order.medicationId && m.id === order.medicationId) ||
        m.sourceOrderId === order.id,
    );
    if (med) matchedMedIds.add(med.id);
    const label = `${order.medicationName}${order.dose ? ` ${order.dose}` : ""}`.trim();
    items.push({
      orderId: order.id,
      medicationId: med?.id ?? null,
      medicationLabel: label,
      decision: med ? "continue" : "change",
      discrepancy: !med,
      note: med ? "" : "Active order not yet reflected on the MAR.",
    });
  }

  for (const med of marMedications) {
    if (matchedMedIds.has(med.id)) continue;
    const label = `${med.name}${med.strength ? ` ${med.strength}` : ""}`.trim();
    items.push({
      orderId: null,
      medicationId: med.id,
      medicationLabel: label,
      decision: "stop",
      discrepancy: true,
      note: "On the MAR with no active order behind it.",
    });
  }

  return items;
}

export interface ValidatedReconciliationItem {
  orderId: string | null;
  medicationId: string | null;
  medicationLabel: string;
  decision: ReconciliationDecision;
  discrepancy: boolean;
  note: string;
}

const DECISIONS: ReconciliationDecision[] = ["continue", "change", "stop"];

/** Validate the checklist lines the caller submits when saving decisions. */
export function validateReconciliationItems(
  items: readonly ReconciliationItemInput[],
): ValidatedReconciliationItem[] {
  if (items.length === 0) {
    throw new Error("A reconciliation needs at least one medication line.");
  }
  return items.map((item) => {
    const label = item.medicationLabel.trim();
    if (!label) throw new Error("Each reconciliation line needs a medication name.");
    if (!DECISIONS.includes(item.decision)) {
      throw new Error("Choose continue, change, or stop for each medication.");
    }
    const note = (item.note ?? "").trim();
    if (item.decision !== "continue" && !note) {
      throw new Error(`Add a note explaining the "${item.decision}" decision for ${label}.`);
    }
    return {
      orderId: item.orderId ?? null,
      medicationId: item.medicationId ?? null,
      medicationLabel: label,
      decision: item.decision,
      discrepancy: Boolean(item.discrepancy),
      note,
    };
  });
}

/** Count of lines flagged as discrepancies — surfaced in summaries and reports. */
export function countDiscrepancies(
  items: readonly { discrepancy: boolean }[],
): number {
  return items.reduce((total, item) => total + (item.discrepancy ? 1 : 0), 0);
}

const EXPIRY_SEVERITY: Record<MedicationOrderExpiry, number> = {
  expired: 0,
  expiring: 1,
  ok: 2,
};

/** Worst expiry first, then soonest review date — the worklist ordering. */
export function compareOrderExpiry(
  a: { expiry: MedicationOrderExpiry; daysUntilReview: number | null },
  b: { expiry: MedicationOrderExpiry; daysUntilReview: number | null },
): number {
  const bySeverity = EXPIRY_SEVERITY[a.expiry] - EXPIRY_SEVERITY[b.expiry];
  if (bySeverity !== 0) return bySeverity;
  return (a.daysUntilReview ?? Infinity) - (b.daysUntilReview ?? Infinity);
}
