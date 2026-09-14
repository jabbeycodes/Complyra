/**
 * Rollover feedback copy (LIFEPATH-P5 HM weekly checklist).
 *
 * The Sunday rollover (`api.rolloverWeeklyChecklists()`) is idempotent and
 * runs on page load: it locks prior open weeks as overdue and opens a fresh
 * blank checklist for the current week for every active house manager with a
 * site. Nothing is carried over — each week starts clean. This helper turns
 * the `{ created, locked }` result into the one-line success summary shown
 * to the house manager, or null when the rollover changed nothing (in which
 * case no banner is shown).
 */
export function formatRolloverNotice(result: {
  created: number;
  locked: number;
}): string | null {
  const { created, locked } = result;
  if (created <= 0 && locked <= 0) return null;
  const opened =
    created === 1
      ? "1 new checklist opened for this week"
      : `${created} new checklists opened for this week`;
  if (locked <= 0) return `New week started — ${opened}.`;
  const overdue =
    locked === 1
      ? "1 prior week marked overdue"
      : `${locked} prior weeks marked overdue`;
  return `New week started — ${opened}; ${overdue}.`;
}
