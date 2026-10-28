/**
 * Med count countdown — the per-medication supply countdown that lives
 * inside the mobile MAR, under Medications (there is no separate
 * Med Count tile: the count belongs with the med it counts).
 *
 * THE definition (one place; every countdown in the MAR comes from here):
 *
 * - Baseline: the most recent recorded count for the med — the newest
 *   delivery/count record (recordMedDelivery writes one; a manager's
 *   refill reset is the same record). Burn-down runs from a baseline.
 * - Maintained count (no delivery record yet): the medication row's own
 *   count. Both backends maintain that row as a current count (the
 *   local backend decays it daily by the scheduled rate; PRN rows are
 *   decremented as doses are logged), so it is shown as-is with its
 *   day projection and NO burn-down — burning marks from its
 *   last-delivery date would subtract the same doses twice. The first
 *   recorded count (a refill tap) replaces it with a true baseline.
 *   A med with no count of either kind has never been counted: the
 *   countdown reads "No count recorded yet" and invents no number.
 * - Burn-down (scheduled meds): from the baseline, subtract one dose's
 *   pills for every dose recorded Given, plus the pills of Wasted dose
 *   exceptions, in the window (baseline date, Central today] — strictly
 *   after the baseline date. The baseline day itself never burns: a
 *   count recorded that day already reflects that day's earlier doses,
 *   and date-only count records cannot be ordered within a day. Missed,
 *   LOA, and On hold marks and Refused / Held exceptions remove no pills
 *   from the bottle, so they never move the count. Later deliveries do
 *   not "add" — a newer delivery IS a newer baseline.
 * - Pills per dose = the med's scheduled pills per day ÷ its dose times
 *   per day (the MAR's own schedule). Days left = whole days of supply
 *   at that daily rate, FLOORED — "about 11 days", never rounded up.
 * - PRN meds have no schedule to burn against: their administrations are
 *   PRN dose logs, already netted into the inventory projection's
 *   current count in both backends, so the countdown shows that count
 *   with no day projection — "as needed — no daily rate".
 * - The floor is zero: a count never renders negative.
 *
 * This is deliberately a different lens from the desktop chart's
 * supply forecast (projectInventory), which projects by elapsed
 * calendar time. The MAR countdown answers "what is left, given what
 * was actually recorded Given since the last count" and is reset by a
 * fresh count — the same delivery/count records anchor both.
 */
import type { MedDoseMark, MedInventoryView } from "../../data/types";
import { formatIsoDay } from "./mar";

export interface MedCountdown {
  /** False when the med has never been counted — no number is invented. */
  hasBaseline: boolean;
  /** Pills on hand per the countdown; null only when there is no baseline. */
  pillsLeft: number | null;
  /** Whole days at the scheduled daily rate (floored); null for PRN. */
  daysLeft: number | null;
  /** One-line supply text: "23 pills left · about 11 days at 2 per day". */
  label: string;
  /** "Counted Fri, Sep 1" for the baseline in use; null without one. */
  countedLabel: string | null;
}

export interface MedCountdownInput {
  kind: "scheduled" | "prn";
  /** The most recent recorded count; null when the med was never counted. */
  baseline: { countedOn: string; pills: number } | null;
  /**
   * True when the baseline pills are the medication row's maintained
   * current count rather than a delivery/count record: the count is
   * shown as-is and no burn-down applies (see the header definition).
   */
  maintainedCount?: boolean;
  /** Scheduled pills per day (the predicted administration rate); 0 for PRN. */
  dosesPerDay: number;
  /** Scheduled administrations per day (dose times); pills per dose derives from it. */
  doseTimesCount: number;
  /** Dose dates (ISO) of this med's Given marks; the helper applies the window. */
  givenDoseDates: string[];
  /** This med's Wasted dose exceptions; the helper applies the window. */
  wasted: { occurredOn: string; pills: number }[];
  /** PRN only: the inventory projection's current count (dose logs netted). */
  prnCurrentCount: number | null;
  /** Central today (ISO date) — the countdown is always "as of" today. */
  today: string;
}

/** "28" for whole counts, "27.5" for fractional ones (half tablets exist). */
export function formatPillCount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/\.?0+$/, "");
}

function pillWord(value: number): string {
  return value === 1 ? "pill" : "pills";
}

function dayWord(value: number): string {
  return value === 1 ? "day" : "days";
}

export function computeMedCountdown(input: MedCountdownInput): MedCountdown {
  const baseline = input.baseline;
  if (!baseline) {
    return {
      hasBaseline: false,
      pillsLeft: null,
      daysLeft: null,
      label: "No count recorded yet",
      countedLabel: null,
    };
  }
  const countedLabel = `Counted ${formatIsoDay(baseline.countedOn.slice(0, 10))}`;

  if (input.kind === "scheduled" && input.maintainedCount) {
    // The row's maintained current count: already net of the backend's
    // own upkeep, so marks and exceptions must not burn it a second time.
    const pillsLeft = Math.max(
      0,
      Math.round(baseline.pills * 100) / 100,
    );
    const daysLeft =
      input.dosesPerDay > 0
        ? Math.floor(pillsLeft / input.dosesPerDay)
        : null;
    const pillsText = `${formatPillCount(pillsLeft)} ${pillWord(pillsLeft)} left`;
    return {
      hasBaseline: true,
      pillsLeft,
      daysLeft,
      label:
        daysLeft === null
          ? pillsText
          : `${pillsText} · about ${daysLeft} ${dayWord(daysLeft)} at ${formatPillCount(input.dosesPerDay)} per day`,
      countedLabel,
    };
  }

  // The burn-down window: strictly after the baseline date, through today.
  const inWindow = (isoDate: string) => {
    const day = isoDate.slice(0, 10);
    return day > baseline.countedOn.slice(0, 10) && day <= input.today;
  };
  const wastedPills = input.wasted
    .filter((row) => inWindow(row.occurredOn) && row.pills > 0)
    .reduce((sum, row) => sum + row.pills, 0);

  if (input.kind === "prn") {
    // PRN administrations are dose logs, not MAR marks; both backends
    // already net them into the projection's current count.
    const raw =
      input.prnCurrentCount ?? baseline.pills - wastedPills;
    const pillsLeft = Math.max(0, Math.round(raw * 100) / 100);
    return {
      hasBaseline: true,
      pillsLeft,
      daysLeft: null,
      label: `${formatPillCount(pillsLeft)} ${pillWord(pillsLeft)} left · as needed — no daily rate`,
      countedLabel,
    };
  }

  const pillsPerDose =
    input.dosesPerDay / Math.max(1, input.doseTimesCount);
  const givenCount = input.givenDoseDates.filter((date) =>
    inWindow(date),
  ).length;
  const used = givenCount * pillsPerDose + wastedPills;
  const pillsLeft = Math.max(
    0,
    Math.round((baseline.pills - used) * 100) / 100,
  );
  const daysLeft =
    input.dosesPerDay > 0 ? Math.floor(pillsLeft / input.dosesPerDay) : null;
  const pillsText = `${formatPillCount(pillsLeft)} ${pillWord(pillsLeft)} left`;
  const label =
    daysLeft === null
      ? pillsText
      : `${pillsText} · about ${daysLeft} ${dayWord(daysLeft)} at ${formatPillCount(input.dosesPerDay)} per day`;
  return { hasBaseline: true, pillsLeft, daysLeft, label, countedLabel };
}

/** Adapter: build the countdown for one medication's inventory view. */
export function medCountdown(
  view: MedInventoryView,
  marks: MedDoseMark[],
  today: string,
): MedCountdown {
  // deliveries are newest-first in the view: the newest delivery/count
  // record is a true baseline. Without one, the medication row's count
  // (dated by lastCountedOn) is a maintained current count.
  const delivery = view.deliveries[0];
  const baseline = delivery
    ? {
        countedOn: delivery.countedOn.slice(0, 10),
        pills: delivery.remainingPills,
      }
    : view.lastCountedOn != null
      ? {
          countedOn: view.lastCountedOn.slice(0, 10),
          pills: view.quantityOnDelivery,
        }
      : null;
  return computeMedCountdown({
    kind: view.kind,
    baseline,
    maintainedCount: !delivery && baseline !== null,
    dosesPerDay: view.dosesPerDay,
    doseTimesCount: view.doseTimes.length,
    givenDoseDates: marks
      .filter(
        (mark) =>
          mark.medicationId === view.medicationId && mark.status === "given",
      )
      .map((mark) => mark.doseDate.slice(0, 10)),
    wasted: view.doseExceptions
      .filter((exception) => exception.kind === "wasted")
      .map((exception) => ({
        occurredOn: exception.occurredOn.slice(0, 10),
        pills: exception.pillsAffected,
      })),
    prnCurrentCount: view.kind === "prn" ? view.currentCount : null,
    today,
  });
}
