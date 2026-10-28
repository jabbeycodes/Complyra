import type { WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";

/** The workspace Individual row the shell passes around (id + profile). */
export type WorkspaceIndividual = WorkspaceView["individuals"][number];

/** Deep-link callbacks into the existing desktop surfaces. */
export interface MobileNav {
  openPage: (page: string) => void;
  openPersonChart: (name: string) => void;
  openSite: (siteId: string) => void;
}

export type { SessionUser };
