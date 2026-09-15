import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "../../data/DataProvider";
import { unreadCount, type NotificationRow } from "./notify";

export function useWorkspaceNotifications() {
  const { api, session, workspace } = useData();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const userId = session?.userId;
  const agencyId = session?.agencyId;
  const ready = Boolean(workspace && session && !session.mustChangePassword);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!ready) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await api.listNotifications();
      if (generation.current !== request) return;
      setNotifications(rows);
      setError(null);
    } catch (err) {
      if (generation.current === request) setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, [api, userId, agencyId, ready]);
  useEffect(() => {
    setNotifications([]);
    setError(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { generation.current++; clearInterval(timer); };
  }, [refresh]);
  async function markRead(ids: string[]) {
    const request = generation.current;
    try {
      await api.markNotificationsRead(ids);
      if (request === generation.current) await refresh();
    } catch (err) {
      if (request === generation.current) setError(err instanceof Error ? err.message : "Could not mark notifications read.");
    }
  }
  return { notifications, unread: unreadCount(notifications), loading, error, refresh,
    markRead: (id: string) => markRead([id]),
    markAllAsRead: () => markRead(notifications.filter((row) => !row.read_at).map((row) => row.id)),
  };
}
