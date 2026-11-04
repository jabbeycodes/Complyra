/**
 * AGENCY DAY — the one answer to "what calendar day is it?"
 *
 * Complyrer agencies operate in Missouri, so every user-facing "today"
 * (due dates, dose days, shift-note days, expiry checks, "signed on"
 * stamps, default form dates) is the agency's local calendar day in
 * America/Chicago — never the UTC date and never the device's zone.
 *
 * Why this module exists (wave 1 audit, 2026-11-03): "today" was computed
 * four different ways — `todayIso()` (UTC), `todayStamp()` (device-local),
 * two copies of `centralTodayIso()`, and `agencyClock()` — plus 54 inline
 * `new Date().toISOString().slice(0, 10)` expressions (UTC). After 6 PM
 * Central (7 PM in summer) the UTC date is already tomorrow, so the app
 * marked today's doses "not open yet", judged expiries a day early, and
 * stamped tomorrow's date on signatures. Every helper now delegates here.
 *
 * Stored instants (created_at, signed_at…) stay UTC ISO strings; only the
 * calendar-day reading of an instant goes through `agencyDayOf`.
 */

/** The agency operating time zone (Missouri). */
export const AGENCY_TIME_ZONE = "America/Chicago";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** "YYYY-MM-DD" for the calendar day an instant falls on in the agency zone. */
export function agencyDayOf(
  instant: Date | string | number,
  timeZone: string = AGENCY_TIME_ZONE,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const parts = formatterFor(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** Today's calendar date ("YYYY-MM-DD") in the agency zone. */
export function agencyToday(now: Date = new Date(), timeZone: string = AGENCY_TIME_ZONE): string {
  return agencyDayOf(now, timeZone);
}
