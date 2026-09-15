import type { IspExpectationView } from "../../data/types";

/**
 * Complyrer's own wording for a one-click message to a staffer about an
 * overdue or soon-due shift note. Plain, actionable, no vendor names.
 */
export function escalationMessageFor(exp: IspExpectationView): string {
  const due = new Date(exp.dueAt);
  const time = due.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Your shift note for ${exp.individualName} (${exp.shiftName}, ${exp.workDate}) is due at ${time} — please submit it in Complyrer.`;
}
