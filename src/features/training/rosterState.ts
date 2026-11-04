import type { StaffClearanceRow } from "../../data/types";

/**
 * Wave 7N (simulation batches 75/76): the Training page's clearance
 * verdict is derived from the staff roster through this one selector, so
 * no surface can print a verdict the roster doesn't support — the same
 * honest-state pattern as rights packets (#219) and consents (#226):
 *
 * - load failed       → "error"   (no verdict; the page offers a retry)
 * - not loaded yet    → "loading" (no verdict, no counts)
 * - loaded, zero rows → "empty"   (honest "no staff in scope" — NEVER
 *                                  "Everyone is cleared": an empty roster
 *                                  proves nothing about clearance)
 * - loaded, rows      → "ready"   (the verdict and the counts come from
 *                                  exactly the rows the page displays)
 */
export type TrainingRosterView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | {
      kind: "ready";
      rows: StaffClearanceRow[];
      notCleared: StaffClearanceRow[];
      allCleared: boolean;
    };

export function trainingRosterView(
  rows: StaffClearanceRow[] | null,
  failed: boolean,
): TrainingRosterView {
  if (failed) return { kind: "error" };
  if (!rows) return { kind: "loading" };
  if (rows.length === 0) return { kind: "empty" };
  const notCleared = rows.filter((row) => !row.clearedForInRatio);
  return { kind: "ready", rows, notCleared, allCleared: notCleared.length === 0 };
}
