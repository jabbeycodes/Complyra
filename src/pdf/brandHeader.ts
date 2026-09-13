import { jsPDF } from "jspdf";
import { imageFormatFromDataUrl } from "../data/branding";

export type ReportBrand = {
  agencyName: string;
  logoDataUrl?: string | null;
};

function drawTextBrand(doc: jsPDF, brand: ReportBrand, margin: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(47, 70, 48);
  doc.text("COMPLYRER", margin, y);
  doc.setTextColor(36, 30, 24);
  doc.setFontSize(10);
  doc.text(brand.agencyName, margin, y + 14);
  return y + 28;
}

export function startBrandedDoc(
  title: string,
  brand: ReportBrand,
  margin = 48,
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = 52;
  const logo = brand.logoDataUrl;
  if (logo) {
    try {
      doc.addImage(logo, imageFormatFromDataUrl(logo), margin, y - 8, 40, 40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(36, 30, 24);
      doc.text(brand.agencyName, margin + 52, y + 8, { maxWidth: 460 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(95, 81, 69);
      doc.text("Prepared with Complyrer", margin + 52, y + 24);
      y += 48;
    } catch {
      y = drawTextBrand(doc, brand, margin, y);
    }
  } else {
    y = drawTextBrand(doc, brand, margin, y);
  }
  doc.setTextColor(36, 30, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(title, 514);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 18 + 8;
  return { doc, margin, y };
}
