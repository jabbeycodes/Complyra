/**
 * Issue #100 — medication list on the Individual chart's Medications tab.
 * Full MAR configuration per medication: name, strength/dosage form,
 * indication, instructions, begin date/time, frequency, schedule repeat,
 * time slots, route, prescribing physician, PRN criteria, order attachment
 * (PDF), and active/discontinued status. Add/edit/discontinue are gated to
 * staff who configure the MAR; every change is audit-logged.
 */
import { useRef, useState } from "react";
import { useData } from "../../data/DataProvider";
import {
  canConfigureMar,
  defaultMarConfig,
  normalizeBeginDateInput,
  type MedicationMarConfig,
  type MedicationMarView,
  type NewMedicationInput,
} from "../../data/mar";
import { formatDate } from "../../components";

function emptyConfig(): Partial<MedicationMarConfig> {
  return { ...defaultMarConfig(), timeSlots: [] };
}

function parseTimeSlots(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((slot) => slot.trim())
    .filter(Boolean);
}

export default function MedicationList({
  individualId,
  meds,
  onChanged,
}: {
  individualId: string;
  meds: MedicationMarView[];
  onChanged: () => Promise<void>;
}) {
  const { api, session } = useData();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [discontinuingId, setDiscontinuingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canConfigure = session != null && canConfigureMar(session.roleKey);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      setShowAdd(false);
      setEditingId(null);
      setDiscontinuingId(null);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const active = meds.filter((med) => med.mar.status === "active");
  const discontinued = meds.filter((med) => med.mar.status === "discontinued");

  return (
    <section className="mar-block" aria-label="Medication list">
      <h3>Medication list</h3>
      {error && <p className="mar-error">{error}</p>}
      {meds.length === 0 && <p className="mar-help">No medications on this chart yet.</p>}
      {[...active, ...discontinued].map((med) => (
        <article key={med.id} className="mar-med-card">
          <header>
            <h4>
              {med.name} {med.strength}
            </h4>
            <span className={`kind-pill ${med.kind}`}>{med.kind}</span>
            {med.controlled && <span className="kind-pill control">Control</span>}
            <span
              className={
                med.mar.status === "active" ? "mar-status-active" : "mar-status-discontinued"
              }
            >
              {med.mar.status === "active" ? "Active" : "Discontinued"}
            </span>
          </header>
          <dl className="mar-med-detail">
            <div>
              <span className="label">Dosage form: </span>
              {med.mar.dosageForm || "—"}
            </div>
            <div>
              <span className="label">Indication: </span>
              {med.mar.indication || "—"}
            </div>
            <div>
              <span className="label">Instructions: </span>
              {med.mar.instructions || "—"}
            </div>
            <div>
              <span className="label">Begin: </span>
              {med.mar.beginAt ? formatDate(med.mar.beginAt) : "—"}
            </div>
            <div>
              <span className="label">Frequency: </span>
              {med.mar.frequencyLabel || (med.kind === "scheduled" ? `${med.pillsPerDay} per day` : "As needed")}
            </div>
            <div>
              <span className="label">Schedule: </span>
              {med.mar.scheduleRepeat || "—"}
            </div>
            <div>
              <span className="label">Time slots: </span>
              {med.mar.timeSlots.length > 0 ? med.mar.timeSlots.join(", ") : med.kind === "prn" ? "PRN" : "—"}
            </div>
            <div>
              <span className="label">Route: </span>
              {med.mar.route || "—"}
            </div>
            <div>
              <span className="label">Prescriber: </span>
              {med.mar.prescriber || "—"}
            </div>
            {med.kind === "prn" && (
              <div>
                <span className="label">PRN criteria: </span>
                {med.mar.prnCriteria || "—"}
              </div>
            )}
            {med.mar.status === "discontinued" && (
              <div>
                <span className="label">Discontinued: </span>
                {med.mar.discontinuedOn ? formatDate(med.mar.discontinuedOn) : "—"}
              </div>
            )}
            <div>
              <span className="label">Order: </span>
              {med.mar.orderAttachment ? (
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    run(async () => {
                      const file = await api.getMedicationOrderAttachment(med.id);
                      if (!file) throw new Error("That order file is not stored yet.");
                      const url = URL.createObjectURL(file.blob);
                      window.open(url, "_blank", "noopener");
                    })
                  }
                >
                  View {med.mar.orderAttachment.name}
                </button>
              ) : (
                "No order attached"
              )}
            </div>
          </dl>
          {canConfigure && med.mar.status === "active" && (
            <div className="mar-form-actions">
              <button type="button" className="button" onClick={() => setEditingId(med.id)}>
                Edit
              </button>
              {canConfigure && (
                <OrderAttachmentUpload
                  medicationId={med.id}
                  onUploaded={() => run(async () => undefined)}
                  onError={setError}
                />
              )}
              <button
                type="button"
                className="button"
                onClick={() => setDiscontinuingId(med.id)}
              >
                Discontinue
              </button>
            </div>
          )}
          {editingId === med.id && canConfigure && (
            <MedicationForm
              key={`edit-${med.id}`}
              initial={{
                name: med.name,
                strength: med.strength,
                kind: med.kind,
                controlled: med.controlled,
                pillsPerDay: med.pillsPerDay,
                remainingPills: med.remainingPills,
                config: med.mar,
              }}
              submitLabel="Save changes"
              onCancel={() => setEditingId(null)}
              onSubmit={(input) => run(() => api.updateMedication(med.id, input))}
            />
          )}
          {discontinuingId === med.id && canConfigure && (
            <DiscontinueForm
              onCancel={() => setDiscontinuingId(null)}
              onSubmit={(on) => run(() => api.discontinueMedication(med.id, on))}
            />
          )}
        </article>
      ))}
      {canConfigure && (
        <div className="mar-form-actions">
          <button type="button" className="button primary" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Cancel" : "Add medication"}
          </button>
        </div>
      )}
      {showAdd && canConfigure && (
        <MedicationForm
          initial={{ config: emptyConfig() }}
          submitLabel="Add medication"
          onCancel={() => setShowAdd(false)}
          onSubmit={(input) =>
            run(async () => {
              await api.addMedication({ ...input, individualId });
            })
          }
        />
      )}
    </section>
  );
}

function OrderAttachmentUpload({
  medicationId,
  onUploaded,
  onError,
}: {
  medicationId: string;
  onUploaded: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const { api } = useData();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Attach physician order PDF"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        className="button"
        disabled={!file || busy}
        onClick={async () => {
          if (!file) return;
          setBusy(true);
          try {
            await api.uploadMedicationOrderAttachment({ medicationId, file });
            setFile(null);
            await onUploaded();
          } catch (err) {
            onError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Uploading…" : "Attach order"}
      </button>
    </span>
  );
}

function DiscontinueForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (on: string) => Promise<void>;
}) {
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <form
      className="mar-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(on);
      }}
    >
      <label>
        Discontinued on
        <input type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      <div className="mar-form-actions">
        <button type="submit" className="button primary">
          Discontinue medication
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MedicationForm({
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: Partial<NewMedicationInput>;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (input: Omit<NewMedicationInput, "individualId">) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [strength, setStrength] = useState(initial.strength ?? "");
  const [kind, setKind] = useState<"scheduled" | "prn">(initial.kind ?? "scheduled");
  const [controlled, setControlled] = useState(initial.controlled ?? false);
  const [pillsPerDay, setPillsPerDay] = useState(String(initial.pillsPerDay ?? 1));
  const [remainingPills, setRemainingPills] = useState(String(initial.remainingPills ?? 0));
  const cfg = { ...defaultMarConfig(), ...(initial.config ?? {}) };
  const [dosageForm, setDosageForm] = useState(cfg.dosageForm);
  const [indication, setIndication] = useState(cfg.indication);
  const [instructions, setInstructions] = useState(cfg.instructions);
  // The begin date is read straight from the DOM at submit time (via ref)
  // rather than React state: native date-picker commits have been observed to
  // bypass onChange state updates, leaving the submitted value blank.
  const beginAtRef = useRef<HTMLInputElement | null>(null);
  const [frequencyLabel, setFrequencyLabel] = useState(cfg.frequencyLabel);
  const [scheduleRepeat, setScheduleRepeat] = useState(cfg.scheduleRepeat);
  const [timeSlots, setTimeSlots] = useState((cfg.timeSlots ?? []).join(", "));
  const [route, setRoute] = useState(cfg.route);
  const [prescriber, setPrescriber] = useState(cfg.prescriber);
  const [prnCriteria, setPrnCriteria] = useState(cfg.prnCriteria);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mar-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSubmit({
          name,
          strength,
          kind,
          controlled,
          pillsPerDay: Number(pillsPerDay),
          remainingPills: Number(remainingPills),
          config: {
            dosageForm,
            indication,
            instructions,
            beginAt: normalizeBeginDateInput(beginAtRef.current?.value ?? ""),
            frequencyLabel,
            scheduleRepeat,
            timeSlots: parseTimeSlots(timeSlots),
            route,
            prescriber,
            prnCriteria,
          },
        }).finally(() => setBusy(false));
      }}
    >
      <div className="mar-form-row">
        <label>
          Medication name *
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Strength *
          <input
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            placeholder="e.g. 10 mg"
            required
          />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as "scheduled" | "prn")}>
            <option value="scheduled">Scheduled</option>
            <option value="prn">PRN (as needed)</option>
          </select>
        </label>
      </div>
      <div className="mar-form-row">
        <label>
          Dosage form
          <input value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} placeholder="e.g. tablet" />
        </label>
        <label>
          Indication / purpose
          <input value={indication} onChange={(e) => setIndication(e.target.value)} placeholder="e.g. blood pressure" />
        </label>
        <label>
          Route
          <input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="e.g. by mouth" />
        </label>
      </div>
      <div className="mar-form-row">
        <label>
          Pills per day {kind === "scheduled" && "*"}
          <input
            type="number"
            min="0"
            step="1"
            value={pillsPerDay}
            onChange={(e) => setPillsPerDay(e.target.value)}
          />
        </label>
        <label>
          Starting pill count *
          <input
            type="number"
            min="0"
            step="1"
            value={remainingPills}
            onChange={(e) => setRemainingPills(e.target.value)}
          />
        </label>
        <label>
          Begin date
          <input
            ref={beginAtRef}
            type="date"
            name="beginAt"
            defaultValue={cfg.beginAt?.slice(0, 10) ?? ""}
          />
        </label>
      </div>
      {kind === "scheduled" && (
        <div className="mar-form-row">
          <label>
            Time slots (24h, comma-separated) *
            <input
              value={timeSlots}
              onChange={(e) => setTimeSlots(e.target.value)}
              placeholder="08:00, 20:00"
            />
          </label>
          <label>
            Frequency
            <input value={frequencyLabel} onChange={(e) => setFrequencyLabel(e.target.value)} placeholder="e.g. twice daily" />
          </label>
          <label>
            Schedule repeat
            <input value={scheduleRepeat} onChange={(e) => setScheduleRepeat(e.target.value)} placeholder="e.g. every day" />
          </label>
        </div>
      )}
      <label>
        Instructions / comments
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} />
      </label>
      <div className="mar-form-row">
        <label>
          Prescribing physician
          <input value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
        </label>
        {kind === "prn" && (
          <label>
            PRN indication criteria
            <input value={prnCriteria} onChange={(e) => setPrnCriteria(e.target.value)} placeholder="e.g. pain 4+/10" />
          </label>
        )}
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
        <input type="checkbox" checked={controlled} onChange={(e) => setControlled(e.target.checked)} />
        Controlled medication
      </label>
      <div className="mar-form-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
