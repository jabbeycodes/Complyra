import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Wallet } from "lucide-react";
import { Empty, formatDate } from "../../components";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canClosePersonalSpendingMonth,
  canRecordPersonalSpending,
} from "../../data/permissions";
import { centralTodayIso } from "../../data/menuRecords";
import { monthLabel } from "../../data/mileage";
import {
  closeForMonth,
  computePersonalBalanceCents,
  formatCents,
  personalSpendingNeedsAttention,
  recentPersonalSpendingLocations,
  signedAmountCents,
  summarizePersonalSpendingMonth,
  type PersonalSpendingEntryDraft,
  type PersonalSpendingEntryView,
  type PersonalSpendingMonthClose,
  type PersonalSpendingSignoff,
} from "../../data/personalSpending";
import { parseAmountToCents } from "../houseCard/HouseCardPanel";
import MoneyEntrySheet from "./MoneyEntrySheet";
import { PersonHeader } from "./MobileMar";
import {
  blankMoneyValues,
  personalEntryDetail,
  personalEntryTitle,
  personalRecentRows,
  personalRepeatValues,
  personalSignedAmount,
  type MoneySheetValues,
} from "./money";
import type { WorkspaceIndividual } from "./types";
import "../personalSpending/personalSpending.css";

export interface MobileSpendingStaffOption {
  id: string;
  name: string;
}

type SheetRequest =
  | { mode: "new" | "repeat"; initial: MoneySheetValues }
  | {
      mode: "replace";
      initial: MoneySheetValues;
      target: PersonalSpendingEntryView;
      reason: string;
    };

interface JustRecorded {
  id: string;
  label: string;
  balanceCents: number;
}

const UNDO_REASON = "Undone right after recording";

/**
 * Sheet values → the ledger draft, mirroring the chart card's mapping.
 * Exported for the Quick log's personal-spending flow, which opens the
 * same sheet — one mapping behind both doors.
 */
export function personalSheetToDraft(
  values: MoneySheetValues,
): PersonalSpendingEntryDraft {
  const amountCents = parseAmountToCents(values.amountText);
  if (amountCents === null) {
    throw new Error("Enter the amount like 42.50.");
  }
  return {
    entryDate: values.entryDate,
    kind: values.kind as PersonalSpendingEntryDraft["kind"],
    location: values.location,
    purpose: values.kind === "spend" ? values.purpose : "",
    amountCents,
    note: values.note,
    receiptPhoto: values.receiptPhoto,
  };
}

function signoffSummary(
  close: PersonalSpendingMonthClose,
  individualName: string,
): string {
  if (close.individualSignoff === "individual_signed") {
    return `Individual sign-off: ${individualName} signed.`;
  }
  return (
    `Individual sign-off: ${individualName} was unable to sign — ` +
    `${close.secondStaffName ?? "a second staff member"}, a second staff ` +
    `member, signed in their place.`
  );
}

/**
 * Mobile Personal Spending — the quick-entry view of one Individual's
 * own money, reached from their mobile Health screen. A pinned
 * balance header, the recent entries as a timeline with the running
 * balance on every row, and the shared entry sheet (Spent / Funds
 * received — the person is the screen's context and is never
 * re-asked). "This month" holds the month balance, the full ledger,
 * the dual-sign-off close, and the per-Individual printed statement —
 * the same flows the chart card shipped in #152. This ledger is
 * separate from the House Card and its statement prints alone.
 */
export default function MobilePersonalSpending({
  api,
  session,
  person,
  siteName,
  staffOptions,
  onBack,
  onOpenChart,
}: {
  api: ComplyraApi;
  session: SessionUser;
  person: WorkspaceIndividual;
  siteName: string;
  staffOptions: MobileSpendingStaffOption[];
  onBack: () => void;
  onOpenChart: (name: string) => void;
}) {
  const individualId = person.id;
  const individualName = person.name;
  const dmhId = person.profile?.dmhId ?? "";
  const dateOfBirth = person.dateOfBirth ?? "";
  const today = centralTodayIso();
  const currentMonth = today.slice(0, 7);
  const [entries, setEntries] = useState<PersonalSpendingEntryView[] | null>(
    null,
  );
  const [closes, setCloses] = useState<PersonalSpendingMonthClose[]>([]);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");
  const [sheet, setSheet] = useState<SheetRequest | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [saving, setSaving] = useState(false);
  const [justRecorded, setJustRecorded] = useState<JustRecorded | null>(null);
  const [voidTarget, setVoidTarget] =
    useState<PersonalSpendingEntryView | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [withReplacement, setWithReplacement] = useState(true);
  const [voidError, setVoidError] = useState("");
  const [signature, setSignature] = useState("");
  const [signoff, setSignoff] =
    useState<PersonalSpendingSignoff>("individual_signed");
  const [secondStaffId, setSecondStaffId] = useState("");
  const [secondSignature, setSecondSignature] = useState("");
  const [closing, setClosing] = useState(false);

  const canRecord = canRecordPersonalSpending(session.roleKey);
  const canClose = canClosePersonalSpendingMonth(session.roleKey);

  const reload = useCallback(async () => {
    setLoadError("");
    try {
      const [nextEntries, nextCloses] = await Promise.all([
        api.listPersonalSpendingEntries(individualId),
        api.listPersonalSpendingMonthCloses(individualId),
      ]);
      setEntries(nextEntries);
      setCloses(nextCloses);
    } catch (err) {
      setEntries(null);
      setLoadError(
        err instanceof Error
          ? err.message
          : "Could not load the personal spending ledger.",
      );
    }
  }, [api, individualId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const balance = useMemo(
    () => (entries ? computePersonalBalanceCents(entries) : 0),
    [entries],
  );
  const summary = useMemo(
    () => (entries ? summarizePersonalSpendingMonth(entries, month) : null),
    [entries, month],
  );
  const monthRows = useMemo(
    () =>
      (entries ?? []).filter((entry) => entry.entryDate.startsWith(month)),
    [entries, month],
  );
  const recentRows = useMemo(
    () => personalRecentRows(entries ?? []),
    [entries],
  );
  const close = closeForMonth(closes, month);
  const locations = useMemo(
    () => (entries ? recentPersonalSpendingLocations(entries) : []),
    [entries],
  );
  const postCloseCount = monthRows.filter(
    (row) => row.postCloseCorrection,
  ).length;
  const attention = entries
    ? personalSpendingNeedsAttention(entries, closes)
    : false;
  const secondStaffChoices = staffOptions.filter(
    (member) => member.id !== session.userId,
  );

  const openNew = () => {
    setSheetError("");
    setSheet({ mode: "new", initial: blankMoneyValues(today, "spend") });
  };

  const openRepeat = (entry: PersonalSpendingEntryView) => {
    setSheetError("");
    setSheet({ mode: "repeat", initial: personalRepeatValues(entry, today) });
  };

  const saveSheet = async (values: MoneySheetValues) => {
    if (!sheet) return;
    setSheetError("");
    let draft: PersonalSpendingEntryDraft;
    try {
      draft = personalSheetToDraft(values);
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Check the entry.");
      return;
    }
    setSaving(true);
    try {
      if (sheet.mode === "replace") {
        await api.voidPersonalSpendingEntry(sheet.target.id, sheet.reason, {
          individualId,
          ...draft,
        });
        setNotice("Entry voided and replaced.");
      } else {
        const created = await api.createPersonalSpendingEntry({
          individualId,
          ...draft,
        });
        setJustRecorded({
          id: created.id,
          label: `${personalEntryDetail(created)} · ${formatCents(created.amountCents)}${created.location ? ` at ${created.location}` : ""}`,
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
      await api.voidPersonalSpendingEntry(justRecorded.id, UNDO_REASON, null);
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

  const openVoid = (entry: PersonalSpendingEntryView) => {
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
        ...personalRepeatValues(voidTarget, today),
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
      await api.voidPersonalSpendingEntry(
        voidTarget.id,
        voidReason.trim(),
        null,
      );
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
      await api.closePersonalSpendingMonth({
        individualId,
        month,
        signatureText: signature,
        individualSignoff: signoff,
        secondStaffId:
          signoff === "unable_second_staff" ? secondStaffId || null : null,
        secondStaffSignatureText:
          signoff === "unable_second_staff" ? secondSignature : null,
      });
      setSignature("");
      setSecondStaffId("");
      setSecondSignature("");
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
    document.body.dataset.personalSpendingPrint = "1";
    const clear = () => {
      delete document.body.dataset.personalSpendingPrint;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.print();
  };

  return (
    <section className="personal-spending mq-spending">
      <div className="personal-spending-screen">
        <button type="button" className="msh-text-button" onClick={onBack}>
          ‹ Health
        </button>
        <PersonHeader person={person} onOpenChart={onOpenChart} />

        {loadError && (
          <>
            <p className="msh-alert" role="alert">
              The personal spending ledger could not be loaded. {loadError}
            </p>
            <button
              type="button"
              className="msh-button secondary block"
              onClick={() => void reload()}
            >
              Try again
            </button>
          </>
        )}

        {!loadError && !entries && (
          <p className="msh-empty">Loading the personal spending ledger…</p>
        )}

        {!loadError && entries && summary && (
          <>
            <div className="mq-pin">
              <div className="mq-pin-top">
                <span className="mq-pin-label">
                  <Wallet size={15} aria-hidden="true" /> Personal funds
                  balance
                </span>
                {attention && <span className="mq-flag">Needs attention</span>}
              </div>
              <strong className="mq-pin-value">{formatCents(balance)}</strong>
              <span className="mq-pin-sub">
                {individualName}&rsquo;s own money — separate from the
                home&rsquo;s house card.
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

            <h3 className="msh-pass-title">Recent entries</h3>
            <div className="msh-list">
              {recentRows.length === 0 && (
                <p className="msh-empty">
                  Nothing recorded in {individualName}&rsquo;s ledger yet.
                </p>
              )}
              {recentRows.map((entry) => (
                <div
                  key={entry.id}
                  className={`msh-row static mq-row${entry.voided ? " mq-voided" : ""}`}
                >
                  <span className="msh-row-main">
                    <strong>{personalEntryTitle(entry)}</strong>
                    <small>
                      {personalEntryDetail(entry)} ·{" "}
                      {formatDate(entry.entryDate)}
                    </small>
                    {entry.note && <small>{entry.note}</small>}
                    {entry.receiptPhoto && (
                      <img
                        className="ps-receipt-thumb"
                        src={entry.receiptPhoto.dataUrl}
                        alt={`Receipt for ${entry.location || "this entry"}`}
                      />
                    )}
                    {entry.overBalance && !entry.voided && (
                      <small>
                        <span className="ps-flag">Over balance</span>
                      </small>
                    )}
                    {entry.voided ? (
                      <small className="mq-void-label">
                        Voided — {entry.voidReason} (voided by{" "}
                        {entry.voidedByName ?? "a manager"})
                      </small>
                    ) : (
                      <small className="msh-status-text">
                        Recorded by {entry.recordedByName}
                      </small>
                    )}
                    {entry.postCloseCorrection && (
                      <small>
                        <span className="ps-flag">Post-close correction</span>
                      </small>
                    )}
                  </span>
                  <span className="mq-row-side">
                    <strong className="mq-row-amount">
                      {personalSignedAmount(entry)}
                    </strong>
                    <small>
                      Balance{" "}
                      {entry.voided
                        ? "—"
                        : formatCents(entry.runningBalanceCents)}
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
                  aria-label="Personal spending month"
                  value={month}
                  max={currentMonth}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
              </label>

              {attention && (
                <p className="ps-attention" role="status">
                  <span className="ps-flag">Needs attention</span> Spending
                  has taken {individualName}&rsquo;s balance below $0 in a
                  month that is still open. The house manager should review
                  the entries marked &ldquo;Over balance&rdquo; below.
                </p>
              )}

              {close ? (
                <p className="ps-close-note">
                  <strong>{monthLabel(month)} is closed and signed</strong>{" "}
                  by {close.printedName} on{" "}
                  {formatDate(close.signedAt.slice(0, 10))}. Closing balance
                  at sign-off: {formatCents(close.closingBalanceCents)}.{" "}
                  {signoffSummary(close, individualName)}
                  {postCloseCount > 0 &&
                    ` ${postCloseCount} post-close correction${postCloseCount === 1 ? "" : "s"} recorded after sign-off.`}
                </p>
              ) : (
                <p className="ps-close-note">
                  {monthLabel(month)} is still open. New entries can be
                  recorded for this month until a manager signs it closed
                  with the Individual&rsquo;s sign-off.
                </p>
              )}

              <div className="ps-section">
                <h3>{monthLabel(month)} balance</h3>
                <ul className="ps-total-list">
                  <li>
                    <span>Opening balance</span>
                    <strong>{formatCents(summary.openingBalanceCents)}</strong>
                  </li>
                  <li>
                    <span>Funds received</span>
                    <strong>
                      {formatCents(summary.totalDepositedCents)}
                    </strong>
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

              <div className="ps-section">
                <div className="ps-section-head">
                  <h3>Ledger — {monthLabel(month)}</h3>
                  <button
                    type="button"
                    className="button"
                    onClick={printStatement}
                  >
                    <Printer size={15} aria-hidden="true" /> Print statement
                  </button>
                </div>
                {monthRows.length === 0 ? (
                  <Empty
                    mark="quiet"
                    title="No entries this month"
                    text={`Nothing has been recorded in ${individualName}'s personal spending for ${monthLabel(month)} yet.`}
                  />
                ) : (
                  <div className="ps-table-wrap">
                    <table className="ps-table">
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
                        {monthRows.map((entry) => (
                          <tr
                            key={entry.id}
                            className={entry.voided ? "ps-row-voided" : undefined}
                          >
                            <td>{formatDate(entry.entryDate)}</td>
                            <td>
                              <strong>{personalEntryTitle(entry)}</strong>
                              <span className="ps-row-sub">
                                {personalEntryDetail(entry)} · recorded by{" "}
                                {entry.recordedByName}
                              </span>
                              {entry.note && (
                                <span className="ps-row-sub">{entry.note}</span>
                              )}
                              {entry.receiptPhoto && (
                                <img
                                  className="ps-receipt-thumb"
                                  src={entry.receiptPhoto.dataUrl}
                                  alt={`Receipt for ${entry.location || "this entry"}`}
                                />
                              )}
                              {entry.overBalance && !entry.voided && (
                                <span className="ps-flag">Over balance</span>
                              )}
                              {entry.voided && (
                                <span className="ps-row-sub">
                                  Void — {entry.voidReason} (voided by{" "}
                                  {entry.voidedByName ?? "a manager"})
                                </span>
                              )}
                              {entry.replacesEntryId && (
                                <span className="ps-row-sub">
                                  Replacement for a voided entry
                                </span>
                              )}
                              {entry.postCloseCorrection && (
                                <span className="ps-flag">
                                  Post-close correction
                                </span>
                              )}
                            </td>
                            <td className="ps-num">
                              {entry.kind === "deposit"
                                ? formatCents(entry.amountCents)
                                : ""}
                            </td>
                            <td className="ps-num">
                              {entry.kind === "spend"
                                ? formatCents(entry.amountCents)
                                : ""}
                            </td>
                            <td className="ps-num">
                              {entry.voided
                                ? "—"
                                : formatCents(entry.runningBalanceCents)}
                            </td>
                            <td>
                              {canRecord && !entry.voided && (
                                <>
                                  <button
                                    type="button"
                                    className="ps-link-button"
                                    onClick={() => openRepeat(entry)}
                                  >
                                    Repeat
                                  </button>{" "}
                                  <button
                                    type="button"
                                    className="ps-link-button"
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
                <div className="ps-section">
                  <h3>Close {monthLabel(month)}</h3>
                  <p className="stack-help">
                    Closing signs the month off as {session.fullName}, with{" "}
                    {individualName}&rsquo;s sign-off recorded alongside.
                    After closing, new entries cannot be back-dated into
                    this month; corrections stay possible and are marked as
                    post-close corrections.
                  </p>
                  <div className="ps-form-grid">
                    <label className="ps-field">
                      <span>Your typed signature (house manager)</span>
                      <input
                        type="text"
                        value={signature}
                        placeholder={session.fullName}
                        onChange={(e) => setSignature(e.target.value)}
                      />
                    </label>
                    <fieldset className="ps-field ps-signoff-fieldset">
                      <legend>The Individual&rsquo;s sign-off</legend>
                      <label className="ps-check">
                        <input
                          type="radio"
                          name="mq-ps-signoff"
                          checked={signoff === "individual_signed"}
                          onChange={() => setSignoff("individual_signed")}
                        />
                        <span>{individualName} signed the statement</span>
                      </label>
                      <label className="ps-check">
                        <input
                          type="radio"
                          name="mq-ps-signoff"
                          checked={signoff === "unable_second_staff"}
                          onChange={() => setSignoff("unable_second_staff")}
                        />
                        <span>
                          {individualName} was unable to sign — a second
                          staff member signed instead
                        </span>
                      </label>
                    </fieldset>
                    {signoff === "unable_second_staff" && (
                      <>
                        <label className="ps-field">
                          <span>Second staff member</span>
                          <select
                            value={secondStaffId}
                            onChange={(e) => setSecondStaffId(e.target.value)}
                          >
                            <option value="">Choose one…</option>
                            {secondStaffChoices.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="ps-field">
                          <span>
                            Second staff member&rsquo;s typed signature
                          </span>
                          <input
                            type="text"
                            value={secondSignature}
                            onChange={(e) =>
                              setSecondSignature(e.target.value)
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                  <div className="ps-actions">
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
                  { value: "spend", label: "Spent" },
                  { value: "deposit", label: "Funds received" },
                ]}
                detailKind="spend"
                purposeLabel="What was it for?"
                purposePlaceholder="e.g. Clothing — new shoes"
                locations={locations}
                locationLabelFor={(kind) =>
                  kind === "deposit" ? "Received from" : "Where was it spent?"
                }
                locationPlaceholderFor={(kind) =>
                  kind === "deposit"
                    ? "e.g. Family — birthday money"
                    : "e.g. Walmart"
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
                    {personalEntryTitle(voidTarget)} ·{" "}
                    {formatCents(voidTarget.amountCents)}
                  </h3>
                  <p className="msh-section-note">
                    Voiding never deletes the entry: it stays on the record
                    with your reason and stops counting toward the balance
                    and totals.
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
          </>
        )}
      </div>

      {/* Printed monthly statement — screen-hidden, print-only (same
          markup and body flag as the chart card, #152). Prints alone:
          one Individual, never combined with the house statement. */}
      {entries && summary && (
        <div className="personal-spending-printout" aria-hidden="true">
          <h1>Personal spending statement</h1>
          <p>
            {individualName}
            {dmhId ? ` · DMH ID ${dmhId}` : ""}
            {dateOfBirth ? ` · Date of birth ${formatDate(dateOfBirth)}` : ""}
          </p>
          <p>
            {session.agencyName} · {siteName} · {monthLabel(month)}
          </p>
          <p>Opening balance: {formatCents(summary.openingBalanceCents)}</p>
          <table className="ps-print-table">
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
              {monthRows.map((entry) => (
                <tr
                  key={entry.id}
                  className={entry.voided ? "ps-row-voided" : undefined}
                >
                  <td>{formatDate(entry.entryDate)}</td>
                  <td>
                    {personalEntryTitle(entry)} — {personalEntryDetail(entry)}
                    {entry.note ? ` · ${entry.note}` : ""}
                    {entry.overBalance && !entry.voided
                      ? " · Over balance"
                      : ""}
                    {entry.voided ? ` · Void — ${entry.voidReason}` : ""}
                    {entry.postCloseCorrection
                      ? " · Post-close correction"
                      : ""}
                    {` · recorded by ${entry.recordedByName}`}
                  </td>
                  <td className="ps-num">
                    {entry.kind === "deposit"
                      ? formatCents(entry.amountCents)
                      : ""}
                  </td>
                  <td className="ps-num">
                    {entry.kind === "spend"
                      ? formatCents(entry.amountCents)
                      : ""}
                  </td>
                  <td className="ps-num">
                    {entry.voided
                      ? "—"
                      : formatCents(entry.runningBalanceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Totals</h2>
          <ul className="ps-print-totals">
            <li>Total deposited: {formatCents(summary.totalDepositedCents)}</li>
            <li>Total spent: {formatCents(summary.totalSpentCents)}</li>
            <li>
              Closing balance:{" "}
              {formatCents(
                close ? close.closingBalanceCents : summary.closingBalanceCents,
              )}
            </li>
          </ul>
          <h2>Sign-off</h2>
          {close ? (
            <>
              <p>
                Printed name of house manager: {close.printedName}
                <br />
                Signature: {close.signatureText}
                <br />
                Date signed: {formatDate(close.signedAt.slice(0, 10))}
              </p>
              {close.individualSignoff === "individual_signed" ? (
                <p>
                  Printed name of Individual: {individualName}
                  <br />
                  Sign-off: the Individual signed this statement.
                  <br />
                  Date signed: {formatDate(close.signedAt.slice(0, 10))}
                </p>
              ) : (
                <p>
                  The Individual was unable to sign. A second staff member
                  signed in their place.
                  <br />
                  Printed name of staff member: {close.secondStaffName ?? ""}
                  <br />
                  Signature: {close.secondStaffSignatureText ?? ""}
                  <br />
                  Date signed: {formatDate(close.signedAt.slice(0, 10))}
                </p>
              )}
            </>
          ) : (
            <p>Not yet signed.</p>
          )}
          <p className="ps-print-mark">Digital record generated by Complyrer.</p>
        </div>
      )}
    </section>
  );
}
