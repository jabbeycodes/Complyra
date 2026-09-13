import { startBrandedDoc } from "./brandHeader";

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
    doc.text(value, margin + 140, y);
    y += 18;
  }
  y += 16;
  doc.text(
    "This printable cover is generated from the chart when the original upload is not stored in this workspace.",
    margin,
    y,
    { maxWidth: 500 },
  );
  return doc;
}
