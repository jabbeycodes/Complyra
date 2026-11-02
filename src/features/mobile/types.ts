import type { WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";

/** The workspace Individual row the shell passes around (id + profile). */
export type WorkspaceIndividual = WorkspaceView["individuals"][number];

/** Deep-link callbacks into the existing desktop surfaces. */
export interface MobileNav {
  openPage: (page: string) => void;
  openPersonChart: (name: string) => void;
  openSite: (siteId: string) => void;
  /** Opens the Employee Hub with the My Compliance tab selected. */
  openMyCompliance?: () => void;
  /** Opens the Employee Hub with the named tab selected (e.g.
   *  "payroll" from the phone hub's HR doors). */
  openHubTab?: (tab: string) => void;
}

export type { SessionUser };
