import { DRILL_LABELS, type DrillType } from "../../data/monthlyChecks";
import { reviewStatusLabel } from "../../data/status";

/** Human drill name for site-detail lists. Never print raw slugs like severe_weather. */
export function formatDrillTypeLabel(type: string): string {
  if (type in DRILL_LABELS) return DRILL_LABELS[type as DrillType];
  return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function trainingProgressLine(
  profile: { counts: { complete: number; required: number } } | null,
  failed: boolean,
): string {
  if (failed) return "Training record unavailable.";
  if (!profile) return "No training checklist started.";
  if (profile.counts.required === 0) return "No required training items yet.";
  return `${profile.counts.complete} of ${profile.counts.required} training items complete`;
}

export function documentStatusLabel(status: string): string {
  if (status === "pending_review" || status === "active" || status === "archived") {
    return reviewStatusLabel(status);
  }
  return status.replace(/_/g, " ");
}
