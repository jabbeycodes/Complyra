import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import {
  X,
  ChevronRight,
  FileText,
  Check,
  ArrowUpRight,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { Requirement, Status } from "./domain";
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status.toLowerCase().replaceAll(" ", "-")}`}>
      <span />
      {status}
    </span>
  );
}
export function Avatar({
  name,
  color = "purple",
  small = false,
  src,
}: {
  name: string;
  color?: string;
  small?: boolean;
  /** Uploaded portrait when present; initials stay the fallback. */
  src?: string | null;
}) {
  const initials = name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("");
  return (
    <span className={`avatar ${color} ${small ? "small" : ""} ${src ? "has-photo" : ""}`}>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  // Callers mount Modal only while it is open, so the Dialog is controlled
  // open for its whole life and every dismissal ui-sdk offers (Escape,
  // backdrop press, the close button) routes to the caller's onClose,
  // which unmounts it. The parts keep the house markup and classes; the
  // title part wires the dialog's accessible name to the visible heading.
  // There is no trigger for ui-sdk to return focus to, so we snapshot the
  // focused element ourselves and hand it back as the content's finalFocus.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  // Snapshot the opener in a layout effect, not during render: when one
  // Modal replaces another (e.g. the sign-off flow's loading → adoption →
  // form swap), the render phase still sees the outgoing dialog holding
  // focus, so it would record a node that is about to unmount and leave
  // focus on <body> at close. The outgoing Modal's cleanup below runs
  // first (also a layout effect) and returns focus to the real opener, so
  // by the time this runs the opener is focused again — and ui-sdk re-takes
  // focus for this dialog on its own timer afterwards. Restoring on unmount
  // is how every close lands (onClose removes Modal); it keeps focus off
  // <body>, as the native <dialog> did on removal.
  useLayoutEffect(() => {
    returnFocusTo.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    return () => {
      if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
    };
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogBackdrop className="modal-backdrop" />
      <DialogContent
        className={`modal ${wide ? "wide" : ""}`}
        finalFocus={() => returnFocusTo.current}
      >
        <div className="modal-head">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose className="icon-button" aria-label="Close dialog">
            <X size={20} />
          </DialogClose>
        </div>
        <div className="modal-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
export function Empty({
  title = "No matching requirements",
  text,
  mark = "check",
  actions,
}: {
  title?: string;
  text?: string;
  /** "check" is the all-clear empty. Filed-nothing states must use quiet/none. */
  mark?: "check" | "quiet" | "none";
  actions?: ReactNode;
}) {
  return (
    <div className={`empty${mark === "none" ? " empty-bare" : ""}${mark === "quiet" ? " empty-quiet" : ""}`}>
      {mark !== "none" && (
        <span aria-hidden="true">{mark === "check" ? <Check size={26} /> : null}</span>
      )}
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="heading-actions">{children}</div> : null}
    </div>
  );
}
export function RequirementTable({
  items,
  onSelect,
  compact = false,
}: {
  items: Requirement[];
  onSelect: (r: Requirement) => void;
  compact?: boolean;
}) {
  if (!items.length) return <Empty />;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Requirement</th>
            {!compact && <th>Individual / site</th>}
            <th>Assigned to</th>
            <th>Due date</th>
            <th>Status</th>
            <th>
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} onClick={() => onSelect(r)}>
              <td>
                <button
                  className="table-title"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(r);
                  }}
                >
                  {r.title}
                </button>
                <span className="cell-sub">
                  {compact ? `${r.person} · ${r.site}` : r.category}
                </span>
              </td>
              {!compact && (
                <td>
                  {r.person}
                  <span className="cell-sub">{r.site}</span>
                </td>
              )}
              <td>
                <span className="person-cell">
                  <Avatar name={r.owner} small />
                  {r.owner}
                </span>
              </td>
              <td
                className={
                  r.status === "Overdue" || r.status === "Expired"
                    ? "overdue-text"
                    : ""
                }
              >
                {formatDate(r.due)}
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              <td>
                <ChevronRight size={16} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function formatDate(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
export function formatDateLong(date: string) {
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function dateParts(date: string) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return {
    month: parsed.toLocaleDateString("en-US", { month: "short" }),
    day: String(parsed.getDate()),
  };
}

export function DueChip({
  date,
  status = "Current",
}: {
  date: string;
  status?: string;
}) {
  const { month, day } = dateParts(date);
  const tone =
    status === "Overdue" ? "overdue" : status === "Due soon" ? "due-soon" : "current";
  return (
    <span
      className={`due-chip ${tone}`}
      title={`${status}: ${month} ${day}`}
      aria-label={`${status} ${month} ${day}`}
    >
      <span className="due-chip-month">{month}</span>
      <span className="due-chip-day">{day}</span>
    </span>
  );
}
export function FilterBar({
  query,
  setQuery,
  status,
  setStatus,
  count,
  statuses,
}: {
  query: string;
  setQuery: (s: string) => void;
  status: string;
  setStatus: (s: string) => void;
  count: number;
  statuses?: string[];
}) {
  return (
    <div className="filter-bar">
      <div className="input-search">
        <Search size={17} />
        <input
          aria-label="Search this list"
          placeholder="Search requirements, individuals, or sites…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="filter-right">
        <span>{count} results</span>
        <SlidersHorizontal size={16} />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {(
            statuses ?? [
              "All statuses",
              "Compliant",
              "Due soon",
              "Upcoming",
              "Overdue",
              "Expired",
              "Pending review",
            ]
          ).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
export function SourceCard({
  item,
  onClick,
}: {
  item: Requirement;
  onClick?: () => void;
}) {
  return (
    <button className="source-card" onClick={onClick}>
      <span className="file-icon">
        <FileText size={20} />
      </span>
      <span>
        <strong>{item.source}</strong>
        <small>
          Source document · Page {item.page}
        </small>
      </span>
      <ArrowUpRight size={17} />
    </button>
  );
}
export function matchesStatus(item: Requirement, status: string) {
  return status === "All statuses" || item.status === (status as Status);
}
