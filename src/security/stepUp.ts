/**
 * Step-up reauthentication for sensitive actions (viewing a complete
 * individual record, exporting data).
 *
 * After a successful re-auth, a short grace window avoids pestering the user
 * on every click; each new sensitive action outside the window prompts
 * again. The confirmation itself is the shared ReauthSheet (password
 * re-entry), which clears the secret on success.
 */

/** How long a successful step-up stays fresh before prompting again. */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

export function stepUpIsFresh(lastVerifiedAtMs: number | null, nowMs: number): boolean {
  if (lastVerifiedAtMs == null) return false;
  return nowMs - lastVerifiedAtMs < STEP_UP_WINDOW_MS;
}
