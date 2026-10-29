/**
 * The bottom navigation on the platform's regular pages in mobile view.
 *
 * The mobile shell has its own pill for its own screens; this is the same
 * pill — same role-gated destinations from bottomNav.ts over the same
 * tile gates — rendered by the desktop layout when it is showing in a
 * mobile context (a phone-width viewport, or a deep-linked page under the
 * persisted mobile-view pick). It adds the one behavior the long desktop
 * pages need: collapse to a remnant on scroll down, restore on tap or
 * scroll up (see scrollNav.ts).
 *
 * Tapping a destination hands the intent to the app, which returns to
 * the mobile shell at that destination — the pill's destinations are
 * shell views, and there is exactly one implementation of each.
 */
import { useMemo } from "react";
import { pageVisible } from "../../data/status";
import type { SessionUser } from "../../data/types";
import BottomNavPill from "./BottomNavPill";
import { bottomNavItems, type BottomNavId } from "./bottomNav";
import { mobileTiles } from "./tiles";
import { useScrollCollapse } from "./useScrollCollapse";
import "./mobile.css";

export default function PlatformBottomNav({
  session,
  queueCount,
  activeId,
  onDestination,
}: {
  session: SessionUser;
  queueCount: number;
  activeId: BottomNavId | null;
  onDestination: (id: BottomNavId) => void;
}) {
  const items = useMemo(
    () =>
      bottomNavItems(
        mobileTiles({
          roleKey: session.roleKey,
          permissions: session.permissions,
          canPage: (page) => pageVisible(session, page),
        }),
      ),
    [session],
  );
  const { collapsed, restore } = useScrollCollapse();
  return (
    <BottomNavPill
      items={items}
      activeId={activeId}
      taskCount={queueCount}
      onSelect={onDestination}
      collapsed={collapsed}
      onRestore={restore}
    />
  );
}
