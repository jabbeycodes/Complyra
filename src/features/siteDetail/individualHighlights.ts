/**
 * Issue #78 — per-Individual staff highlights for the program site Overview.
 *
 * These helpers are deliberately PURE: they select highlight rows from the
 * EXISTING Individual profile fields (no new schema). "Alone-time status"
 * and "staffing notes" have no existing profile field, so they are not
 * included — we surface what exists rather than inventing data.
 */
import type { IndividualProfile } from "../../data/planStack";
import type { AdaptiveEquipment } from "../../data/monthlyChecks";

export type IndividualHighlightTone = "alert" | "neutral";

export interface IndividualHighlight {
  /** Short label, e.g. "Allergies". */
  label: string;
  /** Display text, e.g. "Tree nuts (hives)". */
  value: string;
  /** "alert" renders with high-contrast safety styling; never color-only. */
  tone: IndividualHighlightTone;
}

/** Values that mean "nothing recorded" and should not produce a highlight. */
const BLANK_VALUES = new Set(["", "none", "n/a", "na", "-", "unknown"]);

function isBlank(value: string | undefined | null): boolean {
  const s = (value ?? "").trim();
  return s === "" || BLANK_VALUES.has(s.toLowerCase());
}

/**
 * Build the staff highlight list for one individual, in display order:
 * safety-critical first (allergies), then diagnosis, diet, medical,
 * adaptive equipment, behavior supports, daily routine.
 */
export function individualHighlights(
  individualId: string,
  profile: IndividualProfile | null,
  equipment: readonly AdaptiveEquipment[] = [],
): IndividualHighlight[] {
  const highlights: IndividualHighlight[] = [];

  const activeAllergies = (profile?.allergies ?? []).filter(
    (a) => a.status === "active" && a.allergen.trim() !== "",
  );
  if (activeAllergies.length > 0) {
    highlights.push({
      label: "Allergies",
      value: activeAllergies
        .map((a) =>
          a.reaction.trim()
            ? `${a.allergen.trim()} (${a.reaction.trim()})`
            : a.allergen.trim(),
        )
        .join("; "),
      tone: "alert",
    });
  }

  const diagnosis = (profile?.diagnosis ?? "").trim();
  if (!isBlank(diagnosis)) {
    highlights.push({ label: "Diagnosis", value: diagnosis, tone: "neutral" });
  }

  const diet = (profile?.specializedDiet ?? "").trim();
  if (!isBlank(diet)) {
    highlights.push({ label: "Diet", value: diet, tone: "neutral" });
  }

  const medical = (profile?.specializedMedical ?? "").trim();
  if (!isBlank(medical)) {
    highlights.push({ label: "Medical", value: medical, tone: "neutral" });
  }

  const activeEquipment = equipment
    .filter(
      (e) =>
        e.individualId === individualId && e.active && e.name.trim() !== "",
    )
    .map((e) => e.name.trim());
  if (activeEquipment.length > 0) {
    highlights.push({
      label: "Adaptive equipment",
      value: activeEquipment.join("; "),
      tone: "neutral",
    });
  }

  const behavior = (profile?.behaviorSupports ?? "").trim();
  if (!isBlank(behavior)) {
    highlights.push({
      label: "Behavior supports",
      value: behavior,
      tone: "neutral",
    });
  }

  const routine = (profile?.dailyActivities ?? "").trim();
  if (!isBlank(routine)) {
    highlights.push({ label: "Daily routine", value: routine, tone: "neutral" });
  }

  return highlights;
}
