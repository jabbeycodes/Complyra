/**
 * MESSAGING — the staff inbox.
 *
 * Staff-to-staff conversations for operational roles (administrator,
 * compliance_admin, program_manager, house_manager, nurse, dsp, hr).
 * Auditors are excluded by design: messaging is staff communication, not a
 * compliance record surface. Only participants can see a thread; adding
 * someone writes a visible system note in the thread. Messages cannot be
 * edited or deleted after sending; "Hide" only hides the thread for the
 * signed-in user until a newer message arrives.
 */
import { useCallback, useEffect, useState } from "react";
import { EyeOff, MessageSquare, Plus, Send, UserPlus } from "lucide-react";
import { Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import type {
  MessageContact,
  MessageThreadDetail,
  MessageThreadView,
} from "../../data/messaging";
import "./messaging.css";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MessagesPage({
  focusThreadId,
  onFocusHandled,
  onOpenIndividual,
}: {
  focusThreadId?: string | null;
  onFocusHandled?: () => void;
  onOpenIndividual?: (individualId: string) => void;
}) {
  const { api, session, workspace } = useData();
  const [threads, setThreads] = useState<MessageThreadView[]>([]);
  const [detail, setDetail] = useState<MessageThreadDetail | null>(null);
  const [contacts, setContacts] = useState<MessageContact[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [reply, setReply] = useState("");
  const [addUserId, setAddUserId] = useState("");
  // New-conversation draft.
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [firstBody, setFirstBody] = useState("");

  const reloadThreads = useCallback(async () => {
    try {
      setThreads(await api.listMessageThreads());
    } catch (err) {
      setError((err as Error).message);
    }
  }, [api]);

  useEffect(() => {
    void reloadThreads();
    void (async () => {
      try {
        setContacts(await api.listMessageContacts());
      } catch {
        setContacts([]);
      }
    })();
  }, [api, reloadThreads]);

  const openThread = useCallback(
    async (threadId: string) => {
      setError("");
      try {
        const opened = await api.getMessageThread(threadId);
        setDetail(opened);
        setShowNew(false);
        await api.markThreadRead(threadId);
        await reloadThreads();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [api, reloadThreads],
  );

  useEffect(() => {
    if (!focusThreadId) return;
    void openThread(focusThreadId).then(() => onFocusHandled?.());
  }, [focusThreadId, openThread, onFocusHandled]);

  if (!session) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startConversation() {
    await run(async () => {
      const threadId = await api.createMessageThread({
        recipientUserIds: picked,
        subject,
        body: firstBody,
        individualId: individualId || null,
      });
      setPicked([]);
      setSubject("");
      setIndividualId("");
      setFirstBody("");
      await reloadThreads();
      await openThread(threadId);
    });
  }

  async function sendReply() {
    if (!detail) return;
    const threadId = detail.id;
    await run(async () => {
      await api.sendMessage(threadId, reply);
      setReply("");
      await openThread(threadId);
    });
  }

  async function addParticipant() {
    if (!detail || !addUserId) return;
    const threadId = detail.id;
    await run(async () => {
      await api.addThreadParticipant(threadId, addUserId);
      setAddUserId("");
      await openThread(threadId);
    });
  }

  async function hideThread() {
    if (!detail) return;
    const threadId = detail.id;
    await run(async () => {
      await api.hideMessageThread(threadId);
      setDetail(null);
      await reloadThreads();
    });
  }

  const addableContacts = detail
    ? contacts.filter(
        (contact) =>
          !detail.participants.some((row) => row.userId === contact.userId),
      )
    : [];

  return (
    <section aria-labelledby="messages-heading">
      <h1 id="messages-heading">Messages</h1>
      <p className="stack-help">
        Conversations with other staff in this agency. Only the people in a
        conversation can read it. Messages cannot be edited or deleted after
        they are sent.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="message-toolbar">
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setShowNew((value) => !value);
            setDetail(null);
          }}
        >
          <Plus size={16} /> New conversation
        </button>
      </div>

      {showNew && (
        <form
          className="message-new-form"
          onSubmit={(event) => {
            event.preventDefault();
            void startConversation();
          }}
        >
          <h2>New conversation</h2>
          <fieldset>
            <legend>Who is this conversation with?</legend>
            <div className="message-contact-list">
              {contacts.length === 0 && (
                <p>No other staff members can use messaging yet.</p>
              )}
              {contacts.map((contact) => (
                <label key={contact.userId}>
                  <input
                    type="checkbox"
                    checked={picked.includes(contact.userId)}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, contact.userId]
                          : current.filter((id) => id !== contact.userId),
                      )
                    }
                  />
                  {contact.fullName} — {contact.roleLabel}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Subject (optional)
            <input
              type="text"
              value={subject}
              maxLength={120}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What is this conversation about?"
            />
          </label>
          <label>
            About an Individual (optional)
            <select
              value={individualId}
              onChange={(event) => setIndividualId(event.target.value)}
            >
              <option value="">Not linked to an Individual</option>
              {(workspace?.individuals ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            First message
            <textarea
              value={firstBody}
              rows={4}
              maxLength={4000}
              onChange={(event) => setFirstBody(event.target.value)}
              placeholder="Write the first message…"
            />
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={busy || picked.length === 0 || !firstBody.trim()}
          >
            <Send size={16} /> Start conversation
          </button>
        </form>
      )}

      <div className="messages-layout">
        <div className="messages-list" aria-label="Your conversations">
          {threads.length === 0 && !showNew && (
            <Empty
              title="No conversations yet"
              text="Start a conversation with another staff member."
            />
          )}
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`message-thread-row ${detail?.id === thread.id ? "active" : ""}`}
              onClick={() => void openThread(thread.id)}
              aria-current={detail?.id === thread.id ? "true" : undefined}
            >
              <h3>{thread.title}</h3>
              <p>{thread.lastMessagePreview}</p>
              <span className="message-thread-meta">
                <span>{timeLabel(thread.lastMessageAt)}</span>
                {thread.individualName && (
                  <span>About {thread.individualName}</span>
                )}
                {thread.unreadCount > 0 && (
                  <span className="message-unread-label">
                    Unread · {thread.unreadCount}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {detail && (
          <article className="message-view" aria-labelledby="thread-heading">
            <h2 id="thread-heading">{detail.title}</h2>
            <p className="message-participants">
              With{" "}
              {detail.participants
                .map((row) => row.fullName)
                .join(", ")}
            </p>
            <div className="message-toolbar">
              {detail.individualId && onOpenIndividual && (
                <button
                  type="button"
                  className="button"
                  onClick={() => onOpenIndividual(detail.individualId!)}
                >
                  <MessageSquare size={16} /> Open{" "}
                  {detail.individualName ?? "the Individual"}&rsquo;s chart
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => void hideThread()}
                disabled={busy}
              >
                <EyeOff size={16} /> Hide conversation
              </button>
            </div>
            <p className="stack-help">
              Hiding removes this conversation from your list only. It comes
              back when someone sends a newer message.
            </p>

            <div className="message-stream">
              {detail.messages.map((message) =>
                message.kind === "system" ? (
                  <p key={message.id} className="message-system-note">
                    {message.body}
                  </p>
                ) : (
                  <div
                    key={message.id}
                    className={`message-bubble ${message.senderId === session.userId ? "mine" : ""}`}
                  >
                    <header>
                      <strong>{message.senderName}</strong>
                      <time dateTime={message.createdAt}>
                        {timeLabel(message.createdAt)}
                      </time>
                    </header>
                    <p>{message.body}</p>
                  </div>
                ),
              )}
            </div>

            <form
              className="message-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendReply();
              }}
            >
              <label>
                Reply
                <textarea
                  value={reply}
                  rows={3}
                  maxLength={4000}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Write a reply…"
                />
              </label>
              <button
                type="submit"
                className="button primary"
                disabled={busy || !reply.trim()}
              >
                <Send size={16} /> Send reply
              </button>
            </form>

            {addableContacts.length > 0 && (
              <form
                className="message-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addParticipant();
                }}
              >
                <h3>Add someone to this conversation</h3>
                <p className="stack-help">
                  Adding someone is announced in the conversation, and they
                  can read the full history.
                </p>
                <label>
                  Staff member
                  <select
                    value={addUserId}
                    onChange={(event) => setAddUserId(event.target.value)}
                  >
                    <option value="">Choose a staff member…</option>
                    {addableContacts.map((contact) => (
                      <option key={contact.userId} value={contact.userId}>
                        {contact.fullName} — {contact.roleLabel}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="button"
                  disabled={busy || !addUserId}
                >
                  <UserPlus size={16} /> Add to conversation
                </button>
              </form>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
