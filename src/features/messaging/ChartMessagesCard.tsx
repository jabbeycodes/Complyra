/**
 * MESSAGING — Individual chart card listing conversations linked to this
 * Individual. Participant-only by construction: the API returns only
 * threads the signed-in user belongs to, so a non-participant sees nothing
 * here (the card renders nothing when the list is empty).
 */
import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useData } from "../../data/DataProvider";
import type { MessageThreadView } from "../../data/messaging";
import "./messaging.css";

export default function ChartMessagesCard({
  individualId,
  onOpenThread,
}: {
  individualId: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const { api, session } = useData();
  const [threads, setThreads] = useState<MessageThreadView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.listIndividualMessageThreads(individualId);
        if (!cancelled) setThreads(rows);
      } catch {
        if (!cancelled) setThreads([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, individualId, session?.userId]);

  if (!threads || threads.length === 0) return null;

  return (
    <section className="chart-widget" aria-labelledby="chart-messages-heading">
      <h2 id="chart-messages-heading">Conversations about this Individual</h2>
      <p className="stack-help">
        Only conversations you are part of are listed. Other staff cannot see
        a conversation they are not in.
      </p>
      <div className="messages-list">
        {threads.map((thread) => (
          <div key={thread.id} className="message-thread-row">
            <h3>{thread.title}</h3>
            <p>{thread.lastMessagePreview}</p>
            <span className="message-thread-meta">
              <span>
                {thread.participants.length}{" "}
                {thread.participants.length === 1 ? "person" : "people"}
              </span>
              {thread.unreadCount > 0 && (
                <span className="message-unread-label">
                  Unread · {thread.unreadCount}
                </span>
              )}
              {onOpenThread && (
                <button
                  type="button"
                  className="button"
                  onClick={() => onOpenThread(thread.id)}
                >
                  <MessageSquare size={15} /> Open conversation
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
