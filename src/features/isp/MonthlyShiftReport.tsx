/**
 * Issue #96 — Monthly shift notes report.
 *
 * A manager-facing report for one calendar month against the ISP program that
 * was active that month: header block, numbered objectives, a day grid
 * (days 1..N as columns, score short label + staff initials per cell),
 * staff signature log, and the manager's monthly summary (draft -> signed ->
 * optionally re-opened). Print stylesheet renders it cleanly; PDF and CSV
 * downloads share the same data.
 *
 * Complyrer's own wording and layout — not a replica of any third-party form.
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */
import { useEffect, useRef, useState } from "react";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import type { ComplyraApi } from "../../data/localApi";
import {
  ispScheduleLabel,
  type IspProgramView,
  type ShiftNoteMonthlyReport,
  type ShiftNoteView,
} from "../../data/shiftNotes";
import {
  bucketNotesByDay,
  buildNotesCsv,
  buildWeeklyScoreSummary,
  canReopenMonthlySummary,
  canSignMonthlySummary,
  collectSignatureLog,
  dayCellEntries,
  daysInMonth,
  isValidMonthKey,
  monthDisplayLabel,
  notesInMonth,
  reportProgramForMonth,
  weekDayRangeLabel,
  type WeeklyScoreCounts,
} from "./monthlyReport";
import type { IspChartData } from "./useIspData";
import {
  buildShiftNoteMonthlyReportPdf,
  shiftNoteMonthlyReportFileName,
} from "../../pdf/shiftNoteMonthlyReportPdf";

function downloadFile(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Issue #96 — the "Weekly task score summary" chart: stacked solid-color
 * bars showing, per objective and per week, how many times the task was
 * scored Yes / No (with Refused and N/A-or-other as muted segments).
 * Inline CSS/SVG only — no chart library — so it survives print and PDF.
 */
const WEEKLY_BUCKET_META = [
  { key: "yes", label: "Yes", color: "#4d6b42" },
  { key: "no", label: "No", color: "#b56a4e" },
  { key: "refused", label: "Refused", color: "#b59a74" },
  { key: "other", label: "N/A or other", color: "#d8cbb6" },
] as const;

function weeklyCountsText(counts: WeeklyScoreCounts): string {
  const parts = [`${counts.yes} Y`, `${counts.no} N`];
  if (counts.refused > 0) parts.push(`${counts.refused} R`);
  if (counts.other > 0) parts.push(`${counts.other} N/A`);
  return parts.join(" · ");
}

function WeeklyScoreBar({
  weekLabel,
  counts,
}: {
  weekLabel: string;
  counts: WeeklyScoreCounts;
}) {
  const { total } = counts;
  const ariaLabel =
    total === 0
      ? `${weekLabel}: no scores recorded`
      : `${weekLabel}: ${counts.yes} yes, ${counts.no} no, ${counts.refused} refused, ${counts.other} N/A or other`;
  return (
    <div className="isp-weekly-row">
      <span className="isp-weekly-week">{weekLabel}</span>
      <div className="isp-weekly-bar" role="img" aria-label={ariaLabel} title={ariaLabel}>
        {total === 0 ? (
          <span className="isp-weekly-empty">No scores</span>
        ) : (
          WEEKLY_BUCKET_META.map((meta) => {
            const value = counts[meta.key];
            if (value === 0) return null;
            const width = (value / total) * 100;
            return (
              <span
                key={meta.key}
                className={`isp-weekly-seg isp-weekly-seg-${meta.key}`}
                style={{ width: `${width}%`, backgroundColor: meta.color }}
              >
                {width >= 14 ? value : ""}
              </span>
            );
          })
        )}
      </div>
      <span className="isp-weekly-counts">{total === 0 ? "—" : weeklyCountsText(counts)}</span>
    </div>
  );
}

export default function MonthlyShiftReport({
  individualId,
  individualName,
  individualIdLabel,
  siteName,
  agencyName,
  data,
  api,
  runIsp,
  sessionName,
  roleKey,
  canWriteSummary,
  staffTitleByUserId,
}: {
  individualId: string;
  individualName: string;
  individualIdLabel: string;
  siteName: string;
  agencyName: string;
  data: IspChartData;
  api: ComplyraApi;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
  sessionName: string;
  roleKey: string;
  canWriteSummary: boolean;
  staffTitleByUserId: Map<string, string>;
}) {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [loading, setLoading] = useState(false);
  const [monthNotes, setMonthNotes] = useState<ShiftNoteView[]>([]);
  const [report, setReport] = useState<ShiftNoteMonthlyReport | null>(null);
  const [narrative, setNarrative] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");
  const [error, setError] = useState("");
  // Issue #96 fix: native window.confirm() dialogs are auto-dismissed in
  // headless browsers (and block the main thread on mobile), so signing used
  // to silently no-op. Confirmation is now an inline two-step state.
  const [confirmingSign, setConfirmingSign] = useState(false);
  const [confirmingReopen, setConfirmingReopen] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isValidMonthKey(monthKey)) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setConfirmingSign(false);
    setConfirmingReopen(false);
    Promise.all([
      api.getShiftNotesForMonth(individualId, monthKey),
      api.getShiftNoteMonthlyReport(individualId, monthKey),
    ])
      .then(([notes, monthlyReport]) => {
        if (cancelled) return;
        setMonthNotes(notes);
        setReport(monthlyReport);
        setNarrative(monthlyReport?.narrative ?? "");
        setGeneratedAt(new Date().toISOString());
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, individualId, monthKey]);

  const program: IspProgramView | null = reportProgramForMonth(
    data.programs,
    individualId,
    monthKey,
  );
  const levels = [...(program?.scoringMethod?.levels ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const shortById = new Map(levels.map((level) => [level.id, level.shortLabel]));
  const tasks = program?.tasks ?? [];
  const notes = notesInMonth(monthNotes, monthKey);
  const buckets = bucketNotesByDay(notes);
  const dayCount = daysInMonth(monthKey);
  const signatures = collectSignatureLog(notes, staffTitleByUserId);
  const signed = (report?.signedAt ?? "") !== "";
  const captionById = new Map(levels.map((level) => [level.id, level.caption]));
  const weeklySummary = buildWeeklyScoreSummary(notes, tasks, captionById);

  const persist = (action: () => Promise<unknown>) =>
    runIsp(async () => {
      setError("");
      try {
        await action();
        const [freshNotes, freshReport] = await Promise.all([
          api.getShiftNotesForMonth(individualId, monthKey),
          api.getShiftNoteMonthlyReport(individualId, monthKey),
        ]);
        setMonthNotes(freshNotes);
        setReport(freshReport);
        setNarrative(freshReport?.narrative ?? "");
      } catch (err) {
        setError((err as Error).message);
        throw err;
      }
    });

  const handleSaveDraft = () => {
    if (!program) return;
    void persist(() =>
      api.saveShiftNoteMonthlyReport({
        individualId,
        programId: program.id,
        monthKey,
        narrative,
      }),
    );
  };

  const handleSignClick = () => {
    if (!report) return;
    setConfirmingSign(true);
  };

  const handleSignConfirm = () => {
    if (!program || !report) return;
    setConfirmingSign(false);
    // Persist the live textarea first, then lock it. Otherwise edits made after
    // the last Save are dropped and the signature stamps stale narrative.
    void persist(async () => {
      const saved = await api.saveShiftNoteMonthlyReport({
        individualId,
        programId: program.id,
        monthKey,
        narrative,
      });
      await api.signShiftNoteMonthlyReport(saved.id);
    });
  };

  const handleReopenClick = () => {
    if (!report) return;
    setConfirmingReopen(true);
  };

  const handleReopenConfirm = () => {
    if (!report) return;
    setConfirmingReopen(false);
    void persist(() => api.reopenShiftNoteMonthlyReport(report.id));
  };

  const handlePrint = () => {
    document.body.classList.add("isp-report-printing");
    const done = () => {
      document.body.classList.remove("isp-report-printing");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    // Fallback in case afterprint never fires.
    setTimeout(() => document.body.classList.remove("isp-report-printing"), 2000);
  };

  const handleDownloadPdf = () => {
    if (!program) return;
    const grid = tasks.map((task) =>
      Array.from({ length: dayCount }, (_, i) =>
        dayCellEntries(task.id, buckets.get(i + 1) ?? [], shortById),
      ),
    );
    const doc = buildShiftNoteMonthlyReportPdf({
      agencyName,
      individualName,
      individualIdLabel,
      siteName,
      monthLabel: monthDisplayLabel(monthKey),
      monthKey,
      generatedBy: sessionName,
      generatedAt,
      programName: program.name,
      scheduleLabel: ispScheduleLabel(program.schedule),
      scoringMethodName: program.scoringMethod?.name ?? "",
      tasks: tasks.map((task) => ({ title: task.title, instructions: task.instructions })),
      weekly: weeklySummary.map((taskWeek, taskIndex) => ({
        title: taskWeek.taskTitle,
        weeks: taskWeek.weeks.map((counts, weekIndex) => {
          const range = weekDayRangeLabel(monthKey, weekIndex + 1);
          return {
            label: range ? `Week ${weekIndex + 1} (${range})` : "",
            yes: counts.yes,
            no: counts.no,
            refused: counts.refused,
            other: counts.other,
          };
        }),
        taskNumber: taskIndex + 1,
      })),
      grid,
      signatures,
      // Serialize the live narrative so the PDF matches Print and the on-screen
      // textarea; fall back to the saved row for signature metadata.
      summary:
        report || narrative.trim()
          ? {
              narrative,
              signedByName: report?.signedByName ?? "",
              signedByTitle: report?.signedByTitle ?? "",
              signedAt: report?.signedAt ?? "",
            }
          : null,
    });
    doc.save(shiftNoteMonthlyReportFileName(individualName, monthKey));
  };

  const handleDownloadCsv = () => {
    if (!program) return;
    downloadFile(
      `complyrer-shift-notes-raw-${monthKey}.csv`,
      buildNotesCsv(
        notes,
        program.name,
        levels.map((level) => ({
          id: level.id,
          caption: level.caption,
          shortLabel: level.shortLabel,
        })),
      ),
      "text/csv;charset=utf-8",
    );
  };

  return (
    <div className="isp-monthly-report-block">
      <h3>Monthly report</h3>
      <p className="stack-help">
        Generate the month's shift notes against the ISP program that was active that month,
        add the manager's summary, then print or download it for the case manager.
      </p>
      <div className="isp-report-actions chart-actions">
        <label className="isp-filter-label">
          Month
          <input
            type="month"
            value={monthKey}
            max={currentMonthKey()}
            onChange={(e) => setMonthKey(e.target.value)}
            aria-label="Report month"
          />
        </label>
        <button type="button" className="button" onClick={handlePrint} disabled={!program}>
          Print
        </button>
        <button type="button" className="button" onClick={handleDownloadPdf} disabled={!program}>
          Download PDF
        </button>
        <button type="button" className="button" onClick={handleDownloadCsv} disabled={!program}>
          Download CSV
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading && <p className="muted">Loading report…</p>}
      {!loading && !program && (
        <p className="muted">
          No approved ISP program covered {monthDisplayLabel(monthKey)}. Notes for that month
          cannot be reported until a program is approved.
        </p>
      )}
      {!loading && program && (
        <div className="isp-monthly-report" ref={reportRef}>
          {/* Header block */}
          <header className="isp-report-header">
            <div className="isp-report-brand">COMPLYRER · {agencyName}</div>
            <h4>Shift Notes Monthly Report</h4>
            <dl className="isp-report-fields">
              <div>
                <dt>Individual</dt>
                <dd>{individualName}</dd>
              </div>
              <div>
                <dt>Individual ID</dt>
                <dd>{individualIdLabel}</dd>
              </div>
              <div>
                <dt>Site</dt>
                <dd>{siteName}</dd>
              </div>
              <div>
                <dt>Month</dt>
                <dd>{monthDisplayLabel(monthKey)}</dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>
                  {generatedAt ? generatedAt.slice(0, 16).replace("T", " ") : "—"} by {sessionName}
                </dd>
              </div>
            </dl>
          </header>

          {/* Program block */}
          <section className="isp-report-program">
            <h5>ISP program</h5>
            <dl className="isp-report-fields">
              <div>
                <dt>Program</dt>
                <dd>{program.name}</dd>
              </div>
              <div>
                <dt>Schedule</dt>
                <dd>{ispScheduleLabel(program.schedule)}</dd>
              </div>
              <div>
                <dt>Scoring method</dt>
                <dd>{program.scoringMethod?.name ?? "—"}</dd>
              </div>
            </dl>
            <ol className="isp-report-objectives">
              {tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  {task.instructions && <span className="muted"> — {task.instructions}</span>}
                </li>
              ))}
            </ol>
          </section>

          {/* Weekly task score summary chart */}
          <section className="isp-report-weekly">
            <h5>Weekly task score summary</h5>
            <p className="muted isp-report-grid-note">
              For each objective, how many times the task was scored Yes or No in each week of
              the month. Refused and N/A scores appear as muted segments so nothing is hidden.
            </p>
            <div className="isp-weekly-legend" aria-hidden="true">
              {WEEKLY_BUCKET_META.map((meta) => (
                <span key={meta.key} className="isp-weekly-legend-item">
                  <span
                    className="isp-weekly-swatch"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </span>
              ))}
            </div>
            {weeklySummary.map((taskWeek, taskIndex) => (
              <div className="isp-weekly-task" key={taskWeek.taskId}>
                <h6>
                  {taskIndex + 1}. {taskWeek.taskTitle}
                </h6>
                <div className="isp-weekly-rows">
                  {taskWeek.weeks.map((counts, weekIndex) => {
                    const range = weekDayRangeLabel(monthKey, weekIndex + 1);
                    if (!range) return null;
                    return (
                      <WeeklyScoreBar
                        key={weekIndex}
                        weekLabel={`Week ${weekIndex + 1} (days ${range})`}
                        counts={counts}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          {/* Day grid */}
          <section className="isp-report-grid-wrap">
            <h5>Daily scores</h5>
            <p className="muted isp-report-grid-note">
              Each cell shows the score short label and the staff initials for that day. Multiple
              notes stack in the cell.
            </p>
            <div className="isp-report-grid-scroll">
              <table className="isp-report-grid">
                <thead>
                  <tr>
                    <th scope="col">Objective</th>
                    {Array.from({ length: dayCount }, (_, i) => (
                      <th key={i + 1} scope="col">
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task, taskIndex) => (
                    <tr key={task.id}>
                      <th scope="row">
                        {taskIndex + 1}. {task.title}
                      </th>
                      {Array.from({ length: dayCount }, (_, i) => {
                        const entries = dayCellEntries(task.id, buckets.get(i + 1) ?? [], shortById);
                        return (
                          <td key={i + 1}>
                            {entries.map((entry, j) => (
                              <div key={j}>{entry}</div>
                            ))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Staff signature log */}
          <section className="isp-report-signatures">
            <h5>Staff signature log</h5>
            <p className="muted">
              Staff who recorded shift notes this month. Initials in the grid above map to this
              log.
            </p>
            {signatures.length === 0 ? (
              <p className="muted">No notes recorded this month.</p>
            ) : (
              <table className="isp-report-table">
                <thead>
                  <tr>
                    <th scope="col">Print name</th>
                    <th scope="col">Initials</th>
                    <th scope="col">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {signatures.map((sig) => (
                    <tr key={sig.staffUserId}>
                      <td>{sig.name}</td>
                      <td>{sig.initials}</td>
                      <td>{sig.title || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Manager summary */}
          <section className="isp-report-summary">
            <h5>Monthly summary</h5>
            {signed && report ? (
              <>
                <p className="isp-report-narrative">{report.narrative}</p>
                <p className="muted">
                  Signed by {report.signedByName}
                  {report.signedByTitle && `, ${report.signedByTitle}`} on{" "}
                  {report.signedAt.slice(0, 10)}.
                </p>
                {canReopenMonthlySummary(roleKey, report.signedAt) && (
                  <div className="chart-actions isp-report-actions">
                    {confirmingReopen ? (
                      <>
                        <span className="isp-report-confirm-text">
                          Re-open for editing? The signature will be cleared.
                        </span>
                        <button
                          type="button"
                          className="button primary"
                          onClick={handleReopenConfirm}
                        >
                          Confirm re-open
                        </button>
                        <button
                          type="button"
                          className="button"
                          onClick={() => setConfirmingReopen(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className="button" onClick={handleReopenClick}>
                        Re-open summary
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : canWriteSummary ? (
              <>
                <label>
                  <span className="isp-report-summary-label">
                    Describe the Individual's response to services this month, plus any issues or
                    concerns.
                  </span>
                  <textarea
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    rows={6}
                    placeholder="Monthly narrative for the case manager…"
                  />
                </label>
                <div className="chart-actions isp-report-actions">
                  <button type="button" className="button primary" onClick={handleSaveDraft}>
                    Save summary
                  </button>
                  {confirmingSign ? (
                    <>
                      <span className="isp-report-confirm-text">
                        Sign this summary? It will be locked. A PM or administrator can re-open it
                        later.
                      </span>
                      <button
                        type="button"
                        className="button primary"
                        onClick={handleSignConfirm}
                      >
                        Confirm sign
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => setConfirmingSign(false)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      onClick={handleSignClick}
                      disabled={!canSignMonthlySummary(roleKey, report?.signedAt ?? "") || !report}
                      title={!report ? "Save the summary first, then sign it." : undefined}
                    >
                      Sign summary
                    </button>
                  )}
                </div>
                {!report && (
                  <p className="muted">Save the summary first, then sign it to lock the report.</p>
                )}
              </>
            ) : (
              <p className="muted">
                {report?.narrative
                  ? report.narrative
                  : "No summary written yet. A program manager or administrator writes the monthly summary."}
              </p>
            )}
          </section>

          <ComplyrerRecordMark
            documentId={`shift-notes-monthly-${monthKey}`}
            generatedAt={generatedAt || null}
          />
        </div>
      )}
    </div>
  );
}
