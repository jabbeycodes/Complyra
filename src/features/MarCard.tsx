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
import { canLogDoseException, todayIso } from "../data/chart";
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

export default function MarCard({ individualId }: { individualId: string }) {
  const { api, session } = useData();
  const today = todayIso();
  const [views, setViews] = useState<MedInventoryView[] | null>(null);
  const [marks, setMarks] = useState<MedDoseMark[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

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
  ) {
    const key = `${medicationId}:${doseTime}`;
    setError("");
    setBusy(key);
    try {
      await api.markMedDose({ medicationId, doseDate: today, doseTime, status });
      await reloadMarks();
    } catch (err) {
      setError((err as Error).message);
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
                    </p>
                  ) : (
                    <p className="muted mar-status mar-status-open">Not marked</p>
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
