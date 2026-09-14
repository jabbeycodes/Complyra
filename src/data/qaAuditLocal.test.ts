import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PASSWORD,
});

async function siteId(api: LocalApi, session: { userId: string }, name: string) {
  const sites = (api as unknown as { store: MemoryStore }).store.db.sites;
  return sites.find((s) => s.name === name)!.id;
}

const PHOTO = {
  id: "ph1",
  name: "tag.jpg",
  dataUrl: "data:image/jpeg;base64,/9j/4AAQ",
  capturedAt: new Date().toISOString(),
  capturedBy: "hm",
};

test("QA audit: admin creates a 94-item audit for a 2-individual site", async () => {
  const api = new LocalApi(store());
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const maple = await siteId(api, session, "Maple House");
  const audit = await api.createQaAudit(maple, 2026, 3);
  assert.equal(audit.status, "in_progress");
  const items = await api.getQaAuditItems(audit.id);
  assert.equal(items.length, 94);
  // Keys unique across individuals.
  assert.equal(new Set(items.map((i) => i.key)).size, 94);
  // Locked system items are pre-scored yes and cannot be touched.
  const locked = items.filter((i) => i.locked);
  for (const item of locked) {
    assert.equal(item.result, "yes");
    assert.equal(item.source, "system");
    assert.ok(item.systemEvidence);
  }
  // Reopening the same quarter returns the existing audit (no duplicates).
  const again = await api.createQaAudit(maple, 2026, 3);
  assert.equal(again.id, audit.id);
  const audits = await api.listQaAudits({ siteId: maple });
  assert.equal(audits.length, 1);
});

test("QA audit: DSP cannot create or score audits", async () => {
  const api = new LocalApi(store());
  const dsp = await api.signIn(login(DEMO_DSP_USERNAME));
  const maple = await siteId(api, dsp, "Maple House");
  await assert.rejects(() => api.createQaAudit(maple, 2026, 3), /permission/);
});

test("QA audit: scoring, locked enforcement, and finalize gate", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const maple = await siteId(api, admin, "Maple House");
  const audit = await api.createQaAudit(maple, 2026, 3);
  const items = await api.getQaAuditItems(audit.id);

  const locked = items.find((i) => i.locked);
  const open = items.find((i) => !i.locked)!;
  assert.ok(open);

  // Locked items reject scoring and skipping.
  if (locked) {
    await assert.rejects(
      () => api.scoreQaItem(audit.id, locked.key, "no", ""),
      /locked/i,
    );
  }

  // Finalize is blocked while items are undecided.
  await assert.rejects(
    () => api.finalizeQaAudit(audit.id, { name: "Auditor Ann", mark: "AA" }),
    /undecided/i,
  );

  // Score every unlocked item, then finalize.
  for (const item of items) {
    if (!item.locked) {
      await api.scoreQaItem(audit.id, item.key, "yes", "");
    }
  }
  const finalized = await api.finalizeQaAudit(audit.id, {
    name: "Auditor Ann",
    mark: "AA",
  });
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.auditorSignatureName, "Auditor Ann");
  assert.ok(finalized.signedAt);
  assert.equal(finalized.score?.pct, 100);
  assert.deepEqual(finalized.score?.criticalFails, []);

  // Finalized audits reject further scoring.
  await assert.rejects(
    () => api.scoreQaItem(audit.id, open.key, "no", "too late"),
    /finalized/i,
  );
});

test("QA audit: HM disputes with photo, auditor resolves and flips the score", async () => {
  const api = new LocalApi(store());
  const adminLogin = login(DEMO_ADMIN_USERNAME);
  const hmLogin = login(DEMO_HM_USERNAME);
  let session = await api.signIn(adminLogin);
  const oakwood = await siteId(api, session, "Oakwood House");
  const audit = await api.createQaAudit(oakwood, 2026, 3);
  const items = await api.getQaAuditItems(audit.id);
  const target = items.find((i) => !i.locked)!;

  await api.scoreQaItem(audit.id, target.key, "no", "Tag expired");

  // Switch to the HM session for the dispute.
  session = await api.signIn(hmLogin);

  // Dispute without a photo is rejected.
  await assert.rejects(
    () => api.raiseQaDispute(audit.id, target.key, "Fixed", []),
    /photo/i,
  );
  // Dispute without a note is rejected.
  await assert.rejects(
    () => api.raiseQaDispute(audit.id, target.key, "  ", [PHOTO]),
    /note/i,
  );

  const disputed = await api.raiseQaDispute(audit.id, target.key, "Tag replaced 9/2", [PHOTO]);
  assert.equal(disputed.status, "disputed");
  assert.equal(disputed.disputePhotos.length, 1);

  // HM cannot resolve disputes (needs qa.audit).
  await assert.rejects(
    () => api.resolveQaDispute(audit.id, target.key, true, "looks fine"),
    /permission/i,
  );

  // Back to the auditor/admin session to resolve.
  session = await api.signIn(adminLogin);
  void session;

  const resolved = await api.resolveQaDispute(
    audit.id,
    target.key,
    true,
    "Photo shows a current tag",
  );
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.result, "yes");
  assert.equal(resolved.disputeResolution?.approved, true);
  assert.ok(resolved.history.length >= 3);
});

test("QA audit: schedules, reminders, ranking, and history", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const maple = await siteId(api, admin, "Maple House");
  const oakwood = await siteId(api, admin, "Oakwood House");

  const schedule = await api.upsertQaSchedule({
    siteId: maple,
    nextDue: "2026-09-01",
  });
  assert.equal(schedule.nextDue, "2026-09-01");

  // Overdue schedule queues a reminder (idempotent per day).
  const queued = await api.sweepQaScheduleReminders("2026-09-14");
  assert.equal(queued, 1);
  const queuedAgain = await api.sweepQaScheduleReminders("2026-09-14");
  assert.equal(queuedAgain, 0);

  // Ranking includes both sites; unaudited sites sort last.
  const ranking = await api.getQaSiteRanking();
  assert.equal(ranking.length, 2);
  assert.deepEqual(
    ranking.map((r) => r.rank),
    [1, 2],
  );

  // Finalize Maple at 100% and check history + ranking order.
  const audit = await api.createQaAudit(maple, 2026, 3);
  const items = await api.getQaAuditItems(audit.id);
  for (const item of items) {
    if (!item.locked) await api.scoreQaItem(audit.id, item.key, "yes", "");
  }
  await api.finalizeQaAudit(audit.id, { name: "Auditor Ann", mark: "AA" });

  const history = await api.getQaSiteHistory(maple);
  assert.equal(history.length, 1);
  assert.equal(history[0].score?.pct, 100);

  const ranked = await api.getQaSiteRanking();
  assert.equal(ranked[0].siteId, maple);
  assert.equal(ranked[0].score, 100);
  assert.equal(ranked[1].score, null);
});
