import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pill } from "lucide-react";
import type { ComplyraApi } from "../../data/localApi";
import type {
  DoseExceptionKind,
  MedDoseMark,
  MedDoseMarkStatus,
  MedInventoryView,
  SessionUser,
} from "../../data/types";
import { canLogDoseException, canLogPrnDose } from "../../data/chart";
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
  const canSubmit =
    confirmTime &&
    !busy &&
    (!isException || (reason.trim().length > 0 && pills >= 1));

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
  const [inventory, setInventory] = useState<MedInventoryView[]>([]);
  const [marks, setMarks] = useState<MedDoseMark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [prnBusy, setPrnBusy] = useState("");

  const person = people.find((row) => row.id === personId) ?? null;
  const canMark = canLogDoseException(session.roleKey);
  const canPrn = canLogPrnDose(session.roleKey);

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, personId, dateIso]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

      {!administer && !activePass && tab === "scheduled" && !loading && (
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

      {!administer && activePass && tab === "scheduled" && (
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
              return (
                <button
                  key={`${med.inventory.medicationId}-${activePass.doseTime}`}
                  type="button"
                  className="msh-row"
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
              );
            })}
          </div>
          {!canMark && (
            <p className="msh-section-note">
              Your role can view this pass but cannot record doses.
            </p>
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

      {!administer && tab === "prn" && (
        <div className="msh-list">
          {prnMeds.length === 0 && (
            <p className="msh-empty">No PRN medications for {person.name}.</p>
          )}
          {prnMeds.map((item) => (
            <div key={item.medicationId} className="msh-row static">
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
                  {item.prnDosesSinceDelivery === 1 ? "" : "s"} logged since the
                  last delivery count · {item.currentCount} on hand
                </small>
              </span>
              {canPrn && (
                <button
                  type="button"
                  className="msh-chip-button"
                  disabled={prnBusy === item.medicationId}
                  onClick={async () => {
                    setPrnBusy(item.medicationId);
                    setError("");
                    try {
                      await api.logPrnDose(item.medicationId);
                      await reload();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setPrnBusy("");
                    }
                  }}
                >
                  {prnBusy === item.medicationId ? "Logging…" : "Log dose"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!administer && tab === "other" && (
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
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
