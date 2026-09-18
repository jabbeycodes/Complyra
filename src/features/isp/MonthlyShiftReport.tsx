/**
 * Issue #96 — Monthly shift notes report.
 *
 * A manager-facing report for one calendar month against the ISP program that
 * was active that month: header block, ISP program block with numbered
 * objectives, a "Monthly score summary" (Yes/No count clarity for the whole
 * month plus a per-week breakdown — the clearer view Therap's version lacks),
 * a day grid (days 1..N as columns, score short label + staff initials per
 * cell), staff signature log, and the data collection monthly summary note
 * (draft -> signed -> optionally re-opened). Print stylesheet renders it
 * cleanly; PDF and CSV downloads share the same data.
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
  buildObjectiveScoreSummary,
  canReopenMonthlySummary,
  canSignMonthlySummary,
  collectSignatureLog,
  dayCellEntries,
  daysInMonth,
  isValidMonthKey,
  monthDisplayLabel,
  notesInMonth,
  reportProgramForMonth,
  type ObjectiveScoreSummary,
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

/** Figures-first summary: month totals first, then the per-week breakdown. */
function MonthlyScoreSummaryTables({ summary }: { summary: ObjectiveScoreSummary[] }) {
  if (summary.length === 0) return null;
  return (
    <div className="isp-report-score">
      <table className="isp-report-table isp-report-score-month">
        <caption className="isp-report-score-caption">
          Whole-month totals per objective. Refused and N/A scores are counted
          separately — never folded into Yes/No. Days with no score appear as
          unscored, never dropped.
        </caption>
        <thead>
          <tr>
            <th scope="col">Objective</th>
            <th scope="col">Yes</th>
            <th scope="col">No</th>
            <th scope="col">Refused</th>
            <th scope="col">N/A</th>
            <th scope="col">Days scored</th>
            <th scope="col">Days unscored</th>
            <th scope="col">Yes %</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((objective) => (
            <tr key={objective.taskId}>
              <th scope="row">
                {objective.taskNumber}. {objective.taskTitle}
              </th>
              <td>{objective.yes}</td>
              <td>{objective.no}</td>
              <td>{objective.refused}</td>
              <td>{objective.other}</td>
              <td>{objective.daysScored}</td>
              <td>{objective.daysUnscored}</td>
              <td>{objective.yesPercent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.map((objective) => (
        <div className="isp-report-score-weekly" key={objective.taskId}>
          <h6>
            {objective.taskNumber}. {objective.taskTitle} — weekly breakdown
          </h6>
          <table className="isp-report-table">
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Days</th>
                <th scope="col">Yes</th>
                <th scope="col">No</th>
                <th scope="col">Refused</th>
                <th scope="col">N/A</th>
              </tr>
            </thead>
            <tbody>
              {objective.weeks.map((week) => {
                if (!week.dayRange) return null;
                return (
                  <tr key={week.week}>
                    <th scope="row">Week {week.week}</th>
                    <td>{week.dayRange}</td>
                    <td>{week.yes}</td>
                    <td>{week.no}</td>
                    <td>{week.refused}</td>
                    <td>{week.other}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
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

  /** Push a loaded report row into all editable state (manager fields). */
  const applyReportToState = (monthlyReport: ShiftNoteMonthlyReport | null) => {
    setReport(monthlyReport);
    setNarrative(monthlyReport?.narrative ?? "");
  };

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
        applyReportToState(monthlyReport);
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
  const scoreSummary = buildObjectiveScoreSummary(notes, tasks, captionById, monthKey);

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
        applyReportToState(freshReport);
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
      scoreSummary: scoreSummary.map((objective) => ({
        taskNumber: objective.taskNumber,
        title: objective.taskTitle,
        yes: objective.yes,
        no: objective.no,
        refused: objective.refused,
        other: objective.other,
        daysScored: objective.daysScored,
        daysUnscored: objective.daysUnscored,
        yesPercent: objective.yesPercent,
        weeks: objective.weeks.map((week) => ({
          week: week.week,
          dayRange: week.dayRange,
          yes: week.yes,
          no: week.no,
          refused: week.refused,
          other: week.other,
        })),
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
        scoreSummary,
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

          {/* Monthly score summary — the figures-first view: Yes/No count
              clarity for the whole month plus a per-week breakdown. No color
              or pattern carries meaning; the numbers stand on their own in
              plain black-and-white print. */}
          <section className="isp-report-score">
            <h5>Monthly score summary</h5>
            <p className="muted isp-report-grid-note">
              Yes/No counts for each objective — the whole month first, then
              broken down week by week. Refused and N/A scores are counted
              separately, never folded into Yes/No. Days with no score appear
              as unscored.
            </p>
            <MonthlyScoreSummaryTables summary={scoreSummary} />
          </section>

          {/* Day grid */}
          <section className="isp-report-grid-wrap">
            <h5>Daily scores</h5>
            <p className="muted isp-report-grid-note">
              Each cell shows the score short label and the staff initials for that day. Multiple
              notes stack in the cell.
            </p>
            <p className="isp-report-attestation">
              STAFF PROVIDING SERVICE/ACTION MUST INITIAL THE DATE THE SERVICE/ACTION WAS
              PROVIDED.
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

          {/* Data collection monthly summary note */}
          <section className="isp-report-summary">
            <h5>Data collection monthly summary note</h5>
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
