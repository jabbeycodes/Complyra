/**
 * Monthly mileage sheet PDF (Complyrer's own vehicle mileage log).
 *
 * Replaces the old in-app print view: this builds a real, downloadable PDF
 * for a home's monthly mileage log — trip rows with per-rider mile shares,
 * a totals row, and sign-off lines — stamped with the Complyrer record mark.
 */
import { jsPDF } from "jspdf";
import { monthLabel } from "../data/mileage";
import { stampRecordMark } from "./brandHeader";
import type { MileageTripView } from "../data/types";
import type { MileageYearlySummary } from "../data/mileage";

export interface MileagePdfPerson {
  id: string;
  name: string;
}

export interface MileageMonthPdfInput {
  agencyName: string;
  siteName: string;
  monthKey: string;
  people: MileagePdfPerson[];
  trips: MileageTripView[];
  totalMiles: number;
  /** individualId -> accumulated mile share for the month */
  milesByIndividualId: Record<string, number>;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

export function mileageMonthFileName(siteName: string, monthKey: string) {
  return `complyrer-mileage-log-${slug(siteName)}-${monthKey}.pdf`;
}

const PAGE_W = 792; // letter landscape, pt
const PAGE_H = 612;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 572;

type RGB = [number, number, number];
const INK: RGB = [36, 30, 24];
const EVERGREEN: RGB = [47, 70, 48];
const HEADER_FILL: RGB = [240, 240, 240];
const GROUP_FILL: RGB = [233, 229, 221];

function drawBrand(doc: jsPDF, agencyName: string, monthKey: string, siteName: string) {
  let y = 48;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...EVERGREEN);
  doc.text("COMPLYRER", MARGIN, y);
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(agencyName, MARGIN, y + 14);
  y += 34;
  doc.setFontSize(16);
  doc.text("Mileage Log", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Home: ${siteName}    Month: ${monthLabel(monthKey)}`, MARGIN, y + 18);
  return y + 34;
}

interface Column {
  key: string;
  label: string;
  width: number;
}

function buildColumns(people: MileagePdfPerson[]): Column[] {
  const fixed: Column[] = [
    { key: "date", label: "Date", width: 66 },
    { key: "start", label: "Odometer start", width: 60 },
    { key: "stop", label: "Odometer stop", width: 60 },
    { key: "miles", label: "Miles", width: 46 },
  ];
  const tail: Column[] = [
    { key: "reason", label: "Reason / trip", width: 116 },
    { key: "signature", label: "Signature", width: 84 },
  ];
  const fixedWidth = fixed.reduce((sum, c) => sum + c.width, 0);
  const tailWidth = tail.reduce((sum, c) => sum + c.width, 0);
  const personWidth =
    people.length > 0
      ? Math.max(28, (CONTENT_W - fixedWidth - tailWidth) / people.length)
      : 0;
  return [
    ...fixed,
    ...people.map((person) => ({
      key: `person:${person.id}`,
      label: person.name,
      width: personWidth,
    })),
    ...tail,
  ];
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

export function buildMileageMonthPdf(input: MileageMonthPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  let y = drawBrand(doc, input.agencyName, input.monthKey, input.siteName);

  const columns = buildColumns(input.people);
  const lineH = 11;

  function drawRow(
    cells: Record<string, string>,
    opts: { bold?: boolean; fill?: RGB | null; fontSize?: number } = {},
  ) {
    const fontSize = opts.fontSize ?? 8;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    // measure row height from the wrapped cell with the most lines
    let rowH = fontSize + 7;
    const wrapped = columns.map((col) => {
      const lines = doc.splitTextToSize(cells[col.key] ?? "", col.width - 8);
      rowH = Math.max(rowH, lines.length * lineH + 8);
      return lines as string[];
    });
    if (y + rowH > FOOTER_Y - 12) {
      doc.addPage();
      y = 52;
    }
    let x = MARGIN;
    columns.forEach((col, i) => {
      if (opts.fill) {
        doc.setFillColor(...opts.fill);
        doc.rect(x, y, col.width, rowH, "F");
      }
      doc.setDrawColor(0, 0, 0);
      doc.rect(x, y, col.width, rowH);
      doc.setTextColor(...INK);
      doc.text(wrapped[i], x + 4, y + lineH + 1);
      x += col.width;
    });
    y += rowH;
  }

  const headerCells = Object.fromEntries(columns.map((c) => [c.key, c.label]));
  drawRow(headerCells, { bold: true, fill: HEADER_FILL, fontSize: 8 });

  for (const trip of input.trips) {
    const shareById = Object.fromEntries(
      trip.riderShares.map((share) => [share.individualId, share.miles]),
    );
    const cells: Record<string, string> = {
      date: fmtDate(trip.tripDate),
      start: String(trip.odometerStart),
      stop: String(trip.odometerEnd),
      miles: String(trip.miles),
      reason: trip.backfilled ? `${trip.reason} (backfilled)` : trip.reason,
      signature: trip.signatureName,
    };
    for (const person of input.people) {
      const share = shareById[person.id];
      cells[`person:${person.id}`] = share === undefined ? "" : String(share);
    }
    drawRow(cells);
  }

  // blank rows so a printed copy still has room for pen entries
  const blankRows = Math.max(0, Math.min(6, 12 - input.trips.length));
  for (let i = 0; i < blankRows; i++) {
    drawRow({}, { fontSize: 8 });
  }

  const totals: Record<string, string> = {
    date: "Total miles",
    start: "",
    stop: "",
    miles: String(input.totalMiles),
    reason: "",
    signature: "",
  };
  for (const person of input.people) {
    totals[`person:${person.id}`] = String(input.milesByIndividualId[person.id] ?? 0);
  }
  drawRow(totals, { bold: true, fill: HEADER_FILL, fontSize: 8 });

  // sign-off lines: the driver and house manager attest the monthly log.
  // Names are left blank for pen entry — never pre-printed.
  y += 22;
  doc.setFontSize(9);
  const signoffs: Array<[string, string]> = [
    ["Driver print name:", "Driver signature:"],
    ["House manager print name:", "House manager signature:"],
  ];
  for (const [printLabel, signLabel] of signoffs) {
    if (y + 26 > FOOTER_Y - 12) {
      doc.addPage();
      y = 52;
    }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(printLabel, MARGIN, y);
    doc.setDrawColor(0, 0, 0);
    doc.line(MARGIN + 118, y + 2, MARGIN + 118 + 150, y + 2);
    doc.setFont("helvetica", "bold");
    doc.text(signLabel, MARGIN + 300, y);
    doc.line(MARGIN + 300 + 108, y + 2, MARGIN + 300 + 108 + 150, y + 2);
    y += 26;
  }

  stampRecordMark(doc, {
    documentId: `mileage-${slug(input.siteName)}-${input.monthKey}`,
    margin: MARGIN,
    footerY: FOOTER_Y,
  });
  return doc;
}

/**
 * Yearly mileage tracking sheet PDF (Complyrer's own yearly summary).
 *
 * Rows = individuals, columns = January–December + Yearly Total, with a
 * Grand Total row — the format of the paper yearly summary sheet, stamped
 * with the Complyrer record mark. Only administrators, degreed professional
 * managers, and platform owners may view or download it.
 */

export interface MileageYearPdfInput {
  agencyName: string;
  /** Per-site home name, or "All sites" for the agency-wide view. */
  siteName: string;
  year: number;
  people: MileagePdfPerson[];
  summary: MileageYearlySummary;
  /**
   * Agency-wide mode: maps each individual id to its site name. When present,
   * a shaded site header row is drawn before each site's group; `people`
   * must be ordered site-by-site so the groups stay together.
   */
  siteNameByIndividualId?: Record<string, string>;
}

export function mileageYearFileName(siteName: string, year: number) {
  return `complyrer-mileage-yearly-${slug(siteName)}-${year}.pdf`;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export function buildMileageYearPdf(input: MileageYearPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const lineH = 11;

  // header
  let y = 48;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...EVERGREEN);
  doc.text("COMPLYRER", MARGIN, y);
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(input.agencyName, MARGIN, y + 14);
  y += 34;
  doc.setFontSize(16);
  doc.text("Yearly Mileage Tracking", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Home: ${input.siteName}    Year: ${input.year}`, MARGIN, y + 18);
  y += 34;

  const nameW = 130;
  const totalW = 56;
  const monthW = Math.max(30, (CONTENT_W - nameW - totalW) / 12);
  const columns: Column[] = [
    { key: "name", label: "Individual", width: nameW },
    ...MONTH_SHORT.map((label, i) => ({ key: `m${i}`, label, width: monthW })),
    { key: "total", label: "Yearly Total", width: totalW },
  ];

  function drawRow(
    cells: Record<string, string>,
    opts: { bold?: boolean; fill?: RGB | null } = {},
  ) {
    const fontSize = 7;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    let rowH = fontSize + 7;
    const wrapped = columns.map((col) => {
      const lines = doc.splitTextToSize(cells[col.key] ?? "", col.width - 6);
      rowH = Math.max(rowH, lines.length * lineH + 6);
      return lines as string[];
    });
    if (y + rowH > FOOTER_Y - 12) {
      doc.addPage();
      y = 52;
    }
    let x = MARGIN;
    columns.forEach((col, i) => {
      if (opts.fill) {
        doc.setFillColor(...opts.fill);
        doc.rect(x, y, col.width, rowH, "F");
      }
      doc.setDrawColor(0, 0, 0);
      doc.rect(x, y, col.width, rowH);
      doc.setTextColor(...INK);
      doc.text(wrapped[i], x + 3, y + lineH);
      x += col.width;
    });
    y += rowH;
  }

  drawRow(
    Object.fromEntries(columns.map((c) => [c.key, c.label])),
    { bold: true, fill: HEADER_FILL },
  );

  const rowById = new Map(
    input.summary.rows.map((row) => [row.individualId, row]),
  );

  // Agency-wide mode: one shaded header row per site group, spanning the
  // full table width. Per-site callers omit siteNameByIndividualId and get
  // the flat layout unchanged.
  const groupOf = input.siteNameByIndividualId;
  let lastGroup: string | null = null;
  function drawGroupHeader(label: string) {
    const rowH = 17;
    if (y + rowH > FOOTER_Y - 12) {
      doc.addPage();
      y = 52;
    }
    doc.setFillColor(...GROUP_FILL);
    doc.rect(MARGIN, y, CONTENT_W, rowH, "F");
    doc.setDrawColor(0, 0, 0);
    doc.rect(MARGIN, y, CONTENT_W, rowH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(label, MARGIN + 4, y + 11.5);
    y += rowH;
  }

  for (const person of input.people) {
    if (groupOf) {
      const group = groupOf[person.id] ?? "Unassigned";
      if (group !== lastGroup) {
        lastGroup = group;
        drawGroupHeader(group);
      }
    }
    const row = rowById.get(person.id);
    const cells: Record<string, string> = {
      name: person.name,
      total: String(row?.yearlyTotal ?? 0),
    };
    for (let m = 0; m < 12; m++) {
      const miles = row?.months[m] ?? 0;
      cells[`m${m}`] = miles ? String(miles) : "";
    }
    drawRow(cells);
  }

  const grand: Record<string, string> = { name: "Grand Total", total: String(input.summary.grandTotal.yearlyTotal) };
  for (let m = 0; m < 12; m++) grand[`m${m}`] = String(input.summary.grandTotal.months[m] ?? 0);
  drawRow(grand, { bold: true, fill: HEADER_FILL });

  stampRecordMark(doc, {
    documentId: `mileage-yearly-${slug(input.siteName)}-${input.year}`,
    margin: MARGIN,
    footerY: FOOTER_Y,
  });
  return doc;
}
