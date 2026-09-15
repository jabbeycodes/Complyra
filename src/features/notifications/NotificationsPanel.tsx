/**
 * NotificationsPanel — the real notifications drawer content.
 *
 * Fed by useNotifications (REAL rows, newest first). Supports unread-only
 * filtering, mark-as-read on a row, mark-all-read, and deep-link
 * navigation. Empty state when there is nothing to show; an error state
 * when the read fails. Status is conveyed with icon + text, never color
 * alone.
 */
import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BellOff,
  CheckCheck,
  CircleAlert,
  Clock,
  FileWarning,
  GraduationCap,
  Pill,
  RefreshCw,
  X,
} from "lucide-react";
import type { NotificationType } from "./notify";
import {
  isUnread,
  metaForType,
} from "./notify";
import type { NotificationRow } from "./useNotifications";
import "./notifications.css";

function iconForType(type: NotificationType) {
  switch (type) {
    case "training.assigned":
    case "training.due_soon":
    case "training.overdue":
      return GraduationCap;
    case "certificate.expiring":
    case "certificate.expired":
      return FileWarning;
    case "med.low_stock":
      return Pill;
    case "checklist.assigned":
      return Clock;
    case "checklist.late":
    case "checklist.missed":
      return AlertTriangle;
    case "checklist.submitted":
      return BadgeCheck;
    default:
      return CircleAlert;
  }
}

export function formatRelativeTime(createdAt: string, now: number = Date.now()): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "Recently";
  const diff = now - created;
  if (diff < 0) return "Recently";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface NotificationsPanelProps {
  notifications: NotificationRow[];
  unread: number;
  loading: boolean;
  error: string | null;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  /** Navigate to the notification's deep link (app route like /checklists/<id>). */
  onNavigate: (deepLink: string) => void;
  onClose: () => void;
  onRetry?: () => void;
}

export default function NotificationsPanel({
  notifications,
  unread,
  loading,
  error,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
  onClose,
  onRetry,
}: NotificationsPanelProps) {
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const visible = showUnreadOnly
    ? notifications.filter(isUnread)
    : notifications;

  return (
    <div className="notif-panel" role="region" aria-label="Notifications">
      <div className="notif-panel-head">
        <h2>Notifications</h2>
        <div className="notif-panel-actions">
          <button
            type="button"
            className="notif-filter-toggle"
            aria-pressed={showUnreadOnly}
            onClick={() => setShowUnreadOnly((v) => !v)}
          >
            {showUnreadOnly ? `Unread only (${unread})` : "Unread only"}
          </button>
          {unread > 0 && (
            <button
              type="button"
              className="notif-mark-all"
              onClick={onMarkAllRead}
            >
              <CheckCheck size={15} aria-hidden="true" />
              Mark all read
            </button>
          )}
          <button
            type="button"
            className="notif-close"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {loading && notifications.length === 0 ? (
        <div className="notif-state">
          <RefreshCw size={20} className="notif-spin" aria-hidden="true" />
          <p>Loading notifications…</p>
        </div>
      ) : error ? (
        <div className="notif-state notif-error" role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <p>Couldn't load notifications.</p>
          <small>{error}</small>
          {onRetry && (
            <button type="button" className="button" onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="notif-state">
          <BellOff size={22} aria-hidden="true" />
          <p>{showUnreadOnly ? "No unread notifications." : "You're all caught up."}</p>
          <small>
            {showUnreadOnly
              ? "Everything here has been read."
              : "New training assignments, expiring certificates, low meds, and checklist events will appear here."}
          </small>
        </div>
      ) : (
        <ul className="notif-list">
          {visible.map((n) => {
            const Icon = iconForType(n.type);
            const meta = metaForType(n.type);
            const unreadRow = isUnread(n);
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={`notif-row${unreadRow ? " unread" : ""}`}
                  onClick={() => {
                    if (unreadRow) onMarkRead(n.id);
                    onNavigate(n.deep_link);
                  }}
                  aria-label={`${meta.label}: ${n.title}${unreadRow ? " (unread)" : ""}`}
                >
                  <span className={`notif-icon status-${meta.status}`} aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="notif-text">
                    <span className="notif-meta">
                      <span className={`notif-status status-${meta.status}`}>
                        {meta.label}
                      </span>
                      <span className="notif-time">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </span>
                    <strong>{n.title}</strong>
                    <small>{n.body}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
