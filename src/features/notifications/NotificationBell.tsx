/**
 * NotificationBell — the topbar bell with a real unread badge.
 *
 * Replaces the old dot indicator. The badge shows the unread count
 * (capped at "99+") and the aria-label always carries the count so
 * screen readers announce it.
 */
import { Bell } from "lucide-react";
import "./notifications.css";

interface NotificationBellProps {
  unread: number;
  onOpen: () => void;
  disabled?: boolean;
}

export default function NotificationBell({
  unread,
  onOpen,
  disabled = false,
}: NotificationBellProps) {
  const safeUnread = Math.max(0, Math.floor(unread));
  const label =
    safeUnread === 0
      ? "Notifications, no unread notifications"
      : `Notifications, ${safeUnread} unread`;
  return (
    <button
      type="button"
      className="notification-button icon-button notif-bell"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onOpen}
      disabled={disabled}
    >
      <Bell size={19} aria-hidden="true" />
      {safeUnread > 0 && (
        <span className="notif-badge" aria-hidden="true">
          {safeUnread > 99 ? "99+" : safeUnread}
        </span>
      )}
    </button>
  );
}
