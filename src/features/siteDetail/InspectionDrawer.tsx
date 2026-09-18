import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface InspectionDrawerProps {
  /** Non-null opens the drawer; the value is the labelled title. */
  title: string | null;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** e.g. the "Start investigation" button — rendered under the body. */
  footer?: React.ReactNode;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
}

/**
 * Shared slide-over inspection drawer (issue #98): every site-dashboard
 * tile opens its records here. Focus-trapped, Escape closes, focus returns
 * to the tile that opened it.
 */
export default function InspectionDrawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: InspectionDrawerProps) {
  const open = title !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = "inspection-drawer-title";

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the panel first; then the close button once painted.
    panel?.focus();
    const t = window.setTimeout(() => {
      const closeBtn = panel?.querySelector<HTMLElement>("[data-drawer-close]");
      (closeBtn ?? panel)?.focus();
    }, 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusableIn(panel);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="inspection-drawer-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="inspection-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="inspection-drawer-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="button inspection-drawer-close"
            data-drawer-close
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="inspection-drawer-body">{children}</div>
        {footer && <div className="inspection-drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}
