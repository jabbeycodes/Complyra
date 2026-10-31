import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canRetireStaleMissingNoteNotices,
  operatingNoticeBlockReason,
} from "./operatingNoticeGate";
import type { SessionUser } from "./types";

/**
 * Simulation batches 5–8, 13–19: ordinary DSP/HM/PM sessions logged
 * 12–26 console 400s from queue_operating_notice, ~7 from
 * retire_stale_missing_note_notices, and 403s from effective_rules on
 * first-sign-in screens. The RPC guards were working as designed — the
 * client fired calls those sessions could never make. These tests pin
 * the client-side mirror of the SQL rules: skip what would be refused,
 * keep sending what is permitted.
 */

type GateSession = Pick<
  SessionUser,
  "userId" | "permissions" | "mustChangePassword"
>;

function session(overrides: Partial<GateSession> = {}): GateSession {
  return {
    userId: "user-dsp",
    permissions: {},
    mustChangePassword: false,
    ...overrides,
  };
}

const notice = {
  type: "med.unrecorded",
  userId: "user-other",
  roleKey: null as string | null,
};

test("a DSP cannot queue a med notice for another user — the sweep's 400s", () => {
  assert.equal(
    operatingNoticeBlockReason(session(), notice),
    "signed-in user cannot notify other users",
  );
});

test("role-targeted notices count as notifying someone else", () => {
  assert.equal(
    operatingNoticeBlockReason(session(), {
      type: "med.refusal_review",
      userId: null,
      roleKey: "nurse",
    }),
    "signed-in user cannot notify other users",
  );
});

test("documentation.missing_note is exempt — any member may queue it for others", () => {
  assert.equal(
    operatingNoticeBlockReason(session(), {
      type: "documentation.missing_note",
      userId: "user-writer",
      roleKey: null,
    }),
    null,
  );
});

test("a notice to yourself is always allowed", () => {
  assert.equal(
    operatingNoticeBlockReason(session(), {
      type: "med.late_recording",
      userId: "user-dsp",
      roleKey: null,
    }),
    null,
  );
});

test("each notify-other permission opens the gate", () => {
  for (const key of [
    "clinical.view",
    "hub.view_team",
    "recognition.manage",
    "recognition.review_dsp",
  ]) {
    assert.equal(
      operatingNoticeBlockReason(session({ permissions: { [key]: true } }), notice),
      null,
      key,
    );
  }
});

test("an unrelated permission does not open the gate", () => {
  assert.equal(
    operatingNoticeBlockReason(
      session({ permissions: { "hub.access": true } }),
      notice,
    ),
    "signed-in user cannot notify other users",
  );
});

test("types outside the SQL allow-list are refused for every caller", () => {
  // A type the RPC does not know fails with "Unsupported notice" even
  // for an administrator — the gate must skip those calls for everyone.
  const admin = session({
    permissions: { "clinical.view": true, "hub.view_team": true },
  });
  for (const type of ["med.order_unknown", "announcement.broadcast"]) {
    assert.equal(
      operatingNoticeBlockReason(admin, { type, userId: null, roleKey: "nurse" }),
      "unsupported notice type",
      type,
    );
  }
});

test("med order types are allow-listed by PR #204 — permitted calls pass, unprivileged ones still refuse", () => {
  // Migration 20261031210000 adds med.order_expiring / med.order_expired
  // to the RPC allow-list (the medication-orders worklist queues them).
  // The gate mirrors the post-#204 list: a caller holding a notify-other
  // permission may queue them for the nursing role…
  const clinical = session({ permissions: { "clinical.view": true } });
  for (const type of ["med.order_expiring", "med.order_expired"]) {
    assert.equal(
      operatingNoticeBlockReason(clinical, { type, userId: null, roleKey: "nurse" }),
      null,
      type,
    );
    // …and anyone may queue one for themselves…
    assert.equal(
      operatingNoticeBlockReason(session(), { type, userId: "user-dsp", roleKey: null }),
      null,
      type,
    );
    // …but the types are NOT exempt like documentation.missing_note:
    // an unprivileged caller notifying someone else is still refused.
    assert.equal(
      operatingNoticeBlockReason(session(), { type, userId: "user-other", roleKey: null }),
      "signed-in user cannot notify other users",
      type,
    );
  }
});

test("a notice with no recipient is refused", () => {
  assert.equal(
    operatingNoticeBlockReason(session(), {
      type: "med.unrecorded",
      userId: null,
      roleKey: null,
    }),
    "notice has no recipient",
  );
  assert.equal(
    operatingNoticeBlockReason(session(), {
      type: "med.unrecorded",
      userId: null,
      roleKey: "",
    }),
    "notice has no recipient",
  );
});

test("first-sign-in sessions (password change pending) cannot queue anything", () => {
  const pending = session({ mustChangePassword: true });
  assert.equal(
    operatingNoticeBlockReason(pending, {
      type: "documentation.missing_note",
      userId: "user-dsp",
      roleKey: null,
    }),
    "password change pending",
  );
});

test("retire_stale_missing_note_notices: eligible roles only", () => {
  const asRole = (roleKey: string, mustChangePassword = false) => ({
    roleKey,
    mustChangePassword,
  });
  for (const role of ["administrator", "program_manager", "house_manager", "nurse", "dsp"]) {
    assert.equal(canRetireStaleMissingNoteNotices(asRole(role)), true, role);
  }
  for (const role of ["hr", "compliance_admin", "auditor", "degreed_professional_manager"]) {
    assert.equal(canRetireStaleMissingNoteNotices(asRole(role)), false, role);
  }
  assert.equal(canRetireStaleMissingNoteNotices(asRole("dsp", true)), false);
});
