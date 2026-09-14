import type { TrainingChecklist } from "../data/chart";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

/** Format an ISO timestamp as "M/D/YY h:mm AM/PM" for signature lines. */
function formatSignatureTimestamp(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} ${time}`;
}

export function buildTrainingChecklistPdf(input: {
  agencyName: string;
  individualName: string;
  siteName: string;
  checklist: TrainingChecklist;
  logoDataUrl?: string | null;
  /** Actual initials per line (lineId -> initials text, e.g. "TSO"). */
  lineInitials?: Record<string, string>;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("In-Home Staff Training Record", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  }, 54);
  let y = startY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const [label, value] of [
    ["Agency", input.agencyName],
    ["Individual", input.individualName],
    ["Program site", input.siteName],
    ["Staff", input.checklist.staffName],
  ]) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 140, y);
    y += 18;
  }
  y += 10;
  doc.setFont("helvetica", "bold");
  doc.text("Training item", margin, y);
  doc.text("Staff initial", 420, y);
  y += 8;
  doc.setDrawColor(47, 70, 48);
  doc.line(margin, y, 558, y);
  y += 20;
  doc.setFont("helvetica", "normal");
  for (const line of input.checklist.items) {
    if (y > 700) {
      doc.addPage();
      y = 64;
    }
    doc.text(line.title, margin, y, { maxWidth: 340 });
    // Show the staff member's ACTUAL initials — never the word "initialed".
    const initials = input.lineInitials?.[line.id]?.trim();
    if (initials) {
      doc.setFont("helvetica", "bold");
      doc.text(initials, 420, y);
      doc.setFont("helvetica", "normal");
    } else if (line.initialedAt) {
      // Fallback: show the date the line was initialed (not the word "Initialed").
      const d = new Date(line.initialedAt);
      doc.text(
        d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }),
        420,
        y,
      );
    } else {
      doc.text("Pending", 420, y);
    }
    y += 22;
  }
  y += 16;
  doc.setFont("helvetica", "bold");
  // Staff signature with timestamp (date + time).
  const staffSig = input.checklist.staffSignedAt
    ? input.checklist.staffSignatureName || input.checklist.staffName
    : "Pending";
  const staffTime = input.checklist.staffSignedAt
    ? ` — ${formatSignatureTimestamp(input.checklist.staffSignedAt)}`
    : "";
  doc.text(`Staff signature: ${staffSig}${staffTime}`, margin, y);
  y += 20;
  // HM signature with timestamp (date + time).
  const hmSig = input.checklist.hmSignedAt
    ? input.checklist.hmSignatureName || "Signed"
    : "Pending";
  const hmTime = input.checklist.hmSignedAt
    ? ` — ${formatSignatureTimestamp(input.checklist.hmSignedAt)}`
    : "";
  doc.text(`House manager signature: ${hmSig}${hmTime}`, margin, y);
  stampRecordMark(doc, {
    documentId: input.checklist.id,
    generatedAt: input.checklist.hmSignedAt ?? input.checklist.staffSignedAt,
    margin,
  });
  return doc;
}

export function trainingFileName(staffName: string, individualName: string) {
  return `complyrer-training-${staffName.toLowerCase().replaceAll(" ", "-")}-${individualName
    .toLowerCase()
    .replaceAll(" ", "-")}.pdf`;
}

/**
 * Staff training checklist PDF for the StaffCompliancePage profile view.
 *
 * The in-home training checklist (60 topics in 6 sections): every line shows
 * the staffer's ACTUAL initials (never the word "initialed"), the signed-on
 * date, the trainer, and the staff + house-manager signatures with
 * timestamps. White, print-friendly, stamped with the Complyrer record mark.
 */
export interface StaffTrainingPdfLine {
  title: string;
  section: string;
  /** Actual adopted initials text (e.g. "TSO"), or null when not initialed. */
  initials: string | null;
  /** ISO date the line was initialed, or null. */
  signedOn: string | null;
  na: boolean;
  naReason: string | null;
  trainerName: string;
}

export interface StaffTrainingPdfSignature {
  name: string | null;
  signedAt: string | null;
}

export interface StaffTrainingPdfSiteSignatures {
  siteName: string;
  staff: StaffTrainingPdfSignature;
  hm: StaffTrainingPdfSignature;
}

export function buildStaffTrainingChecklistPdf(input: {
  agencyName: string;
  staffName: string;
  siteNames: string[];
  hoursTotal: number;
  hoursWithHm: number;
  lines: StaffTrainingPdfLine[];
  signatures: StaffTrainingPdfSiteSignatures[];
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("In-Home Staff Training Checklist", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  }, 54);
  let y = startY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const [label, value] of [
    ["Agency", input.agencyName],
    ["Staff", input.staffName],
    ["Program site(s)", input.siteNames.join(", ") || "—"],
    ["Training hours", `${input.hoursTotal} total · ${input.hoursWithHm} with house manager`],
  ]) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 140, y, { maxWidth: 360 });
    y += 18;
  }

  let lastSection = "";
  for (const line of input.lines) {
    if (line.section !== lastSection) {
      lastSection = line.section;
      y += 10;
      if (y > 700) {
        doc.addPage();
        y = 64;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(line.section, margin, y);
      y += 6;
      doc.setFontSize(9);
      doc.text("Training item", margin, y);
      doc.text("Initials / date", 420, y);
      y += 6;
      doc.setDrawColor(47, 70, 48);
      doc.line(margin, y, 558, y);
      y += 16;
    }
    if (y > 710) {
      doc.addPage();
      y = 64;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(line.title, margin, y, { maxWidth: 340 });
    doc.setFont("helvetica", "bold");
    if (line.na) {
      doc.text("N/A", 420, y);
      doc.setFont("helvetica", "normal");
      if (line.naReason) {
        doc.setFontSize(8);
        doc.text(line.naReason, 420, y + 11, { maxWidth: 130 });
        y += 11;
      }
    } else if (line.initials?.trim()) {
      const date = line.signedOn ? ` ${line.signedOn.slice(5, 7)}/${line.signedOn.slice(8, 10)}/${line.signedOn.slice(2, 4)}` : "";
      doc.text(`${line.initials.trim()}${date}`, 420, y);
    } else {
      doc.text("Pending", 420, y);
    }
    doc.setFont("helvetica", "normal");
    if (line.trainerName && !line.na) {
      doc.setFontSize(8);
      doc.text(`Trainer: ${line.trainerName}`, margin, y + 11, { maxWidth: 340 });
      y += 11;
    }
    y += 16;
  }

  y += 10;
  if (y > 660) {
    doc.addPage();
    y = 64;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Signatures", margin, y);
  y += 18;
  doc.setFontSize(10);
  for (const site of input.signatures) {
    if (y > 700) {
      doc.addPage();
      y = 64;
    }
    doc.setFont("helvetica", "bold");
    doc.text(site.siteName, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    const staffText = site.staff.signedAt
      ? `Staff signature: ${site.staff.name ?? "Signed"} — ${formatSignatureTimestamp(site.staff.signedAt)}`
      : "Staff signature: Pending";
    doc.text(staffText, margin, y, { maxWidth: 500 });
    y += 16;
    const hmText = site.hm.signedAt
      ? `House manager signature: ${site.hm.name ?? "Signed"} — ${formatSignatureTimestamp(site.hm.signedAt)}`
      : "House manager signature: Pending";
    doc.text(hmText, margin, y, { maxWidth: 500 });
    y += 22;
  }
  stampRecordMark(doc, {
    documentId: `training-checklist-${input.staffName.toLowerCase().replaceAll(" ", "-")}`,
    margin,
  });
  return doc;
}

export function staffTrainingFileName(staffName: string) {
  return `complyrer-training-checklist-${staffName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "")}.pdf`;
}
