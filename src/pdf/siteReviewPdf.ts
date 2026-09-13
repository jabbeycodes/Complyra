import { jsPDF } from "jspdf";
import {
  SERVICE_TYPE_LABELS,
  SITE_REVIEW_LINE_DEFS,
  SITE_REVIEW_SECTIONS,
  lineStatusLabel,
  yesNo,
  type PreSurveyRow,
  type SiteFacts,
  type SiteReview,
} from "../data/siteReview";

function startDoc(title: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = 56;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(47, 70, 48);
  doc.text("COMPLYRER", margin, y);
  doc.setTextColor(36, 30, 24);
  doc.setFontSize(16);
  y += 22;
  doc.text(title, margin, y);
  return { doc, margin, y };
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  doc.text(value || "—", x + 118, y, { maxWidth: 400 });
}

function slug(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

export function siteReviewFileName(siteName: string) {
  return `complyrer-site-review-${slug(siteName)}.pdf`;
}

export function preSurveyFileName(siteName: string) {
  return `complyrer-pre-survey-${slug(siteName)}.pdf`;
}

export function buildSiteReviewPdf(input: {
  agencyName: string;
  siteName: string;
  address: string;
  facts: SiteFacts;
  residents: string[];
  review: SiteReview;
  monthlySafetyOnFile: boolean;
}) {
  const { doc, margin } = startDoc("Environmental site review");
  let y = 96;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text(
    "Working copy for the DPM. This is not the official Division form. Monthly smoke, CO, water temperature, extinguisher, and first-aid checks stay on the home safety report.",
    margin,
    y,
    { maxWidth: 514 },
  );
  doc.setTextColor(36, 30, 24);
  y += 28;
  field(doc, "Agency", input.agencyName, margin, y);
  y += 14;
  field(doc, "Home", input.siteName, margin, y);
  y += 14;
  field(
    doc,
    "Address",
    [input.address, input.facts.city, input.facts.county, input.facts.zip]
      .filter(Boolean)
      .join(", "),
    margin,
    y,
  );
  y += 14;
  field(doc, "Service type", SERVICE_TYPE_LABELS[input.facts.serviceType], margin, y);
  y += 14;
  field(doc, "Individuals", input.residents.join(", ") || "None listed", margin, y);
  y += 14;
  field(doc, "Reviewer", input.review.reviewerName, margin, y);
  y += 14;
  field(doc, "Support coordinator", input.review.supportCoordinator, margin, y);
  y += 14;
  field(doc, "Reviewed on", input.review.reviewedOn, margin, y);
  y += 14;
  field(doc, "Provider owned/controlled", yesNo(input.review.providerOwnedControlled), margin, y);
  y += 14;
  field(doc, "Heightened scrutiny", yesNo(input.review.heightenedScrutiny), margin, y);
  y += 14;
  field(doc, "Meets individual needs", yesNo(input.review.meetsIndividualNeeds), margin, y);
  y += 14;
  field(doc, "Part II verified", yesNo(input.review.part2Verified), margin, y);
  y += 14;
  field(
    doc,
    "Monthly safety",
    input.monthlySafetyOnFile ? "Current month on file" : "Not finished this month",
    margin,
    y,
  );
  y += 22;

  for (const section of SITE_REVIEW_SECTIONS) {
    if (y > 700) {
      doc.addPage();
      y = 64;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(section.title, margin, y);
    y += 16;
    for (const def of SITE_REVIEW_LINE_DEFS.filter((row) => row.section === section.id)) {
      const line = input.review.lines.find((row) => row.id === def.id);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(def.label, 360);
      doc.text(wrapped, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(lineStatusLabel(line?.status ?? "unchecked"), margin + 370, y);
      y += wrapped.length * 12 + 2;
      if (line?.comment.trim()) {
        doc.setFontSize(8);
        doc.setTextColor(95, 81, 69);
        const notes = doc.splitTextToSize(line.comment, 514);
        doc.text(notes, margin, y);
        y += notes.length * 10 + 4;
        doc.setTextColor(36, 30, 24);
      }
      if (y > 720) {
        doc.addPage();
        y = 64;
      }
    }
    y += 8;
  }
  return doc;
}

export function buildPreSurveyPdf(input: {
  agencyName: string;
  siteName: string;
  address: string;
  facts: SiteFacts;
  rows: PreSurveyRow[];
}) {
  const { doc, margin } = startDoc("Pre-survey individual information");
  let y = 96;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(95, 81, 69);
  doc.text(
    "Working copy generated from the live chart and site facts. One sheet per service location. Not the official Division form.",
    margin,
    y,
    { maxWidth: 514 },
  );
  doc.setTextColor(36, 30, 24);
  y += 26;
  field(doc, "Provider", input.agencyName, margin, y);
  y += 14;
  field(doc, "Location", input.siteName, margin, y);
  y += 14;
  field(
    doc,
    "Address",
    [input.address, input.facts.city, input.facts.county, input.facts.zip]
      .filter(Boolean)
      .join(", "),
    margin,
    y,
  );
  y += 14;
  field(doc, "Service type", SERVICE_TYPE_LABELS[input.facts.serviceType], margin, y);
  y += 14;
  field(doc, "24-hour staff", yesNo(input.facts.staffed24h), margin, y);
  y += 14;
  field(doc, "Overnight sleep staff", yesNo(input.facts.overnightSleepStaff), margin, y);
  y += 14;
  field(
    doc,
    "Well water",
    input.facts.wellWater
      ? `Yes · last test ${input.facts.lastWaterTestOn || "not dated"}`
      : "No",
    margin,
    y,
  );
  y += 14;
  field(doc, "Site phone", input.facts.sitePhone, margin, y);
  y += 14;
  field(
    doc,
    "Contact",
    [input.facts.contactName, input.facts.contactPhone].filter(Boolean).join(" · "),
    margin,
    y,
  );
  y += 24;

  for (const row of input.rows) {
    if (y > 620) {
      doc.addPage();
      y = 64;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(row.name || "Unnamed", margin, y);
    y += 16;
    field(doc, "Age / sex", `${row.age || "—"} / ${row.sex || "—"}`, margin, y);
    y += 14;
    field(doc, "DMH / Medicaid / waiver", row.medicaid, margin, y);
    y += 14;
    field(doc, "Specialized diet", row.diet, margin, y);
    y += 14;
    field(doc, "Adaptive equipment", row.equipment, margin, y);
    y += 14;
    field(doc, "Specialized medical", row.specializedMedical, margin, y);
    y += 14;
    field(doc, "Restrictions / BSP", row.behaviorSupports, margin, y);
    y += 14;
    field(doc, "Daily activities", row.dailyActivities, margin, y);
    y += 14;
    field(doc, "Hours for visits", row.visitHours, margin, y);
    y += 22;
  }
  if (!input.rows.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No individuals are assigned to this location yet.", margin, y);
  }
  return doc;
}
