import type { TrainingChecklist } from "../data/chart";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

export function buildTrainingChecklistPdf(input: {
  agencyName: string;
  individualName: string;
  siteName: string;
  checklist: TrainingChecklist;
  logoDataUrl?: string | null;
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
    doc.text(line.initialedAt ? "Initialed" : "Pending", 420, y);
    y += 22;
  }
  y += 16;
  doc.setFont("helvetica", "bold");
  doc.text(
    `Staff signature: ${
      input.checklist.staffSignedAt
        ? input.checklist.staffSignatureName || input.checklist.staffName
        : "Pending"
    }`,
    margin,
    y,
  );
  y += 20;
  doc.text(
    `House manager signature: ${
      input.checklist.hmSignedAt
        ? input.checklist.hmSignatureName || "Signed"
        : "Pending"
    }`,
    margin,
    y,
  );
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
