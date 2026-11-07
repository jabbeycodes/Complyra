/**
 * Med inventory countdown — deterministic projection of medication supply.
 *
 * No cron, no background job: the current count is derived from the
 * delivery-day quantity, the dosing schedule, elapsed calendar days, and PRN
 * doses logged since delivery. Same inputs always give the same output, so
 * every render recomputes it on the fly.
 */
import { daysBetween, todayIso, type Medication, type MedicationDelivery } from "./chart";
import { formatPillCount, medCountdown } from "../features/mobile/medcount";
import { formatCentralTime, formatIsoDay } from "../features/mobile/mar";
import type { MedDoseMark } from "./types";
import {
  DEFAULT_MED_LOW_THRESHOLD_DAYS,
  type AddMedDoseExceptionInput,
  type DoseExceptionKind,
  type MedDeliverySummary,
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
 * any med kind. Status: "out" at zero pills, "critical" at <= 2 days (or
 * <= 2 pills for PRN), "low" at or under the reorder threshold, else "ok".
 */
export function projectInventory(input: ProjectInventoryInput): InventoryProjection {
  const {
    deliveryQty,
    dosesPerDay,
    today = todayIso(),
    dosesLogged = [],
    doseExceptions = [],
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
  const currentCount = Math.max(
    0,
    Math.round((deliveryQty - scheduledUsed - prnUsed - exceptionUsed) * 100) / 100,
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

/**
 * Total order over delivery/count rows, newest first: count date, then
 * the moment the count was recorded (timestamped rows before legacy
 * rows that carry none), then row id. The countdown's baseline pick
 * (medCountdown) and the server's expected-count RPC order rows this
 * way; the projection must agree. Two counts recorded on the same day
 * otherwise leave the anchor — and with it the forecast figure, the
 * status, and the days-left — to the caller's row order, which the
 * hosted backend does not guarantee between loads, so the same med's
 * forecast could flip between two values with no count event in
 * between (sim batches 82–86).
 */
export function compareDeliveryRecency(
  a: MedicationDelivery,
  b: MedicationDelivery,
): number {
  const byDay = b.countedOn.localeCompare(a.countedOn);
  if (byDay !== 0) return byDay;
  const aAt = a.countedAt ?? "";
  const bAt = b.countedAt ?? "";
  if (aAt !== bAt) return bAt.localeCompare(aAt);
  return b.id.localeCompare(a.id);
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
  const latest = [...input.deliveries].sort(compareDeliveryRecency)[0];
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

  const projection = projectInventory({
    deliveryQty,
    dosesPerDay,
    deliveredOn: anchorDate,
    today,
    dosesLogged: inWindow,
    doseExceptions: inWindowExceptions,
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
    // The countdown baseline's date: the newest delivery/count row wins;
    // meds counted before delivery rows existed fall back to the
    // medication row's last-delivery date. Null = never counted.
    lastCountedOn: latest
      ? latest.countedOn.slice(0, 10)
      : (med.lastDeliveryOn ?? null),
    lowThresholdDays:
      input.inventory?.lowThresholdDays ?? DEFAULT_MED_LOW_THRESHOLD_DAYS,
    reorderAcknowledgedOn: input.inventory?.reorderAcknowledgedOn ?? null,
    updatedAt: input.inventory?.updatedAt ?? null,
    ...projection,
    prnDosesSinceDelivery: inWindow.length,
    deliveries: [...input.deliveries]
      .sort(compareDeliveryRecency)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        countedOn: row.countedOn,
        countedAt: row.countedAt ?? null,
        remainingPills: row.remainingPills,
        pillsPerDay: row.pillsPerDay,
        recordedBy: row.recordedBy,
        recordedByName: row.recordedByName ?? null,
        expectedPills: row.expectedPills ?? null,
        varianceReason: row.varianceReason ?? null,
      })),
    doseExceptions: [...input.doseExceptions].sort((a, b) =>
      a.occurredOn < b.occurredOn ? 1 : -1,
    ),
  };
}

/**
 * The figure a fresh count is expected to match: the countdown's
 * baseline-and-burn-down number for this med (newest count baseline minus
 * recorded administrations since it). Null when the med has never been
 * counted — a first count has no expectation to disagree with.
 */
export function expectedCountNow(
  view: MedInventoryView,
  marks: MedDoseMark[],
  today: string,
): number | null {
  const countdown = medCountdown(view, marks, today);
  return countdown.hasBaseline ? countdown.pillsLeft : null;
}

/**
 * Why a count may not be recorded as-is, or null when it may. A count that
 * differs from the expected on-hand figure needs a note explaining the
 * variance; a matching count (the happy path) needs nothing extra.
 */
export function countVarianceProblem(
  expected: number | null,
  entered: number,
  varianceReason?: string | null,
): string | null {
  if (expected === null) return null;
  if (Math.round(entered * 100) === Math.round(expected * 100)) return null;
  if (varianceReason && varianceReason.trim()) return null;
  return `The count differs from the expected ${expected} pills on hand. Add a note explaining the variance.`;
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
  // A medication with no count on file (lastCountedOn === null) has no
  // supply state at all: its projection is a fabricated zero, so it must
  // never be counted as "out", never appear as a reorder alert, and never
  // make the home read as stocked or as needing a reorder. It is surfaced
  // as "No count recorded yet" on the per-med surfaces instead.
  const counted = views.filter((view) => medHasCountOnFile(view));
  const uncounted = views.length - counted.length;
  const counts = { ok: 0, low: 0, critical: 0, out: 0 };
  for (const view of counted) {
    if (view.status === "low") counts.low += 1;
    else if (view.status === "critical") counts.critical += 1;
    else if (view.status === "out") counts.out += 1;
    else counts.ok += 1;
  }
  const alerts = counted
    .filter((view) => view.status !== "ok")
    .sort(compareMedInventory);
  const allClear = alerts.length === 0;
  const summary = allClear
    ? counted.length === 0 && uncounted > 0
      ? `${siteName}: no medication counts recorded yet (${uncounted} medication${uncounted === 1 ? "" : "s"} not counted).`
      : `${siteName}: all ${counted.length} medication${counted.length === 1 ? "" : "s"} stocked.` +
        (uncounted > 0
          ? ` ${uncounted} medication${uncounted === 1 ? "" : "s"} not counted yet.`
          : "")
    : `${siteName}: ${alerts.length} of ${counted.length} medication${counted.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} reorder` +
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

/**
 * THE one computed source for a medication's count state, shared by every
 * surface that talks about supply (chart board, forecast card, supply
 * tallies, Audit Me). A med "has a count on file" exactly when its
 * inventory view carries a count date — from a delivery/count record or
 * the row's maintained count date. Anything else (the stored row's raw
 * pill figure, its low flag) is NOT a count state: surfaces that render
 * those as supply truth disagree with the forecast in steady state
 * (batch 33: a never-counted med persistently showed "0 pills left" on
 * the chart board while the forecast said "No count recorded yet").
 */
export function medHasCountOnFile(view: MedInventoryView): boolean {
  // projectMedInventory always sets lastCountedOn (null = never counted);
  // only hand-built fixtures omit the field, and for those the previous
  // counted behavior is preserved.
  return view.lastCountedOn !== null;
}

export type MedSupplyDisplayState =
  /** Inventory views have not arrived yet — no supply claim may render. */
  | { kind: "loading" }
  /** Inventory views failed to load — still no supply claim may render. */
  | { kind: "unavailable" }
  /** Loaded, and the med has no count on file (or no inventory view). */
  | { kind: "never-counted" }
  /** Loaded, counted, with the projection's supply status. */
  | { kind: "counted"; status: MedInventoryView["status"] };

export function medSupplyDisplayState(
  view: MedInventoryView | null | undefined,
  loadState: "loading" | "ready" | "failed",
): MedSupplyDisplayState {
  if (loadState === "loading") return { kind: "loading" };
  if (loadState === "failed") return { kind: "unavailable" };
  if (!view || !medHasCountOnFile(view)) return { kind: "never-counted" };
  return { kind: "counted", status: view.status };
}

/**
 * The last manual count on file for a med: the newest delivery/count
 * record (view.deliveries is already newest-first by
 * compareDeliveryRecency). Null when no count record exists — a med
 * carried on its maintained row count, or never counted, has no
 * manual count to show, and none is invented.
 *
 * Display only: this is NOT the on-hand figure. Every med surface
 * headlines the computed on-hand count (the countdown — newest count
 * baseline minus doses recorded Given since); this record is shown
 * beneath it, always labeled "Recorded count:", so a reader never has
 * to guess which figure a bare number is (sim retest batches 286/289/291).
 */
export function lastRecordedCount(
  view: Pick<MedInventoryView, "deliveries">,
): { pills: number; countedOn: string } | null {
  const latest = view.deliveries?.[0];
  if (!latest) return null;
  return { pills: latest.remainingPills, countedOn: latest.countedOn.slice(0, 10) };
}

/** "Recorded count: 30 pills · counted Mon, Nov 2" — the label is never dropped. */
export function recordedCountLabel(record: { pills: number; countedOn: string }): string {
  const pills = formatPillCount(record.pills);
  return `Recorded count: ${pills} ${record.pills === 1 ? "pill" : "pills"} · counted ${formatIsoDay(record.countedOn)}`;
}

/** "On hand: 23 pills" — the computed headline figure, always labeled. */
export function onHandLabel(pillsLeft: number): string {
  const pills = formatPillCount(pillsLeft);
  return `On hand: ${pills} ${pillsLeft === 1 ? "pill" : "pills"}`;
}

/**
 * THE on-hand figure for one med, as every surface must render it (chart
 * Medication board headline + days left, supply forecast headline, the
 * "Pills remaining" count-entry prefill, the chart and mobile MAR). It is
 * the countdown — newest count baseline minus doses recorded Given since
 * (medCountdown) — and nothing else. Wave 4C (sim retest batch 311): the
 * forecast card showed the time-based projection (projectInventory's
 * currentCount) as a second "remaining" figure, and the count-entry box
 * was seeded from the stored medication row before the countdown loaded,
 * so one card carried two or three different numbers.
 *
 * `marks` are the med's dose marks from its baseline through today; null
 * while they load or when they failed. Scheduled meds cannot be counted
 * down without them, so the state is "loading" / "unavailable" — the raw
 * recorded count and the projection are never substituted. PRN meds net
 * their dose logs into the view already and do not need marks.
 */
export type MedOnHand =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "never-counted" }
  | {
      kind: "counted";
      pillsLeft: number;
      /** Whole days at the scheduled rate (floored); null for PRN. */
      daysLeft: number | null;
      outOfStock: boolean;
    };

export function medOnHand(
  view: MedInventoryView | null | undefined,
  marks: MedDoseMark[] | null,
  today: string,
  marksLoad: "loading" | "ready" | "failed" = marks ? "ready" : "loading",
): MedOnHand {
  if (!view || !medHasCountOnFile(view)) return { kind: "never-counted" };
  if (view.kind === "scheduled" && (!marks || marksLoad !== "ready")) {
    return { kind: marksLoad === "failed" ? "unavailable" : "loading" };
  }
  const countdown = medCountdown(view, marks ?? [], today);
  if (!countdown.hasBaseline || countdown.pillsLeft === null) {
    return { kind: "never-counted" };
  }
  return {
    kind: "counted",
    pillsLeft: countdown.pillsLeft,
    daysLeft: countdown.daysLeft,
    outOfStock: countdown.outOfStock,
  };
}

/** The headline text for an on-hand state — "On hand: N pills" when counted. */
export function onHandHeadline(state: MedOnHand): string {
  if (state.kind === "counted") return onHandLabel(state.pillsLeft);
  if (state.kind === "never-counted") return "No count recorded yet";
  if (state.kind === "unavailable") return "On-hand count unavailable";
  return "Loading on-hand count…";
}

/** "14 days left" from the on-hand figure; null when there is no figure or no daily rate. */
export function onHandDaysLeftLabel(state: MedOnHand): string | null {
  if (state.kind !== "counted" || state.daysLeft === null) return null;
  return `${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left`;
}

/**
 * The chart Medication board's supply line (after the strength):
 * "On hand: 28 pills · 2 per day · 14 days left". The headline and the
 * days left both come from the on-hand figure; the rate shown is the
 * same rate days-left divides by (the view's dosesPerDay — the newest
 * count's rate), never a second stored figure. No supply claim renders
 * while the views load or after they fail.
 */
export function boardSupplyText(
  display: MedSupplyDisplayState,
  onHand: MedOnHand | null,
  kind: "scheduled" | "prn",
  dosesPerDay: number,
): string {
  const head =
    display.kind === "loading"
      ? "Loading supply…"
      : display.kind === "unavailable"
        ? "Supply count unavailable"
        : display.kind === "never-counted" || !onHand
          ? "No count recorded yet"
          : onHandHeadline(onHand);
  if (kind !== "scheduled") return `${head} · PRN, no automatic drop`;
  if (onHand?.kind !== "counted") return head;
  return `${head} · ${formatPillCount(dosesPerDay)} per day · ${onHandDaysLeftLabel(onHand) ?? "—"}`;
}

/**
 * The count-entry prefill: the expected figure a fresh count is checked
 * against, i.e. the on-hand figure. Null (an empty box) when there is no
 * figure yet — never the stored row or the projection.
 */
export function countEntryPrefill(state: MedOnHand): number | null {
  return state.kind === "counted" ? state.pillsLeft : null;
}

function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The only form the scheduled rate may take beside the headline: an
 * explicitly future-framed line derived FROM the on-hand figure, e.g.
 * "At the scheduled rate (2 per day), this supply runs out around
 * Fri, Nov 20." Never a competing current count. Null for PRN, for
 * meds without a figure, and for a med already out.
 */
export function scheduledRateOutlook(
  state: MedOnHand,
  dosesPerDay: number,
  today: string,
): string | null {
  if (state.kind !== "counted" || dosesPerDay <= 0 || state.daysLeft === null) return null;
  if (state.outOfStock) return null;
  const runsOutOn = addIsoDays(today, state.daysLeft);
  return `At the scheduled rate (${formatPillCount(dosesPerDay)} per day), this supply runs out around ${formatIsoDay(runsOutOn)}.`;
}

/**
 * The detail line for a supply-tally alert row (site page, inventory
 * page). Those surfaces hold views without dose records, so they cannot
 * compute the on-hand countdown — and must not stand the time-based
 * projection in for it (Wave 4C). They name the labeled recorded count
 * instead and point at the chart for the on-hand figure.
 */
export function supplyAlertDetail(
  view: Pick<MedInventoryView, "deliveries" | "lastCountedOn">,
): string {
  if (view.lastCountedOn === null) return "No count recorded yet";
  const recorded = lastRecordedCount(view);
  const base = recorded
    ? recordedCountLabel(recorded)
    : view.lastCountedOn
      ? `Last counted ${formatIsoDay(view.lastCountedOn.slice(0, 10))}`
      : "Count on file";
  return `${base} · on-hand count on the chart`;
}

/** Human-readable countdown, e.g. "24 pills remaining · ~12 days left". */
export function inventoryCountdownLabel(view: MedInventoryView): string {
  const pills = `${view.currentCount} pill${view.currentCount === 1 ? "" : "s"} remaining`;
  if (view.kind === "prn" || view.daysRemaining === null) return `${pills} · PRN`;
  return `${pills} · ~${view.daysRemaining} day${view.daysRemaining === 1 ? "" : "s"} left`;
}

/**
 * The one-line label for a delivery/count record in every count history
 * (chart supply history, mobile Recent counts). A count is an audit
 * record, so the line always names the Individual, the medication, what
 * was expected vs counted when the count disagreed, the variance reason,
 * who recorded it, and when — in human form. The recorder's raw user id
 * is NEVER rendered: when no display name was resolved the line falls
 * back to "Staff member" (the same fallback the hosted name resolution
 * uses elsewhere). Legacy rows without a recorded timestamp show the
 * count date only.
 */
export function deliveryHistoryLabel(
  delivery: MedDeliverySummary,
  context: { medicationName: string; individualName: string },
): string {
  const day = formatIsoDay(delivery.countedOn.slice(0, 10));
  const time = delivery.countedAt ? formatCentralTime(delivery.countedAt) : "";
  const when = time ? `${day} · ${time}` : day;
  const counted = formatPillCount(delivery.remainingPills);
  const hasVariance =
    delivery.expectedPills !== null &&
    delivery.expectedPills !== undefined &&
    Math.round(delivery.expectedPills * 100) !==
      Math.round(delivery.remainingPills * 100);
  const figures = hasVariance
    ? `expected ${formatPillCount(delivery.expectedPills as number)}, counted ${counted}`
    : `${counted} pill${delivery.remainingPills === 1 ? "" : "s"} counted`;
  const reason =
    hasVariance && delivery.varianceReason
      ? ` — ${delivery.varianceReason}`
      : "";
  const perDay =
    delivery.pillsPerDay > 0 ? ` · ${formatPillCount(delivery.pillsPerDay)}/day` : "";
  const recorder = delivery.recordedByName?.trim() || "Staff member";
  return `${when} — ${context.medicationName} for ${context.individualName}: ${figures}${reason}${perDay} · recorded by ${recorder}`;
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
