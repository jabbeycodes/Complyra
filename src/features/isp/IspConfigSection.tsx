import { useState } from "react";
import { Badge, Empty } from "../../components";
import type { ComplyraApi } from "../../data/localApi";
import {
  ispScheduleLabel,
  type IspProgramView,
  type IspSchedule,
  type IspScoringMethod,
} from "../../data/shiftNotes";
import { currentPlanYear, type IspChartData } from "./useIspData";

/**
 * Issue #80 — DPM / administrator ISP program config (founder lock: Option A,
 * a chart section). Programs are per Individual per plan year; only an
 * approved program is visible to staff entering shift notes.
 *
 * Wording: "Individual/Individuals" only — never client/patient, never T-Log.
 */

interface TaskDraft {
  title: string;
  instructions: string;
}

function statusLabel(status: IspProgramView["status"]): string {
  return status === "draft" ? "Draft" : status === "approved" ? "Approved" : "Superseded";
}

function ProgramForm({
  api,
  individualId,
  scoringMethods,
  onDone,
  onNewMethod,
}: {
  api: ComplyraApi;
  individualId: string;
  scoringMethods: IspScoringMethod[];
  onDone: (action: () => Promise<unknown>) => Promise<void>;
  onNewMethod: () => void;
}) {
  const [name, setName] = useState("");
  const [planYear, setPlanYear] = useState(currentPlanYear());
  const [effectiveOn, setEffectiveOn] = useState(`${currentPlanYear()}-01-01`);
  const [expiresOn, setExpiresOn] = useState(`${currentPlanYear()}-12-31`);
  const [schedule, setSchedule] = useState<IspSchedule>("per_shift");
  const [maxEntries, setMaxEntries] = useState("3");
  const [methodId, setMethodId] = useState(scoringMethods[0]?.id ?? "");
  const canSave = name.trim().length > 0 && methodId.length > 0;
  return (
    <form
      className="overview-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        void onDone(() =>
          api.createIspProgram(individualId, {
            name,
            planYear,
            effectiveOn,
            expiresOn,
            schedule,
            maxEntriesPerDay: Number(maxEntries) || 1,
            scoringMethodId: methodId,
          }),
        );
      }}
    >
      <h3>New ISP program</h3>
      <div className="overview-form-grid">
        <label className="overview-form-span">
          Program name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" placeholder="e.g. 2026 ISP — Daily living supports" />
        </label>
        <label>
          Plan year
          <input value={planYear} onChange={(e) => setPlanYear(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="2026" />
        </label>
        <label>
          Max entries per day
          <input value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} inputMode="numeric" autoComplete="off" />
        </label>
        <label>
          Effective on
          <input type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} required />
        </label>
        <label>
          Expires on
          <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
        </label>
        <label>
          Schedule
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as IspSchedule)}>
            <option value="per_shift">Per shift</option>
            <option value="per_day">Per day</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          Scoring method
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} required>
            {scoringMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overview-editor-actions">
        <button type="button" className="button" onClick={onNewMethod}>
          New scoring method
        </button>
        <button type="submit" className="button primary" disabled={!canSave}>
          Create draft program
        </button>
      </div>
    </form>
  );
}

function ScoringMethodForm({
  api,
  onDone,
}: {
  api: ComplyraApi;
  onDone: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [levels, setLevels] = useState([
    { caption: "Yes", shortLabel: "Y", reportable: true },
    { caption: "No", shortLabel: "N", reportable: true },
    { caption: "Refused", shortLabel: "R", reportable: true },
  ]);
  const canSave = name.trim().length > 0 && levels.filter((l) => l.caption.trim()).length >= 2;
  return (
    <form
      className="overview-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        void onDone(() => api.createIspScoringMethod({ name, levels }));
      }}
    >
      <h3>New scoring method</h3>
      <label>
        Method name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" placeholder="e.g. Prompt-level scoring" />
      </label>
      {levels.map((level, i) => (
        <div key={i} className="overview-form-grid isp-level-row">
          <label>
            Level caption
            <input
              value={level.caption}
              onChange={(e) =>
                setLevels((prev) => prev.map((l, j) => (j === i ? { ...l, caption: e.target.value } : l)))
              }
              autoComplete="off"
            />
          </label>
          <label>
            Short label
            <input
              value={level.shortLabel}
              onChange={(e) =>
                setLevels((prev) => prev.map((l, j) => (j === i ? { ...l, shortLabel: e.target.value } : l)))
              }
              autoComplete="off"
              placeholder="Y"
            />
          </label>
          <label className="isp-check-label">
            <input
              type="checkbox"
              checked={level.reportable}
              onChange={(e) =>
                setLevels((prev) => prev.map((l, j) => (j === i ? { ...l, reportable: e.target.checked } : l)))
              }
            />
            Counts in reports
          </label>
        </div>
      ))}
      <div className="overview-editor-actions">
        <button
          type="button"
          className="button"
          onClick={() => setLevels((prev) => [...prev, { caption: "", shortLabel: "", reportable: true }])}
        >
          Add level
        </button>
        <button type="submit" className="button primary" disabled={!canSave}>
          Save scoring method
        </button>
      </div>
    </form>
  );
}

function TaskEditor({
  program,
  pcspSeedTitles,
  onSave,
}: {
  program: IspProgramView;
  pcspSeedTitles: string[];
  onSave: (tasks: TaskDraft[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<TaskDraft[]>(() =>
    program.tasks.map((task) => ({ title: task.title, instructions: task.instructions })),
  );
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="chart-actions">
        <button type="button" className="button" onClick={() => setEditing(true)}>
          Edit tasks ({program.tasks.length})
        </button>
      </div>
    );
  }
  const set = (i: number, key: keyof TaskDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, [key]: e.target.value } : d)));
  return (
    <div className="isp-task-editor">
      {drafts.map((draft, i) => (
        <div key={i} className="overview-form-grid">
          <label className="overview-form-span">
            Task {i + 1}
            <input value={draft.title} onChange={set(i, "title")} autoComplete="off" placeholder="Task title" aria-label={`Task ${i + 1} title`} />
          </label>
          <label className="overview-form-span">
            Instructions
            <input value={draft.instructions} onChange={set(i, "instructions")} autoComplete="off" placeholder="Optional instructions for staff" aria-label={`Task ${i + 1} instructions`} />
          </label>
          <div>
            <button
              type="button"
              className="button"
              onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
              aria-label={`Remove task ${i + 1}`}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="chart-actions">
        <button type="button" className="button" onClick={() => setDrafts((prev) => [...prev, { title: "", instructions: "" }])}>
          Add task
        </button>
        {pcspSeedTitles.length > 0 && (
          <button
            type="button"
            className="button"
            onClick={() =>
              setDrafts((prev) => [
                ...prev,
                ...pcspSeedTitles
                  .filter((title) => !prev.some((d) => d.title === title))
                  .map((title) => ({ title, instructions: "" })),
              ])
            }
          >
            Add tasks from PCSP
          </button>
        )}
        <button type="button" className="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            void onSave(drafts).then(() => setEditing(false));
          }}
        >
          Save tasks
        </button>
      </div>
    </div>
  );
}

function ProgramCard({
  program,
  api,
  runIsp,
  pcspSeedTitles,
}: {
  program: IspProgramView;
  api: ComplyraApi;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
  pcspSeedTitles: string[];
}) {
  const [open, setOpen] = useState(program.status === "draft");
  return (
    <div className="isp-program-card">
      <div className="isp-program-head">
        <div>
          <strong>{program.name}</strong>
          <span className="muted">
            {" "}
            · Plan year {program.planYear} · {ispScheduleLabel(program.schedule)} · up to{" "}
            {program.maxEntriesPerDay}/day
          </span>
        </div>
        <div className="chart-actions">
          <Badge status={statusLabel(program.status)} />
          <button type="button" className="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Collapse" : "Configure"}
          </button>
          {program.status === "draft" && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                if (window.confirm(`Approve "${program.name}"? Staff will be able to enter shift notes against it.`)) {
                  void runIsp(() => api.approveIspProgram(program.id));
                }
              }}
            >
              Approve
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="isp-program-body">
          <p className="muted">
            {program.effectiveOn} → {program.expiresOn}
            {" · "}Scoring: {program.scoringMethod?.name ?? "—"}
            {program.scoringMethod &&
              ` (${program.scoringMethod.levels.map((l) => l.caption).join(" / ")})`}
            {program.status === "approved" && program.approvedByName && (
              <> · Approved by {program.approvedByName}</>
            )}
          </p>
          {program.tasks.length === 0 ? (
            <p className="muted">No tasks yet — add tasks before approving.</p>
          ) : (
            <ol className="isp-task-list">
              {program.tasks.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  {task.instructions && <span className="muted"> — {task.instructions}</span>}
                </li>
              ))}
            </ol>
          )}
          <TaskEditor
            program={program}
            pcspSeedTitles={pcspSeedTitles}
            onSave={(tasks) => runIsp(() => api.saveIspProgramTasks(program.id, tasks))}
          />
        </div>
      )}
    </div>
  );
}

export default function IspConfigSection({
  individualId,
  data,
  api,
  runIsp,
  pcspSeedTitles,
}: {
  individualId: string;
  data: IspChartData;
  api: ComplyraApi;
  runIsp: (action: () => Promise<unknown>) => Promise<void>;
  pcspSeedTitles: string[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [showMethodForm, setShowMethodForm] = useState(false);
  return (
    <section className="chart-widget" aria-labelledby="isp-config-heading">
      <h2 id="isp-config-heading">ISP / PCSP tasks</h2>
      <p className="stack-help">
        ISP programs a DPM or administrator configures per plan year. Staff can
        enter shift notes only against an approved program.
      </p>
      {data.programs.length === 0 && !showForm ? (
        <Empty
          mark="quiet"
          title="No ISP program yet"
          text="Create the first ISP program for this individual."
          actions={
            <button type="button" className="button primary" onClick={() => setShowForm(true)}>
              New ISP program
            </button>
          }
        />
      ) : (
        <>
          {data.programs.map((program) => (
            <ProgramCard
              key={program.id}
              program={program}
              api={api}
              runIsp={runIsp}
              pcspSeedTitles={pcspSeedTitles}
            />
          ))}
          {!showForm && (
            <div className="chart-actions">
              <button type="button" className="button" onClick={() => setShowForm(true)}>
                New ISP program
              </button>
            </div>
          )}
        </>
      )}
      {showForm && (
        <ProgramForm
          api={api}
          individualId={individualId}
          scoringMethods={data.scoringMethods}
          onDone={async (action) => {
            await runIsp(action);
            setShowForm(false);
          }}
          onNewMethod={() => setShowMethodForm(true)}
        />
      )}
      {showMethodForm && (
        <ScoringMethodForm
          api={api}
          onDone={async (action) => {
            await runIsp(action);
            setShowMethodForm(false);
          }}
        />
      )}
    </section>
  );
}
