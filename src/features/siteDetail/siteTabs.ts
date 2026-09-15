import { pageVisible } from "../../data/status";
import type { SessionUser } from "../../data/types";

export type SiteDetailTabId =
  | "overview"
  | "individuals"
  | "isp_data"
  | "audits"
  | "checklists"
  | "training"
  | "medications"
  | "mileage"
  | "drills"
  | "documents"
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
 * Tab order for the program-site detail view. Staff is ALWAYS last — this is
 * a product requirement, not a preference. Do not reorder without Joshua.
 */
const SITE_DETAIL_TABS: readonly SiteDetailTab[] = [
  { id: "overview", label: "Overview", visible: () => true },
  {
    id: "individuals",
    label: "Individuals",
    visible: (s) => !!s && pageVisible(s, "Individuals"),
  },
  {
    id: "isp_data",
    label: "ISP data",
    visible: (s) => !!s && pageVisible(s, "ISP data"),
  },
  {
    id: "audits",
    label: "Audits",
    visible: (s) => !!s && pageVisible(s, "Audit center"),
  },
  {
    id: "checklists",
    label: "Checklists",
    // Mirrors the existing gates: "Weekly checklist" (HM/agency admin) plus
    // "Checklist assignments" (DPM/agency admin).
    visible: (s) =>
      !!s &&
      (pageVisible(s, "Weekly checklist") ||
        pageVisible(s, "Checklist assignments")),
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
    id: "drills",
    label: "Drills",
    visible: (s) => !!s && pageVisible(s, "Individuals"),
  },
  {
    id: "documents",
    label: "Documents",
    visible: (s) => !!s && pageVisible(s, "Documents"),
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
