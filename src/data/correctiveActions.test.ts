/**
 * correctiveActions.test.ts — status derivation (overdue is derived, never
 * stored), validation, sorting, and DB row mapping.
 *
 * Run: node --import tsx --test src/data/correctiveActions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORRECTIVE_ACTION_STATUS_META,
  buildCorrectiveActionRow,
  correctiveActionFromRow,
  deriveCorrectiveActionStatus,
  isCorrectiveActionOverdue,
  sortCorrectiveActions,
  validateCorrectiveActionInput,
  type CorrectiveAction,
} from "./correctiveActions";

const NOW = new Date("2026-09-14T12:00:00Z");

function action(overrides: Partial<CorrectiveAction> = {}): CorrectiveAction {
  return {
    id: "a1",
    agencyId: "agency-1",
    title: "Fix drill log",
    description: "",
    assignedToUserId: "u1",
    assignedToName: "Ben",
    dueOn: "2026-09-20",
    storedStatus: "open",
    linkedRiskId: null,
    linkedRiskSource: null,
    createdByUserId: "admin-1",
    createdAt: "2026-09-10T00:00:00Z",
    resolvedAt: null,
    ...overrides,
  };
}

test("actions: status meta covers Open/In progress/Resolved/Overdue with icons", () => {
  const labels = Object.values(CORRECTIVE_ACTION_STATUS_META).map((m) => m.label);
  assert.deepEqual(labels, ["Open", "In progress", "Resolved", "Overdue"]);
  const icons = new Set(Object.values(CORRECTIVE_ACTION_STATUS_META).map((m) => m.icon));
  assert.equal(icons.size, 4, "distinct icons — status never by color alone");
});

test("actions: overdue is derived from the due date, never stored", () => {
  assert.equal(deriveCorrectiveActionStatus(action({ dueOn: "2026-09-01" }), NOW), "overdue");
  assert.equal(deriveCorrectiveActionStatus(action({ dueOn: "2026-09-20" }), NOW), "open");
  assert.equal(
    deriveCorrectiveActionStatus(action({ dueOn: "2026-09-01", storedStatus: "in_progress" }), NOW),
    "overdue",
  );
  // Resolved stays resolved even past due.
  assert.equal(
    deriveCorrectiveActionStatus(
      action({ dueOn: "2026-09-01", storedStatus: "resolved" }),
      NOW,
    ),
    "resolved",
  );
  // Due today is not overdue.
  assert.equal(deriveCorrectiveActionStatus(action({ dueOn: "2026-09-14" }), NOW), "open");
  // No due date never goes overdue.
  assert.equal(deriveCorrectiveActionStatus(action({ dueOn: null }), NOW), "open");
  assert.equal(isCorrectiveActionOverdue(action({ dueOn: "2026-09-01" }), NOW), true);
  assert.equal(isCorrectiveActionOverdue(action({ dueOn: "2026-09-20" }), NOW), false);
});

test("actions: validation catches bad input", () => {
  assert.deepEqual(validateCorrectiveActionInput({ title: "  Fix it  " }), []);
  assert.ok(validateCorrectiveActionInput({ title: "   " }).length > 0, "blank title");
  assert.ok(validateCorrectiveActionInput({}).length > 0, "missing title");
  assert.ok(
    validateCorrectiveActionInput({ title: "x", dueOn: "09/14/2026" }).length > 0,
    "non-ISO due date",
  );
  assert.deepEqual(validateCorrectiveActionInput({ title: "x", dueOn: "2026-09-20" }), []);
});

test("actions: sort puts overdue first, resolved last", () => {
  const sorted = sortCorrectiveActions(
    [
      action({ id: "resolved", storedStatus: "resolved", dueOn: "2026-09-01" }),
      action({ id: "open-later", dueOn: "2026-09-30" }),
      action({ id: "overdue", dueOn: "2026-09-01" }),
      action({ id: "open-soon", dueOn: "2026-09-15" }),
    ],
    NOW,
  );
  assert.deepEqual(
    sorted.map((row) => row.id),
    ["overdue", "open-soon", "open-later", "resolved"],
  );
});

test("actions: DB row round-trips", () => {
  const row = buildCorrectiveActionRow({
    agencyId: "agency-1",
    createdByUserId: "admin-1",
    data: { title: "  Fix drill log ", dueOn: "2026-09-20", assignedToUserId: "u1" },
  });
  assert.equal(row.title, "Fix drill log");
  assert.equal(row.status, "open");
  assert.equal(row.agency_id, "agency-1");
  const restored = correctiveActionFromRow({
    id: "a1",
    agency_id: "agency-1",
    title: "Fix drill log",
    description: null,
    assigned_to_user_id: "u1",
    due_on: "2026-09-20",
    status: "in_progress",
    linked_risk_id: null,
    linked_risk_source: null,
    created_by_user_id: "admin-1",
    created_at: "2026-09-10T00:00:00Z",
    resolved_at: null,
  });
  assert.equal(restored.storedStatus, "in_progress");
  assert.equal(restored.description, "");
});
