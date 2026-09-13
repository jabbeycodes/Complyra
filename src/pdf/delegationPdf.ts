import {
  blankDelegationForm,
  DELEGATION_NON_TRANSFERABILITY_CLAUSE,
  DELEGATION_RN_RESPONSIBILITY_CLAUSE,
  type DelegationForm,
  type DelegationRosterRow,
} from "../data/types";
import { startBrandedDoc } from "./brandHeader";

export type DelegationPdfKind = "exact" | "improved";

const PAGE_BOTTOM = 740;

function ensureRoom(doc: ReturnType<typeof startBrandedDoc>["doc"], y: number, room: number) {
  if (y + room > PAGE_BOTTOM) {
    doc.addPage();
    return 64;
  }
  return y;
}

function heading(doc: ReturnType<typeof startBrandedDoc>["doc"], y: number, text: string, margin: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(text, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  return y + 16;
}

function fieldLine(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  label: string,
  value: string,
  margin: number,
  width: number,
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`${label}:`, margin, y);
  doc.setFont("helvetica", "normal");
  const shown = value || "—";
  doc.text(shown, margin, y + 12, { maxWidth: width });
  const lines = doc.splitTextToSize(shown, width);
  return y + 12 + lines.length * 11 + 6;
}

function clause(doc: ReturnType<typeof startBrandedDoc>["doc"], y: number, text: string, margin: number, width: number) {
  y = ensureRoom(doc, y, 60);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, margin, y);
  doc.setFont("helvetica", "normal");
  return y + lines.length * 12 + 10;
}

function rosterTable(
  doc: ReturnType<typeof startBrandedDoc>["doc"],
  y: number,
  roster: DelegationRosterRow[],
  margin: number,
  width: number,
  improved: boolean,
) {
  const cols = improved
    ? [
        { label: "Print name / title", w: 150 },
        { label: "Competency", w: 150 },
        { label: "Signature", w: 110 },
        { label: "Rescinded", w: 60 },
        { label: "Init.", w: 40 },
      ]
    : [
        { label: "Print name / title", w: 190 },
        { label: "Staff signature", w: 150 },
        { label: "Rescinded date", w: 90 },
        { label: "Initials", w: 80 },
      ];
  const drawHeader = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    let x = margin;
    for (const col of cols) {
      doc.text(col.label, x + 2, y);
      x += col.w;
    }
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(160, 150, 140);
    doc.line(margin, y + 4, margin + width, y + 4);
  };
  drawHeader();
  y += 20;
  roster.forEach((row, i) => {
    y = ensureRoom(doc, y, 26);
    if ((i + 1) % 12 === 0 && i > 0) {
      // new page keeps the header readable
    }
    let x = margin;
    const name = row.printName ? `${row.printName}${row.title ? ` — ${row.title}` : ""}` : "";
    const cells = improved
      ? [
          name,
          row.competency.length > 0 ? row.competency.join("; ") : "",
          row.signatureName || "",
          row.rescindedDate || "",
          row.initials || "",
        ]
      : [name, row.signatureName || "", row.rescindedDate || "", row.initials || ""];
    doc.setFontSize(8);
    cells.forEach((cell, ci) => {
      doc.text(cell || "—", x + 2, y, { maxWidth: cols[ci].w - 6 });
      x += cols[ci].w;
    });
    doc.setDrawColor(210, 200, 190);
    doc.line(margin, y + 5, margin + width, y + 5);
    y += 17;
  });
  return y + 6;
}

export function buildDelegationPdf(input: {
  agencyName: string;
  individualName: string;
  dmhId: string;
  individualLocation: string;
  taskTitle: string;
  form: DelegationForm;
  kind: DelegationPdfKind;
  logoDataUrl?: string | null;
}) {
  const form = input.form;
  const improved = input.kind === "improved";
  const { doc, margin, y: startY } = startBrandedDoc(
    improved ? "Delegation of Specified Nursing Task (Complyrer Improved)" : "RN Delegation of Specified Nursing Task Form",
    { agencyName: input.agencyName, logoDataUrl: input.logoDataUrl },
    48,
  );
  let y = startY;
  const width = 558 - margin;

  if (improved) {
    y = ensureRoom(doc, y, 40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90, 70, 50);
    doc.text(
      "Improved version — same record, clearer review schedule. Fields the paper form omits are marked *.",
      margin,
      y,
      { maxWidth: width },
    );
    doc.setTextColor(36, 30, 24);
    y += 26;
  }

  // 1. Header
  y = heading(doc, y, "Individual", margin);
  y = fieldLine(doc, y, "Individual's name", input.individualName, margin, width);
  y = fieldLine(doc, y, "DMH ID number", input.dmhId, margin, width);
  y = fieldLine(doc, y, "Individual's location", input.individualLocation, margin, width);

  // 2. Delegated task + purpose
  y = heading(doc, y, "Delegated task", margin);
  y = fieldLine(doc, y, "Delegated task", input.taskTitle, margin, width);
  y = fieldLine(doc, y, "Purpose of task", form.purpose, margin, width);

  // 3. Non-transferability clause (verbatim)
  y = clause(doc, y, DELEGATION_NON_TRANSFERABILITY_CLAUSE, margin, width);

  // 4. Employee roster table (12 rows)
  y = ensureRoom(doc, y, 60);
  y = heading(doc, y, "Employees delegated this task (12 rows)", margin);
  y = rosterTable(doc, y, form.roster, margin, width, improved);

  // 5. RN responsibility clause (verbatim)
  y = clause(doc, y, DELEGATION_RN_RESPONSIBILITY_CLAUSE, margin, width);

  // 6. Task rescinded checkboxes
  y = ensureRoom(doc, y, 50);
  y = heading(doc, y, "Task rescinded", margin);
  doc.setFontSize(9);
  const reason = form.rescindReason;
  doc.text(`${reason === "health_status_change" ? "[X]" : "[ ]"} Change in health status`, margin, y);
  doc.text(`${reason === "other" ? "[X]" : "[ ]"} Other (explain below)`, margin + 220, y);
  y += 18;
  if (form.rescindExplanation) {
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(form.rescindExplanation, width);
    y = ensureRoom(doc, y, lines.length * 12);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 8;
  }

  // 7. Delegating RN signature block
  y = ensureRoom(doc, y, 60);
  y = heading(doc, y, "Delegating RN", margin);
  y = fieldLine(doc, y, "Delegating RN (name)", form.delegatingRn.name, margin, width / 2 - 10);
  const rnSigY = y;
  y = fieldLine(doc, y, "Signature", form.delegatingRn.signatureName || "", margin, width);
  y = Math.max(y, rnSigY);
  y = fieldLine(doc, y, "Date signed", form.delegatingRn.dateSigned || "", margin, width);
  if (form.delegatingRn.contactNumber) {
    y = fieldLine(doc, y, "Contact number", form.delegatingRn.contactNumber, margin, width);
  }

  // 8. Specialized instruction table (two columns)
  y = ensureRoom(doc, y, 70);
  y = heading(doc, y, "Specialized instruction for delegation", margin);
  const half = width / 2 - 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("PROCEDURES / Steps to follow to perform the task", margin, y, { maxWidth: half });
  doc.text("What to OBSERVE for and REPORT, what to DO and WHOM to CONTACT", margin + half + 16, y, {
    maxWidth: half,
  });
  y += 14;
  doc.setDrawColor(160, 150, 140);
  doc.line(margin, y, margin + width, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const procLines = doc.splitTextToSize(form.procedures || "—", half);
  const obsLines = doc.splitTextToSize(form.observeReportDo || "—", half);
  const block = Math.max(procLines.length, obsLines.length);
  y = ensureRoom(doc, y, block * 12);
  doc.text(procLines, margin, y);
  doc.text(obsLines, margin + half + 16, y);
  y += block * 12 + 6;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text("*Attach any additional instructional documentation", margin, y);
  doc.setFont("helvetica", "normal");
  y += 22;

  // 9. Instructional licensed medical professional
  y = ensureRoom(doc, y, 70);
  y = heading(doc, y, "Instructional licensed medical professional", margin);
  const prof = form.instructingProfessional;
  y = fieldLine(doc, y, "Printed name", prof.name, margin, width);
  y = fieldLine(doc, y, "Signature and title", prof.title ? `${prof.name} — ${prof.title}` : prof.name, margin, width);
  y = fieldLine(doc, y, "Date", prof.signedAt || "", margin, width);
  y = fieldLine(doc, y, "Contact number", prof.contactNumber, margin, width);

  // 10. Delegating RN if different than instructing professional
  y = ensureRoom(doc, y, 60);
  y = heading(doc, y, "Delegating RN (if different than instructing medical professional)", margin);
  y = fieldLine(doc, y, "Signature and title", form.delegatingRn.signatureName || "", margin, width);
  y = fieldLine(doc, y, "Date", form.delegatingRn.dateSigned || "", margin, width);
  y = fieldLine(doc, y, "Contact number", form.delegatingRn.contactNumber, margin, width);

  // Improved-only section
  if (improved) {
    y = ensureRoom(doc, y, 70);
    y = heading(doc, y, "Review schedule * (Complyrer improved)", margin);
    y = fieldLine(doc, y, "Review / expiry date *", form.reviewDate || "Not set", margin, width);
    y = fieldLine(
      doc,
      y,
      "Inspection cadence *",
      form.inspectionCadence || form.inspectionInterval,
      margin,
      width,
    );
  }

  return doc;
}

/** Build with an empty form to smoke-test layout in unit tests. */
export function buildBlankDelegationPdf(kind: DelegationPdfKind) {
  return buildDelegationPdf({
    agencyName: "Test Agency",
    individualName: "Test Individual",
    dmhId: "",
    individualLocation: "",
    taskTitle: "Test task",
    form: blankDelegationForm(kind === "improved" ? "complyrer_improved" : "lifepath_exact"),
    kind,
  });
}

export function delegationFileName(taskTitle: string, individualName: string, kind: DelegationPdfKind) {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "delegation";
  return `complyrer-delegation-${kind === "improved" ? "improved" : "lifepath"}-${slug(taskTitle)}-${slug(individualName)}.pdf`;
}
