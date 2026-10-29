/**
 * MESSAGING — staff-to-staff internal messaging domain.
 *
 * Conversations among agency staff (1:1 and small groups), optionally linked
 * to one Individual. Original Complyrer design in this codebase's own
 * patterns: the permission is `messages.use` (operational roles only —
 * auditors are excluded by design, because messaging is staff
 * communication, not a compliance record surface), the APIs mirror the
 * GER/health fan-out (local push + hosted `notify-event`), and read state
 * is per participant.
 *
 * Integrity rules (enforced again at the DB layer in
 * supabase/migrations/20261027151000_internal_messaging.sql):
 *  - participants only: nobody can read or be silently added to a thread;
 *    adding a participant writes a visible system note into the thread;
 *  - messages are append-only: no edit, no delete, sender is always the
 *    signed-in user (system notes have no sender);
 *  - a new message notifies the other participants once per unread burst
 *    (dedupe keyed to the first unread message), never one bell entry per
 *    message in a burst.
 */
import { dedupeKeyFor } from "../features/notifications/notify";
import { MESSAGING_ROLE_KEYS } from "./permissions";

export const MESSAGE_BODY_MAX = 4000;
export const THREAD_SUBJECT_MAX = 120;
export const MESSAGE_PREVIEW_MAX = 140;

export type MessageKind = "user" | "system";

/** Stored thread row (local store shape; the hosted API maps snake_case to this). */
export interface MessageThreadRow {
  id: string;
  agencyId: string;
  subject: string;
  individualId: string | null;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
}

/** Stored participant row: one per (thread, staff member). */
export interface MessageParticipantRow {
  threadId: string;
  agencyId: string;
  userId: string;
  addedBy: string | null;
  addedAt: string;
  lastReadAt: string | null;
  hiddenAt: string | null;
}

/** Stored message row. `senderId` is null only for system notes. */
export interface MessageRow {
  id: string;
  threadId: string;
  agencyId: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  createdAt: string;
}

export interface MessageParticipantView {
  userId: string;
  fullName: string;
  roleKey: string;
  addedBy: string | null;
  addedAt: string;
  lastReadAt: string | null;
}

export interface MessageView {
  id: string;
  threadId: string;
  senderId: string | null;
  senderName: string;
  kind: MessageKind;
  body: string;
  createdAt: string;
}

export interface MessageThreadView {
  id: string;
  agencyId: string;
  subject: string;
  /** Subject when set, otherwise the other participants' names. */
  title: string;
  individualId: string | null;
  individualName: string | null;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageSenderName: string;
  participants: MessageParticipantView[];
  /** Unread messages for the viewing user (text count, never color alone). */
  unreadCount: number;
  /** Hidden for the viewing user and nothing newer has arrived since. */
  hidden: boolean;
}

export interface MessageThreadDetail extends MessageThreadView {
  messages: MessageView[];
}

/** One staff member the signed-in user may start a conversation with. */
export interface MessageContact {
  userId: string;
  fullName: string;
  roleKey: string;
  roleLabel: string;
}

export function isMessagingRole(roleKey: string): boolean {
  return (MESSAGING_ROLE_KEYS as readonly string[]).includes(roleKey);
}

export function validateMessageBody(body: string): string {
  const text = (body ?? "").trim();
  if (!text) throw new Error("Write a message first.");
  if (text.length > MESSAGE_BODY_MAX) {
    throw new Error(`Messages are limited to ${MESSAGE_BODY_MAX} characters.`);
  }
  return text;
}

export function validateThreadSubject(subject: string | undefined | null): string {
  const text = (subject ?? "").trim();
  if (text.length > THREAD_SUBJECT_MAX) {
    throw new Error(`Subjects are limited to ${THREAD_SUBJECT_MAX} characters.`);
  }
  return text;
}

/** Recipients for a new thread: at least one other person, no dupes, never self. */
export function validateRecipientIds(
  recipientUserIds: string[],
  selfUserId: string,
): string[] {
  const unique = [...new Set(recipientUserIds.filter(Boolean))];
  if (unique.includes(selfUserId)) {
    throw new Error("You are already part of the conversation.");
  }
  if (unique.length === 0) {
    throw new Error("Choose at least one staff member.");
  }
  return unique;
}

/** The visible system note when a participant is added mid-thread. */
export function systemAddedBody(actorName: string, addedName: string): string {
  return `${actorName} added ${addedName} to this conversation.`;
}

/** Messages arrive for a participant from this instant on (per-participant floor). */
export function readFloor(participant: MessageParticipantRow): string {
  return participant.lastReadAt ?? participant.addedAt;
}

/** Unread = other people's messages newer than the participant's read floor. */
export function unreadMessagesFor(
  messages: MessageRow[],
  participant: MessageParticipantRow,
): MessageRow[] {
  const floor = readFloor(participant);
  return messages.filter(
    (row) =>
      row.kind === "user" &&
      row.senderId !== participant.userId &&
      row.createdAt > floor,
  );
}

export function unreadCountFor(
  messages: MessageRow[],
  participant: MessageParticipantRow,
): number {
  return unreadMessagesFor(messages, participant).length;
}

/** The earliest unread message — the anchor of the burst-dedupe key. */
export function firstUnreadMessageId(
  messages: MessageRow[],
  participant: MessageParticipantRow,
): string | null {
  const unread = unreadMessagesFor(messages, participant);
  return unread.length ? unread[0].id : null;
}

/**
 * One bell entry per unread burst per recipient: while any earlier message
 * is still unread, later messages reuse the first unread message's id, so
 * the dedupe key stays stable and the notification layers dedupe.
 */
export function messageDedupeKey(
  threadId: string,
  recipientUserId: string,
  firstUnreadId: string,
): string {
  return dedupeKeyFor("message.received", threadId, recipientUserId, firstUnreadId);
}

export function messagePreview(body: string): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= MESSAGE_PREVIEW_MAX) return flat;
  return `${flat.slice(0, MESSAGE_PREVIEW_MAX - 1)}…`;
}

export function threadTitle(
  subject: string,
  participants: MessageParticipantView[],
  selfUserId: string,
): string {
  const trimmed = subject.trim();
  if (trimmed) return trimmed;
  const others = participants.filter((row) => row.userId !== selfUserId);
  if (others.length === 0) return "Conversation";
  if (others.length <= 2) return others.map((row) => row.fullName).join(", ");
  return `${others[0].fullName}, ${others[1].fullName} +${others.length - 2} more`;
}

export function sortThreads(views: MessageThreadView[]): MessageThreadView[] {
  return [...views].sort((a, b) =>
    b.lastMessageAt === a.lastMessageAt
      ? b.createdAt.localeCompare(a.createdAt)
      : b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}

export interface ThreadAssemblyInput {
  thread: MessageThreadRow;
  participants: MessageParticipantRow[];
  /** All messages in the thread, oldest first. */
  messages: MessageRow[];
  nameFor: (userId: string) => string;
  roleFor: (userId: string) => string;
  individualName: string | null;
  selfUserId: string;
}

/** Build the list/detail view of one thread for one viewing participant. */
export function assembleThreadView(input: ThreadAssemblyInput): MessageThreadView {
  const { thread, participants, messages, selfUserId } = input;
  const self = participants.find((row) => row.userId === selfUserId);
  const participantViews: MessageParticipantView[] = participants.map((row) => ({
    userId: row.userId,
    fullName: input.nameFor(row.userId),
    roleKey: input.roleFor(row.userId),
    addedBy: row.addedBy,
    addedAt: row.addedAt,
    lastReadAt: row.lastReadAt,
  }));
  const last = messages.length ? messages[messages.length - 1] : null;
  return {
    id: thread.id,
    agencyId: thread.agencyId,
    subject: thread.subject,
    title: threadTitle(thread.subject, participantViews, selfUserId),
    individualId: thread.individualId,
    individualName: input.individualName,
    createdBy: thread.createdBy,
    createdAt: thread.createdAt,
    lastMessageAt: thread.lastMessageAt,
    lastMessagePreview: last ? messagePreview(last.body) : "",
    lastMessageSenderName: last
      ? last.kind === "system"
        ? ""
        : input.nameFor(last.senderId ?? "")
      : "",
    participants: participantViews,
    unreadCount: self ? unreadCountFor(messages, self) : 0,
    hidden: Boolean(
      self?.hiddenAt && self.hiddenAt >= thread.lastMessageAt,
    ),
  };
}

export function assembleMessageViews(
  messages: MessageRow[],
  nameFor: (userId: string) => string,
): MessageView[] {
  return messages.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    senderName: row.kind === "system" ? "" : nameFor(row.senderId ?? ""),
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt,
  }));
}
