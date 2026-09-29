import { stampRecordMark, startBrandedDoc } from "./brandHeader";
import { contentWidth, drawSectionHeader, drawSignatureRow } from "./layout";

export function buildCarePlanPdf(input: {
  agencyName: string;
  individualName: string;
  title: string;
  versionLabel: string;
  effectiveOn: string;
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc(input.title, {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  }, 54);
  let y = startY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const [label, value] of [
    ["Agency", input.agencyName],
    ["Individual", input.individualName],
    ["Version", input.versionLabel],
    ["Effective", input.effectiveOn],
  ]) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 140, y, { maxWidth: contentWidth(margin) - 140 });
    y += 18;
  }
  y += 16;
  const note = doc.splitTextToSize(
    "This printable cover is generated from the chart when the original upload is not stored in this workspace.",
    contentWidth(margin),
  );
  doc.text(note, margin, y);
  y += note.length * 14 + 24;

  // Completion area: who confirmed this cover against the source plan.
  y = drawSectionHeader(doc, y, "Reviewed by", { margin, gapAfter: 12 });
  const sigWidth = Math.round(contentWidth(margin) * 0.6);
  drawSignatureRow(
    doc,
    y,
    [
      { label: "Signature", width: sigWidth },
      { label: "Date", width: contentWidth(margin) - sigWidth - 16 },
    ],
    { margin },
  );

  stampRecordMark(doc, { margin });
  return doc;
}
