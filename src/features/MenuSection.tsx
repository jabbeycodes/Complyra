/**
 * Menu records — the food record on an Individual's chart.
 *
 * Staff record any food the Individual ate: the date, the meal slot, what
 * was eaten, and how much (All / Most / Some / None — a text label, never
 * color alone). The section shows one week (Monday–Sunday, America/Chicago)
 * as a day × meal grid; empty slots say "Nothing recorded" in text. The
 * viewed week downloads as a stamped PDF for the paper record.
 *
 * Corrections follow the chart's rule: the author can correct or void their
 * own entry; house managers / PMs / administrators can correct any entry in
 * their scope; a void always needs a reason and keeps the entry on the
 * record. The audit trail is readable here too: each corrected entry has a
 * History expansion with its earlier versions, and the week's voided
 * entries are listed with their reasons and voiders. Auditors read
 * everything here and write nothing.
 */
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Pencil,
  Plus,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { useData } from "../data/DataProvider";
import {
  AMOUNT_EATEN_OPTIONS,
  MEAL_SLOTS,
  amountEatenLabel,
  buildMenuWeekGrid,
  canEditMenuEntryRow,
  centralTodayIso,
  mealSlotLabel,
  menuWeekRangeLabel,
  weekStartMondayIso,
  addDaysIso,
  type AmountEaten,
  type MealSlot,
  type MenuEntryHistory,
  type MenuEntryView,
} from "../data/menuRecords";
import { canEnterMenuEntries } from "../data/permissions";
import { openPrintable } from "../data/openFile";
import { buildMenuWeekPdf, menuWeekFileName } from "../pdf/menuWeekPdf";

interface Draft {
  entryId?: string;
  entryDate: string;
  mealSlot: MealSlot;
  foodText: string;
  amountEaten: AmountEaten;
  note: string;
}

/** "Sep 12, 2026, 1:45 PM" for an ISO timestamp; "" when unparseable. */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Sat, Sep 12" for an ISO calendar day (noon-anchored, timezone-safe). */
function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function MenuSection({
  individualId,
  individualName,
  siteName,
}: {
  individualId: string;
  individualName: string;
  siteName: string;
}) {
  const { api, session, workspace } = useData();
  const today = centralTodayIso();
  const [weekStart, setWeekStart] = useState(() => weekStartMondayIso(today));
  const [entries, setEntries] = useState<MenuEntryView[] | null>(null);
  const [history, setHistory] = useState<MenuEntryHistory | null>(null);
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [voidedOpen, setVoidedOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [voidTarget, setVoidTarget] = useState<MenuEntryView | null>(null);
  const [voidReason, setVoidReason] = useState("");

  async function reload(start: string) {
    try {
      setEntries(await api.getMenuEntries(individualId, start, addDaysIso(start, 6)));
      setHistory(await api.getMenuEntryHistory(individualId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    let live = true;
    setEntries(null);
    setHistory(null);
    setHistoryOpenFor(null);
    api
      .getMenuEntries(individualId, weekStart, addDaysIso(weekStart, 6))
      .then((rows) => live && setEntries(rows))
      .catch((err) => live && setError((err as Error).message));
    api
      .getMenuEntryHistory(individualId)
      .then((rows) => live && setHistory(rows))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, individualId, weekStart]);

  if (!session) return null;
  const canEnter = canEnterMenuEntries(session.roleKey);
  const grid = entries ? buildMenuWeekGrid(entries, weekStart, today) : [];
  const isCurrentWeek = weekStart === weekStartMondayIso(today);
  const weekEnd = addDaysIso(weekStart, 6);
  const versionsByEntry = new Map<string, MenuEntryHistory["versions"]>();
  for (const version of history?.versions ?? []) {
    const list = versionsByEntry.get(version.entryId) ?? [];
    list.push(version);
    versionsByEntry.set(version.entryId, list);
  }
  const voidedThisWeek = (history?.voided ?? []).filter(
    (row) => row.entryDate >= weekStart && row.entryDate <= weekEnd,
  );

  function openNew(date: string, slot: MealSlot) {
    setError("");
    setVoidTarget(null);
    setDraft({
      entryDate: date,
      mealSlot: slot,
      foodText: "",
      amountEaten: "all",
      note: "",
    });
  }

  function openEdit(entry: MenuEntryView) {
    setError("");
    setVoidTarget(null);
    setDraft({
      entryId: entry.id,
      entryDate: entry.entryDate,
      mealSlot: entry.mealSlot,
      foodText: entry.foodText,
      amountEaten: entry.amountEaten,
      note: entry.note,
    });
  }

  async function saveDraft() {
    if (!draft) return;
    setError("");
    setBusy(true);
    try {
      await api.saveMenuEntry({
        entryId: draft.entryId,
        individualId,
        entryDate: draft.entryDate,
        mealSlot: draft.mealSlot,
        foodText: draft.foodText,
        amountEaten: draft.amountEaten,
        note: draft.note,
      });
      setDraft(null);
      // The saved date may sit in another week — follow it there.
      const targetWeek = weekStartMondayIso(draft.entryDate);
      setWeekStart(targetWeek);
      await reload(targetWeek);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setError("");
    setBusy(true);
    try {
      await api.voidMenuEntry(voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason("");
      await reload(weekStart);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadWeek() {
    if (!entries || !session) return;
    setError("");
    try {
      const doc = buildMenuWeekPdf({
        agencyName: session.agencyName,
        individualName,
        siteName,
        weekStart,
        entries,
        generatedByName: session.fullName,
        generatedAt: new Date().toISOString(),
        logoDataUrl: workspace?.branding.logoUrl ?? null,
      });
      await openPrintable(
        menuWeekFileName(individualName, weekStart),
        doc.output("blob") as Blob,
        "download",
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="chart-widget menu-card" aria-labelledby="menu-heading">
      <div className="chart-widget-head">
        <h2 id="menu-heading">
          <UtensilsCrossed size={16} aria-hidden="true" /> Menu
        </h2>
        <div className="menu-head-actions">
          <button
            type="button"
            className="button"
            onClick={() => void downloadWeek()}
            disabled={!entries}
          >
            <Download size={16} /> Download week (PDF)
          </button>
          {canEnter && (
            <button
              type="button"
              className="button"
              onClick={() => openNew(today, "breakfast")}
            >
              <Plus size={16} /> Record food
            </button>
          )}
        </div>
      </div>
      <p className="muted menu-help">
        What {individualName.split(" ")[0]} ate, recorded by the staff
        supporting them. Record a meal or snack as it happens; corrections
        keep the original entry, and a voided entry keeps its reason.
      </p>

      <div className="menu-week-bar">
        <button
          type="button"
          className="button"
          aria-label="Previous week"
          onClick={() => setWeekStart(addDaysIso(weekStart, -7))}
        >
          <ChevronLeft size={16} />
        </button>
        <strong aria-live="polite">{menuWeekRangeLabel(weekStart)}</strong>
        <button
          type="button"
          className="button"
          aria-label="Next week"
          onClick={() => setWeekStart(addDaysIso(weekStart, 7))}
        >
          <ChevronRight size={16} />
        </button>
        {!isCurrentWeek && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setWeekStart(weekStartMondayIso(today))}
          >
            Back to this week
          </button>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <div className="menu-form">
          <div className="menu-form-row">
            <label>
              Date
              <input
                type="date"
                value={draft.entryDate}
                onChange={(e) => setDraft({ ...draft, entryDate: e.target.value })}
              />
            </label>
            <label>
              Meal
              <select
                value={draft.mealSlot}
                onChange={(e) =>
                  setDraft({ ...draft, mealSlot: e.target.value as MealSlot })
                }
              >
                {MEAL_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {mealSlotLabel(slot)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount eaten
              <select
                value={draft.amountEaten}
                onChange={(e) =>
                  setDraft({ ...draft, amountEaten: e.target.value as AmountEaten })
                }
              >
                {AMOUNT_EATEN_OPTIONS.map((amount) => (
                  <option key={amount} value={amount}>
                    {amountEatenLabel(amount)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Food eaten
            <input
              type="text"
              placeholder="e.g. Oatmeal with berries, orange juice"
              value={draft.foodText}
              onChange={(e) => setDraft({ ...draft, foodText: e.target.value })}
            />
          </label>
          <label>
            Note (optional)
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
          <div className="menu-form-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void saveDraft()}
            >
              {draft.entryId ? "Save correction" : "Save entry"}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {voidTarget && (
        <div className="menu-form" role="group" aria-label="Void menu entry">
          <p>
            Void this entry? <strong>{voidTarget.foodText}</strong> (
            {mealSlotLabel(voidTarget.mealSlot)},{" "}
            {amountEatenLabel(voidTarget.amountEaten)}) stays on the record
            with your reason.
          </p>
          <label>
            Reason for voiding
            <input
              type="text"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Recorded against the wrong day"
            />
          </label>
          <div className="menu-form-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void confirmVoid()}
            >
              Void entry
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setVoidTarget(null);
                setVoidReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!entries && <p className="muted">Loading menu records…</p>}

      {entries && (
        <div className="menu-grid" role="table" aria-label="Menu records for the week">
          <div className="menu-grid-row menu-grid-head" role="row">
            <span role="columnheader">Day</span>
            {MEAL_SLOTS.map((slot) => (
              <span key={slot} role="columnheader">
                {mealSlotLabel(slot)}
              </span>
            ))}
          </div>
          {grid.map((day) => (
            <div className="menu-grid-row" role="row" key={day.date}>
              <span className="menu-grid-day" role="rowheader">
                {day.heading}
                {day.isToday ? " · Today" : ""}
              </span>
              {day.cells.map((cell) => (
                <div className="menu-grid-cell" role="cell" key={cell.slot}>
                  <span className="menu-grid-slot-label">{cell.slotLabel}</span>
                  {cell.entries.length === 0 && (
                    <p className="muted menu-empty">Nothing recorded</p>
                  )}
                  {cell.entries.map((entry) => (
                    <div className="menu-entry" key={entry.id}>
                      <p className="menu-entry-food">
                        {entry.foodText}{" "}
                        <span className="menu-entry-amount">
                          ({amountEatenLabel(entry.amountEaten)})
                        </span>
                      </p>
                      {entry.note && <p className="muted">{entry.note}</p>}
                      <p className="muted menu-entry-stamp">
                        Recorded by {entry.recordedByName}
                        {entry.updatedAt !== entry.createdAt ? " · corrected" : ""}
                      </p>
                      {canEnter &&
                        canEditMenuEntryRow(session.roleKey, session.userId, entry) && (
                          <span className="menu-entry-actions">
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => openEdit(entry)}
                            >
                              <Pencil size={14} /> Edit
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => {
                                setError("");
                                setDraft(null);
                                setVoidTarget(entry);
                                setVoidReason("");
                              }}
                            >
                              <XCircle size={14} /> Void
                            </button>
                          </span>
                        )}
                      {(versionsByEntry.get(entry.id) ?? []).length > 0 && (
                        <div className="menu-entry-history-wrap">
                          <button
                            type="button"
                            className="text-button"
                            aria-expanded={historyOpenFor === entry.id}
                            onClick={() =>
                              setHistoryOpenFor(
                                historyOpenFor === entry.id ? null : entry.id,
                              )
                            }
                          >
                            <History size={14} /> History (
                            {(versionsByEntry.get(entry.id) ?? []).length})
                          </button>
                          {historyOpenFor === entry.id &&
                            (versionsByEntry.get(entry.id) ?? []).map(
                              (version) => (
                                <p
                                  className="menu-history-line"
                                  key={version.id}
                                >
                                  Earlier version: {version.foodText} (
                                  {amountEatenLabel(version.amountEaten)})
                                  {version.note ? ` — ${version.note}` : ""} ·
                                  Saved {formatStamp(version.versionSavedAt)} ·
                                  Replaced by {version.replacedByName}
                                </p>
                              ),
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                  {canEnter && (
                    <button
                      type="button"
                      className="text-button menu-add-cell"
                      onClick={() => openNew(day.date, cell.slot)}
                    >
                      <Plus size={14} /> Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {entries && history && voidedThisWeek.length > 0 && (
        <div className="menu-voided">
          <button
            type="button"
            className="text-button"
            aria-expanded={voidedOpen}
            onClick={() => setVoidedOpen(!voidedOpen)}
          >
            <XCircle size={14} /> Voided this week ({voidedThisWeek.length})
          </button>
          {voidedOpen && (
            <ul className="menu-voided-list">
              {voidedThisWeek.map((row) => (
                <li key={row.id}>
                  <strong>{row.foodText}</strong> (
                  {amountEatenLabel(row.amountEaten)}) ·{" "}
                  {mealSlotLabel(row.mealSlot)}, {formatDay(row.entryDate)} ·
                  Voided by {row.voidedByName}: {row.voidReason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
