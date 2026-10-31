import type { WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";

/** The workspace Individual row the shell passes around (id + profile). */
export type WorkspaceIndividual = WorkspaceView["individuals"][number];

/** Deep-link callbacks into the existing desktop surfaces. */
export interface MobileNav {
  openPage: (page: string) => void;
  /** Opens an Individual's chart; `sectionId` deep-links to a chart
   * section (e.g. the medication board) instead of the chart top. */
  openPersonChart: (name: string, sectionId?: string) => void;
  openSite: (siteId: string) => void;
  /** Opens the Employee Hub with the My Compliance tab selected. */
  openMyCompliance?: () => void;
}

export type { SessionUser };
