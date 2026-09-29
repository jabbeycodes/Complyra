import {
  DRILL_LABELS,
  SAFETY_LINE_DEFS,
  monthLabel,
  type AdaptiveEquipment,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
} from "../data/monthlyChecks";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";
import { drawSiteLocationFields } from "./siteLocation";
import type { SiteAddressParts } from "../data/siteAddress";
import {
  DEFAULT_MARGIN,
  MUTED,
  contentWidth,
  drawSectionHeader,
  drawSignatureRow,
  reserve,
} from "./layout";

type Doc = import("jspdf").jsPDF;

const VALUE_WIDTH = contentWidth(DEFAULT_MARGIN) - 110;

function line(doc: Doc, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(36, 30, 24);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 110, y, { maxWidth: VALUE_WIDTH });
}

/** Italic caption block, wrapped to the content width. Returns the y after it. */
function caption(doc: Doc, margin: number, y: number, text: string) {
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const lines = doc.splitTextToSize(text, contentWidth(margin));
  doc.text(lines, margin, y);
  doc.setTextColor(36, 30, 24);
  doc.setFont("helvetica", "normal");
  return y + lines.length * 12 + 16;
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export function equipmentFileName(personName: string, monthKey: string) {
  return `complyrer-adaptive-equipment-${slug(personName)}-${monthKey}.pdf`;
}

export function drillsFileName(siteName: string, monthKey: string) {
  return `complyrer-emergency-drills-${slug(siteName)}-${monthKey}.pdf`;
}

export function safetyFileName(siteName: string, monthKey: string) {
  return `complyrer-home-safety-${slug(siteName)}-${monthKey}.pdf`;
}

export function buildEquipmentMonthPdf(input: {
  agencyName: string;
  individualName: string;
  dmhId: string;
  monthKey: string;
  items: Array<AdaptiveEquipment & { log?: EquipmentMonthLog }>;
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Adaptive Equipment Log", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  line(doc, "Individual", input.individualName, margin, y);
  y += 16;
  line(doc, "DMH ID", input.dmhId || "—", margin, y);
  y += 16;
  line(doc, "Month", monthLabel(input.monthKey), margin, y);
  y += 22;
  y = caption(
    doc,
    margin,
    y,
    "If a date is entered and there are no comments, the equipment was checked and is in good order. Use comments for repairs or issues.",
  );

  if (input.items.length === 0) {
    y = reserve(doc, y, 20);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No adaptive equipment is tracked for this individual.", margin, y);
  }

  for (const item of input.items) {
    // Reserve the whole item block so the equipment name never orphans from
    // its fields and nothing spills into the footer band.
    y = reserve(doc, y, 16 + 16 * 3 + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(item.name, margin, y);
    y += 16;
    line(doc, "Date", item.log?.checkedOn ?? "", margin, y);
    y += 16;
    line(doc, "Initials", item.log?.initials ?? "", margin, y);
    y += 16;
    line(doc, "Comments", item.log?.comments || "Checked and in good order", margin, y);
    y += 24;
  }
  stampRecordMark(doc, { documentId: `equipment-${input.monthKey}`, margin });
  return doc;
}

export function buildDrillsMonthPdf(input: {
  agencyName: string;
  siteName: string;
  monthKey: string;
  drills: EmergencyDrill[];
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Emergency Drills", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  line(doc, "Month", monthLabel(input.monthKey), margin, y);
  y += 22;
  y = caption(doc, margin, y, "Drills must be completed by the 7th of each month.");

  for (const drill of input.drills) {
    const hasAwake =
      drill.drillType === "fire" || drill.drillType === "missing_person";
    // Title + 5 (or 6) fields kept together.
    y = reserve(doc, y, 16 + 16 * (hasAwake ? 6 : 5) + 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`${DRILL_LABELS[drill.drillType]} drill`, margin, y);
    y += 16;
    line(doc, "Date", drill.date ?? "", margin, y);
    y += 16;
    line(doc, "Time", drill.time ?? "", margin, y);
    y += 16;
    line(doc, "Evac time", drill.evacTime ?? "", margin, y);
    y += 16;
    line(doc, "Drill leader", drill.leaderName ?? "", margin, y);
    y += 16;
    line(doc, "Participants", drill.participants, margin, y);
    y += 16;
    if (hasAwake) {
      line(doc, "Awake / sleep", drill.awakeOrSleep, margin, y);
      y += 16;
    }
    y += 10;
  }

  // Completion sign-off: the person who reviewed the month's drills.
  y += 8;
  y = drawSectionHeader(doc, y, "Monthly review", { margin });
  y = drawSignatureRow(
    doc,
    y,
    [
      { label: "Reviewed by (print + sign)", width: 320 },
      { label: "Date", width: contentWidth(margin) - 320 - 16 },
    ],
    { margin },
  );

  stampRecordMark(doc, { documentId: `drills-${input.monthKey}`, margin });
  return doc;
}

export function buildSafetyMonthPdf(input: {
  agencyName: string;
  siteName: string;
  monthKey: string;
  report: HomeSafetyReport;
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Monthly Home Safety Report", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  line(doc, "Month", monthLabel(input.monthKey), margin, y);
  y += 24;
  for (const def of SAFETY_LINE_DEFS) {
    const row = input.report.lines.find((lineRow) => lineRow.key === def.key);
    const extraRows =
      (def.fields.includes("location") ? 1 : 0) +
      (def.fields.includes("temp") ? 1 : 0) +
      (def.fields.includes("extra") ? 1 : 0);
    // Title + date checked + optional fields + checked-by, kept together.
    y = reserve(doc, y, 15 + 15 * (2 + extraRows) + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(36, 30, 24);
    doc.text(def.title, margin, y);
    y += 15;
    line(doc, "Date checked", row?.dateChecked ?? "", margin, y);
    y += 15;
    if (def.fields.includes("location")) {
      line(doc, "Location", row?.location ?? "", margin, y);
      y += 15;
    }
    if (def.fields.includes("temp")) {
      line(doc, "Temp", row?.temp ?? "", margin, y);
      y += 15;
    }
    if (def.fields.includes("extra")) {
      line(doc, def.extraLabel ?? "Notes", row?.extra ?? "", margin, y);
      y += 15;
    }
    line(doc, "Checked by", row?.checkedBy ?? "", margin, y);
    y += 20;
  }

  // Completion sign-off for the whole monthly report.
  y += 6;
  y = drawSectionHeader(doc, y, "Monthly review", { margin });
  y = drawSignatureRow(
    doc,
    y,
    [
      { label: "Reviewed by (print + sign)", width: 320 },
      { label: "Date", width: contentWidth(margin) - 320 - 16 },
    ],
    { margin },
  );

  stampRecordMark(doc, { documentId: `safety-${input.monthKey}`, margin });
  return doc;
}
