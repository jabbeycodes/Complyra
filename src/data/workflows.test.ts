/**
 * workflows.test.ts — trigger conditions, message wording, dedupe keys,
 * and the notification-engine payload mapping.
 *
 * Run: node --import tsx --test src/data/workflows.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_TEMPLATES,
  buildWorkflowMessage,
  evaluateWorkflowTriggers,
  workflowNotificationPayload,
  workflowTemplateById,
  type WorkflowFacts,
} from "./workflows";
import { buildNotificationRow } from "../features/notifications/notify";

function emptyFacts(): WorkflowFacts {
  return {
    certificates: [],
    missedChecklists: [],
    unacknowledgedDelegations: [],
    planRenewals: [],
    trainings: [],
    incidentsNeedingFollowup: [],
  };
}

test("workflows: every template has id, name, description, trigger, action, message, deep link", () => {
  assert.ok(WORKFLOW_TEMPLATES.length >= 10, "covers the required set");
  const ids = new Set<string>();
  for (const template of WORKFLOW_TEMPLATES) {
    assert.ok(template.id, "id");
    assert.ok(!ids.has(template.id), `unique id: ${template.id}`);
    ids.add(template.id);
    assert.ok(template.name.length > 0, `${template.id}: name`);
    assert.ok(template.description.length > 0, `${template.id}: description`);
    assert.ok(template.trigger.length > 0, `${template.id}: trigger`);
    assert.ok(template.action.length > 0, `${template.id}: action`);
    assert.ok(
      template.deepLink.startsWith("/"),
      `${template.id}: deep link is in-app`,
    );
    const { title, body } = template.message({});
    assert.ok(title.length > 0 && body.length > 0, `${template.id}: message renders`);
  }
});

test("workflows: the required template set exists", () => {
  for (const id of [
    "cert-expiring-30",
    "cert-expiring-14",
    "cert-expiring-7",
    "cert-expired",
    "checklist-missed",
    "delegation-unacknowledged",
    "isp-renewal-approaching",
    "training-due-soon",
    "training-overdue",
    "incident-followup",
  ]) {
    assert.ok(workflowTemplateById(id), `template present: ${id}`);
  }
});

test("workflows: cert thresholds pick exactly one variant (7/14/30/expired)", () => {
  const cert = (daysRemaining: number) => ({
    id: "c1",
    userId: "u1",
    staffName: "Ava",
    certName: "CPR",
    daysRemaining,
  });
  const templateFor = (daysRemaining: number) =>
    evaluateWorkflowTriggers({ ...emptyFacts(), certificates: [cert(daysRemaining)] }).map(
      (hit) => hit.templateId,
    );
  assert.deepEqual(templateFor(45), [], "45d: no trigger");
  assert.deepEqual(templateFor(30), ["cert-expiring-30"]);
  assert.deepEqual(templateFor(15), ["cert-expiring-30"]);
  assert.deepEqual(templateFor(14), ["cert-expiring-14"]);
  assert.deepEqual(templateFor(8), ["cert-expiring-14"]);
  assert.deepEqual(templateFor(7), ["cert-expiring-7"]);
  assert.deepEqual(templateFor(1), ["cert-expiring-7"]);
  assert.deepEqual(templateFor(0), ["cert-expiring-7"]);
  assert.deepEqual(templateFor(-1), ["cert-expired"]);
});

test("workflows: cert message matches the required wording shape", () => {
  const [hit] = evaluateWorkflowTriggers({
    ...emptyFacts(),
    certificates: [
      { id: "c1", userId: "u1", staffName: "Ava", certName: "CPR", daysRemaining: 7 },
    ],
  });
  const { title, body } = buildWorkflowMessage(hit);
  assert.equal(title, "Certificate expiring this week");
  assert.ok(
    body.startsWith("Action required: Ava's CPR certification expires in 7 days."),
    `direct wording, no fluff: ${body}`,
  );
});

test("workflows: missed checklist triggers once per checklist", () => {
  const hits = evaluateWorkflowTriggers({
    ...emptyFacts(),
    missedChecklists: [
      { id: "w1", checklistTitle: "Weekly checklist", siteName: "Maple House" },
    ],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].templateId, "checklist-missed");
  assert.ok(hits[0].dedupeKey.includes("w1"));
  const { body } = buildWorkflowMessage(hits[0]);
  assert.ok(body.includes("Maple House"));
});

test("workflows: delegation + training + renewal + incident triggers", () => {
  const hits = evaluateWorkflowTriggers({
    ...emptyFacts(),
    unacknowledgedDelegations: [
      {
        acknowledgmentId: "a1",
        delegationTitle: "Seizure protocol",
        staffName: "Ben",
        individualName: "Cara",
        userId: "u2",
      },
    ],
    planRenewals: [
      {
        planId: "p1",
        planTitle: "ISP",
        individualName: "Cara",
        dueOn: "2026-10-10",
        daysRemaining: 26,
      },
    ],
    trainings: [
      { id: "t1", userId: "u3", trainingTitle: "CPI", daysRemaining: null, overdue: true },
      { id: "t2", userId: "u3", trainingTitle: "PBS", daysRemaining: 10, overdue: false },
      { id: "t3", userId: "u3", trainingTitle: "First aid", daysRemaining: 40, overdue: false },
    ],
    incidentsNeedingFollowup: [
      {
        incidentId: "i1",
        summary: "Fall in hallway",
        occurredOn: "2026-09-13",
        followupDueOn: "2026-09-15",
      },
    ],
  });
  const byTemplate = Object.fromEntries(hits.map((hit) => [hit.templateId, hit]));
  assert.ok(byTemplate["delegation-unacknowledged"], "delegation fires");
  assert.ok(byTemplate["isp-renewal-approaching"], "renewal fires");
  assert.ok(byTemplate["training-overdue"], "overdue training fires");
  assert.ok(byTemplate["training-due-soon"], "due-soon training fires");
  assert.ok(byTemplate["incident-followup"], "incident fires");
  assert.equal(
    hits.filter((hit) => hit.templateId === "training-due-soon").length,
    1,
    "t3 (40d) does not fire",
  );
  // Renewal outside the 30-day window does not fire.
  const far = evaluateWorkflowTriggers({
    ...emptyFacts(),
    planRenewals: [
      {
        planId: "p9",
        planTitle: "ISP",
        individualName: "Dan",
        dueOn: "2027-01-01",
        daysRemaining: 100,
      },
    ],
  });
  assert.equal(far.length, 0);
});

test("workflows: dedupe keys are unique per event", () => {
  const hits = evaluateWorkflowTriggers({
    ...emptyFacts(),
    certificates: [
      { id: "c1", userId: "u1", staffName: "Ava", certName: "CPR", daysRemaining: 7 },
      { id: "c1", userId: "u1", staffName: "Ava", certName: "CPR", daysRemaining: 7 },
    ],
  });
  assert.equal(hits.length, 1, "duplicate cert facts dedupe");
  const keys = new Set(hits.map((hit) => hit.dedupeKey));
  assert.equal(keys.size, hits.length);
});

test("workflows: payload mapping produces valid notification rows", () => {
  const hits = evaluateWorkflowTriggers({
    ...emptyFacts(),
    certificates: [
      { id: "c1", userId: "u1", staffName: "Ava", certName: "CPR", daysRemaining: 7 },
    ],
    missedChecklists: [{ id: "w1", checklistTitle: "Weekly checklist" }],
  });
  const certHit = hits.find((hit) => hit.templateId === "cert-expiring-7")!;
  const payload = workflowNotificationPayload("agency-1", certHit, { userId: "u1" });
  assert.equal(payload.type, "certificate.expiring");
  assert.equal(payload.dedupeKey, certHit.dedupeKey);
  // The workflow's rendered message wins over the factory's own wording.
  const rendered = buildWorkflowMessage(certHit);
  assert.equal(payload.title, rendered.title);
  assert.equal(payload.body, rendered.body);
  const row = buildNotificationRow(payload);
  assert.equal(row.agency_id, "agency-1");
  assert.equal(row.user_id, "u1");
  assert.ok(String(row.dedupe_key).length > 0);

  const missHit = hits.find((hit) => hit.templateId === "checklist-missed")!;
  const missPayload = workflowNotificationPayload("agency-1", missHit);
  assert.equal(missPayload.type, "checklist.missed");
  assert.equal(missPayload.roleKey, "house_manager");
});

test("workflows: payload mapping throws when no target resolves", () => {
  const [hit] = evaluateWorkflowTriggers({
    ...emptyFacts(),
    certificates: [
      { id: "c1", userId: "u1", staffName: "Ava", certName: "CPR", daysRemaining: 7 },
    ],
  });
  assert.throws(
    () => workflowNotificationPayload("agency-1", hit),
    /needs a userId/,
  );
});
