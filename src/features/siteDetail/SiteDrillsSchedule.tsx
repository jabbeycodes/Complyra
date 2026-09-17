import { useMemo, useState } from "react";
import { ChevronDown, Download, Printer } from "lucide-react";
import { Badge, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { todayIso } from "../../data/chart";
import { openPrintable } from "../../data/openFile";
import {
  DRILL_DUE_DAY,
  DRILL_QUARTER_RESPONSIBILITIES,
  DRILLS_DUE_RULE,
  MEDICAL_EMERGENCY_RULE,
  drillScheduleYearSummary,
  quarterResponsibilityForMonth,
  scheduleMonthLabel,
  type ScheduledDrillState,
} from "../../data/drillSchedule";
import type { EmergencyDrill } from "../../data/monthlyChecks";
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

  async function handleExport(mode: "download" | "print") {
    setBusy(mode);
    setError("");
    try {
      const file = await api.downloadDrillSchedule({ siteId, year });
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
            The agency&apos;s annual Emergency Drills Schedule for {siteName}. Each
            month lists its shift window and the drills to be completed.{" "}
            {DRILLS_DUE_RULE} Drills recorded after the {DRILL_DUE_DAY}th are
            accepted but flagged late.
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
            onClick={() => void handleExport("download")}
          >
            <Download size={16} /> {busy === "download" ? "Preparing…" : "Download"}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
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

      <ul className="drill-rules" aria-label="Drill schedule rules">
        {DRILL_QUARTER_RESPONSIBILITIES.map((q) => (
          <li key={q.label}>
            <strong>{q.label}</strong> ({q.months}): {q.responsibility}
          </li>
        ))}
        <li>
          <em>* {MEDICAL_EMERGENCY_RULE}</em>
        </li>
      </ul>

      <div className="drill-months">
        {visibleMonths.map((summary) => {
          const isCurrent = summary.month.month === currentMonth;
          const quarter = quarterResponsibilityForMonth(summary.month.month);
          return (
            <article
              key={summary.month.month}
              className={`drill-month${isCurrent ? " drill-month-current" : ""}`}
              aria-label={`${summary.month.name} drills`}
            >
              <header className="drill-month-head">
                <div>
                  <h3>
                    {summary.month.name}
                    {isCurrent && <span className="drill-current-tag">Current month</span>}
                  </h3>
                  <p className="muted">
                    {summary.month.shiftWindow} · {quarter.responsibility}
                  </p>
                </div>
                <Badge
                  status={
                    summary.allComplete
                      ? "Complete"
                      : isCurrent
                        ? "Due soon"
                        : "Not logged"
                  }
                />
              </header>
              {summary.month.allStaffMedicalMonth && (
                <p className="muted drill-medical-note">
                  <em>* {MEDICAL_EMERGENCY_RULE}</em>
                </p>
              )}
              <ul className="drill-rows">
                {summary.states.map((state) => (
                  <DrillRow key={state.type} state={state} />
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DrillRow({ state }: { state: ScheduledDrillState }) {
  const [open, setOpen] = useState(false);
  const record = state.record;
  const label = `${scheduleMonthLabel(state.type)} drill`;
  const statusBadge = state.status === "complete" ? "Complete" : "Not logged";
  const detailId = `drill-detail-${state.type}-${record?.id ?? "none"}`;

  return (
    <li className="drill-row">
      <button
        type="button"
        className="drill-row-toggle"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="drill-row-title">
          <strong>{label}</strong>
          {record?.date && (
            <span className="muted"> · {formatDate(record.date)}</span>
          )}
        </span>
        <span className="drill-row-badges">
          <Badge status={statusBadge} />
          {state.late && <Badge status="Late" />}
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`drill-chevron${open ? " drill-chevron-open" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div id={detailId} className="drill-row-detail">
          {record ? (
            <dl className="fact-list drill-facts">
              <div>
                <dt>Date</dt>
                <dd>{record.date ? formatDate(record.date) : "Not logged"}</dd>
              </div>
              {record.time && (
                <div>
                  <dt>Time</dt>
                  <dd>{record.time}</dd>
                </div>
              )}
              <div>
                <dt>Evacuation time</dt>
                <dd>{record.evacTime || "—"}</dd>
              </div>
              <div>
                <dt>Drill leader</dt>
                <dd>{record.leaderName || "—"}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{record.participants || "—"}</dd>
              </div>
              {state.late && (
                <div>
                  <dt>Flag</dt>
                  <dd>
                    Recorded after the {DRILL_DUE_DAY}th — accepted, flagged late.
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">Not logged for this month yet.</p>
          )}
        </div>
      )}
    </li>
  );
}
