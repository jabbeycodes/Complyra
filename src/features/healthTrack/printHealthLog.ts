import {
  BLOOD_SUGAR_CONTEXT_LABELS,
  BOWEL_CONSISTENCY_LABELS,
  HEALTH_TRACK_KIND_LABELS,
  PORTION_LABELS,
  SKIN_OBSERVATION_LABELS,
  dayKeyOf,
  type HealthTrackDetails,
  type HealthTrackEntry,
  type HealthTrackKind,
} from "../../data/healthTrack";

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const AMOUNT_LABELS: Record<string, string> = {
  small: "Small",
  moderate: "Moderate",
  large: "Large",
};

function escapeHtml(value: string | number | null | undefined): string {
  if (value == null) return "—";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Kind-specific detail fields as plain [label, value] rows.
 * Flagged findings are spelled out in words (never color alone).
 */
export function healthEntryDetailRows(kind: HealthTrackKind, details: HealthTrackDetails): [string, string][] {
  const d = details as Record<string, unknown>;
  const text = (v: unknown) =>
    v == null || v === "" ? "—" : String(v);
  switch (kind) {
    case "meal":
      return [
        ["Meal", MEAL_TYPE_LABELS[d.mealType as string] ?? String(d.mealType ?? "—")],
        ["Portion eaten", PORTION_LABELS[d.portion as keyof typeof PORTION_LABELS] ?? "—"],
        ["What was served", text(d.items)],
        ["Appetite note", text(d.appetiteNote)],
      ];
    case "fluid":
      return [
        ["Drink", text(d.fluidType)],
        ["Ounces", String(d.ounces ?? "—")],
      ];
    case "bowel":
      return [
        ["Amount", AMOUNT_LABELS[d.amount as string] ?? "—"],
        ["Consistency", BOWEL_CONSISTENCY_LABELS[d.consistency as keyof typeof BOWEL_CONSISTENCY_LABELS] ?? "—"],
        ["Color", text(d.color)],
        ["Blood in stool", d.blood ? "Yes — flagged for review" : "No"],
        ["Pain", d.pain ? "Yes" : "No"],
        ["Notes", text(d.notes)],
      ];
    case "bladder":
      return [
        ["Continent", d.continent ? "Yes" : "No"],
        ["Amount", AMOUNT_LABELS[d.amount as string] ?? "—"],
        ["Notes", text(d.notes)],
      ];
    case "emesis":
      return [
        ["Amount", AMOUNT_LABELS[d.amount as string] ?? "—"],
        ["Description", text(d.description)],
      ];
    case "skin":
      return [
        ["Body location", text(d.bodyLocation)],
        ["Observation", SKIN_OBSERVATION_LABELS[d.observation as keyof typeof SKIN_OBSERVATION_LABELS] ?? "—"],
        ["Size", text(d.size)],
        ["Description", text(d.description)],
        ["New or getting worse", d.worsening ? "Yes — flagged for review" : "No"],
        ["Follow-up date", text(d.followUpDate)],
        ["Photo attached", (d as { photoId?: string }).photoId ? "Yes" : "No"],
      ];
    case "vitals": {
      const rows: [string, string][] = [];
      const num = (label: string, v: unknown, unit = "") =>
        rows.push([label, v == null || v === "" ? "—" : `${v}${unit}`]);
      num("Temperature", d.tempF, " °F");
      num(
        "Blood pressure",
        d.bpSystolic != null && d.bpSystolic !== ""
          ? `${d.bpSystolic}/${d.bpDiastolic ?? "?"}` 
          : "",
      );
      num("Pulse", d.pulse, " bpm");
      num("Respirations", d.respirations, " /min");
      num("O2 saturation", d.o2Sat, " %");
      num("Weight", d.weightLb, " lb");
      return rows;
    }
    case "seizure":
      return [
        ["Duration", d.durationMinutes != null && d.durationMinutes !== "" ? `${d.durationMinutes} min` : "—"],
        ["What it looked like", text(d.description)],
        ["Possible triggers", text(d.triggers)],
        ["After the seizure", text(d.postEventState)],
      ];
    case "menses":
      return [
        ["Start date", text(d.startDate)],
        ["End date", text(d.endDate)],
        ["Flow", text(d.flow)],
        ["Symptoms", text(d.symptoms)],
      ];
    case "blood_sugar":
      return [
        ["Reading", d.readingMgDl != null ? `${d.readingMgDl} mg/dL` : "—"],
        ["Context", BLOOD_SUGAR_CONTEXT_LABELS[d.context as keyof typeof BLOOD_SUGAR_CONTEXT_LABELS] ?? "—"],
        ["Symptoms", text(d.symptoms)],
      ];
    default:
      return [];
  }
}

function formatDateTime(iso: string): string {
  const day = dayKeyOf(iso);
  const time = iso.length > 13 ? iso.slice(11, 16) : "";
  return time ? `${day} ${time}` : day;
}

export interface HealthLogPrintOptions {
  agencyName: string;
  individualName: string;
  /** ISO yyyy-mm-dd, inclusive. */
  from?: string;
  /** ISO yyyy-mm-dd, inclusive. */
  to?: string;
  /** Newest-first entries to list. */
  entries: HealthTrackEntry[];
}

/**
 * Build a self-contained printable HTML health log. Everything is inline;
 * flagged entries and review state are stated in text (never color alone).
 */
export function buildHealthLogHtml(options: HealthLogPrintOptions): string {
  const { agencyName, individualName, entries } = options;
  const range =
    options.from || options.to
      ? `${options.from ?? "—"} to ${options.to ?? "—"}`
      : "All dates";
  const generatedAt = new Date().toISOString().slice(0, 16).replace("T", " ");

  const entryCards = entries
    .map((entry) => {
      const rows = healthEntryDetailRows(entry.kind, entry.details)
        .map(
          ([label, value]) =>
            `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join("");
      // Review state is only meaningful for entries flagged for review;
      // routine unflagged intake never enters the review queue.
      const reviewLine = entry.flagForNurse
        ? entry.nurseReviewedAt
          ? `<p class="review">Reviewed${entry.nurseReviewedBy ? ` (${escapeHtml(entry.nurseReviewedBy)})` : ""} on ${escapeHtml(entry.nurseReviewedAt.slice(0, 10))}${entry.nurseNote ? ` — note: ${escapeHtml(entry.nurseNote)}` : ""}.</p>`
          : `<p class="review pending">Not yet reviewed.</p>`
        : "";
      const flagLine = entry.flagForNurse
        ? `<p class="flag">Flagged for review: ${escapeHtml(entry.flagReason ?? "see details")}</p>`
        : "";
      return `<article class="entry">
        <header>
          <strong>${escapeHtml(HEALTH_TRACK_KIND_LABELS[entry.kind])}</strong>
          <span>${escapeHtml(formatDateTime(entry.occurredAt))}</span>
        </header>
        <table><tbody>${rows}</tbody></table>
        ${flagLine}
        <p class="meta">Recorded by ${escapeHtml(entry.recordedByName)} on ${escapeHtml(entry.createdAt.slice(0, 10))}.</p>
        ${reviewLine}
      </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Health log — ${escapeHtml(individualName)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; max-width: 760px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #333; margin-top: 0; }
  .entry { border: 1px solid #999; border-radius: 8px; padding: 12px 16px; margin: 16px 0; page-break-inside: avoid; }
  .entry header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 16px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-top: 1px solid #ccc; font-size: 14px; }
  th { width: 180px; color: #333; }
  .flag { font-weight: bold; border: 2px solid #111; padding: 6px 10px; border-radius: 6px; }
  .meta { font-size: 13px; color: #333; }
  .review { font-size: 14px; }
  .review.pending { font-weight: bold; }
  footer { margin-top: 32px; font-size: 13px; color: #333; border-top: 1px solid #999; padding-top: 8px; }
  @media print { .entry { box-shadow: none; } }
</style>
</head>
<body>
  <h1>Health log — ${escapeHtml(individualName)}</h1>
  <p class="sub">${escapeHtml(agencyName)} · Date range: ${escapeHtml(range)} · ${entries.length} ${entries.length === 1 ? "entry" : "entries"}</p>
  ${entries.length === 0 ? "<p>No health entries in this range.</p>" : entryCards}
  <footer>
    <p>Digital record generated by Complyrer · Generated ${escapeHtml(generatedAt)} UTC</p>
  </footer>
</body>
</html>`;
}

/** Stable filename for a downloaded log. */
export function healthLogFileName(individualName: string): string {
  const slug = individualName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "individual";
  return `${slug}-health-log.html`;
}
