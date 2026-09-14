import { jsPDF } from "jspdf";
import {
  QA_ITEMS,
  QA_ITEM_MAP,
  QA_SECTIONS,
  qaFileName,
  qaPeriodLabel,
  scoreQaAudit,
  type QaAudit,
  type QaAuditItemState,
} from "../data/qaAudit";
import { stampRecordMark, startBrandedDoc } from "./brandHeader";

/**
 * QA-AUDIT report PDF (2026-09-14). White and print-friendly: black text on
 * white, no color fills. Sections, item results, source type (system /
 * auditor), dispute resolutions, comments, photo references, scores,
 * adopted signatures, timestamps — plus the Complyrer record mark.
 */

const PAGE_H = 792;
const FOOTER_Y = 768;

function ensure(doc: jsPDF, y: number, need: number, margin: number) {
  if (y + need > FOOTER_Y - 8) {
    doc.addPage();
    return 72;
  }
  return y;
}

function sectionScoreLine(score: ReturnType<typeof scoreQaAudit>, sectionId: string) {
  const s = score.sections[sectionId];
  if (!s || s.pct === null) return "No scored items";
  return `${s.pct}% (${s.pass} pass / ${s.fail} fail)`;
}

export function buildQaAuditPdf(input: {
  agencyName: string;
  siteName: string;
  audit: QaAudit;
  items: QaAuditItemState[];
  logoDataUrl?: string | null;
}) {
  const { agencyName, siteName, audit, items } = input;
  const { doc, margin, y: startY } = startBrandedDoc(
    `QA audit — ${siteName} · ${qaPeriodLabel(audit.year, audit.quarter)}`,
    { agencyName, logoDataUrl: input.logoDataUrl },
  );
  let y = startY;
  const width = 612 - margin * 2;

  const score = scoreQaAudit(items);

  // Header facts.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(36, 30, 24);
  const facts: Array<[string, string]> = [
    ["Site", siteName],
    ["Period", qaPeriodLabel(audit.year, audit.quarter)],
    ["Auditor", audit.auditorName ?? "—"],
    ["Status", audit.status === "finalized" ? "Finalized" : "In progress"],
    ["Overall score", score.pct === null ? "Not scored" : `${score.pct}%`],
    [
      "Critical failures",
      score.criticalFails.length === 0 ? "None" : String(score.criticalFails.length),
    ],
  ];
  for (const [label, value] of facts) {
    y = ensure(doc, y, 16, margin);
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, margin + 110, y, { maxWidth: width - 110 });
    y += 15;
  }
  y += 6;

  const byItemId = QA_ITEM_MAP;
  for (const section of QA_SECTIONS) {
    const sectionItems = items.filter(
      (i) => byItemId[i.itemId]?.sectionId === section.id,
    );
    if (sectionItems.length === 0) continue;
    y = ensure(doc, y, 40, margin);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(section.title, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(95, 81, 69);
    doc.text(sectionScoreLine(score, section.id), margin, y + 14);
    doc.setTextColor(36, 30, 24);
    y += 26;

    // Group individual items under the person's name.
    let lastPerson: string | null = null;
    for (const item of sectionItems) {
      const def = byItemId[item.itemId];
      if (!def) continue;
      if (item.individualName !== lastPerson) {
        lastPerson = item.individualName;
        if (lastPerson) {
          y = ensure(doc, y, 20, margin);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.text(`Individual: ${lastPerson}`, margin, y);
          y += 14;
        }
      }
      const resultLabel =
        item.result === "yes"
          ? "Yes"
          : item.result === "no"
            ? "No"
            : item.result === "na"
              ? "N/A"
              : item.result === "skipped"
                ? "Skipped"
                : "—";
      const sourceLabel = item.locked ? "System-verified" : "Auditor";
      const lines = doc.splitTextToSize(
        `${resultLabel} · ${sourceLabel} — ${def.text}`,
        width - 16,
      );
      y = ensure(doc, y, lines.length * 12 + 30, margin);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(lines, margin + 8, y);
      y += lines.length * 12 + 2;
      doc.setFontSize(8);
      doc.setTextColor(95, 81, 69);
      if (item.locked && item.systemEvidence) {
        const ev = doc.splitTextToSize(`Evidence: ${item.systemEvidence}`, width - 24);
        doc.text(ev, margin + 16, y);
        y += ev.length * 10 + 2;
      }
      if (item.comment) {
        const cm = doc.splitTextToSize(`Note: ${item.comment}`, width - 24);
        doc.text(cm, margin + 16, y);
        y += cm.length * 10 + 2;
      }
      if (item.disputeNote) {
        const dn = doc.splitTextToSize(
          `Dispute by ${item.disputeRaisedByName ?? "staff"}: ${item.disputeNote}`,
          width - 24,
        );
        doc.text(dn, margin + 16, y);
        y += dn.length * 10 + 2;
        const photoRefs = item.disputePhotos
          .map((p) => p.name)
          .filter(Boolean)
          .join(", ");
        if (photoRefs) {
          const pr = doc.splitTextToSize(`Photo evidence: ${photoRefs}`, width - 24);
          doc.text(pr, margin + 16, y);
          y += pr.length * 10 + 2;
        }
        if (item.disputeResolution) {
          const r = item.disputeResolution;
          const rr = doc.splitTextToSize(
            `Resolution (${r.resolvedByName ?? "auditor"}, ${r.resolvedAt ?? ""}): ${r.approved ? "Approved" : "Not approved"} — ${r.reason}`,
            width - 24,
          );
          doc.text(rr, margin + 16, y);
          y += rr.length * 10 + 2;
        }
      }
      doc.setTextColor(36, 30, 24);
      y += 6;
    }
    y += 8;
  }

  // Signatures.
  y = ensure(doc, y, 60, margin);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Signatures", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Auditor: ${audit.auditorSignatureName ?? audit.auditorName ?? "—"}`,
    margin,
    y,
  );
  y += 14;
  doc.text(`Signed at: ${audit.signedAt ?? "—"}`, margin, y);

  stampRecordMark(doc, {
    documentId: audit.id,
    generatedAt: new Date().toISOString(),
    margin,
    footerY: FOOTER_Y,
  });
  void PAGE_H;
  return doc;
}

export { qaFileName };
export { QA_ITEMS };
