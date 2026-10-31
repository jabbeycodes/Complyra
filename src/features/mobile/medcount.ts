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
 *   exceptions, whose moment is STRICTLY AFTER the baseline's effective
 *   moment. A dose's moment is its scheduled datetime in Central
 *   (dose date + dose time); a Wasted exception's moment is when it was
 *   recorded (its createdAt — the record carries no dose time, and a
 *   count can only be charged for waste recorded after it). Missed,
 *   LOA, and On hold marks and Refused / Held exceptions remove no
 *   pills from the bottle, so they never move the count. Later
 *   deliveries do not "add" — a newer delivery IS a newer baseline.
 * - The baseline's effective moment is the moment the count was
 *   recorded: the delivery record's timestamp (hosted rows carry the
 *   table's created_at; local rows are stamped when written). That is
 *   what makes same-day charting order correctly — a refill counted at
 *   08:00 already reflects the 08:00 dose, so it does not burn, while
 *   the 20:00 dose that evening does. LEGACY rows (written before
 *   count timestamps existed) carry no moment: their effective moment
 *   is the END of the counted day in Central (23:59:59.999), which
 *   preserves the old date-only behavior for those rows only — nothing
 *   on the counted day burns, everything after it does.
 * - Future-dated doses never burn: a dose dated after Central today is
 *   not yet part of the count, whatever its time.
 * - Pills per dose = the med's scheduled pills per day ÷ its dose times
 *   per day (the MAR's own schedule). Days left = whole days of supply
 *   at that daily rate, FLOORED — "about 11 days", never rounded up.
 * - PRN meds have no schedule to burn against: their administrations are
 *   PRN dose logs, already netted into the inventory projection's
 *   current count in both backends, so the countdown shows that count
 *   with no day projection — "as needed — no daily rate".
 * - The floor is zero: a count never renders negative. A counted med at
 *   zero is named "Out of stock" in the label (the desktop surfaces' own
 *   words) — a bare "0 pills left" hides the state, and the phone PRN tab
 *   has no other badge to carry it. A never-counted med is never called
 *   out of stock: it has no count, so it has no stock state.
 *
 * This is deliberately a different lens from the desktop chart's
 * supply forecast (projectInventory), which projects by elapsed
 * calendar time. The MAR countdown answers "what is left, given what
 * was actually recorded Given since the last count" and is reset by a
 * fresh count — the same delivery/count records anchor both.
 */
import type { MedDoseMark, MedInventoryView } from "../../data/types";
import { formatIsoDay, MAR_TIME_ZONE } from "./mar";

export interface MedCountdown {
  /** False when the med has never been counted — no number is invented. */
  hasBaseline: boolean;
  /** Pills on hand per the countdown; null only when there is no baseline. */
  pillsLeft: number | null;
  /** Whole days at the scheduled daily rate (floored); null for PRN. */
  daysLeft: number | null;
  /**
   * True when a counted med is at zero — the label names the state
   * ("Out of stock", the same words the desktop surfaces use) so a
   * zero count never renders as a bare number. Always false for a
   * never-counted med: no count means no stock state at all.
   */
  outOfStock: boolean;
  /** One-line supply text: "23 pills left · about 11 days at 2 per day". */
  label: string;
  /** "Counted Fri, Sep 1" for the baseline in use; null without one. */
  countedLabel: string | null;
}

export interface MedCountdownInput {
  kind: "scheduled" | "prn";
  /**
   * The most recent recorded count; null when the med was never counted.
   * `countedAt` is the ISO timestamp the count was recorded (the
   * baseline's effective moment); null marks a legacy row written
   * before count timestamps existed — see the header definition.
   */
  baseline: { countedOn: string; countedAt: string | null; pills: number } | null;
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
  /** This med's Given marks as scheduled dose date + dose time (Central). */
  givenDoses: { date: string; time: string }[];
  /** This med's Wasted dose exceptions, by the moment each was recorded. */
  wasted: { recordedAt: string; pills: number }[];
  /** PRN only: the inventory projection's current count (dose logs netted). */
  prnCurrentCount: number | null;
  /** Central today (ISO date) — the countdown is always "as of" today. */
  today: string;
}

const centralParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * The epoch millisecond of a wall-clock time read in Central
 * ("2026-09-12" + "20:00" → the instant that is 8:00 PM in Chicago).
 * The UTC guess is read back in Central and shifted by the difference;
 * a second pass settles dates near a DST transition.
 */
export function centralWallTimeMs(dateIso: string, hhmm: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const parts = centralParts.formatToParts(new Date(guess));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");
    const readAsUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    );
    const diff = target - readAsUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

/**
 * The baseline's effective moment: the recorded timestamp when the row
 * carries one; for legacy rows (no timestamp) the end of the counted
 * day in Central — the old date-only rule, preserved for those rows.
 */
function baselineMomentMs(baseline: {
  countedOn: string;
  countedAt: string | null;
}): number {
  if (baseline.countedAt) {
    const parsed = Date.parse(baseline.countedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return centralWallTimeMs(baseline.countedOn.slice(0, 10), "23:59") + 59_999;
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
      outOfStock: false,
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
    const outOfStock = pillsLeft === 0;
    const stateText = outOfStock ? `${pillsText} · Out of stock` : pillsText;
    return {
      hasBaseline: true,
      pillsLeft,
      daysLeft,
      outOfStock,
      label:
        daysLeft === null
          ? stateText
          : `${stateText} · about ${daysLeft} ${dayWord(daysLeft)} at ${formatPillCount(input.dosesPerDay)} per day`,
      countedLabel,
    };
  }

  // The burn-down rule: a dose or wasted exception burns only when its
  // moment is strictly after the baseline's effective moment. Future-
  // dated doses (after Central today) never burn.
  const moment = baselineMomentMs(baseline);
  const doseBurns = (dose: { date: string; time: string }) =>
    dose.date.slice(0, 10) <= input.today &&
    centralWallTimeMs(dose.date.slice(0, 10), dose.time) > moment;
  const wastedPills = input.wasted
    .filter((row) => row.pills > 0 && Date.parse(row.recordedAt) > moment)
    .reduce((sum, row) => sum + row.pills, 0);

  if (input.kind === "prn") {
    // PRN administrations are dose logs, not MAR marks; both backends
    // already net them into the projection's current count.
    const raw =
      input.prnCurrentCount ?? baseline.pills - wastedPills;
    const pillsLeft = Math.max(0, Math.round(raw * 100) / 100);
    const outOfStock = pillsLeft === 0;
    return {
      hasBaseline: true,
      pillsLeft,
      daysLeft: null,
      outOfStock,
      label: `${formatPillCount(pillsLeft)} ${pillWord(pillsLeft)} left${outOfStock ? " · Out of stock" : ""} · as needed — no daily rate`,
      countedLabel,
    };
  }

  const pillsPerDose =
    input.dosesPerDay / Math.max(1, input.doseTimesCount);
  const givenCount = input.givenDoses.filter(doseBurns).length;
  const used = givenCount * pillsPerDose + wastedPills;
  const pillsLeft = Math.max(
    0,
    Math.round((baseline.pills - used) * 100) / 100,
  );
  const daysLeft =
    input.dosesPerDay > 0 ? Math.floor(pillsLeft / input.dosesPerDay) : null;
  const pillsText = `${formatPillCount(pillsLeft)} ${pillWord(pillsLeft)} left`;
  const outOfStock = pillsLeft === 0;
  const stateText = outOfStock ? `${pillsText} · Out of stock` : pillsText;
  const label =
    daysLeft === null
      ? stateText
      : `${stateText} · about ${daysLeft} ${dayWord(daysLeft)} at ${formatPillCount(input.dosesPerDay)} per day`;
  return { hasBaseline: true, pillsLeft, daysLeft, outOfStock, label, countedLabel };
}

/** Adapter: build the countdown for one medication's inventory view. */
export function medCountdown(
  view: MedInventoryView,
  marks: MedDoseMark[],
  today: string,
): MedCountdown {
  // The newest delivery/count record is a true baseline. The view sorts
  // deliveries by count date; when two counts share a date, the one
  // recorded later (countedAt) is the baseline. Without any delivery
  // record, the medication row's count (dated by lastCountedOn) is a
  // maintained current count.
  const delivery = [...view.deliveries].sort((a, b) => {
    const byDay = b.countedOn.localeCompare(a.countedOn);
    if (byDay !== 0) return byDay;
    return (b.countedAt ?? "").localeCompare(a.countedAt ?? "");
  })[0];
  const baseline = delivery
    ? {
        countedOn: delivery.countedOn.slice(0, 10),
        countedAt: delivery.countedAt ?? null,
        pills: delivery.remainingPills,
      }
    : view.lastCountedOn != null
      ? {
          countedOn: view.lastCountedOn.slice(0, 10),
          countedAt: null,
          pills: view.quantityOnDelivery,
        }
      : null;
  return computeMedCountdown({
    kind: view.kind,
    baseline,
    maintainedCount: !delivery && baseline !== null,
    dosesPerDay: view.dosesPerDay,
    doseTimesCount: view.doseTimes.length,
    givenDoses: marks
      .filter(
        (mark) =>
          mark.medicationId === view.medicationId && mark.status === "given",
      )
      .map((mark) => ({
        date: mark.doseDate.slice(0, 10),
        time: mark.doseTime,
      })),
    wasted: view.doseExceptions
      .filter((exception) => exception.kind === "wasted")
      .map((exception) => ({
        recordedAt: exception.createdAt,
        pills: exception.pillsAffected,
      })),
    prnCurrentCount: view.kind === "prn" ? view.currentCount : null,
    today,
  });
}
