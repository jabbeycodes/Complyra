import { agencyClock } from "../../data/operatingReminders";
import { hhmmToMinutes, shiftSpanOnServiceDate, zonedWallTimeMs } from "../../data/dueItems";

export const AGENCY_ZONE = "America/Chicago";

/** Sunday that starts the America/Chicago week containing this calendar date. */
export function sundayOnOrBefore(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  return utc.toISOString().slice(0, 10);
}

export function addIsoDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const utc = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function currentWeekStart(now = new Date()): string {
  return sundayOnOrBefore(agencyClock(now).today);
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addIsoDays(weekStart, index));
}

/** Load a little before Sunday and a little after Saturday so an overnight shift is included. */
export function coverageQueryWindow(weekStart: string): { fromIso: string; toIso: string } {
  return {
    fromIso: new Date(zonedWallTimeMs(weekStart, -18 * 60, AGENCY_ZONE)).toISOString(),
    toIso: new Date(zonedWallTimeMs(addIsoDays(weekStart, 7), 18 * 60, AGENCY_ZONE)).toISOString(),
  };
}

export function shiftTouchesDate(startsAt: string, endsAt: string, isoDate: string): boolean {
  const span = shiftSpanOnServiceDate(startsAt, endsAt, isoDate);
  if (!span) return false;
  return span.start < 1440 && span.end > 0;
}

/** Store a Chicago wall-clock range. An end at or before the start finishes the next morning. */
export function chicagoShiftInstants(isoDate: string, start: string, end: string): { startsAt: string; endsAt: string } {
  const startMin = hhmmToMinutes(start);
  let endMin = hhmmToMinutes(end);
  if (endMin <= startMin) endMin += 1440;
  return {
    startsAt: new Date(zonedWallTimeMs(isoDate, startMin, AGENCY_ZONE)).toISOString(),
    endsAt: new Date(zonedWallTimeMs(isoDate, endMin, AGENCY_ZONE)).toISOString(),
  };
}

export function chicagoWallClock(iso: string): { date: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = read("hour");
  if (hour === "24") hour = "00";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, hhmm: `${hour}:${read("minute")}` };
}

export function dayHeading(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, (month || 1) - 1, day || 1)));
}
