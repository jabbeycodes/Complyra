import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  APPOINTMENT_TIMEZONES,
  DEFAULT_APPOINTMENT_TIMEZONE,
  formatAppointmentWhen,
  isAppointmentRemoved,
  type Appointment,
  type AppointmentDraft,
} from "../data/appointments";
import type { Allergy, AllergiesStamp, IndividualProfile } from "../data/planStack";
import {
  AppointmentActions,
  AppointmentStatusPill,
  WhoWhen,
} from "./appointments/appointmentUi";

export default function HealthCard({
  individualName,
  defaultVisitAddress,
  appointments,
  profile,
  canManage,
  canComplete,
  onCreate,
  onUpdate,
  onDelete,
  onGenerate,
  onComplete,
  onOpenConsultation,
  onSaveAllergies,
}: {
  individualName: string;
  defaultVisitAddress: string;
  appointments: Appointment[];
  profile: IndividualProfile;
  canManage: boolean;
  canComplete: boolean;
  onCreate: (draft: AppointmentDraft) => Promise<void>;
  onUpdate: (id: string, draft: AppointmentDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGenerate: (appointment: Appointment, mode: "download" | "print") => Promise<void>;
  onComplete: (appointment: Appointment, file: File, comments: string) => Promise<void>;
  onOpenConsultation: (fileId: string) => Promise<void>;
  onSaveAllergies: (allergies: Allergy[]) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [editingAllergies, setEditingAllergies] = useState(false);

  return (
    <section className="chart-widget health-widget" aria-labelledby="health-heading">
      <h2 id="health-heading">Health</h2>
      <p className="stack-help">
        Appointments and allergies for {individualName}. Generate a consultation
        packet from this chart before a visit. Upload the consultation form after
        the visit to complete it.
      </p>

      <AllergiesBlock
        allergies={profile.allergies}
        stamp={profile.allergiesStamp}
        canEdit={canManage}
        editing={editingAllergies}
        onEdit={() => setEditingAllergies(true)}
        onCancel={() => setEditingAllergies(false)}
        onSave={async (allergies) => {
          await onSaveAllergies(allergies);
          setEditingAllergies(false);
        }}
      />

      <h3 id="health-appointments-heading">Appointments</h3>
      <div className="chart-actions">
        {canManage && (
          <button
            className="button primary"
            type="button"
            onClick={() => setEditingId("new")}
          >
            <Plus size={16} /> New appointment
          </button>
        )}
      </div>
      {editingId === "new" && (
        <AppointmentForm
          title="New appointment"
          initial={blankDraft(defaultVisitAddress)}
          onCancel={() => setEditingId(null)}
          onSave={async (draft) => {
            await onCreate(draft);
            setEditingId(null);
          }}
        />
      )}
      {appointments.length === 0 && editingId !== "new" && (
        <p>No appointments for this Individual yet.</p>
      )}
      {appointments.map((row) => {
        const removed = isAppointmentRemoved(row);
        return (
          <article
            key={row.id}
            className={`obligation-card appointment-card${removed ? " appointment-removed" : ""}`}
          >
            <header>
              <AppointmentStatusPill appointment={row} />
              <h3>{row.consultant}</h3>
            </header>
            <p>{formatAppointmentWhen(row)}</p>
            {row.specialty ? <p>{row.specialty}</p> : null}
            {row.reason ? <p>{row.reason}</p> : null}
            {editingId === row.id ? (
              <AppointmentForm
                title="Edit appointment"
                initial={toDraft(row)}
                onCancel={() => setEditingId(null)}
                onSave={async (draft) => {
                  await onUpdate(row.id, draft);
                  setEditingId(null);
                }}
              />
            ) : (
              <AppointmentActions
                appointment={row}
                canManage={canManage}
                canComplete={canComplete}
                onGenerate={onGenerate}
                onComplete={onComplete}
                onOpenFile={onOpenConsultation}
                onEdit={() => setEditingId(row.id)}
                onDelete={() => onDelete(row.id)}
              />
            )}
          </article>
        );
      })}
    </section>
  );
}

function AllergiesBlock({
  allergies,
  stamp,
  canEdit,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  allergies: Allergy[];
  stamp: AllergiesStamp | null;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (allergies: Allergy[]) => Promise<void>;
}) {
  return (
    <article className="obligation-card allergy-card">
      <header>
        <span className="kind-pill renewal current">Allergies</span>
        <h3>Allergies</h3>
      </header>
      {editing ? (
        <AllergyForm
          initial={allergies}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : (
        <>
          {allergies.length === 0 ? (
            <p>No allergies on file for this Individual.</p>
          ) : (
            <ul className="allergy-list">
              {allergies.map((row) => (
                <li key={`${row.allergen}-${row.status}`}>
                  <strong>{row.allergen}</strong>
                  {` (${row.status})`}
                  {row.reaction ? ` — ${row.reaction}` : ""}
                </li>
              ))}
            </ul>
          )}
          {stamp ? <WhoWhen stamp={stamp} /> : null}
          {canEdit && (
            <div className="chart-actions">
              <button className="button" type="button" onClick={onEdit}>
                <Pencil size={16} /> Edit allergies
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

function AllergyForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Allergy[];
  onSave: (allergies: Allergy[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<Allergy[]>(
    initial.length ? initial : [{ allergen: "", reaction: "", status: "active" }],
  );
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="renewal-upload appointment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(rows);
        } finally {
          setBusy(false);
        }
      }}
    >
      {rows.map((row, index) => (
        <fieldset key={index} className="allergy-row">
          <label>
            Allergen
            <input
              value={row.allergen}
              onChange={(e) =>
                setRows(rows.map((item, i) => (i === index ? { ...item, allergen: e.target.value } : item)))
              }
              placeholder="Tree nuts"
            />
          </label>
          <label>
            Reaction
            <input
              value={row.reaction}
              onChange={(e) =>
                setRows(rows.map((item, i) => (i === index ? { ...item, reaction: e.target.value } : item)))
              }
              placeholder="Optional"
            />
          </label>
          <label>
            Status
            <select
              value={row.status}
              onChange={(e) =>
                setRows(
                  rows.map((item, i) =>
                    i === index ? { ...item, status: e.target.value as Allergy["status"] } : item,
                  ),
                )
              }
            >
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <button
            className="button"
            type="button"
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </fieldset>
      ))}
      <div className="chart-actions">
        <button
          className="button"
          type="button"
          onClick={() => setRows([...rows, { allergen: "", reaction: "", status: "active" }])}
        >
          Add allergen
        </button>
        <button className="button primary" type="submit" disabled={busy}>
          Save allergies
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function blankDraft(visitAddress: string): AppointmentDraft {
  return {
    startsOn: new Date().toISOString().slice(0, 10),
    startTime: "09:00",
    endTime: "10:00",
    timezone: DEFAULT_APPOINTMENT_TIMEZONE,
    consultant: "",
    specialty: "",
    reason: "",
    visitAddress,
  };
}

function toDraft(row: Appointment): AppointmentDraft {
  return {
    startsOn: row.startsOn,
    startTime: row.startTime,
    endTime: row.endTime,
    timezone: row.timezone,
    consultant: row.consultant,
    specialty: row.specialty,
    reason: row.reason,
    visitAddress: row.visitAddress,
  };
}

function AppointmentForm({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  initial: AppointmentDraft;
  onSave: (draft: AppointmentDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const zones = APPOINTMENT_TIMEZONES.includes(
    draft.timezone as (typeof APPOINTMENT_TIMEZONES)[number],
  )
    ? APPOINTMENT_TIMEZONES
    : ([draft.timezone, ...APPOINTMENT_TIMEZONES] as string[]);

  return (
    <form
      className="renewal-upload appointment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(draft);
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>{title}</strong>
      <label>
        Date
        <input
          type="date"
          value={draft.startsOn}
          onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
          required
        />
      </label>
      <label>
        Start
        <input
          type="time"
          value={draft.startTime}
          onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
          required
        />
      </label>
      <label>
        End
        <input
          type="time"
          value={draft.endTime}
          onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
          required
        />
      </label>
      <label>
        Timezone
        <select
          value={draft.timezone}
          onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <label>
        Consultant
        <input
          value={draft.consultant}
          onChange={(e) => setDraft({ ...draft, consultant: e.target.value })}
          placeholder="Name of the clinician"
          required
        />
      </label>
      <label>
        Specialty
        <input
          value={draft.specialty}
          onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label>
        Reason
        <input
          value={draft.reason}
          onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          placeholder="Optional"
        />
      </label>
      <label>
        Address of visit
        <input
          value={draft.visitAddress}
          onChange={(e) => setDraft({ ...draft, visitAddress: e.target.value })}
          placeholder="Defaults to the Individual’s home address"
        />
      </label>
      <div className="chart-actions">
        <button className="button primary" type="submit" disabled={busy}>
          Save appointment
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
