import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import { blankMonthlySections } from "../../data/ispData";
import {
  buildIspMonthlyPdf,
  ispMonthlyFileName,
} from "../../pdf/ispMonthlyPdf";
import type {
  IspMonthlyReport,
  IspMonthlySections,
  IspMonthlySignature,
  IspMonthlySignerRole,
  IspMonthlyStatus,
} from "../../data/types";
import "./ispData.css";

const SECTION_LABELS: { key: keyof IspMonthlySections; label: string }[] = [
  { key: "selfDetermination", label: "Self-determination" },
  { key: "healthMedical", label: "Health / medical" },
  { key: "rights", label: "Rights" },
  { key: "communityActivities", label: "Community activities" },
  { key: "supportCoordinator", label: "Support coordinator notes" },
  { key: "personVisitedDates", label: "Person visited — dates" },
  { key: "overallConcerns", label: "Overall concerns" },
  { key: "changesNeeded", label: "Changes needed" },
  { key: "rnFollowUp", label: "RN follow-up" },
];

const SIGNER_ROLES: { role: IspMonthlySignerRole; label: string }[] = [
  { role: "preparer", label: "Preparer" },
  { role: "hm", label: "House manager" },
  { role: "pm", label: "Program manager" },
  { role: "support_coordinator", label: "Support coordinator" },
  { role: "individual", label: "Individual" },
];

const NEXT_STEP: Record<IspMonthlyStatus, { next: IspMonthlyStatus; label: string } | null> = {
  draft: { next: "hm_review", label: "Submit to HM" },
  hm_review: { next: "dpm_review", label: "Submit to DPM" },
  dpm_review: { next: "sc_review", label: "Submit to SC" },
  sc_review: { next: "finalized", label: "Finalize" },
  finalized: null,
};

const STATUS_LABELS: Record<IspMonthlyStatus, string> = {
  draft: "Draft",
  hm_review: "With house manager",
  dpm_review: "With DPM",
  sc_review: "With support coordinator",
  finalized: "Finalized",
};

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function serviceMonthOf(monthKey: string): string {
  return `${monthKey}-01`;
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function MonthlyWorkspace({
  individualId,
  individualName,
  agencyName,
}: {
  individualId: string;
  individualName: string;
  agencyName: string;
}) {
  const isp = useIspApi();
  const { session } = useData();
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [report, setReport] = useState<IspMonthlyReport | null>(null);
  const [signatures, setSignatures] = useState<IspMonthlySignature[]>([]);
  const [sections, setSections] = useState<IspMonthlySections>(() =>
    blankMonthlySections(""),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedFlash, setSavedFlash] = useState("");

  const canReview = !!session && can(session, "isp.review_monthly");
  const finalized = report?.status === "finalized";

  async function reload(targetMonth = monthKey) {
    setLoading(true);
    setError("");
    try {
      const rep = await isp.ispGetMonthlyReport(
        individualId,
        serviceMonthOf(targetMonth),
      );
      setReport(rep);
      if (rep) {
        setSections(rep.sections);
        setSignatures(await isp.ispListMonthlySignatures(rep.id));
      } else {
        setSections(blankMonthlySections(""));
        setSignatures([]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the report.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [individualId, monthKey]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const rep = await isp.ispGenerateMonthlyReport(
        individualId,
        serviceMonthOf(monthKey),
      );
      setReport(rep);
      setSections(rep.sections);
      setSignatures(await isp.ispListMonthlySignatures(rep.id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate the report.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSections() {
    if (!report || finalized) return;
    setBusy(true);
    setError("");
    try {
      await isp.ispUpdateMonthlySections(report.id, sections);
      setSavedFlash("Saved.");
      setTimeout(() => setSavedFlash(""), 2500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the sections.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!report) return;
    const step = NEXT_STEP[report.status];
    if (!step) return;
    setBusy(true);
    setError("");
    try {
      await isp.ispSubmitMonthlyForReview(report.id, step.next);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not move the report forward.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sign(role: IspMonthlySignerRole) {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      await isp.ispSignMonthlyReport(report.id, role);
      setSignatures(await isp.ispListMonthlySignatures(report.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign.");
    } finally {
      setBusy(false);
    }
  }

  function printPdf() {
    if (!report) return;
    const doc = buildIspMonthlyPdf({
      agencyName,
      individualName,
      report,
      signatures,
    });
    doc.save(ispMonthlyFileName(individualName, monthKey));
  }

  const tallies = useMemo(() => report?.tallies ?? null, [report]);
  const nextStep = report ? NEXT_STEP[report.status] : null;

  if (loading) return <div className="isp-panel">Loading monthly report…</div>;

  return (
    <div className="isp-wrap">
      <div className="isp-panel">
        <h3>Monthly report — {individualName}</h3>
        <p className="isp-sub">
          Tallies are computed from the month's shift notes automatically. The
          nine sections below are Missouri's monthly summary sections.
        </p>
        <div className="isp-picker-row">
          <label>
            Service month
            <input
              type="month"
              value={monthKey}
              onChange={(e) => e.target.value && setMonthKey(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </label>
          {report && (
            <span className="isp-status-chip">
              {STATUS_LABELS[report.status]}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
            {error}
          </p>
        )}

        {!report ? (
          <div style={{ marginTop: 16 }}>
            <Empty
              title={`No report for ${monthLabel(monthKey)}`}
              text="Generate the draft to compute tallies from this month's notes."
            />
            {canReview && (
              <div className="isp-btn-row">
                <button
                  type="button"
                  className="isp-btn primary"
                  onClick={() => void generate()}
                  disabled={busy}
                >
                  Generate monthly report
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <h3 style={{ marginTop: 24 }}>
              Auto tallies — {monthLabel(monthKey)}
            </h3>
            <div className="isp-table-wrap">
              <table className="isp-table">
                <thead>
                  <tr>
                    <th>Objective</th>
                    <th>Goal</th>
                    <th>Opportunities</th>
                    <th>Completions</th>
                    <th>Refusals</th>
                    <th>Success rate</th>
                    <th>Avg rating</th>
                    <th>Total count</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {(tallies?.perObjective ?? []).map((t) => (
                    <tr key={t.objectiveId}>
                      <td>{t.objectiveTitle}</td>
                      <td>{t.goalTitle}</td>
                      <td>{t.opportunities}</td>
                      <td>{t.completions}</td>
                      <td>{t.refusals}</td>
                      <td>
                        {t.successRate == null
                          ? "—"
                          : `${Math.round(t.successRate * 100)}%`}
                      </td>
                      <td>
                        {t.avgRating == null ? "—" : t.avgRating.toFixed(1)}
                      </td>
                      <td>{t.totalCount}</td>
                      <td>{t.trend ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="isp-table-wrap"
              style={{ marginTop: 12, fontSize: 14 }}
            >
              <div>
                <strong>Notes:</strong> {tallies?.notesSubmitted ?? 0}{" "}
                submitted of {tallies?.notesExpected ?? 0} expected ·{" "}
                {tallies?.notesLate ?? 0} late · {tallies?.notesMissing ?? 0}{" "}
                missing
              </div>
              {tallies?.narrativeRollup && (
                <p style={{ marginTop: 8 }}>{tallies.narrativeRollup}</p>
              )}
            </div>

            <h3 style={{ marginTop: 24 }}>Program progress</h3>
            <div className="isp-table-wrap">
              <table className="isp-table isp-progress-table">
                <thead>
                  <tr>
                    <th>Objective</th>
                    <th>Tally summary</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.programProgress.map((row, i) => (
                    <tr key={row.objectiveId}>
                      <td>
                        <strong>{row.objectiveTitle}</strong>
                        <br />
                        <span style={{ fontSize: 13, color: "#4a4036" }}>
                          {row.goalTitle}
                        </span>
                      </td>
                      <td style={{ fontSize: 14 }}>{row.tallySummary}</td>
                      <td>
                        {finalized ? (
                          <div>
                            <div>{row.progress || "—"}</div>
                            {row.reasonIfNone && (
                              <div
                                style={{ fontSize: 13, color: "#4a4036" }}
                              >
                                {row.reasonIfNone}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="isp-list">
                            <textarea
                              aria-label={`Progress for ${row.objectiveTitle}`}
                              value={row.progress}
                              onChange={(e) =>
                                setSections((prev) => ({
                                  ...prev,
                                  programProgress: prev.programProgress.map(
                                    (r, j) =>
                                      j === i
                                        ? { ...r, progress: e.target.value }
                                        : r,
                                  ),
                                }))
                              }
                              placeholder="Progress toward the objective this month."
                              style={{ minHeight: 60 }}
                            />
                            <input
                              type="text"
                              aria-label={`Reason if no progress for ${row.objectiveTitle}`}
                              value={row.reasonIfNone}
                              onChange={(e) =>
                                setSections((prev) => ({
                                  ...prev,
                                  programProgress: prev.programProgress.map(
                                    (r, j) =>
                                      j === i
                                        ? {
                                            ...r,
                                            reasonIfNone: e.target.value,
                                          }
                                        : r,
                                  ),
                                }))
                              }
                              placeholder="Reason if no progress (optional)"
                              style={{ minHeight: 44 }}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginTop: 24 }}>Monthly sections</h3>
            <div className="isp-list">
              {SECTION_LABELS.map(({ key, label }) => (
                <div className="isp-section-editor" key={key}>
                  <h4>{label}</h4>
                  {finalized ? (
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {String(sections[key] ?? "") || "—"}
                    </p>
                  ) : (
                    <textarea
                      aria-label={label}
                      value={String(sections[key] ?? "")}
                      onChange={(e) =>
                        setSections((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>

            {!finalized && canReview && (
              <div className="isp-btn-row">
                <button
                  type="button"
                  className="isp-btn primary"
                  onClick={() => void saveSections()}
                  disabled={busy}
                >
                  Save sections
                </button>
                {savedFlash && (
                  <span style={{ color: "#3f5c3b", fontWeight: 700 }}>
                    {savedFlash}
                  </span>
                )}
              </div>
            )}

            <h3 style={{ marginTop: 24 }}>Signatures</h3>
            <div className="isp-list">
              {SIGNER_ROLES.map(({ role, label }) => {
                const sigs = signatures.filter((s) => s.role === role);
                return (
                  <div
                    className="isp-overdue-row"
                    key={role}
                    style={{ borderLeftWidth: 1 }}
                  >
                    <div>
                      <div className="isp-who">{label}</div>
                      {sigs.length > 0 ? (
                        sigs.map((s) => (
                          <div className="isp-sig-stamp" key={s.id}>
                            ✓ {s.signerName} —{" "}
                            {new Date(s.signedAt).toLocaleString()}
                          </div>
                        ))
                      ) : (
                        <div className="isp-meta">Not signed</div>
                      )}
                    </div>
                    {!finalized && canReview && sigs.length === 0 && (
                      <button
                        type="button"
                        className="isp-btn"
                        onClick={() => void sign(role)}
                        disabled={busy}
                      >
                        Sign as {label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="isp-btn-row">
              {nextStep && canReview && !finalized && (
                <button
                  type="button"
                  className="isp-btn clay"
                  onClick={() => void advance()}
                  disabled={busy}
                >
                  {nextStep.label}
                </button>
              )}
              {report.status === "sc_review" && (
                <span className="isp-hint">
                  Finalizing requires at least one program-manager signature.
                </span>
              )}
              <button
                type="button"
                className="isp-btn"
                onClick={printPdf}
              >
                <Download size={16} style={{ verticalAlign: -3 }} /> Print PDF
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
