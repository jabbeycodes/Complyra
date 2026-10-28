import { useEffect, useRef, useState } from "react";
import { createScrollCollapse, type ScrollCollapse } from "./scrollNav";

/**
 * Drives the platform pill's collapse state from window scrolling.
 *
 * The desktop layout scrolls on the window (the sidebar is fixed and the
 * main column flows with the document), so the listener lives there;
 * scroll events are coalesced through requestAnimationFrame so the state
 * updates at most once per frame.
 */
export function useScrollCollapse(): {
  collapsed: boolean;
  restore: () => void;
} {
  const machineRef = useRef<ScrollCollapse | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createScrollCollapse();
  }
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const machine = machineRef.current;
    if (!machine) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        setCollapsed(machine.update(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const restore = () => {
    const machine = machineRef.current;
    if (machine) setCollapsed(machine.restore(window.scrollY));
  };

  return { collapsed, restore };
}
