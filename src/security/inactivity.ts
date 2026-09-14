/**
 * HIPAA §164.312(a)(2)(iii) — automatic logoff.
 *
 * Pure timing logic for the inactivity controller. The full 15-minute idle
 * window ends the session; the last 60 seconds show a warning modal with
 * "Stay signed in" / "Sign out now". Any mouse, keyboard, or touch activity
 * resets the clock.
 */

export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
export const INACTIVITY_WARNING_MS = 60 * 1000;

export type InactivityPhase = "active" | "warning" | "expired";

export function idleMs(lastActivityMs: number, nowMs: number): number {
  return Math.max(0, nowMs - lastActivityMs);
}

export function inactivityPhase(lastActivityMs: number, nowMs: number): InactivityPhase {
  const idle = idleMs(lastActivityMs, nowMs);
  if (idle >= INACTIVITY_TIMEOUT_MS) return "expired";
  if (idle >= INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS) return "warning";
  return "active";
}

/** Milliseconds remaining until automatic logoff (0 when expired). */
export function timeUntilLogoffMs(lastActivityMs: number, nowMs: number): number {
  return Math.max(0, INACTIVITY_TIMEOUT_MS - idleMs(lastActivityMs, nowMs));
}

/** Whole seconds remaining until automatic logoff. */
export function logoffCountdownSeconds(lastActivityMs: number, nowMs: number): number {
  return Math.ceil(timeUntilLogoffMs(lastActivityMs, nowMs) / 1000);
}
