/**
 * Clinician report. The printed packet follows the Therap table: a program
 * header, then one bordered block per Shift note with begin, end, duration,
 * location, provider, task scores, and a comment. Notes that overlap in time
 * each keep their own block.
 */
import type { jsPDF } from "jspdf";
import {
  clinicianProvider,
  clinicianTimes,
  formatTherapDate,
  noteBeginMinutes,
  type ShiftNoteView,
} from "../data/shiftNotes";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

const PAGE_BOTTOM = 750;

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

export function shiftNotesFileName(individualName: string, from: string, to: string) {
  return `complyrer-isp-notes-${slug(individualName) || "individual"}-${from}-to-${to}.pdf`;
}

type Cell = { text: string; width: number; header?: boolean };

function rowHeight(doc: jsPDF, cells: Cell[]): { height: number; lines: string[][] } {
  doc.setFontSize(8);
  let height = 16;
  const lines = cells.map((cell) => {
    doc.setFont("helvetica", cell.header ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(cell.text || " ", Math.max(8, cell.width - 8)) as string[];
    height = Math.max(height, wrapped.length * 10 + 8);
    return wrapped;
  });
  return { height, lines };
}

function paintRow(
  doc: jsPDF,
  x: number,
  y: number,
  cells: Cell[],
  margin: number,
): number {
  const measured = rowHeight(doc, cells);
  let top = y;
  if (top + measured.height > PAGE_BOTTOM) {
    doc.addPage();
    top = margin;
  }
  let cursor = x;
  cells.forEach((cell, index) => {
    if (cell.header) {
      doc.setFillColor(236, 236, 236);
      doc.rect(cursor, top, cell.width, measured.height, "F");
    }
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.4);
    doc.rect(cursor, top, cell.width, measured.height);
    doc.setFont("helvetica", cell.header ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(20, 20, 20);
    doc.text(measured.lines[index], cursor + 4, top + 11);
    cursor += cell.width;
  });
  return top + measured.height;
}

function paintSignature(
  doc: jsPDF,
  x: number,
  y: number,
  note: ShiftNoteView,
  margin: number,
  width: number,
): number {
  const signed = note.signatureDataUrl?.startsWith("data:image/png;base64,") ?? false;
  const height = signed ? 52 : 18;
  let top = y;
  if (top + height > PAGE_BOTTOM) {
    doc.addPage();
    top = margin;
  }
  const labelWidth = 148;
  doc.setFillColor(236, 236, 236);
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.4);
  doc.rect(x, top, labelWidth, height, "F");
  doc.rect(x, top, labelWidth, height);
  doc.rect(x + labelWidth, top, width - labelWidth, height);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  doc.text("Signature", x + 4, top + 12);
  doc.setFont("helvetica", "normal");
  const provider = clinicianProvider(note) || "—";
  if (signed && note.signatureDataUrl) {
    doc.text(provider, x + labelWidth + 4, top + 12);
    try {
      doc.addImage(note.signatureDataUrl, "PNG", x + labelWidth + 4, top + 16, 90, 28);
    } catch {
      doc.text("Signature not on this note", x + labelWidth + 4, top + 28);
    }
  } else {
    doc.text(`${provider} · Signature not on this note`, x + labelWidth + 4, top + 12);
  }
  return top + height;
}

function titleBar(doc: jsPDF, text: string, x: number, y: number, width: number, margin: number) {
  let top = y;
  if (top + 18 > PAGE_BOTTOM) {
    doc.addPage();
    top = margin;
  }
  doc.setFillColor(232, 232, 232);
  doc.setDrawColor(60, 60, 60);
  doc.rect(x, top, width, 18, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  doc.text(text, x + width / 2, top + 13, { align: "center" });
  return top + 18;
}

export function buildShiftNotesPdf(input: {
  agencyName: string;
  individualName: string;
  siteName: string;
  programName: string;
  from: string;
  to: string;
  notes: ShiftNoteView[];
  /** level id -> short label and caption, from the program's scoring method. */
  levelLabels: Record<string, { shortLabel: string; caption: string }>;
  generatedByName: string;
  generatedAt: string;
  logoDataUrl?: string | null;
  reportDescription?: string;
  timeZone?: string;
  programId?: string;
  programStatus?: string;
  scheduleLabel?: string;
  frequency?: number | null;
  scoringMethodName?: string;
  goalService?: string;
  completionCriteria?: string;
  scheduleComment?: string;
  /** Stored date of birth. A missing date is printed as not on file. */
  dateOfBirth?: string;
}) {
  const margin = 36;
  const { doc, y: startY } = startBrandedDoc("Clinician Report", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  }, margin);
  const width = 612 - margin * 2;
  const labelWidth = 148;
  const valueWidth = width - labelWidth;
  let y = startY + 4;

  const meta = (label: string, value: string) => {
    y = paintRow(doc, margin, y, [
      { text: label, width: labelWidth, header: true },
      { text: value || " ", width: valueWidth },
    ], margin);
  };

  meta("Report Description", input.reportDescription?.trim() || input.programName || "Shift notes");
  meta("Individual Name", input.individualName);
  meta("Date of Birth", input.dateOfBirth ? formatTherapDate(input.dateOfBirth) : "Not on file");
  meta("Date Range", `${formatTherapDate(input.from)} - ${formatTherapDate(input.to)}`);
  y += 10;
  y = titleBar(doc, input.programName || "ISP program", margin, y, width, margin);
  meta("Form ID", input.programId || " ");
  meta("Status", input.programStatus || " ");
  meta("Time Zone", input.timeZone || "US/Central");
  meta("ISP Program", input.programName || " ");
  meta("Scoring Method", input.scoringMethodName || input.notes[0]?.scoringMethodName || " ");
  meta("Frequency", input.frequency == null ? " " : String(input.frequency));
  meta("Schedule", input.scheduleLabel || " ");
  meta("Schedule and Frequency Comment", input.scheduleComment?.trim() || " ");
  meta("Goal/Service", input.goalService?.trim() || " ");
  meta("Criteria for Completion", input.completionCriteria?.trim() || " ");
  y += 12;

  const notes = [...input.notes].sort((a, b) => {
    const byDate = a.noteDate.localeCompare(b.noteDate);
    if (byDate !== 0) return byDate;
    const byBegin = noteBeginMinutes(a) - noteBeginMinutes(b);
    return byBegin || a.createdAt.localeCompare(b.createdAt);
  });
  if (notes.length === 0) {
    meta("Notes", "No shift notes in this window.");
  }

  const quarter = width / 4;
  const taskWidths = [width * 0.34, width * 0.12, width * 0.54];

  for (const note of notes) {
    const times = clinicianTimes(note);
    const place = note.location?.trim() || input.siteName;
    y += 8;
    y = paintRow(doc, margin, y, [
      { text: `Date:  ${formatTherapDate(note.noteDate)}`, width: quarter },
      { text: `Begin Time:  ${times.beginLabel || "—"}`, width: quarter },
      { text: `End Time:  ${times.endLabel || "—"}`, width: quarter },
      { text: `Duration (hh:mm):  ${times.durationLabel || "—"}`, width: quarter },
    ], margin);
    y = paintRow(doc, margin, y, [
      { text: `Location:  ${place}`, width: width * 0.4 },
      { text: `Service Provider:  ${clinicianProvider(note) || "—"}`, width: width * 0.6 },
    ], margin);
    y = paintRow(doc, margin, y, [
      { text: "Task", width: taskWidths[0], header: true },
      { text: "Score", width: taskWidths[1], header: true },
      { text: "Scoring Comments", width: taskWidths[2], header: true },
    ], margin);
    if (note.scores.length === 0) {
      y = paintRow(doc, margin, y, [
        { text: "No task scores on this note.", width: taskWidths[0] },
        { text: " ", width: taskWidths[1] },
        { text: " ", width: taskWidths[2] },
      ], margin);
    }
    for (const score of note.scores) {
      const level = input.levelLabels[score.levelId];
      y = paintRow(doc, margin, y, [
        { text: score.taskTitle || "Task", width: taskWidths[0] },
        { text: level?.caption || level?.shortLabel || "Scored", width: taskWidths[1] },
        { text: score.comment.trim() || " ", width: taskWidths[2] },
      ], margin);
    }
    y = paintRow(doc, margin, y, [
      { text: "Progress note:", width: 90, header: true },
      { text: note.summary.trim() || " ", width: width - 90 },
    ], margin);
    y = paintRow(doc, margin, y, [
      { text: "Waiver service:", width: 90, header: true },
      { text: note.waiverService?.trim() || " ", width: width - 90 },
    ], margin);
    y = paintSignature(doc, margin, y, note, margin, width);
  }

  y += 16;
  if (y + 20 > PAGE_BOTTOM) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(`${input.siteName} · Generated by ${input.generatedByName}`, margin, y);

  stampRecordMark(doc, {
    documentId: `isp-notes-${slug(input.individualName)}-${input.from}`,
    generatedAt: input.generatedAt,
    margin,
  });
  return doc;
}
