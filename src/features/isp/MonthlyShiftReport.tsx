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
import { useEffect, useId, useRef, useState } from "react";
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
  buildObjectiveProgress,
  buildWeeklyScoreSummary,
  canReopenMonthlySummary,
  canSignMonthlySummary,
  collectSignatureLog,
  dayCellEntries,
  daysInMonth,
  emptySupportCoordinatorSignatures,
  isValidMonthKey,
  monthDisplayLabel,
  notesInMonth,
  objectiveProgressLine,
  patternKeyForBucket,
  reportProgramForMonth,
  weekDayRangeLabel,
  type ScoreBucket,
  type SupportCoordinatorSignatures,
  type WeeklyPatternKey,
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
 * Issue #96 — the "Weekly task score summary" chart: stacked bars showing,
 * per objective and per week, how many times the task was scored Yes / No
 * (with Refused and N/A-or-other segments).
 *
 * B&W-safe: color does not survive plain black-and-white printing, so no
 * information rides on color alone. Each bucket gets a distinct SVG fill
 * pattern (diagonal hatch / cross-hatch / dots / light gray) and the text
 * summary next to every bar carries the exact counts.
 * Inline SVG only — no chart library — so it survives print and PDF.
 */
const WEEKLY_BUCKET_META = [
  { key: "yes", label: "Yes", pattern: "hatch" },
  { key: "no", label: "No", pattern: "crosshatch" },
  { key: "refused", label: "Refused", pattern: "dots" },
  { key: "other", label: "N/A or other", pattern: "lightgray" },
] as const;

/** Shared SVG fill patterns for the B&W-safe weekly chart. Rendered once
 * (zero-size) per chart; bars and legend swatches reference by id. */
function WeeklyChartPatterns({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      <pattern
        id={`${idPrefix}-hatch`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
      >
        <rect width="6" height="6" fill="#ffffff" />
        <path d="M0 6 L6 0" stroke="#111111" strokeWidth="1.6" />
      </pattern>
      <pattern
        id={`${idPrefix}-crosshatch`}
        width="7"
        height="7"
        patternUnits="userSpaceOnUse"
      >
        <rect width="7" height="7" fill="#ffffff" />
        <path d="M0 7 L7 0 M0 0 L7 7" stroke="#111111" strokeWidth="1.1" />
      </pattern>
      <pattern
        id={`${idPrefix}-dots`}
        width="6"
        height="6"
        patternUnits="userSpaceOnUse"
      >
        <rect width="6" height="6" fill="#ffffff" />
        <circle cx="3" cy="3" r="1.2" fill="#111111" />
      </pattern>
      <pattern
        id={`${idPrefix}-lightgray`}
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
      >
        <rect width="4" height="4" fill="#dcdcdc" />
      </pattern>
    </defs>
  );
}

function weeklyCountsText(counts: WeeklyScoreCounts): string {
  const parts = [`${counts.yes} Y`, `${counts.no} N`];
  if (counts.refused > 0) parts.push(`${counts.refused} R`);
  if (counts.other > 0) parts.push(`${counts.other} N/A`);
  return parts.join(" · ");
}

function WeeklyScoreBar({
  idPrefix,
  weekLabel,
  counts,
}: {
  idPrefix: string;
  weekLabel: string;
  counts: WeeklyScoreCounts;
}) {
  const { total } = counts;
  const ariaLabel =
    total === 0
      ? `${weekLabel}: no scores recorded`
      : `${weekLabel}: ${counts.yes} yes, ${counts.no} no, ${counts.refused} refused, ${counts.other} N/A or other`;
  let cursor = 0;
  return (
    <div className="isp-weekly-row">
      <span className="isp-weekly-week">{weekLabel}</span>
      {total === 0 ? (
        <div className="isp-weekly-bar" role="img" aria-label={ariaLabel}>
          <span className="isp-weekly-empty">No scores</span>
        </div>
      ) : (
        <svg
          className="isp-weekly-bar-svg"
          height="22"
          role="img"
          aria-label={ariaLabel}
        >
          {WEEKLY_BUCKET_META.map((meta) => {
            const value = counts[meta.key];
            if (value === 0) return null;
            const width = (value / total) * 100;
            const x = cursor;
            cursor += width;
            return (
              <g key={meta.key}>
                <rect
                  x={`${x}%`}
                  y="0"
                  width={`${width}%`}
                  height="22"
                  fill={`url(#${idPrefix}-${meta.pattern})`}
                  stroke="#111111"
                  strokeWidth="0.75"
                />
                {width >= 14 && (
                  <text
                    x={`${x + width / 2}%`}
                    y="15"
                    textAnchor="middle"
                    className="isp-weekly-seg-text"
                  >
                    {value}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
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
  // Issue #96 follow-up — support-coordinator summary fields. Editable while
  // the report is unsigned; locked with the report on sign (same lifecycle
  // as the manager's narrative).
  const [scNarratives, setScNarratives] = useState<Record<string, string>>({});
  const [scOverall, setScOverall] = useState("");
  const [scSigs, setScSigs] = useState<SupportCoordinatorSignatures>(
    emptySupportCoordinatorSignatures(),
  );
  const patternPrefix = useId().replace(/[^a-zA-Z0-9]/g, "p");
  // Issue #96 fix: native window.confirm() dialogs are auto-dismissed in
  // headless browsers (and block the main thread on mobile), so signing used
  // to silently no-op. Confirmation is now an inline two-step state.
  const [confirmingSign, setConfirmingSign] = useState(false);
  const [confirmingReopen, setConfirmingReopen] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  /** Push a loaded report row into all editable state (manager + SC fields). */
  const applyReportToState = (monthlyReport: ShiftNoteMonthlyReport | null) => {
    setReport(monthlyReport);
    setNarrative(monthlyReport?.narrative ?? "");
    const byTask: Record<string, string> = {};
    for (const entry of monthlyReport?.scObjectiveNarratives ?? []) {
      byTask[entry.taskId] = entry.narrative;
    }
    setScNarratives(byTask);
    setScOverall(monthlyReport?.scOverallNarrative ?? "");
    setScSigs(monthlyReport?.scSignatures ?? emptySupportCoordinatorSignatures());
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
  const weeklySummary = buildWeeklyScoreSummary(notes, tasks, captionById);
  const scProgress = buildObjectiveProgress(notes, tasks, captionById);
  const scLocked = signed || !canWriteSummary;

  /** Support-coordinator fields for the save payload (live editor state). */
  const scSaveFields = () => ({
    scObjectiveNarratives: tasks
      .map((task) => ({
        taskId: task.id,
        narrative: (scNarratives[task.id] ?? "").trim(),
      }))
      .filter((entry) => entry.narrative !== ""),
    scOverallNarrative: scOverall.trim(),
    scSignatures: scSigs,
  });

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
        ...scSaveFields(),
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
        ...scSaveFields(),
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
      scSummary: {
        objectives: scProgress.map((progress) => ({
          taskNumber: progress.taskNumber,
          title: progress.taskTitle,
          progressLine: objectiveProgressLine(progress),
          narrative: (scNarratives[progress.taskId] ?? "").trim(),
        })),
        overallNarrative: scOverall.trim(),
        signatures: [
          { role: "Support Coordinator", ...scSigs.supportCoordinator },
          { role: "Provider", ...scSigs.provider },
          { role: "Professional Manager", ...scSigs.professionalManager },
        ],
      },
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
        {
          individualName,
          individualIdLabel,
          siteName,
          monthLabel: monthDisplayLabel(monthKey),
          progress: scProgress,
          objectiveNarratives: tasks.map((task) => ({
            taskId: task.id,
            narrative: (scNarratives[task.id] ?? "").trim(),
          })),
          overallNarrative: scOverall.trim(),
          signatures: scSigs,
        },
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
              For each objective, how many times the task was scored Yes, No, Refused, or
              N/A in each week of the month. Each score type has its own fill pattern so
              the chart reads in plain black-and-white print; the counts beside each bar
              carry the exact numbers.
            </p>
            <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
              <WeeklyChartPatterns idPrefix={patternPrefix} />
            </svg>
            <div className="isp-weekly-legend" aria-hidden="true">
              {WEEKLY_BUCKET_META.map((meta) => (
                <span key={meta.key} className="isp-weekly-legend-item">
                  <svg className="isp-weekly-swatch" width="14" height="14" aria-hidden="true">
                    <rect
                      x="0.5"
                      y="0.5"
                      width="13"
                      height="13"
                      fill={`url(#${patternPrefix}-${meta.pattern})`}
                      stroke="#111111"
                      strokeWidth="1"
                    />
                  </svg>
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
                        idPrefix={patternPrefix}
                        weekLabel={`Week ${weekIndex + 1} (days ${range})`}
                        counts={counts}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </section>

          {/* Monthly summary for support coordinator */}
          <section className="isp-report-sc">
            <h5>Monthly summary for support coordinator</h5>
            <p className="muted isp-report-grid-note">
              Progress on each ISP objective this month, computed from shift note scores,
              with narratives and signatures for the support coordinator's monthly review.
            </p>
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
                <dt>Month</dt>
                <dd>{monthDisplayLabel(monthKey)}</dd>
              </div>
              <div>
                <dt>Site</dt>
                <dd>{siteName}</dd>
              </div>
            </dl>
            <div className="isp-report-sc-objectives">
              {scProgress.map((progress) => {
                const objectiveNarrative = scNarratives[progress.taskId] ?? "";
                return (
                  <div className="isp-report-sc-objective" key={progress.taskId}>
                    <h6>
                      {progress.taskNumber}. {progress.taskTitle}
                    </h6>
                    <p className="isp-report-sc-progress">{objectiveProgressLine(progress)}</p>
                    {scLocked ? (
                      objectiveNarrative.trim() ? (
                        <p className="isp-report-narrative">{objectiveNarrative}</p>
                      ) : (
                        <p className="muted">No narrative recorded.</p>
                      )
                    ) : (
                      <label>
                        <span className="isp-report-summary-label">
                          Progress notes for this objective
                        </span>
                        <textarea
                          value={objectiveNarrative}
                          onChange={(e) =>
                            setScNarratives((prev) => ({
                              ...prev,
                              [progress.taskId]: e.target.value,
                            }))
                          }
                          rows={3}
                          placeholder="How did the Individual progress on this objective this month?"
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="isp-report-sc-overall">
              <h6>Overall status</h6>
              {scLocked ? (
                scOverall.trim() ? (
                  <p className="isp-report-narrative">{scOverall}</p>
                ) : (
                  <p className="muted">No overall status recorded.</p>
                )
              ) : (
                <label>
                  <span className="isp-report-summary-label">
                    Overall status for the support coordinator
                  </span>
                  <textarea
                    value={scOverall}
                    onChange={(e) => setScOverall(e.target.value)}
                    rows={4}
                    placeholder="Overall status, health and safety notes, and follow-ups for the month…"
                  />
                </label>
              )}
            </div>
            <div className="isp-report-sc-signatures">
              <h6>Signatures</h6>
              {(
                [
                  { key: "supportCoordinator", label: "Support Coordinator" },
                  { key: "provider", label: "Provider" },
                  { key: "professionalManager", label: "Professional Manager" },
                ] as const
              ).map(({ key, label }) => (
                <div
                  className="isp-report-sc-sig"
                  key={key}
                  role="group"
                  aria-label={label}
                >
                  <span className="isp-report-sc-sig-role" aria-hidden="true">
                    {label}
                  </span>
                  {scLocked ? (
                    <span className="isp-report-sc-sig-locked">
                      {scSigs[key].name || "—"}
                      {scSigs[key].date ? ` — ${scSigs[key].date}` : ""}
                    </span>
                  ) : (
                    <>
                      <label>
                        <span className="isp-report-summary-label">Name</span>
                        <input
                          type="text"
                          value={scSigs[key].name}
                          onChange={(e) =>
                            setScSigs((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], name: e.target.value },
                            }))
                          }
                          placeholder="Print name"
                        />
                      </label>
                      <label>
                        <span className="isp-report-summary-label">Date</span>
                        <input
                          type="date"
                          value={scSigs[key].date}
                          onChange={(e) =>
                            setScSigs((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], date: e.target.value },
                            }))
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              ))}
              {signed && report && (
                <p className="muted">
                  Locked with the report — signed by {report.signedByName} on{" "}
                  {report.signedAt.slice(0, 10)}. Re-open the summary to edit.
                </p>
              )}
            </div>
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
