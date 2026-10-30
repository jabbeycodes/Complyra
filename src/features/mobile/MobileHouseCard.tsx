import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Wallet } from "lucide-react";
import { Empty, formatDate } from "../../components";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canCloseHouseCardMonth,
  canRecordHouseCard,
} from "../../data/permissions";
import { centralTodayIso } from "../../data/menuRecords";
import { monthLabel } from "../../data/mileage";
import {
  HOUSE_CARD_CATEGORY_LABELS,
  buildHouseCardLedger,
  categoryNeedsIndividual,
  closeForMonth,
  computeBalanceCents,
  formatCents,
  isLowBalance,
  recentHouseCardLocations,
  signedAmountCents,
  summarizeHouseCardMonth,
  type HouseCardCategory,
  type HouseCardEntryDraft,
  type HouseCardEntryView,
  type HouseCardMonthClose,
} from "../../data/houseCard";
import { parseAmountToCents } from "../houseCard/HouseCardPanel";
import { formatCentralTime, formatIsoDay } from "./mar";
import MoneyEntrySheet, { HOUSE_CATEGORY_ICONS } from "./MoneyEntrySheet";
import {
  blankMoneyValues,
  houseEntryDetail,
  houseEntryTitle,
  houseRepeatValues,
  houseSignedAmount,
  houseTodayRows,
  houseTodayTotals,
  orderCategoriesByUse,
  type MoneySheetValues,
} from "./money";
import "../houseCard/houseCard.css";

export interface MobileHouseCardPerson {
  id: string;
  name: string;
}

type SheetRequest =
  | { mode: "new" | "repeat"; initial: MoneySheetValues }
  | {
      mode: "replace";
      initial: MoneySheetValues;
      target: HouseCardEntryView;
      reason: string;
    };

interface JustRecorded {
  id: string;
  label: string;
  balanceCents: number;
}

const UNDO_REASON = "Undone right after recording";

/**
 * Sheet values → the ledger draft, mirroring the desktop panel's
 * mapping. Exported for the Quick log's house-card flow, which opens
 * the same sheet — one mapping behind both doors.
 */
export function houseSheetToDraft(
  values: MoneySheetValues,
): HouseCardEntryDraft {
  const amountCents = parseAmountToCents(values.amountText);
  if (amountCents === null) {
    throw new Error("Enter the amount like 42.50.");
  }
  const category = values.category
    ? (values.category as HouseCardCategory)
    : null;
  return {
    entryDate: values.entryDate,
    kind: values.kind as HouseCardEntryDraft["kind"],
    location: values.location,
    amountCents,
    category: values.kind === "purchase" ? category : null,
    individualId:
      values.kind === "purchase" && categoryNeedsIndividual(category)
        ? values.individualId || null
        : null,
    note: values.note,
    receiptPhoto: values.receiptPhoto,
  };
}

/**
 * Mobile House Card — the quick-entry redesign of the home's petty
 * cash. The phone opens on TODAY at this house: a pinned balance
 * header, today's entries as a timeline with the running balance on
 * every row, and one big Record button opening the shared entry
 * sheet. Month totals, the full ledger, close-month, and the printed
 * statement live under "This month" — the same flows (and the same
 * print markup) the desktop panel shipped in #150. The desktop panel
 * itself is untouched; this view reads and writes through the same
 * API and ledger rules.
 */
export default function MobileHouseCard({
  api,
  session,
  siteId,
  siteName,
  people,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  siteName: string;
  people: MobileHouseCardPerson[];
}) {
  const today = centralTodayIso();
  const currentMonth = today.slice(0, 7);
  const [entries, setEntries] = useState<HouseCardEntryView[] | null>(null);
  const [closes, setCloses] = useState<HouseCardMonthClose[]>([]);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [saving, setSaving] = useState(false);
  const [justRecorded, setJustRecorded] = useState<JustRecorded | null>(null);
  const [voidTarget, setVoidTarget] = useState<HouseCardEntryView | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [withReplacement, setWithReplacement] = useState(true);
  const [voidError, setVoidError] = useState("");
  const [signature, setSignature] = useState("");
  const [closing, setClosing] = useState(false);

  const canRecord = canRecordHouseCard(session.roleKey);
  const canClose = canCloseHouseCardMonth(session.roleKey);

  const reload = useCallback(async () => {
    setLoadError("");
    try {
      const [nextEntries, nextCloses] = await Promise.all([
        api.listHouseCardEntries(siteId),
        api.listHouseCardMonthCloses(siteId),
      ]);
      setEntries(nextEntries);
      setCloses(nextCloses);
    } catch (err) {
      setEntries(null);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Could not load the house card ledger.",
      );
    }
  }, [api, siteId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const names = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people],
  );
  const ledger = useMemo(
    () => (entries ? buildHouseCardLedger(entries) : []),
    [entries],
  );
  const balance = useMemo(
    () => (entries ? computeBalanceCents(entries) : 0),
    [entries],
  );
  const summary = useMemo(
    () => (entries ? summarizeHouseCardMonth(entries, month, names) : null),
    [entries, month, names],
  );
  const monthRows = useMemo(
    () => ledger.filter((row) => row.entry.entryDate.startsWith(month)),
    [ledger, month],
  );
  const todayRows = useMemo(
    () => houseTodayRows(ledger, today),
    [ledger, today],
  );
  const todayTotals = useMemo(
    () => houseTodayTotals(ledger, today),
    [ledger, today],
  );
  const close = closeForMonth(closes, month);
  const locations = useMemo(
    () => (entries ? recentHouseCardLocations(entries) : []),
    [entries],
  );
  const categories = useMemo(
    () =>
      orderCategoriesByUse(entries ?? []).map((category) => ({
        value: category,
        label: HOUSE_CARD_CATEGORY_LABELS[category],
        icon: HOUSE_CATEGORY_ICONS[category],
      })),
    [entries],
  );
  const postCloseCount = monthRows.filter(
    (row) => row.entry.postCloseCorrection,
  ).length;
  const low = isLowBalance(balance);

  const openNew = () => {
    setSheetError("");
    setSheet({ mode: "new", initial: blankMoneyValues(today, "purchase") });
  };

  const openRepeat = (entry: HouseCardEntryView) => {
    setSheetError("");
    setSheet({ mode: "repeat", initial: houseRepeatValues(entry, today) });
  };

  const saveSheet = async (values: MoneySheetValues) => {
    if (!sheet) return;
    setSheetError("");
    let draft: HouseCardEntryDraft;
    try {
      draft = houseSheetToDraft(values);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Check the entry.");
      return;
    }
    setSaving(true);
    try {
      if (sheet.mode === "replace") {
        await api.voidHouseCardEntry(sheet.target.id, sheet.reason, {
          siteId,
          ...draft,
        });
        setNotice("Entry voided and replaced.");
      } else {
        const created = await api.createHouseCardEntry({ siteId, ...draft });
        setJustRecorded({
          id: created.id,
          label: `${houseEntryDetail(created)} · ${formatCents(created.amountCents)}${created.location ? ` at ${created.location}` : ""}`,
          balanceCents: balance + signedAmountCents(created),
        });
        setNotice("");
      }
      setSheet(null);
      await reload();
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : "Could not record that entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const undoJustRecorded = async () => {
    if (!justRecorded) return;
    setPageError("");
    try {
      await api.voidHouseCardEntry(justRecorded.id, UNDO_REASON, null);
      setJustRecorded(null);
      setNotice(
        "Entry voided. It stays on the record, marked Voided, and no longer counts.",
      );
      await reload();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not undo that entry.",
      );
    }
  };

  const openVoid = (entry: HouseCardEntryView) => {
    setVoidTarget(entry);
    setVoidReason("");
    setWithReplacement(true);
    setVoidError("");
    setNotice("");
    setPageError("");
  };

  const confirmVoid = async () => {
    if (!voidTarget) return;
    if (!voidReason.trim()) {
      setVoidError("Say why this entry is being voided.");
      return;
    }
    setVoidError("");
    if (withReplacement) {
      const initial = {
        ...houseRepeatValues(voidTarget, today),
        entryDate: voidTarget.entryDate,
      };
      setSheetError("");
      setSheet({
        mode: "replace",
        initial,
        target: voidTarget,
        reason: voidReason.trim(),
      });
      setVoidTarget(null);
      return;
    }
    setSaving(true);
    try {
      await api.voidHouseCardEntry(voidTarget.id, voidReason.trim(), null);
      setVoidTarget(null);
      setNotice("Entry voided. It stays on the record and no longer counts.");
      await reload();
    } catch (err) {
      setVoidError(
        err instanceof Error ? err.message : "Could not void that entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitClose = async () => {
    setPageError("");
    setNotice("");
    setClosing(true);
    try {
      await api.closeHouseCardMonth({ siteId, month, signatureText: signature });
      setSignature("");
      setNotice(`${monthLabel(month)} is closed and signed.`);
      await reload();
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Could not close the month.",
      );
    } finally {
      setClosing(false);
    }
  };

  const printStatement = () => {
    document.body.dataset.houseCardPrint = "1";
    const clear = () => {
      delete document.body.dataset.houseCardPrint;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  };

  if (loadError) {
    return (
      <div className="house-card">
        <Empty
          mark="none"
          title="House card unavailable"
          text={`The ledger for ${siteName} could not be loaded. ${loadError}`}
          actions={
            <button
              type="button"
              className="button"
              onClick={() => void reload()}
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  if (!entries || !summary) {
    return (
      <div className="house-card">
        <p className="muted">Loading the house card ledger…</p>
      </div>
    );
  }

  return (
    <div className="house-card mq-house">
      <div className="house-card-screen">
        <div className="mq-pin">
          <div className="mq-pin-top">
            <span className="mq-pin-label">
              <Wallet size={15} aria-hidden="true" /> House card balance
            </span>
            {low && <span className="mq-flag">Low balance</span>}
          </div>
          <strong className="mq-pin-value">{formatCents(balance)}</strong>
          <span className="mq-pin-sub">
            Today: {formatCents(todayTotals.spentCents)} spent ·{" "}
            {formatCents(todayTotals.receivedCents)} received
          </span>
        </div>

        {notice && (
          <p className="mq-notice" role="status">
            {notice}
          </p>
        )}
        {pageError && (
          <p className="msh-alert" role="alert">
            {pageError}
          </p>
        )}

        {justRecorded && (
          <div className="mq-undo" role="status">
            <span className="mq-undo-text">
              Recorded {justRecorded.label}. New balance{" "}
              {formatCents(justRecorded.balanceCents)}.
            </span>
            {canRecord && (
              <button
                type="button"
                className="msh-chip-button"
                onClick={() => void undoJustRecorded()}
              >
                Undo
              </button>
            )}
          </div>
        )}

        {canRecord && (
          <button
            type="button"
            className="msh-button primary block"
            onClick={openNew}
          >
            Record an entry
          </button>
        )}

        <h3 className="msh-pass-title">
          Today at {siteName} · {formatIsoDay(today)}
        </h3>
        <div className="msh-list">
          {todayRows.length === 0 && (
            <p className="msh-empty">Nothing recorded today yet.</p>
          )}
          {todayRows.map(({ entry, runningBalanceCents }) => (
            <div
              key={entry.id}
              className={`msh-row static mq-row${entry.voided ? " mq-voided" : ""}`}
            >
              <span className="msh-row-main">
                <strong>{houseEntryTitle(entry)}</strong>
                <small>{houseEntryDetail(entry)}</small>
                {entry.note && <small>{entry.note}</small>}
                {entry.receiptPhoto && (
                  <img
                    className="hc-receipt-thumb"
                    src={entry.receiptPhoto.dataUrl}
                    alt={`Receipt for ${entry.location || "this entry"}`}
                  />
                )}
                {entry.voided ? (
                  <small className="mq-void-label">
                    Voided — {entry.voidReason} (voided by{" "}
                    {entry.voidedByName ?? "a manager"})
                  </small>
                ) : (
                  <small className="msh-status-text">
                    Recorded by {entry.recordedByName} ·{" "}
                    {formatCentralTime(entry.createdAt)}
                  </small>
                )}
                {entry.postCloseCorrection && (
                  <small>
                    <span className="hc-flag">Post-close correction</span>
                  </small>
                )}
              </span>
              <span className="mq-row-side">
                <strong className="mq-row-amount">
                  {houseSignedAmount(entry)}
                </strong>
                <small>
                  Balance{" "}
                  {entry.voided ? "—" : formatCents(runningBalanceCents)}
                </small>
                {canRecord && !entry.voided && (
                  <button
                    type="button"
                    className="msh-chip-button mq-repeat"
                    onClick={() => openRepeat(entry)}
                  >
                    Repeat
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        <section className="mq-month" aria-label="This month">
          <h3 className="msh-pass-title">This month</h3>
          <label className="msh-field mq-month-picker">
            <span>Month</span>
            <input
              type="month"
              aria-label="House card month"
              value={month}
              max={currentMonth}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>

          {close ? (
            <p className="hc-close-note">
              <strong>{monthLabel(month)} is closed and signed</strong> by{" "}
              {close.printedName} on {formatDate(close.signedAt.slice(0, 10))}.
              Closing balance at sign-off:{" "}
              {formatCents(close.closingBalanceCents)}.
              {postCloseCount > 0 &&
                ` ${postCloseCount} post-close correction${postCloseCount === 1 ? "" : "s"} recorded after sign-off.`}
            </p>
          ) : (
            <p className="hc-close-note">
              {monthLabel(month)} is still open. New entries can be recorded
              for this month until a manager signs it closed.
            </p>
          )}

          <div className="hc-section">
            <h3>{monthLabel(month)} totals</h3>
            <div className="hc-totals-grid">
              <div>
                <h4>By category</h4>
                <ul className="hc-total-list">
                  {summary.categoryTotals.map((row) => (
                    <li key={row.category}>
                      <span>{row.label}</span>
                      <strong>{formatCents(row.totalCents)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>By Individual</h4>
                {summary.individualTotals.length === 0 ? (
                  <p className="muted">
                    No spending was tied to an Individual this month.
                  </p>
                ) : (
                  <ul className="hc-total-list">
                    {summary.individualTotals.map((row) => (
                      <li key={row.individualId}>
                        <span>{row.name}</span>
                        <strong>{formatCents(row.totalCents)}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4>Month balance</h4>
                <ul className="hc-total-list">
                  <li>
                    <span>Opening balance</span>
                    <strong>{formatCents(summary.openingBalanceCents)}</strong>
                  </li>
                  <li>
                    <span>Funds received</span>
                    <strong>{formatCents(summary.totalCreditedCents)}</strong>
                  </li>
                  <li>
                    <span>Refunds</span>
                    <strong>{formatCents(summary.totalRefundedCents)}</strong>
                  </li>
                  <li>
                    <span>Total spent</span>
                    <strong>{formatCents(summary.totalSpentCents)}</strong>
                  </li>
                  <li>
                    <span>Closing balance</span>
                    <strong>{formatCents(summary.closingBalanceCents)}</strong>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="hc-section">
            <div className="hc-section-head">
              <h3>Ledger — {monthLabel(month)}</h3>
              <button type="button" className="button" onClick={printStatement}>
                <Printer size={15} aria-hidden="true" /> Print statement
              </button>
            </div>
            {monthRows.length === 0 ? (
              <Empty
                mark="quiet"
                title="No entries this month"
                text={`Nothing has been recorded on the ${siteName} house card for ${monthLabel(month)} yet.`}
              />
            ) : (
              <div className="hc-table-wrap">
                <table className="hc-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Entry</th>
                      <th>Money in</th>
                      <th>Money out</th>
                      <th>Balance</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.map(({ entry, runningBalanceCents }) => (
                      <tr
                        key={entry.id}
                        className={entry.voided ? "hc-row-voided" : undefined}
                      >
                        <td>{formatDate(entry.entryDate)}</td>
                        <td>
                          <strong>{houseEntryTitle(entry)}</strong>
                          <span className="hc-row-sub">
                            {houseEntryDetail(entry)} · recorded by{" "}
                            {entry.recordedByName}
                          </span>
                          {entry.note && (
                            <span className="hc-row-sub">{entry.note}</span>
                          )}
                          {entry.receiptPhoto && (
                            <img
                              className="hc-receipt-thumb"
                              src={entry.receiptPhoto.dataUrl}
                              alt={`Receipt for ${entry.location || "this entry"}`}
                            />
                          )}
                          {entry.voided && (
                            <span className="hc-row-sub">
                              Void — {entry.voidReason} (voided by{" "}
                              {entry.voidedByName ?? "a manager"})
                            </span>
                          )}
                          {entry.replacesEntryId && (
                            <span className="hc-row-sub">
                              Replacement for a voided entry
                            </span>
                          )}
                          {entry.postCloseCorrection && (
                            <span className="hc-flag">Post-close correction</span>
                          )}
                        </td>
                        <td className="hc-num">
                          {entry.kind !== "purchase"
                            ? formatCents(entry.amountCents)
                            : ""}
                        </td>
                        <td className="hc-num">
                          {entry.kind === "purchase"
                            ? formatCents(entry.amountCents)
                            : ""}
                        </td>
                        <td className="hc-num">
                          {entry.voided
                            ? "—"
                            : formatCents(runningBalanceCents)}
                        </td>
                        <td>
                          {canRecord && !entry.voided && (
                            <>
                              <button
                                type="button"
                                className="hc-link-button"
                                onClick={() => openRepeat(entry)}
                              >
                                Repeat
                              </button>{" "}
                              <button
                                type="button"
                                className="hc-link-button"
                                onClick={() => openVoid(entry)}
                              >
                                Void
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canClose && !close && month <= currentMonth && (
            <div className="hc-section">
              <h3>Close {monthLabel(month)}</h3>
              <p className="stack-help">
                Closing signs the month off as {session.fullName}. After
                closing, new entries cannot be back-dated into this month;
                corrections stay possible and are marked as post-close
                corrections.
              </p>
              <label className="hc-field">
                <span>Typed signature</span>
                <input
                  type="text"
                  value={signature}
                  placeholder={session.fullName}
                  onChange={(e) => setSignature(e.target.value)}
                />
              </label>
              <div className="hc-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={closing}
                  onClick={() => void submitClose()}
                >
                  {closing ? "Closing…" : `Close ${monthLabel(month)}`}
                </button>
              </div>
            </div>
          )}
        </section>

        {sheet && (
          <MoneyEntrySheet
            title={
              sheet.mode === "replace"
                ? "Replacement entry"
                : "Record an entry"
            }
            kinds={[
              { value: "purchase", label: "Purchase" },
              { value: "credit", label: "Funds received" },
              { value: "refund", label: "Refund" },
            ]}
            detailKind="purchase"
            categories={categories}
            locations={locations}
            locationLabelFor={(kind) =>
              kind === "credit" ? "Received from" : "Location"
            }
            locationPlaceholderFor={(kind) =>
              kind === "credit" ? "e.g. Monthly house funds" : "Where was it spent?"
            }
            people={people}
            individualApplies={(values) =>
              values.kind === "purchase" &&
              categoryNeedsIndividual(
                values.category
                  ? (values.category as HouseCardCategory)
                  : null,
              )
            }
            initial={sheet.initial}
            userId={session.userId}
            busy={saving}
            error={sheetError}
            saveText={
              sheet.mode === "replace" ? "Save replacement" : "Record entry"
            }
            onClose={() => setSheet(null)}
            onSave={(values) => void saveSheet(values)}
          />
        )}

        {voidTarget && (
          <>
            <button
              type="button"
              className="msh-sheet-backdrop"
              aria-label="Close void form"
              onClick={() => setVoidTarget(null)}
            />
            <div
              className="msh-sheet mq-sheet"
              role="dialog"
              aria-label="Void entry"
            >
              <h3 className="msh-sheet-title">
                Void entry — {formatDate(voidTarget.entryDate)} ·{" "}
                {houseEntryTitle(voidTarget)} ·{" "}
                {formatCents(voidTarget.amountCents)}
              </h3>
              <p className="msh-section-note">
                Voiding never deletes the entry: it stays on the record with
                your reason and stops counting toward the balance and
                totals.
              </p>
              <label className="msh-field">
                <span>Reason for voiding</span>
                <input
                  type="text"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </label>
              <label className="mq-check">
                <input
                  type="checkbox"
                  checked={withReplacement}
                  onChange={(e) => setWithReplacement(e.target.checked)}
                />
                <span>Record a corrected replacement entry</span>
              </label>
              {voidError && (
                <p className="msh-alert" role="alert">
                  {voidError}
                </p>
              )}
              <div className="msh-form-actions">
                <button
                  type="button"
                  className="msh-button secondary"
                  disabled={saving}
                  onClick={() => setVoidTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="msh-button primary"
                  disabled={saving}
                  onClick={() => void confirmVoid()}
                >
                  {saving ? "Voiding…" : "Void entry"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Printed monthly statement — screen-hidden, print-only (same
          markup and body flag as the desktop panel, #150). */}
      <div className="house-card-printout" aria-hidden="true">
        <h1>
          {siteName} — House Card statement
        </h1>
        <p>
          {session.agencyName} · {monthLabel(month)}
        </p>
        <p>Opening balance: {formatCents(summary.openingBalanceCents)}</p>
        <table className="hc-print-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Money in</th>
              <th>Money out</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.map(({ entry, runningBalanceCents }) => (
              <tr
                key={entry.id}
                className={entry.voided ? "hc-row-voided" : undefined}
              >
                <td>{formatDate(entry.entryDate)}</td>
                <td>
                  {houseEntryTitle(entry)} — {houseEntryDetail(entry)}
                  {entry.note ? ` · ${entry.note}` : ""}
                  {entry.voided ? ` · Void — ${entry.voidReason}` : ""}
                  {entry.postCloseCorrection ? " · Post-close correction" : ""}
                  {` · recorded by ${entry.recordedByName}`}
                </td>
                <td className="hc-num">
                  {entry.kind !== "purchase"
                    ? formatCents(entry.amountCents)
                    : ""}
                </td>
                <td className="hc-num">
                  {entry.kind === "purchase"
                    ? formatCents(entry.amountCents)
                    : ""}
                </td>
                <td className="hc-num">
                  {entry.voided ? "—" : formatCents(runningBalanceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Totals</h2>
        <ul className="hc-print-totals">
          <li>Total deposited: {formatCents(summary.totalDepositedCents)}</li>
          <li>Total spent: {formatCents(summary.totalSpentCents)}</li>
          {summary.categoryTotals.map((row) => (
            <li key={row.category}>
              {row.label}: {formatCents(row.totalCents)}
            </li>
          ))}
          {summary.individualTotals.map((row) => (
            <li key={row.individualId}>
              {row.name}: {formatCents(row.totalCents)}
            </li>
          ))}
          <li>
            Closing balance:{" "}
            {formatCents(
              close ? close.closingBalanceCents : summary.closingBalanceCents,
            )}
          </li>
        </ul>
        <h2>Sign-off</h2>
        {close ? (
          <p>
            Printed name of house manager: {close.printedName}
            <br />
            Signature: {close.signatureText}
            <br />
            Date signed: {formatDate(close.signedAt.slice(0, 10))}
          </p>
        ) : (
          <p>Not yet signed.</p>
        )}
        <p className="hc-print-mark">Digital record generated by Complyrer.</p>
      </div>
    </div>
  );
}
