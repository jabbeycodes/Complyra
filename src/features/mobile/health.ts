/**
 * Mobile Health — the seven day-to-day trackers on a phone.
 *
 * The chart's Trackers-and-logs section carries twelve kinds; the mobile
 * Health home carries the SEVEN observational logs staff record during a
 * shift — intake, elimination, vitals, blood glucose, skin monitoring,
 * seizures, and menses. (Immunizations, labs, infections, sleep, and
 * respiratory treatments stay on the chart in this phase.) Medications
 * are NOT a tracker here: the MAR is its own mobile view, and the Health
 * home deep-links to it rather than duplicating it.
 *
 * These trackers are observational logs, not scheduled obligations —
 * there is no "due" rule to invent. A row's status is purely factual:
 * what was logged today, and when the last entry was. Pure functions so
 * the wording is unit-tested without rendering.
 */
import {
  HEALTH_TRACK_KIND_LABELS,
  type HealthTrackEntry,
  type HealthTrackKind,
} from "../../data/healthTrack";
import { HEALTH_KIND_FIELDS } from "../healthTrack/kindFields";
import { centralNowHhmm, formatDoseTime, formatIsoDay, shiftIsoDate } from "./mar";

/** The seven trackers on the mobile Health home, daily-driver order. */
export const MOBILE_HEALTH_KINDS: readonly HealthTrackKind[] = [
  "intake",
  "elimination",
  "vitals",
  "glucose",
  "skin",
  "seizure",
  "menses",
];

/**
 * Kinds that happen when they happen (an event, a cycle) rather than on a
 * daily rhythm — for these the useful status is the last-logged date,
 * never a "missing today" framing.
 */
export const EPISODIC_HEALTH_KINDS: ReadonlySet<HealthTrackKind> = new Set([
  "seizure",
  "menses",
]);

export function healthKindLabel(kind: HealthTrackKind): string {
  return HEALTH_TRACK_KIND_LABELS[kind];
}

/** Newest first: by record date, then by the instant it was recorded. */
export function sortHealthEntries(
  entries: readonly HealthTrackEntry[],
): HealthTrackEntry[] {
  return [...entries].sort((a, b) =>
    b.occurredOn !== a.occurredOn
      ? b.occurredOn.localeCompare(a.occurredOn)
      : b.createdAt.localeCompare(a.createdAt),
  );
}

function entryHeadline(entry: HealthTrackEntry): string {
  const time = entry.details.timeOfDay?.trim();
  return time ? `${entry.title} · ${formatDoseTime(time)}` : entry.title;
}

export interface TrackerStatus {
  kind: HealthTrackKind;
  label: string;
  /** Entries of this kind dated today. */
  todayCount: number;
  /** The newest entry of this kind, any date (null when never logged). */
  lastEntry: HealthTrackEntry | null;
  /** Status in words — never color alone. */
  text: string;
}

/**
 * One tracker's status for the Health home. `entries` is the person's
 * full entry list (any kind, any date); `todayIso` is Central today,
 * matching the rest of the mobile shell.
 */
export function trackerStatus(
  entries: readonly HealthTrackEntry[],
  kind: HealthTrackKind,
  todayIso: string,
): TrackerStatus {
  const sorted = sortHealthEntries(
    entries.filter((entry) => entry.kind === kind),
  );
  const todays = sorted.filter((entry) => entry.occurredOn === todayIso);
  const lastEntry = sorted[0] ?? null;
  const label = healthKindLabel(kind);
  let text: string;
  if (todays.length > 0) {
    const latest = todays[0];
    text =
      todays.length === 1
        ? `Logged today · ${entryHeadline(latest)}`
        : `${todays.length} logged today · latest: ${entryHeadline(latest)}`;
  } else if (lastEntry) {
    text = EPISODIC_HEALTH_KINDS.has(kind)
      ? `Last logged ${formatIsoDay(lastEntry.occurredOn)} · ${lastEntry.title}`
      : `Nothing yet today · last: ${formatIsoDay(lastEntry.occurredOn)} · ${lastEntry.title}`;
  } else {
    text = "Nothing logged yet";
  }
  return { kind, label, todayCount: todays.length, lastEntry, text };
}

/** All seven tracker statuses for one person, in display order. */
export function healthHomeStatuses(
  entries: readonly HealthTrackEntry[],
  todayIso: string,
): TrackerStatus[] {
  return MOBILE_HEALTH_KINDS.map((kind) => trackerStatus(entries, kind, todayIso));
}

/**
 * How many entries across the seven mobile trackers are dated today.
 * Summed from the same trackerStatus counts the Health home renders, so
 * a house-level total (the Quick log chooser sums this over the home's
 * Individuals) can never drift from what the Health home itself shows.
 */
export function todaysHealthEntryCount(
  entries: readonly HealthTrackEntry[],
  todayIso: string,
): number {
  return MOBILE_HEALTH_KINDS.reduce(
    (sum, kind) => sum + trackerStatus(entries, kind, todayIso).todayCount,
    0,
  );
}

/**
 * Starting detail values for a quick-log sheet: kinds that carry a
 * time-of-day start at the current Central time so logging "now" is one
 * tap; everything else starts blank, exactly as on the chart.
 */
export function initialHealthDetails(
  kind: HealthTrackKind,
  now: Date = new Date(),
): Record<string, string> {
  const details: Record<string, string> = {};
  if (HEALTH_KIND_FIELDS[kind].some((field) => field.key === "timeOfDay")) {
    details.timeOfDay = centralNowHhmm(now);
  }
  return details;
}

/** Yesterday's ISO date — used by tests and date stepping, kept tiny. */
export function healthYesterdayIso(todayIso: string): string {
  return shiftIsoDate(todayIso, -1);
}
