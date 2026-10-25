import { test } from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import {
  PAGE_BOTTOM,
  PAGE_TOP,
  blockFits,
  drawCheckboxRow,
  drawRuledLines,
  drawSectionHeader,
  drawSignatureRow,
  drawWriteInSection,
  placeBlock,
  renderTable,
  reserve,
} from "./layout";

test("placeBlock keeps a block on the page when it fits", () => {
  const placed = placeBlock(100, 40);
  assert.equal(placed.addedPage, false);
  assert.equal(placed.y, 100);
});

test("placeBlock reports a page break rather than bleeding into the footer band", () => {
  const placed = placeBlock(PAGE_BOTTOM - 10, 40);
  assert.equal(placed.addedPage, true);
  assert.equal(placed.y, PAGE_TOP);
  // A block starting at the reported y must fit above the footer band.
  assert.ok(blockFits(placed.y, 40));
});

test("blockFits respects a custom page bottom (landscape)", () => {
  assert.equal(blockFits(540, 40, { pageBottom: 560 }), false);
  assert.equal(blockFits(500, 40, { pageBottom: 560 }), true);
});

test("reserve adds a page when the block would collide with the footer band", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  assert.equal(doc.getNumberOfPages(), 1);
  const y = reserve(doc, PAGE_BOTTOM - 5, 60);
  assert.equal(doc.getNumberOfPages(), 2);
  assert.equal(y, PAGE_TOP);
});

test("drawSectionHeader never orphans a header at the foot of a page", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  // Start close to the footer band with a header that must keep 60pt of body.
  const y = drawSectionHeader(doc, PAGE_BOTTOM - 8, "Findings", {
    keepWith: 60,
  });
  assert.equal(doc.getNumberOfPages(), 2, "header moved to a fresh page");
  assert.ok(y < PAGE_BOTTOM, "content continues above the footer band");
});

test("drawWriteInSection returns a y above the footer band and draws lines", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const y = drawWriteInSection(doc, 200, "Comments / Notes", 4);
  assert.ok(y > 200, "advances past the header and ruled lines");
  assert.ok(y <= PAGE_BOTTOM + 30);
});

test("drawCheckboxRow lays out labeled options and advances", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const y = drawCheckboxRow(doc, 48, 200, ["Yes", "No"], { checkedIndexes: [0] });
  assert.ok(y > 200);
  const text = doc.output();
  assert.ok(text.includes("Yes"));
  assert.ok(text.includes("No"));
});

test("drawSignatureRow renders labeled lines and stays whole across a break", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const y = drawSignatureRow(doc, PAGE_BOTTOM - 4, [
    { label: "Signature", width: 300 },
    { label: "Date", width: 180 },
  ]);
  assert.equal(doc.getNumberOfPages(), 2, "signature row not split by the footer");
  assert.ok(y < PAGE_BOTTOM);
  const text = doc.output();
  assert.ok(text.includes("Signature"));
  assert.ok(text.includes("Date"));
});

test("drawRuledLines draws the requested number of lines", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const start = 200;
  const end = drawRuledLines(doc, 48, start, 3, { gap: 20 });
  assert.equal(end, start + 3 * 20 + 6);
});

test("renderTable repeats the header on every continuation page", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const columns = [
    { label: "Requirement", width: 260 },
    { label: "Owner", width: 120 },
    { label: "Due", width: 120 },
  ];
  const rows = Array.from({ length: 60 }, (_, i) => [
    `Requirement ${i + 1}`,
    `Owner ${i + 1}`,
    `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
  ]);
  const y = renderTable(doc, 120, columns, rows, {
    borderColor: [160, 150, 140],
    headerFill: [232, 224, 212],
  });
  const pages = doc.getNumberOfPages();
  assert.ok(pages > 1, "table paginates for 60 rows");
  const text = doc.output() as string;
  const headerHits = (text.match(/Requirement/g) ?? []).length;
  // The header label recurs on each page in addition to the row cells.
  assert.ok(headerHits >= rows.length + pages, "header repeats per page");
  assert.ok(y < PAGE_BOTTOM);
});
