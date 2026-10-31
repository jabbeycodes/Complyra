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
  HOUSE_CARD_CATEGORIES,
  HOUSE_CARD_CATEGORY_LABELS,
  HOUSE_CARD_KIND_LABELS,
  buildHouseCardLedger,
  categoryNeedsIndividual,
  closeForMonth,
  computeBalanceCents,
  formatCents,
  houseCardCategoryLabel,
  isLowBalance,
  recentHouseCardLocations,
  summarizeHouseCardMonth,
  type HouseCardCategory,
  type HouseCardEntryDraft,
  type HouseCardEntryKind,
  type HouseCardEntryView,
  type HouseCardMonthClose,
  type HouseCardReceiptPhoto,
} from "../../data/houseCard";
import "./houseCard.css";

export interface HouseCardPerson {
  id: string;
  name: string;
}

interface EntryFormState {
  kind: HouseCardEntryKind;
  entryDate: string;
  location: string;
  amount: string;
  category: string;
  individualId: string;
  note: string;
  receiptPhoto: HouseCardReceiptPhoto | null;
}

function blankForm(today: string): EntryFormState {
  return {
    kind: "purchase",
    entryDate: today,
    location: "",
    amount: "",
    category: "",
    individualId: "",
    note: "",
    receiptPhoto: null,
  };
}

function formFromEntry(entry: HouseCardEntryView, today: string): EntryFormState {
  return {
    kind: entry.kind,
    entryDate: entry.entryDate || today,
    location: entry.location,
    amount: (entry.amountCents / 100).toFixed(2),
    category: entry.category ?? "",
    individualId: entry.individualId ?? "",
    note: entry.note,
    receiptPhoto: entry.receiptPhoto,
  };
}

/** "42.5" → 4250. Returns null for anything that is not a clean amount. */
export function parseAmountToCents(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

function formToDraft(form: EntryFormState): HouseCardEntryDraft {
  const amountCents = parseAmountToCents(form.amount);
  if (amountCents === null) {
    throw new Error("Enter the amount like 42.50.");
  }
  return {
    entryDate: form.entryDate,
    kind: form.kind,
    location: form.location,
    amountCents,
    category:
      form.kind === "purchase" && form.category
        ? (form.category as HouseCardCategory)
        : null,
    individualId:
      form.kind === "purchase" && categoryNeedsIndividual(
        form.category ? (form.category as HouseCardCategory) : null,
      )
        ? form.individualId || null
        : null,
    note: form.note,
    receiptPhoto: form.receiptPhoto,
  };
}

function EntryFormFields({
  form,
  setForm,
  people,
  locations,
  userId,
  idPrefix,
}: {
  form: EntryFormState;
  setForm: (next: EntryFormState) => void;
  people: HouseCardPerson[];
  locations: string[];
  userId: string;
  idPrefix: string;
}) {
  const needsIndividual =
    form.kind === "purchase" &&
    categoryNeedsIndividual(
      form.category ? (form.category as HouseCardCategory) : null,
    );

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
    <div className="hc-form-grid">
      <label className="hc-field hc-f-type">
        <span>Entry type</span>
        <select
          value={form.kind}
          onChange={(e) =>
            setForm({ ...form, kind: e.target.value as HouseCardEntryKind })
          }
        >
          <option value="purchase">Purchase</option>
          <option value="credit">Funds received</option>
          <option value="refund">Refund</option>
        </select>
      </label>
      <label className="hc-field hc-f-date">
        <span>Date</span>
        <input
          type="date"
          value={form.entryDate}
          onChange={(e) => setForm({ ...form, entryDate: e.target.value })}
        />
      </label>
      <label className="hc-field hc-f-location">
        <span>{form.kind === "credit" ? "Received from" : "Location"}</span>
        <input
          type="text"
          value={form.location}
          list={`${idPrefix}-locations`}
          placeholder={
            form.kind === "credit" ? "e.g. Monthly house funds" : "Where was it spent?"
          }
          onChange={(e) => setForm({ ...form, location: e.target.value })}
        />
        <datalist id={`${idPrefix}-locations`}>
          {locations.map((location) => (
            <option key={location} value={location} />
          ))}
        </datalist>
      </label>
      <label className="hc-field hc-f-amount">
        <span>Amount</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
      </label>
      {form.kind === "purchase" && (
        <>
          <label className="hc-field hc-f-category">
            <span>What was it for?</span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">Choose one…</option>
              {HOUSE_CARD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {HOUSE_CARD_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </label>
          {needsIndividual && (
            <label className="hc-field hc-f-individual">
              <span>Individual</span>
              <select
                value={form.individualId}
                onChange={(e) =>
                  setForm({ ...form, individualId: e.target.value })
                }
              >
                <option value="">Choose one…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <label
        className={`hc-field hc-f-note${needsIndividual ? "" : " hc-f-note-wide"}`}
      >
        <span>Note (required for purchases over $250)</span>
        <input
          type="text"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </label>
      <label className="hc-field hc-f-receipt">
        <span>Receipt photo (optional)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => onReceiptFile(e.target.files?.[0] ?? null)}
        />
        {form.receiptPhoto && (
          <span className="hc-receipt-name">
            Attached: {form.receiptPhoto.name}
            <button
              type="button"
              className="hc-link-button"
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

function entryDetailText(entry: HouseCardEntryView): string {
  const parts: string[] = [HOUSE_CARD_KIND_LABELS[entry.kind]];
  if (entry.category) parts.push(houseCardCategoryLabel(entry.category));
  if (entry.individualName) parts.push(entry.individualName);
  return parts.join(" · ");
}

export default function HouseCardPanel({
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
  people: HouseCardPerson[];
}) {
  const today = centralTodayIso();
  const currentMonth = today.slice(0, 7);
  const [entries, setEntries] = useState<HouseCardEntryView[] | null>(null);
  const [closes, setCloses] = useState<HouseCardMonthClose[]>([]);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [form, setForm] = useState<EntryFormState>(() => blankForm(today));
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<HouseCardEntryView | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [withReplacement, setWithReplacement] = useState(true);
  const [replacementForm, setReplacementForm] = useState<EntryFormState>(() =>
    blankForm(today),
  );
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
    () =>
      entries
        ? summarizeHouseCardMonth(entries, month, names)
        : null,
    [entries, month, names],
  );
  const monthRows = useMemo(
    () => ledger.filter((row) => row.entry.entryDate.startsWith(month)),
    [ledger, month],
  );
  const close = closeForMonth(closes, month);
  const locations = useMemo(
    () => (entries ? recentHouseCardLocations(entries) : []),
    [entries],
  );
  const postCloseCount = monthRows.filter(
    (row) => row.entry.postCloseCorrection,
  ).length;
  const low = isLowBalance(balance);

  const submitEntry = async () => {
    setFormError("");
    setNotice("");
    let draft: HouseCardEntryDraft;
    try {
      draft = formToDraft(form);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Check the entry.");
      return;
    }
    setSaving(true);
    try {
      await api.createHouseCardEntry({ siteId, ...draft });
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

  const openVoid = (entry: HouseCardEntryView) => {
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
      let replacement: ({ siteId: string } & HouseCardEntryDraft) | null = null;
      if (withReplacement) {
        replacement = { siteId, ...formToDraft(replacementForm) };
      }
      await api.voidHouseCardEntry(voidTarget.id, voidReason, replacement);
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
      await api.closeHouseCardMonth({ siteId, month, signatureText: signature });
      setSignature("");
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
            <button type="button" className="button" onClick={() => void reload()}>
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
    <div className="house-card">
      <div className="house-card-screen">
        <div className="hc-stats">
          <div className="hc-stat">
            <span className="hc-stat-label">
              <Wallet size={15} aria-hidden="true" /> Card balance now
            </span>
            <strong className="hc-stat-value">{formatCents(balance)}</strong>
            {low && <span className="hc-flag">Low balance</span>}
          </div>
          <div className="hc-stat">
            <span className="hc-stat-label">Spent in {monthLabel(month)}</span>
            <strong className="hc-stat-value">
              {formatCents(summary.totalSpentCents)}
            </strong>
          </div>
          <div className="hc-stat">
            <span className="hc-stat-label">
              Received in {monthLabel(month)}
            </span>
            <strong className="hc-stat-value">
              {formatCents(summary.totalDepositedCents)}
            </strong>
          </div>
          <label className="hc-field hc-month-picker">
            <span>Month</span>
            <input
              type="month"
              aria-label="House card month"
              value={month}
              max={currentMonth}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
            />
          </label>
        </div>

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

        {notice && (
          <p className="hc-notice" role="status">
            {notice}
          </p>
        )}
        {formError && (
          <p className="hc-error" role="alert">
            {formError}
          </p>
        )}

        {canRecord && (
          <section className="hc-section" aria-label="Record an entry">
            <h3>Record an entry</h3>
            <EntryFormFields
              form={form}
              setForm={setForm}
              people={people}
              locations={locations}
              userId={session.userId}
              idPrefix="hc-new"
            />
            <div className="hc-actions">
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

        <section className="hc-section" aria-label="Month totals">
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
        </section>

        <section className="hc-section" aria-label="Ledger">
          <div className="hc-section-head">
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
                        <strong>{entry.location || "Funds received"}</strong>
                        <span className="hc-row-sub">
                          {entryDetailText(entry)} · recorded by{" "}
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
                        {entry.voided ? "—" : formatCents(runningBalanceCents)}
                      </td>
                      <td>
                        {/* Voiding is a manager action (batch 9): the
                            button follows the close-month gate, not the
                            record gate — DSPs record but never void. */}
                        {canClose && !entry.voided && (
                          <button
                            type="button"
                            className="hc-link-button"
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
          <section className="hc-section" aria-label="Void entry">
            <h3>
              Void entry — {formatDate(voidTarget.entryDate)} ·{" "}
              {voidTarget.location || "Funds received"} ·{" "}
              {formatCents(voidTarget.amountCents)}
            </h3>
            <p className="stack-help">
              Voiding never deletes the entry: it stays on the record with
              your reason and stops counting toward the balance and totals.
            </p>
            <label className="hc-field">
              <span>Reason for voiding</span>
              <input
                type="text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            </label>
            <label className="hc-check">
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
                people={people}
                locations={locations}
                userId={session.userId}
                idPrefix="hc-replace"
              />
            )}
            <div className="hc-actions">
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
          <section className="hc-section" aria-label="Close the month">
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
          </section>
        )}
      </div>

      {/* Printed monthly statement — screen-hidden, print-only. */}
      <div className="house-card-printout" aria-hidden="true">
        <h1>
          {siteName} — House Card statement
        </h1>
        <p>
          {session.agencyName} · {monthLabel(month)}
        </p>
        <p>
          Opening balance: {formatCents(summary.openingBalanceCents)}
        </p>
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
                  {entry.location || "Funds received"} — {entryDetailText(entry)}
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
            {formatCents(close ? close.closingBalanceCents : summary.closingBalanceCents)}
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
