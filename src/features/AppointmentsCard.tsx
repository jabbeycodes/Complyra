import { useState } from "react";
import { CalendarDays, Download, Pencil, Printer, Plus, Trash2 } from "lucide-react";
import {
  APPOINTMENT_TIMEZONES,
  DEFAULT_APPOINTMENT_TIMEZONE,
  formatAppointmentWhen,
  type Appointment,
  type AppointmentDraft,
} from "../data/appointments";

export default function AppointmentsCard({
  individualName,
  defaultVisitAddress,
  appointments,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
  onGenerate,
}: {
  individualName: string;
  defaultVisitAddress: string;
  appointments: Appointment[];
  canManage: boolean;
  onCreate: (draft: AppointmentDraft) => Promise<void>;
  onUpdate: (id: string, draft: AppointmentDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGenerate: (appointment: Appointment, mode: "download" | "print") => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);

  return (
    <section className="chart-widget health-widget" aria-labelledby="health-heading">
      <h2 id="health-heading">Health</h2>
      <p className="stack-help">
        Appointments for {individualName}. Generate a consultation packet from
        this chart before a visit.
      </p>
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
      {appointments.map((row) => (
        <article key={row.id} className="obligation-card appointment-card">
          <header>
            <span className="kind-pill renewal current">
              <CalendarDays size={12} /> Appointment
            </span>
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
            <div className="chart-actions">
              <button
                className="button"
                type="button"
                onClick={() => onGenerate(row, "download")}
              >
                <Download size={16} /> Generate consultation packet
              </button>
              <button
                className="button"
                type="button"
                onClick={() => onGenerate(row, "print")}
              >
                <Printer size={16} /> Print packet
              </button>
              {canManage && (
                <>
                  <button
                    className="button"
                    type="button"
                    onClick={() => setEditingId(row.id)}
                  >
                    <Pencil size={16} /> Edit
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove this appointment? The consultation packet can still be generated from remaining visits.",
                        )
                      ) {
                        void onDelete(row.id);
                      }
                    }}
                  >
                    <Trash2 size={16} /> Remove
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
    </section>
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
