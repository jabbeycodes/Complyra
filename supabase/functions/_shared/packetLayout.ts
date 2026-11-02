/**
 * Shared print layout for the guardian packets (Individual Rights packet and
 * the consent choices packet).
 *
 * Both packets print on white paper in black ink: a branded header (agency
 * logo + name at the left, the ComplyRer wordmark at the right, a rule under
 * it), a two-column fact block, headed sections with wrapped body copy at a
 * comfortable measure, drawn checkbox squares for unanswered choices, a
 * bordered "Signatures" box with ruled lines and real signing height, and a
 * footer on every page carrying the Complyrer record mark, the copy version,
 * and "Page X of Y".
 *
 * This module is implementation-agnostic: it drives any object satisfying
 * {@link PacketPdfDocument}. The browser builders pass jsPDF; the public
 * consent-signing edge function passes its server-side jsPDF. Every method
 * used here exists in both renderers, so the client print path and the edge
 * evidence path draw the SAME document.
 *
 * Geometry: A4 portrait, millimetres, origin top-left (jsPDF default).
 */

export interface PacketPdfDocument {
  setFontSize(size: number): unknown;
  setFont(name: string, style: string): unknown;
  setTextColor(r: number, g: number, b: number): unknown;
  setDrawColor(r: number, g: number, b: number): unknown;
  setLineWidth(width: number): unknown;
  text(
    text: string,
    x: number,
    y: number,
    options?: { align?: string },
  ): unknown;
  splitTextToSize(text: string, width: number): string[];
  getTextWidth(text: string): number;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  rect(x: number, y: number, w: number, h: number): unknown;
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): unknown;
  getImageProperties(data: string): { width: number; height: number };
  addPage(): unknown;
  getNumberOfPages(): number;
  setPage(page: number): unknown;
}

export interface PacketBrand {
  /** Agency display name — always printed in the header. */
  agencyName: string;
  /**
   * The agency's logo as a PNG/JPEG data URL, when one is configured.
   * A missing or unreadable logo never fails generation: the header falls
   * back to the agency name alone, silently.
   */
  logoDataUrl?: string | null;
  /** Packet copy version, carried into the footer. */
  copyVersion: string;
}

export interface PacketSignatureValues {
  printedName?: string;
  signature?: string;
  authority?: string;
  authorityOther?: string;
  witness?: string;
  /** The date that belongs on the signature block's Date line, if recorded. */
  signedOn?: string;
}

const PAGE_WIDTH = 210;
const MARGIN = 16;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN; // 194
const CONTENT_WIDTH = CONTENT_RIGHT - MARGIN; // 178
/** Last baseline content may use before the footer band. */
const CONTENT_BOTTOM = 274;
const FOOTER_RULE_Y = 282;
const FOOTER_Y = 288;

const INK: [number, number, number] = [0, 0, 0];
const SOFT_RULE: [number, number, number] = [170, 170, 170];
const LABEL_INK: [number, number, number] = [70, 70, 70];

function imageFormatFor(dataUrl: string): string {
  return /data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';
}

export class PacketLayout {
  private readonly doc: PacketPdfDocument;
  private readonly brand: PacketBrand;
  /** Baseline y for the next block, in millimetres from the page top. */
  y = 0;

  constructor(doc: PacketPdfDocument, brand: PacketBrand) {
    this.doc = doc;
    this.brand = brand;
  }

  /* ------------------------------------------------------------------ */
  /* Header / footer                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Page-one header: agency logo (when configured and readable) with the
   * agency name beside it, the ComplyRer wordmark at the right, and a thin
   * rule underneath. A logo that cannot be embedded falls back to the
   * name-only header — silently, so generation never fails over branding.
   */
  firstPageHeader(): void {
    const doc = this.doc;
    doc.setTextColor(...INK);
    let nameX = MARGIN;
    const logo = this.brand.logoDataUrl;
    if (logo && logo.startsWith('data:image/')) {
      try {
        const props = doc.getImageProperties(logo);
        if (props.width > 0 && props.height > 0) {
          const maxW = 38;
          const maxH = 15;
          const w = Math.min(maxW, maxH * (props.width / props.height));
          const h = w * (props.height / props.width);
          doc.addImage(logo, imageFormatFor(logo), MARGIN, 11, w, h);
          nameX = MARGIN + w + 5;
        }
      } catch {
        // Unreadable logo: name-only header, by design.
        nameX = MARGIN;
      }
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(nameX === MARGIN ? 15 : 13);
    doc.text(this.brand.agencyName, nameX, 21);
    doc.setFontSize(13);
    doc.text('ComplyRer', CONTENT_RIGHT, 21, { align: 'right' });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, 29, CONTENT_RIGHT, 29);
    this.y = 38;
  }

  /** Slim header repeated on later pages. */
  private continuationHeader(): void {
    const doc = this.doc;
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(this.brand.agencyName, MARGIN, 13.5);
    doc.setFont('helvetica', 'bold');
    doc.text('ComplyRer', CONTENT_RIGHT, 13.5, { align: 'right' });
    doc.setDrawColor(...SOFT_RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 16.5, CONTENT_RIGHT, 16.5);
    this.y = 25;
  }

  addPage(): void {
    this.doc.addPage();
    this.continuationHeader();
  }

  /** Start a fresh page (with the slim header) unless `needed` mm remain. */
  ensureSpace(needed: number): void {
    if (this.y + needed > CONTENT_BOTTOM) this.addPage();
  }

  /** Footer pass: record mark + copy version at the left, page count right. */
  stampFooters(): void {
    const doc = this.doc;
    const total = doc.getNumberOfPages();
    for (let page = 1; page <= total; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(...SOFT_RULE);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, FOOTER_RULE_Y, CONTENT_RIGHT, FOOTER_RULE_Y);
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `Digital record generated by Complyrer · ${this.brand.copyVersion}`,
        MARGIN,
        FOOTER_Y,
      );
      doc.text(`Page ${page} of ${total}`, CONTENT_RIGHT, FOOTER_Y, {
        align: 'right',
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Blocks                                                              */
  /* ------------------------------------------------------------------ */

  title(text: string): void {
    const doc = this.doc;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...INK);
    doc.text(text, MARGIN, this.y + 3);
    this.y += 11;
  }

  /**
   * Two-column fact block: bold labels in an aligned column (sized to the
   * widest label), values beside them, wrapping if a value runs long.
   */
  facts(rows: Array<[string, string]>): void {
    const doc = this.doc;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const labelWidth = Math.max(
      ...rows.map(([label]) => doc.getTextWidth(label)),
    );
    const valueX = Math.min(MARGIN + labelWidth + 7, 104);
    const valueWidth = CONTENT_RIGHT - valueX;
    doc.setFontSize(10.5);
    for (const [label, value] of rows) {
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value, valueWidth);
      this.ensureSpace(Math.max(6.4, lines.length * 5.4));
      doc.setFont('helvetica', 'bold');
      doc.text(label, MARGIN, this.y);
      doc.setFont('helvetica', 'normal');
      doc.text(lines[0], valueX, this.y);
      for (let i = 1; i < lines.length; i += 1) {
        this.y += 5.4;
        doc.text(lines[i], valueX, this.y);
      }
      this.y += 6.4;
    }
    this.y += 2.5;
  }

  /** Numbered/bold section heading with a light rule beneath it. */
  sectionHeading(text: string, size = 13): void {
    const doc = this.doc;
    this.ensureSpace(13);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(text, MARGIN, this.y + 2);
    doc.setDrawColor(...SOFT_RULE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, this.y + 4.5, CONTENT_RIGHT, this.y + 4.5);
    this.y += 10;
  }

  /** Bold item label inside a section (no rule). */
  itemHeading(text: string): void {
    const doc = this.doc;
    this.ensureSpace(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    doc.text(text, MARGIN, this.y + 1.5);
    this.y += 7.5;
  }

  /** Wrapped body copy at a comfortable measure, page-break safe per line. */
  body(text: string, size = 10.5): void {
    const doc = this.doc;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text, CONTENT_WIDTH);
    for (const line of lines) {
      this.ensureSpace(5.2);
      doc.text(line, MARGIN, this.y);
      this.y += 5.2;
    }
    this.y += 3;
  }

  /**
   * Drawn checkbox squares with labels, laid out left to right — the paper
   * answer row for a choice that has not been recorded yet.
   */
  choiceBoxes(options: string[]): void {
    const doc = this.doc;
    this.ensureSpace(9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.35);
    const box = 3.8;
    let x = MARGIN;
    const baseline = this.y + 1;
    for (const option of options) {
      doc.rect(x, baseline - box + 0.8, box, box);
      doc.text(option, x + box + 2, baseline);
      x += box + 2 + doc.getTextWidth(option) + 10;
    }
    this.y += 9;
  }

  /* ------------------------------------------------------------------ */
  /* Signature block                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * The delineated signature area: a bordered box headed "Signatures" with
   * ruled lines and generous signing height. Recorded values print on the
   * lines when the signer is known; when `signer` is null every line renders
   * empty, so a blank packet is still a complete signable form.
   */
  signatureBlock(signer: PacketSignatureValues | null): void {
    const doc = this.doc;
    const boxHeight = 74;
    this.ensureSpace(boxHeight + 4);
    const top = this.y;
    const innerX = MARGIN + 5;
    const innerRight = CONTENT_RIGHT - 5;
    const innerWidth = innerRight - innerX;

    doc.setDrawColor(...INK);
    doc.setLineWidth(0.45);
    doc.rect(MARGIN, top, CONTENT_WIDTH, boxHeight);

    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.text('Signatures', innerX, top + 8);
    doc.setDrawColor(...SOFT_RULE);
    doc.setLineWidth(0.3);
    doc.line(innerX, top + 10.5, innerRight, top + 10.5);

    const field = (
      label: string,
      value: string | undefined,
      x: number,
      lineY: number,
      width: number,
      italic = false,
    ) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...LABEL_INK);
      doc.text(label, x, lineY - 4.2);
      if (value) {
        doc.setTextColor(...INK);
        doc.setFont('helvetica', italic ? 'italic' : 'normal');
        doc.setFontSize(11);
        doc.text(value, x, lineY - 0.8);
      }
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.35);
      doc.line(x, lineY, x + width, lineY);
      doc.setTextColor(...INK);
    };

    // Signer printed name, then a tall signature row for real signing room.
    field('Printed name', signer?.printedName, innerX, top + 21, innerWidth);
    field('Signature', signer?.signature, innerX, top + 36, innerWidth, true);

    // Legal authority: recorded value, or the circle-one option row.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...LABEL_INK);
    doc.text('Legal authority', innerX, top + 42.5);
    doc.setTextColor(...INK);
    doc.setFontSize(10.5);
    if (signer?.authority) {
      const other =
        signer.authority === 'Other' && signer.authorityOther
          ? `: ${signer.authorityOther}`
          : '';
      doc.text(`Authority: ${signer.authority}${other}`, innerX, top + 48);
    } else {
      const lead =
        'Authority — circle one:  Self  ·  Parent  ·  Guardian  ·  Medical Power of Attorney  ·  Other:';
      doc.text(lead, innerX, top + 48);
      const otherX = innerX + doc.getTextWidth(lead) + 2.5;
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.35);
      doc.line(otherX, top + 48, Math.min(otherX + 30, innerRight), top + 48);
    }

    // Witness printed name + date side by side, then the witness signature.
    const witnessWidth = 102;
    const dateX = innerX + witnessWidth + 8;
    field('Witness printed name', signer?.witness, innerX, top + 60, witnessWidth);
    field('Date', signer?.signedOn, dateX, top + 60, innerRight - dateX);
    field('Witness signature', undefined, innerX, top + 71, witnessWidth);

    this.y = top + boxHeight + 6;
  }
}
