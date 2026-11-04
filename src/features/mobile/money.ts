/**
 * Mobile money — the pure logic behind the quick-entry redesign of the
 * two phone money views (House Card + Personal Spending).
 *
 * The patterns come from the expense-tracker UX research (2026-10-30):
 * amount-first entry, a stable category grid ordered by recent use,
 * a free-typed location, a Today timeline with the running balance on
 * every row, and corrections as a plainly labeled Void — never a
 * delete. Everything here is presentation logic over the SAME ledger
 * modules the desktop panels use (data/houseCard, data/personalSpending);
 * the rules themselves are not re-implemented.
 */
import {
  HOUSE_CARD_CATEGORIES,
  HOUSE_CARD_KIND_LABELS,
  formatCents,
  houseCardCategoryLabel,
  type HouseCardCategory,
  type HouseCardEntryRow,
  type HouseCardEntryView,
  type HouseCardLedgerRow,
  type HouseCardReceiptPhoto,
} from "../../data/houseCard";
import {
  PERSONAL_SPENDING_KIND_LABELS,
  computePersonalBalanceCents,
  type PersonalSpendingEntryView,
} from "../../data/personalSpending";

/** The shared entry sheet's form state (both ledgers map onto it). */
export interface MoneySheetValues {
  /** House: credit | purchase | refund. Personal: spend | deposit. */
  kind: string;
  amountText: string;
  /** House purchases only; "" when not chosen. */
  category: string;
  location: string;
  /** Personal spends only. */
  purpose: string;
  /** House purchases in an Individual category only; "" when not chosen. */
  individualId: string;
  entryDate: string;
  note: string;
  receiptPhoto: HouseCardReceiptPhoto | null;
}

export function blankMoneyValues(today: string, kind: string): MoneySheetValues {
  return {
    kind,
    amountText: "",
    category: "",
    location: "",
    purpose: "",
    individualId: "",
    entryDate: today,
    note: "",
    receiptPhoto: null,
  };
}

/** Cents → the sheet's amount text ("42.50"). */
export function amountTextOf(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

/**
 * Repeat = the same entry again, dated today: every field carries over
 * except the date (a repeat is a new purchase today, not a back-date).
 */
export function houseRepeatValues(
  entry: HouseCardEntryView,
  today: string,
): MoneySheetValues {
  return {
    kind: entry.kind,
    amountText: amountTextOf(entry.amountCents),
    category: entry.category ?? "",
    location: entry.location,
    purpose: "",
    individualId: entry.individualId ?? "",
    entryDate: today,
    note: entry.note,
    receiptPhoto: null,
  };
}

export function personalRepeatValues(
  entry: PersonalSpendingEntryView,
  today: string,
): MoneySheetValues {
  return {
    kind: entry.kind,
    amountText: amountTextOf(entry.amountCents),
    category: "",
    location: entry.location,
    purpose: entry.purpose,
    individualId: "",
    entryDate: today,
    note: entry.note,
    receiptPhoto: null,
  };
}

/**
 * The category grid's order: the categories this ledger actually uses,
 * most recently used first (muscle memory follows the house's real
 * habits, per the research); categories never used keep the canonical
 * order after the used ones. Positions change only as use changes —
 * never mid-session reshuffling.
 */
export function orderCategoriesByUse(
  entries: readonly HouseCardEntryRow[],
): HouseCardCategory[] {
  const lastUsedAt = new Map<HouseCardCategory, string>();
  for (const entry of entries) {
    if (entry.voidedAt || entry.kind !== "purchase" || !entry.category) {
      continue;
    }
    const stamp = entry.createdAt;
    if (stamp > (lastUsedAt.get(entry.category) ?? "")) {
      lastUsedAt.set(entry.category, stamp);
    }
  }
  return [...HOUSE_CARD_CATEGORIES].sort((a, b) => {
    const aUsed = lastUsedAt.get(a);
    const bUsed = lastUsedAt.get(b);
    if (aUsed && bUsed) return bUsed.localeCompare(aUsed);
    if (aUsed) return -1;
    if (bUsed) return 1;
    return (
      HOUSE_CARD_CATEGORIES.indexOf(a) - HOUSE_CARD_CATEGORIES.indexOf(b)
    );
  });
}

/** Today's rows of the house ledger, in posting order (running balance reads down). */
export function houseTodayRows<T extends HouseCardEntryRow>(
  ledger: readonly HouseCardLedgerRow<T>[],
  todayIso: string,
): HouseCardLedgerRow<T>[] {
  return ledger.filter((row) => row.entry.entryDate === todayIso);
}

/** Today's counted money movement for the pinned header's summary line. */
export function houseTodayTotals<T extends HouseCardEntryRow>(
  ledger: readonly HouseCardLedgerRow<T>[],
  todayIso: string,
): { spentCents: number; receivedCents: number } {
  let spentCents = 0;
  let receivedCents = 0;
  for (const row of ledger) {
    const entry = row.entry;
    if (entry.entryDate !== todayIso || entry.voidedAt) continue;
    if (entry.kind === "purchase") spentCents += entry.amountCents;
    else receivedCents += entry.amountCents;
  }
  return { spentCents, receivedCents };
}

/** One home's personal-spending lists, keyed by Individual. */
export type SpendingEntriesByPerson = {
  personId: string;
  entries: PersonalSpendingEntryView[];
}[];

/**
 * The entries behind one person in the Quick log's spending flow — or
 * null while the home's lists have not loaded yet. The distinction is
 * the batch-49 fix: the flow used to collapse "not loaded" into an
 * empty list, so the chooser showed names with no amounts and the
 * person view stated a factual $0.00 balance and "Nothing recorded
 * yet" for ledgers that simply had not arrived (and never would when
 * the load had failed behind the status guard). A loaded home that
 * has no row for the person is a factual empty ledger ([]), never
 * null.
 */
export function spendingEntriesFor(
  entriesByPerson: SpendingEntriesByPerson | null,
  personId: string,
): PersonalSpendingEntryView[] | null {
  if (entriesByPerson === null) return null;
  return (
    entriesByPerson.find((row) => row.personId === personId)?.entries ?? []
  );
}

/**
 * The chooser row's balance for one person — or null while the lists
 * have not loaded, so the row can say "Loading…" instead of silently
 * carrying no amount (the batch-49 surface inconsistency: the Health
 * door showed the balance on the row, the Quick log picker never did).
 */
export function spendingChooserBalanceCents(
  entriesByPerson: SpendingEntriesByPerson | null,
  personId: string,
): number | null {
  const entries = spendingEntriesFor(entriesByPerson, personId);
  if (entries === null) return null;
  return computePersonalBalanceCents(entries);
}

/** The person's most recent entries, newest first, for the timeline. */
export function personalRecentRows(
  views: readonly PersonalSpendingEntryView[],
  limit = 12,
): PersonalSpendingEntryView[] {
  return [...views].reverse().slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Row text — words carry the meaning, never color alone               */
/* ------------------------------------------------------------------ */

export function houseEntryTitle(entry: HouseCardEntryView): string {
  return entry.location || "Funds received";
}

/** "Purchase · Gas · Ellis Hart" — the panel's detail line, shared. */
export function houseEntryDetail(entry: HouseCardEntryView): string {
  const parts: string[] = [HOUSE_CARD_KIND_LABELS[entry.kind]];
  if (entry.category) parts.push(houseCardCategoryLabel(entry.category));
  if (entry.individualName) parts.push(entry.individualName);
  return parts.join(" · ");
}

export function personalEntryTitle(entry: PersonalSpendingEntryView): string {
  if (entry.location) return entry.location;
  return entry.kind === "deposit" ? "Funds received" : "Spend";
}

/** "Spent · Clothing — new shoes" — kind + the spend's purpose. */
export function personalEntryDetail(entry: PersonalSpendingEntryView): string {
  const parts: string[] = [PERSONAL_SPENDING_KIND_LABELS[entry.kind]];
  if (entry.purpose) parts.push(entry.purpose);
  return parts.join(" · ");
}

/** "+$25.00" / "-$12.44" — the sign states the direction in text. */
export function signedAmountText(
  kind: "in" | "out",
  amountCents: number,
): string {
  return `${kind === "in" ? "+" : "−"}${formatCents(amountCents)}`;
}

export function houseSignedAmount(entry: HouseCardEntryView): string {
  return signedAmountText(
    entry.kind === "purchase" ? "out" : "in",
    entry.amountCents,
  );
}

export function personalSignedAmount(entry: PersonalSpendingEntryView): string {
  return signedAmountText(
    entry.kind === "spend" ? "out" : "in",
    entry.amountCents,
  );
}
