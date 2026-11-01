/**
 * Issue #76 — the scheduled-medication MAR check-off on the Individual chart.
 *
 * Lists today's scheduled doses (medication × dose time). One tap records a
 * status (Given / Missed / LOA / On hold); any status "marks" the dose and
 * clears its Overview due item immediately. PRN meds never appear here. Never
 * uses "eMAR" / "T-Log" jargon; Individuals wording only.
 */
import { useEffect, useMemo, useState } from "react";
import { Pill } from "lucide-react";
import { Empty } from "../components";
import { useData } from "../data/DataProvider";
import { canLogDoseException } from "../data/chart";
import { centralTodayIso } from "../data/menuRecords";
import { formatClock, hhmmToMinutes } from "../data/dueItems";
import type {
  MedDoseMark,
  MedDoseMarkStatus,
  MedInventoryView,
} from "../data/types";

const STATUS_ORDER: MedDoseMarkStatus[] = ["given", "missed", "loa", "on_hold"];
const STATUS_LABEL: Record<MedDoseMarkStatus, string> = {
  given: "Given",
  missed: "Missed",
  loa: "LOA",
  on_hold: "On hold",
};

interface DoseRow {
  medicationId: string;
  medName: string;
  strength: string;
  doseTime: string;
  minutes: number;
}

export default function MarCard({
  individualId,
  onMarksChanged,
}: {
  individualId: string;
  /** Called after a mark lands (or a refusal reveals one) so the chart
   * can refresh its own med data — the countdown reads separate state. */
  onMarksChanged?: () => void;
}) {
  const { api, session } = useData();
  // Wave 7M: the MAR day is the agency (Central) day — the same day the
  // phone MAR writes and the due-item clock uses. The old UTC day made
  // every dose read "Not marked" from 7 p.m. on, though the mark existed.
  const today = centralTodayIso();
  const [views, setViews] = useState<MedInventoryView[] | null>(null);
  const [marks, setMarks] = useState<MedDoseMark[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // A mark recorded after the dose window ends needs a late reason; when
  // the API refuses for that, the row opens a reason input and retries.
  const [latePrompt, setLatePrompt] = useState<{
    key: string;
    status: MedDoseMarkStatus;
    reason: string;
  } | null>(null);

  async function reloadMarks() {
    try {
      setMarks(await api.getMedDoseMarks(individualId, today));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    let live = true;
    setViews(null);
    setError("");
    Promise.all([
      api.getMedInventory(individualId),
      api.getMedDoseMarks(individualId, today),
    ])
      .then(([inv, m]) => {
        if (!live) return;
        setViews(inv);
        setMarks(m);
      })
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, individualId, today]);

  const doses = useMemo<DoseRow[]>(() => {
    const rows: DoseRow[] = [];
    for (const v of views ?? []) {
      if (v.kind !== "scheduled") continue;
      for (const t of v.doseTimes) {
        rows.push({
          medicationId: v.medicationId,
          medName: v.medicationName,
          strength: v.strength,
          doseTime: t,
          minutes: hhmmToMinutes(t),
        });
      }
    }
    return rows.sort((a, b) => a.minutes - b.minutes);
  }, [views]);

  if (!session) return null;
  const canMark = canLogDoseException(session.roleKey);

  function markFor(medicationId: string, doseTime: string): MedDoseMark | undefined {
    return marks.find(
      (m) => m.medicationId === medicationId && m.doseTime === doseTime,
    );
  }

  async function mark(
    medicationId: string,
    doseTime: string,
    status: MedDoseMarkStatus,
    lateReason?: string,
  ) {
    const key = `${medicationId}:${doseTime}`;
    setError("");
    setBusy(key);
    try {
      await api.markMedDose({
        medicationId,
        doseDate: today,
        doseTime,
        status,
        lateReason,
        // Wave 7M: when this card already shows a mark, the tap is a
        // deliberate correction — pass the mark's timestamp as the base.
        // With no mark on screen the attempt is a first mark, and the
        // API refuses it if another session marked the dose meanwhile.
        baseMarkedAt: markFor(medicationId, doseTime)?.markedAt,
      });
      setLatePrompt(null);
      await reloadMarks();
      onMarksChanged?.();
    } catch (err) {
      const message = (err as Error).message;
      if (!lateReason && message.includes("past its recording window")) {
        setLatePrompt({ key, status, reason: "" });
      } else {
        setError(message);
        if (message.startsWith("Already ")) {
          // Someone else marked this dose: pull the real mark in so the
          // row now shows who recorded it instead of "Not marked".
          await reloadMarks();
          onMarksChanged?.();
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="chart-widget mar-card" aria-labelledby="mar-heading">
      <div className="chart-widget-head">
        <h2 id="mar-heading">
          <Pill size={16} aria-hidden="true" /> Medication administration — today
        </h2>
      </div>
      <p className="muted mar-help">
        Scheduled doses for today. Marking Given, Missed, LOA, or On hold clears
        the dose from the site due-items list.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {views && doses.length === 0 && (
        <Empty
          mark="none"
          title="No scheduled doses"
          text="No scheduled medications with dose times for today."
        />
      )}

      {doses.length > 0 && (
        <ul className="record-list mar-list">
          {doses.map((dose) => {
            const key = `${dose.medicationId}:${dose.doseTime}`;
            const existing = markFor(dose.medicationId, dose.doseTime);
            return (
              <li key={key} className="record-row mar-row">
                <div className="mar-row-body">
                  <strong>
                    {dose.medName} {dose.strength}
                  </strong>
                  <span className="muted"> · {formatClock(dose.minutes)}</span>
                  {existing ? (
                    <p className="muted mar-status">
                      {STATUS_LABEL[existing.status]} · {existing.markedByName}
                      {existing.late
                        ? ` · Late${existing.lateReason ? `: ${existing.lateReason}` : ""}`
                        : ""}
                    </p>
                  ) : (
                    <p className="muted mar-status mar-status-open">Not marked</p>
                  )}
                  {latePrompt?.key === key && (
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void mark(
                          dose.medicationId,
                          dose.doseTime,
                          latePrompt.status,
                          latePrompt.reason,
                        );
                      }}
                    >
                      <label>
                        This dose is past its recording window. Reason for the
                        late entry (required)
                        <input
                          value={latePrompt.reason}
                          onChange={(event) =>
                            setLatePrompt((prev) =>
                              prev
                                ? { ...prev, reason: event.target.value }
                                : prev,
                            )
                          }
                        />
                      </label>
                      <button
                        className="button primary"
                        type="submit"
                        disabled={!latePrompt.reason.trim() || busy === key}
                      >
                        Save late entry
                      </button>
                    </form>
                  )}
                </div>
                {canMark && (
                  <div className="mar-actions">
                    {STATUS_ORDER.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={
                          existing?.status === status
                            ? "button primary mar-status-button"
                            : "button mar-status-button"
                        }
                        disabled={busy === key}
                        onClick={() => void mark(dose.medicationId, dose.doseTime, status)}
                      >
                        {STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
