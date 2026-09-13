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
