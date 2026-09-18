/**
 * Issue #96 — Monthly shift notes report PDF.
 *
 * Complyrer's own layout (not a replica of any third-party form): branded
 * header, report header block, ISP program block with numbered objectives,
 * day grid (days 1..N as columns, one row per objective, score + staff
 * initials per cell), staff signature log, and the manager's monthly summary
 * with signature. Landscape letter so the 31-day grid stays readable.
 *
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */
import { jsPDF } from "jspdf";
import { stampRecordMark } from "./brandHeader";
import { imageFormatFromDataUrl } from "../data/branding";

export interface MonthlyReportPdfTask {
  title: string;
  instructions: string;
}

export interface MonthlyReportPdfSignature {
  name: string;
  initials: string;
  title: string;
}

export interface MonthlyReportPdfWeeklyWeek {
  /** e.g. "Week 1 (1–7)"; "" when the week has no days in the month. */
  label: string;
  yes: number;
  no: number;
  refused: number;
  other: number;
}

export interface MonthlyReportPdfWeeklyTask {
  taskNumber: number;
  title: string;
  /** Weeks 1–5. */
  weeks: MonthlyReportPdfWeeklyWeek[];
}

export interface MonthlyReportPdfSummary {
  narrative: string;
  signedByName: string;
  signedByTitle: string;
  signedAt: string;
}

export interface MonthlyReportPdfScObjective {
  taskNumber: number;
  title: string;
  /** e.g. "Objective 1: 4 of 5 scored Yes (80%) — On track". */
  progressLine: string;
  narrative: string;
}

export interface MonthlyReportPdfScSignature {
  role: string;
  name: string;
  date: string;
}

export interface MonthlyReportPdfScSummary {
  objectives: MonthlyReportPdfScObjective[];
  overallNarrative: string;
  signatures: MonthlyReportPdfScSignature[];
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}

export function shiftNoteMonthlyReportFileName(personName: string, monthKey: string) {
  return `complyrer-shift-notes-monthly-report-${slug(personName)}-${monthKey}.pdf`;
}

type BwWeeklyBucket = "yes" | "no" | "refused" | "other";

/**
 * B&W-safe weekly chart segment: plain black-and-white printing drops color,
 * so each bucket gets a distinct treatment — Yes: dark solid, No: medium
 * gray solid, Refused: dotted, N/A or other: light gray solid — with a thin
 * outline so segments stay separable. Matches the on-screen SVG patterns
 * (hatch / cross-hatch / dots / light gray) closely enough that the two read
 * the same on paper.
 */
function drawBwWeeklySegment(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  bucket: BwWeeklyBucket,
) {
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.75);
  if (bucket === "yes") {
    doc.setFillColor(45, 45, 45);
    doc.rect(x, y, w, h, "FD");
  } else if (bucket === "no") {
    doc.setFillColor(150, 150, 150);
    doc.rect(x, y, w, h, "FD");
  } else if (bucket === "other") {
    doc.setFillColor(222, 222, 222);
    doc.rect(x, y, w, h, "FD");
  } else {
    // refused: white with a dot grid.
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, w, h, "FD");
    doc.setFillColor(60, 60, 60);
    const step = 4;
    for (let dy = step / 2; dy < h; dy += step) {
      for (let dx = step / 2; dx < w; dx += step) {
        doc.circle(x + dx, y + dy, 0.7, "F");
      }
    }
  }
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number, maxWidth: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 118, y, { maxWidth: maxWidth - 118 });
}

export function buildShiftNoteMonthlyReportPdf(input: {
  agencyName: string;
  individualName: string;
  individualIdLabel: string;
  siteName: string;
  monthLabel: string;
  monthKey: string;
  generatedBy: string;
  generatedAt: string;
  programName: string;
  scheduleLabel: string;
  scoringMethodName: string;
  tasks: MonthlyReportPdfTask[];
  /** Per-task weekly Yes/No chart data, weeks 1–5. */
  weekly: MonthlyReportPdfWeeklyTask[];
  /** task index -> day (1-based) -> stacked cell entries like "Y · JM". */
  grid: string[][][];
  signatures: MonthlyReportPdfSignature[];
  summary: MonthlyReportPdfSummary | null;
  /** Support-coordinator summary section (B&W-safe like the rest). */
  scSummary: MonthlyReportPdfScSummary;
  logoDataUrl?: string | null;
}) {
  // Landscape letter: 792 x 612 pt.
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const margin = 40;
  const pageWidth = 792;
  const pageHeight = 612;
  const usable = pageWidth - margin * 2;
  let y = 44;

  // Brand header (landscape variant of the shared brand block).
  const logo = input.logoDataUrl;
  if (logo) {
    try {
      doc.addImage(logo, imageFormatFromDataUrl(logo), margin, y - 6, 34, 34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(36, 30, 24);
      doc.text(input.agencyName, margin + 44, y + 6, { maxWidth: usable - 44 });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(95, 81, 69);
      doc.text("Prepared with Complyrer", margin + 44, y + 20);
      y += 42;
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(47, 70, 48);
      doc.text("COMPLYRER", margin, y);
      doc.setFontSize(10);
      doc.setTextColor(36, 30, 24);
      doc.text(input.agencyName, margin, y + 14);
      y += 30;
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(47, 70, 48);
    doc.text("COMPLYRER", margin, y);
    doc.setFontSize(10);
    doc.setTextColor(36, 30, 24);
    doc.text(input.agencyName, margin, y + 14);
    y += 30;
  }

  doc.setTextColor(36, 30, 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Shift Notes Monthly Report", margin, y);
  y += 20;

  const needPage = (height: number) => {
    if (y + height > pageHeight - 44) {
      doc.addPage();
      y = 44;
    }
  };

  // Report header block.
  needPage(70);
  field(doc, "Individual", input.individualName, margin, y, usable);
  y += 14;
  field(doc, "Individual ID", input.individualIdLabel, margin, y, usable);
  y += 14;
  field(doc, "Site", input.siteName, margin, y, usable);
  y += 14;
  field(doc, "Month", input.monthLabel, margin, y, usable);
  y += 14;
  field(doc, "Generated", `${input.generatedAt} by ${input.generatedBy}`, margin, y, usable);
  y += 22;

  // Program block.
  needPage(60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("ISP program", margin, y);
  y += 16;
  field(doc, "Program", input.programName, margin, y, usable);
  y += 14;
  field(doc, "Schedule", input.scheduleLabel, margin, y, usable);
  y += 14;
  field(doc, "Scoring method", input.scoringMethodName, margin, y, usable);
  y += 20;

  // Numbered objectives.
  needPage(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Objectives", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  input.tasks.forEach((task, index) => {
    const lines = doc.splitTextToSize(
      `${index + 1}. ${task.title}${task.instructions ? ` — ${task.instructions}` : ""}`,
      usable - 8,
    );
    needPage(lines.length * 12 + 6);
    doc.text(lines, margin + 8, y);
    y += lines.length * 12 + 6;
  });
  y += 8;

  // Weekly task score summary chart (same stacked bars as the on-screen
  // chart): per objective, Yes/No counts per week with Refused /
  // N/A-or-other segments. B&W-safe fills — no information rides on color.
  needPage(64);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(36, 30, 24);
  doc.text("Weekly task score summary", margin, y);
  y += 10;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  // Wrap explicitly so y advances past every wrapped line; otherwise a second
  // line overlaps the legend swatches drawn just below.
  const introLines = doc.splitTextToSize(
    "For each objective, how many times the task was scored Yes or No in each week of the month. Each score type has its own fill pattern so the chart reads in plain black-and-white print.",
    usable,
  );
  doc.text(introLines, margin, y);
  doc.setTextColor(36, 30, 24);
  y += 8 + (introLines.length - 1) * 10;
  const legendDefs: Array<[string, BwWeeklyBucket]> = [
    ["Yes", "yes"],
    ["No", "no"],
    ["Refused", "refused"],
    ["N/A or other", "other"],
  ];
  let legendX = margin;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (const [label, bucket] of legendDefs) {
    drawBwWeeklySegment(doc, legendX, y - 8, 10, 8, bucket);
    doc.setTextColor(36, 30, 24);
    doc.text(label, legendX + 13, y);
    legendX += doc.getTextWidth(label) + 32;
  }
  y += 8;
  const barWidth = 300;
  const labelWidth = 104;
  for (const taskWeek of input.weekly) {
    const rows = taskWeek.weeks.filter((week) => week.label !== "");
    const blockHeight = 14 + rows.length * 14 + 6;
    needPage(blockHeight);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(36, 30, 24);
    doc.text(
      doc.splitTextToSize(`${taskWeek.taskNumber}. ${taskWeek.title}`, usable)[0],
      margin,
      y,
    );
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const week of rows) {
      const total = week.yes + week.no + week.refused + week.other;
      doc.text(week.label, margin, y + 8, { maxWidth: labelWidth - 6 });
      const barX = margin + labelWidth;
      if (total > 0) {
        let segX = barX;
        const segments: Array<[number, BwWeeklyBucket]> = [
          [week.yes, "yes"],
          [week.no, "no"],
          [week.refused, "refused"],
          [week.other, "other"],
        ];
        for (const [count, bucket] of segments) {
          if (count <= 0) continue;
          const segWidth = (count / total) * barWidth;
          drawBwWeeklySegment(doc, segX, y, segWidth, 10, bucket);
          if (bucket === "yes" && segWidth >= 18) {
            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(7.5);
            doc.text(String(count), segX + segWidth / 2, y + 7.5, { align: "center" });
            doc.setTextColor(36, 30, 24);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
          }
          segX += segWidth;
        }
      }
      doc.setDrawColor(40, 40, 40);
      doc.setLineWidth(0.75);
      doc.rect(barX, y, barWidth, 10);
      const countParts = [`${week.yes} Y`, `${week.no} N`];
      if (week.refused > 0) countParts.push(`${week.refused} R`);
      if (week.other > 0) countParts.push(`${week.other} N/A`);
      doc.text(
        total === 0 ? "No scores" : countParts.join(" · "),
        barX + barWidth + 8,
        y + 8,
      );
      y += 14;
    }
    y += 6;
  }

  // Monthly summary for support coordinator.
  needPage(60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(36, 30, 24);
  doc.text("Monthly summary for support coordinator", margin, y);
  y += 10;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text(
    "Progress on each ISP objective this month, computed from shift note scores.",
    margin,
    y,
  );
  doc.setTextColor(36, 30, 24);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  field(doc, "Individual", input.individualName, margin, y, usable);
  y += 14;
  field(doc, "Individual ID", input.individualIdLabel, margin, y, usable);
  y += 14;
  field(doc, "Month", input.monthLabel, margin, y, usable);
  y += 14;
  field(doc, "Site", input.siteName, margin, y, usable);
  y += 20;
  for (const objective of input.scSummary.objectives) {
    needPage(44);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const titleLines = doc.splitTextToSize(
      `${objective.taskNumber}. ${objective.title}`,
      usable - 8,
    );
    doc.text(titleLines, margin, y);
    y += titleLines.length * 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const progressLines = doc.splitTextToSize(objective.progressLine, usable - 8);
    doc.text(progressLines, margin + 4, y);
    y += progressLines.length * 12;
    const scNarrative = objective.narrative.trim() || "No narrative recorded.";
    const scNarrativeLines = doc.splitTextToSize(scNarrative, usable - 8);
    for (const chunk of scNarrativeLines) {
      needPage(14);
      doc.text(chunk, margin + 4, y);
      y += 12;
    }
    y += 6;
  }
  needPage(44);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Overall status", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const overall = input.scSummary.overallNarrative.trim() || "No overall status recorded.";
  for (const chunk of doc.splitTextToSize(overall, usable - 8)) {
    needPage(14);
    doc.text(chunk, margin + 4, y);
    y += 12;
  }
  y += 6;
  needPage(30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Signatures", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const sig of input.scSummary.signatures) {
    needPage(20);
    doc.text(`${sig.role}:`, margin, y);
    doc.text(sig.name || "—", margin + 150, y, { maxWidth: 260 });
    doc.setDrawColor(120, 110, 96);
    doc.setLineWidth(0.5);
    doc.line(margin + 148, y + 3, margin + 420, y + 3);
    doc.text("Date:", margin + 440, y);
    doc.text(sig.date || "—", margin + 480, y);
    doc.line(margin + 478, y + 3, margin + 620, y + 3);
    y += 18;
  }
  y += 6;

  // Day grid.
  const dayCount = input.grid[0]?.length ?? 0;
  const labelCol = 170;
  const dayCol = dayCount > 0 ? (usable - labelCol) / dayCount : 0;
  const gridX = margin;
  const drawGridHeader = () => {
    doc.setFillColor(240, 238, 234);
    doc.rect(gridX, y, usable, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(36, 30, 24);
    doc.text("Objective", gridX + 4, y + 11);
    for (let day = 1; day <= dayCount; day += 1) {
      const cx = gridX + labelCol + (day - 1) * dayCol;
      doc.text(String(day), cx + dayCol / 2, y + 11, { align: "center" });
    }
    y += 16;
  };

  needPage(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Daily scores", margin, y);
  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text(
    "Each cell shows the score short label and the staff initials for that day. Multiple notes stack in the cell.",
    margin,
    y,
  );
  doc.setTextColor(36, 30, 24);
  y += 12;

  drawGridHeader();
  input.tasks.forEach((task, taskIndex) => {
    const cells = input.grid[taskIndex] ?? [];
    const rowLabel = `${taskIndex + 1}. ${task.title}`;
    const labelLines = doc.splitTextToSize(rowLabel, labelCol - 8);
    let maxCellLines = 1;
    const cellLines: string[][] = cells.map((entries) => {
      const lines: string[] = [];
      for (const entry of entries.slice(0, 4)) {
        lines.push(...doc.splitTextToSize(entry, Math.max(dayCol - 3, 8)));
      }
      if (entries.length > 4) lines.push(`+${entries.length - 4} more`);
      maxCellLines = Math.max(maxCellLines, lines.length || 1);
      return lines;
    });
    const rowHeight = Math.max(labelLines.length, maxCellLines) * 10 + 8;
    needPage(rowHeight + 2);
    // If the page broke, redraw the header on the new page.
    if (y === 44) drawGridHeader();
    const rowTop = y;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(labelLines, gridX + 4, rowTop + 10);
    cellLines.forEach((lines, dayIndex) => {
      const cx = gridX + labelCol + dayIndex * dayCol;
      doc.text(lines.length ? lines : [""], cx + 2, rowTop + 10);
    });
    // Row + column rules.
    doc.setDrawColor(200, 192, 180);
    doc.line(gridX, rowTop + rowHeight, gridX + usable, rowTop + rowHeight);
    doc.line(gridX + labelCol, rowTop, gridX + labelCol, rowTop + rowHeight);
    for (let day = 1; day < dayCount; day += 1) {
      const cx = gridX + labelCol + day * dayCol;
      doc.line(cx, rowTop, cx, rowTop + rowHeight);
    }
    y = rowTop + rowHeight;
  });
  // Grid outline.
  doc.setDrawColor(120, 110, 96);
  y += 18;

  // Staff signature log.
  needPage(60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Staff signature log", margin, y);
  y += 8;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text(
    "Staff who recorded shift notes this month. Initials in the daily grid map to this log.",
    margin,
    y,
  );
  doc.setTextColor(36, 30, 24);
  y += 14;
  const sigCols = [300, 120, usable - 420];
  doc.setFillColor(240, 238, 234);
  doc.rect(margin, y, usable, 16, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Print name", margin + 4, y + 11);
  doc.text("Initials", margin + 4 + sigCols[0], y + 11);
  doc.text("Title", margin + 4 + sigCols[0] + sigCols[1], y + 11);
  y += 16;
  doc.setFont("helvetica", "normal");
  for (const sig of input.signatures) {
    needPage(18);
    doc.text(sig.name, margin + 4, y + 11, { maxWidth: sigCols[0] - 8 });
    doc.text(sig.initials, margin + 4 + sigCols[0], y + 11);
    doc.text(sig.title || "—", margin + 4 + sigCols[0] + sigCols[1], y + 11, {
      maxWidth: sigCols[2] - 8,
    });
    doc.setDrawColor(200, 192, 180);
    doc.line(margin, y + 16, margin + usable, y + 16);
    y += 16;
  }
  y += 10;

  // Manager summary.
  needPage(80);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Monthly summary", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const narrative = input.summary?.narrative?.trim() || "No summary written yet.";
  const narrativeLines = doc.splitTextToSize(narrative, usable - 8);
  for (const chunk of narrativeLines) {
    needPage(14);
    doc.text(chunk, margin + 4, y);
    y += 13;
  }
  y += 10;
  if (input.summary && input.summary.signedByName) {
    needPage(44);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Signed", margin, y);
    y += 14;
    field(doc, "Name", input.summary.signedByName, margin, y, usable);
    y += 14;
    field(doc, "Title", input.summary.signedByTitle, margin, y, usable);
    y += 14;
    field(doc, "Date", input.summary.signedAt.slice(0, 10), margin, y, usable);
    y += 14;
  }

  stampRecordMark(doc, {
    documentId: `shift-notes-monthly-${input.monthKey}`,
    generatedAt: input.generatedAt,
    margin,
    footerY: pageHeight - 28,
  });
  return doc;
}
