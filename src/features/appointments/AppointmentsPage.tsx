import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  APPOINTMENT_TIMEZONES,
  DEFAULT_APPOINTMENT_TIMEZONE,
  WEEKDAY_LABELS,
  canCompleteAppointments,
  canManageAppointments,
  canSeeAppointments,
  caseloadAppointmentsFromWorkspace,
  filterCaseloadAppointments,
  formatAppointmentDate,
  formatAppointmentWhen,
  hasActiveCaseloadFilters,
  monthCells,
  monthLabel,
  monthStart,
  nextStatusChip,
  shiftMonth,
  thirtyDayRange,
  uniqueProgramNames,
  type Appointment,
  type AppointmentDraft,
  type AppointmentStatus,
  type CaseloadAppointment,
} from "../../data/appointments";
import { todayIso } from "../../data/chart";
import {
  AppointmentActions,
  AppointmentStatusPill,
} from "./appointmentUi";
import { generateConsultationPacket } from "./generateConsultationPacket";
import "./appointments.css";

export default function AppointmentsPage({
  onOpenPerson,
}: {
  onOpenPerson: (name: string) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const [error, setError] = useState("");
  const today = todayIso();
  const range = thirtyDayRange(today);
  const [individualQuery, setIndividualQuery] = useState("");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [status, setStatus] = useState<AppointmentStatus | "all">("all");
  const [siteId, setSiteId] = useState("");
  const [programName, setProgramName] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [month, setMonth] = useState(monthStart(today));
  const [selectedDay, setSelectedDay] = useState(today);
  const [addingAppointment, setAddingAppointment] = useState(false);

  const caseload = useMemo(
    () =>
      workspace
        ? caseloadAppointmentsFromWorkspace(
            workspace.planStacks,
            workspace.individuals,
            workspace.sites,
          )
        : [],
    [workspace],
  );
  const filtered = useMemo(
    () =>
      filterCaseloadAppointments(caseload, {
        name: individualQuery || undefined,
        from,
        to,
        status,
        siteId: siteId || undefined,
        programName: programName || undefined,
        createdBy: createdBy || undefined,
      }),
    [caseload, individualQuery, from, to, status, siteId, programName, createdBy],
  );
  const filtersActive = hasActiveCaseloadFilters(
    {
      name: individualQuery,
      from,
      to,
      status,
      siteId,
      programName,
      createdBy,
    },
    range,
  );
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of filtered) {
      map.set(row.startsOn, (map.get(row.startsOn) ?? 0) + 1);
    }
    return map;
  }, [filtered]);

  if (!session || !workspace || !canSeeAppointments(session.roleKey)) return null;

  const dayRows = filtered.filter((row) => row.startsOn === selectedDay);
  const cells = monthCells(month);
  const canComplete = canCompleteAppointments(session.roleKey);
  const canAdd = canManageAppointments(session.roleKey);
  const sites = workspace.sites;
  const programs = uniqueProgramNames(sites);
  const individuals = [...workspace.individuals].sort((a, b) => a.name.localeCompare(b.name));
  function clearFilters() {
    setStatus("all");
    setProgramName("");
    setIndividualQuery("");
    setSiteId("");
    setFrom(range.from);
    setTo(range.to);
    setCreatedBy("");
  }
  const staffOptions = [...new Map(
    caseload
      .filter((row) => row.createdBy && row.createdByName)
      .map((row) => [row.createdBy, row.createdByName] as const),
  )].sort((a, b) => a[1].localeCompare(b[1]));
  const activeSession = session;
  const activeWorkspace = workspace;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function generate(appointment: Appointment, mode: "download" | "print") {
    setError("");
    try {
      const person = activeWorkspace.individuals.find((row) => row.id === appointment.individualId);
      const stack = activeWorkspace.planStacks.find((row) => row.individualId === appointment.individualId);
      const profile = stack?.profile ?? person?.profile;
      if (!person || !profile) throw new Error("Individual not found.");
      await generateConsultationPacket({
        recordGenerated: (id) => api.recordConsultationPacketGenerated(id),
        session: activeSession,
        workspace: activeWorkspace,
        person,
        profile,
        appointment,
        medications: stack?.medications ?? [],
        mode,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="appointments-page">
      <PageHeading
        title="Appointments"
        description="Caseload visits for the next 30 days. Generate a packet before the visit; upload the consultation form to complete it."
      />
      {error && <p className="form-error">{error}</p>}

      <section className="panel appointments-filters" aria-label="Appointment filters">
        <div className="appointments-filter-group">
          <span>Status</span>
          <div className="appointments-status-chips" role="group" aria-label="Filter by status">
            <button
              type="button"
              className="appointments-status-chip"
              aria-pressed={status === "scheduled"}
              onClick={() => setStatus((current) => nextStatusChip(current, "scheduled"))}
            >
              Scheduled
            </button>
            <button
              type="button"
              className="appointments-status-chip"
              aria-pressed={status === "completed"}
              onClick={() => setStatus((current) => nextStatusChip(current, "completed"))}
            >
              Completed
            </button>
          </div>
        </div>
        <label>
          Program
          <select
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            aria-label="Filter by program"
          >
            <option value="">All programs</option>
            {programs.map((program) => (
              <option key={program} value={program}>
                {program}
              </option>
            ))}
          </select>
        </label>
        <label>
          Individual
          <input
            type="search"
            value={individualQuery}
            onChange={(e) => setIndividualQuery(e.target.value)}
            placeholder="All Individuals"
            aria-label="Filter by individual"
            list="appointment-individual-options"
            autoComplete="off"
          />
          <datalist id="appointment-individual-options">
            {individuals.map((person) => (
              <option key={person.id} value={person.name} />
            ))}
          </datalist>
        </label>
        {sites.length > 1 ? (
          <label>
            Site
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              aria-label="Filter by site"
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </label>
        {staffOptions.length > 0 ? (
          <label>
            Staff
            <select
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              aria-label="Filter by staff"
            >
              <option value="">All staff</option>
              {staffOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {filtersActive ? (
          <button className="button appointments-clear-filters" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </section>

      <section className="panel appointments-calendar" aria-label="Appointment calendar">
        <header className="appointments-calendar-nav">
          <button
            className="button"
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <h2>{monthLabel(month)}</h2>
          <button
            className="button"
            type="button"
            aria-label="Next month"
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </header>
        <div className="appointments-weekdays">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="appointments-grid" role="grid" aria-label={monthLabel(month)}>
          {cells.map((cell, index) => {
            if (!cell.date) {
              return <div key={`empty-${index}`} className="appointments-cell empty" />;
            }
            const count = counts.get(cell.date) ?? 0;
            const inWindow = cell.date >= from && cell.date <= to;
            const selected = cell.date === selectedDay;
            const isToday = cell.date === today;
            return (
              <button
                key={cell.date}
                type="button"
                role="gridcell"
                className={`appointments-cell${selected ? " selected" : ""}${inWindow ? "" : " muted"}${isToday ? " today" : ""}`}
                aria-label={`${formatAppointmentDate(cell.date)}, ${count} appointment${count === 1 ? "" : "s"}`}
                aria-pressed={selected}
                onClick={() => {
                  setSelectedDay(cell.date!);
                  setAddingAppointment(false);
                }}
              >
                <span>{Number(cell.date.slice(8))}</span>
                <em>{count}</em>
              </button>
            );
          })}
        </div>
        <p className="stack-help">
          {filtered.length} appointment{filtered.length === 1 ? "" : "s"} in this range.
          Click a day to see that day's visits.
        </p>
      </section>

      <section className="panel" aria-labelledby="appointments-day-heading">
        <h2 id="appointments-day-heading">{formatAppointmentDate(selectedDay)}</h2>
        {canAdd && !addingAppointment && (
          <div className="chart-actions">
            <button
              className="button primary"
              type="button"
              onClick={() => setAddingAppointment(true)}
            >
              <Plus size={16} /> Add appointment
            </button>
          </div>
        )}
        {canAdd && addingAppointment && (
          <AddAppointmentForm
            individuals={individuals}
            defaultDate={selectedDay}
            onCancel={() => setAddingAppointment(false)}
            onSave={async (individualId, draft) => {
              await run(() =>
                api.createAppointment({ individualId, ...draft }).then(() => undefined),
              );
              setAddingAppointment(false);
            }}
          />
        )}
        {dayRows.length === 0 ? (
          <p>
            {filtersActive
              ? "No appointments match these filters."
              : "No caseload appointments on this day."}
          </p>
        ) : (
          dayRows.map((row) => (
            <DayAppointmentCard
              key={row.id}
              row={row}
              canComplete={canComplete}
              onOpenPerson={onOpenPerson}
              onGenerate={(appointment, mode) => generate(appointment, mode)}
              onComplete={(appointment, file, comments) =>
                run(() =>
                  api.completeAppointment({
                    appointmentId: appointment.id,
                    file,
                    comments,
                  }),
                )
              }
              onOpenFile={(fileId) =>
                run(async () => {
                  const file = await api.getChartFile({ type: "consultation", id: fileId });
                  if (!file) throw new Error("That file is not stored yet.");
                  const { openPrintable } = await import("../../data/openFile");
                  await openPrintable(file.name, file.blob, "download");
                })
              }
            />
          ))
        )}
      </section>
    </div>
  );
}

function DayAppointmentCard({
  row,
  canComplete,
  onOpenPerson,
  onGenerate,
  onComplete,
  onOpenFile,
}: {
  row: CaseloadAppointment;
  canComplete: boolean;
  onOpenPerson: (name: string) => void;
  onGenerate: (appointment: Appointment, mode: "download" | "print") => Promise<void>;
  onComplete: (appointment: Appointment, file: File, comments: string) => Promise<void>;
  onOpenFile: (fileId: string) => Promise<void>;
}) {
  return (
    <article className="obligation-card appointment-card">
      <header>
        <AppointmentStatusPill appointment={row} />
        <h3>{row.consultant}</h3>
      </header>
      <p>
        <button className="link-button" type="button" onClick={() => onOpenPerson(row.individualName)}>
          {row.individualName}
        </button>
        {` · ${row.siteName}`}
      </p>
      <p>{formatAppointmentWhen(row)}</p>
      {row.specialty ? <p>{row.specialty}</p> : null}
      {row.reason ? <p>{row.reason}</p> : null}
      <AppointmentActions
        appointment={row}
        canManage={false}
        canComplete={canComplete}
        onGenerate={onGenerate}
        onComplete={onComplete}
        onOpenFile={onOpenFile}
      />
    </article>
  );
}

function AddAppointmentForm({
  individuals,
  defaultDate,
  onCancel,
  onSave,
}: {
  individuals: { id: string; name: string }[];
  defaultDate: string;
  onCancel: () => void;
  onSave: (individualId: string, draft: AppointmentDraft) => Promise<void>;
}) {
  const [individualId, setIndividualId] = useState("");
  const [draft, setDraft] = useState<AppointmentDraft>({
    startsOn: defaultDate,
    startTime: "09:00",
    endTime: "10:00",
    timezone: DEFAULT_APPOINTMENT_TIMEZONE,
    consultant: "",
    specialty: "",
    reason: "",
    visitAddress: "",
  });
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
        if (!individualId) return;
        setBusy(true);
        try {
          await onSave(individualId, draft);
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>New appointment</strong>
      <label>
        Individual
        <select
          value={individualId}
          onChange={(e) => setIndividualId(e.target.value)}
          required
        >
          <option value="">Choose an Individual</option>
          {individuals.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
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
          placeholder="Optional"
        />
      </label>
      <div className="chart-actions">
        <button className="button primary" type="submit" disabled={busy || !individualId}>
          Save appointment
        </button>
        <button className="button" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
