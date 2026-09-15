import type { jsPDF } from "jspdf";
import {
  siteLocationFields,
  type SiteAddressParts,
} from "../data/siteAddress";

/**
 * Draw name, then full address, in body ink — not 8pt gray soup.
 * Returns the y after the block.
 */
export function drawSiteLocationFields(
  doc: jsPDF,
  x: number,
  y: number,
  parts: SiteAddressParts,
  opts?: {
    homeLabel?: string;
    labelWidth?: number;
    lineGap?: number;
    valueMaxWidth?: number;
  },
): number {
  const homeLabel = opts?.homeLabel ?? "Home";
  const labelWidth = opts?.labelWidth ?? 110;
  const lineGap = opts?.lineGap ?? 16;
  const valueMaxWidth = opts?.valueMaxWidth ?? 400;
  const { name, address } = siteLocationFields(parts);
  const rows: Array<[string, string]> = [];
  if (name) rows.push([homeLabel, name]);
  if (address) rows.push(["Address", address]);
  for (const [label, value] of rows) {
    doc.setTextColor(36, 30, 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`${label}:`, x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(value, valueMaxWidth);
    doc.text(wrapped, x + labelWidth, y);
    y += Math.max(lineGap, wrapped.length * 12 + 4);
  }
  return y;
}
