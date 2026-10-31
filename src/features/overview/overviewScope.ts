/**
 * Overview header scope helpers (wave 6, item 6; simulation batches
 * 26–33: the Overview on a REAL agency carried demo framing — a
 * "Sample agency snapshot" label — and its site filter defaulted to
 * "All sites" for viewers who only work at one home).
 *
 * Header copy/preset ONLY: nothing here touches how Overview metrics
 * are computed (the Codex admin slices own that contract).
 */

/** The demo agency's provider code (matches src/data/seed.ts). */
export const DEMO_AGENCY_CODE = "EVERGREEN-MO";

/**
 * True when the session belongs to the built-in demo workspace. Demo
 * wording ("Sample agency snapshot") may render ONLY for this session;
 * a real agency's Overview is its own live record, never a "sample".
 * Same pattern PR #202 uses for the Ask Complyrer demo framing.
 */
export function isDemoSession(session: { agencyCode?: string | null }): boolean {
  return session.agencyCode === DEMO_AGENCY_CODE;
}

/** The Overview snapshot label, or null when no label should render. */
export function overviewSnapshotLabel(session: {
  agencyCode?: string | null;
}): string | null {
  return isDemoSession(session) ? "Sample agency snapshot" : null;
}

/**
 * The site filter's starting value: a viewer who can see exactly one
 * home starts scoped to that home; a viewer with several (or none
 * resolved yet) starts on "All sites".
 */
export function defaultOverviewSiteFilter(
  visibleSiteNames: readonly string[],
): string {
  return visibleSiteNames.length === 1 ? visibleSiteNames[0] : "All sites";
}
