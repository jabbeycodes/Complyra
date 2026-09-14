import { useState } from "react";
import { FileBadge2, Plus } from "lucide-react";
import { Badge, Empty, formatDate, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import { canToggleDelegation, type ObligationItem } from "../../data/planStack";
import { can } from "../../data/status";
import {
  blankDelegationForm,
  delegationFormStatus,
  delegationReviewState,
} from "../../data/types";
import DelegationFormDetail from "./DelegationFormDetail";
import DelegationTemplatesSection from "./DelegationTemplatesSection";

/**
 * Agency-wide delegations page: every RN delegation of a specified nursing
 * task, review-date reminders (improved template), and new-delegation intake.
 */
export default function DelegationsPage() {
  const { api, session, workspace, refresh } = useData();
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"library" | "forms">("library");

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!session) return null;
  const editor = canToggleDelegation(
    session.roleKey,
    session.role,
    can(session, "requirements.approve"),
  );
  const delegations = (workspace?.planStacks ?? [])
    .flatMap((stack) => stack.required)
    .filter((view) => view.item.kind === "delegation")
    .map((view) => {
      const person = workspace?.individuals.find((p) => p.id === view.item.individualId);
      return { view, person };
    });

  const reminders = delegations
    .map(({ view, person }) => {
      const form = view.item.delegationForm ?? blankDelegationForm();
      const review = delegationReviewState(form);
      return review?.dueSoon ? { view, person, review } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div data-tour="delegations">
      <PageHeading
        eyebrow="ONE TASK. ONE ROSTER."
        title="RN delegations"
        description="One form per individual per task. Delegation is non-transferable — each task carries its own roster and signatures."
      />
      {error && <p className="form-error">{error}</p>}

      <div className="tabs">
        <button
          className={tab === "library" ? "selected" : ""}
          onClick={() => setTab("library")}
        >
          Template library
        </button>
        <button
          className={tab === "forms" ? "selected" : ""}
          onClick={() => setTab("forms")}
        >
          RN delegation forms
        </button>
      </div>

      {tab === "library" ? (
        <DelegationTemplatesSection />
      ) : (
        <>
          {reminders.length > 0 && (
        <section className="panel">
          <h2>Review reminders</h2>
          <p className="stack-help">
            Delegations with a review date set that is due soon or overdue.
          </p>
          {reminders.map(({ view, person, review }) => (
            <div key={view.item.id} className="delegation-reminder">
              <FileBadge2 size={16} />
              <div>
                <strong>{view.item.title}</strong> — {person?.name}
                <div className={review.overdue ? "delegation-warn" : "delegation-small"}>
                  {review.label}
                </div>
              </div>
              <button className="button" onClick={() => setOpenId(view.item.id)}>
                Open form
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <h2>Delegations</h2>
          {editor && (
            <button className="button" onClick={() => setCreating((v) => !v)}>
              <Plus size={16} /> {creating ? "Cancel" : "New delegation"}
            </button>
          )}
        </div>
        {creating && editor && (
          <div className="delegation-create">
            <NewDelegationForm
              onCreate={(input) =>
                run(async () => {
                  const { id } = await api.createDelegation(input);
                  setCreating(false);
                  setOpenId(id);
                })
              }
            />
          </div>
        )}
        {delegations.length === 0 ? (
          <Empty title="No delegations yet" text="Create the first RN delegation of a specified nursing task." />
        ) : (
          <table className="delegation-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Individual</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {delegations.map(({ view, person }) => (
                <DelegationRow
                  key={view.item.id}
                  item={view.item}
                  individualName={person?.name ?? ""}
                  onOpen={() => setOpenId(view.item.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openId && <DelegationFormDetail obligationId={openId} onClose={() => setOpenId(null)} />}
        </>
      )}
    </div>
  );
}

function DelegationRow({
  item,
  individualName,
  onOpen,
}: {
  item: ObligationItem;
  individualName: string;
  onOpen: () => void;
}) {
  const form = item.delegationForm ?? blankDelegationForm();
  const status = delegationFormStatus(form);
  const review = delegationReviewState(form);
  return (
    <tr>
      <td>
        <strong>{item.title}</strong>
        {review?.dueSoon && (
          <div className={review.overdue ? "delegation-warn" : "delegation-small"}>{review.label}</div>
        )}
      </td>
      <td>{individualName}</td>
      <td>
        <Badge status={status.rescinded ? "Off" : status.fullySigned ? "Current" : "Pending"} />
        <div className="delegation-small">
          RN {item.rnSignedAt ? `signed ${formatDate(item.rnSignedAt)}` : "not signed"} ·{" "}
          {status.rowsSigned}/{status.rowsNamed} staff signed
        </div>
      </td>
      <td>
        <button className="button" onClick={onOpen}>
          Open form
        </button>
      </td>
    </tr>
  );
}

function NewDelegationForm({
  onCreate,
}: {
  onCreate: (input: {
    individualId: string;
    taskTitle: string;
    purpose: string;
    procedures?: string;
    observeReportDo?: string;
  }) => void;
}) {
  const { workspace } = useData();
  const [individualId, setIndividualId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [procedures, setProcedures] = useState("");
  const [observeReportDo, setObserveReportDo] = useState("");
  return (
    <form
      className="delegation-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ individualId, taskTitle, purpose, procedures, observeReportDo });
      }}
    >
      <div className="delegation-grid2">
        <label className="form-label">
          Individual
          <select value={individualId} onChange={(e) => setIndividualId(e.target.value)} required>
            <option value="">Select…</option>
            {(workspace?.individuals ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.site}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Delegated task
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="PRN Inhaler Self-Administration and Monitoring"
            required
          />
        </label>
      </div>
      <label className="form-label">
        Purpose of task
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} required />
      </label>
      <div className="delegation-grid2">
        <label className="form-label">
          PROCEDURES / steps to follow
          <textarea value={procedures} onChange={(e) => setProcedures(e.target.value)} rows={3} />
        </label>
        <label className="form-label">
          What to OBSERVE / REPORT / DO / CONTACT
          <textarea value={observeReportDo} onChange={(e) => setObserveReportDo(e.target.value)} rows={3} />
        </label>
      </div>
      <button className="button primary" type="submit" disabled={!individualId || !taskTitle.trim() || !purpose.trim()}>
        Create delegation
      </button>
    </form>
  );
}
