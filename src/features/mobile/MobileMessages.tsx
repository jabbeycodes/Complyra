import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, MessageSquare, Plus, Search, Send, UserPlus } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  MESSAGE_BODY_MAX,
  THREAD_SUBJECT_MAX,
  type MessageContact,
  type MessageThreadDetail,
  type MessageThreadView,
} from "../../data/messaging";
import { canUseMessaging } from "../../data/permissions";
import {
  addableContacts,
  canSendReply,
  canStartConversation,
  filterContacts,
  messageTimeLabel,
  pickedNames,
  threadUnreadText,
  togglePicked,
  totalUnreadText,
} from "./messages";

type Mode = "list" | "thread" | "new";

/**
 * Mobile Messages — the staff inbox on a phone.
 *
 * A phone layout over the SAME messaging store and API methods the
 * desktop Messages page uses (listMessageThreads / getMessageThread /
 * sendMessage / createMessageThread / markThreadRead /
 * addThreadParticipant / hideMessageThread), so read state, the
 * one-bell-per-burst notification rule, and participant-only visibility
 * are identical on both surfaces. Semantics mirror the desktop page:
 * opening a conversation marks it read; messages cannot be edited or
 * deleted; hiding removes the conversation from your list only, until a
 * newer message arrives; adding someone writes a visible system note.
 * The gate is canUseMessaging — auditors never reach this view (the
 * tile does not render for them either; PR #121).
 */
export default function MobileMessages({
  api,
  session,
  individuals,
  onOpenIndividual,
  onThreadOpenChange,
}: {
  api: ComplyraApi;
  session: SessionUser;
  individuals: { id: string; name: string }[];
  onOpenIndividual?: (individualId: string) => void;
  /** Lets the shell hide the bottom pill while a conversation is open,
   * so the reply composer owns the bottom of the screen. */
  onThreadOpenChange?: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("list");
  const [threads, setThreads] = useState<MessageThreadView[]>([]);
  const [detail, setDetail] = useState<MessageThreadDetail | null>(null);
  const [contacts, setContacts] = useState<MessageContact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [addUserId, setAddUserId] = useState("");
  // New-conversation draft.
  const [contactQuery, setContactQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [firstBody, setFirstBody] = useState("");
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  const allowed = canUseMessaging(session);

  const reloadThreads = useCallback(async () => {
    try {
      setThreads(await api.listMessageThreads());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    if (!allowed) return;
    void reloadThreads();
    void (async () => {
      try {
        setContacts(await api.listMessageContacts());
      } catch {
        setContacts([]);
      }
    })();
  }, [api, allowed, reloadThreads]);

  useEffect(() => {
    onThreadOpenChange?.(mode === "thread");
  }, [mode, onThreadOpenChange]);

  // A conversation opens on its latest message, like every chat app.
  useEffect(() => {
    if (mode === "thread" && detail) {
      streamEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [mode, detail]);

  const openThread = useCallback(
    async (threadId: string) => {
      setError("");
      try {
        const opened = await api.getMessageThread(threadId);
        setDetail(opened);
        setMode("thread");
        await api.markThreadRead(threadId);
        await reloadThreads();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [api, reloadThreads],
  );

  if (!allowed) {
    return (
      <p className="msh-empty">
        Staff messaging is not part of your role.
      </p>
    );
  }

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

  async function sendReply() {
    if (!detail || !canSendReply(reply)) return;
    const threadId = detail.id;
    await run(async () => {
      await api.sendMessage(threadId, reply);
      setReply("");
      await openThread(threadId);
    });
  }

  async function startConversation() {
    if (!canStartConversation(picked, firstBody)) return;
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
      setContactQuery("");
      await reloadThreads();
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
      setMode("list");
      await reloadThreads();
    });
  }

  const backToList = () => {
    setDetail(null);
    setReply("");
    setAddUserId("");
    setMode("list");
  };

  if (mode === "thread" && detail) {
    const addable = addableContacts(contacts, detail);
    return (
      <div className="msh-msg-thread">
        <button type="button" className="msh-text-button" onClick={backToList}>
          ‹ Conversations
        </button>
        <h3 className="msh-pass-title">{detail.title}</h3>
        <p className="msh-section-note">
          With {detail.participants.map((row) => row.fullName).join(", ")}
        </p>
        {error && (
          <p className="msh-alert" role="alert">
            {error}
          </p>
        )}
        <div className="msh-msg-actions">
          {detail.individualId && onOpenIndividual && (
            <button
              type="button"
              className="msh-chip-button"
              onClick={() => onOpenIndividual(detail.individualId!)}
            >
              <MessageSquare size={16} aria-hidden="true" /> Open{" "}
              {detail.individualName ?? "the Individual"}&rsquo;s chart
            </button>
          )}
          <button
            type="button"
            className="msh-chip-button"
            onClick={() => void hideThread()}
            disabled={busy}
          >
            <EyeOff size={16} aria-hidden="true" /> Hide conversation
          </button>
        </div>
        <p className="msh-section-note">
          Hiding removes this conversation from your list only. It comes back
          when someone sends a newer message.
        </p>

        <div className="msh-msg-stream">
          {detail.messages.map((message) =>
            message.kind === "system" ? (
              <p key={message.id} className="msh-msg-system">
                {message.body}
              </p>
            ) : (
              <div
                key={message.id}
                className={`msh-msg-bubble ${message.senderId === session.userId ? "mine" : ""}`}
              >
                <header>
                  <strong>{message.senderName}</strong>
                  <time dateTime={message.createdAt}>
                    {messageTimeLabel(message.createdAt)}
                  </time>
                </header>
                <p>{message.body}</p>
              </div>
            ),
          )}
          <div ref={streamEndRef} />
        </div>

        <form
          className="msh-msg-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendReply();
          }}
        >
          <label className="msh-msg-composer-field">
            <span className="msh-msg-composer-label">Reply</span>
            <textarea
              value={reply}
              rows={2}
              maxLength={MESSAGE_BODY_MAX}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Write a reply…"
              aria-label="Write a reply"
            />
          </label>
          <button
            type="submit"
            className="msh-button primary"
            disabled={busy || !canSendReply(reply)}
          >
            <Send size={18} aria-hidden="true" /> Send
          </button>
        </form>

        {addable.length > 0 && (
          <form
            className="msh-msg-add"
            onSubmit={(event) => {
              event.preventDefault();
              void addParticipant();
            }}
          >
            <h4>Add someone to this conversation</h4>
            <p className="msh-section-note">
              Adding someone is announced in the conversation, and they can
              read the full history.
            </p>
            <label className="msh-field">
              <span>Staff member</span>
              <select
                value={addUserId}
                onChange={(event) => setAddUserId(event.target.value)}
              >
                <option value="">Choose a staff member…</option>
                {addable.map((contact) => (
                  <option key={contact.userId} value={contact.userId}>
                    {contact.fullName} — {contact.roleLabel}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="msh-button secondary block"
              disabled={busy || !addUserId}
            >
              <UserPlus size={18} aria-hidden="true" /> Add to conversation
            </button>
          </form>
        )}
      </div>
    );
  }

  if (mode === "new") {
    const visibleContacts = filterContacts(contacts, contactQuery);
    const names = pickedNames(contacts, picked);
    return (
      <div>
        <button
          type="button"
          className="msh-text-button"
          onClick={() => setMode("list")}
        >
          ‹ Conversations
        </button>
        <h3 className="msh-pass-title">New conversation</h3>
        {error && (
          <p className="msh-alert" role="alert">
            {error}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void startConversation();
          }}
        >
          <p className="msh-section-note">Who is this conversation with?</p>
          <label className="msh-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={contactQuery}
              onChange={(event) => setContactQuery(event.target.value)}
              placeholder="Search staff"
              aria-label="Search staff"
            />
          </label>
          {names.length > 0 && (
            <p className="msh-section-note" role="status">
              Selected: {names.join(", ")}
            </p>
          )}
          <div className="msh-list">
            {contacts.length === 0 && (
              <p className="msh-empty">
                No other staff members can use messaging yet.
              </p>
            )}
            {contacts.length > 0 && visibleContacts.length === 0 && (
              <p className="msh-empty">No staff match your search.</p>
            )}
            {visibleContacts.map((contact) => {
              const selected = picked.includes(contact.userId);
              return (
                <button
                  key={contact.userId}
                  type="button"
                  className="msh-row"
                  aria-pressed={selected}
                  onClick={() =>
                    setPicked((current) => togglePicked(current, contact.userId))
                  }
                >
                  <span className="msh-row-main">
                    <strong>{contact.fullName}</strong>
                    <small>{contact.roleLabel}</small>
                  </span>
                  {selected && (
                    <span className="msh-chip-button" aria-hidden="true">
                      Selected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <label className="msh-field">
            <span>Subject (optional)</span>
            <input
              type="text"
              value={subject}
              maxLength={THREAD_SUBJECT_MAX}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What is this conversation about?"
            />
          </label>
          <label className="msh-field">
            <span>About an Individual (optional)</span>
            <select
              value={individualId}
              onChange={(event) => setIndividualId(event.target.value)}
            >
              <option value="">Not linked to an Individual</option>
              {individuals.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="msh-field">
            <span>First message</span>
            <textarea
              value={firstBody}
              rows={4}
              maxLength={MESSAGE_BODY_MAX}
              onChange={(event) => setFirstBody(event.target.value)}
              placeholder="Write the first message…"
            />
          </label>
          <button
            type="submit"
            className="msh-button primary block"
            disabled={busy || !canStartConversation(picked, firstBody)}
          >
            <Send size={18} aria-hidden="true" /> Start conversation
          </button>
        </form>
      </div>
    );
  }

  const unreadSummary = totalUnreadText(threads);
  return (
    <div>
      <p className="msh-section-note">
        Conversations with other staff in this agency. Only the people in a
        conversation can read it. Messages cannot be edited or deleted after
        they are sent.
      </p>
      {unreadSummary && (
        <p className="msh-section-note" role="status">
          {unreadSummary}
        </p>
      )}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="msh-button primary block"
        onClick={() => setMode("new")}
      >
        <Plus size={18} aria-hidden="true" /> New conversation
      </button>
      {!loaded ? (
        <p className="msh-empty">Loading conversations…</p>
      ) : threads.length === 0 ? (
        <p className="msh-empty">
          No conversations yet. Start a conversation with another staff
          member.
        </p>
      ) : (
        <div className="msh-list">
          {threads.map((thread) => {
            const unread = threadUnreadText(thread);
            return (
              <button
                key={thread.id}
                type="button"
                className="msh-row"
                onClick={() => void openThread(thread.id)}
                aria-label={`${thread.title}. ${thread.lastMessagePreview}${unread ? `. ${unread}` : ""}`}
              >
                <span className="msh-row-main">
                  <strong>{thread.title}</strong>
                  <small className="msh-snippet">
                    {thread.lastMessageSenderName}: {thread.lastMessagePreview}
                  </small>
                  <small>
                    {messageTimeLabel(thread.lastMessageAt)}
                    {thread.individualName
                      ? ` · About ${thread.individualName}`
                      : ""}
                  </small>
                  {unread && <span className="msh-msg-unread">{unread}</span>}
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
