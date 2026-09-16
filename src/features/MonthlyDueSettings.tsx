import { useState } from "react";
import { canConfigureMonthlyDue, dayOrdinal, MONTHLY_DUE_DAY_MAX, MONTHLY_DUE_DAY_MIN } from "../data/monthlyChecks";
import { useData } from "../data/DataProvider";

export default function MonthlyDueSettings({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const due = workspace?.monthlyDue;
  const [equipmentDay, setEquipmentDay] = useState(due?.equipmentDay ?? 7);
  const [drillDay, setDrillDay] = useState(due?.drillDay ?? 7);
  const [safetyDay, setSafetyDay] = useState(due?.safetyDay ?? 7);
  const [error, setError] = useState("");
  if (!session || !due) return null;

  const canEdit = canConfigureMonthlyDue(session.roleKey);

  return (
    <div className="settings-row monthly-due-settings">
      <span>
        <strong>Monthly check due dates</strong>
        <small>
          Equipment, emergency drills, and the home safety report are due by
          this day each month. A PM sets this when the agency is stood up.
          Default is the 7th.
        </small>
      </span>
      {canEdit ? (
        <form
          className="monthly-due-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api.updateMonthlyDueSettings({
                equipmentDay,
                drillDay,
                safetyDay,
              });
              await refresh();
              onSaved("Monthly due dates saved for this agency.");
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            Equipment
            <input
              type="number"
              min={MONTHLY_DUE_DAY_MIN}
              max={MONTHLY_DUE_DAY_MAX}
              aria-label="Adaptive equipment due day"
              value={equipmentDay}
              onChange={(e) => setEquipmentDay(Number(e.target.value))}
            />
          </label>
          <label>
            Drills
            <input
              type="number"
              min={MONTHLY_DUE_DAY_MIN}
              max={MONTHLY_DUE_DAY_MAX}
              aria-label="Emergency drills due day"
              value={drillDay}
              onChange={(e) => setDrillDay(Number(e.target.value))}
            />
          </label>
          <label>
            Safety
            <input
              type="number"
              min={MONTHLY_DUE_DAY_MIN}
              max={MONTHLY_DUE_DAY_MAX}
              aria-label="Home safety report due day"
              value={safetyDay}
              onChange={(e) => setSafetyDay(Number(e.target.value))}
            />
          </label>
          <button className="button" type="submit">
            Save due dates
          </button>
          {error && <p className="form-error">{error}</p>}
        </form>
      ) : (
        <span className="monthly-due-readonly">
          Equipment {dayOrdinal(due.equipmentDay)} · drills {dayOrdinal(due.drillDay)} ·
          safety {dayOrdinal(due.safetyDay)}
        </span>
      )}
    </div>
  );
}
