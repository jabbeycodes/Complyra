/**
 * Shared PDF layout helpers.
 *
 * Every generated document under `src/pdf/` should compose its structure from
 * these primitives instead of scattering magic numbers (page-bottom thresholds,
 * rule colors, checkbox sizes, section spacing) across each builder. The goals,
 * from issue #110 Cut B, are consistent margins, aligned tables, page-break
 * hygiene (no section header orphaned from its first line, no content bleeding
 * into the footer band), and reusable signature / write-in areas.
 *
 * The defaults mirror the consultation packet layout locked in Cut A
 * (`consultationPacketPdf.ts`): footer band at y=768, last content y at 740,
 * earthy palette, 22pt ruled-line gap, 12pt checkboxes. That keeps these helpers
 * backward-compatible with the consultation packet whether it lands before or
 * after this change — a builder can adopt them without shifting its output.
 *
 * Palette is always parameterized (earthy defaults) so builders that print
 * black-on-white tables (mileage, QA audit) keep their own colors: this is a
 * layout pass, not a color/type redesign.
 */
import type { jsPDF } from "jspdf";

export type RGB = [number, number, number];

/* -------------------------------------------------------------------------- */
/* Palette — earthy defaults shared with brandHeader + the consultation packet */
/* -------------------------------------------------------------------------- */

/** Body text. */
export const INK: RGB = [36, 30, 24];
/** Section headers / brand green. */
export const EVERGREEN: RGB = [47, 70, 48];
/** Secondary labels, captions. */
export const MUTED: RGB = [95, 81, 69];
/** Ruled write-in / signature lines. */
export const RULE: RGB = [206, 196, 182];
/** Table header fill. */
export const TABLE_HEADER_FILL: RGB = [232, 224, 212];

/* -------------------------------------------------------------------------- */
/* Page geometry — US Letter, points                                          */
/* -------------------------------------------------------------------------- */

export const LETTER_WIDTH = 612;
export const LETTER_HEIGHT = 792;

/** Minimum letter margin required by #110 acceptance (≥48pt). */
export const DEFAULT_MARGIN = 48;

/**
 * `stampRecordMark` writes the footer stamp at y=768 on portrait letter. No
 * content block may occupy this band; keep-with-next helpers guarantee blocks
 * land above `PAGE_BOTTOM`.
 */
export const FOOTER_BAND_Y = 768;

/** Last y a content block may occupy on portrait letter before the footer band. */
export const PAGE_BOTTOM = 740;

/** Y to resume at on a fresh page (below the top margin, leaves breathing room). */
export const PAGE_TOP = 64;

/** Standard ruled write-in line gap (matches the consultation packet). */
export const WRITE_IN_LINE_GAP = 22;

export interface FlowOptions {
  /** Last usable y before the footer band. Defaults to {@link PAGE_BOTTOM}. */
  pageBottom?: number;
  /** Y to resume at after a page break. Defaults to {@link PAGE_TOP}. */
  pageTop?: number;
}

/* -------------------------------------------------------------------------- */
/* Page-break hygiene                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Decide where a block of `blockHeight` should be drawn so it never bleeds into
 * the footer band. Pure (no mutation) so page-break behavior can be unit
 * tested. When the block fits, returns the same `y`; otherwise reports a page
 * break and the top-of-page `y`.
 */
export function placeBlock(
  y: number,
  blockHeight: number,
  opts: FlowOptions = {},
): { y: number; addedPage: boolean } {
  const pageBottom = opts.pageBottom ?? PAGE_BOTTOM;
  const pageTop = opts.pageTop ?? PAGE_TOP;
  if (y + blockHeight <= pageBottom) return { y, addedPage: false };
  return { y: pageTop, addedPage: true };
}

/**
 * True when a block of `blockHeight` fits above the footer band starting at `y`.
 * Exposed so the keep-with-next contract can be asserted in tests.
 */
export function blockFits(
  y: number,
  blockHeight: number,
  opts: FlowOptions = {},
): boolean {
  return y + blockHeight <= (opts.pageBottom ?? PAGE_BOTTOM);
}

/**
 * Keep-with-next primitive. Reserve `blockHeight` for a block that must stay
 * together (e.g. a section header plus its first line); adds a page when the
 * block would collide with the footer band, and returns the y to start drawing
 * at. Mutates the document (may call `addPage`).
 */
export function reserve(
  doc: jsPDF,
  y: number,
  blockHeight: number,
  opts: FlowOptions = {},
): number {
  const placed = placeBlock(y, blockHeight, opts);
  if (placed.addedPage) doc.addPage();
  return placed.y;
}

/* -------------------------------------------------------------------------- */
/* Section headers                                                            */
/* -------------------------------------------------------------------------- */

export interface SectionHeaderOptions extends FlowOptions {
  margin?: number;
  color?: RGB;
  fontSize?: number;
  /** Draw a full-width rule under the header. */
  rule?: boolean;
  ruleColor?: RGB;
  ruleWidth?: number;
  /** Gap between the header baseline and the rule. */
  ruleGap?: number;
  /** Gap after the header (or rule) before the next content. */
  gapAfter?: number;
  /**
   * Height of the block that must stay with the header (its first line). The
   * header will move to the next page rather than orphan above this much
   * content. Defaults to a single body line.
   */
  keepWith?: number;
}

/**
 * Bold section header, optionally over a full-width rule. The header is kept
 * with `keepWith` points of following content so it never orphans at the foot
 * of a page. Returns the y after the header block.
 */
export function drawSectionHeader(
  doc: jsPDF,
  y: number,
  label: string,
  opts: SectionHeaderOptions = {},
): number {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const color = opts.color ?? EVERGREEN;
  const fontSize = opts.fontSize ?? 12;
  const gapAfter = opts.gapAfter ?? 16;
  const keepWith = opts.keepWith ?? 18;
  const ruleGap = opts.ruleGap ?? 6;
  const headerHeight = fontSize + (opts.rule ? ruleGap + 2 : 0) + gapAfter;

  y = reserve(doc, y, headerHeight + keepWith, opts);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);
  doc.text(label, margin, y);
  let next = y + fontSize;
  if (opts.rule) {
    const ruleY = next + ruleGap - fontSize + 6;
    doc.setDrawColor(...(opts.ruleColor ?? color));
    doc.setLineWidth(opts.ruleWidth ?? 0.75);
    doc.line(margin, ruleY, margin + contentWidth(margin), ruleY);
    next = ruleY;
  }
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  return next + gapAfter;
}

/** Content width for a given margin on portrait letter. */
export function contentWidth(margin: number = DEFAULT_MARGIN): number {
  return LETTER_WIDTH - margin * 2;
}

/* -------------------------------------------------------------------------- */
/* Ruled write-in areas                                                       */
/* -------------------------------------------------------------------------- */

export interface RuledLinesOptions {
  gap?: number;
  width?: number;
  color?: RGB;
  lineWidth?: number;
}

/**
 * Draw `count` evenly spaced ruled write-in lines starting below `y`. Returns
 * the y after the block. Used for Findings / Comments-style blank areas.
 */
export function drawRuledLines(
  doc: jsPDF,
  x: number,
  y: number,
  count: number,
  opts: RuledLinesOptions = {},
): number {
  const gap = opts.gap ?? WRITE_IN_LINE_GAP;
  const width = opts.width ?? contentWidth();
  doc.setDrawColor(...(opts.color ?? RULE));
  doc.setLineWidth(opts.lineWidth ?? 0.5);
  let lineY = y;
  for (let i = 0; i < count; i++) {
    lineY += gap;
    doc.line(x, lineY, x + width, lineY);
  }
  return lineY + 6;
}

/**
 * Bold section header over ruled write-in lines, kept together so the header
 * never orphans from its lines. Returns the y after the block.
 */
export function drawWriteInSection(
  doc: jsPDF,
  y: number,
  label: string,
  lineCount: number,
  opts: SectionHeaderOptions & RuledLinesOptions & { margin?: number } = {},
): number {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const gap = opts.gap ?? WRITE_IN_LINE_GAP;
  const blockHeight = 18 + lineCount * gap + 6;
  y = reserve(doc, y, blockHeight, opts);
  y = drawSectionHeader(doc, y, label, { ...opts, margin, keepWith: gap });
  return drawRuledLines(doc, margin, y - 6, lineCount, opts);
}

/* -------------------------------------------------------------------------- */
/* Checkboxes                                                                 */
/* -------------------------------------------------------------------------- */

export interface CheckboxOptions {
  size?: number;
  color?: RGB;
  lineWidth?: number;
  checked?: boolean;
}

/** A single square checkbox with its baseline aligned to text at `y`. */
export function drawCheckbox(
  doc: jsPDF,
  x: number,
  y: number,
  opts: CheckboxOptions = {},
): void {
  const size = opts.size ?? 12;
  doc.setDrawColor(...(opts.color ?? MUTED));
  doc.setLineWidth(opts.lineWidth ?? 0.9);
  doc.rect(x, y - size + 2, size, size);
  if (opts.checked) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? EVERGREEN));
    doc.text("X", x + 2.5, y);
    doc.setTextColor(...INK);
  }
}

export interface CheckboxRowOptions extends CheckboxOptions {
  margin?: number;
  /** Horizontal gap between an option group and the next box. */
  optionGap?: number;
  /** Gap between a checkbox and its label. */
  labelGap?: number;
  labelColor?: RGB;
  labelFontSize?: number;
  /** Which options are checked (by index). */
  checkedIndexes?: number[];
}

/**
 * A row of labeled checkboxes (e.g. Yes / No). Returns the y after the row.
 */
export function drawCheckboxRow(
  doc: jsPDF,
  x: number,
  y: number,
  options: string[],
  opts: CheckboxRowOptions = {},
): number {
  const size = opts.size ?? 12;
  const labelGap = opts.labelGap ?? 6;
  const optionGap = opts.optionGap ?? 40;
  const labelColor = opts.labelColor ?? INK;
  const labelFontSize = opts.labelFontSize ?? 11;
  const checked = new Set(opts.checkedIndexes ?? []);
  let cursor = x;
  options.forEach((label, index) => {
    drawCheckbox(doc, cursor, y, { ...opts, checked: checked.has(index) });
    cursor += size + labelGap;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(labelFontSize);
    doc.setTextColor(...labelColor);
    doc.text(label, cursor, y);
    cursor += doc.getTextWidth(label) + optionGap;
  });
  doc.setTextColor(...INK);
  return y + size + 6;
}

/* -------------------------------------------------------------------------- */
/* Signature / completion areas                                               */
/* -------------------------------------------------------------------------- */

export interface SignatureField {
  label: string;
  /** Column width in points. */
  width: number;
  /** Optional pre-filled value written in italic above the line. */
  value?: string;
}

export interface SignatureAreaOptions extends FlowOptions {
  margin?: number;
  gutter?: number;
  lineColor?: RGB;
  labelColor?: RGB;
  /** Vertical space reserved above the signature line for a written mark. */
  lineOffset?: number;
}

/**
 * A row of labeled signature / date lines (e.g. Signature | Date). Reserves the
 * whole row so it never splits across a page break. Returns the y after the
 * block.
 */
export function drawSignatureRow(
  doc: jsPDF,
  y: number,
  fields: SignatureField[],
  opts: SignatureAreaOptions = {},
): number {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const gutter = opts.gutter ?? 16;
  const lineOffset = opts.lineOffset ?? WRITE_IN_LINE_GAP;
  const blockHeight = lineOffset + 16;
  y = reserve(doc, y, blockHeight, opts);
  const lineY = y + lineOffset;
  let x = margin;
  for (const field of fields) {
    if (field.value) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(11);
      doc.setTextColor(...INK);
      doc.text(field.value, x + 2, lineY - 4, { maxWidth: field.width - 4 });
    }
    doc.setDrawColor(...(opts.lineColor ?? RULE));
    doc.setLineWidth(0.5);
    doc.line(x, lineY, x + field.width, lineY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(opts.labelColor ?? MUTED));
    doc.text(field.label, x, lineY + 12);
    x += field.width + gutter;
  }
  doc.setTextColor(...INK);
  return lineY + 16;
}

/* -------------------------------------------------------------------------- */
/* Tables — header repeats on every page, rows never enter the footer band     */
/* -------------------------------------------------------------------------- */

export interface TableColumn {
  label: string;
  width: number;
  align?: "left" | "right";
}

export interface TableOptions extends FlowOptions {
  margin?: number;
  /** Left edge of the table. Defaults to `margin`. */
  x?: number;
  fontSize?: number;
  headerFontSize?: number;
  lineHeight?: number;
  cellPadding?: number;
  headerHeight?: number;
  headerFill?: RGB | null;
  headerTextColor?: RGB;
  borderColor?: RGB | null;
  textColor?: RGB;
  /** Minimum body row height. */
  minRowHeight?: number;
  /** Draw vertical separators between columns (full grid) rather than just an outer box. */
  grid?: boolean;
}

function drawColumnBorders(
  doc: jsPDF,
  x: number,
  y: number,
  height: number,
  columns: TableColumn[],
) {
  let cx = x;
  for (const col of columns) {
    doc.rect(cx, y, col.width, height);
    cx += col.width;
  }
}

function tableTotalWidth(columns: TableColumn[]): number {
  return columns.reduce((sum, col) => sum + col.width, 0);
}

/** Draw a table header band. Returns the y after the header. */
export function drawTableHeader(
  doc: jsPDF,
  x: number,
  y: number,
  columns: TableColumn[],
  opts: TableOptions = {},
): number {
  const headerHeight = opts.headerHeight ?? 18;
  const padding = opts.cellPadding ?? 4;
  const totalWidth = tableTotalWidth(columns);
  if (opts.headerFill) {
    doc.setFillColor(...opts.headerFill);
    doc.rect(x, y, totalWidth, headerHeight, "F");
  }
  if (opts.borderColor) {
    doc.setDrawColor(...opts.borderColor);
    doc.setLineWidth(0.5);
    if (opts.grid) {
      drawColumnBorders(doc, x, y, headerHeight, columns);
    } else {
      doc.rect(x, y, totalWidth, headerHeight);
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(opts.headerFontSize ?? 8);
  doc.setTextColor(...(opts.headerTextColor ?? EVERGREEN));
  let cx = x;
  for (const col of columns) {
    const align = col.align ?? "left";
    const tx = align === "right" ? cx + col.width - padding : cx + padding;
    doc.text(col.label, tx, y + headerHeight - 6, { align });
    cx += col.width;
  }
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  return y + headerHeight;
}

/**
 * Render a full table with automatic pagination: the header band is redrawn at
 * the top of every continuation page, and no row is split into the footer band.
 * Returns the y after the last row.
 */
export function renderTable(
  doc: jsPDF,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  opts: TableOptions = {},
): number {
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const x = opts.x ?? margin;
  const padding = opts.cellPadding ?? 4;
  const lineHeight = opts.lineHeight ?? 11;
  const fontSize = opts.fontSize ?? 8;
  const minRowHeight = opts.minRowHeight ?? 18;
  const totalWidth = tableTotalWidth(columns);

  let y = drawTableHeader(doc, x, startY, columns, opts);

  for (const row of rows) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    const wrapped = columns.map((col, i) =>
      doc.splitTextToSize(row[i] ?? "", col.width - padding * 2),
    );
    const rowHeight = Math.max(
      minRowHeight,
      ...wrapped.map((lines) => lines.length * lineHeight + 8),
    );
    // Keep the row whole and redraw the header when it wraps to a new page.
    if (!blockFits(y, rowHeight, opts)) {
      doc.addPage();
      y = drawTableHeader(doc, x, opts.pageTop ?? PAGE_TOP, columns, opts);
    }
    if (opts.borderColor) {
      doc.setDrawColor(...opts.borderColor);
      doc.setLineWidth(0.5);
      if (opts.grid) {
        drawColumnBorders(doc, x, y, rowHeight, columns);
      } else {
        doc.rect(x, y, totalWidth, rowHeight);
      }
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(...(opts.textColor ?? INK));
    let cx = x;
    wrapped.forEach((lines, i) => {
      const col = columns[i];
      const align = col.align ?? "left";
      const tx = align === "right" ? cx + col.width - padding : cx + padding;
      doc.text(lines, tx, y + lineHeight + 1, { align });
      cx += col.width;
    });
    y += rowHeight;
  }
  doc.setTextColor(...INK);
  return y;
}
