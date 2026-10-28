/**
 * Mobile home — "today" helpers: the Central-time greeting and the donut
 * aggregation for the "Today's tracking" card.
 *
 * The aggregation is pure: callers fetch raw counts from the existing APIs
 * and hand them in; this module decides what becomes a donut segment, what
 * stays a count-only legend row, and what the overall percentage is. The
 * donut's meaning is always carried by the legend's fraction text — the
 * ring is a picture of those numbers, never the only record of them.
 */
import { MAR_TIME_ZONE } from "./mar";

export type TrackingCategoryId =
  | "medications"
  | "ispData"
  | "checklists"
  | "shiftNotes";

/** A tracked category with a real denominator (can be a donut segment). */
export interface TrackingCategory {
  id: TrackingCategoryId;
  label: string;
  /** Solid brand-palette color for the segment and legend dot. */
  color: string;
  completed: number;
  total: number;
}

/** A tracked category with no defensible denominator (legend only). */
export interface CountOnlyCategory {
  id: TrackingCategoryId;
  label: string;
  /** Pre-formatted text, e.g. "3 written today". */
  text: string;
}

export interface TrackingArc {
  /** Category id, or "remaining" for the uncompleted part of a segment. */
  id: string;
  color: string;
  /** Start offset and length, in the same units as the category counts. */
  start: number;
  length: number;
}

export interface TrackingSegment extends TrackingCategory {
  /** This category's own completion, 0–100 (rounded). */
  percent: number;
  /** "8 of 10" — the text that carries the segment's meaning. */
  fractionText: string;
}

export interface TrackingSummary {
  segments: TrackingSegment[];
  /** Completed + remaining arcs, in count units, summing to overallTotal. */
  arcs: TrackingArc[];
  overallCompleted: number;
  overallTotal: number;
  /** Rounded percent across ONLY the categories with real denominators. */
  overallPercent: number;
  /** False when nothing with a denominator is scheduled today. */
  hasData: boolean;
}

/** Solid track color for the uncompleted part of every segment. */
export const TRACK_COLOR = "#ddd0b4";

function clampCount(value: number, total: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), total);
}

/**
 * Build the donut model from raw category counts.
 *
 * Rules: a category with total 0 is not scheduled today and drops out;
 * completed is clamped into [0, total] so a fraction can never exceed its
 * denominator; the overall percentage is completed/total across the
 * surviving categories only (count-only categories never enter the math).
 */
export function buildTrackingSummary(
  categories: TrackingCategory[],
): TrackingSummary {
  const segments: TrackingSegment[] = [];
  for (const category of categories) {
    const total = Math.max(0, Math.round(category.total));
    if (total <= 0) continue;
    const completed = clampCount(category.completed, total);
    segments.push({
      ...category,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
      fractionText: `${completed} of ${total}`,
    });
  }
  const overallCompleted = segments.reduce((sum, s) => sum + s.completed, 0);
  const overallTotal = segments.reduce((sum, s) => sum + s.total, 0);
  const arcs: TrackingArc[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.completed > 0) {
      arcs.push({
        id: segment.id,
        color: segment.color,
        start: cursor,
        length: segment.completed,
      });
      cursor += segment.completed;
    }
    const remaining = segment.total - segment.completed;
    if (remaining > 0) {
      arcs.push({
        id: `${segment.id}-remaining`,
        color: TRACK_COLOR,
        start: cursor,
        length: remaining,
      });
      cursor += remaining;
    }
  }
  return {
    segments,
    arcs,
    overallCompleted,
    overallTotal,
    overallPercent:
      overallTotal > 0
        ? Math.round((overallCompleted / overallTotal) * 100)
        : 0,
    hasData: overallTotal > 0,
  };
}

const centralHourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: MAR_TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

/** The hour (0–23) it currently is in Central. */
export function centralHour(now: Date = new Date()): number {
  return Number(centralHourFormat.format(now)) % 24;
}

/** "Morning" / "Afternoon" / "Evening" for a Central hour of day. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}
