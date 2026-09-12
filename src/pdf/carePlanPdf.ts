import { jsPDF } from "jspdf";

export function buildCarePlanPdf(input: {
  agencyName: string;
  individualName: string;
  title: string;
  versionLabel: string;
  effectiveOn: string;
}) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54;
  let y = 64;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(47, 70, 48);
  doc.text("COMPLYRER", margin, y);
  doc.setTextColor(36, 30, 24);
  doc.setFontSize(18);
  y += 26;
  doc.text(input.title, margin, y, { maxWidth: 500 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y += 32;
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
