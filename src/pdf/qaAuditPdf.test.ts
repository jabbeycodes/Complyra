import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQaAuditPdf, qaFileName } from "./qaAuditPdf";
import {
  buildQaAuditItems,
  QA_ITEMS,
  scoreQaAudit,
  type QaAudit,
  type QaAuditItemState,
} from "../data/qaAudit";

function makeAudit(): QaAudit {
  return {
    id: "qa-1",
    agencyId: "a1",
    siteId: "site-1",
    year: 2026,
    quarter: 3,
    status: "finalized",
    auditorId: "u1",
    auditorName: "Casey Auditor",
    auditorSignatureName: "Casey Auditor",
    auditorSignatureMark: "CA",
    signedAt: "2026-09-14T12:00:00.000Z",
    score: null,
    createdAt: "2026-09-14T11:00:00.000Z",
    updatedAt: "2026-09-14T12:00:00.000Z",
  };
}

function scoredItems(): QaAuditItemState[] {
  const individuals = [
    { id: "ind-1", fullName: "Alex Individual" },
    { id: "ind-2", fullName: "Blake Individual" },
  ];
  const items = buildQaAuditItems(individuals);
  // Score every unlocked item; leave locked (system) items as-is.
  for (const item of items) {
    if (!item.locked) {
      item.result = "yes";
      item.status = "scored";
      item.scoredByName = "Casey Auditor";
    }
  }
  return items;
}

test("QA audit PDF: filename carries site, year, and quarter", () => {
  assert.equal(qaFileName("418 Cedar", 2026, 3), "complyrer-qa-audit-418-cedar-2026-q3.pdf");
});

test("QA audit PDF: builds a white report covering sections and items", () => {
  const audit = makeAudit();
  const items = scoredItems();
  const score = scoreQaAudit(items);
  audit.score = score;
  const doc = buildQaAuditPdf({
    agencyName: "LifePath Test Agency",
    siteName: "418 Cedar",
    audit,
    items,
  });
  assert.equal(doc.getNumberOfPages() >= 1, true);
  const blob = doc.output("blob");
  assert.ok(blob.size > 1000, `PDF too small: ${blob.size} bytes`);
});

test("QA audit PDF: buildQaAuditItems covers a two-individual site", () => {
  // 74 total items: 54 base + 20 per-individual questions x 2 individuals = 94 rows
  const items = buildQaAuditItems([
    { id: "i1", fullName: "A" },
    { id: "i2", fullName: "B" },
  ]);
  const baseCount = QA_ITEMS.filter((i) => !i.perIndividual).length;
  const indivCount = QA_ITEMS.filter((i) => i.perIndividual).length;
  assert.equal(items.length, baseCount + indivCount * 2);
  assert.equal(items.length, 94);
  assert.ok(baseCount === 54 && indivCount === 20, `base=${baseCount} indiv=${indivCount}`);
});
