import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  WEEKDAY_LABELS,
  canCompleteAppointments,
  canSeeAppointments,
  caseloadAppointmentsFromWorkspace,
  filterCaseloadAppointments,
  formatAppointmentDate,
  formatAppointmentWhen,
  monthCells,
  monthLabel,
  monthStart,
  shiftMonth,
  thirtyDayRange,
  type Appointment,
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
  const [name, setName] = useState("");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [status, setStatus] = useState<AppointmentStatus | "all">("all");
  const [siteId, setSiteId] = useState("");
  const [month, setMonth] = useState(monthStart(today));
  const [selectedDay, setSelectedDay] = useState(today);

  const caseload = useMemo(
    () =>
      workspace
        ? caseloadAppointmentsFromWorkspace(workspace.planStacks, workspace.individuals)
        : [],
    [workspace],
  );
  const filtered = useMemo(
    () =>
      filterCaseloadAppointments(caseload, {
        name,
        from,
        to,
        status,
        siteId: siteId || undefined,
      }),
    [caseload, name, from, to, status, siteId],
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
  const sites = workspace.sites;
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
        <label>
          Individual
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Filter by individual name"
          />
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus | "all")}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="completed">Completed</option>
          </select>
        </label>
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
                aria-label={`${formatAppointmentDate(cell.date)}${count ? `, ${count} appointment${count === 1 ? "" : "s"}` : ""}`}
                aria-pressed={selected}
                onClick={() => setSelectedDay(cell.date!)}
              >
                <span>{Number(cell.date.slice(8))}</span>
                {count > 0 && <em>{count}</em>}
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
        {dayRows.length === 0 ? (
          <p>No caseload appointments on this day.</p>
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
