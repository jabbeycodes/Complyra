/**
 * Monthly ISP report PDF (Complyrer's own monthly summary document).
 *
 * White, print-friendly: agency + individual header, the nine Missouri
 * monthly sections, a per-objective tally table, program-progress rows,
 * signature lines with timestamps, and the Complyrer record mark.
 */
import { jsPDF } from "jspdf";
import { stampRecordMark } from "./brandHeader";
import type {
  IspMonthlyReport,
  IspMonthlySections,
  IspMonthlySignature,
} from "../data/types";

export interface IspMonthlyPdfInput {
  agencyName: string;
  individualName: string;
  report: IspMonthlyReport;
  signatures: IspMonthlySignature[];
}

const PAGE_W = 612; // letter portrait, pt
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 740;

type RGB = [number, number, number];
const INK: RGB = [36, 30, 24];
const EVERGREEN: RGB = [47, 70, 48];
const HEADER_FILL: RGB = [240, 240, 240];

const SECTION_LABELS: { key: keyof IspMonthlySections; label: string }[] = [
  { key: "selfDetermination", label: "Self-determination" },
  { key: "healthMedical", label: "Health / medical" },
  { key: "rights", label: "Rights" },
  { key: "communityActivities", label: "Community activities" },
  { key: "supportCoordinator", label: "Support coordinator notes" },
  { key: "personVisitedDates", label: "Person visited — dates" },
  { key: "overallConcerns", label: "Overall concerns" },
  { key: "changesNeeded", label: "Changes needed" },
  { key: "rnFollowUp", label: "RN follow-up" },
];

const SIGNER_LABELS: Record<string, string> = {
  preparer: "Preparer",
  hm: "House manager",
  pm: "Program manager",
  support_coordinator: "Support coordinator",
  individual: "Individual",
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

export function ispMonthlyFileName(
  individualName: string,
  monthKey: string,
): string {
  return `complyrer-isp-monthly-${slug(individualName)}-${monthKey}.pdf`;
}

function monthLabel(serviceMonth: string): string {
  const [y, m] = serviceMonth.split("-").map(Number);
  if (!y || !m) return serviceMonth;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function buildIspMonthlyPdf(input: IspMonthlyPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const { report } = input;
  const sections = report.sections;
  const tallies = report.tallies;
  let y = 52;

  function ensureSpace(needed: number) {
    if (y + needed > FOOTER_Y - 10) {
      doc.addPage();
      y = 52;
    }
  }

  function heading(text: string, size = 12) {
    ensureSpace(size + 18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...EVERGREEN);
    doc.text(text, MARGIN, y);
    y += size + 8;
  }

  function paragraph(text: string, size = 10) {
    if (!text) text = "—";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
    ensureSpace(lines.length * (size + 3) + 6);
    doc.text(lines, MARGIN, y);
    y += lines.length * (size + 3) + 10;
  }

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...EVERGREEN);
  doc.text("COMPLYRER", MARGIN, y);
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(input.agencyName, MARGIN, y + 14);
  y += 36;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Monthly ISP Report", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 18;
  doc.text(
    `Individual: ${input.individualName}    Service month: ${monthLabel(report.serviceMonth)}    Status: ${report.status}`,
    MARGIN,
    y,
  );
  y += 24;

  // Service title
  if (sections.serviceTitle) {
    heading("Service", 11);
    paragraph(sections.serviceTitle);
  }

  // Tally table
  heading("Objective tallies", 12);
  const cols: { label: string; width: number }[] = [
    { label: "Objective", width: 200 },
    { label: "Opportunities", width: 70 },
    { label: "Completions", width: 70 },
    { label: "Refusals", width: 60 },
    { label: "Success rate", width: 66 },
    { label: "Trend", width: 50 },
  ];
  const lineH = 11;
  function drawTableRow(cells: string[], bold = false) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    let rowH = 16;
    const wrapped = cols.map((col, i) => {
      const lines = doc.splitTextToSize(cells[i] ?? "", col.width - 8);
      rowH = Math.max(rowH, lines.length * lineH + 8);
      return lines as string[];
    });
    ensureSpace(rowH);
    let x = MARGIN;
    cols.forEach((col, i) => {
      if (bold) {
        doc.setFillColor(...HEADER_FILL);
        doc.rect(x, y, col.width, rowH, "F");
      }
      doc.setDrawColor(0, 0, 0);
      doc.rect(x, y, col.width, rowH);
      doc.setTextColor(...INK);
      doc.text(wrapped[i], x + 4, y + lineH + 1);
      x += col.width;
    });
    y += rowH;
  }
  drawTableRow(
    cols.map((c) => c.label),
    true,
  );
  for (const t of tallies.perObjective) {
    drawTableRow([
      t.objectiveTitle,
      String(t.opportunities),
      String(t.completions),
      String(t.refusals),
      t.successRate == null ? "—" : `${Math.round(t.successRate * 100)}%`,
      t.trend ?? "—",
    ]);
  }
  y += 6;
  doc.setFontSize(9);
  doc.text(
    `Notes submitted: ${tallies.notesSubmitted} of ${tallies.notesExpected} expected · ${tallies.notesLate} late · ${tallies.notesMissing} missing`,
    MARGIN,
    y,
  );
  y += 18;

  // Program progress rows
  heading("Program progress", 12);
  for (const row of sections.programProgress) {
    ensureSpace(48);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...EVERGREEN);
    const titleLines = doc.splitTextToSize(row.objectiveTitle, CONTENT_W);
    doc.text(titleLines as string[], MARGIN, y);
    y += (titleLines as string[]).length * 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const body = `Tally: ${row.tallySummary || "—"}\nProgress: ${row.progress || "—"}${row.reasonIfNone ? `\nReason if none: ${row.reasonIfNone}` : ""}`;
    const bodyLines = doc.splitTextToSize(body, CONTENT_W) as string[];
    ensureSpace(bodyLines.length * 12.5 + 8);
    doc.text(bodyLines, MARGIN, y);
    y += bodyLines.length * 12.5 + 12;
  }

  // Nine Missouri sections
  for (const { key, label } of SECTION_LABELS) {
    heading(label, 12);
    paragraph(String(sections[key] ?? ""));
  }

  // Narrative rollup
  if (tallies.narrativeRollup) {
    heading("Month summary", 12);
    paragraph(tallies.narrativeRollup);
  }

  // Signatures
  heading("Signatures", 12);
  const ordered = [...input.signatures].sort((a, b) =>
    (SIGNER_LABELS[a.role] ?? a.role).localeCompare(
      SIGNER_LABELS[b.role] ?? b.role,
    ),
  );
  for (const sig of ordered) {
    ensureSpace(44);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...EVERGREEN);
    doc.text(SIGNER_LABELS[sig.role] ?? sig.role, MARGIN, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(`Signed by: ${sig.signerName}`, MARGIN, y);
    y += 14;
    doc.text(`Signed at: ${fmtStamp(sig.signedAt)}`, MARGIN, y);
    y += 20;
  }
  if (ordered.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text("No signatures recorded yet.", MARGIN, y);
    y += 20;
  }

  stampRecordMark(doc, {
    documentId: `isp-monthly:${report.individualId}:${report.serviceMonth}`,
    generatedAt: new Date().toISOString(),
    margin: MARGIN,
    footerY: FOOTER_Y,
  });
  return doc;
}
