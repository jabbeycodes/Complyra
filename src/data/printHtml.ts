import { DIGITAL_RECORD_MARK } from "../delegation/delegation";
import { COMPLYRER_LOCKUP_SVG } from "../brand/complyrerLockup";

export interface PrintHtmlBrand {
  agencyName: string;
  /** Agency logo (data URL) when one is set; the header falls back to the agency name alone. */
  logoDataUrl?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The HTML twin of the PDF brandHeader pattern (src/pdf/brandHeader.ts) for
 * the platform's standalone print documents — the ones built as a full HTML
 * string and opened via openPrintable. Emits the whole document: a header
 * with the agency logo when one is set, the agency name always,
 * "Prepared with Complyrer", and the ComplyRer logo lockup (inline SVG) at
 * the right; the caller's body markup unchanged; and the Complyrer record
 * mark as the footer. `styles` carries the document's own stylesheet text
 * so each surface keeps its exact print layout.
 */
export function brandedPrintHtml(opts: {
  brand: PrintHtmlBrand;
  title: string;
  styles?: string;
  bodyHtml: string;
}): string {
  const logo = opts.brand.logoDataUrl
    ? `<img src="${opts.brand.logoDataUrl}" alt="" style="height:40px;max-width:160px;object-fit:contain">`
    : "";
  return `<!doctype html><html><head><title>${escapeHtml(opts.title)}</title>
<style>body{font-family:Arial,sans-serif;color:#111}.brand-header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #bbb;padding-bottom:10px;margin-bottom:16px}.brand-header .brand-agency{font-size:17px;font-weight:700}.brand-header .brand-prepared{font-size:11px;color:#555}.brand-header .brand-lockup{margin-left:auto}.brand-header .brand-lockup svg{height:28px;width:auto;display:block}.record-footer{margin-top:20px}${opts.styles ?? ""}</style>
</head><body>
<header class="brand-header">${logo}<span><span class="brand-agency">${escapeHtml(opts.brand.agencyName)}</span><br><span class="brand-prepared">Prepared with Complyrer</span></span><span class="brand-lockup">${COMPLYRER_LOCKUP_SVG}</span></header>
${opts.bodyHtml}
<p class="record-footer"><em>${DIGITAL_RECORD_MARK}</em></p>
</body></html>`;
}
