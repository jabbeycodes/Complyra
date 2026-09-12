import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge, DueChip } from "../components";
import { todayIso } from "../data/chart";
import {
  asMonthlyCollections,
  availableMonths,
  canCompleteMonthly,
  dayOrdinal,
  drillComplete,
  DRILL_LABELS,
  equipmentViewForPerson,
  monthDueOn,
  monthKeyFrom,
  monthLabel,
  SAFETY_LINE_DEFS,
  safetyComplete,
  siteDrillsView,
  siteSafetyView,
  type EmergencyDrill,
  type MonthlyTone,
  type SafetyLine,
} from "../data/monthlyChecks";
import { openPrintable } from "../data/openFile";
import { useData } from "../data/DataProvider";

function badgeFor(tone: MonthlyTone) {
  if (tone === "current") return "Compliant";
  if (tone === "due_soon") return "Due soon";
  return "Overdue";
}

export default function SiteMonthlyChecks({
  siteId,
}: {
  siteId: string;
}) {
  const { api, session, workspace, refresh } = useData();
  const today = todayIso();
  const [monthKey, setMonthKey] = useState(monthKeyFrom(today));
  const [error, setError] = useState("");
  if (!session || !workspace) return null;

  const site = workspace.sites.find((row) => row.id === siteId);
  const drillDay = workspace.monthlyDue.drillDay;
  const safetyDay = workspace.monthlyDue.safetyDay;
  const collections = asMonthlyCollections(workspace.monthly);
  const drills = siteDrillsView(collections, siteId, monthKey);
  const safety = siteSafetyView(collections, siteId, monthKey);
  const months = availableMonths(collections, siteId);
  const monthOptions = months.includes(monthKey) ? months : [monthKey, ...months];
  const drillsDone = drills.length > 0 && drills.every(drillComplete);
  const safetyDone = Boolean(safety && safetyComplete(safety));
  const drillTone: MonthlyTone = drills.length
    ? drillsDone
      ? "current"
      : today <= monthDueOn(monthKey, drillDay)
        ? "due_soon"
        : "overdue"
    : "current";
  const safetyTone: MonthlyTone = safety
    ? safetyDone
      ? "current"
      : today <= monthDueOn(monthKey, safetyDay)
        ? "due_soon"
        : "overdue"
    : "current";
  const people = workspace.individuals.filter((row) => row.site === site?.name);
  const canCheck = canCompleteMonthly(session.roleKey);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!site) return null;

  return (
    <section className="panel site-monthly" aria-labelledby="site-monthly-heading">
      <div className="panel-heading">
        <div>
          <h2 id="site-monthly-heading">Monthly home checks · {site.name}</h2>
          <p>
            Emergency drills are due by the {dayOrdinal(drillDay)}. The home
            safety report is due by the {dayOrdinal(safetyDay)}. A DPM sets
            those days in Settings. They reset when the month ends. Finished
            months stay downloadable.
          </p>
        </div>
        <label>
          Month
          <select
            aria-label="Home checks month"
            value={monthKey}
            onChange={(e) => setMonthKey(e.target.value)}
          >
            {monthOptions.map((key) => (
              <option key={key} value={key}>
                {monthLabel(key)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="monthly-site-grid">
        <div>
          <div className="monthly-toolbar">
            <h3>Emergency drills</h3>
            <DueChip date={monthDueOn(monthKey, drillDay)} status={badgeFor(drillTone)} />
            <Badge status={badgeFor(drillTone)} />
            <button
              className="button"
              disabled={!drillsDone}
              onClick={() =>
                run(async () => {
                  const file = await api.downloadMonthlyCheck({
                    kind: "drills",
                    id: siteId,
                    monthKey,
                  });
                  await openPrintable(file.name, file.blob, "download");
                })
              }
            >
              <Download size={16} /> Download drills
            </button>
          </div>
          {drills.map((drill) => (
            <DrillCard
              key={drill.id}
              drill={drill}
              canCheck={canCheck}
              onSave={(next) => run(() => api.recordEmergencyDrill({ id: drill.id, ...next }))}
            />
          ))}
        </div>
        <div>
          <div className="monthly-toolbar">
            <h3>Home safety report</h3>
            <DueChip date={monthDueOn(monthKey, safetyDay)} status={badgeFor(safetyTone)} />
            <Badge status={badgeFor(safetyTone)} />
            <button
              className="button"
              disabled={!safetyDone}
              onClick={() =>
                run(async () => {
                  const file = await api.downloadMonthlyCheck({
                    kind: "safety",
                    id: siteId,
                    monthKey,
                  });
                  await openPrintable(file.name, file.blob, "download");
                })
              }
            >
              <Download size={16} /> Download safety
            </button>
          </div>
          {safety && (
            <SafetyForm
              lines={safety.lines}
              canCheck={canCheck}
              defaultName={session.fullName}
              onSave={(lines) => run(() => api.recordHomeSafety({ id: safety.id, lines }))}
            />
          )}
        </div>
      </div>

      {people.some((person) =>
        workspace.monthly.equipment.some((item) => item.individualId === person.id && item.active),
      ) && (
        <div className="monthly-people-summary">
          <h3>Adaptive equipment this month</h3>
          <ul>
            {people.map((person) => {
              const view = equipmentViewForPerson(
                collections,
                person.id,
                monthKey,
                today,
                workspace.monthlyDue.equipmentDay,
              );
              if (!view.items.length) return null;
              return (
                <li key={person.id}>
                  {person.name}: {view.items.filter((item) => item.complete).length}/
                  {view.items.length} checked
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function DrillCard({
  drill,
  canCheck,
  onSave,
}: {
  drill: EmergencyDrill;
  canCheck: boolean;
  onSave: (input: {
    date: string;
    time: string;
    evacTime?: string;
    leaderName: string;
    participants: string;
    awakeOrSleep?: "awake" | "sleep" | "";
  }) => void;
}) {
  const [date, setDate] = useState(drill.date ?? "");
  const [time, setTime] = useState(drill.time ?? "");
  const [evacTime, setEvacTime] = useState(drill.evacTime ?? "");
  const [leaderName, setLeaderName] = useState(drill.leaderName ?? "");
  const [participants, setParticipants] = useState(drill.participants);
  const [awakeOrSleep, setAwakeOrSleep] = useState(drill.awakeOrSleep);
  const needsSleep = drill.drillType === "fire" || drill.drillType === "missing_person";
  return (
    <article className="obligation-card monthly-card">
      <header>
        <h3>{DRILL_LABELS[drill.drillType]} drill</h3>
        <Badge status={drillComplete(drill) ? "Compliant" : "Due soon"} />
      </header>
      {canCheck ? (
        <form
          className="monthly-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ date, time, evacTime, leaderName, participants, awakeOrSleep });
          }}
        >
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            Evac time
            <input
              value={evacTime}
              onChange={(e) => setEvacTime(e.target.value)}
              placeholder="2:05"
            />
          </label>
          <label>
            Drill leader
            <input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} />
          </label>
          <label className="monthly-span">
            Participants
            <input
              value={participants}
              onChange={(e) => setParticipants(e.target.value)}
            />
          </label>
          {needsSleep && (
            <label>
              Awake / sleep
              <select
                value={awakeOrSleep}
                onChange={(e) => setAwakeOrSleep(e.target.value as "awake" | "sleep" | "")}
              >
                <option value="">Select</option>
                <option value="awake">Awake</option>
                <option value="sleep">Sleep</option>
              </select>
            </label>
          )}
          <button className="button primary" type="submit">
            Save drill
          </button>
        </form>
      ) : (
        <p>
          {drill.date
            ? `${drill.date} ${drill.time} · ${drill.leaderName}`
            : "Not recorded this month."}
        </p>
      )}
    </article>
  );
}

function SafetyForm({
  lines,
  canCheck,
  defaultName,
  onSave,
}: {
  lines: SafetyLine[];
  canCheck: boolean;
  defaultName: string;
  onSave: (lines: SafetyLine[]) => void;
}) {
  const [draft, setDraft] = useState(lines);
  const today = todayIso();
  const grouped = useMemo(() => SAFETY_LINE_DEFS, []);

  function patch(key: SafetyLine["key"], next: Partial<SafetyLine>) {
    setDraft((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...next } : row)),
    );
  }

  return (
    <form
      className="safety-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      {grouped.map((def) => {
        const row = draft.find((item) => item.key === def.key)!;
        return (
          <fieldset key={def.key} className="safety-line">
            <legend>{def.title}</legend>
            <label>
              Date checked
              <input
                type="date"
                value={row.dateChecked ?? ""}
                disabled={!canCheck}
                onChange={(e) =>
                  patch(def.key, {
                    dateChecked: e.target.value,
                    checkedBy: row.checkedBy || defaultName,
                    signature: row.signature || defaultName,
                  })
                }
              />
            </label>
            {def.fields.includes("location") && (
              <label>
                Location
                <input
                  value={row.location}
                  disabled={!canCheck}
                  onChange={(e) => patch(def.key, { location: e.target.value })}
                />
              </label>
            )}
            {def.fields.includes("temp") && (
              <label>
                Temp
                <input
                  value={row.temp}
                  disabled={!canCheck}
                  onChange={(e) => patch(def.key, { temp: e.target.value })}
                />
              </label>
            )}
            {def.fields.includes("extra") && (
              <label>
                {def.extraLabel}
                <input
                  value={row.extra}
                  disabled={!canCheck}
                  onChange={(e) => patch(def.key, { extra: e.target.value })}
                />
              </label>
            )}
            <label>
              Checked by
              <input
                value={row.checkedBy ?? ""}
                disabled={!canCheck}
                onChange={(e) =>
                  patch(def.key, {
                    checkedBy: e.target.value,
                    signature: e.target.value,
                  })
                }
              />
            </label>
            {canCheck && !row.dateChecked && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  patch(def.key, {
                    dateChecked: today,
                    checkedBy: defaultName,
                    signature: defaultName,
                  })
                }
              >
                Mark checked
              </button>
            )}
          </fieldset>
        );
      })}
      {canCheck && (
        <button className="button primary" type="submit">
          Save safety report
        </button>
      )}
    </form>
  );
}
