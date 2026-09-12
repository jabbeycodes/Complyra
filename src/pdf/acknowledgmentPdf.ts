import { jsPDF } from "jspdf";
import type { PacketDetail } from "../data/types";

function formatLongDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDob(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function sortAcknowledgmentRows<T extends { signedAt: string | null; staffName: string }>(
  rows: T[],
) {
  return [...rows].sort((a, b) => {
    if (a.signedAt && b.signedAt) return a.signedAt.localeCompare(b.signedAt);
    if (a.signedAt) return -1;
    if (b.signedAt) return 1;
    return a.staffName.localeCompare(b.staffName);
  });
}

export function buildAcknowledgmentPdf(
  agencyName: string,
  detail: PacketDetail,
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const rows = sortAcknowledgmentRows(detail.rows);
  const margin = 54;
  let y = 64;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(117, 97, 188);
  doc.text("COMPLYRA", margin, y);
  doc.setTextColor(52, 54, 62);
  doc.setFontSize(18);
  y += 28;
  doc.text("PCSP Acknowledgment Sheet", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y += 28;
  const header = [
    ["Agency", agencyName],
    ["Individual", detail.individual.fullName],
    ["Date of birth", formatDob(detail.individual.dateOfBirth)],
    ["What they are acknowledging", detail.packet.whatAcknowledging],
    ["Start date", formatLongDate(detail.packet.startsOn)],
    ["End date", formatLongDate(detail.packet.endsOn)],
    ["Program site", detail.site.name],
    ["Document version", detail.version.versionLabel],
  ];
  for (const [label, value] of header) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), margin + 180, y, { maxWidth: 360 });
    y += 18;
  }

  y += 12;
  doc.setDrawColor(236, 236, 240);
  doc.line(margin, y, 558, y);
  y += 24;
  doc.setFont("helvetica", "bold");
  doc.text("Staff member", margin, y);
  doc.text("Signature", 280, y);
  doc.text("Date", 470, y);
  y += 10;
  doc.setDrawColor(117, 97, 188);
  doc.line(margin, y, 558, y);
  y += 22;
  doc.setFont("helvetica", "normal");

  for (const row of rows) {
    if (y > 720) {
      doc.addPage();
      y = 64;
    }
    doc.text(row.staffName, margin, y);
    if (row.signedAt && row.signatureMark && row.signatureMark.startsWith("data:image")) {
      try {
        doc.addImage(row.signatureMark, "PNG", 280, y - 16, 110, 28);
      } catch {
        doc.text(row.signatureName || "Signed", 280, y);
      }
    } else if (row.signedAt) {
      doc.text(row.signatureName || "Signed", 280, y);
    } else {
      doc.setTextColor(188, 105, 103);
      doc.text("Pending", 280, y);
      doc.setTextColor(52, 54, 62);
    }
    doc.text(
      row.signedAt
        ? new Date(row.signedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "—",
      470,
      y,
    );
    y += 36;
  }

  y += 12;
  doc.setFontSize(9);
  doc.setTextColor(133, 134, 142);
  doc.text(
    "Unsigned rows remain visible so missing acknowledgments are never omitted from the export.",
    margin,
    Math.min(y, 750),
    { maxWidth: 500 },
  );
  return doc;
}

export function packetFileName(detail: PacketDetail) {
  return `complyrer-acknowledgment-${detail.individual.fullName
    .toLowerCase()
    .replaceAll(" ", "-")}-${detail.version.versionLabel.replaceAll(" ", "-")}.pdf`;
}
