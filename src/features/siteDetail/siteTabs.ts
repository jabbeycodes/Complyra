import { pageVisible } from "../../data/status";
import type { SessionUser } from "../../data/types";

export type SiteDetailTabId =
  | "overview"
  | "individuals"
  | "audits"
  | "checklists"
  | "training"
  | "medications"
  | "mileage"
  | "shiftnotes"
  | "staff";

export interface SiteDetailTab {
  id: SiteDetailTabId;
  label: string;
  /**
   * Permission gate for the tab. Each rule mirrors the equivalent full
   * page's `pageVisible` gate so the detail view never shows more than the
   * standalone page would.
   */
  visible: (session: SessionUser | null) => boolean;
}

/**
 * Issue #94: the Drills section lives inside the Checklists tab and keeps the
 * OLD standalone-Drills-tab visibility (anyone who can open the site detail
 * page sees it). It must NOT inherit the checklist-permissions gate — DSPs on
 * caseload lost drill history when #93 nested drills under that gate.
 */
export function canSeeSiteDrills(session: SessionUser | null): boolean {
  return !!session && pageVisible(session, "Individuals");
}

/**
 * The checklist-permissions gate: HM weekly checklists, service logs, and
 * monthly home checks. Mirrors the existing gates: "Weekly checklist"
 * (HM/agency admin) plus "Checklist assignments" (PM/agency admin).
 */
export function canSeeSiteChecklists(session: SessionUser | null): boolean {
  return (
    !!session &&
    (pageVisible(session, "Weekly checklist") ||
      pageVisible(session, "Checklist assignments"))
  );
}

/**
 * Tab order for the program-site detail view. Staff is ALWAYS last — this is
 * a product requirement, not a preference. Do not reorder without Joshua.
 *
 * Issue #94: the standalone Drills tab is gone; drills live as the first
 * section inside Checklists. The Checklists tab stays reachable for everyone
 * who could see the old Drills tab (canSeeSiteDrills), so drill history is
 * never hidden behind the checklist-permissions gate — the checklist content
 * itself stays gated inside the panel.
 */
const SITE_DETAIL_TABS: readonly SiteDetailTab[] = [
  { id: "overview", label: "Overview", visible: () => true },
  {
    id: "individuals",
    label: "Individuals",
    visible: (s) => !!s && pageVisible(s, "Individuals"),
  },
  {
    id: "audits",
    label: "QA Review",
    // Mirrors the QA Review page gate so the tab never shows more than the
    // standalone page would. Tab id stays "audits" (tests depend on it).
    visible: (s) => !!s && pageVisible(s, "QA Review"),
  },
  {
    id: "checklists",
    label: "Checklists",
    visible: (s) => canSeeSiteChecklists(s) || canSeeSiteDrills(s),
  },
  {
    id: "training",
    label: "Training",
    visible: (s) =>
      !!s && (pageVisible(s, "Training") || pageVisible(s, "Delegations")),
  },
  {
    id: "medications",
    label: "Medications",
    visible: (s) => !!s && pageVisible(s, "Supply forecast"),
  },
  {
    id: "mileage",
    label: "Mileage",
    visible: (s) => !!s && pageVisible(s, "Mileage"),
  },
  {
    // Issue #80: the Documents tab becomes Shift notes. Standalone document
    // uploads stay reachable via the Documents page (linked from the tab's
    // empty state). Tab order unchanged — Staff stays last (founder rule).
    id: "shiftnotes",
    label: "Shift notes",
    visible: (s) => !!s && pageVisible(s, "ShiftNotes"),
  },
  { id: "staff", label: "Staff", visible: (s) => !!s && pageVisible(s, "Staff") },
];

export const SITE_DETAIL_TAB_IDS: readonly SiteDetailTabId[] =
  SITE_DETAIL_TABS.map((t) => t.id);

/** Tabs the session may see, in canonical order. Staff is always last. */
export function getSiteDetailTabs(
  session: SessionUser | null,
): SiteDetailTab[] {
  return SITE_DETAIL_TABS.filter((t) => t.visible(session));
}
