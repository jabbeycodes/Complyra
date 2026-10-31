import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pill } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type {
  DoseExceptionKind,
  MedDoseMark,
  MedDoseMarkStatus,
  MedInventoryView,
  PrnDoseLog,
  SessionUser,
} from "../../data/types";
import {
  canLogDoseException,
  canLogPrnDose,
  canRecordDelivery,
} from "../../data/chart";
import { hhmmToMinutes } from "../../data/dueItems";
import { MED_ADMIN_CLEARANCE_MESSAGE } from "../../data/medClearance";
import { useMedAdminLock } from "../medAdminLock";
import { formatPillCount, medCountdown, type MedCountdown } from "./medcount";
import MobilePeopleList, { PersonAvatar } from "./MobilePeopleList";
import type { WorkspaceIndividual } from "./types";
import {
  centralNowHhmm,
  centralTodayIso,
  doseStatusText,
  formatCentralTime,
  formatDoseTime,
  frequencyText,
  groupPasses,
  marDayHeading,
  passSummaryText,
  shiftIsoDate,
  type MarPassMed,
} from "./mar";

type MarTab = "scheduled" | "prn" | "other";
type RecordChoice = MedDoseMarkStatus | DoseExceptionKind;

const RECORD_GROUPS: {
  legend: string;
  choices: { value: RecordChoice; label: string }[];
}[] = [
  {
    legend: "Dose marks",
    choices: [
      { value: "given", label: "Given" },
      { value: "missed", label: "Missed" },
      { value: "loa", label: "LOA" },
      { value: "on_hold", label: "On hold" },
    ],
  },
  {
    legend: "Exceptions",
    choices: [
      { value: "refused", label: "Refused" },
      { value: "held", label: "Held" },
      { value: "wasted", label: "Wasted" },
    ],
  },
];

const MARK_CHOICES: MedDoseMarkStatus[] = ["given", "missed", "loa", "on_hold"];

/** Person header with the one-tap Contacts · Allergies · Diagnoses panel. */
export function PersonHeader({
  person,
  onOpenChart,
}: {
  person: WorkspaceIndividual;
  onOpenChart: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const profile = person.profile;
  const allergies = (profile?.allergies ?? []).filter(
    (allergy) => allergy.status === "active",
  );
  return (
    <section className="msh-person-card">
      <div className="msh-person-main">
        <PersonAvatar person={person} size={52} />
        <div className="msh-person-id">
          <strong>{person.name}</strong>
          <small>{person.site}</small>
        </div>
        <button
          type="button"
          className="msh-chip-button"
          onClick={() => onOpenChart(person.name)}
        >
          Open chart
        </button>
      </div>
      <button
        type="button"
        className="msh-facts-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Contacts · Allergies · Diagnoses {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="msh-facts">
          <div>
            <h4>Allergies</h4>
            {allergies.length === 0 && <p>No active allergies on file.</p>}
            {allergies.map((allergy) => (
              <p key={allergy.allergen}>
                <strong>{allergy.allergen}</strong>
                {allergy.reaction ? ` — ${allergy.reaction}` : ""}
              </p>
            ))}
          </div>
          <div>
            <h4>Diagnoses</h4>
            <p>{profile?.diagnosis?.trim() || "No diagnosis on file."}</p>
          </div>
          <div>
            <h4>Contacts</h4>
            {(profile?.guardians ?? []).length === 0 &&
              (profile?.providerContacts ?? []).length === 0 && (
                <p>No contacts on file.</p>
              )}
            {(profile?.guardians ?? []).map((guardian) => (
              <p key={`g-${guardian.name}`}>
                <strong>{guardian.name}</strong>
                {guardian.relationship ? ` · ${guardian.relationship}` : ""}
                {guardian.phone ? ` · ${guardian.phone}` : ""}
              </p>
            ))}
            {(profile?.providerContacts ?? []).map((contact) => (
              <p key={`p-${contact.id}`}>
                <strong>{contact.name}</strong>
                {contact.role ? ` · ${contact.role}` : ""}
                {contact.phone ? ` · ${contact.phone}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function AdministerForm({
  api,
  session,
  person,
  med,
  doseTime,
  doseDate,
  onDone,
  onCancel,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  med: MedInventoryView;
  doseTime: string;
  doseDate: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [recordType, setRecordType] = useState<RecordChoice>("given");
  const [confirmTime, setConfirmTime] = useState(false);
  const [pills, setPills] = useState(1);
  const [reason, setReason] = useState("");
  const [lateReason, setLateReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  // Keep the "administered at" reading fresh while the form is open.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const isException = !MARK_CHOICES.includes(recordType as MedDoseMarkStatus);
  const nowLabel = `${formatDoseTime(centralNowHhmm())} Central · ${marDayHeading(centralTodayIso(), centralTodayIso())}`;
  // A mark recorded after the dose window ends is stamped Late and must
  // carry a brief reason; the API is the final judge on the window, this
  // prompt (past day, or an hour past today's dose time) mirrors it.
  const todayCentral = centralTodayIso();
  const needsLateReason =
    !isException &&
    (doseDate < todayCentral ||
      (doseDate === todayCentral &&
        hhmmToMinutes(centralNowHhmm()) > hhmmToMinutes(doseTime) + 60));
  const canSubmit =
    confirmTime &&
    !busy &&
    (!isException || (reason.trim().length > 0 && pills >= 1)) &&
    (!needsLateReason || lateReason.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (isException) {
        await api.addMedDoseException({
          medicationId: med.medicationId,
          kind: recordType as DoseExceptionKind,
          pillsAffected: pills,
          reason: reason.trim(),
          occurredOn: doseDate,
        });
      } else {
        // The MAR API stamps the administration time itself (server time,
        // judged in Central) and enforces the agency's med-pass windows, so
        // the time staff confirm here is the current Central time — the form
        // confirms it rather than letting it be back-dated.
        await api.markMedDose({
          medicationId: med.medicationId,
          doseDate,
          doseTime,
          status: recordType as MedDoseMarkStatus,
          lateReason:
            needsLateReason && lateReason.trim()
              ? lateReason.trim()
              : undefined,
        });
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="msh-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) void submit();
      }}
    >
      <h3 className="msh-form-title">
        {med.medicationName} {med.strength}
      </h3>
      <p className="msh-form-sub">
        For {person.name} · {frequencyText(med.doseTimes)}
      </p>

      <dl className="msh-dl">
        <div>
          <dt>Scheduled time</dt>
          <dd>
            {formatDoseTime(doseTime)} Central · {marDayHeading(doseDate, centralTodayIso())}
          </dd>
        </div>
        <div>
          <dt>Administered at</dt>
          <dd>{nowLabel}</dd>
        </div>
        <div>
          <dt>Administered by</dt>
          <dd>{session.fullName}</dd>
        </div>
      </dl>

      <label className="msh-field">
        <span>Record type</span>
        <select
          value={recordType}
          onChange={(event) =>
            setRecordType(event.target.value as RecordChoice)
          }
        >
          {RECORD_GROUPS.map((group) => (
            <optgroup key={group.legend} label={group.legend}>
              {group.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {isException && (
        <>
          <label className="msh-field">
            <span>Pills affected</span>
            <input
              type="number"
              min={1}
              step={1}
              value={pills}
              onChange={(event) => setPills(Number(event.target.value))}
            />
          </label>
          <label className="msh-field">
            <span>Reason (required)</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="What happened with this dose?"
            />
          </label>
        </>
      )}

      {needsLateReason && (
        <label className="msh-field">
          <span>Late entry — reason (required)</span>
          <textarea
            value={lateReason}
            onChange={(event) => setLateReason(event.target.value)}
            rows={2}
            placeholder="Why is this dose being recorded late?"
          />
        </label>
      )}

      <label className="msh-confirm">
        <input
          type="checkbox"
          checked={confirmTime}
          onChange={(event) => setConfirmTime(event.target.checked)}
        />
        <span>
          I confirm the administered time above is correct (Central time).
        </span>
      </label>

      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="msh-button primary" disabled={!canSubmit}>
          {busy ? "Saving…" : "Save record"}
        </button>
      </div>
    </form>
  );
}

/**
 * The per-medication supply countdown line. Roles that may record counts
 * (canRecordDelivery) get it as a button — tapping it opens the refill
 * count form; everyone else sees the same text read-only, with no
 * disabled fake button.
 */
function CountdownLine({
  countdown,
  canReset,
  onReset,
}: {
  countdown: MedCountdown;
  canReset: boolean;
  onReset: () => void;
}) {
  if (canReset) {
    return (
      <button
        type="button"
        className="msh-count-button"
        onClick={onReset}
        aria-label={`${countdown.label}. Record a refill count`}
      >
        <span className="msh-count-main">{countdown.label}</span>
        <span className="msh-count-sub">
          {countdown.countedLabel ? `${countdown.countedLabel} · ` : ""}
          Tap to record a refill count
        </span>
      </button>
    );
  }
  return (
    <p className="msh-count-text">
      <span className="msh-count-main">{countdown.label}</span>
      {countdown.countedLabel && (
        <span className="msh-count-sub">{countdown.countedLabel}</span>
      )}
    </p>
  );
}

/**
 * The countdown area's state when the dose records behind the
 * countdowns could not be loaded: no pills-left figure is shown (any
 * number would overstate supply), and Retry re-runs the load.
 */
function CountUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="msh-count-unavailable" role="alert">
      <span className="msh-count-main">
        Count unavailable — dose records couldn&rsquo;t load
      </span>
      <button type="button" className="msh-chip-button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

function RefillCountForm({
  api,
  med,
  countdown,
  onDone,
  onCancel,
}: {
  api: ComplyraApi;
  med: MedInventoryView;
  countdown: MedCountdown;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pillsText, setPillsText] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pills = Number(pillsText);
  // A count that disagrees with the countdown's expected on-hand figure
  // must carry an explanation — the API refuses it otherwise.
  const expected = countdown.hasBaseline ? countdown.pillsLeft : null;
  const differs =
    expected !== null &&
    pillsText.trim() !== "" &&
    Number.isInteger(pills) &&
    pills !== expected;
  const valid =
    pillsText.trim() !== "" &&
    Number.isInteger(pills) &&
    pills >= 0 &&
    !busy &&
    (!differs || varianceReason.trim().length > 0);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // A refill reset IS a delivery/count record: today's counted pills
      // become the new countdown baseline, audited with the recorder.
      await api.recordMedDelivery({
        medicationId: med.medicationId,
        remainingPills: pills,
        pillsPerDay: med.kind === "prn" ? 0 : med.dosesPerDay,
        countedOn: centralTodayIso(),
        varianceReason: differs ? varianceReason.trim() : undefined,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="msh-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void submit();
      }}
    >
      <h3 className="msh-form-title">
        {med.medicationName} {med.strength}
      </h3>
      <p className="msh-form-sub">Refill count · supply restarts from today</p>

      <dl className="msh-dl">
        <div>
          <dt>Countdown now</dt>
          <dd>{countdown.label}</dd>
        </div>
        <div>
          <dt>Last count</dt>
          <dd>{countdown.countedLabel ?? "No count recorded yet"}</dd>
        </div>
      </dl>

      <label className="msh-field">
        <span>Pills now on hand</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={pillsText}
          onChange={(event) => setPillsText(event.target.value)}
          placeholder="Count the bottle"
          autoFocus
        />
      </label>
      {expected !== null && (
        <p className="msh-section-note">
          Expected on hand: {formatPillCount(expected)} pills
        </p>
      )}
      {differs && (
        <label className="msh-field">
          <span>Count variance — why the count differs (required)</span>
          <textarea
            value={varianceReason}
            onChange={(event) => setVarianceReason(event.target.value)}
            rows={2}
            placeholder="What explains the difference?"
          />
        </label>
      )}
      <p className="msh-section-note">
        Saving records this count with your name and today's date (Central)
        and restarts the countdown from it.
      </p>

      {med.deliveries.length > 0 && (
        <div className="msh-form-history">
          <h4>Recent counts</h4>
          {med.deliveries.slice(0, 3).map((delivery) => (
            <p key={delivery.id}>
              {delivery.countedOn} — {delivery.remainingPills} pills counted ·
              recorded by {delivery.recordedBy}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="msh-button primary" disabled={!valid}>
          {busy ? "Saving…" : "Save count"}
        </button>
      </div>
    </form>
  );
}

/**
 * The PRN dose form: a dose is an audit record, not a tap — it requires
 * the reason it was given and stamps the giver + actual Central time.
 */
function PrnDoseForm({
  api,
  med,
  onDone,
  onCancel,
}: {
  api: ComplyraApi;
  med: MedInventoryView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = reason.trim().length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.logPrnDose(med.medicationId, {
        pills: 1,
        reason: reason.trim(),
        followUp: followUp.trim() ? followUp.trim() : undefined,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="msh-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) void submit();
      }}
    >
      <h3 className="msh-form-title">
        {med.medicationName} {med.strength}
      </h3>
      <p className="msh-form-sub">PRN dose · recorded with your name and the time now (Central)</p>
      <label className="msh-field">
        <span>Why it was given (required)</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          placeholder="What was happening that called for this dose?"
          autoFocus
        />
      </label>
      <label className="msh-field">
        <span>Follow-up note (optional)</span>
        <textarea
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          rows={2}
          placeholder="Anything to check or watch for after?"
        />
      </label>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onCancel}>
          Back
        </button>
        <button type="submit" className="msh-button primary" disabled={!valid}>
          {busy ? "Saving…" : "Log dose"}
        </button>
      </div>
    </form>
  );
}

export default function MobileMar({
  api,
  session,
  people,
  onOpenChart,
}: {
  api: ComplyraApi;
  session: SessionUser;
  people: WorkspaceIndividual[];
  onOpenChart: (name: string) => void;
}) {
  const todayIso = centralTodayIso();
  const [personId, setPersonId] = useState<string | null>(null);
  const [dateIso, setDateIso] = useState(todayIso);
  const [tab, setTab] = useState<MarTab>("scheduled");
  const [passTime, setPassTime] = useState<string | null>(null);
  const [administer, setAdminister] = useState<MarPassMed | null>(null);
  const [refillMed, setRefillMed] = useState<MedInventoryView | null>(null);
  const [prnMed, setPrnMed] = useState<MedInventoryView | null>(null);
  const [prnLogs, setPrnLogs] = useState<PrnDoseLog[]>([]);
  const [inventory, setInventory] = useState<MedInventoryView[]>([]);
  const [marks, setMarks] = useState<MedDoseMark[]>([]);
  const [marksRange, setMarksRange] = useState<MedDoseMark[]>([]);
  // True when the dose-range read behind the countdowns failed: the
  // countdowns must not render figures computed without the dose
  // records (they would overstate supply), so they show an explicit
  // unavailable state with a retry instead.
  const [countsUnavailable, setCountsUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const person = people.find((row) => row.id === personId) ?? null;
  // Clearance gate: an uncleared DSP keeps the MAR view but cannot open
  // the dose/exception forms or the PRN log (the APIs refuse them too).
  const medLocked = useMedAdminLock(api, session);
  const canMark = canLogDoseException(session.roleKey) && !medLocked;
  const canPrn = canLogPrnDose(session.roleKey) && !medLocked;
  const canReset = canRecordDelivery(session.roleKey);

  const reload = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError("");
    try {
      const [nextInventory, nextMarks] = await Promise.all([
        api.getMedInventory(personId),
        api.getMedDoseMarks(personId, dateIso),
      ]);
      setInventory(nextInventory);
      setMarks(nextMarks);
      // The countdown burns down from each med's count baseline, so it
      // needs Given marks from the earliest baseline through Central
      // today — one range read, not a call per day.
      const baselines = nextInventory
        .map((view) => (view.lastCountedOn ?? view.deliveredOn ?? todayIso).slice(0, 10))
        .sort();
      const earliest = baselines[0] ?? todayIso;
      try {
        setMarksRange(
          await api.getMedDoseMarksInRange(personId, earliest, todayIso),
        );
        setCountsUnavailable(false);
      } catch {
        // Never substitute an empty range and render a countdown as if
        // no doses had been given — that overstates supply. The
        // countdown area shows its unavailable state until a retry
        // loads the real dose records.
        setCountsUnavailable(true);
      }
      // Per-dose PRN audit records (reason, giver, actual time) for the
      // history under each PRN med; a failed read just hides the history.
      try {
        setPrnLogs(await api.listPrnDoses(personId));
      } catch {
        setPrnLogs([]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, personId, dateIso, todayIso]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Countdowns are always "as of Central today", whatever day the MAR is
  // browsing — supply is a now-fact, not a per-day one.
  const countdowns = useMemo(() => {
    const map = new Map<string, MedCountdown>();
    for (const view of inventory) {
      map.set(view.medicationId, medCountdown(view, marksRange, todayIso));
    }
    return map;
  }, [inventory, marksRange, todayIso]);

  const passes = useMemo(
    () => groupPasses(inventory, marks),
    [inventory, marks],
  );
  const activePass = passes.find((pass) => pass.doseTime === passTime) ?? null;
  const prnMeds = inventory.filter((item) => item.kind === "prn");
  const medName = useCallback(
    (medicationId: string) =>
      inventory.find((item) => item.medicationId === medicationId)
        ?.medicationName ?? "Medication",
    [inventory],
  );
  const otherMarks = marks.filter((mark) => mark.status !== "given");
  const otherExceptions = inventory.flatMap((item) =>
    item.doseExceptions
      .filter((exception) => exception.occurredOn === dateIso)
      .map((exception) => ({ item, exception })),
  );

  if (!person) {
    return (
      <div>
        <p className="msh-section-note">
          Pick the person whose medications you are passing. Times are Central.
        </p>
        <MobilePeopleList
          people={people}
          onPick={(row) => {
            setPersonId(row.id);
            setPassTime(null);
            setAdminister(null);
            setRefillMed(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="msh-mar">
      <button
        type="button"
        className="msh-text-button"
        onClick={() => {
          setPersonId(null);
          setPassTime(null);
          setAdminister(null);
          setRefillMed(null);
        }}
      >
        ‹ All Individuals
      </button>
      <PersonHeader person={person} onOpenChart={onOpenChart} />
      <button
        type="button"
        className="msh-row msh-medcount-row"
        onClick={() => onOpenChart(person.name)}
      >
        <span className="msh-row-main">
          <strong>Med count &amp; supply</strong>
          <small>Counts, deliveries and reorder status in the chart</small>
        </span>
        <span className="msh-chevron" aria-hidden="true">
          ›
        </span>
      </button>

      <div className="msh-daynav">
        <button
          type="button"
          className="msh-icon-button"
          aria-label="Previous day"
          onClick={() => {
            setDateIso((value) => shiftIsoDate(value, -1));
            setPassTime(null);
            setAdminister(null);
            setRefillMed(null);
          }}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="msh-daynav-label">
          <strong>{marDayHeading(dateIso, todayIso)}</strong>
          <small>All times Central</small>
        </div>
        <button
          type="button"
          className="msh-icon-button"
          aria-label="Next day"
          onClick={() => {
            setDateIso((value) => shiftIsoDate(value, 1));
            setPassTime(null);
            setAdminister(null);
            setRefillMed(null);
          }}
        >
          <ChevronRight size={22} />
        </button>
        {dateIso !== todayIso && (
          <button
            type="button"
            className="msh-chip-button"
            onClick={() => {
              setDateIso(todayIso);
              setPassTime(null);
              setAdminister(null);
              setRefillMed(null);
            }}
          >
            Today
          </button>
        )}
      </div>

      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="msh-empty">Loading medications…</p>}

      {!administer && !refillMed && !activePass && tab === "scheduled" && !loading && (
        <div className="msh-list">
          {passes.length === 0 && (
            <p className="msh-empty">No scheduled medications this day.</p>
          )}
          {passes.map((pass) => (
            <button
              key={pass.doseTime}
              type="button"
              className="msh-row"
              onClick={() => setPassTime(pass.doseTime)}
            >
              <span className="msh-pass-time">{formatDoseTime(pass.doseTime)}</span>
              <span className="msh-row-main">
                <strong>
                  {pass.meds.map((med) => med.inventory.medicationName).join(", ")}
                </strong>
                <small>{passSummaryText(pass)}</small>
              </span>
              <span className="msh-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      )}

      {!administer && !refillMed && activePass && tab === "scheduled" && (
        <div>
          <button
            type="button"
            className="msh-text-button"
            onClick={() => setPassTime(null)}
          >
            ‹ All passes
          </button>
          <h3 className="msh-pass-title">
            {formatDoseTime(activePass.doseTime)} pass ·{" "}
            {passSummaryText(activePass)}
          </h3>
          <div className="msh-list">
            {activePass.meds.map((med) => {
              const tappable = !med.mark && canMark;
              const countdown = countdowns.get(med.inventory.medicationId);
              return (
                <div
                  key={`${med.inventory.medicationId}-${activePass.doseTime}`}
                  className="msh-row msh-med-row"
                >
                  <button
                    type="button"
                    className="msh-med-main"
                    disabled={!tappable}
                    onClick={() => tappable && setAdminister(med)}
                  >
                    <span className="msh-med-thumb" aria-hidden="true">
                      <Pill size={22} />
                    </span>
                    <span className="msh-row-main">
                      <strong>
                        {med.inventory.medicationName} {med.inventory.strength}
                      </strong>
                      <small>{frequencyText(med.inventory.doseTimes)}</small>
                      <small className="msh-status-text">
                        {doseStatusText(med.mark)}
                      </small>
                    </span>
                    {tappable && (
                      <span className="msh-chevron" aria-hidden="true">
                        ›
                      </span>
                    )}
                  </button>
                  {countsUnavailable ? (
                    <CountUnavailable onRetry={() => void reload()} />
                  ) : (
                    countdown && (
                      <CountdownLine
                        countdown={countdown}
                        canReset={canReset}
                        onReset={() => setRefillMed(med.inventory)}
                      />
                    )
                  )}
                </div>
              );
            })}
          </div>
          {medLocked ? (
            <p className="msh-section-note">
              {MED_ADMIN_CLEARANCE_MESSAGE}.
            </p>
          ) : (
            !canMark && (
              <p className="msh-section-note">
                Your role can view this pass but cannot record doses.
              </p>
            )
          )}
        </div>
      )}

      {administer && activePass && (
        <AdministerForm
          api={api}
          session={session}
          person={person}
          med={administer.inventory}
          doseTime={activePass.doseTime}
          doseDate={dateIso}
          onCancel={() => setAdminister(null)}
          onDone={() => {
            setAdminister(null);
            void reload();
          }}
        />
      )}

      {refillMed && (
        <RefillCountForm
          api={api}
          med={refillMed}
          countdown={
            countdowns.get(refillMed.medicationId) ??
            medCountdown(refillMed, marksRange, todayIso)
          }
          onCancel={() => setRefillMed(null)}
          onDone={() => {
            setRefillMed(null);
            void reload();
          }}
        />
      )}

      {prnMed && (
        <PrnDoseForm
          api={api}
          med={prnMed}
          onCancel={() => setPrnMed(null)}
          onDone={() => {
            setPrnMed(null);
            void reload();
          }}
        />
      )}

      {!administer && !refillMed && !prnMed && tab === "prn" && (
        <div className="msh-list">
          {medLocked && (
            <p className="msh-section-note">
              {MED_ADMIN_CLEARANCE_MESSAGE}.
            </p>
          )}
          {prnMeds.length === 0 && (
            <p className="msh-empty">No PRN medications for {person.name}.</p>
          )}
          {prnMeds.map((item) => (
            <div key={item.medicationId} className="msh-row static msh-med-row">
              <div className="msh-med-line">
                <span className="msh-med-thumb" aria-hidden="true">
                  <Pill size={22} />
                </span>
                <span className="msh-row-main">
                  <strong>
                    {item.medicationName} {item.strength}
                  </strong>
                  <small>As needed (PRN)</small>
                  <small>
                    {item.prnDosesSinceDelivery} dose
                    {item.prnDosesSinceDelivery === 1 ? "" : "s"} logged since
                    the last delivery count
                  </small>
                </span>
              {canPrn && (
                <button
                  type="button"
                  className="msh-chip-button"
                  onClick={() => setPrnMed(item)}
                >
                  Log dose
                </button>
              )}
              </div>
              {countsUnavailable ? (
                <CountUnavailable onRetry={() => void reload()} />
              ) : (
                countdowns.get(item.medicationId) && (
                  <CountdownLine
                    countdown={countdowns.get(item.medicationId)!}
                    canReset={canReset}
                    onReset={() => setRefillMed(item)}
                  />
                )
              )}
              {prnLogs.filter((log) => log.medicationId === item.medicationId)
                .length > 0 && (
                <div className="msh-form-history">
                  <h4>Dose history</h4>
                  {prnLogs
                    .filter((log) => log.medicationId === item.medicationId)
                    .slice(0, 5)
                    .map((log) => (
                      <p key={log.id}>
                        {log.givenOn} · {formatCentralTime(log.givenAt)} —{" "}
                        {formatPillCount(log.pills)} pill
                        {log.pills === 1 ? "" : "s"} ·{" "}
                        {log.reason || "No reason recorded"} · by{" "}
                        {log.givenByName || "staff"}
                        {log.followUp ? ` · Follow-up: ${log.followUp}` : ""}
                      </p>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!administer && !refillMed && tab === "other" && (
        <div className="msh-list">
          {otherMarks.length === 0 && otherExceptions.length === 0 && (
            <p className="msh-empty">
              No missed doses or exceptions recorded this day.
            </p>
          )}
          {otherMarks.map((mark) => (
            <div key={mark.id} className="msh-row static">
              <span className="msh-row-main">
                <strong>
                  {medName(mark.medicationId)} · {formatDoseTime(mark.doseTime)}
                </strong>
                <small>{doseStatusText(mark)}</small>
              </span>
            </div>
          ))}
          {otherExceptions.map(({ item, exception }) => (
            <div key={exception.id} className="msh-row static">
              <span className="msh-row-main">
                <strong>
                  {item.medicationName} ·{" "}
                  {exception.kind === "refused"
                    ? "Refused"
                    : exception.kind === "held"
                      ? "Held"
                      : "Wasted"}
                </strong>
                <small>
                  {exception.pillsAffected} pill
                  {exception.pillsAffected === 1 ? "" : "s"} · {exception.reason}
                  {" · "}
                  {formatCentralTime(exception.createdAt)} Central
                </small>
              </span>
            </div>
          ))}
        </div>
      )}

      <nav className="msh-tabbar" aria-label="Medication views">
        {(
          [
            ["scheduled", "Scheduled"],
            ["prn", "PRN"],
            ["other", "Other"],
          ] as [MarTab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? "active" : ""}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setAdminister(null);
              setRefillMed(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
