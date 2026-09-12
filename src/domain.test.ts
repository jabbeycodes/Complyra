import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveRequirement,
  completeRequirement,
  csvCell,
  exportCsv,
  metrics,
  seedRequirements,
} from "./domain";

test("unapproved drafts never increase or reduce active compliance", () => {
  const active = seedRequirements.filter((r) => r.status !== "Pending review");
  assert.equal(metrics(seedRequirements).score, 80);
  assert.equal(metrics(seedRequirements).total, 30);
  assert.equal(metrics(seedRequirements).score, metrics(active).score);
  assert.equal(metrics(seedRequirements).review, 2);
});
test("completion requires evidence and rejects unapproved drafts", () => {
  assert.throws(
    () => completeRequirement(seedRequirements, "REQ-121", "  "),
    /completion record/,
  );
  assert.throws(
    () => completeRequirement(seedRequirements, "REQ-129", "Record 123"),
    /Approve/,
  );
  const next = completeRequirement(seedRequirements, "REQ-121", "ACK-2026-014");
  assert.equal(metrics(next).overdue, 2);
  assert.equal(next.find((r) => r.id === "REQ-121")?.evidence, "ACK-2026-014");
  assert.equal(
    seedRequirements.find((r) => r.id === "REQ-121")?.status,
    "Overdue",
  );
});
test("approval activates only the selected draft", () => {
  const next = approveRequirement(seedRequirements, "REQ-129");
  assert.equal(metrics(next).review, 1);
  assert.equal(metrics(next).total, 31);
  assert.equal(next.find((r) => r.id === "REQ-130")?.status, "Pending review");
  assert.throws(() => approveRequirement(next, "REQ-129"), /Only draft/);
});
test("audit exports retain source and evidence and neutralize spreadsheet formulas", () => {
  const next = completeRequirement(
    seedRequirements,
    "REQ-121",
    '=HYPERLINK("https://example.com")',
  );
  const csv = exportCsv(next.filter((r) => r.id === "REQ-121"));
  assert.ok(csv.includes("Jodie Williams · PCSP 2026 · v2"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(csvCell('Hello, "world"'), '"Hello, ""world"""');
  assert.equal(csv.split("\r\n").length, 2);
});

test("a future draft is not classified as due in the next seven days", () => {
  const future = seedRequirements.map((r) =>
    r.id === "REQ-129" ? { ...r, due: "2026-10-01" } : r,
  );
  const next = approveRequirement(future, "REQ-129");
  assert.equal(next.find((r) => r.id === "REQ-129")?.status, "Upcoming");
  assert.equal(metrics(next).dueSoon, 3);
});
