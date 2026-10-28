/**
 * Bottom navigation scroll behavior — a small pure state machine.
 *
 * Founder rule for the platform-wide pill: scrolling DOWN collapses it to
 * a slim remnant (never fully gone), TAPPING the remnant restores it, and
 * scrolling UP restores it. The machine exists to keep that behavior free
 * of jitter:
 *
 * - Movement is measured from an anchor that only moves when a threshold
 *   crossing is acted on, so sub-threshold drift accumulates instead of
 *   flipping the state back and forth (hysteresis / dead-zone).
 * - Near the top of the page the nav is always expanded — there is
 *   nothing to gain screen space from up there.
 * - restore() (the remnant tap) re-anchors at the tap position, so the
 *   nav stays up until the user scrolls a full dead-zone downward again.
 *
 * The machine is deliberately DOM-free: callers feed it scroll positions
 * (the app shell scrolls on the window) and render from its verdict.
 */
export interface ScrollCollapseOptions {
  /** Travel in px from the anchor that flips the state. Default 10. */
  deadZone?: number;
  /** At or above this scroll position the nav is always expanded. Default 48. */
  topZone?: number;
}

export interface ScrollCollapse {
  /** Feed a scroll position; returns whether the nav is collapsed. */
  update: (scrollY: number) => boolean;
  /** The remnant was tapped; expands and re-anchors. Returns false. */
  restore: (scrollY: number) => boolean;
  collapsed: () => boolean;
}

export function createScrollCollapse(
  options: ScrollCollapseOptions = {},
): ScrollCollapse {
  const deadZone = options.deadZone ?? 10;
  const topZone = options.topZone ?? 48;
  let isCollapsed = false;
  let anchor = 0;
  let started = false;

  function update(rawY: number): boolean {
    const y = Math.max(0, rawY);
    if (!started) {
      started = true;
      anchor = y;
      return isCollapsed;
    }
    if (y <= topZone) {
      isCollapsed = false;
      anchor = y;
      return isCollapsed;
    }
    const dy = y - anchor;
    if (dy >= deadZone) {
      isCollapsed = true;
      anchor = y;
    } else if (dy <= -deadZone) {
      isCollapsed = false;
      anchor = y;
    }
    return isCollapsed;
  }

  function restore(rawY: number): boolean {
    isCollapsed = false;
    anchor = Math.max(0, rawY);
    started = true;
    return isCollapsed;
  }

  return { update, restore, collapsed: () => isCollapsed };
}
