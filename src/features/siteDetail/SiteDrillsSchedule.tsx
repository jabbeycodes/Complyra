import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { useData } from "../../data/DataProvider";
import { todayIso } from "../../data/chart";
import { openPrintable } from "../../data/openFile";
import { drillExportScopeLabel, drillScheduleYearSummary } from "../../data/drillSchedule";
import type { EmergencyDrill } from "../../data/monthlyChecks";
import DrillScheduleGrid from "./DrillScheduleVisual";
import "./siteDetail.css";

interface SiteDrillsScheduleProps {
  siteId: string;
  siteName: string;
  /** Existing drill records for this site (data model unchanged). */
  drills: EmergencyDrill[];
}

/**
 * Issue #94: the Drills section of the Checklists tab, rebuilt around the
 * agency's annual Emergency Drills Schedule. Visible to everyone who can open
 * the site detail page (gated by canSeeSiteDrills in the parent — the OLD
 * standalone-Drills-tab visibility, not the checklist-permissions gate).
 *
 * The schedule itself is rendered by DrillScheduleGrid (visual presentation);
 * this shell keeps the toolbar, month filter, and download/print export.
 */
export default function SiteDrillsSchedule({
  siteId,
  siteName,
  drills,
}: SiteDrillsScheduleProps) {
  const { api } = useData();
  const year = Number(todayIso().slice(0, 4));
  const currentMonth = Number(todayIso().slice(5, 7));
  const [monthFilter, setMonthFilter] = useState<number | "all">("all");
  const [busy, setBusy] = useState<"download" | "print" | null>(null);
  const [error, setError] = useState("");

  const months = useMemo(
    () => drillScheduleYearSummary(year, drills),
    [year, drills],
  );
  const visibleMonths = useMemo(
    () =>
      monthFilter === "all"
        ? months
        : months.filter((m) => m.month.month === monthFilter),
    [months, monthFilter],
  );
  const scopeLabel = drillExportScopeLabel(year, monthFilter);

  async function handleExport(mode: "download" | "print") {
    setBusy(mode);
    setError("");
    try {
      const file = await api.downloadDrillSchedule({
        siteId,
        year,
        month: monthFilter === "all" ? null : monthFilter,
      });
      await openPrintable(file.name, file.blob, mode);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not prepare the drills document.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel site-drills" aria-labelledby="site-drills-heading">
      <div className="panel-heading">
        <div>
          <h2 id="site-drills-heading">Emergency drills</h2>
          <p className="muted section-note">
            {`The agency's annual Emergency Drills Schedule for ${siteName}.`}
          </p>
          <p className="muted export-scope" aria-live="polite">
            Downloads and prints cover: {scopeLabel}
          </p>
        </div>
        <div className="drill-toolbar">
          <label>
            Month
            <select
              aria-label="Drills month filter"
              value={monthFilter === "all" ? "all" : String(monthFilter)}
              onChange={(e) =>
                setMonthFilter(e.target.value === "all" ? "all" : Number(e.target.value))
              }
            >
              <option value="all">All months</option>
              {months.map((m) => (
                <option key={m.month.month} value={m.month.month}>
                  {m.month.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            aria-label={`Download drill schedule — ${scopeLabel}`}
            onClick={() => void handleExport("download")}
          >
            <Download size={16} /> {busy === "download" ? "Preparing…" : "Download"}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            aria-label={`Print drill schedule — ${scopeLabel}`}
            onClick={() => void handleExport("print")}
          >
            <Printer size={16} /> {busy === "print" ? "Preparing…" : "Print"}
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <DrillScheduleGrid
        months={visibleMonths}
        currentMonth={currentMonth}
        year={year}
      />
    </section>
  );
}
