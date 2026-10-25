import {
  formatGeneratedBy,
  medicaidStatusLabel,
  type Appointment,
} from "../data/appointments";
import type { Medication } from "../data/chart";
import { formatAllergiesLabel, type IndividualProfile } from "../data/planStack";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

const NOT_ON_FILE = "Not on file";

// Content must never fall into the footer band. `stampRecordMark` writes the
// record stamp at y=768 (see brandHeader). PAGE_BOTTOM is the last y a content
// block may occupy; keep-with-next helpers guarantee blocks land above it.
export const CONSULTATION_PAGE_BOTTOM = 740;
export const CONSULTATION_FOOTER_Y = 768;
const PAGE_BOTTOM = CONSULTATION_PAGE_BOTTOM;
const PAGE_TOP = 54;
const CONTENT_WIDTH = 504;
const COLUMN_GUTTER = 16;

function present(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed || NOT_ON_FILE;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

export function consultationPacketFileName(individualName: string, startsOn: string) {
  return `complyrer-consultation-${slug(individualName) || "individual"}-${startsOn}.pdf`;
}

/**
 * True when a block of `blockHeight` fits above the footer band starting at `y`.
 * Exposed for tests so the keep-with-next contract stays honest.
 */
export function consultationBlockFits(y: number, blockHeight: number) {
  return y + blockHeight <= CONSULTATION_PAGE_BOTTOM;
}

/**
 * Keep-with-next primitive: return the y to draw a block of `blockHeight`. When
 * it will not fit above the footer band, report a page break so the caller can
 * add a page and start at the top margin — never splitting a header from its
 * body and never bleeding into the footer stamp.
 */
export function consultationPlaceBlock(
  y: number,
  blockHeight: number,
): { y: number; addedPage: boolean } {
  if (consultationBlockFits(y, blockHeight)) return { y, addedPage: false };
  return { y: PAGE_TOP, addedPage: true };
}

export function buildConsultationPacketPdf(input: {
  agencyName: string;
  individualName: string;
  dateOfBirth: string;
  siteName: string;
  programName: string;
  profile: IndividualProfile;
  appointment: Appointment;
  medications: Pick<Medication, "name" | "strength">[];
  generatedByName: string;
  generatedAt: string;
  logoDataUrl?: string | null;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Consultation", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  }, 54);
  let y = startY;

  // Reserve `blockHeight` for a block that must stay together; add a page when
  // it would collide with the footer band. Returns the y to start drawing at.
  const keepTogether = (blockHeight: number) => {
    const placed = consultationPlaceBlock(y, blockHeight);
    if (placed.addedPage) doc.addPage();
    y = placed.y;
    return y;
  };

  const drawField = (x: number, top: number, label: string, lines: string[]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(95, 81, 69);
    doc.text(label, x, top);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(36, 30, 24);
    doc.text(lines, x, top + 12);
  };

  // One or two short fields laid out in columns. Long values keep the full
  // width by omitting the right field. 16px within a field group.
  const writeRow = (
    left: { label: string; value: string },
    right?: { label: string; value: string },
  ) => {
    const columnWidth = right ? (CONTENT_WIDTH - COLUMN_GUTTER) / 2 : CONTENT_WIDTH;
    const leftLines = doc.splitTextToSize(left.value, columnWidth);
    const rightLines = right ? doc.splitTextToSize(right.value, columnWidth) : [];
    const rowCount = Math.max(leftLines.length, rightLines.length);
    const height = 12 + rowCount * 14 + 8;
    y = keepTogether(height);
    drawField(margin, y, left.label, leftLines);
    if (right) {
      drawField(margin + columnWidth + COLUMN_GUTTER, y, right.label, rightLines);
    }
    y += height;
  };

  const medicalDetail = [input.profile.specializedMedical, input.profile.diagnosis]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  const consultantValue = input.appointment.specialty.trim()
    ? `${input.appointment.consultant} · ${input.appointment.specialty.trim()}`
    : present(input.appointment.consultant);
  const programSite =
    [input.programName, input.siteName].filter((part) => part.trim()).join(" · ") ||
    NOT_ON_FILE;

  // Identity meta first (order follows #81: legal name -> DOB -> DMH ->
  // Medicaid# -> Medicare#; consultation packets never carry a full SSN).
  // Short fields sit side-by-side; long free text keeps the full width.
  writeRow({ label: "Agency", value: input.agencyName });
  writeRow({ label: "Individual", value: input.individualName });
  writeRow(
    { label: "Birth date", value: present(input.dateOfBirth) },
    {
      label: "DMH ID",
      value: input.profile.dmhId.trim() ? input.profile.dmhId.trim() : NOT_ON_FILE,
    },
  );
  writeRow(
    {
      label: "Medicaid status",
      value: medicaidStatusLabel(input.profile.medicaidStatus) || NOT_ON_FILE,
    },
    { label: "Medicaid member number", value: NOT_ON_FILE },
  );
  writeRow(
    { label: "Medicare member number", value: NOT_ON_FILE },
    { label: "Program / site", value: programSite },
  );
  writeRow(
    {
      label: "Appointment date",
      value: formatPacketDate(input.appointment.startsOn),
    },
    {
      label: "Appointment time",
      value: `${formatPacketTime(input.appointment.startTime)}–${formatPacketTime(input.appointment.endTime)} · ${present(input.appointment.timezone)}`,
    },
  );
  writeRow({ label: "Consultant", value: consultantValue });
  writeRow({ label: "Reason for appointment", value: present(input.appointment.reason) });
  writeRow({
    label: "Address of visit",
    value: present(input.appointment.visitAddress || input.profile.address),
  });
  writeRow({ label: "Other medical information", value: present(medicalDetail) });
  writeRow({ label: "Dietary guidelines", value: present(input.profile.specializedDiet) });
  writeRow({
    label: "Allergies",
    value: present(formatAllergiesLabel(input.profile.allergies)),
  });

  y += 8;
  y = ensureSpace(doc, y, 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 70, 48);
  doc.text("Current medications", margin, y);
  y += 16;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  const note = doc.splitTextToSize(
    "Name and strength come from this chart. Indication, instructions, give amount, frequency, dates, and prescriber are not stored yet — those cells are left blank on purpose.",
    CONTENT_WIDTH,
  );
  doc.text(note, margin, y);
  y += note.length * 11 + 10;

  const columns = [
    { label: "Name", width: 118 },
    { label: "Strength", width: 72 },
    { label: "Indication", width: 78 },
    { label: "Instructions", width: 86 },
    { label: "Amount", width: 70 },
    { label: "Frequency", width: 80 },
  ];

  y = drawMedHeader(doc, margin, y, columns);
  if (input.medications.length === 0) {
    y = ensureSpace(doc, y, 22);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(95, 81, 69);
    doc.text("No medications on this chart.", margin + 4, y + 12);
    y += 22;
  } else {
    for (const med of input.medications) {
      y = drawMedRow(doc, margin, y, columns, [
        present(med.name),
        present(med.strength),
        NOT_ON_FILE,
        NOT_ON_FILE,
        NOT_ON_FILE,
        NOT_ON_FILE,
      ]);
    }
  }

  // Writable clinical sections — the consultant completes these on paper or on
  // screen after the visit. 24px between major sections.
  y += 24;
  y = drawWriteInSection(doc, margin, keepTogether, "Findings / Recommendations", 5);

  y += 20;
  y = drawWriteInSection(doc, margin, keepTogether, "Comments / Notes", 4);

  y += 20;
  y = drawFollowUpSection(doc, margin, keepTogether);

  y += 20;
  y = drawSignatureSection(doc, margin, keepTogether);

  y += 16;
  y = ensureSpace(doc, y, 28);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text(formatGeneratedBy(input.generatedByName, input.generatedAt), margin, y);

  stampRecordMark(doc, { margin, footerY: CONSULTATION_FOOTER_Y });
  return doc;
}

type KeepTogether = (blockHeight: number) => number;

const WRITE_IN_LINE_GAP = 22;

function sectionHeader(doc: import("jspdf").jsPDF, margin: number, y: number, label: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(47, 70, 48);
  doc.text(label, margin, y);
  return y + 18;
}

function drawRuledLines(
  doc: import("jspdf").jsPDF,
  margin: number,
  y: number,
  lineCount: number,
  { indent = 0, width = CONTENT_WIDTH }: { indent?: number; width?: number } = {},
) {
  doc.setDrawColor(206, 196, 182);
  doc.setLineWidth(0.5);
  let lineY = y;
  for (let i = 0; i < lineCount; i++) {
    lineY += WRITE_IN_LINE_GAP;
    doc.line(margin + indent, lineY, margin + indent + width, lineY);
  }
  return lineY + 6;
}

/**
 * Bold section header over ruled write-in lines. The whole block is kept
 * together so a header never orphans from its first line across a page break.
 */
function drawWriteInSection(
  doc: import("jspdf").jsPDF,
  margin: number,
  keepTogether: KeepTogether,
  label: string,
  lineCount: number,
) {
  const blockHeight = 18 + lineCount * WRITE_IN_LINE_GAP + 6;
  let y = keepTogether(blockHeight);
  y = sectionHeader(doc, margin, y, label);
  y = drawRuledLines(doc, margin, y, lineCount);
  return y;
}

/**
 * "Follow-Up Required?" with Yes / No checkboxes and, indented beneath, the
 * conditional Follow-Up Date / Appointment Details lines. Kept together so the
 * conditional never orphans onto a near-empty page.
 */
function drawFollowUpSection(
  doc: import("jspdf").jsPDF,
  margin: number,
  keepTogether: KeepTogether,
) {
  const indent = 18;
  const blockHeight =
    18 /* header */ +
    22 /* yes/no row */ +
    16 /* conditional caption */ +
    12 /* date field label */ +
    WRITE_IN_LINE_GAP /* date line */ +
    12 /* details label */ +
    WRITE_IN_LINE_GAP * 2 /* details lines */ +
    12;
  let y = keepTogether(blockHeight);
  y = sectionHeader(doc, margin, y, "Follow-Up Required?");

  drawCheckbox(doc, margin, y);
  labelText(doc, margin + 18, y, "Yes");
  drawCheckbox(doc, margin + 92, y);
  labelText(doc, margin + 110, y, "No");
  y += 22;

  // Conditional block, visually indented under Follow-Up.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text("If yes, complete the follow-up details below:", margin + indent, y);
  y += 14;

  y = drawInlineLabeledLine(doc, margin, y, "Follow-Up Date", { indent });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text("Appointment Details", margin + indent, y);
  y = drawRuledLines(doc, margin, y, 2, {
    indent,
    width: CONTENT_WIDTH - indent,
  });
  return y;
}

/**
 * Consultant signature + date completion area with labeled lines.
 */
function drawSignatureSection(
  doc: import("jspdf").jsPDF,
  margin: number,
  keepTogether: KeepTogether,
) {
  const blockHeight = 18 + WRITE_IN_LINE_GAP + 14;
  let y = keepTogether(blockHeight);
  y = sectionHeader(doc, margin, y, "Consultant signature");
  const signatureWidth = 300;
  const dateX = margin + signatureWidth + COLUMN_GUTTER;
  const dateWidth = CONTENT_WIDTH - signatureWidth - COLUMN_GUTTER;
  const lineY = y + WRITE_IN_LINE_GAP;
  doc.setDrawColor(206, 196, 182);
  doc.setLineWidth(0.5);
  doc.line(margin, lineY, margin + signatureWidth, lineY);
  doc.line(dateX, lineY, dateX + dateWidth, lineY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text("Signature", margin, lineY + 12);
  doc.text("Date", dateX, lineY + 12);
  doc.setTextColor(36, 30, 24);
  return lineY + 14;
}

function drawInlineLabeledLine(
  doc: import("jspdf").jsPDF,
  margin: number,
  y: number,
  label: string,
  { indent = 0 }: { indent?: number } = {},
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text(label, margin + indent, y);
  const labelWidth = doc.getTextWidth(label);
  const lineStart = margin + indent + labelWidth + 8;
  const lineY = y + 2;
  doc.setDrawColor(206, 196, 182);
  doc.setLineWidth(0.5);
  doc.line(lineStart, lineY, margin + CONTENT_WIDTH, lineY);
  return y + WRITE_IN_LINE_GAP;
}

function drawCheckbox(doc: import("jspdf").jsPDF, x: number, y: number, size = 12) {
  doc.setDrawColor(95, 81, 69);
  doc.setLineWidth(0.9);
  doc.rect(x, y - size + 2, size, size);
}

function labelText(doc: import("jspdf").jsPDF, x: number, y: number, text: string) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(36, 30, 24);
  doc.text(text, x, y);
}

function formatPacketDate(isoDate: string) {
  const parsed = Date.parse(`${isoDate}T12:00:00`);
  if (!Number.isFinite(parsed)) return present(isoDate);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatPacketTime(value: string) {
  const [hoursRaw, minutes] = value.split(":");
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || !minutes) return present(value);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutes} ${suffix}`;
}

function ensureSpace(doc: import("jspdf").jsPDF, y: number, needed: number) {
  if (y + needed <= PAGE_BOTTOM) return y;
  doc.addPage();
  return PAGE_TOP;
}

function drawMedHeader(
  doc: import("jspdf").jsPDF,
  margin: number,
  y: number,
  columns: { label: string; width: number }[],
) {
  y = ensureSpace(doc, y, 22);
  doc.setFillColor(232, 224, 212);
  doc.rect(margin, y, 504, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(47, 70, 48);
  let x = margin + 4;
  for (const column of columns) {
    doc.text(column.label, x, y + 12);
    x += column.width;
  }
  return y + 18;
}

function drawMedRow(
  doc: import("jspdf").jsPDF,
  margin: number,
  y: number,
  columns: { label: string; width: number }[],
  values: string[],
) {
  const wrapped = values.map((value, index) =>
    doc.splitTextToSize(value, columns[index].width - 8),
  );
  const rowHeight = Math.max(18, ...wrapped.map((lines) => lines.length * 11 + 8));
  y = ensureSpace(doc, y, rowHeight);
  doc.setDrawColor(232, 224, 212);
  doc.rect(margin, y, 504, rowHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(36, 30, 24);
  let x = margin + 4;
  wrapped.forEach((lines, index) => {
    doc.text(lines, x, y + 12);
    x += columns[index].width;
  });
  return y + rowHeight;
}
