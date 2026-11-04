import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OBLIGATIONS,
  OBLIGATION_FREQUENCY_LABELS,
  obligationById,
  obligationsOwnedBy,
} from "./obligations";
import { DMH_REQUIREMENTS } from "./dmhRequirements";
import { ROLE_KEYS } from "./permissions";
import { CANONICAL_PAGE_ORDER } from "./status";

// Pages the register may point at: every canonical page plus Consents, which
// lives in the sidebar but has no landing-order slot.
const KNOWN_PAGES = new Set<string>([...CANONICAL_PAGE_ORDER, "Consents"]);

test("obligations: ids are unique, stable slugs", () => {
  const ids = OBLIGATIONS.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
});

test("obligations: every entry names an owner, a reviewer, a real page, and its history", () => {
  for (const row of OBLIGATIONS) {
    assert.ok(row.ownerRoles.length > 0, `${row.id} has an owner`);
    assert.ok(row.reviewerRoles.length > 0, `${row.id} has a reviewer`);
    for (const role of [...row.ownerRoles, ...row.reviewerRoles]) {
      assert.ok((ROLE_KEYS as string[]).includes(role), `${row.id}: ${role} is a live role`);
    }
    assert.ok(KNOWN_PAGES.has(row.page), `${row.id}: page "${row.page}" exists`);
    assert.ok(row.history.trim().length > 0, `${row.id} says where its history lives`);
    assert.ok(OBLIGATION_FREQUENCY_LABELS[row.frequency], `${row.id} frequency has a label`);
  }
});

test("obligations: a regulation basis must be a verified DMH requirement", () => {
  const dmhIds = new Set(DMH_REQUIREMENTS.map((row) => row.id));
  for (const row of OBLIGATIONS) {
    if (row.basis.kind === "regulation") {
      assert.ok(
        dmhIds.has(row.basis.dmhRequirementId),
        `${row.id}: ${row.basis.dmhRequirementId} is in DMH_REQUIREMENTS`,
      );
    } else {
      assert.ok(row.basis.note.trim().length > 0, `${row.id}: agency-policy basis explains itself`);
    }
  }
});

test("obligations: the paper workflows the agency runs are all on the register", () => {
  for (const id of [
    "weekly-house-checklist",
    "monthly-home-safety-report",
    "monthly-emergency-drills",
    "monthly-adaptive-equipment",
    "medication-counts",
    "pcsp-acknowledgments",
    "nursing-delegations",
    "physician-order-review",
    "isp-shift-notes",
  ]) {
    assert.ok(obligationById(id), `${id} is registered`);
  }
});

test("obligations: owners are looked up by role", () => {
  const hm = obligationsOwnedBy("house_manager").map((row) => row.id);
  assert.ok(hm.includes("weekly-house-checklist"));
  assert.ok(!obligationsOwnedBy("auditor").length, "the auditor owns no work — read-only");
});
