/**
 * PERSONAL SPENDING — Individual chart section: one person's own money.
 *
 * The ledger of a single Individual: funds received for them and spends
 * made with or for them, each spend carrying its purpose. The balance
 * derives from the entries and carries across months. A spend that
 * takes the balance below $0 still records and is labeled "Over
 * balance"; while its month is open the section raises a
 * needs-attention flag for the house manager. Months close with TWO
 * sign-offs — the manager's attestation and the Individual's own
 * sign-off (or a second staff member's, when the Individual was unable
 * to sign) — and the month prints as a stamped statement.
 *
 * This section is separate from the House Card (the home's petty cash):
 * different money, different ledger, no shared entries.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Printer, Wallet } from "lucide-react";
import { Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import {
  canClosePersonalSpendingMonth,
  canRecordPersonalSpending,
  canViewPersonalSpending,
  canVoidPersonalSpendingEntry,
} from "../../data/permissions";
import { centralTodayIso } from "../../data/menuRecords";
import { monthLabel } from "../../data/mileage";
import {
  PERSONAL_SPENDING_KIND_LABELS,
  closeForMonth,
  computePersonalBalanceCents,
  formatCents,
  personalSpendingNeedsAttention,
  recentPersonalSpendingLocations,
  summarizePersonalSpendingMonth,
  type PersonalSpendingEntryDraft,
  type PersonalSpendingEntryKind,
  type PersonalSpendingEntryView,
  type PersonalSpendingMonthClose,
  type PersonalSpendingReceiptPhoto,
  type PersonalSpendingSignoff,
} from "../../data/personalSpending";
import { parseAmountToCents } from "../houseCard/HouseCardPanel";
import "./personalSpending.css";

export interface PersonalSpendingStaffOption {
  id: string;
  name: string;
}

interface EntryFormState {
  kind: PersonalSpendingEntryKind;
  entryDate: string;
  location: string;
  purpose: string;
  amount: string;
  note: string;
  receiptPhoto: PersonalSpendingReceiptPhoto | null;
}

function blankForm(today: string): EntryFormState {
  return {
    kind: "spend",
    entryDate: today,
    location: "",
    purpose: "",
    amount: "",
    note: "",
    receiptPhoto: null,
  };
}

function formFromEntry(
  entry: PersonalSpendingEntryView,
  today: string,
): EntryFormState {
  return {
    kind: entry.kind,
    entryDate: entry.entryDate || today,
    location: entry.location,
    purpose: entry.purpose,
    amount: (entry.amountCents / 100).toFixed(2),
    note: entry.note,
    receiptPhoto: entry.receiptPhoto,
  };
}

function formToDraft(form: EntryFormState): PersonalSpendingEntryDraft {
  const amountCents = parseAmountToCents(form.amount);
  if (amountCents === null) {
    throw new Error("Enter the amount like 42.50.");
  }
  return {
    entryDate: form.entryDate,
    kind: form.kind,
    location: form.location,
    purpose: form.kind === "spend" ? form.purpose : "",
    amountCents,
    note: form.note,
    receiptPhoto: form.receiptPhoto,
  };
}

function EntryFormFields({
  form,
  setForm,
  locations,
  userId,
  idPrefix,
}: {
  form: EntryFormState;
  setForm: (next: EntryFormState) => void;
  locations: string[];
  userId: string;
  idPrefix: string;
}) {
  const onReceiptFile = (file: File | null) => {
    if (!file) {
      setForm({ ...form, receiptPhoto: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm({
        ...form,
        receiptPhoto: {
          id: crypto.randomUUID(),
          name: file.name,
          dataUrl: String(reader.result ?? ""),
          capturedAt: new Date().toISOString(),
          capturedBy: userId,
        },
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="ps-form-grid">
      <label className="ps-field">
        <span>Entry type</span>
        <select
          value={form.kind}
          onChange={(e) =>
            setForm({
              ...form,
              kind: e.target.value as PersonalSpendingEntryKind,
            })
          }
        >
          <option value="spend">Spent</option>
          <option value="deposit">Funds received</option>
        </select>
      </label>
      <label className="ps-field">
        <span>Date</span>
        <input
          type="date"
          value={form.entryDate}
          onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
        />
      </label>
      <label className="ps-field">
        <span>{form.kind === "deposit" ? "Received from" : "Location"}</span>
        <input
          type="text"
          value={form.location}
          list={`${idPrefix}-locations`}
          placeholder={
            form.kind === "deposit"
              ? "e.g. Monthly personal funds"
              : "Where was it spent?"
          }
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
        <datalist id={`${idPrefix}-locations`}>
          {locations.map((location) => (
            <option key={location} value={location} />
          ))}
        </datalist>
      </label>
      <label className="ps-field">
        <span>Amount</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
      </label>
      {form.kind === "spend" && (
        <label className="ps-field ps-field-wide">
          <span>Purpose — what was this money used for?</span>
          <input
            type="text"
            value={form.purpose}
            placeholder="e.g. Clothing — new shoes"
            onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          />
        </label>
      )}
      <label className="ps-field ps-field-wide">
        <span>Note (optional)</span>
        <input
          type="text"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <label className="ps-field">
        <span>Receipt photo (optional)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onReceiptFile(e.target.files?.[0] ?? null)}
        />
        {form.receiptPhoto && (
          <span className="ps-receipt-name">
            Attached: {form.receiptPhoto.name}
            <button
              type="button"
              className="ps-link-button"
              onClick={() => setForm({ ...form, receiptPhoto: null })}
            >
              Remove
            </button>
          </span>
        )}
      </label>
    </div>
  );
}

function entryDetailText(entry: PersonalSpendingEntryView): string {
  const parts: string[] = [PERSONAL_SPENDING_KIND_LABELS[entry.kind]];
  if (entry.purpose) parts.push(entry.purpose);
  return parts.join(" · ");
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

export default function PersonalSpendingCard({
  individualId,
  individualName,
  dmhId,
  dateOfBirth,
  siteName,
  staffOptions,
}: {
  individualId: string;
  individualName: string;
  dmhId: string;
  dateOfBirth: string;
  siteName: string;
  staffOptions: PersonalSpendingStaffOption[];
}) {
  const { api, session } = useData();
  if (!session) return null;
  return (
    <PersonalSpendingSection
      api={api}
      session={session}
      individualId={individualId}
      individualName={individualName}
      dmhId={dmhId}
      dateOfBirth={dateOfBirth}
      siteName={siteName}
      staffOptions={staffOptions}
    />
  );
}

function PersonalSpendingSection({
  api,
  session,
  individualId,
  individualName,
  dmhId,
  dateOfBirth,
  siteName,
  staffOptions,
}: {
  api: ComplyraApi;
  session: SessionUser;
  individualId: string;
  individualName: string;
  dmhId: string;
  dateOfBirth: string;
  siteName: string;
  staffOptions: PersonalSpendingStaffOption[];
}) {
  const today = centralTodayIso();
  const currentMonth = today.slice(0, 7);
  const [entries, setEntries] = useState<PersonalSpendingEntryView[] | null>(
    null,
  );
  const [closes, setCloses] = useState<PersonalSpendingMonthClose[]>([]);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [form, setForm] = useState<EntryFormState>(() => blankForm(today));
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] =
    useState<PersonalSpendingEntryView | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [withReplacement, setWithReplacement] = useState(true);
  const [replacementForm, setReplacementForm] = useState<EntryFormState>(() =>
    blankForm(today),
  );
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
    () => (entries ?? []).filter((entry) => entry.entryDate.startsWith(month)),
    [entries, month],
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

  const submitEntry = async () => {
    setFormError("");
    setNotice("");
    let draft: PersonalSpendingEntryDraft;
    try {
      draft = formToDraft(form);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Check the entry.");
      return;
    }
    setSaving(true);
    try {
      await api.createPersonalSpendingEntry({ individualId, ...draft });
      setForm(blankForm(today));
      setNotice("Entry recorded.");
      await reload();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not record that entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const openVoid = (entry: PersonalSpendingEntryView) => {
    setVoidTarget(entry);
    setVoidReason("");
    setWithReplacement(true);
    setReplacementForm(formFromEntry(entry, today));
    setFormError("");
    setNotice("");
  };

  const submitVoid = async () => {
    if (!voidTarget) return;
    setFormError("");
    setNotice("");
    setSaving(true);
    try {
      let replacement:
        | ({ individualId: string } & PersonalSpendingEntryDraft)
        | null = null;
      if (withReplacement) {
        replacement = { individualId, ...formToDraft(replacementForm) };
      }
      await api.voidPersonalSpendingEntry(voidTarget.id, voidReason, replacement);
      setVoidTarget(null);
      setNotice(
        replacement
          ? "Entry voided and replaced."
          : "Entry voided. It stays on the record and no longer counts.",
      );
      await reload();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not void that entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitClose = async () => {
    setFormError("");
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
      setFormError(
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
    <section
      className="chart-widget personal-spending"
      aria-labelledby="personal-spending-heading"
    >
      <div className="personal-spending-screen">
        <h2 id="personal-spending-heading">Personal spending</h2>
        <p className="stack-help">
          {individualName}&rsquo;s own money — funds received for them and
          what was spent, with the purpose of every spend. This ledger is
          separate from the home&rsquo;s house card.
        </p>

        {loadError && (
          <>
            <p className="form-error">
              The personal spending ledger could not be loaded. {loadError}
            </p>
            <button
              type="button"
              className="button"
              onClick={() => void reload()}
            >
              Try again
            </button>
          </>
        )}

        {!loadError && !entries && (
          <p className="muted">Loading the personal spending ledger…</p>
        )}

        {!loadError && entries && summary && (
          <>
            <div className="ps-stats">
              <div className="ps-stat">
                <span className="ps-stat-label">
                  <Wallet size={15} aria-hidden="true" /> Personal funds
                  balance
                </span>
                <strong className="ps-stat-value">
                  {formatCents(balance)}
                </strong>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">
                  Spent in {monthLabel(month)}
                </span>
                <strong className="ps-stat-value">
                  {formatCents(summary.totalSpentCents)}
                </strong>
              </div>
              <div className="ps-stat">
                <span className="ps-stat-label">
                  Received in {monthLabel(month)}
                </span>
                <strong className="ps-stat-value">
                  {formatCents(summary.totalDepositedCents)}
                </strong>
              </div>
              <label className="ps-field ps-month-picker">
                <span>Month</span>
                <input
                  type="month"
                  aria-label="Personal spending month"
                  value={month}
                  max={currentMonth}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
              </label>
            </div>

            {attention && (
              <p className="ps-attention" role="status">
                <span className="ps-flag">Needs attention</span> Spending has
                taken {individualName}&rsquo;s balance below $0 in a month
                that is still open. The house manager should review the
                entries marked &ldquo;Over balance&rdquo; below.
              </p>
            )}

            {close ? (
              <p className="ps-close-note">
                <strong>{monthLabel(month)} is closed and signed</strong> by{" "}
                {close.printedName} on {formatDate(close.signedAt.slice(0, 10))}
                . Closing balance at sign-off:{" "}
                {formatCents(close.closingBalanceCents)}.{" "}
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

            {notice && (
              <p className="ps-notice" role="status">
                {notice}
              </p>
            )}
            {formError && (
              <p className="ps-error" role="alert">
                {formError}
              </p>
            )}

            {canRecord && (
              <section className="ps-section" aria-label="Record an entry">
                <h3>Record an entry</h3>
                <EntryFormFields
                  form={form}
                  setForm={setForm}
                  locations={locations}
                  userId={session.userId}
                  idPrefix="ps-new"
                />
                <div className="ps-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={saving}
                    onClick={() => void submitEntry()}
                  >
                    {saving ? "Recording…" : "Record entry"}
                  </button>
                </div>
              </section>
            )}

            <section className="ps-section" aria-label="Month balance">
              <h3>{monthLabel(month)} balance</h3>
              <ul className="ps-total-list">
                <li>
                  <span>Opening balance</span>
                  <strong>{formatCents(summary.openingBalanceCents)}</strong>
                </li>
                <li>
                  <span>Funds received</span>
                  <strong>{formatCents(summary.totalDepositedCents)}</strong>
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
            </section>

            <section className="ps-section" aria-label="Ledger">
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
                            <strong>
                              {entry.location ||
                                (entry.kind === "deposit"
                                  ? "Funds received"
                                  : "Spend")}
                            </strong>
                            <span className="ps-row-sub">
                              {entryDetailText(entry)} · recorded by{" "}
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
                            {canRecord &&
                              !entry.voided &&
                              // Wave 6 item 3: Void is a closer action;
                              // other recorders see it only on their own
                              // entries (their Undo path).
                              canVoidPersonalSpendingEntry(session, entry) && (
                                <button
                                  type="button"
                                  className="ps-link-button"
                                  onClick={() => openVoid(entry)}
                                >
                                  Void
                                </button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {voidTarget && (
              <section className="ps-section" aria-label="Void entry">
                <h3>
                  Void entry — {formatDate(voidTarget.entryDate)} ·{" "}
                  {voidTarget.location || "Funds received"} ·{" "}
                  {formatCents(voidTarget.amountCents)}
                </h3>
                <p className="stack-help">
                  Voiding never deletes the entry: it stays on the record
                  with your reason and stops counting toward the balance
                  and totals.
                </p>
                <label className="ps-field">
                  <span>Reason for voiding</span>
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                  />
                </label>
                <label className="ps-check">
                  <input
                    type="checkbox"
                    checked={withReplacement}
                    onChange={(e) => setWithReplacement(e.target.checked)}
                  />
                  <span>Record a corrected replacement entry</span>
                </label>
                {withReplacement && (
                  <EntryFormFields
                    form={replacementForm}
                    setForm={setReplacementForm}
                    locations={locations}
                    userId={session.userId}
                    idPrefix="ps-replace"
                  />
                )}
                <div className="ps-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={saving}
                    onClick={() => void submitVoid()}
                  >
                    {saving ? "Voiding…" : "Void entry"}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={saving}
                    onClick={() => setVoidTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}

            {canClose && !close && month <= currentMonth && (
              <section className="ps-section" aria-label="Close the month">
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
                        name="ps-signoff"
                        checked={signoff === "individual_signed"}
                        onChange={() => setSignoff("individual_signed")}
                      />
                      <span>{individualName} signed the statement</span>
                    </label>
                    <label className="ps-check">
                      <input
                        type="radio"
                        name="ps-signoff"
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
                        <span>Second staff member&rsquo;s typed signature</span>
                        <input
                          type="text"
                          value={secondSignature}
                          onChange={(e) => setSecondSignature(e.target.value)}
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
              </section>
            )}
          </>
        )}
      </div>

      {/* Printed monthly statement — screen-hidden, print-only. */}
      {entries && summary && (
        <div className="personal-spending-printout" aria-hidden="true">
          <h1>Personal spending statement</h1>
          <p>
            {individualName}
            {dmhId ? ` · DMH ID ${dmhId}` : ""}
            {dateOfBirth
              ? ` · Date of birth ${formatDate(dateOfBirth)}`
              : ""}
          </p>
          <p>
            {session.agencyName} · {siteName} · {monthLabel(month)}
          </p>
          <p>
            Opening balance: {formatCents(summary.openingBalanceCents)}
          </p>
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
                    {entry.location ||
                      (entry.kind === "deposit" ? "Funds received" : "Spend")}{" "}
                    — {entryDetailText(entry)}
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
            <li>
              Total deposited: {formatCents(summary.totalDepositedCents)}
            </li>
            <li>Total spent: {formatCents(summary.totalSpentCents)}</li>
            <li>
              Closing balance:{" "}
              {formatCents(
                close
                  ? close.closingBalanceCents
                  : summary.closingBalanceCents,
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
                  Printed name of staff member:{" "}
                  {close.secondStaffName ?? ""}
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

/**
 * The chart header glance: the person's current personal-funds balance,
 * one small labeled line. Contained — a load failure (or a role without
 * access) renders nothing rather than breaking the chart.
 */
export function PersonalFundsGlance({
  individualId,
}: {
  individualId: string;
}) {
  const { api, session } = useData();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!session || !canViewPersonalSpending(session.roleKey)) {
      setBalance(null);
      return;
    }
    void (async () => {
      try {
        const rows = await api.listPersonalSpendingEntries(individualId);
        if (!cancelled) setBalance(computePersonalBalanceCents(rows));
      } catch {
        if (!cancelled) setBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, individualId, session]);

  if (balance === null) return null;
  return (
    <p className="ps-glance">
      Personal funds balance: <strong>{formatCents(balance)}</strong>
    </p>
  );
}
