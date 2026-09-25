import { SERVICE_LOG_KIND_LABELS } from "../data/hmChecklist";
import type { HmWeeklyChecklist, ServiceLogEntry } from "../data/types";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";
import { drawSiteLocationFields } from "./siteLocation";
import type { SiteAddressParts } from "../data/siteAddress";
import { reserve } from "./layout";

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export function hmChecklistsFileName(siteName: string, scope: string) {
  return `complyrer-hm-weekly-checklists-${slug(siteName)}-${slug(scope)}.pdf`;
}

export function serviceLogsFileName(siteName: string, scope: string) {
  return `complyrer-weekly-service-logs-${slug(siteName)}-${slug(scope)}.pdf`;
}

function line(doc: import("jspdf").jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 110, y, { maxWidth: 430 });
}

function checklistStatusLabel(status: HmWeeklyChecklist["status"]): string {
  if (status === "submitted") return "Submitted";
  if (status === "overdue") return "Overdue";
  if (status === "locked") return "Locked";
  return "Open";
}

function answerLabel(answer: string | null): string {
  if (answer === "Y") return "Yes";
  if (answer === "N") return "No";
  if (answer === "N/A") return "N/A";
  return "Not answered";
}

/**
 * Printable mirror of the on-screen HM weekly checklists section.
 * Individuals-safe wording — no client/patient/T-Log language.
 */
export function buildHmChecklistsPdf(input: {
  agencyName: string;
  siteName: string;
  scopeLabel: string;
  checklists: HmWeeklyChecklist[];
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("HM Weekly Checklists", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  line(doc, "Period", input.scopeLabel, margin, y);
  y += 28;

  // Keep-with-next: reserve the block before drawing so headers never orphan
  // and content never bleeds into the footer band.
  const pageBreak = (needed: number) => {
    y = reserve(doc, y, needed);
  };

  if (!input.checklists.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No weekly checklists filed for this period.", margin, y);
  }

  for (const checklist of input.checklists) {
    pageBreak(90);
    const answered = checklist.items.filter((i) => i.answer).length;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Week of ${checklist.weekOf}`, margin, y);
    y += 18;
    line(doc, "Status", checklistStatusLabel(checklist.status), margin, y);
    y += 16;
    line(doc, "Items answered", `${answered}/${checklist.items.length}`, margin, y);
    y += 16;
    if (checklist.submittedAt) {
      line(doc, "Submitted", checklist.submittedAt, margin, y);
      y += 16;
    }
    if (checklist.attestation) {
      line(
        doc,
        "Attestation",
        `${checklist.attestation.signedBy} · ${checklist.attestation.signedAt}`,
        margin,
        y,
      );
      y += 16;
    }
    y += 6;
    for (const item of checklist.items) {
      pageBreak(48);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(item.prompt, margin + 12, y, { maxWidth: 480 });
      y += 14;
      doc.setFontSize(9);
      doc.text(`Answer: ${answerLabel(item.answer)}${item.note ? ` · Note: ${item.note}` : ""}`, margin + 12, y, {
        maxWidth: 480,
      });
      y += 16;
    }
    y += 10;
  }

  stampRecordMark(doc, { documentId: `hm-checklists-${slug(input.scopeLabel)}`, margin });
  return doc;
}

/**
 * Printable mirror of the on-screen weekly service logs section.
 * Individuals-safe wording — no client/patient/T-Log language.
 */
export function buildServiceLogsPdf(input: {
  agencyName: string;
  siteName: string;
  scopeLabel: string;
  logs: Array<ServiceLogEntry & { weekOf: string }>;
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Weekly Service Logs", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  line(doc, "Period", input.scopeLabel, margin, y);
  y += 24;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text("Service logs are a separate record from the weekly checklist.", margin, y, {
    maxWidth: 514,
  });
  y += 24;

  const pageBreak = (needed: number) => {
    y = reserve(doc, y, needed);
  };

  if (!input.logs.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No service log entries filed for this period.", margin, y);
  }

  for (const log of input.logs) {
    pageBreak(80);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(SERVICE_LOG_KIND_LABELS[log.kind] ?? log.kind, margin, y);
    y += 16;
    line(doc, "Week of", log.weekOf, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(log.detail || "—", margin + 12, y, { maxWidth: 480 });
    y += 22;
    const meta = [log.staffName, log.dateTime].filter(Boolean).join(" · ");
    if (meta) {
      doc.setFontSize(9);
      doc.text(meta, margin + 12, y, { maxWidth: 480 });
      y += 14;
    }
    y += 8;
  }

  stampRecordMark(doc, { documentId: `service-logs-${slug(input.scopeLabel)}`, margin });
  return doc;
}
