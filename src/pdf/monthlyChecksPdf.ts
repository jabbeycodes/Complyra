import {
  DRILL_LABELS,
  SAFETY_LINE_DEFS,
  monthLabel,
  type AdaptiveEquipment,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
} from "../data/monthlyChecks";
import { startBrandedDoc } from "./brandHeader";

function line(doc: import("jspdf").jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 110, y, { maxWidth: 430 });
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
  y += 28;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text(
    "If a date is entered and there are no comments, the equipment was checked and is in good order. Use comments for repairs or issues.",
    margin,
    y,
    { maxWidth: 514 },
  );
  y += 28;
  for (const item of input.items) {
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
    if (y > 720) {
      doc.addPage();
      y = 64;
    }
  }
  return doc;
}

export function buildDrillsMonthPdf(input: {
  agencyName: string;
  siteName: string;
  monthKey: string;
  drills: EmergencyDrill[];
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Emergency Drills", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  line(doc, "Home", input.siteName, margin, y);
  y += 16;
  line(doc, "Month", monthLabel(input.monthKey), margin, y);
  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text("Drills must be completed by the 7th of each month.", margin, y);
  y += 24;
  for (const drill of input.drills) {
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
    if (drill.drillType === "fire" || drill.drillType === "missing_person") {
      line(doc, "Awake / sleep", drill.awakeOrSleep, margin, y);
      y += 16;
    }
    y += 10;
    if (y > 680) {
      doc.addPage();
      y = 64;
    }
  }
  return doc;
}

export function buildSafetyMonthPdf(input: {
  agencyName: string;
  siteName: string;
  monthKey: string;
  report: HomeSafetyReport;
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Monthly Home Safety Report", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  line(doc, "Home", input.siteName, margin, y);
  y += 16;
  line(doc, "Month", monthLabel(input.monthKey), margin, y);
  y += 24;
  for (const def of SAFETY_LINE_DEFS) {
    const row = input.report.lines.find((lineRow) => lineRow.key === def.key);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
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
    if (y > 700) {
      doc.addPage();
      y = 64;
    }
  }
  return doc;
}
