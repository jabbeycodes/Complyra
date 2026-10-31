/**
 * In-page section links (wave 6, item 2).
 *
 * The app router (App.tsx) treats every location hash as a page key: an
 * unrecognized hash falls back to the default landing page. A plain
 * `href="#chart-meds"` anchor therefore NAVIGATES AWAY to the agency
 * Overview instead of scrolling — that is how "Open medication board" on
 * a chart opened the Overview in simulation batches 34/35 (and why the
 * Help table-of-contents links were broken the same way). Section links
 * must keep their href (middle-click / copy-link still work) but cancel
 * the navigation and scroll in-page. Every board/section action goes
 * through the helpers here so the target per action is pinned in one
 * place.
 */

/** Chart board actions and the section each one must land on. */
export const CHART_SECTION_IDS = {
  medicationBoard: "chart-meds",
  appointments: "chart-appointments",
  shiftNotes: "chart-shift-notes",
} as const;

export type ChartBoardAction = keyof typeof CHART_SECTION_IDS;

export function chartSectionId(action: ChartBoardAction): string {
  return CHART_SECTION_IDS[action];
}

/** The browser scroll: bring the section into view if it is rendered. */
export function scrollToSectionId(id: string): void {
  if (typeof document === "undefined") return;
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Click handler for a section anchor: cancel the hash navigation (which
 * the router would misread as a page change) and scroll in-page instead.
 * `scroll` is injectable so tests can pin the target per action without
 * a DOM.
 */
export function sectionClickHandler(
  id: string,
  scroll: (id: string) => void = scrollToSectionId,
): (event: { preventDefault(): void }) => void {
  return (event) => {
    event.preventDefault();
    scroll(id);
  };
}

/** Convenience: the handler for a chart board action. */
export function chartSectionClickHandler(
  action: ChartBoardAction,
  scroll: (id: string) => void = scrollToSectionId,
): (event: { preventDefault(): void }) => void {
  return sectionClickHandler(chartSectionId(action), scroll);
}
