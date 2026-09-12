import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { Badge, DueChip } from "../components";
import { todayIso } from "../data/chart";
import {
  asMonthlyCollections,
  availableMonths,
  canCompleteMonthly,
  canManageEquipment,
  equipmentViewForPerson,
  monthDueOn,
  monthKeyFrom,
  monthLabel,
  type MonthlyTone,
} from "../data/monthlyChecks";
import { openPrintable } from "../data/openFile";
import { useData } from "../data/DataProvider";

function badgeFor(tone: MonthlyTone) {
  if (tone === "current") return "Compliant";
  if (tone === "due_soon") return "Due soon";
  return "Overdue";
}

export default function MonthlyEquipmentCard({
  individualId,
}: {
  individualId: string;
}) {
  const { api, session, workspace, refresh } = useData();
  const today = todayIso();
  const [monthKey, setMonthKey] = useState(monthKeyFrom(today));
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  if (!session || !workspace) return null;

  const person = workspace.individuals.find((row) => row.id === individualId);
  const collections = asMonthlyCollections(workspace.monthly);
  const view = equipmentViewForPerson(collections, individualId, monthKey, today);
  const months = availableMonths(collections).filter((key) =>
    workspace.monthly.equipmentLogs.some((log) =>
      view.items.some((item) => item.id === log.equipmentId && log.monthKey === key),
    ),
  );
  const monthOptions = months.includes(monthKey) ? months : [monthKey, ...months];
  const canAdd = canManageEquipment(session.roleKey);
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

  if (!person) return null;
  if (!view.items.length && !canAdd) return null;

  return (
    <section className="chart-widget" aria-labelledby="equipment-log-heading">
      <h2 id="equipment-log-heading">Adaptive equipment log</h2>
      <p className="stack-help">
        Anyone with equipment on file must be checked in the first 7 days of
        each month. A date with no comment means the item is in good order. The
        log resets on the 1st; finished months stay downloadable.
      </p>
      <div className="monthly-toolbar">
        <label>
          Month
          <select
            aria-label="Equipment log month"
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
        <DueChip date={monthDueOn(monthKey)} status={badgeFor(view.tone)} />
        <Badge status={badgeFor(view.tone)} />
        <button
          className="button"
          disabled={!view.complete}
          onClick={() =>
            run(async () => {
              const file = await api.downloadMonthlyCheck({
                kind: "equipment",
                id: individualId,
                monthKey,
              });
              await openPrintable(file.name, file.blob, "download");
            })
          }
        >
          <Download size={16} /> Download {monthLabel(monthKey)}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {view.items.length === 0 && (
        <p>No adaptive equipment on this chart yet.</p>
      )}
      {view.items.map((item) => (
        <article key={item.id} className="obligation-card monthly-card">
          <header>
            <h3>{item.name}</h3>
            <span className="kind-pill inventory">{item.source === "pcsp" ? "from PCSP" : "added"}</span>
            <Badge status={item.complete ? "Compliant" : badgeFor(view.tone)} />
          </header>
          {canCheck ? (
            <EquipmentCheckForm
              defaultDate={item.log?.checkedOn ?? today}
              defaultInitials={item.log?.initials ?? ""}
              defaultComments={item.log?.comments ?? ""}
              onSave={(checkedOn, initials, comments) =>
                run(() =>
                  api.checkEquipmentLog({
                    equipmentId: item.id,
                    monthKey,
                    checkedOn,
                    initials,
                    comments,
                  }),
                )
              }
            />
          ) : (
            <p>
              {item.log?.checkedOn
                ? `Checked ${item.log.checkedOn} · ${item.log.initials}`
                : "Not checked this month."}
              {item.log?.comments ? ` · ${item.log.comments}` : ""}
            </p>
          )}
          {canAdd && (
            <button
              className="text-button"
              onClick={() => run(() => api.removeAdaptiveEquipment(item.id))}
            >
              Remove from monthly checks
            </button>
          )}
        </article>
      ))}
      {canAdd && (
        <form
          className="monthly-add"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addAdaptiveEquipment(individualId, name);
              setName("");
            });
          }}
        >
          <input
            aria-label="Adaptive equipment name"
            placeholder="Add equipment (wheelchair, lift…)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button" type="submit">
            <Plus size={16} /> Add
          </button>
        </form>
      )}
    </section>
  );
}

function EquipmentCheckForm({
  defaultDate,
  defaultInitials,
  defaultComments,
  onSave,
}: {
  defaultDate: string;
  defaultInitials: string;
  defaultComments: string;
  onSave: (checkedOn: string, initials: string, comments: string) => void;
}) {
  const [checkedOn, setCheckedOn] = useState(defaultDate);
  const [initials, setInitials] = useState(defaultInitials);
  const [comments, setComments] = useState(defaultComments);
  return (
    <form
      className="monthly-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(checkedOn, initials, comments);
      }}
    >
      <label>
        Date
        <input
          type="date"
          value={checkedOn}
          onChange={(e) => setCheckedOn(e.target.value)}
        />
      </label>
      <label>
        Initials
        <input
          value={initials}
          onChange={(e) => setInitials(e.target.value)}
          maxLength={8}
        />
      </label>
      <label className="monthly-span">
        Comments
        <input
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Leave blank if in good order"
        />
      </label>
      <button className="button primary" type="submit">
        Save check
      </button>
    </form>
  );
}
