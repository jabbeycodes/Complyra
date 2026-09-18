import { useEffect, useRef, useState } from "react";
import { useData } from "../../data/DataProvider";
import {
  investigationDraftTitle,
  validateInvestigationInput,
  type Investigation,
  type InvestigationSourceMetric,
} from "../../data/investigations";

interface StartInvestigationFormProps {
  siteId: string;
  sourceMetric: InvestigationSourceMetric;
  sourceRecordId?: string | null;
  sourceLabel?: string | null;
  staff: Array<{ id: string; name: string }>;
  /** Prefilled title; defaults to investigationDraftTitle(metric, label). */
  onCreated: (created: Investigation) => void;
  onCancel: () => void;
}

/** Small "Start investigation" form offered inside every inspection drawer. */
export default function StartInvestigationForm({
  siteId,
  sourceMetric,
  sourceRecordId,
  sourceLabel,
  staff,
  onCreated,
  onCancel,
}: StartInvestigationFormProps) {
  const { api } = useData();
  const label = (sourceLabel ?? "").trim();
  const [title, setTitle] = useState(() =>
    investigationDraftTitle(sourceMetric, label),
  );
  const [description, setDescription] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit() {
    setFailed("");
    const problems = validateInvestigationInput({
      title,
      dueOn: dueOn || null,
      sourceMetric,
    });
    if (!assignedToUserId) problems.push("Pick a staff member to own this.");
    setErrors(problems);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      const created = await api.addInvestigation({
        siteId,
        sourceMetric,
        sourceRecordId: sourceRecordId ?? null,
        sourceLabel: label || null,
        title: title.trim(),
        description: description.trim() || null,
        assignedToUserId,
        dueOn: dueOn || null,
      });
      onCreated(created);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not start the investigation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="investigation-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3>Start investigation</h3>
      {errors.length > 0 && (
        <ul className="investigation-form-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="investigation-form-errors" role="alert">
          {failed}
        </p>
      )}
      <label>
        <span>Title</span>
        <input
          ref={titleRef}
          type="text"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea
          value={description}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should the owner look into?"
        />
      </label>
      <div className="investigation-form-row">
        <label>
          <span>Owner</span>
          <select
            value={assignedToUserId}
            onChange={(e) => setAssignedToUserId(e.target.value)}
          >
            <option value="">Select staff…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Due date</span>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </label>
      </div>
      <div className="investigation-form-actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Starting…" : "Start investigation"}
        </button>
      </div>
    </form>
  );
}
