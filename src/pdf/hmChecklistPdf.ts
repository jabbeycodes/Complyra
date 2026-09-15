import type {
  ChecklistAnswer,
  HmWeeklyChecklist,
} from "../data/types";
import {
  CHECKLIST_ATTESTATION_TEXT,
  CHECKLIST_DEADLINE_TEXT,
  ITEM_21_KEY,
  SERVICE_LOG_KINDS,
  SERVICE_LOG_KIND_LABELS,
  SERVICE_LOG_PROMPTS,
  checklistPdfFileName,
  formatShortDate,
  weekRangeLabel,
} from "../data/hmChecklist";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";
import { drawSiteLocationFields } from "./siteLocation";
import type { SiteAddressParts } from "../data/siteAddress";

type Doc = import("jspdf").jsPDF;

const PAGE_BOTTOM = 730;
const CONTENT_WIDTH = 514;

/** Format an ISO timestamp as "M/D/YY h:mm AM/PM" for signature lines. */
function formatSignatureTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} ${time}`;
}

function ensureRoom(doc: Doc, y: number, need: number): number {
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return 64;
  }
  return y;
}

function answerBox(
  doc: Doc,
  x: number,
  y: number,
  label: string,
  selected: boolean,
) {
  const w = label === "N/A" ? 34 : 24;
  // White-sheet printing: no dark fills. Selected answers get a bold border
  // + checkmark; unselected get a light border.
  if (selected) {
    doc.setDrawColor(47, 70, 48);
    doc.setLineWidth(1.5);
    doc.rect(x, y - 11, w, 15);
    doc.setLineWidth(0.5);
    doc.setTextColor(47, 70, 48);
  } else {
    doc.setDrawColor(120, 110, 98);
    doc.rect(x, y - 11, w, 15);
    doc.setTextColor(95, 81, 69);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const displayLabel = selected ? `✓ ${label}` : label;
  doc.text(displayLabel, x + 5, y);
  doc.setTextColor(36, 30, 24);
  return x + w + 6;
}

function renderItem(
  doc: Doc,
  margin: number,
  y: number,
  index: number,
  prompt: string,
  answer: ChecklistAnswer | null,
  note: string,
  autoComputed?: boolean,
): number {
  y = ensureRoom(doc, y, 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text(`${index + 1}.`, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(36, 30, 24);
  const promptLines = doc.splitTextToSize(prompt, 330);
  doc.text(promptLines, margin + 20, y);
  const promptHeight = promptLines.length * 12;
  // Answer boxes on the right
  const boxY = y + 2;
  let x = margin + 380;
  x = answerBox(doc, x, boxY, "Y", answer === "Y");
  x = answerBox(doc, x, boxY, "N", answer === "N");
  answerBox(doc, x, boxY, "N/A", answer === "N/A");
  y += Math.max(promptHeight, 16) + 4;
  const noteText = autoComputed && note ? `(auto-checked) ${note}` : note;
  if (noteText) {
    y = ensureRoom(doc, y, 24);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(95, 81, 69);
    const noteLines = doc.splitTextToSize(`Note: ${noteText}`, 430);
    doc.text(noteLines, margin + 20, y);
    y += noteLines.length * 11 + 4;
  }
  return y + 6;
}

export function buildWeeklyChecklistPdf(input: {
  agencyName: string;
  siteName: string;
  weekOf: string;
  checklist: HmWeeklyChecklist;
  hmName: string;
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("House Manager Weekly Review", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  const c = input.checklist;
  let y = startY;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  const header: Array<[string, string]> = [
    ["Week of", `${weekRangeLabel(input.weekOf)} (Sunday ${formatShortDate(input.weekOf)})`],
    ["House manager", input.hmName || "—"],
    ["Status", c.status],
  ];
  for (const [label, value] of header) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 110, y, { maxWidth: 400 });
    y += 16;
  }
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Weekly review — mark Y, N, or N/A for each item.", margin, y);
  y += 6;
  doc.setDrawColor(47, 70, 48);
  doc.line(margin, y, margin + CONTENT_WIDTH, y);
  y += 18;

  c.items.forEach((item, i) => {
    y = renderItem(doc, margin, y, i, item.prompt, item.answer, item.note, item.autoComputed || item.key === ITEM_21_KEY);
  });

  y = ensureRoom(doc, y, 110);
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const attLines = doc.splitTextToSize(CHECKLIST_ATTESTATION_TEXT, CONTENT_WIDTH);
  doc.text(attLines, margin, y);
  y += attLines.length * 13 + 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`HM Signature: ${c.attestation?.signedBy ?? "____________________________"}`, margin, y);
  // Timestamp includes date + time per audit requirements.
  const attTimestamp = c.attestation
    ? formatSignatureTimestamp(c.attestation.signedAt)
    : "____________";
  doc.text(
    `Date/time: ${attTimestamp}`,
    margin + 330,
    y,
  );
  y += 24;
  doc.setFont("helvetica", "bold");
  doc.text(CHECKLIST_DEADLINE_TEXT, margin, y);

  stampRecordMark(doc, {
    documentId: `HM weekly checklist \u00b7 ${input.siteName} \u00b7 week of ${weekRangeLabel(input.weekOf)}`,
    generatedAt: input.checklist.submittedAt,
    margin,
  });
  return doc;
}

/**
 * Weekly Service Log — a SEPARATE document from the HM Weekly Checklist.
 * Exports the service log entries for a week as their own PDF.
 */
export function buildWeeklyServiceLogPdf(input: {
  agencyName: string;
  siteName: string;
  weekOf: string;
  checklist: HmWeeklyChecklist;
  hmName: string;
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Weekly Service Log", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  const c = input.checklist;
  let y = startY;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  const header: Array<[string, string]> = [
    ["Week of", `${weekRangeLabel(input.weekOf)} (Sunday ${formatShortDate(input.weekOf)})`],
    ["House manager", input.hmName || "—"],
  ];
  for (const [label, value] of header) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 110, y, { maxWidth: 400 });
    y += 16;
  }
  y += 8;

  for (const kind of SERVICE_LOG_KINDS) {
    y = ensureRoom(doc, y, 60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(SERVICE_LOG_KIND_LABELS[kind], margin, y);
    y += 14;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(95, 81, 69);
    const promptLines = doc.splitTextToSize(SERVICE_LOG_PROMPTS[kind], CONTENT_WIDTH);
    doc.text(promptLines, margin, y);
    y += promptLines.length * 12 + 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(36, 30, 24);
    const entries = c.serviceLogs.filter((e) => e.kind === kind);
    if (entries.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(140, 130, 118);
      doc.text("— None recorded —", margin, y);
      doc.setTextColor(36, 30, 24);
      y += 16;
    } else {
      for (const entry of entries) {
        const meta = [entry.staffName, entry.dateTime].filter(Boolean).join(" · ");
        const line = meta ? `${entry.detail}  (${meta})` : entry.detail;
        const lines = doc.splitTextToSize(`• ${line}`, CONTENT_WIDTH - 12);
        y = ensureRoom(doc, y, lines.length * 12 + 6);
        doc.setFontSize(9.5);
        doc.text(lines, margin + 8, y);
        y += lines.length * 12 + 4;
      }
      y += 4;
    }
    y += 8;
  }

  stampRecordMark(doc, {
    documentId: `HM weekly checklist \u00b7 ${input.siteName} \u00b7 week of ${weekRangeLabel(input.weekOf)}`,
    generatedAt: input.checklist.submittedAt,
    margin,
  });
  return doc;
}

export function weeklyChecklistPdfName(siteName: string, weekOf: string): string {
  return checklistPdfFileName(siteName, weekOf);
}

export function weeklyServiceLogPdfName(siteName: string, weekOf: string): string {
  const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `complyrer-service-log-${slug}-${weekOf}.pdf`;
}
