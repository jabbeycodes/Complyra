import { test } from "node:test";
import assert from "node:assert/strict";
import { loadQaPageData } from "./qaLoad";
import type {
  QaAudit,
  QaAuditSchedule,
  QaRankedSite,
} from "../../data/qaAudit";
import type { CorrectiveAction } from "../../data/correctiveActions";

/**
 * Simulation batch 16: QA Review read empty (and slow) even though the
 * agency had reviews — the page loaded audits, schedules and ranking in
 * one Promise.all, so the heavy ranking read gated (and could blank)
 * the Reviews tab. The audits read now stands alone.
 */

const audit = { id: "audit-1" } as QaAudit;
const schedule = { id: "sched-1" } as unknown as QaAuditSchedule;
const ranked = { siteId: "site-1" } as unknown as QaRankedSite;

test("reviews survive a failed ranking and schedules read", async () => {
  const data = await loadQaPageData({
    listAudits: async () => [audit],
    listSchedules: async () => {
      throw new Error("schedules down");
    },
    getRanking: async () => {
      throw new Error("ranking down");
    },
  });
  assert.deepEqual(data.audits, [audit]);
  assert.equal(data.schedules, null);
  assert.equal(data.ranking, null);
});

test("all three reads land when all succeed", async () => {
  const data = await loadQaPageData({
    listAudits: async () => [audit],
    listSchedules: async () => [schedule],
    getRanking: async () => [ranked],
  });
  assert.deepEqual(data.audits, [audit]);
  assert.deepEqual(data.schedules, [schedule]);
  assert.deepEqual(data.ranking, [ranked]);
});

test("corrective actions (PR #199) land, and degrade to empty — never blanking Reviews", async () => {
  const action = { id: "ca-1" } as unknown as CorrectiveAction;
  const landed = await loadQaPageData({
    listAudits: async () => [audit],
    listSchedules: async () => [schedule],
    getRanking: async () => [ranked],
    listCorrectiveActions: async () => [action],
  });
  assert.deepEqual(landed.correctiveActions, [action]);

  const degraded = await loadQaPageData({
    listAudits: async () => [audit],
    listSchedules: async () => [schedule],
    getRanking: async () => [ranked],
    listCorrectiveActions: async () => {
      throw new Error("actions down");
    },
  });
  assert.deepEqual(degraded.audits, [audit]);
  assert.deepEqual(degraded.correctiveActions, []);

  const absent = await loadQaPageData({
    listAudits: async () => [audit],
    listSchedules: async () => [schedule],
    getRanking: async () => [ranked],
  });
  assert.deepEqual(absent.correctiveActions, []);
});

test("an audits failure still propagates as the page error", async () => {
  await assert.rejects(
    loadQaPageData({
      listAudits: async () => {
        throw new Error("audits down");
      },
      listSchedules: async () => [schedule],
      getRanking: async () => [ranked],
    }),
    /audits down/,
  );
});
