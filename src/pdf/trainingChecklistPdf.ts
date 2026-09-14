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
