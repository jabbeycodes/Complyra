import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  MessageContact,
  MessageThreadDetail,
  MessageThreadView,
} from "../../data/messaging";
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

const CONTACTS: MessageContact[] = [
  { userId: "u-sarah", fullName: "Sarah Mitchell", roleKey: "administrator", roleLabel: "Administrator" },
  { userId: "u-james", fullName: "James Wilson", roleKey: "house_manager", roleLabel: "House Manager" },
  { userId: "u-alex", fullName: "Alex Morgan", roleKey: "dsp", roleLabel: "Direct Support Professional" },
];

function thread(partial: Partial<MessageThreadView>): MessageThreadView {
  return {
    id: "t-1",
    agencyId: "a-1",
    subject: "",
    title: "James Wilson",
    individualId: null,
    individualName: null,
    createdBy: "u-james",
    createdAt: "2026-10-29T13:00:00.000Z",
    lastMessageAt: "2026-10-29T14:00:00.000Z",
    lastMessagePreview: "See you Saturday.",
    lastMessageSenderName: "James Wilson",
    participants: [],
    unreadCount: 0,
    hidden: false,
    ...partial,
  };
}

test("the unread badge is words with the count, and absent when read", () => {
  assert.equal(threadUnreadText(thread({ unreadCount: 0 })), null);
  assert.equal(threadUnreadText(thread({ unreadCount: 1 })), "Unread · 1");
  assert.equal(threadUnreadText(thread({ unreadCount: 3 })), "Unread · 3");
});

test("the total unread summary pluralizes and hides at zero", () => {
  assert.equal(totalUnreadText([thread({}), thread({})]), null);
  assert.equal(
    totalUnreadText([thread({ unreadCount: 1 })]),
    "1 unread message",
  );
  assert.equal(
    totalUnreadText([thread({ unreadCount: 2 }), thread({ unreadCount: 1 })]),
    "3 unread messages",
  );
});

test("contact search matches name or role, case-insensitively", () => {
  assert.deepEqual(filterContacts(CONTACTS, ""), CONTACTS);
  assert.deepEqual(filterContacts(CONTACTS, "  "), CONTACTS);
  assert.deepEqual(
    filterContacts(CONTACTS, "james").map((c) => c.userId),
    ["u-james"],
  );
  assert.deepEqual(
    filterContacts(CONTACTS, "HOUSE MANAGER").map((c) => c.userId),
    ["u-james"],
  );
  assert.deepEqual(filterContacts(CONTACTS, "nobody"), []);
});

test("addable contacts exclude everyone already in the conversation", () => {
  const detail = {
    ...thread({}),
    participants: [
      { userId: "u-sarah", fullName: "Sarah Mitchell", roleKey: "administrator", addedBy: null, addedAt: "", lastReadAt: null },
      { userId: "u-james", fullName: "James Wilson", roleKey: "house_manager", addedBy: null, addedAt: "", lastReadAt: null },
    ],
    messages: [],
  } satisfies MessageThreadDetail;
  assert.deepEqual(
    addableContacts(CONTACTS, detail).map((c) => c.userId),
    ["u-alex"],
  );
});

test("picking toggles a person in and out, and names follow directory order", () => {
  assert.deepEqual(togglePicked([], "u-alex"), ["u-alex"]);
  assert.deepEqual(togglePicked(["u-alex", "u-james"], "u-alex"), ["u-james"]);
  assert.deepEqual(pickedNames(CONTACTS, ["u-alex", "u-sarah"]), [
    "Sarah Mitchell",
    "Alex Morgan",
  ]);
});

test("compose and reply follow the desktop non-blank rules", () => {
  assert.equal(canStartConversation([], "Hello"), false);
  assert.equal(canStartConversation(["u-james"], "   "), false);
  assert.equal(canStartConversation(["u-james"], "Hello"), true);
  assert.equal(canSendReply(""), false);
  assert.equal(canSendReply("  \n "), false);
  assert.equal(canSendReply("Thanks!"), true);
});

test("the time label carries month, day and time like the desktop list", () => {
  const label = messageTimeLabel("2026-10-29T14:15:00.000Z");
  assert.match(label, /Oct 29/);
  assert.match(label, /\d{1,2}:\d{2}\s(AM|PM)/);
});
