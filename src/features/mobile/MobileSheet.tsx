import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerTitle,
} from "@ui-sdk/react/drawer";

/**
 * The shared mobile bottom sheet, on @ui-sdk/react's Drawer
 * (UI SDK slice 5). Every mobile sheet used to hand-roll the same
 * backdrop button + `msh-sheet` div with role="dialog": no Escape,
 * no focus trap or return, no scroll lock, no drag dismissal. This
 * wrapper keeps the house markup and classes — `.msh-sheet-backdrop`
 * on the backdrop part (rendered as the same labelled button, so a
 * press still closes), `.msh-sheet` plus the surface's extra class
 * (`mq-sheet`, `msh-packet-sheet`, `msh-health-sheet`) on the content
 * part, and the visible `h3.msh-sheet-title` as the title part, which
 * also wires the dialog's accessible name to that heading.
 *
 * Callers mount the sheet only while it is open (the pattern the
 * shared Modal established in slice 1), so the Drawer is controlled
 * open for its whole life and its dismissals (Escape, backdrop
 * press) route to the caller's onClose, which unmounts it. There is
 * no trigger for ui-sdk to return focus to, so the element focused
 * at first render is captured and handed back as the content's
 * finalFocus, with the same unmount restore the Modal uses.
 *
 * Swipe/drag dismissal is refused outright (see dismissible below):
 * the hand-rolled sheet had no swipe gesture, and most sheets host
 * forms — a stray drag must never throw away in-progress entries.
 * Reviewer block on PR #290; parity with the old sheet is the
 * ruling, so the gesture is not adopted at all rather than gated
 * per-surface.
 */
export default function MobileSheet({
  title,
  backdropLabel,
  className,
  initialFocus,
  suppressFocusReturnRef,
  onClose,
  children,
}: {
  /** Visible heading text; the title part makes it the dialog's name. */
  title: ReactNode;
  /** The backdrop button's accessible name ("Close … form"). */
  backdropLabel: string;
  /** Extra sheet class from the surface's old markup, if any. */
  className?: string;
  /**
   * CSS selector for the element to focus when the sheet opens, for
   * surfaces whose hand-rolled sheet relied on an autoFocus field
   * (the drawer's default "auto" would otherwise focus the first
   * focusable element and override it). Omit for the default.
   */
  initialFocus?: string;
  /**
   * For a surface that unmounts the sheet to navigate elsewhere
   * rather than to dismiss it (the More menu's rows), a ref whose
   * current value is set true — synchronously, just before the close
   * — so focus is NOT returned to the opener and can fall to the
   * destination instead of snapping back to the control that opened
   * the sheet. It must be a ref because a navigation unmounts the
   * sheet in the same commit that requests the close, so a plain prop
   * could never reach this component in time. Omit it (the default)
   * to always return focus, as every dismissal should.
   */
  suppressFocusReturnRef?: RefObject<boolean>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [returnFocusTo] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null,
  );
  useEffect(() => {
    return () => {
      if (suppressFocusReturnRef?.current) return;
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [returnFocusTo, suppressFocusReturnRef]);
  return (
    <Drawer
      open
      // dismissible={false} makes the SDK refuse every dismissal at
      // the driver level — a swipe is resisted and springs back
      // instead of closing, on both the pointer and scroll-snap
      // drivers. (Cancelling the swipe in onOpenChange was not
      // enough: the scroll-snap driver had already scrolled the
      // sheet off-screen by the time the change was refused.)
      dismissible={false}
      onDismissAttempt={(details) => {
        // The intentional close paths route to the caller as
        // before; a swipe (or a platform Back, which the old sheet
        // never had) is refused by doing nothing.
        if (
          details.reason === "escape-key" ||
          details.reason === "outside-press"
        ) {
          onClose();
        }
      }}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerBackdrop
        className="msh-sheet-backdrop"
        render={<button type="button" aria-label={backdropLabel} />}
      />
      <DrawerContent
        className={className ? `msh-sheet ${className}` : "msh-sheet"}
        initialFocus={initialFocus}
        finalFocus={() => returnFocusTo}
      >
        <DrawerTitle render={<h3 className="msh-sheet-title" />}>
          {title}
        </DrawerTitle>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
