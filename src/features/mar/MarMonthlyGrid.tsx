/**
 * Issue #100 — MAR monthly administration grid: medications x time slots vs
 * days of the month. Staff record administrations with their initials at the
 * time of giving. Refused/omitted/held doses render circled initials with a
 * reason + nurse notify flag. PRN meds get one row with initials on days
 * given. Every monthly view includes the staff signature log. Print + PDF.
 */
import { useMemo, useState } from "react";
import { useData } from "../../data/DataProvider";
import {
  canRecordMarAdministration,
  canResolveMarConcern,
  collectMarSignatureLog,
  initialsForName,
  marAdminStatusLabel,
  marConcernTypeLabel,
  marGridForMonth,
  marTimeSlotLabel,
  shiftMonthKey,
  type MarAdminStatus,
  type MarAdministration,
  type MarConcern,
  type MarConcernType,
  type MarPrnLog,
  type MedicationMarView,
} from "../../data/mar";
import { formatDate } from "../../components";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { openPrintable } from "../../data/openFile";

function inWindowForDay(med: MedicationMarView, day: number, monthKey: string): boolean {
  const iso = `${monthKey}-${String(day).padStart(2, "0")}`;
  const begin = med.mar.beginAt?.slice(0, 10);
  const end =
    med.mar.status === "discontinued" ? med.mar.discontinuedOn?.slice(0, 10) : undefined;
  if (begin && iso < begin) return false;
  if (end && iso > end) return false;
  return true;
}

export default function MarMonthlyGrid({
  individualId,
  individualName,
  meds,
  administrations,
  prnLogs,
  concerns,
  onChanged,
  monthKey,
  onMonthKeyChange,
}: {
  individualId: string;
  individualName: string;
  meds: MedicationMarView[];
  administrations: MarAdministration[];
  prnLogs: MarPrnLog[];
  concerns: MarConcern[];
  onChanged: () => Promise<void>;
  monthKey: string;
  onMonthKeyChange: (monthKey: string) => void;
}) {
  const { api, session } = useData();
  const [recording, setRecording] = useState<{ medicationId: string; timeSlot: string; day: number } | null>(null);
  const [prnForm, setPrnForm] = useState(false);
  const [concernFor, setConcernFor] = useState<{ administrationId: string | null; prnLogId: string | null } | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  const canRecord = session != null && canRecordMarAdministration(session.roleKey);
  const canResolve = session != null && canResolveMarConcern(session.roleKey);
  const today = new Date().toISOString().slice(0, 10);

  const grid = useMemo(
    () => marGridForMonth({ meds, administrations, prnLogs, monthKey }),
    [meds, administrations, prnLogs, monthKey],
  );
  const signatureLog = useMemo(
    () => collectMarSignatureLog(administrations, prnLogs),
    [administrations, prnLogs],
  );

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      setRecording(null);
      setPrnForm(false);
      setConcernFor(null);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function printMonthly() {
    document.body.dataset.marPrint = "monthly";
    const clear = () => {
      delete document.body.dataset.marPrint;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      const { buildMarMonthlyPdf, marMonthlyFileName } = await import("../../pdf/marMonthlyPdf");
      const doc = buildMarMonthlyPdf({
        individualName,
        monthKey,
        meds,
        grid,
        prnLogs,
        signatureLog,
        concerns,
        generatedByName: session?.fullName ?? "Staff",
        generatedAt: new Date().toISOString(),
      });
      await openPrintable(marMonthlyFileName(individualName, monthKey), doc.output("blob") as Blob, "download");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const recordable = (med: MedicationMarView, day: number) =>
    canRecord && inWindowForDay(med, day, monthKey) && `${monthKey}-${String(day).padStart(2, "0")}` <= today;

  return (
    <section className="mar-block mar-print-area" aria-label="Monthly administration record">
      <h3>Monthly administration record</h3>
      {error && <p className="mar-error">{error}</p>}
      <div className="mar-month-bar">
        <button type="button" className="button" onClick={() => onMonthKeyChange(shiftMonthKey(monthKey, -1))} aria-label="Previous month">
          ‹
        </button>
        <label>
          Month{" "}
          <input type="month" value={monthKey} onChange={(e) => onMonthKeyChange(e.target.value)} />
        </label>
        <button type="button" className="button" onClick={() => onMonthKeyChange(shiftMonthKey(monthKey, 1))} aria-label="Next month">
          ›
        </button>
        <button type="button" className="button" onClick={printMonthly}>
          Print
        </button>
        <button type="button" className="button" onClick={downloadPdf} disabled={downloading}>
          {downloading ? "Building PDF…" : "Download PDF"}
        </button>
      </div>

      <div className="mar-grid-wrap">
        <table className="mar-grid">
          <thead>
            <tr>
              <th scope="col">Medication / time</th>
              {Array.from({ length: grid.daysInMonth }, (_, i) => (
                <th key={i + 1} scope="col">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => {
              const med = meds.find((m) => m.id === row.medicationId)!;
              return (
                <tr key={`${row.medicationId}-${row.timeSlot ?? "prn"}`}>
                  <th scope="row">
                    {row.medicationName}
                    {row.timeSlot ? ` · ${marTimeSlotLabel(row.timeSlot)}` : " · PRN"}
                  </th>
                  {row.cells.map((cell) => {
                    const inWindow = inWindowForDay(med, cell.day, monthKey);
                    const iso = `${monthKey}-${String(cell.day).padStart(2, "0")}`;
                    const admin = cell.administration;
                    if (admin) {
                      const circled = admin.status !== "given";
                      const tooltip = circled
                        ? `${marAdminStatusLabel(admin.status)} — ${admin.reason}${admin.notifyNurse ? " (nurse notified)" : ""}`
                        : `Given by ${admin.administeredByName}`;
                      return (
                        <td key={cell.day}>
                          <span
                            className={
                              circled
                                ? admin.status === "held"
                                  ? "mar-cell-held"
                                  : "mar-cell-circled"
                                : "mar-cell-given"
                            }
                            title={tooltip}
                          >
                            {admin.initials}
                          </span>
                          {canRecord && (
                            <button
                              type="button"
                              className="mar-cell-empty"
                              title="Flag a medication error or adverse reaction"
                              aria-label={`Flag a medication error or adverse reaction for ${med.name} on ${iso}`}
                              onClick={() =>
                                setConcernFor({ administrationId: admin.id, prnLogId: null })
                              }
                            >
                              ⚑
                            </button>
                          )}
                        </td>
                      );
                    }
                    const prn = cell.prnLog;
                    if (prn) {
                      return (
                        <td key={cell.day}>
                          <span
                            className="mar-cell-given"
                            title={`${prn.reasonGiven} — ${prn.effectiveness}`}
                          >
                            {prn.initials}
                          </span>
                          {canRecord && (
                            <button
                              type="button"
                              className="mar-cell-empty"
                              title="Flag a medication error or adverse reaction"
                              aria-label={`Flag a medication error or adverse reaction for ${med.name} PRN dose on ${iso}`}
                              onClick={() => setConcernFor({ administrationId: null, prnLogId: prn.id })}
                            >
                              ⚑
                            </button>
                          )}
                        </td>
                      );
                    }
                    if (!inWindow) {
                      return (
                        <td key={cell.day} className="mar-cell-outside">
                          –
                        </td>
                      );
                    }
                    if (!recordable(med, cell.day)) {
                      if (iso > today) {
                        // Future dates are not recordable (doses are recorded
                        // at dispense time), but the cell stays discoverable
                        // with a proper accessible name.
                        return (
                          <td key={cell.day}>
                            <button
                              type="button"
                              className="mar-cell-empty mar-cell-future"
                              disabled
                              aria-label={`Record dose on ${iso} — not yet due`}
                            >
                              <span aria-hidden="true">·</span>
                            </button>
                          </td>
                        );
                      }
                      return <td key={cell.day} />;
                    }
                    const slotLabel = marTimeSlotLabel(row.timeSlot);
                    return (
                      <td key={cell.day}>
                        <button
                          type="button"
                          className="mar-cell-empty"
                          title={`Record ${slotLabel} dose on ${iso}`}
                          aria-label={`Record ${slotLabel} dose on ${iso}`}
                          onClick={() =>
                            setRecording({
                              medicationId: row.medicationId,
                              timeSlot: row.timeSlot ?? "",
                              day: cell.day,
                            })
                          }
                        >
                          ○
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mar-help">
        Circled initials = refused, omitted, or held. Hover a cell for the reason and nurse
        notification state. PRN rows show initials under the day given.
      </p>

      {recording && (
        <RecordAdministrationForm
          key={`${recording.medicationId}-${recording.timeSlot}-${recording.day}`}
          meds={meds}
          individualId={individualId}
          medicationId={recording.medicationId}
          timeSlot={recording.timeSlot}
          day={recording.day}
          monthKey={monthKey}
          onCancel={() => setRecording(null)}
          onSave={(input) => run(async () => { await api.recordMarAdministration(input); })}
        />
      )}

      {prnForm && canRecord && (
        <PrnLogForm
          meds={meds.filter((med) => med.kind === "prn" && med.mar.status === "active")}
          onCancel={() => setPrnForm(false)}
          onSave={(input) => run(async () => { await api.recordPrnAdministration(input); })}
        />
      )}
      {canRecord && !prnForm && (
        <div className="mar-form-actions">
          <button type="button" className="button primary" onClick={() => setPrnForm(true)}>
            Log PRN dose
          </button>
        </div>
      )}

      {concernFor && canRecord && (
        <ConcernFlagForm
          onCancel={() => setConcernFor(null)}
          onSave={(input) =>
            run(async () => {
              await api.flagMarConcern({
                medicationId: input.medicationId,
                administrationId: concernFor.administrationId,
                prnLogId: concernFor.prnLogId,
                concernType: input.concernType,
                description: input.description,
                initials: input.initials,
              });
            })
          }
          meds={meds}
          administrationId={concernFor.administrationId}
          prnLogId={concernFor.prnLogId}
          administrations={administrations}
          prnLogs={prnLogs}
        />
      )}

      {concerns.length > 0 && (
        <div aria-label="Flagged concerns">
          <h4>Flagged concerns</h4>
          {concerns.map((concern) => {
            const med = meds.find((m) => m.id === concern.medicationId);
            return (
              <div key={concern.id} className={`mar-concern${concern.resolvedAt ? " resolved" : ""}`}>
                <strong>{marConcernTypeLabel(concern.concernType)}</strong> — {med?.name ?? "Medication"} ·{" "}
                flagged {formatDate(concern.createdAt)} by {concern.initials}
                <br />
                {concern.description}
                <br />
                {concern.resolvedAt ? (
                  <span>Resolved {formatDate(concern.resolvedAt)}</span>
                ) : (
                  canResolve && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => run(() => api.resolveMarConcern(concern.id))}
                    >
                      Mark resolved
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      <div aria-label="Staff signature log">
        <h4>Staff signature log</h4>
        {signatureLog.length === 0 ? (
          <p className="mar-help">No administrations recorded this period.</p>
        ) : (
          <table className="mar-signature-log">
            <thead>
              <tr>
                <th scope="col">Initials</th>
                <th scope="col">Full name</th>
              </tr>
            </thead>
            <tbody>
              {signatureLog.map((entry) => (
                <tr key={entry.initials}>
                  <td>{entry.initials}</td>
                  <td>{entry.name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ComplyrerRecordMark />
    </section>
  );
}

function RecordAdministrationForm({
  meds,
  individualId,
  medicationId,
  timeSlot,
  day,
  monthKey,
  onCancel,
  onSave,
}: {
  meds: MedicationMarView[];
  individualId: string;
  medicationId: string;
  timeSlot: string;
  day: number;
  monthKey: string;
  onCancel: () => void;
  onSave: (input: {
    medicationId: string;
    administeredOn: string;
    timeSlot: string;
    status: MarAdminStatus;
    initials: string;
    reason: string;
    notifyNurse: boolean;
  }) => Promise<void>;
}) {
  const { session } = useData();
  const med = meds.find((m) => m.id === medicationId)!;
  const date = `${monthKey}-${String(day).padStart(2, "0")}`;
  const [status, setStatus] = useState<MarAdminStatus>("given");
  const [initials, setInitials] = useState(session ? initialsForName(session.fullName) : "");
  const [reason, setReason] = useState("");
  const [notifyNurse, setNotifyNurse] = useState(false);

  return (
    <form
      className="mar-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          medicationId,
          administeredOn: date,
          timeSlot,
          status,
          initials,
          reason,
          notifyNurse: notifyNurse || status === "refused" || status === "omitted",
        });
      }}
    >
      <h4>
        Record {med.name} {med.strength} — {marTimeSlotLabel(timeSlot)} on {formatDate(date)}
      </h4>
      <div className="mar-form-row">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as MarAdminStatus)}>
            <option value="given">Given</option>
            <option value="refused">Refused</option>
            <option value="omitted">Omitted</option>
            <option value="held">Held</option>
          </select>
        </label>
        <label>
          Your initials *
          <input value={initials} onChange={(e) => setInitials(e.target.value)} required />
        </label>
      </div>
      {status !== "given" && (
        <>
          <label>
            Reason (required) *
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={notifyNurse || status === "refused" || status === "omitted"}
              onChange={(e) => setNotifyNurse(e.target.checked)}
            />
            Notify the nurse
          </label>
        </>
      )}
      <div className="mar-form-actions">
        <button type="submit" className="button primary">
          Record administration
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PrnLogForm({
  meds,
  onCancel,
  onSave,
}: {
  meds: MedicationMarView[];
  onCancel: () => void;
  onSave: (input: {
    medicationId: string;
    givenAt: string;
    pillsGiven: number;
    reasonGiven: string;
    effectiveness: string;
  }) => Promise<void>;
}) {
  const [medicationId, setMedicationId] = useState(meds[0]?.id ?? "");
  const [givenAt, setGivenAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [pills, setPills] = useState("1");
  const [reasonGiven, setReasonGiven] = useState("");
  const [effectiveness, setEffectiveness] = useState("");

  return (
    <form
      className="mar-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          medicationId,
          givenAt: `${givenAt}:00Z`.replace("Z", ""),
          pillsGiven: Number(pills),
          reasonGiven,
          effectiveness,
        });
      }}
    >
      <h4>Log PRN dose</h4>
      {meds.length === 0 && <p className="mar-help">No active PRN medications.</p>}
      <div className="mar-form-row">
        <label>
          PRN medication
          <select value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
            {meds.map((med) => (
              <option key={med.id} value={med.id}>
                {med.name} {med.strength}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date and time given
          <input
            type="datetime-local"
            value={givenAt}
            onChange={(e) => setGivenAt(e.target.value)}
            required
          />
        </label>
        <label>
          Pills given
          <input type="number" min="1" step="1" value={pills} onChange={(e) => setPills(e.target.value)} required />
        </label>
      </div>
      <label>
        Reason given (include pain scale for pain) *
        <textarea value={reasonGiven} onChange={(e) => setReasonGiven(e.target.value)} rows={2} required />
      </label>
      <label>
        Result / effectiveness *
        <textarea value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)} rows={2} required />
      </label>
      <div className="mar-form-actions">
        <button type="submit" className="button primary" disabled={!medicationId}>
          Log PRN dose
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ConcernFlagForm({
  meds,
  administrationId,
  prnLogId,
  administrations,
  prnLogs,
  onCancel,
  onSave,
}: {
  meds: MedicationMarView[];
  administrationId: string | null;
  prnLogId: string | null;
  administrations: MarAdministration[];
  prnLogs: MarPrnLog[];
  onCancel: () => void;
  onSave: (input: {
    medicationId: string;
    concernType: MarConcernType;
    description: string;
    initials: string;
  }) => Promise<void>;
}) {
  const { session } = useData();
  const linkedMedicationId =
    (administrationId ? administrations.find((a) => a.id === administrationId)?.medicationId : null) ??
    (prnLogId ? prnLogs.find((p) => p.id === prnLogId)?.medicationId : null) ??
    meds[0]?.id ??
    "";
  const [medicationId, setMedicationId] = useState(linkedMedicationId);
  const [concernType, setConcernType] = useState<MarConcernType>("med_error");
  const [description, setDescription] = useState("");
  const [initials, setInitials] = useState(session ? initialsForName(session.fullName) : "");

  return (
    <form
      className="mar-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ medicationId, concernType, description, initials });
      }}
    >
      <h4>Flag a medication error or adverse reaction</h4>
      <div className="mar-form-row">
        <label>
          Medication
          <select value={medicationId} onChange={(e) => setMedicationId(e.target.value)}>
            {meds.map((med) => (
              <option key={med.id} value={med.id}>
                {med.name} {med.strength}
              </option>
            ))}
          </select>
        </label>
        <label>
          Concern type
          <select value={concernType} onChange={(e) => setConcernType(e.target.value as MarConcernType)}>
            <option value="med_error">Medication error</option>
            <option value="adverse_reaction">Adverse reaction</option>
          </select>
        </label>
        <label>
          Your initials *
          <input value={initials} onChange={(e) => setInitials(e.target.value)} required />
        </label>
      </div>
      <label>
        What happened? (required — the nurse is notified) *
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required />
      </label>
      <div className="mar-form-actions">
        <button type="submit" className="button primary">
          Flag concern
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
