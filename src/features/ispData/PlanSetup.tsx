import { useEffect, useState } from "react";
import { Empty } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import type {
  IspGoal,
  IspGoalStatus,
  IspMeasurementMethod,
  IspObjective,
  IspTrackable,
  IspTrackableFrequency,
} from "../../data/types";
import "./ispData.css";

const METHODS: { value: IspMeasurementMethod; label: string }[] = [
  { value: "yes_no", label: "Yes / No" },
  { value: "count", label: "Count" },
  { value: "rating_scale", label: "Rating scale" },
  { value: "narrative", label: "Narrative" },
  { value: "percentage", label: "Percentage" },
];

const FREQUENCIES: { value: IspTrackableFrequency; label: string }[] = [
  { value: "per_shift", label: "Every shift" },
  { value: "daily", label: "Daily" },
  { value: "per_service", label: "Per service" },
];

const GOAL_STATUSES: IspGoalStatus[] = ["active", "completed", "discontinued"];

export default function PlanSetup({
  individualId,
  individualName,
  siteStaff,
}: {
  individualId: string;
  individualName: string;
  siteStaff: { id: string; name: string }[];
}) {
  const isp = useIspApi();
  const { session } = useData();
  const [goals, setGoals] = useState<IspGoal[]>([]);
  const [objectives, setObjectives] = useState<Record<string, IspObjective[]>>(
    {},
  );
  const [trackables, setTrackables] = useState<Record<string, IspTrackable[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [expandedObjective, setExpandedObjective] = useState<string | null>(
    null,
  );

  // Goal form
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");
  const [goalFrom, setGoalFrom] = useState("");
  // Objective form (per expanded goal)
  const [objTitle, setObjTitle] = useState("");
  const [objMeasure, setObjMeasure] = useState("");
  const [objParty, setObjParty] = useState("");
  // Trackable form (per expanded objective)
  const [trkName, setTrkName] = useState("");
  const [trkPrompt, setTrkPrompt] = useState("");
  const [trkMethod, setTrkMethod] = useState<IspMeasurementMethod>("yes_no");
  const [trkFreq, setTrkFreq] = useState<IspTrackableFrequency>("per_shift");
  const [trkMin, setTrkMin] = useState("1");
  const [trkMax, setTrkMax] = useState("5");
  const [trkLabels, setTrkLabels] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = !!session && can(session, "isp.manage_plan");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const rows = await isp.ispListGoals(individualId);
      setGoals(rows);
      const objMap: Record<string, IspObjective[]> = {};
      for (const g of rows) {
        objMap[g.id] = await isp.ispListObjectives(g.id);
      }
      setObjectives(objMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the plan.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [individualId]);

  async function loadTrackables(objectiveId: string) {
    try {
      const rows = await isp.ispListTrackables(objectiveId);
      setTrackables((prev) => ({ ...prev, [objectiveId]: rows }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load trackables.",
      );
    }
  }

  async function addGoal() {
    if (!goalTitle.trim() || !goalFrom) {
      setError("Give the goal a title and an effective date.");
      return;
    }
    setBusy(true);
    try {
      const saved = await isp.ispSaveGoal({
        individualId,
        title: goalTitle.trim(),
        description: goalDescription.trim(),
        effectiveFrom: goalFrom,
      });
      setGoals((prev) => [...prev, saved]);
      setGoalTitle("");
      setGoalDescription("");
      setGoalFrom("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the goal.");
    } finally {
      setBusy(false);
    }
  }

  async function cycleGoalStatus(goal: IspGoal) {
    const order: IspGoalStatus[] = ["active", "completed", "discontinued"];
    const next = order[(order.indexOf(goal.status) + 1) % order.length];
    setBusy(true);
    try {
      const saved = await isp.ispSaveGoal({
        id: goal.id,
        individualId,
        title: goal.title,
        description: goal.description,
        effectiveFrom: goal.effectiveFrom,
        effectiveTo: goal.effectiveTo,
        status: next,
      });
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? saved : g)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the goal.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addObjective(goalId: string) {
    if (!objTitle.trim()) {
      setError("Give the objective a title.");
      return;
    }
    setBusy(true);
    try {
      const saved = await isp.ispSaveObjective({
        goalId,
        title: objTitle.trim(),
        measureOfSuccess: objMeasure.trim(),
        responsibleParty: objParty.trim(),
      });
      setObjectives((prev) => ({
        ...prev,
        [goalId]: [...(prev[goalId] ?? []), saved],
      }));
      setObjTitle("");
      setObjMeasure("");
      setObjParty("");
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the objective.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function addTrackable(objectiveId: string) {
    if (!trkName.trim()) {
      setError("Give the trackable a name.");
      return;
    }
    let ratingMin: number | null = null;
    let ratingMax: number | null = null;
    let ratingLabels: Record<string, string> | null = null;
    if (trkMethod === "rating_scale") {
      ratingMin = Number(trkMin);
      ratingMax = Number(trkMax);
      if (!Number.isFinite(ratingMin) || !Number.isFinite(ratingMax)) {
        setError("Rating scale needs numeric lower and upper bounds.");
        return;
      }
      if (ratingMin >= ratingMax) {
        setError("The lower bound must be below the upper bound.");
        return;
      }
      if (trkLabels.trim()) {
        ratingLabels = {};
        for (const part of trkLabels.split(",")) {
          const [k, v] = part.split("=").map((s) => s.trim());
          if (k && v) ratingLabels[k] = v;
        }
      }
    }
    setBusy(true);
    try {
      const saved = await isp.ispSaveTrackable({
        objectiveId,
        name: trkName.trim(),
        prompt: trkPrompt.trim(),
        measurementMethod: trkMethod,
        ratingMin,
        ratingMax,
        ratingLabels,
        frequency: trkFreq,
      });
      setTrackables((prev) => ({
        ...prev,
        [objectiveId]: [...(prev[objectiveId] ?? []), saved],
      }));
      setTrkName("");
      setTrkPrompt("");
      setTrkLabels("");
      setError("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the trackable.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function assignTrackable(trackableId: string, userId: string) {
    if (!userId) return;
    setBusy(true);
    try {
      await isp.ispAssignTrackable(trackableId, userId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not assign the trackable.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="isp-panel">Loading plan…</div>;

  return (
    <div className="isp-wrap">
      <div className="isp-panel">
        <h3>Plan setup — {individualName}</h3>
        <p className="isp-sub">
          Goals → objectives → trackables. Trackables are what staff score on
          every shift note.
          {!canManage && " Your role can view this plan but not change it."}
        </p>
        {error && (
          <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
            {error}
          </p>
        )}

        <div className="isp-list">
          {goals.map((goal) => (
            <div className="isp-goal-card" key={goal.id}>
              <div className="isp-goal-head">
                <h4>
                  <button
                    type="button"
                    className="isp-btn"
                    style={{ padding: "8px 12px", minHeight: 44 }}
                    onClick={() =>
                      setExpandedGoal(expandedGoal === goal.id ? null : goal.id)
                    }
                    aria-expanded={expandedGoal === goal.id}
                  >
                    {goal.title}
                  </button>
                </h4>
                <span className="isp-sig-row">
                  <span className="isp-badge">{goal.status}</span>
                  {canManage && (
                    <button
                      type="button"
                      className="isp-btn"
                      onClick={() => void cycleGoalStatus(goal)}
                      disabled={busy}
                    >
                      Cycle status
                    </button>
                  )}
                </span>
              </div>
              {goal.description && <p>{goal.description}</p>}

              {expandedGoal === goal.id && (
                <div style={{ marginTop: 12 }}>
                  <h4>Objectives</h4>
                  <div className="isp-list">
                    {(objectives[goal.id] ?? []).map((obj) => (
                      <div className="isp-goal-card" key={obj.id}>
                        <div className="isp-goal-head">
                          <h4>
                            <button
                              type="button"
                              className="isp-btn"
                              style={{ padding: "8px 12px", minHeight: 44 }}
                              onClick={() => {
                                const next =
                                  expandedObjective === obj.id ? null : obj.id;
                                setExpandedObjective(next);
                                if (next && !trackables[obj.id])
                                  void loadTrackables(obj.id);
                              }}
                              aria-expanded={expandedObjective === obj.id}
                            >
                              {obj.title}
                            </button>
                          </h4>
                          <span className="isp-badge">{obj.status}</span>
                        </div>
                        {obj.measureOfSuccess && (
                          <p>
                            <strong>Measure of success:</strong>{" "}
                            {obj.measureOfSuccess}
                          </p>
                        )}
                        {obj.responsibleParty && (
                          <p>
                            <strong>Responsible party:</strong>{" "}
                            {obj.responsibleParty}
                          </p>
                        )}

                        {expandedObjective === obj.id && (
                          <div style={{ marginTop: 12 }}>
                            <h4>Trackables</h4>
                            <div className="isp-table-wrap">
                              <table className="isp-table">
                                <thead>
                                  <tr>
                                    <th>Name</th>
                                    <th>Method</th>
                                    <th>Frequency</th>
                                    <th>Prompt</th>
                                    {canManage && <th>Assign staff</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(trackables[obj.id] ?? []).map((t) => (
                                    <tr key={t.id}>
                                      <td>{t.name}</td>
                                      <td>
                                        {t.measurementMethod}
                                        {t.measurementMethod ===
                                          "rating_scale" &&
                                          ` (${t.ratingMin}–${t.ratingMax})`}
                                      </td>
                                      <td>{t.frequency}</td>
                                      <td>{t.prompt || "—"}</td>
                                      {canManage && (
                                        <td>
                                          <select
                                            aria-label={`Assign staff to ${t.name}`}
                                            defaultValue=""
                                            onChange={(e) => {
                                              void assignTrackable(
                                                t.id,
                                                e.target.value,
                                              );
                                              e.target.value = "";
                                            }}
                                            style={{ minHeight: 44 }}
                                          >
                                            <option value="">
                                              Assign…
                                            </option>
                                            {siteStaff.map((s) => (
                                              <option key={s.id} value={s.id}>
                                                {s.name}
                                              </option>
                                            ))}
                                          </select>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {(trackables[obj.id] ?? []).length === 0 && (
                              <Empty
                                title="No trackables"
                                text="Add what staff should score each shift."
                              />
                            )}
                            {canManage && (
                              <div
                                className="isp-form-grid"
                                style={{ marginTop: 12 }}
                              >
                                <div className="isp-field">
                                  <span>
                                    <label htmlFor={`trk-name-${obj.id}`}>
                                      Trackable name
                                    </label>
                                  </span>
                                  <input
                                    id={`trk-name-${obj.id}`}
                                    type="text"
                                    value={trkName}
                                    onChange={(e) =>
                                      setTrkName(e.target.value)
                                    }
                                    placeholder="e.g. Verbal prompts needed"
                                  />
                                </div>
                                <div className="isp-field">
                                  <span>
                                    <label htmlFor={`trk-prompt-${obj.id}`}>
                                      Scoring prompt
                                    </label>
                                  </span>
                                  <input
                                    id={`trk-prompt-${obj.id}`}
                                    type="text"
                                    value={trkPrompt}
                                    onChange={(e) =>
                                      setTrkPrompt(e.target.value)
                                    }
                                    placeholder="e.g. How many prompts before the task started?"
                                  />
                                </div>
                                <div className="isp-field">
                                  <span>
                                    <label htmlFor={`trk-method-${obj.id}`}>
                                      Measurement method
                                    </label>
                                  </span>
                                  <select
                                    id={`trk-method-${obj.id}`}
                                    value={trkMethod}
                                    onChange={(e) =>
                                      setTrkMethod(
                                        e.target.value as IspMeasurementMethod,
                                      )
                                    }
                                  >
                                    {METHODS.map((m) => (
                                      <option key={m.value} value={m.value}>
                                        {m.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="isp-field">
                                  <span>
                                    <label htmlFor={`trk-freq-${obj.id}`}>
                                      Frequency
                                    </label>
                                  </span>
                                  <select
                                    id={`trk-freq-${obj.id}`}
                                    value={trkFreq}
                                    onChange={(e) =>
                                      setTrkFreq(
                                        e.target
                                          .value as IspTrackableFrequency,
                                      )
                                    }
                                  >
                                    {FREQUENCIES.map((f) => (
                                      <option key={f.value} value={f.value}>
                                        {f.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {trkMethod === "rating_scale" && (
                                  <>
                                    <div className="isp-field">
                                      <span>
                                        <label
                                          htmlFor={`trk-min-${obj.id}`}
                                        >
                                          Lower bound
                                        </label>
                                      </span>
                                      <input
                                        id={`trk-min-${obj.id}`}
                                        type="number"
                                        value={trkMin}
                                        onChange={(e) =>
                                          setTrkMin(e.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="isp-field">
                                      <span>
                                        <label
                                          htmlFor={`trk-max-${obj.id}`}
                                        >
                                          Upper bound
                                        </label>
                                      </span>
                                      <input
                                        id={`trk-max-${obj.id}`}
                                        type="number"
                                        value={trkMax}
                                        onChange={(e) =>
                                          setTrkMax(e.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="isp-field isp-full">
                                      <span>
                                        <label
                                          htmlFor={`trk-labels-${obj.id}`}
                                        >
                                          Rating labels (optional, e.g.
                                          1=Needs help, 5=Independent)
                                        </label>
                                      </span>
                                      <input
                                        id={`trk-labels-${obj.id}`}
                                        type="text"
                                        value={trkLabels}
                                        onChange={(e) =>
                                          setTrkLabels(e.target.value)
                                        }
                                        placeholder="1=Needs help, 3=Some prompts, 5=Independent"
                                      />
                                    </div>
                                  </>
                                )}
                                <div className="isp-btn-row isp-full">
                                  <button
                                    type="button"
                                    className="isp-btn primary"
                                    onClick={() => void addTrackable(obj.id)}
                                    disabled={busy}
                                  >
                                    Add trackable
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {(objectives[goal.id] ?? []).length === 0 && (
                    <Empty
                      title="No objectives"
                      text="Break this goal into measurable objectives."
                    />
                  )}
                  {canManage && (
                    <div className="isp-form-grid" style={{ marginTop: 12 }}>
                      <div className="isp-field">
                        <span>
                          <label htmlFor={`obj-title-${goal.id}`}>
                            Objective title
                          </label>
                        </span>
                        <input
                          id={`obj-title-${goal.id}`}
                          type="text"
                          value={objTitle}
                          onChange={(e) => setObjTitle(e.target.value)}
                          placeholder="e.g. Complete morning routine with 2 or fewer prompts"
                        />
                      </div>
                      <div className="isp-field">
                        <span>
                          <label htmlFor={`obj-party-${goal.id}`}>
                            Responsible party
                          </label>
                        </span>
                        <input
                          id={`obj-party-${goal.id}`}
                          type="text"
                          value={objParty}
                          onChange={(e) => setObjParty(e.target.value)}
                          placeholder="e.g. Direct support staff"
                        />
                      </div>
                      <div className="isp-field isp-full">
                        <span>
                          <label htmlFor={`obj-measure-${goal.id}`}>
                            Measure of success
                          </label>
                        </span>
                        <textarea
                          id={`obj-measure-${goal.id}`}
                          value={objMeasure}
                          onChange={(e) => setObjMeasure(e.target.value)}
                          placeholder="What does success look like, in plain words?"
                        />
                      </div>
                      <div className="isp-btn-row isp-full">
                        <button
                          type="button"
                          className="isp-btn primary"
                          onClick={() => void addObjective(goal.id)}
                          disabled={busy}
                        >
                          Add objective
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {goals.length === 0 && (
          <Empty
            title="No goals yet"
            text="Start by adding the first ISP goal for this individual."
          />
        )}

        {canManage && (
          <div className="isp-form-grid" style={{ marginTop: 16 }}>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-goal-title">Goal title</label>
              </span>
              <input
                id="isp-goal-title"
                type="text"
                value={goalTitle}
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="e.g. Build independent daily living skills"
              />
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-goal-from">Effective from</label>
              </span>
              <input
                id="isp-goal-from"
                type="date"
                value={goalFrom}
                onChange={(e) => setGoalFrom(e.target.value)}
              />
            </div>
            <div className="isp-field isp-full">
              <span>
                <label htmlFor="isp-goal-desc">Description</label>
              </span>
              <textarea
                id="isp-goal-desc"
                value={goalDescription}
                onChange={(e) => setGoalDescription(e.target.value)}
                placeholder="Plain-language description of the goal."
              />
            </div>
            <div className="isp-btn-row isp-full">
              <button
                type="button"
                className="isp-btn primary"
                onClick={() => void addGoal()}
                disabled={busy}
              >
                Add goal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
