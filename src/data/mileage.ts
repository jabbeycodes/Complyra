/**
 * LIFEPATH-P7 (mileage tracking): pure trip math for the vehicle mileage log.
 *
 * Paper-form rules (LPMM mileage log):
 * - MILES = ODOMETER STOP - ODOMETER START (stop must be >= start).
 * - Every individual who rode on a trip gets an equal share of that trip's
 *   miles (two riders sharing the car each get miles / 2).
 * - The monthly totals row sums all trip miles plus each individual's
 *   accumulated share.
 *
 * All functions are deterministic and side-effect free so the monthly view
 * can recompute from the raw trip rows on every render.
 */
import type { MileageTrip } from "./types";

/** Round a mileage value to one decimal, like the paper form. */
export function roundMiles(value: number): number {
  return Math.round(value * 10) / 10;
}

/** MILES for one trip row: stop - start, rounded to one decimal. */
export function computeTripMiles(odometerStart: number, odometerEnd: number): number {
  return roundMiles(odometerEnd - odometerStart);
}

export interface TripValidationError {
  field: "tripDate" | "odometerStart" | "odometerEnd" | "riders" | "reason" | "driverName";
  message: string;
}

export interface TripInput {
  tripDate: string;
  odometerStart: number;
  odometerEnd: number;
  riderIds: string[];
  reason: string;
  driverName: string;
}

/**
 * Validate a trip entry the way the paper form demands it: a date, sane
 * odometer readings with stop >= start, at least one rider, and a reason.
 * Returns the list of problems (empty = valid).
 */
export function validateTripInput(input: TripInput): TripValidationError[] {
  const errors: TripValidationError[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tripDate)) {
    errors.push({ field: "tripDate", message: "Enter the trip date." });
  }
  if (!Number.isFinite(input.odometerStart) || input.odometerStart < 0) {
    errors.push({ field: "odometerStart", message: "Enter the odometer reading at the start of the trip." });
  }
  if (!Number.isFinite(input.odometerEnd) || input.odometerEnd < 0) {
    errors.push({ field: "odometerEnd", message: "Enter the odometer reading at the end of the trip." });
  }
  if (
    Number.isFinite(input.odometerStart) &&
    Number.isFinite(input.odometerEnd) &&
    input.odometerEnd < input.odometerStart
  ) {
    errors.push({
      field: "odometerEnd",
      message: "The ending odometer reading cannot be less than the starting reading.",
    });
  }
  if (input.riderIds.length === 0) {
    errors.push({ field: "riders", message: "Select at least one individual who rode on this trip." });
  }
  if (!input.reason.trim()) {
    errors.push({ field: "reason", message: "Enter the reason for the trip." });
  }
  if (!input.driverName.trim()) {
    errors.push({ field: "driverName", message: "Enter the driver's name." });
  }
  return errors;
}

/**
 * Equal per-rider share of a trip's miles. Two riders sharing the car each
 * get miles / 2, three riders each get miles / 3, and so on. Shares are
 * rounded to one decimal; the last rider absorbs any rounding remainder so
 * the shares always add back up to the trip total.
 */
export function splitMilesAmongRiders(miles: number, riderIds: string[]): Map<string, number> {
  const shares = new Map<string, number>();
  const count = riderIds.length;
  if (count === 0) return shares;
  const total = roundMiles(miles);
  const each = Math.floor((total / count) * 10) / 10;
  let assigned = 0;
  riderIds.forEach((riderId, index) => {
    const share = index === count - 1 ? roundMiles(total - assigned) : each;
    shares.set(riderId, share);
    assigned = roundMiles(assigned + share);
  });
  return shares;
}

/** "YYYY-MM" month key for an ISO date, for the month picker and queries. */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** First day of the next month as "YYYY-MM-DD", for range queries. */
export function nextMonthStart(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}

/** Human label for the paper header, e.g. "September 2026". */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface MileageMonthlySummary {
  month: string;
  tripCount: number;
  /** Sum of all trip miles for the month (the "Total Miles" row). */
  totalMiles: number;
  /** Per-individual accumulated share, in the order of the ids passed in. */
  individualTotals: Array<{ individualId: string; miles: number }>;
}

/**
 * Monthly totals for the paper form's bottom row: total miles across all
 * trips, plus each individual's accumulated equal-share of the trips they
 * rode on. Individual ids not present on any trip still appear with 0 so
 * the table columns stay stable.
 */
export function summarizeMonthlyMileage(
  trips: MileageTrip[],
  individualIds: string[],
): MileageMonthlySummary {
  const totals = new Map<string, number>(individualIds.map((id) => [id, 0]));
  let totalMiles = 0;
  for (const trip of trips) {
    totalMiles = roundMiles(totalMiles + trip.miles);
    const shares = splitMilesAmongRiders(trip.miles, trip.riderIds);
    for (const [riderId, share] of shares) {
      totals.set(riderId, roundMiles((totals.get(riderId) ?? 0) + share));
    }
  }
  const month = trips.length > 0 ? monthKeyOf(trips[0].tripDate) : "";
  return {
    month,
    tripCount: trips.length,
    totalMiles,
    individualTotals: individualIds.map((individualId) => ({
      individualId,
      miles: totals.get(individualId) ?? 0,
    })),
  };
}

/** Sort trips the way the paper log lists them: date, then creation order. */
export function compareMileageTrips(a: MileageTrip, b: MileageTrip): number {
  if (a.tripDate !== b.tripDate) return a.tripDate < b.tripDate ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

// ---------- Odometer continuity ----------
// The paper log is one unbroken chain: the next trip's odometer start must
// continue from the most recent trip's end. If a user types anything else,
// the form blocks with an error so they fix it — unless an authorized
// backfiller (administrator, compliance administrator, or house manager)
// checks the "Backfill" box to log a forgotten trip out of sequence.

/** Roles allowed to bypass odometer continuity with a backfill. */
export const MILEAGE_BACKFILL_ROLE_KEYS = [
  "administrator",
  "compliance_admin",
  "house_manager",
] as const;

/**
 * Whether this session may backfill an out-of-sequence trip: administrators,
 * compliance administrators, house managers, and platform admins. Everyone
 * else (DSP, nurse, HR, auditor, …) can never bypass continuity.
 */
export function canBackfillMileage(
  session: { roleKey: string; platformAdmin: boolean } | null,
): boolean {
  if (!session) return false;
  return (
    session.platformAdmin ||
    (MILEAGE_BACKFILL_ROLE_KEYS as readonly string[]).includes(session.roleKey)
  );
}

/** Throw unless the session may backfill; the API layer calls this server-side. */
export function assertCanBackfillMileage(session: {
  roleKey: string;
  platformAdmin: boolean;
}): void {
  if (!canBackfillMileage(session)) {
    throw new Error(
      "Only administrators, compliance administrators, and house managers " +
        "can backfill an out-of-sequence trip.",
    );
  }
}

// ---------- Backfill marking ----------
// Backfilled trips are flagged without a schema change: the persisted reason
// carries a "[backfill]" marker prefix, which the API mappers strip back off
// into the `backfilled` boolean on the trip type. Display code always uses
// the stripped reason; the badge reads the flag.

export const BACKFILL_REASON_PREFIX = "[backfill]";

/** True when a persisted reason carries the backfill marker. */
export function hasBackfillMarker(reason: string): boolean {
  return reason.trimStart().toLowerCase().startsWith(BACKFILL_REASON_PREFIX);
}

/** Remove the backfill marker for display; untouched when there is none. */
export function stripBackfillMarker(reason: string): string {
  const trimmed = reason.trimStart();
  if (!trimmed.toLowerCase().startsWith(BACKFILL_REASON_PREFIX)) return reason;
  return trimmed.slice(BACKFILL_REASON_PREFIX.length).trimStart();
}

/** Persist a reason with the backfill marker applied (idempotent). */
export function withBackfillMarker(reason: string): string {
  const clean = stripBackfillMarker(reason);
  return clean ? `${BACKFILL_REASON_PREFIX} ${clean}` : BACKFILL_REASON_PREFIX;
}

/** Latest trip by trip date, tie-breaking on creation order. Null when empty. */
export function latestMileageTrip(trips: MileageTrip[]): MileageTrip | null {
  if (trips.length === 0) return null;
  return [...trips].sort(compareMileageTrips).at(-1) ?? null;
}

/** Odometer end of the most recent trip, or null when the home has no trips yet. */
export function getLastOdometerEnd(trips: MileageTrip[]): number | null {
  return latestMileageTrip(trips)?.odometerEnd ?? null;
}

/** Odometer end of the trip that comes right before `tripId` in log order. */
export function getPreviousOdometerEnd(
  trips: MileageTrip[],
  tripId: string,
): number | null {
  const ordered = [...trips].sort(compareMileageTrips);
  const index = ordered.findIndex((trip) => trip.id === tripId);
  if (index <= 0) return null;
  return ordered[index - 1].odometerEnd;
}

function formatOdometer(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/**
 * Blocking continuity check for the trip form: the entered start must equal
 * the expected start (the previous trip's end). Returns the error message to
 * show, or null when the start is fine. A null expected start means this is
 * the first trip ever, so anything goes.
 */
export function validateOdometerContinuity(
  enteredStart: number,
  expectedStart: number | null,
): string | null {
  if (expectedStart === null) return null;
  if (!Number.isFinite(enteredStart)) return null; // basic validation reports this
  if (roundMiles(enteredStart) === roundMiles(expectedStart)) return null;
  return (
    `Start mileage must continue from the last trip's end ` +
    `(${formatOdometer(expectedStart)}). Fix it to continue.`
  );
}

// ---------- Weekly breakdown (monthly sheet: Week 1–Week 5) ----------
// Mirrors the full-year tracker workbook: Week 1 = days 1–7, Week 2 = 8–14,
// Week 3 = 15–21, Week 4 = 22–28, Week 5 = days 29–31 (rendered only when the
// month actually has week-5 trip data).

export const WEEK_LABELS = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"];

/** 0-based week bucket for a day-of-month: 1–7 → 0 … 29–31 → 4. */
export function weekBucketOfDay(day: number): number {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  if (day <= 28) return 3;
  return 4;
}

export interface MileageWeeklyRow {
  individualId: string;
  /** Per-week shares; index 4 is the optional Week 5 (days 29–31). */
  weeks: number[];
  monthlyTotal: number;
}

export interface MileageWeeklyBreakdown {
  month: string;
  rows: MileageWeeklyRow[];
  /** True when at least one trip falls on day 29–31; the UI renders the Week 5 column only then. */
  hasWeek5: boolean;
}

/**
 * Weekly breakdown for the monthly sheet: each individual's equal-share
 * miles bucketed into Week 1–Week 4, plus Week 5 when the month has trips
 * on days 29–31. Individual ids with no trips still appear with zeros.
 */
export function summarizeWeeklyMileage(
  trips: MileageTrip[],
  individualIds: string[],
): MileageWeeklyBreakdown {
  const weeksById = new Map<string, number[]>(
    individualIds.map((id) => [id, [0, 0, 0, 0, 0]]),
  );
  let hasWeek5 = false;
  for (const trip of trips) {
    const day = Number(trip.tripDate.slice(8, 10));
    if (!Number.isFinite(day) || day < 1) continue;
    const bucket = weekBucketOfDay(day);
    if (bucket === 4) hasWeek5 = true;
    const shares = splitMilesAmongRiders(trip.miles, trip.riderIds);
    for (const [riderId, share] of shares) {
      const weeks = weeksById.get(riderId);
      if (!weeks) continue;
      weeks[bucket] = roundMiles(weeks[bucket] + share);
    }
  }
  const month = trips.length > 0 ? monthKeyOf(trips[0].tripDate) : "";
  return {
    month,
    rows: individualIds.map((individualId) => {
      const weeks = weeksById.get(individualId) ?? [0, 0, 0, 0, 0];
      return {
        individualId,
        weeks,
        monthlyTotal: roundMiles(weeks.reduce((sum, w) => sum + w, 0)),
      };
    }),
    hasWeek5,
  };
}

// ---------- Yearly summary (Yearly Summary sheet) ----------
// Mirrors the workbook's "Yearly Summary" sheet: one row per individual with
// Jan–Dec columns plus a Yearly Total, and a Grand Total row at the bottom.

export const MONTH_LABELS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface MileageYearRow {
  individualId: string;
  /** Per-month shares, index 0 = January … 11 = December. */
  months: number[];
  yearlyTotal: number;
}

export interface MileageYearlySummary {
  year: number;
  rows: MileageYearRow[];
  grandTotal: { months: number[]; yearlyTotal: number };
}

/**
 * Yearly summary for the administrator view: each individual's equal-share
 * miles per calendar month, a yearly total per individual, and a grand-total
 * row. Every individual id appears even with zero miles so the table is
 * pre-populated. Trips outside `year` are ignored.
 */
export function summarizeYearlyMileage(
  trips: MileageTrip[],
  individualIds: string[],
  year: number,
): MileageYearlySummary {
  const monthsById = new Map<string, number[]>(
    individualIds.map((id) => [id, new Array(12).fill(0)]),
  );
  for (const trip of trips) {
    const tripYear = Number(trip.tripDate.slice(0, 4));
    if (tripYear !== year) continue;
    const monthIndex = Number(trip.tripDate.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    const shares = splitMilesAmongRiders(trip.miles, trip.riderIds);
    for (const [riderId, share] of shares) {
      const months = monthsById.get(riderId);
      if (!months) continue;
      months[monthIndex] = roundMiles(months[monthIndex] + share);
    }
  }
  const rows: MileageYearRow[] = individualIds.map((individualId) => {
    const months = monthsById.get(individualId) ?? new Array(12).fill(0);
    return {
      individualId,
      months,
      yearlyTotal: roundMiles(months.reduce((sum, m) => sum + m, 0)),
    };
  });
  const grandMonths = MONTH_LABELS_SHORT.map((_, index) =>
    roundMiles(rows.reduce((sum, row) => sum + row.months[index], 0)),
  );
  return {
    year,
    rows,
    grandTotal: {
      months: grandMonths,
      yearlyTotal: roundMiles(grandMonths.reduce((sum, m) => sum + m, 0)),
    },
  };
}
