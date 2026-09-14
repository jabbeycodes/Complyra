import type { Requirement } from "../domain";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

export interface ComplianceReportData {
  agencyName: string;
  reportDate: string;
  score: number;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  requirements: Requirement[];
  logoDataUrl?: string | null;
}

const MARGIN = 48;
const CONTENT_WIDTH = 516;
const PAGE_BOTTOM = 720;

function ensureRoom(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  need: number,
): number {
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return 64;
  }
  return y;
}

function sectionTitle(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  text: string,
): number {
  y = ensureRoom(doc, y, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 70, 48);
  doc.text(text, MARGIN, y);
  y += 6;
  doc.setDrawColor(47, 70, 48);
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
  y += 16;
  doc.setTextColor(36, 30, 24);
  return y;
}

export function buildComplianceReportPdf(data: ComplianceReportData) {
  const { doc, y: startY } = startBrandedDoc("Compliance Report", {
    agencyName: data.agencyName,
    logoDataUrl: data.logoDataUrl,
  });
  let y = startY;

  // Report date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(95, 81, 69);
  doc.text(`Report date: ${data.reportDate}`, MARGIN, y);
  y += 24;
  doc.setTextColor(36, 30, 24);

  // Executive summary
  y = sectionTitle(doc, y, "Executive Summary");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const summary: Array<[string, string]> = [
    ["Compliance score", `${data.score}%`],
    ["Total requirements", String(data.total)],
    ["Completed", String(data.done)],
    ["Overdue", String(data.overdue)],
    ["Due soon", String(data.dueSoon)],
  ];
  for (const [label, value] of summary) {
    y = ensureRoom(doc, y, 20);
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, MARGIN + 160, y);
    y += 18;
  }
  y += 12;

  // Requirements by status
  const overdue = data.requirements.filter((r) => r.status === "Overdue" || r.status === "Expired");
  const dueSoon = data.requirements.filter((r) => r.status === "Due soon");
  const pending = data.requirements.filter(
    (r) => r.status !== "Overdue" && r.status !== "Expired" && r.status !== "Due soon" && r.status !== "Compliant",
  );

  if (overdue.length > 0) {
    y = sectionTitle(doc, y, `Overdue (${overdue.length})`);
    y = renderRequirementTable(doc, y, overdue);
    y += 12;
  }

  if (dueSoon.length > 0) {
    y = sectionTitle(doc, y, `Due Soon (${dueSoon.length})`);
    y = renderRequirementTable(doc, y, dueSoon);
    y += 12;
  }

  if (pending.length > 0) {
    y = sectionTitle(doc, y, `Pending (${pending.length})`);
    y = renderRequirementTable(doc, y, pending);
  }

  stampRecordMark(doc, { margin: MARGIN });
  return doc;
}

function renderRequirementTable(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  requirements: Requirement[],
): number {
  // Table header
  y = ensureRoom(doc, y, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const cols = [
    { label: "Requirement", w: 220 },
    { label: "Individual", w: 110 },
    { label: "Due", w: 80 },
    { label: "Owner", w: 106 },
  ];
  let x = MARGIN;
  for (const col of cols) {
    doc.text(col.label, x, y);
    x += col.w;
  }
  y += 4;
  doc.setDrawColor(160, 150, 140);
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
  y += 14;

  // Table rows
  doc.setFont("helvetica", "normal");
  for (const r of requirements) {
    y = ensureRoom(doc, y, 28);
    x = MARGIN;
    const cells = [r.title, r.person, r.due, r.owner];
    cells.forEach((cell, i) => {
      const lines = doc.splitTextToSize(cell || "—", cols[i].w - 8);
      doc.text(lines.slice(0, 2), x, y);
      x += cols[i].w;
    });
    y += 20;
  }
  return y;
}

export function complianceReportPdfName(agencyName: string, reportDate: string): string {
  const slug = agencyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dateSlug = reportDate.slice(0, 10);
  return `complyrer-compliance-report-${slug}-${dateSlug}.pdf`;
}
