import type { Requirement } from "../domain";
import { categories, metrics, statusMix } from "../domain";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

export interface ComplianceReportData {
  agencyName: string;
  reportDate: string;
  asOfDate: string;
  siteFilter: string;
  score: number;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  review: number;
  requirements: Requirement[];
  demoMode?: boolean;
  logoDataUrl?: string | null;
}

const MARGIN = 48;
const CONTENT_WIDTH = 516;
const PAGE_BOTTOM = 720;

function ensureRoom(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  need: number,
): number {
  if (y + need > PAGE_BOTTOM) {
    doc.addPage();
    return 64;
  }
  return y;
}

function sectionTitle(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  text: string,
): number {
  y = ensureRoom(doc, y, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 70, 48);
  doc.text(text, MARGIN, y);
  y += 6;
  doc.setDrawColor(47, 70, 48);
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
  y += 16;
  doc.setTextColor(36, 30, 24);
  return y;
}

function kvLine(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  label: string,
  value: string,
): number {
  y = ensureRoom(doc, y, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${label}:`, MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(value, MARGIN + 168, y);
  return y + 16;
}

function stampDemoWatermark(doc: ReturnType<typeof startBrandedDoc>["doc"]) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(42);
    doc.setTextColor(214, 204, 190);
    doc.text("ILLUSTRATIVE DEMO", 306, 430, {
      align: "center",
      angle: 32,
    });
    doc.setTextColor(36, 30, 24);
  }
}

export function buildComplianceReportPdf(data: ComplianceReportData) {
  const { doc, y: startY } = startBrandedDoc("Compliance Report", {
    agencyName: data.agencyName,
    logoDataUrl: data.logoDataUrl,
  });
  let y = startY;
  const mix = statusMix(data.requirements);
  const scopedMetrics = metrics(data.requirements);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(95, 81, 69);
  doc.text(`Report date: ${data.reportDate}`, MARGIN, y);
  y += 14;
  doc.text(
    `Scope: ${data.siteFilter || "All sites"} · As of ${data.asOfDate}`,
    MARGIN,
    y,
  );
  y += 24;
  doc.setTextColor(36, 30, 24);

  y = sectionTitle(doc, y, "Executive Summary");
  y = kvLine(doc, y, "Compliance score", `${data.score}%`);
  y = kvLine(doc, y, "Complete / total", `${data.done} / ${data.total}`);
  y = kvLine(doc, y, "Overdue or expired", String(data.overdue));
  y = kvLine(doc, y, "Due soon", String(data.dueSoon));
  y = kvLine(doc, y, "Pending review", String(data.review));
  y += 8;

  y = sectionTitle(doc, y, "Status mix");
  y = kvLine(doc, y, "Compliant", String(mix.compliant));
  y = kvLine(doc, y, "Due soon", String(mix.dueSoon));
  y = kvLine(doc, y, "Overdue or expired", String(mix.overdue));
  y = kvLine(doc, y, "Pending review", String(mix.review));
  if (mix.upcoming > 0) y = kvLine(doc, y, "Upcoming", String(mix.upcoming));
  y += 8;

  const siteNames = [...new Set(data.requirements.map((r) => r.site))].sort();
  y = sectionTitle(doc, y, "Breakdown by site");
  for (const siteName of siteNames) {
    const siteItems = data.requirements.filter((r) => r.site === siteName);
    const site = metrics(siteItems);
    y = kvLine(
      doc,
      y,
      siteName,
      `${site.score}% · ${site.done}/${site.total} current · ${site.overdue} overdue`,
    );
  }
  y += 8;

  y = sectionTitle(doc, y, "Breakdown by category");
  for (const category of categories) {
    const group = data.requirements.filter((r) => r.category === category);
    if (!group.length) continue;
    const cm = metrics(group);
    y = kvLine(
      doc,
      y,
      category,
      `${cm.score}% · ${cm.done}/${cm.total} current`,
    );
  }
  y += 8;

  const overdue = data.requirements.filter((r) =>
    ["Overdue", "Expired"].includes(r.status),
  );
  const dueSoon = data.requirements.filter((r) => r.status === "Due soon");
  const pending = data.requirements.filter(
    (r) => r.status === "Pending review",
  );
  const upcoming = data.requirements.filter((r) => r.status === "Upcoming");
  const compliant = data.requirements.filter((r) => r.status === "Compliant");

  if (overdue.length) {
    y = sectionTitle(doc, y, `Overdue or expired (${overdue.length})`);
    y = renderRequirementTable(doc, y, overdue);
    y += 10;
  }
  if (dueSoon.length) {
    y = sectionTitle(doc, y, `Due soon (${dueSoon.length})`);
    y = renderRequirementTable(doc, y, dueSoon);
    y += 10;
  }
  if (pending.length) {
    y = sectionTitle(doc, y, `Pending review (${pending.length})`);
    y = renderRequirementTable(doc, y, pending);
    y += 10;
  }
  if (upcoming.length) {
    y = sectionTitle(doc, y, `Upcoming (${upcoming.length})`);
    y = renderRequirementTable(doc, y, upcoming);
    y += 10;
  }
  y = sectionTitle(
    doc,
    y,
    `Compliant summary (${compliant.length} of ${scopedMetrics.total} current)`,
  );
  if (compliant.length) {
    y = renderRequirementTable(doc, y, compliant);
  } else {
    y = kvLine(doc, y, "Compliant items", "None in this filter");
  }

  y = sectionTitle(doc, y, "Requirements register");
  y = renderRequirementTable(doc, y, data.requirements, true);

  stampRecordMark(doc, { margin: MARGIN });
  if (data.demoMode) stampDemoWatermark(doc);
  return doc;
}

function renderRequirementTable(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  requirements: Requirement[],
  withStatus = false,
): number {
  const cols = withStatus
    ? [
        { label: "Requirement", w: 128 },
        { label: "Individual", w: 86 },
        { label: "Site", w: 78 },
        { label: "Owner", w: 78 },
        { label: "Status", w: 72 },
        { label: "Due", w: 74 },
      ]
    : [
        { label: "Requirement", w: 168 },
        { label: "Individual", w: 96 },
        { label: "Site", w: 86 },
        { label: "Owner", w: 86 },
        { label: "Due", w: 80 },
      ];

  y = ensureRoom(doc, y, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  let x = MARGIN;
  for (const col of cols) {
    doc.text(col.label, x, y);
    x += col.w;
  }
  y += 4;
  doc.setDrawColor(160, 150, 140);
  doc.line(MARGIN, y, MARGIN + CONTENT_WIDTH, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  for (const r of requirements) {
    y = ensureRoom(doc, y, 26);
    x = MARGIN;
    const cells = withStatus
      ? [r.title, r.person, r.site, r.owner, r.status, r.due]
      : [r.title, r.person, r.site, r.owner, r.due];
    cells.forEach((cell, i) => {
      const lines = doc.splitTextToSize(cell || "—", cols[i]!.w - 6);
      doc.text(lines.slice(0, 2), x, y);
      x += cols[i]!.w;
    });
    y += 22;
  }
  return y;
}

/** `Evergreen-Care-compliance-2026-09-14.pdf` */
export function complianceReportPdfName(agencyName: string, isoDate: string): string {
  const slug = agencyName
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = isoDate.slice(0, 10);
  return `${slug}-compliance-${day}.pdf`;
}
