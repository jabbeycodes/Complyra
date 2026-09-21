import {
  DRILL_DUE_DAY,
  DRILL_QUARTER_RESPONSIBILITIES,
  MEDICAL_EMERGENCY_RULE,
  scheduleMonthLabel,
  type ScheduleMonthSummary,
} from "../data/drillSchedule";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";
import { drawSiteLocationFields } from "./siteLocation";
import type { SiteAddressParts } from "../data/siteAddress";

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export function drillScheduleFileName(
  siteName: string,
  year: number,
  month?: number | null,
) {
  const monthSlug = month ? `-${year}-${String(month).padStart(2, "0")}` : `-${year}`;
  return `complyrer-emergency-drill-schedule-${slug(siteName)}${monthSlug}.pdf`;
}

function line(doc: import("jspdf").jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 110, y, { maxWidth: 430 });
}

function statusLabel(status: "complete" | "late" | "not_logged"): string {
  if (status === "late") return "Late";
  if (status === "complete") return "Complete";
  return "Not logged";
}

/**
 * Printable mirror of the on-screen Emergency Drills Schedule section:
 * the agency's 12-month schedule with shift windows, required drills, and
 * completion state from existing drill records. Individuals-safe wording —
 * no client/patient/T-Log language.
 */
export function buildDrillSchedulePdf(input: {
  agencyName: string;
  siteName: string;
  year: number;
  months: ScheduleMonthSummary[];
  /** "Full year 2026" or "September 2026" — printed on the cover line. */
  scopeLabel?: string;
  logoDataUrl?: string | null;
  siteLocation?: SiteAddressParts;
}) {
  const { doc, margin, y: startY } = startBrandedDoc("Emergency Drills Schedule", {
    agencyName: input.agencyName,
    logoDataUrl: input.logoDataUrl,
  });
  let y = startY;
  line(doc, "Agency", input.agencyName, margin, y);
  y += 16;
  y = drawSiteLocationFields(doc, margin, y, input.siteLocation ?? { name: input.siteName });
  line(doc, "Covers", input.scopeLabel ?? String(input.year), margin, y);
  y += 24;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text(
    `Drills need to be completed by the ${DRILL_DUE_DAY}th of each month. Drills recorded after the ${DRILL_DUE_DAY}th are accepted but flagged late.`,
    margin,
    y,
    { maxWidth: 514 },
  );
  y += 28;
  for (const quarter of DRILL_QUARTER_RESPONSIBILITIES) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${quarter.label} (${quarter.months}): ${quarter.responsibility}`, margin, y);
    y += 14;
  }
  doc.setFont("helvetica", "italic");
  doc.text(`* ${MEDICAL_EMERGENCY_RULE}`, margin, y, { maxWidth: 514 });
  y += 28;

  const pageBreak = (needed: number) => {
    if (y + needed > 700) {
      doc.addPage();
      y = 64;
    }
  };

  for (const summary of input.months) {
    pageBreak(120);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const progress = `${summary.complete}/${summary.required} complete`;
    doc.text(`${summary.month.name} · ${progress}`, margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Shift window: ${summary.month.shiftWindow}`, margin, y);
    y += 16;
    if (summary.month.allStaffMedicalMonth) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.text(`* ${MEDICAL_EMERGENCY_RULE}`, margin, y, { maxWidth: 514 });
      y += 16;
    }
    for (const state of summary.states) {
      pageBreak(110);
      const status = state.late ? "late" : state.status;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(
        `${scheduleMonthLabel(state.type)} drill — ${statusLabel(status)}`,
        margin + 12,
        y,
      );
      y += 16;
      const record = state.record;
      line(doc, "Date", record?.date ?? "Not logged", margin + 12, y);
      y += 16;
      if (record) {
        line(doc, "Time", record.time ?? "", margin + 12, y);
        y += 16;
        line(doc, "Evacuation time", record.evacTime ?? "", margin + 12, y);
        y += 16;
        line(doc, "Drill leader", record.leaderName ?? "", margin + 12, y);
        y += 16;
        line(doc, "Participants", record.participants ?? "", margin + 12, y);
        y += 16;
        if (
          (state.type === "fire" || state.type === "missing_person") &&
          record.awakeOrSleep
        ) {
          line(
            doc,
            "Awake / sleep",
            record.awakeOrSleep === "awake" ? "Awake" : "Sleep",
            margin + 12,
            y,
          );
          y += 16;
        }
      }
      y += 6;
    }
    y += 8;
  }

  const monthScope = input.months.length === 1 ? input.months[0].month.month : null;
  const documentId = monthScope
    ? `drill-schedule-${input.year}-${String(monthScope).padStart(2, "0")}`
    : `drill-schedule-${input.year}`;
  stampRecordMark(doc, { documentId, margin });  return doc;
}
