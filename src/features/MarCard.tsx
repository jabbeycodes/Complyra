/**
 * Issue #76 — the scheduled-medication MAR check-off on the Individual chart.
 *
 * Lists today's scheduled doses (medication × dose time). One tap records a
 * status (Given / Missed / LOA / On hold); any status "marks" the dose and
 * clears its Overview due item immediately. PRN meds never appear here. Never
 * uses "eMAR" / "T-Log" jargon; Individuals wording only.
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pill } from "lucide-react";
import { Empty } from "../components";
import { useData } from "../data/DataProvider";
import { canLogDoseException } from "../data/chart";
import { MED_ADMIN_CLEARANCE_MESSAGE } from "../data/medClearance";
import { useMedAdminLock } from "./medAdminLock";
import MedConsentWarningGate from "./consents/MedConsentWarning";
import { centralTodayIso } from "../data/menuRecords";
import {
  formatCentralTime,
  marDayHeading,
  shiftIsoDate,
} from "./mobile/mar";
import { formatClock, hhmmToMinutes } from "../data/dueItems";
import {
  medOnHand,
  onHandDaysLeftLabel,
  onHandHeadline,
  type MedOnHand,
} from "../data/medInventory";
import type {
  DoseExceptionKind,
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
const EXCEPTION_LABEL: Record<DoseExceptionKind, string> = {
  refused: "Refused",
  held: "Held",
  wasted: "Wasted",
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
  // Dated view (mirrors the phone MAR): the card opens on Central today
  // and can page to any other day; marks and exceptions load for the
  // viewed day, while the on-hand countdown stays a today fact.
  const [dateIso, setDateIso] = useState(today);
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
  // Clearance gate: an uncleared DSP sees the record but no mark buttons.
  const medLocked = useMedAdminLock(api, session);
  // Wave 4C: the same on-hand countdown the phone MAR shows under each
  // med — newest count baseline minus doses recorded Given since — so
  // the chart MAR reads one figure with the board and the forecast. The
  // range read mirrors MobileMar: earliest baseline through today. A
  // failed read names the figure unavailable; it never shows the raw
  // recorded count as on hand.
  const [marksRange, setMarksRange] = useState<MedDoseMark[] | null>(null);
  const [rangeLoad, setRangeLoad] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  async function reloadRange(inv: MedInventoryView[]) {
    const earliest =
      inv
        .map((view) => (view.lastCountedOn ?? view.deliveredOn ?? today).slice(0, 10))
        .sort()[0] ?? today;
    try {
      setMarksRange(await api.getMedDoseMarksInRange(individualId, earliest, today));
      setRangeLoad("ready");
    } catch {
      setMarksRange(null);
      setRangeLoad("failed");
    }
  }

  async function reloadMarks() {
    try {
      setMarks(await api.getMedDoseMarks(individualId, dateIso));
    } catch (err) {
      setError((err as Error).message);
    }
    if (views) await reloadRange(views);
  }

  useEffect(() => {
    let live = true;
    setViews(null);
    setError("");
    setMarksRange(null);
    setRangeLoad("loading");
    Promise.all([
      api.getMedInventory(individualId),
      api.getMedDoseMarks(individualId, dateIso),
    ])
      .then(([inv, m]) => {
        if (!live) return;
        setViews(inv);
        setMarks(m);
        void reloadRange(inv);
      })
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, individualId, dateIso]);

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

  // Exceptions (refused / held / wasted) recorded on the viewed day —
  // the phone MAR's "Other" list, filtered the same way.
  const dayExceptions = useMemo(
    () =>
      (views ?? []).flatMap((view) =>
        view.doseExceptions
          .filter((exception) => exception.occurredOn === dateIso)
          .map((exception) => ({ view, exception })),
      ),
    [views, dateIso],
  );

  const onHandByMed = new Map<string, MedOnHand>();
  for (const view of views ?? []) {
    if (view.kind !== "scheduled") continue;
    onHandByMed.set(view.medicationId, medOnHand(view, marksRange, today, rangeLoad));
  }

  if (!session) return null;
  const roleCanMark = canLogDoseException(session.roleKey);
  const canMark = roleCanMark && !medLocked;

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
        // The viewed day, exactly as the phone MAR passes it: the API
        // judges the recording window from this date, so a past day's
        // first mark comes back "past its recording window" and lands
        // through the late-reason retry below — never silently
        // back-dated — and an early/future mark is refused by the API
        // and shown as an error.
        doseDate: dateIso,
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
          <Pill size={16} aria-hidden="true" /> Medication administration —{" "}
          {dateIso === today ? "today" : marDayHeading(dateIso, today)}
        </h2>
      </div>
      <p className="muted mar-help">
        {dateIso === today ? (
          <>
            Scheduled doses for today. Marking Given, Missed, LOA, or On hold
            clears the dose from the site due-items list.
          </>
        ) : (
          <>
            Scheduled doses for {marDayHeading(dateIso, today)}. Recording a
            dose for a past day asks for a late-entry reason.
          </>
        )}
      </p>

      {medLocked && roleCanMark && (
        <p className="muted mar-lock-note">{MED_ADMIN_CLEARANCE_MESSAGE}.</p>
      )}

      {/* Founder decision 2026-11-11: an expired/missing/revoked
          medication consent warns loudly here and never blocks a
          mark. Renders nothing while the register loads. */}
      <MedConsentWarningGate individualId={individualId} />

      {/* Day navigation, mirroring the phone MAR: page by day, with a
          one-tap return to today whenever another day is on screen. */}
      <div className="mar-daynav">
        <button
          type="button"
          className="button mar-daynav-button"
          aria-label="Previous day"
          onClick={() => {
            setDateIso((value) => shiftIsoDate(value, -1));
            setLatePrompt(null);
          }}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="mar-daynav-label">
          <strong>{marDayHeading(dateIso, today)}</strong>
          <span className="muted"> · All times Central</span>
        </span>
        <button
          type="button"
          className="button mar-daynav-button"
          aria-label="Next day"
          onClick={() => {
            setDateIso((value) => shiftIsoDate(value, 1));
            setLatePrompt(null);
          }}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        {dateIso !== today && (
          <button
            type="button"
            className="button mar-daynav-today"
            onClick={() => {
              setDateIso(today);
              setLatePrompt(null);
            }}
          >
            Back to today
          </button>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {views && doses.length === 0 && (
        <Empty
          mark="none"
          title="No scheduled doses"
          text={`No scheduled medications with dose times for ${
            dateIso === today ? "today" : "this day"
          }.`}
        />
      )}

      {onHandByMed.size > 0 && (
        <ul className="record-list mar-supply" aria-label="Pills on hand">
          {(views ?? [])
            .filter((view) => onHandByMed.has(view.medicationId))
            .map((view) => {
              const state = onHandByMed.get(view.medicationId)!;
              const days = onHandDaysLeftLabel(state);
              return (
                <li key={view.medicationId} className="record-row mar-supply-row">
                  <span>
                    <strong>
                      {view.medicationName} {view.strength}
                    </strong>{" "}
                    · {onHandHeadline(state)}
                    {days ? ` · ${days}` : ""}
                  </span>
                </li>
              );
            })}
        </ul>
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

      {dayExceptions.length > 0 && (
        <div>
          <h3 className="stack-subhead">
            Exceptions — {marDayHeading(dateIso, today)}
          </h3>
          <ul className="record-list">
            {dayExceptions.map(({ view, exception }) => (
              <li key={exception.id} className="record-row">
                <div className="mar-row-body">
                  <strong>
                    {view.medicationName} {view.strength}
                  </strong>
                  <span className="muted">
                    {" "}
                    · {EXCEPTION_LABEL[exception.kind]}
                  </span>
                  <p className="muted mar-status">
                    {exception.pillsAffected} pill
                    {exception.pillsAffected === 1 ? "" : "s"} ·{" "}
                    {exception.reason} · {formatCentralTime(exception.createdAt)}{" "}
                    Central
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
