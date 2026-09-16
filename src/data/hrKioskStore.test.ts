/**
 * hrKioskStore.test.ts — unit tests for the kiosk time-clock store surface
 * (src/data/hrStore.ts, Worker 3), reconciled with Worker 1's
 * 20260916140000_hr_kiosk_timeclock migration + hr.ts kiosk types.
 *
 * Local impl only (Supabase calls are thin mappers over real tables).
 * No real PII anywhere — the PIN, token, employee id, and names are
 * obviously fictional fixtures.
 */
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildSubmitKioskPunchParams,
  createHrStore,
  type HrStore,
  type KioskPunchInput,
} from "./hrStore";
import { DEFAULT_PUNCH_RULES } from "./hr";

const AGENCY = "agency-kiosk-test";
const MANAGER = "mgr-kiosk-test";
const SEED = {
  rawToken: "seed-token-abc-123",
  siteId: "site-kiosk-1",
  siteName: "Kiosk Test Site",
  staffId: "staff-kiosk-1",
  displayName: "Test Staffer",
  employeeIdNumber: "E1001",
  pin: "2468",
};

function makeStore(): HrStore {
  return createHrStore({ agencyId: AGENCY, userId: MANAGER, kioskTestSeed: SEED });
}

/** Today at a given hour, as ISO — keeps day-range queries on the same day. */
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function basePunchInput(over: Partial<KioskPunchInput> = {}): KioskPunchInput {
  return {
    staffId: SEED.staffId,
    kind: "in",
    punchedAt: todayAt(8),
    offline: false,
    ...over,
  };
}

describe("verifyKioskPin (mirrors the verify_kiosk_pin RPC shape)", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("correct PIN returns the flat RPC shape (no site fields)", async () => {
    const r = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, SEED.pin);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.staffId, SEED.staffId);
      assert.equal(r.displayName, SEED.displayName);
      assert.ok(!("siteId" in r), "RPC shape carries no site fields");
    }
  });

  test("unknown token -> bad_token", async () => {
    const r = await store.verifyKioskPin("nope", SEED.employeeIdNumber, SEED.pin);
    assert.deepEqual(r, { ok: false, reason: "bad_token" });
  });

  test("unknown employee id -> bad_pin with attemptsLeft null (no lockout)", async () => {
    const r = await store.verifyKioskPin(SEED.rawToken, "E9999", SEED.pin);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "bad_pin");
      assert.equal(r.attemptsLeft, null);
    }
    // The real credential must not have accumulated a failure.
    const ok = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, SEED.pin);
    assert.equal(ok.ok, true);
  });

  test("wrong PIN counts down, locks on the 5th, unlockCredential clears", async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, "0000");
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.reason, "bad_pin");
        assert.equal(r.attemptsLeft, 5 - i);
      }
    }
    const locked = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, "0000");
    assert.equal(locked.ok, false);
    if (!locked.ok) {
      assert.equal(locked.reason, "locked");
      assert.equal(locked.attemptsLeft, 0);
      assert.ok(locked.lockedUntil);
    }
    // Correct PIN while locked still fails.
    const stillLocked = await store.verifyKioskPin(
      SEED.rawToken,
      SEED.employeeIdNumber,
      SEED.pin,
    );
    assert.equal(stillLocked.ok, false);
    if (!stillLocked.ok) assert.equal(stillLocked.reason, "locked");

    const unlocked = await store.unlockCredential(SEED.staffId);
    assert.equal(unlocked.failedAttempts, 0);
    assert.equal(unlocked.lockedUntil, null);
    const r = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, SEED.pin);
    assert.equal(r.ok, true);
  });

  test("success clears prior failures", async () => {
    await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, "0000");
    await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, SEED.pin);
    const r = await store.verifyKioskPin(SEED.rawToken, SEED.employeeIdNumber, "0000");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.attemptsLeft, 4);
  });
});

describe("resolveKioskToken", () => {
  test("resolves site info; throws on bad token", async () => {
    const store = makeStore();
    const site = await store.resolveKioskToken(SEED.rawToken);
    assert.equal(site.siteId, SEED.siteId);
    assert.equal(site.siteName, SEED.siteName);
    assert.equal(site.agencyId, AGENCY);
    await assert.rejects(
      () => store.resolveKioskToken("bogus"),
      /Invalid kiosk token/,
    );
  });
});

describe("kiosk token admin", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("generate -> resolve -> revoke; hashes never exposed", async () => {
    const { token, rawToken } = await store.generateKioskToken(SEED.siteId, "Front desk");
    assert.equal(rawToken.length, 64, "32 random bytes as hex");
    assert.ok(!("tokenHash" in token), "sha256 digest never exposed");
    assert.equal(token.siteId, SEED.siteId);
    assert.equal(token.label, "Front desk");
    assert.equal(token.active, true);
    assert.equal(token.revokedAt, null);

    const site = await store.resolveKioskToken(rawToken);
    assert.equal(site.siteId, SEED.siteId);

    const listed = await store.listKioskTokens();
    assert.ok(listed.some((t) => t.id === token.id));

    await store.revokeKioskToken(token.id);
    await assert.rejects(() => store.resolveKioskToken(rawToken), /Invalid kiosk token/);
    const listedAfter = await store.listKioskTokens();
    assert.ok(!listedAfter.some((t) => t.id === token.id));
  });

  test("rotate revokes the old token and issues a new raw token", async () => {
    const { token, rawToken } = await store.generateKioskToken(SEED.siteId, "Lobby");
    const rotated = await store.rotateKioskToken(token.id);
    assert.notEqual(rotated.rawToken, rawToken);
    await assert.rejects(() => store.resolveKioskToken(rawToken), /Invalid kiosk token/);
    const site = await store.resolveKioskToken(rotated.rawToken);
    assert.equal(site.siteId, SEED.siteId);
    await assert.rejects(() => store.rotateKioskToken(token.id), /already revoked/);
  });
});

describe("clock credential admin", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("issue/reset/list never expose pin_hash; PINs verify end to end", async () => {
    const issued = await store.issueClockCredential("staff-2", "E2002", "1357");
    assert.equal(issued.staffId, "staff-2");
    assert.equal(issued.employeeIdNumber, "E2002");
    assert.ok(!("pinHash" in issued), "bcrypt hash never exposed");
    assert.ok(issued.pinUpdatedAt);
    assert.equal(issued.updatedBy, MANAGER);

    const listed = await store.listClockCredentials();
    assert.ok(listed.some((c) => c.staffId === "staff-2"));
    assert.ok(listed.every((c) => !("pinHash" in c)));

    // The seeded token + new credential verify end to end.
    const r = await store.verifyKioskPin(SEED.rawToken, "E2002", "1357");
    assert.equal(r.ok, true);

    const reset = await store.resetClockPin("staff-2", "8642");
    assert.ok(!("pinHash" in reset));
    const oldFails = await store.verifyKioskPin(SEED.rawToken, "E2002", "1357");
    assert.equal(oldFails.ok, false);
    const newWorks = await store.verifyKioskPin(SEED.rawToken, "E2002", "8642");
    assert.equal(newWorks.ok, true);
    // Plaintext PINs never appear in safe results (the bcrypt hash lives
    // only on the internal row / DB column).
    const safeJson = JSON.stringify([issued, reset, ...(await store.listClockCredentials())]);
    assert.ok(!safeJson.includes("1357") && !safeJson.includes("8642"));
  });

  test("PIN format validated", async () => {
    await assert.rejects(
      () => store.issueClockCredential("staff-3", "E3003", "12"),
      /4–8 digits/,
    );
    await assert.rejects(
      () => store.issueClockCredential("staff-3", "E3003", "abcd"),
      /4–8 digits/,
    );
    await assert.rejects(
      () => store.resetClockPin(SEED.staffId, "123456789"),
      /4–8 digits/,
    );
  });
});

describe("submitKioskPunch", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("RPC call shape is pinned by buildSubmitKioskPunchParams", () => {
    const params = buildSubmitKioskPunchParams("raw-token", {
      staffId: "staff-1",
      kind: "in",
      punchedAt: "2026-09-16T08:00:00.000Z",
      serviceType: "  Community Networking  ",
      individualId: "ind-1",
      attestation: { meal_break_taken: true },
      note: "  hello  ",
      shiftId: "shift-1",
      offline: true,
    });
    assert.deepEqual(params, {
      p_token: "raw-token",
      p_staff_id: "staff-1",
      p_kind: "in",
      p_punched_at: "2026-09-16T08:00:00.000Z",
      p_service_type: "Community Networking",
      p_individual_id: "ind-1",
      p_attestation: { meal_break_taken: true },
      p_note: "hello",
      p_shift_id: "shift-1",
      p_offline: true,
    });
    // No method travels: verification_method is stamped 'kiosk_pin'
    // server-side; no photo field exists anywhere in the punch path.
    assert.ok(!("p_verification_method" in params));
    assert.ok(!("p_photo_data_url" in params));
  });

  test("invalid token throws (the RPC raises on a bad token)", async () => {
    await assert.rejects(
      () => store.submitKioskPunch("bogus-token", basePunchInput()),
      /Invalid kiosk token/,
    );
  });

  test("provenance is stamped: kiosk_pin, remote=false, source=kiosk, token site", async () => {
    const punch = await store.submitKioskPunch(
      SEED.rawToken,
      basePunchInput(),
    );
    assert.equal(punch.kind, "in");
    assert.equal(punch.verificationMethod, "kiosk_pin");
    assert.equal(punch.remote, false);
    assert.equal(punch.offline, false);
    assert.equal(punch.source, "kiosk");
    assert.equal(punch.siteId, SEED.siteId);
    assert.ok(
      !Object.keys(punch).some((k) => k.toLowerCase().includes("photo")),
      "no photo field anywhere",
    );
  });

  test("in/out with double-clock-in and stray-clock-out guards", async () => {
    const punch = await store.submitKioskPunch(
      SEED.rawToken,
      basePunchInput(),
    );
    assert.equal(punch.kind, "in");

    await assert.rejects(
      () =>
        store.submitKioskPunch(
          SEED.rawToken,
          { ...basePunchInput(), punchedAt: todayAt(9) },
        ),
      /already clocked in/i,
    );
    const out = await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      kind: "out",
      punchedAt: todayAt(12),
    });
    assert.equal(out.kind, "out");
    await assert.rejects(
      () =>
        store.submitKioskPunch(SEED.rawToken, {
          ...basePunchInput(),
          kind: "out",
          punchedAt: todayAt(13),
        }),
      /No open clock-in to close./,
    );
  });

  test("clock-out with nothing open is rejected", async () => {
    await assert.rejects(
      () =>
        store.submitKioskPunch(SEED.rawToken, {
          ...basePunchInput(),
          kind: "out",
          punchedAt: todayAt(12),
        }),
      /No open clock-in to close./,
    );
  });

  test("break/transfer round trip carries EVV fields, never a photo", async () => {
    await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      punchedAt: todayAt(8),
    });
    await assert.rejects(
      () =>
        store.submitKioskPunch(SEED.rawToken, {
          ...basePunchInput(),
          kind: "break_out",
          punchedAt: todayAt(10),
        }),
      /No open break/,
    );
    // Proper break round trip.
    await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      kind: "break_in",
      punchedAt: todayAt(10, 5),
    });
    const transfer = await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      kind: "transfer",
      punchedAt: todayAt(12),
      offline: true,
      serviceType: "Community Networking",
      note: "Service/individual transfer at kiosk",
    });
    assert.equal(transfer.verificationMethod, "kiosk_pin");
    assert.equal(transfer.remote, false);
    assert.equal(transfer.offline, true);
    assert.equal(transfer.serviceType, "Community Networking");
    assert.ok(
      !Object.keys(transfer).some((k) => k.toLowerCase().includes("photo")),
      "no photo field anywhere",
    );
    await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      kind: "break_out",
      punchedAt: todayAt(13),
    });
    await assert.rejects(
      () =>
        store.submitKioskPunch(SEED.rawToken, {
          ...basePunchInput(),
          kind: "break_out",
          punchedAt: todayAt(14),
        }),
      /No open break/,
    );
  });

  test("listOpenPunches surfaces the open session", async () => {
    await store.submitKioskPunch(SEED.rawToken, basePunchInput());
    const open = await store.listOpenPunches(SEED.siteId);
    assert.equal(open.length, 1);
    assert.equal(open[0].staffId, SEED.staffId);
    assert.equal(open[0].kind, "in");
    await store.submitKioskPunch(SEED.rawToken, {
      ...basePunchInput(),
      kind: "out",
      punchedAt: todayAt(17),
    });
    assert.equal((await store.listOpenPunches(SEED.siteId)).length, 0);
  });
});

describe("hub.remote_punch grants", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("grant -> has -> list -> revoke -> has (revocation is a soft delete)", async () => {
    // Materialize the seeded clock credential (PIN verify writes the test
    // seed) so the grant can carry its employee ID number.
    const pinOk = await store.verifyKioskPin(
      SEED.rawToken,
      SEED.employeeIdNumber,
      SEED.pin,
    );
    assert.equal(pinOk.ok, true);

    assert.equal(await store.hasRemotePunch(SEED.staffId), false);

    const grant = await store.grantRemotePunch(SEED.staffId, MANAGER);
    assert.equal(grant.staffId, SEED.staffId);
    assert.equal(grant.grantedBy, MANAGER);
    assert.ok(grant.grantedAt);
    // The seeded staffer has a clock credential: its ID number rides along.
    assert.equal(grant.employeeIdNumber, SEED.employeeIdNumber);

    assert.equal(await store.hasRemotePunch(SEED.staffId), true);

    const listed = await store.listRemotePunchGrants();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].staffId, SEED.staffId);
    assert.equal(listed[0].grantedBy, MANAGER);

    // Idempotent re-grant: no duplicate row.
    await store.grantRemotePunch(SEED.staffId, MANAGER);
    assert.equal((await store.listRemotePunchGrants()).length, 1);

    await store.revokeRemotePunch(SEED.staffId);
    assert.equal(await store.hasRemotePunch(SEED.staffId), false);
    assert.equal((await store.listRemotePunchGrants()).length, 0);

    // Revoke is a soft delete, not a row delete: a later grant works again.
    await store.grantRemotePunch(SEED.staffId, MANAGER);
    assert.equal(await store.hasRemotePunch(SEED.staffId), true);
  });

  test("grantedBy defaults to the current user", async () => {
    const grant = await store.grantRemotePunch("staff-9");
    assert.equal(grant.grantedBy, MANAGER);
    // No clock credential for this staffer: no ID number to show.
    assert.equal(grant.employeeIdNumber, null);
  });

  test("revoking a staffer with no grant is a no-op", async () => {
    await store.revokeRemotePunch("nobody");
    assert.equal(await store.hasRemotePunch("nobody"), false);
  });
});

describe("hub clockIn/clockOut require the remote-punch grant (local)", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("denied without the grant, allowed with it, denied again after revoke", async () => {
    await assert.rejects(() => store.clockIn(), /house kiosk laptop/);
    await assert.rejects(() => store.clockOut(), /house kiosk laptop/);

    await store.grantRemotePunch(MANAGER, MANAGER);
    const punch = await store.clockIn("from home");
    assert.equal(punch.kind, "in");
    assert.equal(punch.staffId, MANAGER);
    // Hub punches are remote punches (mirrors the server trigger).
    assert.equal(punch.remote, true);
    assert.equal(punch.verificationMethod, "web");
    const out = await store.clockOut();
    assert.equal(out.kind, "out");
    assert.equal(out.remote, true);

    await store.revokeRemotePunch(MANAGER);
    await assert.rejects(() => store.clockIn(), /house kiosk laptop/);
    await assert.rejects(() => store.clockOut(), /house kiosk laptop/);
  });
});

describe("missed-punch reports", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  const reportInput = () => ({
    staffId: SEED.staffId,
    siteId: SEED.siteId,
    workDate: todayStamp(),
    claimedInAt: todayAt(8),
    claimedOutAt: todayAt(16, 30),
    reason: "Kiosk was unplugged during the morning shift.",
  });

  test("report validation: workDate format + at least one claimed time", async () => {
    await assert.rejects(
      () => store.reportMissedPunch({ ...reportInput(), workDate: "tomorrow" }),
      /YYYY-MM-DD/,
    );
    await assert.rejects(
      () =>
        store.reportMissedPunch({
          ...reportInput(),
          claimedInAt: null,
          claimedOutAt: null,
        }),
      /At least one/,
    );
    await assert.rejects(
      () => store.reportMissedPunch({ ...reportInput(), reason: "  " }),
      /reason is required/i,
    );
  });

  test("approve inserts correction punches + correction-ledger entries", async () => {
    const report = await store.reportMissedPunch(reportInput());
    assert.equal(report.status, "pending");
    assert.equal(report.workDate, todayStamp());
    assert.equal(report.reviewedBy, null);

    const decided = await store.decideMissedPunchReport(report.id, true, "Verified");
    assert.equal(decided.status, "approved");
    assert.equal(decided.reviewedBy, MANAGER);
    assert.equal(decided.reviewNote, "Verified");
    assert.ok(decided.reviewedAt);

    const punches = await store.listPunches(
      SEED.staffId,
      `${todayStamp()}T00:00:00`,
      `${todayStamp()}T23:59:59.999`,
    );
    const corrections = punches.filter((p) => p.source === "correction");
    assert.equal(corrections.length, 2);
    assert.deepEqual(
      corrections.map((p) => p.kind).sort(),
      ["in", "out"],
    );

    // Double decision rejected.
    await assert.rejects(
      () => store.decideMissedPunchReport(report.id, true),
      /already been decided/,
    );
  });

  test("deny writes no punches", async () => {
    const report = await store.reportMissedPunch(reportInput());
    const decided = await store.decideMissedPunchReport(report.id, false, "No evidence");
    assert.equal(decided.status, "denied");
    const punches = await store.listPunches(
      SEED.staffId,
      `${todayStamp()}T00:00:00`,
      `${todayStamp()}T23:59:59.999`,
    );
    assert.equal(punches.filter((p) => p.source === "correction").length, 0);
  });

  test("listMissedPunchReports scope filters", async () => {
    await store.reportMissedPunch(reportInput());
    assert.equal((await store.listMissedPunchReports({ status: "pending" })).length, 1);
    assert.equal(
      (await store.listMissedPunchReports({ status: "approved" })).length,
      0,
    );
    assert.equal(
      (await store.listMissedPunchReports({ staffId: "nobody" })).length,
      0,
    );
  });
});

describe("punch rules", () => {
  let store: HrStore;
  beforeEach(() => {
    store = makeStore();
  });

  test("defaults come from DEFAULT_PUNCH_RULES; round trip works", async () => {
    const defaults = await store.getPunchRules();
    assert.equal(defaults.roundingMinutes, DEFAULT_PUNCH_RULES.roundingMinutes);
    assert.equal(defaults.roundingApplies, DEFAULT_PUNCH_RULES.roundingApplies);
    assert.equal(defaults.graceMinutes, DEFAULT_PUNCH_RULES.graceMinutes);
    assert.equal(
      defaults.autoClockoutBufferMinutes,
      DEFAULT_PUNCH_RULES.autoClockoutBufferMinutes,
    );
    assert.equal(
      defaults.autoApprovalScoreThreshold,
      DEFAULT_PUNCH_RULES.autoApprovalScoreThreshold,
    );

    const saved = await store.savePunchRules({
      roundingMinutes: 15,
      graceMinutes: 10,
      autoApprovalScoreThreshold: 80,
    });
    assert.equal(saved.roundingMinutes, 15);
    assert.equal(saved.graceMinutes, 10);
    assert.equal(saved.autoApprovalScoreThreshold, 80);
    assert.equal(saved.updatedBy, MANAGER);
    assert.equal((await store.getPunchRules()).roundingMinutes, 15);
  });

  test("invalid values rejected", async () => {
    await assert.rejects(
      () => store.savePunchRules({ roundingMinutes: 7 }),
      /one of 0, 5, 10, 15/,
    );
    await assert.rejects(
      () => store.savePunchRules({ autoApprovalScoreThreshold: 101 }),
      /between 0 and 100/,
    );
    await assert.rejects(
      () => store.savePunchRules({ graceMinutes: -1 }),
      /non-negative/,
    );
  });
});

describe("suggestKioskShift", () => {
  test("returns null when nothing is scheduled", async () => {
    const store = makeStore();
    const suggestion = await store.suggestKioskShift(SEED.staffId, SEED.siteId);
    assert.equal(suggestion, null);
  });
});
