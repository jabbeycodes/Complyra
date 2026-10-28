/**
 * Mobile MAR — pure helpers.
 *
 * Every clock reading in the mobile shell is computed in America/Chicago
 * ("Central") regardless of the device timezone: house staff document against
 * Central shift time, and a phone traveling with a staff member must not move
 * a dose to a different day. Calendar math on ISO dates is done on the date
 * string itself so it can never drift across a timezone boundary.
 */
import type {
  MedDoseMark,
  MedDoseMarkStatus,
  MedInventoryView,
} from "../../data/types";

export const MAR_TIME_ZONE = "America/Chicago";

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const instantTime = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayText = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
});

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/** The calendar date ("YYYY-MM-DD") it currently is in Central. */
export function centralTodayIso(now: Date = new Date()): string {
  const parts = dateParts.formatToParts(now);
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`;
}

/** The current wall-clock time ("HH:MM", 24-hour) in Central. */
export function centralNowHhmm(now: Date = new Date()): string {
  const parts = timeParts.formatToParts(now);
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`;
}

/** "8:30 AM" — an instant, read in Central. */
export function formatCentralTime(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "";
  return instantTime.format(date);
}

/** "8:30 AM Central" — an instant, read in Central, zone labeled. */
export function formatCentralTimeLabeled(instant: string | Date): string {
  const text = formatCentralTime(instant);
  return text ? `${text} Central` : "";
}

/** "08:00" (24-hour dose time) → "8:00 AM". */
export function formatDoseTime(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const hour24 = Number(match[1]);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${match[2]} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** Pure calendar shift of an ISO date by whole days (no timezone involved). */
export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from one ISO date to another (b − a). */
export function isoDayDiff(a: string, b: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** "Fri, Sep 12" for an ISO calendar date, anchored so the day never shifts. */
export function formatIsoDay(iso: string): string {
  const anchor = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return iso;
  return dayText.format(anchor);
}

/** Day heading for a date relative to Central today: "Today · Fri, Sep 12". */
export function marDayHeading(iso: string, todayIso: string): string {
  const diff = isoDayDiff(todayIso, iso);
  const label =
    diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : "";
  const day = formatIsoDay(iso);
  return label ? `${label} · ${day}` : day;
}

export const DOSE_MARK_LABELS: Record<MedDoseMarkStatus, string> = {
  given: "Given",
  missed: "Missed",
  loa: "LOA",
  on_hold: "On hold",
};

/** Status line for one dose: text always, never color alone. */
export function doseStatusText(mark: MedDoseMark | null): string {
  if (!mark) return "Not yet given";
  const label = DOSE_MARK_LABELS[mark.status] ?? mark.status;
  const by = mark.markedByName ? ` by ${mark.markedByName}` : "";
  const at = mark.markedAt ? ` · ${formatCentralTime(mark.markedAt)}` : "";
  return `${label}${by}${at}`;
}

/** Plain-words frequency from the dose times: "Twice daily · 8:00 AM, 8:00 PM". */
export function frequencyText(doseTimes: string[]): string {
  const times = [...doseTimes].sort();
  if (times.length === 0) return "No scheduled times";
  const words =
    times.length === 1
      ? "Once daily"
      : times.length === 2
        ? "Twice daily"
        : times.length === 3
          ? "Three times daily"
          : `${times.length} times daily`;
  return `${words} · ${times.map(formatDoseTime).join(", ")}`;
}

export interface MarPassMed {
  inventory: MedInventoryView;
  mark: MedDoseMark | null;
}

export interface MarPass {
  doseTime: string;
  meds: MarPassMed[];
  total: number;
  given: number;
  recorded: number;
}

/**
 * Group the day's scheduled doses into passes by dose time, earliest first.
 * PRN medications are not passes — they live on the PRN tab.
 */
export function groupPasses(
  inventory: MedInventoryView[],
  marks: MedDoseMark[],
): MarPass[] {
  const markByKey = new Map<string, MedDoseMark>();
  for (const mark of marks) {
    markByKey.set(`${mark.medicationId}|${mark.doseTime}`, mark);
  }
  const byTime = new Map<string, MarPassMed[]>();
  for (const item of inventory) {
    if (item.kind !== "scheduled") continue;
    for (const doseTime of item.doseTimes) {
      const med: MarPassMed = {
        inventory: item,
        mark: markByKey.get(`${item.medicationId}|${doseTime}`) ?? null,
      };
      const list = byTime.get(doseTime) ?? [];
      list.push(med);
      byTime.set(doseTime, list);
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([doseTime, meds]) => {
      const sorted = [...meds].sort((a, b) =>
        a.inventory.medicationName.localeCompare(b.inventory.medicationName),
      );
      return {
        doseTime,
        meds: sorted,
        total: sorted.length,
        given: sorted.filter((med) => med.mark?.status === "given").length,
        recorded: sorted.filter((med) => med.mark !== null).length,
      };
    });
}

/** Pass summary as text: "5 of 5 given", "2 of 5 given · 1 missed · 2 not yet given". */
export function passSummaryText(pass: MarPass): string {
  const parts = [`${pass.given} of ${pass.total} given`];
  const others = new Map<MedDoseMarkStatus, number>();
  for (const med of pass.meds) {
    if (med.mark && med.mark.status !== "given") {
      others.set(med.mark.status, (others.get(med.mark.status) ?? 0) + 1);
    }
  }
  for (const [status, count] of others) {
    parts.push(`${count} ${DOSE_MARK_LABELS[status].toLowerCase()}`);
  }
  const unrecorded = pass.total - pass.recorded;
  if (unrecorded > 0 && pass.given < pass.total) {
    parts.push(`${unrecorded} not yet given`);
  }
  return parts.join(" · ");
}
