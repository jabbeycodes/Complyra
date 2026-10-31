/**
 * Mobile bottom navigation — the floating pill's destinations.
 *
 * The pill mirrors the tile gates: a destination renders only when the
 * role can use the surface behind it (the same rule the tile grid has
 * always followed). Home and More always render — Home is the shell
 * itself, and More carries whatever tiles the pill does not.
 *
 * There is deliberately no "Meds" destination (founder directive,
 * 2026-10-31: medications live UNDER Health on mobile). Health is the
 * single door for health + medications; it rides the tile grid and the
 * More sheet like every other non-pill surface.
 */
import type { MobileTile, MobileTileId } from "./tiles";

export type BottomNavId = "home" | "tasks" | "people" | "more";

export interface BottomNavItem {
  id: BottomNavId;
  label: string;
}

/** Tiles that have their own pill destination (so More does not repeat them). */
const PILL_TILES: Partial<Record<BottomNavId, MobileTileId>> = {
  tasks: "myTasks",
  people: "individuals",
};

/**
 * Pill destinations for this user, in display order:
 * Home · Tasks · People · More — minus any destination whose tile the
 * role cannot use. Never more than four; Home and More always render.
 */
export function bottomNavItems(tiles: MobileTile[]): BottomNavItem[] {
  const ids = new Set(tiles.map((tile) => tile.id));
  const items: BottomNavItem[] = [{ id: "home", label: "Home" }];
  if (ids.has("myTasks")) items.push({ id: "tasks", label: "Tasks" });
  if (ids.has("individuals")) items.push({ id: "people", label: "People" });
  items.push({ id: "more", label: "More" });
  return items;
}

/** Tiles that live in the More sheet (everything the pill does not carry). */
export function moreSheetTiles(tiles: MobileTile[]): MobileTile[] {
  const carried = new Set(Object.values(PILL_TILES));
  return tiles.filter((tile) => !carried.has(tile.id));
}
