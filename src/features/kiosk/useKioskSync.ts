/**
 * useKioskSync.ts — flush the offline kiosk punch queue.
 *
 * Runs a sync pass on mount, on the browser `online` event, and on a
 * 30-second interval. Each queued punch is submitted via the registered
 * kiosk client and removed from the queue only on success; failures stay
 * queued for the next pass. Exposes the pending count so the kiosk can show
 * a small "N punches waiting to sync" indicator.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KioskClient } from "./kioskClient";
import { bumpQueuedAttempts, listQueued, removeQueued } from "./kioskQueue";

const SYNC_INTERVAL_MS = 30_000;

export function useKioskSync(client: KioskClient | null) {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const runningRef = useRef(false);

  const refreshCount = useCallback(async () => {
    try {
      const queued = await listQueued();
      setPendingCount(queued.length);
    } catch {
      // IndexedDB unavailable (private mode, etc.) — the queue simply
      // doesn't persist; direct submits still work when online.
      setPendingCount(0);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (runningRef.current || !client) return;
    runningRef.current = true;
    setSyncing(true);
    try {
      const queued = await listQueued();
      for (const record of queued) {
        try {
          await client.submitKioskPunch(record.token, record.input);
          await removeQueued(record.id);
        } catch {
          await bumpQueuedAttempts(record.id);
        }
      }
    } catch {
      // Queue unreadable — nothing to flush.
    } finally {
      runningRef.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [client, refreshCount]);

  useEffect(() => {
    if (!client) return;
    void refreshCount();
    void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void syncNow(), SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [client, refreshCount, syncNow]);

  return { pendingCount, syncing, syncNow, refreshCount };
}
