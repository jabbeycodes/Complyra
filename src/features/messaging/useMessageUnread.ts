import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "../../data/DataProvider";

/**
 * MESSAGING: total unread message count for the nav badge. Polls on the
 * same 60s cadence as the workspace notifications hook; best-effort (a
 * failed poll keeps the last known count instead of blanking the badge).
 */
export function useMessageUnread() {
  const { api, session, workspace } = useData();
  const [unread, setUnread] = useState(0);
  const generation = useRef(0);
  const userId = session?.userId;
  const agencyId = session?.agencyId;
  const ready = Boolean(workspace && session && !session.mustChangePassword);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!ready) {
      setUnread(0);
      return;
    }
    try {
      const total = await api.getMessageUnreadTotal();
      if (generation.current === request) setUnread(total);
    } catch {
      /* badge is best-effort */
    }
  }, [api, userId, agencyId, ready]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  return unread;
}
