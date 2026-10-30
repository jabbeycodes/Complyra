/**
 * Mobile Messages — pure helpers for the phone view of staff messaging.
 *
 * Everything here mirrors the desktop Messages page's semantics exactly
 * (same time-label format, same unread wording, same compose rules);
 * the view itself talks to the same API methods the desktop page uses,
 * so read state, notifications, and participant rules cannot drift
 * between the two surfaces. Pure functions so the wording and the
 * picker rules are unit-tested without rendering.
 */
import type {
  MessageContact,
  MessageThreadDetail,
  MessageThreadView,
} from "../../data/messaging";

/** Desktop MessagesPage time label: "Oct 29, 9:15 AM". */
export function messageTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The thread row's unread badge, in words — "Unread · 2" — or null when
 * the thread is fully read. Status is text, never color alone.
 */
export function threadUnreadText(thread: MessageThreadView): string | null {
  return thread.unreadCount > 0 ? `Unread · ${thread.unreadCount}` : null;
}

/** Total unread across the visible threads (the list header summary). */
export function totalUnreadText(threads: MessageThreadView[]): string | null {
  const total = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  if (total === 0) return null;
  return `${total} unread message${total === 1 ? "" : "s"}`;
}

/** Person search for the compose picker: name or role, case-insensitive. */
export function filterContacts(
  contacts: MessageContact[],
  query: string,
): MessageContact[] {
  const q = query.trim().toLowerCase();
  if (!q) return contacts;
  return contacts.filter(
    (contact) =>
      contact.fullName.toLowerCase().includes(q) ||
      contact.roleLabel.toLowerCase().includes(q),
  );
}

/** Contacts who can still be added to an open conversation. */
export function addableContacts(
  contacts: MessageContact[],
  detail: MessageThreadDetail,
): MessageContact[] {
  return contacts.filter(
    (contact) =>
      !detail.participants.some((row) => row.userId === contact.userId),
  );
}

/** Toggle one person in the compose picker's selection. */
export function togglePicked(picked: string[], userId: string): string[] {
  return picked.includes(userId)
    ? picked.filter((id) => id !== userId)
    : [...picked, userId];
}

/** Names of the picked contacts, in directory order, for the summary line. */
export function pickedNames(
  contacts: MessageContact[],
  picked: string[],
): string[] {
  return contacts
    .filter((contact) => picked.includes(contact.userId))
    .map((contact) => contact.fullName);
}

/** Desktop compose rule: at least one recipient and a non-blank first message. */
export function canStartConversation(picked: string[], body: string): boolean {
  return picked.length > 0 && body.trim().length > 0;
}

/** A reply can be sent when it has any non-blank text. */
export function canSendReply(body: string): boolean {
  return body.trim().length > 0;
}
