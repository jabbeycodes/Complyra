import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD as DEMO_PW } from "./types";
import { canUseMessaging, defaultPermissions } from "./permissions";
import {
  messageDedupeKey,
  readFloor,
  unreadCountFor,
  validateMessageBody,
  validateRecipientIds,
  type MessageParticipantRow,
  type MessageRow,
} from "./messaging";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PW };
}

interface Cast {
  api: LocalApi;
  adminId: string;
  dspId: string;
  nurseId: string;
  hmId: string;
  individualId: string;
}

/** Signed in as admin, with the demo cast resolved through the contacts list. */
async function cast(): Promise<Cast> {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const contacts = await api.listMessageContacts();
  const byRole = (roleKey: string) =>
    contacts.find((row) => row.roleKey === roleKey)!;
  const workspace = await api.loadWorkspace(admin);
  return {
    api,
    adminId: admin.userId,
    dspId: byRole("dsp").userId,
    nurseId: byRole("nurse").userId,
    hmId: byRole("house_manager").userId,
    individualId: workspace.individuals[0].id,
  };
}

async function messageNotifications(api: LocalApi) {
  const rows = await api.listNotifications();
  return rows.filter((row) => row.type === "message.received");
}

test("a new thread notifies the recipient once per unread burst; read state is per participant", async () => {
  const { api, dspId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    subject: "Morning meds",
    body: "First message",
  });
  await api.sendMessage(threadId, "Second message");
  assert.equal(await api.getMessageUnreadTotal(), 0, "sender has no unread");

  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  assert.equal(await api.getMessageUnreadTotal(), 2);
  const inbox = await api.listMessageThreads();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].unreadCount, 2);
  assert.equal(inbox[0].title, "Morning meds");
  assert.equal(
    (await messageNotifications(api)).length,
    1,
    "a two-message burst produces exactly one bell entry",
  );

  const detail = await api.getMessageThread(threadId);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].body, "First message");
  await api.markThreadRead(threadId);
  assert.equal(await api.getMessageUnreadTotal(), 0);

  await api.signOut();
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await api.sendMessage(threadId, "Third message");
  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  assert.equal(await api.getMessageUnreadTotal(), 1);
  assert.equal(
    (await messageNotifications(api)).length,
    2,
    "a new burst after reading produces a second bell entry",
  );
});

test("replies flow back and the inbox preview follows the newest message", async () => {
  const { api, dspId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    body: "Can you cover the evening check?",
  });
  await api.signOut();
  const dsp = await api.signIn(login(DEMO_DSP_USERNAME));
  const sent = await api.sendMessage(threadId, "Yes, I can.");
  assert.equal(sent.senderId, dsp.userId);
  assert.equal(await api.getMessageUnreadTotal(), 0);

  await api.signOut();
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const inbox = await api.listMessageThreads();
  assert.equal(inbox[0].unreadCount, 1);
  assert.match(inbox[0].lastMessagePreview, /Yes, I can\./);
  const detail = await api.getMessageThread(threadId);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[1].senderName, detail.participants.find(
    (row) => row.userId === dspId,
  )?.fullName);
});

test("non-participants cannot see or open a thread", async () => {
  const { api, dspId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    body: "Private thread",
  });
  await api.signOut();
  await api.signIn(login(DEMO_HM_USERNAME));
  assert.deepEqual(await api.listMessageThreads(), []);
  assert.equal(await api.getMessageUnreadTotal(), 0);
  await assert.rejects(
    () => api.getMessageThread(threadId),
    /Conversation not found\./,
  );
  await assert.rejects(
    () => api.sendMessage(threadId, "Let me in"),
    /Conversation not found\./,
  );
});

test("adding a participant writes a visible system note and opens the thread to them", async () => {
  const { api, dspId, nurseId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    body: "Question about the MAR",
  });
  const before = await api.getMessageThread(threadId);
  assert.equal(before.participants.length, 2);
  const adminName = before.participants.find(
    (row) => row.userId === before.createdBy,
  )!.fullName;
  await api.addThreadParticipant(threadId, nurseId);
  const after = await api.getMessageThread(threadId);
  const note = after.messages.find((row) => row.kind === "system");
  assert.ok(note, "a system note appears in the thread");
  assert.match(note.body, new RegExp(`^${adminName} added .+ to this conversation\\.$`));
  assert.match(note.body, /added/);

  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const inbox = await api.listMessageThreads();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, threadId);
  const detail = await api.getMessageThread(threadId);
  assert.equal(detail.messages.some((row) => row.kind === "system"), true);
  await assert.rejects(
    () => api.addThreadParticipant(threadId, nurseId),
    /already in this conversation/,
  );
});

test("auditors are excluded from messaging entirely", async () => {
  const { api, dspId } = await cast();
  const invited = await api.inviteMember({
    fullName: "Pat Auditor",
    username: "pat.auditor",
    tempPassword: "TempPass!1",
    roleKey: "auditor",
    jobTitle: "Auditor",
  });
  const contacts = await api.listMessageContacts();
  assert.equal(
    contacts.some((row) => row.fullName === "Pat Auditor"),
    false,
    "auditors never appear as message contacts",
  );
  await api.signOut();
  const auditor = await api.signIn({
    agencyCode: invited.agencyCode,
    username: invited.username,
    password: "TempPass!1",
  });
  await api.changePassword("TempPass!1", "Auditor!own2");
  assert.equal(auditor.roleKey, "auditor");
  assert.deepEqual(await api.listMessageContacts(), []);
  assert.deepEqual(await api.listMessageThreads(), []);
  assert.equal(await api.getMessageUnreadTotal(), 0);
  await assert.rejects(
    () =>
      api.createMessageThread({
        recipientUserIds: [dspId],
        body: "Auditor reaching out",
      }),
    /permission/,
  );
  // And an administrator cannot message the auditor either.
  await api.signOut();
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  await assert.rejects(
    () =>
      api.createMessageThread({
        recipientUserIds: [auditor.userId],
        body: "Hello auditor",
      }),
    /can use messaging/,
  );
});

test("hiding a thread removes it for that user only, until a newer message arrives", async () => {
  const { api, dspId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    body: "Shift swap question",
  });
  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await api.hideMessageThread(threadId);
  assert.deepEqual(await api.listMessageThreads(), []);

  await api.signOut();
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  assert.equal((await api.listMessageThreads()).length, 1, "others still see it");
  await api.sendMessage(threadId, "Any update?");

  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  const inbox = await api.listMessageThreads();
  assert.equal(inbox.length, 1, "a newer message brings the thread back");
  assert.equal(inbox[0].unreadCount, 2);
});

test("threads linked to an Individual surface on the chart list for participants only", async () => {
  const { api, dspId, individualId } = await cast();
  const threadId = await api.createMessageThread({
    recipientUserIds: [dspId],
    body: "About this weekend",
    individualId,
  });
  const mine = await api.listIndividualMessageThreads(individualId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, threadId);
  assert.equal(mine[0].individualId, individualId);

  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  assert.equal((await api.listIndividualMessageThreads(individualId)).length, 1);
  const detail = await api.getMessageThread(threadId);
  assert.equal(detail.individualId, individualId);
  assert.ok(detail.individualName, "the thread names the linked Individual");

  await api.signOut();
  await api.signIn(login(DEMO_HM_USERNAME));
  assert.deepEqual(
    await api.listIndividualMessageThreads(individualId),
    [],
    "a non-participant sees nothing from the chart either",
  );
});

test("domain rules: unread floor, dedupe key, and input validation", () => {
  const participant: MessageParticipantRow = {
    threadId: "t1",
    agencyId: "a1",
    userId: "u2",
    addedBy: "u1",
    addedAt: "2026-10-27T10:00:00.000Z",
    lastReadAt: null,
    hiddenAt: null,
  };
  const messages: MessageRow[] = [
    { id: "m0", threadId: "t1", agencyId: "a1", senderId: "u1", kind: "user", body: "before add", createdAt: "2026-10-27T09:00:00.000Z" },
    { id: "m1", threadId: "t1", agencyId: "a1", senderId: "u1", kind: "user", body: "one", createdAt: "2026-10-27T10:00:30.000Z" },
    { id: "m2", threadId: "t1", agencyId: "a1", senderId: null, kind: "system", body: "note", createdAt: "2026-10-27T10:01:00.000Z" },
    { id: "m3", threadId: "t1", agencyId: "a1", senderId: "u2", kind: "user", body: "mine", createdAt: "2026-10-27T10:02:00.000Z" },
    { id: "m4", threadId: "t1", agencyId: "a1", senderId: "u1", kind: "user", body: "two", createdAt: "2026-10-27T10:03:00.000Z" },
  ];
  assert.equal(readFloor(participant), "2026-10-27T10:00:00.000Z");
  assert.equal(
    unreadCountFor(messages, participant),
    2,
    "messages before the add floor, system notes, and own messages do not count",
  );
  assert.equal(
    messageDedupeKey("t1", "u2", "m1"),
    "message.received:t1:u2:m1",
  );
  assert.throws(() => validateRecipientIds([], "u1"), /at least one/);
  assert.throws(() => validateRecipientIds(["u1"], "u1"), /already part of the conversation/);
  assert.deepEqual(validateRecipientIds(["u2", "u2"], "u1"), ["u2"], "duplicates collapse");
  assert.equal(validateMessageBody("  hello  "), "hello");
  assert.throws(() => validateMessageBody("   "), /Write a message/);
  assert.throws(() => validateMessageBody("x".repeat(4001)), /4000/);
});

test("the messaging gate excludes auditors even with a misconfigured role map", () => {
  const auditorWithGrant = {
    roleKey: "auditor",
    role: "auditor",
    permissions: { "messages.use": true },
  };
  assert.equal(canUseMessaging(auditorWithGrant), false);
  const dsp = { roleKey: "dsp", role: "dsp", permissions: { "messages.use": true } };
  assert.equal(canUseMessaging(dsp), true);
  const dspNoGrant = {
    roleKey: "dsp",
    role: "dsp",
    // A resolved session map with the grant switched off (agency override).
    permissions: { ...defaultPermissions("dsp"), "messages.use": false },
  };
  assert.equal(canUseMessaging(dspNoGrant), false);
});
