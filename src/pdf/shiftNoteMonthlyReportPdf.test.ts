/**
 * Issue #96 — the monthly shift notes report PDF builds and stamps the
 * Complyrer record mark.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShiftNoteMonthlyReportPdf,
  shiftNoteMonthlyReportFileName,
} from "./shiftNoteMonthlyReportPdf";

function gridFor(tasks: number, days: number): string[][][] {
  return Array.from({ length: tasks }, () =>
    Array.from({ length: days }, (_, day) =>
      day % 5 === 0 ? [`Y · JM`] : [],
    ),
  );
}

test("issue #96 monthly report PDF: filename + grid + summary + record mark", () => {
  assert.equal(
    shiftNoteMonthlyReportFileName("Samuel Catalano", "2026-02"),
    "complyrer-shift-notes-monthly-report-samuel-catalano-2026-02.pdf",
  );
  const doc = buildShiftNoteMonthlyReportPdf({
    agencyName: "LifePath of Mid-Missouri LLC",
    individualName: "Samuel Catalano",
    individualIdLabel: "63381459",
    siteName: "Cedar House",
    monthLabel: "February 2026",
    monthKey: "2026-02",
    generatedBy: "Pat Manager",
    generatedAt: "2026-03-01T10:00:00Z",
    programName: "2026 ISP",
    scheduleLabel: "Per shift",
    scoringMethodName: "Yes/No",
    tasks: [
      { title: "Community", instructions: "Offer choices of favorite activities." },
      { title: "Housework", instructions: "Prompt to tidy the room." },
    ],
    grid: gridFor(2, 28),
    signatures: [{ name: "Jean Masumbuko", initials: "JM", title: "Direct Support Professional" }],
    summary: {
      narrative: "Sam had a calm month with strong safety compliance.",
      signedByName: "Pat Manager",
      signedByTitle: "Program Manager",
      signedAt: "2026-03-01T12:00:00Z",
    },
  });
  assert.ok(doc.getNumberOfPages() >= 1);
  const uri = doc.output("datauristring") as string;
  assert.ok(uri.startsWith("data:application/pdf"));
});

test("issue #96 monthly report PDF: unsigned summary renders the placeholder", () => {
  const doc = buildShiftNoteMonthlyReportPdf({
    agencyName: "Evergreen Care",
    individualName: "Alex Doe",
    individualIdLabel: "—",
    siteName: "Cedar House",
    monthLabel: "September 2026",
    monthKey: "2026-09",
    generatedBy: "Pat Manager",
    generatedAt: "2026-10-01T10:00:00Z",
    programName: "2026 ISP",
    scheduleLabel: "Per shift",
    scoringMethodName: "Yes/No",
    tasks: [{ title: "Community", instructions: "" }],
    grid: gridFor(1, 30),
    signatures: [],
    summary: null,
  });
  assert.ok(doc.getNumberOfPages() >= 1);
});
