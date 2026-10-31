import assert from "node:assert/strict";
import test from "node:test";
import type { CorrectiveAction } from "../../data/correctiveActions";
import type {
  HrAccrualLedgerEntry,
  HrAccrualPolicy,
  HrTimeOffRequest,
} from "../../data/hr";
import type { QaAuditItemState } from "../../data/qaAudit";
import {
  correctiveActionLine,
  myDocumentAck,
  qaAllDecided,
  qaItemStatusText,
  qaItemTitle,
  timeOffBalanceCards,
} from "./hub";

const policy = (leaveType: string, active = true) =>
  ({ id: `pol-${leaveType}`, leaveType, active }) as unknown as HrAccrualPolicy;

const ledgerEntry = (leaveType: string, balance: number) =>
  ({
    id: `led-${leaveType}`,
    staffId: "me",
    leaveType,
    periodStart: "2026-01-01",
    accrued: balance,
    used: 0,
    adjustment: 0,
    balance,
  }) as unknown as HrAccrualLedgerEntry;

const request = (kind: string, status: string, totalHours = 8) =>
  ({
    id: `req-${kind}-${status}`,
    staffId: "me",
    kind,
    status,
    totalHours,
    days: [{ date: "2026-02-02", hours: totalHours }],
  }) as unknown as HrTimeOffRequest;

test("timeOffBalanceCards follows the desktop rule: policy or activity earns a card", () => {
  const cards = timeOffBalanceCards(
    [policy("pto")],
    [ledgerEntry("pto", 40)],
    [request("pto", "approved", 8), request("sick", "pending", 4)],
    "me",
  );
  // pto by policy + activity; sick by activity alone; the rest earn none.
  assert.deepEqual(cards.map((card) => card.type), ["pto", "sick"]);
  assert.equal(cards[0].used, 8);
  assert.equal(cards[0].view.balance, 40);
  assert.equal(cards[1].view.pendingHours, 4);
});

test("myDocumentAck finds only the signed-in user's ack", () => {
  const acks = [
    { id: "a1", docId: "d1", staffId: "someone-else", ackedAt: "2026-01-01T00:00:00.000Z", signatureName: "Other" },
    { id: "a2", docId: "d1", staffId: "me", ackedAt: "2026-01-02T00:00:00.000Z", signatureName: "Me" },
  ];
  assert.equal(myDocumentAck(acks, "d1", "me")?.id, "a2");
  assert.equal(myDocumentAck(acks, "d2", "me"), undefined);
});

const qaItem = (patch: Partial<QaAuditItemState>): QaAuditItemState =>
  ({
    key: "k1",
    itemId: "home.clean-odor-free",
    individualId: null,
    individualName: null,
    source: "auditor",
    locked: false,
    result: null,
    comment: "",
    status: "pending",
    systemEvidence: null,
    scoredBy: null,
    scoredByName: null,
    scoredAt: null,
    disputeNote: null,
    disputePhotos: [],
    disputeRaisedBy: null,
    disputeRaisedByName: null,
    disputeRaisedAt: null,
    disputeResolution: null,
    history: [],
    ...patch,
  }) as QaAuditItemState;

test("qaItemStatusText states facts in words for every item state", () => {
  assert.equal(qaItemStatusText(qaItem({})), "Not scored yet");
  assert.equal(qaItemStatusText(qaItem({ result: "no" })), "Scored: No");
  assert.equal(
    qaItemStatusText(qaItem({ locked: true, systemEvidence: "3/3 required drills complete" })),
    "System verified · 3/3 required drills complete",
  );
  assert.equal(
    qaItemStatusText(qaItem({ status: "disputed", result: "no" })),
    "Disputed — awaiting the auditor's review",
  );
  assert.equal(
    qaItemStatusText(
      qaItem({
        status: "resolved",
        result: "yes",
        disputeResolution: {
          approved: true,
          reason: "Photo showed the kitchen after cleanup.",
          resolvedBy: "u1",
          resolvedByName: "Sarah Mitchell",
          resolvedAt: "2026-10-01T00:00:00.000Z",
        },
      }),
    ),
    "Dispute approved — item corrected",
  );
});

test("qaItemTitle names the Individual on per-person items", () => {
  assert.equal(
    qaItemTitle(qaItem({ individualName: "Ellis Hart" })).endsWith("— Ellis Hart"),
    true,
  );
  assert.equal(qaItemTitle(qaItem({})).includes("Ellis"), false);
});

test("qaAllDecided requires at least one item and no undecided item", () => {
  assert.equal(qaAllDecided([]), false);
  assert.equal(qaAllDecided([qaItem({ result: "yes" }), qaItem({ locked: true })]), true);
  assert.equal(qaAllDecided([qaItem({ result: "yes" }), qaItem({})]), false);
});

test("correctiveActionLine derives overdue from the due date, in words", () => {
  const action = {
    id: "ca1",
    agencyId: "a1",
    title: "Fix the drill log gap",
    description: "",
    assignedToUserId: "u2",
    assignedToName: "James Wilson",
    dueOn: "2020-01-01",
    storedStatus: "open",
    linkedRiskId: null,
    linkedRiskSource: null,
    siteId: null,
    qaAuditId: null,
    createdByUserId: "u1",
    createdAt: "2019-12-01T00:00:00.000Z",
    resolvedAt: null,
  } as CorrectiveAction;
  const line = correctiveActionLine(action, new Date("2026-10-30T12:00:00.000Z"));
  assert.equal(line.status, "Overdue");
  assert.equal(line.overdue, true);
  assert.equal(line.detail, "Assigned to James Wilson · Due 2020-01-01");
});
