import { useState } from "react";
import { CalendarDays, Download, Pencil, Printer, Trash2, Upload } from "lucide-react";
import {
  appointmentStatus,
  formatAppointmentWhen,
  formatCompletedBy,
  formatLoggedBy,
  formatRemovedBy,
  formatUpdatedBy,
  isAppointmentRemoved,
  type Appointment,
} from "../../data/appointments";

export function WhoWhen({
  stamp,
}: {
  stamp: {
    createdByName: string;
    createdAt: string;
    updatedByName: string;
    updatedAt: string;
    deletedByName?: string;
    deletedAt?: string | null;
    completedByName?: string;
    completedAt?: string | null;
  };
}) {
  return (
    <>
      {stamp.createdByName && stamp.createdAt ? (
        <p className="health-stamp">{formatLoggedBy(stamp.createdByName, stamp.createdAt)}</p>
      ) : null}
      {stamp.updatedByName &&
      stamp.updatedAt &&
      stamp.updatedAt !== stamp.createdAt &&
      stamp.updatedAt !== stamp.completedAt ? (
        <p className="health-stamp">{formatUpdatedBy(stamp.updatedByName, stamp.updatedAt)}</p>
      ) : null}
      {stamp.completedAt && stamp.completedByName ? (
        <p className="health-stamp">{formatCompletedBy(stamp.completedByName, stamp.completedAt)}</p>
      ) : null}
      {stamp.deletedAt && stamp.deletedByName ? (
        <p className="health-stamp">{formatRemovedBy(stamp.deletedByName, stamp.deletedAt)}</p>
      ) : null}
    </>
  );
}

export function AppointmentStatusPill({ appointment }: { appointment: Appointment }) {
  const removed = isAppointmentRemoved(appointment);
  const status = appointmentStatus(appointment);
  const label = removed ? "Removed" : status === "completed" ? "Completed" : "Upcoming";
  const tone = removed ? "overdue" : status === "completed" ? "current" : "due_soon";
  return (
    <span className={`kind-pill renewal ${tone}`}>
      <CalendarDays size={12} /> {label}
    </span>
  );
}

export function AppointmentActions({
  appointment,
  canManage,
  canComplete,
  onGenerate,
  onComplete,
  onOpenFile,
  onEdit,
  onDelete,
}: {
  appointment: Appointment;
  canManage: boolean;
  canComplete: boolean;
  onGenerate: (appointment: Appointment, mode: "download" | "print") => Promise<void>;
  onComplete: (appointment: Appointment, file: File, comments: string) => Promise<void>;
  onOpenFile: (fileId: string) => Promise<void>;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const removed = isAppointmentRemoved(appointment);
  const completed = Boolean(appointment.completedAt);
  const [completing, setCompleting] = useState(false);

  return (
    <>
      {appointment.visitComments ? <p>{appointment.visitComments}</p> : null}
      <WhoWhen stamp={appointment} />
      {completing && !removed && !completed ? (
        <CompleteForm
          onCancel={() => setCompleting(false)}
          onSave={async (file, comments) => {
            await onComplete(appointment, file, comments);
            setCompleting(false);
          }}
        />
      ) : (
        <div className="chart-actions">
          {!removed && (
            <>
              <button
                className="button"
                type="button"
                onClick={() => onGenerate(appointment, "download")}
              >
                <Download size={16} /> Generate consultation packet
              </button>
              <button
                className="button"
                type="button"
                onClick={() => onGenerate(appointment, "print")}
              >
                <Printer size={16} /> Print packet
              </button>
            </>
          )}
          {!removed && completed && appointment.consultationFileId ? (
            <button
              className="button"
              type="button"
              onClick={() => onOpenFile(appointment.consultationFileId!)}
            >
              <Download size={16} /> Open consultation form
            </button>
          ) : null}
          {!removed && !completed && canComplete && (
            <button className="button primary" type="button" onClick={() => setCompleting(true)}>
              <Upload size={16} /> Upload consultation form
            </button>
          )}
          {canManage && !removed && onEdit && (
            <button className="button" type="button" onClick={onEdit}>
              <Pencil size={16} /> Edit
            </button>
          )}
          {canManage && !removed && onDelete && (
            <button
              className="button"
              type="button"
              onClick={() => {
                if (
                  window.confirm("Remove this appointment? It stays on the chart as removed.")
                ) {
                  onDelete();
                }
              }}
            >
              <Trash2 size={16} /> Remove
            </button>
          )}
        </div>
      )}
    </>
  );
}

function CompleteForm({
  onSave,
  onCancel,
}: {
  onSave: (file: File, comments: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="renewal-upload appointment-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        try {
          await onSave(file, comments);
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>After the visit</strong>
      <p className="stack-help">
        Uploading the consultation form marks this appointment completed.
      </p>
      <label htmlFor="consultation-form-file">
        Consultation form
        <input
          id="consultation-form-file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label htmlFor="consultation-comments">
        Comments
        <textarea
          id="consultation-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Optional notes from the visit"
          rows={3}
        />
      </label>
      <div className="chart-actions">
        <button className="button primary" type="submit" disabled={busy || !file}>
          Upload and complete
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
