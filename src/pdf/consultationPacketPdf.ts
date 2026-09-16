import {
  formatGeneratedBy,
  medicaidStatusLabel,
  type Appointment,
} from "../data/appointments";
import type { Medication } from "../data/chart";
import { formatAllergiesLabel, type IndividualProfile } from "../data/planStack";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

const NOT_ON_FILE = "Not on file";
const PAGE_BOTTOM = 740;

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
  const contentWidth = 504;
  let y = startY;

  const writePair = (label: string, value: string) => {
    y = ensureSpace(doc, y, 28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(95, 81, 69);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(36, 30, 24);
    const lines = doc.splitTextToSize(value, contentWidth);
    doc.text(lines, margin, y + 12);
    y += 12 + lines.length * 14 + 8;
  };

  writePair("Agency", input.agencyName);
  writePair(
    "Appointment",
    `${formatPacketDate(input.appointment.startsOn)} · ${formatPacketTime(input.appointment.startTime)}–${formatPacketTime(input.appointment.endTime)} · ${present(input.appointment.timezone)}`,
  );
  writePair(
    "Individual",
    input.profile.dmhId.trim()
      ? `${input.individualName} · ID ${input.profile.dmhId.trim()}`
      : `${input.individualName} · ID ${NOT_ON_FILE}`,
  );
  writePair("Birth date", present(input.dateOfBirth));
  writePair(
    "Program / site",
    [input.programName, input.siteName].filter((part) => part.trim()).join(" · ") || NOT_ON_FILE,
  );
  writePair(
    "Medicaid status",
    medicaidStatusLabel(input.profile.medicaidStatus) || NOT_ON_FILE,
  );
  writePair("Medicaid member number", NOT_ON_FILE);
  writePair("Medicare member number", NOT_ON_FILE);
  writePair(
    "Consultant",
    input.appointment.specialty.trim()
      ? `${input.appointment.consultant} · ${input.appointment.specialty.trim()}`
      : present(input.appointment.consultant),
  );
  writePair("Reason for appointment", present(input.appointment.reason));
  writePair(
    "Address of visit",
    present(input.appointment.visitAddress || input.profile.address),
  );
  const medical = [input.profile.specializedMedical, input.profile.diagnosis]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
  writePair("Other medical information", present(medical));
  writePair("Dietary guidelines", present(input.profile.specializedDiet));
  writePair("Allergies", present(formatAllergiesLabel(input.profile.allergies)));

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
    contentWidth,
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

  y = ensureSpace(doc, y, 28);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(95, 81, 69);
  doc.text(formatGeneratedBy(input.generatedByName, input.generatedAt), margin, y);

  stampRecordMark(doc, { margin });
  return doc;
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
  return 54;
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
