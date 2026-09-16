/**
 * useNotifications — the client read-side of the notification engine.
 *
 * The client NEVER writes to the notifications table directly (no
 * authenticated insert policy; inserts are service_role via the
 * `notify-event` edge function). The hook reads the current member's rows
 * (RLS scopes to targeted + role-broadcast rows), tracks unread counts, and
 * marks notifications read:
 *   - user-targeted rows: update notifications.read_at
 *   - role broadcasts: insert into notification_reads (shared rows)
 *
 * `queueClientNotifications()` emits events through the notify-event edge
 * function — it only derives payloads from REAL local/hosted records
 * (certificate expiries, med inventory projections) and never seeds fakes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NotificationRow,
  NotificationPayload,
} from "./notify";
import {
  certificateExpiringPayload,
  certificateExpiredPayload,
  isWellFormedDeepLink,
  markAllRead,
  markOneRead,
  medLowStockPayload,
  sortNotifications,
  unreadCount,
} from "./notify";
import {
  certExpiryStatus,
  daysRemaining,
} from "../../data/certificates";

export type { NotificationRow };

export interface NotificationSession {
  agencyId: string;
  userId: string;
}

const PAGE_LIMIT = 100;

/** DB row plus the joined per-reader read rows (role broadcasts). */
interface NotificationRowWithReads extends NotificationRow {
  notification_reads?: Array<{ read_at: string }>;
}

/** Effective read time: direct read_at, or a per-reader read on a broadcast. */
function effectiveReadAt(row: NotificationRowWithReads): string | null {
  if (row.read_at) return row.read_at;
  const reads = row.notification_reads;
  return reads && reads.length > 0 ? reads[0].read_at : null;
}

function withEffectiveRead(row: NotificationRowWithReads): NotificationRow {
  const readAt = effectiveReadAt(row);
  return { ...row, read_at: readAt };
}

export interface UseNotificationsResult {
  notifications: NotificationRow[];
  unread: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useNotifications(
  client: SupabaseClient | null,
  session: NotificationSession | null,
): UseNotificationsResult {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !session) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await client
        .from("notifications")
        .select("*, notification_reads!left(read_at)")
        .order("created_at", { ascending: false })
        .limit(PAGE_LIMIT);
      if (fetchError) throw fetchError;
      const mapped = ((data ?? []) as unknown as NotificationRow[]).map(
        withEffectiveRead,
      );
      setRows(sortNotifications(mapped));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    let cancelled = false;
    void refresh();
    // Keep the bell fresh while the app is open; 60s is a light touch.
    const timer = setInterval(() => {
      if (!cancelled) void refresh();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      if (!client || !session) return;
      const now = new Date().toISOString();
      const target = rows.find((r) => r.id === id);
      if (!target) return;
      // Optimistic state transition (pure, shared with tests).
      setRows((prev) => markOneRead(prev, id, now));
      try {
        if (target.user_id === session.userId) {
          const { error: updateError } = await client
            .from("notifications")
            .update({ read_at: now })
            .eq("id", id);
          if (updateError) throw updateError;
        } else {
          const { error: readError } = await client
            .from("notification_reads")
            .upsert(
              { notification_id: id, user_id: session.userId, read_at: now },
              { onConflict: "notification_id,user_id" },
            );
          if (readError) throw readError;
        }
      } catch {
        // Best-effort-but-loud: the bell stays responsive; re-sync to truth.
        await refresh();
      }
    },
    [client, session, rows, refresh],
  );

  const markAllAsRead = useCallback(async () => {
    if (!client || !session) return;
    const now = new Date().toISOString();
    const pending = rows.filter((r) => r.read_at == null);
    if (pending.length === 0) return;
    setRows((prev) => markAllRead(prev, now));
    try {
      const direct = pending.filter((r) => r.user_id === session.userId);
      const broadcast = pending.filter((r) => r.user_id !== session.userId);
      if (direct.length > 0) {
        const { error: updateError } = await client
          .from("notifications")
          .update({ read_at: now })
          .in(
            "id",
            direct.map((r) => r.id),
          );
        if (updateError) throw updateError;
      }
      if (broadcast.length > 0) {
        const { error: readError } = await client
          .from("notification_reads")
          .upsert(
            broadcast.map((r) => ({
              notification_id: r.id,
              user_id: session.userId,
              read_at: now,
            })),
            { onConflict: "notification_id,user_id" },
          );
        if (readError) throw readError;
      }
    } catch {
      await refresh();
    }
  }, [client, session, rows, refresh]);

  const unread = useMemo(() => unreadCount(rows), [rows]);

  return { notifications: rows, unread, loading, error, refresh, markRead, markAllAsRead };
}

/**
 * Client-side event emitter. Derives notification payloads from REAL data
 * and sends each through the notify-event edge function (which enforces
 * membership, validates fields, and dedupes on dedupe_key).
 *
 * Call sites pass only real records:
 *   - certificates: { userId, certificateId, certName, expiresOn } — expiry
 *     status comes from certificates.ts helpers, not the caller's opinion.
 *     "watch"/"due" raise certificate.expiring; "expired" raises
 *     certificate.expired. "ok" raises nothing.
 *   - meds: med inventory views from medInventory.ts — status "low" or
 *     "critical" with a known daysRemaining raise med.low_stock.
 *
 * Returns counts so the caller can log or toast the outcome. Never throws.
 */
export interface CertificateEventInput {
  userId: string;
  certificateId: string;
  certName: string;
  expiresOn: string; // ISO date
  today?: string; // ISO date, default = todayIso()
}

export interface MedEventInput {
  roleKey: string;
  medId: string;
  medName: string;
  siteName?: string;
  status: "ok" | "low" | "critical" | "out";
  daysRemaining: number | null;
}

export interface ClientEvents {
  agencyId: string;
  certificates?: CertificateEventInput[];
  meds?: MedEventInput[];
}

export interface QueueResult {
  emitted: number;
  deduped: number;
  errors: number;
}

export async function emitOne(
  client: SupabaseClient,
  payload: NotificationPayload,
): Promise<"emitted" | "deduped" | "error"> {
  if (!isWellFormedDeepLink(payload.deepLink)) {
    console.warn("[notifications] Skipping malformed deep link:", payload.deepLink);
    return "error";
  }
  // The notify-event function accepts snake_case fields.
  const edgeBody = {
    agency_id: payload.agencyId,
    user_id: payload.userId ?? null,
    role_key: payload.roleKey ?? null,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    deep_link: payload.deepLink,
    entity_type: payload.entityType ?? null,
    entity_id: payload.entityId ?? null,
    dedupe_key: payload.dedupeKey ?? null,
  };
  try {
    const { data, error } = await client.functions.invoke("notify-event", {
      body: edgeBody,
    });
    if (error) {
      console.warn("[notifications] notify-event failed:", error.message);
      return "error";
    }
    const parsed = data as { deduped?: boolean } | null;
    return parsed && parsed.deduped ? "deduped" : "emitted";
  } catch (err) {
    console.warn("[notifications] notify-event threw:", err);
    return "error";
  }
}

export async function queueClientNotifications(
  client: SupabaseClient,
  events: ClientEvents,
): Promise<QueueResult> {
  const result: QueueResult = { emitted: 0, deduped: 0, errors: 0 };
  const payloads: NotificationPayload[] = [];

  for (const cert of events.certificates ?? []) {
    const remaining = daysRemaining(cert.expiresOn, cert.today);
    const status = certExpiryStatus(remaining);
    if (status === "ok") continue;
    payloads.push(
      status === "expired"
        ? certificateExpiredPayload({
            agencyId: events.agencyId,
            userId: cert.userId,
            certificateId: cert.certificateId,
            certName: cert.certName,
          })
        : certificateExpiringPayload({
            agencyId: events.agencyId,
            userId: cert.userId,
            certificateId: cert.certificateId,
            certName: cert.certName,
            daysRemaining: remaining,
          }),
    );
  }

  for (const med of events.meds ?? []) {
    if (med.status !== "low" && med.status !== "critical") continue;
    if (med.daysRemaining == null) continue;
    payloads.push(
      medLowStockPayload({
        agencyId: events.agencyId,
        roleKey: med.roleKey,
        medId: med.medId,
        medName: med.medName,
        siteName: med.siteName,
        daysRemaining: med.daysRemaining,
      }),
    );
  }

  for (const payload of payloads) {
    const outcome = await emitOne(client, payload);
    if (outcome === "emitted") result.emitted += 1;
    else if (outcome === "deduped") result.deduped += 1;
    else result.errors += 1;
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* HR event emitter (shift swaps and other hub events)                  */
/* ------------------------------------------------------------------ */

/**
 * Fire-and-forget HR event emitter. Wraps emitOne so callers can raise a
 * hub notification after a successful mutation without awaiting it.
 *
 * Never throws: failures are logged with console.warn only, so a
 * notification hiccup can never break the underlying store mutation.
 */
export async function emitHrEvent(
  client: SupabaseClient,
  payload: NotificationPayload,
): Promise<void> {
  try {
    await emitOne(client, payload);
  } catch (err) {
    console.warn("[notifications] emitHrEvent failed:", err);
  }
}
