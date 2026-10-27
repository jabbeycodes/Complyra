import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { openPrintable } from "../../data/openFile";
import { DIGITAL_RECORD_MARK } from "../../delegation/delegation";
import {
  BEHAVIOR_INTENSITIES,
  canViewBehavior,
  summarizeBehaviorEntries,
  targetBehaviorList,
  type BehaviorEntry,
  type BehaviorEntryDraft,
  type BehaviorIntensity,
  type BehaviorPlan,
} from "../../data/behavior";

/**
 * Behavior supports on the Individual chart: the current behavior plan
 * (target behaviors, interventions, crisis steps) and the behavior data
 * log with a rolling 30-day summary. Auditors read; they cannot record.
 */
export default function BehaviorSection({
  individualId,
  individualName,
}: {
  individualId: string;
  individualName: string;
}) {
  const { api, session } = useData();
  const [plan, setPlan] = useState<BehaviorPlan | null>(null);
  const [entries, setEntries] = useState<BehaviorEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState({
    targetBehaviors: "",
    interventions: "",
    crisisSteps: "",
  });
  const today = new Date().toISOString().slice(0, 10);
  const [entryDraft, setEntryDraft] = useState<BehaviorEntryDraft>({
    occurredOn: today,
    occurredAtTime: "",
    behavior: "",
    antecedent: "",
    durationMinutes: null,
    intensity: "Moderate",
    interventionUsed: "",
    outcome: "",
  });

  const visible = canViewBehavior(session);
  const canRecord = session?.permissions["behavior.record"] === true;
  const canPlan = session?.permissions["behavior.plan"] === true;

  const load = useCallback(async () => {
    if (!visible) return;
    try {
      const [nextPlan, nextEntries] = await Promise.all([
        api.getBehaviorPlan(individualId),
        api.listBehaviorEntries(individualId),
      ]);
      setPlan(nextPlan);
      setEntries(nextEntries);
      if (nextPlan) {
        setPlanDraft({
          targetBehaviors: nextPlan.targetBehaviors,
          interventions: nextPlan.interventions,
          crisisSteps: nextPlan.crisisSteps,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load behavior supports.");
    } finally {
      setLoaded(true);
    }
  }, [api, individualId, visible]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return summarizeBehaviorEntries(entries, from, today);
  }, [entries, today]);

  if (!visible) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const printLog = () => {
    const esc = (v: string) =>
      v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const rows = entries
      .map(
        (e) =>
          `<tr><td>${esc(e.occurredOn)} ${esc(e.occurredAtTime)}</td><td>${esc(e.behavior)}</td><td>${esc(e.antecedent)}</td><td>${e.durationMinutes ?? "—"}</td><td>${esc(e.intensity)}</td><td>${esc(e.interventionUsed)}</td><td>${esc(e.outcome)}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html><html><head><title>Behavior log — ${esc(individualName)}</title><style>body{font-family:Arial,sans-serif;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #444;padding:5px 7px;text-align:left}</style></head><body><h1>Behavior log — ${esc(individualName)}</h1><table><tr><th>When</th><th>Behavior</th><th>Antecedent</th><th>Minutes</th><th>Intensity</th><th>Intervention</th><th>Outcome</th></tr>${rows}</table><p><em>${DIGITAL_RECORD_MARK}</em></p></body></html>`;
    void openPrintable(
      `behavior-log-${individualId}.html`,
      new Blob([html], { type: "text/html" }),
      "print",
    );
  };

  return (
    <section className="chart-widget behavior-widget" aria-labelledby="behavior-heading">
      <h2 id="behavior-heading">Behavior supports</h2>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loaded ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {plan && !editingPlan ? (
            <div className="behavior-plan-view">
              <h3>Behavior plan</h3>
              <p>
                <strong>Watch for:</strong>
              </p>
              <ul>
                {targetBehaviorList(plan).map((behavior) => (
                  <li key={behavior}>{behavior}</li>
                ))}
              </ul>
              <p>
                <strong>What helps:</strong> {plan.interventions}
              </p>
              <p>
                <strong>Crisis steps:</strong> {plan.crisisSteps}
              </p>
              {canPlan && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditingPlan(true)}
                >
                  Edit plan
                </button>
              )}
            </div>
          ) : canPlan ? (
            <form
              className="behavior-plan-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.saveBehaviorPlan(individualId, planDraft);
                  setEditingPlan(false);
                });
              }}
            >
              <h3>{plan ? "Edit behavior plan" : "Add behavior plan"}</h3>
              <label>
                Target behaviors (one per line)
                <textarea
                  value={planDraft.targetBehaviors}
                  onChange={(e) =>
                    setPlanDraft({ ...planDraft, targetBehaviors: e.target.value })
                  }
                  rows={3}
                  required
                />
              </label>
              <label>
                Interventions that help
                <textarea
                  value={planDraft.interventions}
                  onChange={(e) =>
                    setPlanDraft({ ...planDraft, interventions: e.target.value })
                  }
                  rows={3}
                  required
                />
              </label>
              <label>
                Crisis steps
                <textarea
                  value={planDraft.crisisSteps}
                  onChange={(e) =>
                    setPlanDraft({ ...planDraft, crisisSteps: e.target.value })
                  }
                  rows={3}
                  required
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Save plan
                </button>
                {plan && (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setEditingPlan(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className="muted">No behavior plan has been added yet.</p>
          )}

          <h3>Behavior log</h3>
          <p className="muted">
            Last 30 days: {summary.totalInRange} recorded
            {summary.highIntensity > 0
              ? ` · ${summary.highIntensity} high intensity`
              : ""}
            {summary.byBehavior.length > 0
              ? ` · most frequent: ${summary.byBehavior[0].behavior} (${summary.byBehavior[0].count})`
              : ""}
            .
          </p>
          {canRecord && (
            <form
              className="behavior-entry-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.addBehaviorEntry(individualId, entryDraft);
                  setEntryDraft({
                    ...entryDraft,
                    behavior: "",
                    antecedent: "",
                    durationMinutes: null,
                    interventionUsed: "",
                    outcome: "",
                  });
                });
              }}
            >
              <div className="form-grid">
                <label>
                  Date
                  <input
                    type="date"
                    value={entryDraft.occurredOn}
                    onChange={(e) =>
                      setEntryDraft({ ...entryDraft, occurredOn: e.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Time
                  <input
                    type="time"
                    value={entryDraft.occurredAtTime}
                    onChange={(e) =>
                      setEntryDraft({ ...entryDraft, occurredAtTime: e.target.value })
                    }
                  />
                </label>
                <label>
                  Behavior
                  <input
                    value={entryDraft.behavior}
                    onChange={(e) =>
                      setEntryDraft({ ...entryDraft, behavior: e.target.value })
                    }
                    list="behavior-targets"
                    required
                  />
                  <datalist id="behavior-targets">
                    {plan &&
                      targetBehaviorList(plan).map((behavior) => (
                        <option key={behavior} value={behavior} />
                      ))}
                  </datalist>
                </label>
                <label>
                  Intensity
                  <select
                    value={entryDraft.intensity}
                    onChange={(e) =>
                      setEntryDraft({
                        ...entryDraft,
                        intensity: e.target.value as BehaviorIntensity,
                      })
                    }
                  >
                    {BEHAVIOR_INTENSITIES.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Duration (minutes)
                  <input
                    type="number"
                    min={0}
                    value={entryDraft.durationMinutes ?? ""}
                    onChange={(e) =>
                      setEntryDraft({
                        ...entryDraft,
                        durationMinutes:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Antecedent (what happened just before)
                <input
                  value={entryDraft.antecedent}
                  onChange={(e) =>
                    setEntryDraft({ ...entryDraft, antecedent: e.target.value })
                  }
                />
              </label>
              <label>
                Intervention used
                <input
                  value={entryDraft.interventionUsed}
                  onChange={(e) =>
                    setEntryDraft({ ...entryDraft, interventionUsed: e.target.value })
                  }
                />
              </label>
              <label>
                Outcome
                <input
                  value={entryDraft.outcome}
                  onChange={(e) =>
                    setEntryDraft({ ...entryDraft, outcome: e.target.value })
                  }
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="button primary" disabled={busy}>
                  Record behavior
                </button>
                <button type="button" className="button" onClick={printLog}>
                  <Printer size={15} aria-hidden /> Print log
                </button>
              </div>
            </form>
          )}
          {entries.length === 0 ? (
            <Empty title="No behaviors recorded yet." mark="quiet" />
          ) : (
            <ul className="record-list">
              {entries.slice(0, 30).map((entry) => (
                <li key={entry.id} className="record-row">
                  <div>
                    <strong>{entry.behavior}</strong>
                    <span className="muted">
                      {" "}
                      · {formatDate(entry.occurredOn)}
                      {entry.occurredAtTime ? ` ${entry.occurredAtTime}` : ""} ·{" "}
                      {entry.intensity} intensity
                      {entry.durationMinutes != null
                        ? ` · ${entry.durationMinutes} min`
                        : ""}
                    </span>
                    {(entry.antecedent || entry.interventionUsed || entry.outcome) && (
                      <p className="muted">
                        {entry.antecedent ? `Before: ${entry.antecedent}. ` : ""}
                        {entry.interventionUsed
                          ? `Intervention: ${entry.interventionUsed}. `
                          : ""}
                        {entry.outcome ? `Outcome: ${entry.outcome}.` : ""}
                      </p>
                    )}
                  </div>
                  {canRecord && entry.recordedByUserId === session?.userId && (
                    <button
                      type="button"
                      className="button ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.deleteBehaviorEntry(entry.id);
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
