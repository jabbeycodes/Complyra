/**
 * HOUSE CARD — the per-home petty cash ledger.
 *
 * Every program site runs a house card: the agency credits funds onto it,
 * staff record each purchase against it, and the home's manager signs the
 * month closed. This module is the single source of the ledger's rules;
 * the LocalApi and HostedApi enforce them again at their layers, and
 * supabase/migrations/20261029130000_house_card.sql backstops them in the
 * database.
 *
 * Complyrer's own model (not a copy of any paper sheet):
 *  - One append-only log per home. An entry is a credit (funds received),
 *    a purchase, or a refund. Purchases carry a category; three of the
 *    categories (Gas, Health card, Food stamps) are always tied to one
 *    Individual of the home, the fourth (Groceries & household) is the
 *    home's own spending.
 *  - The balance is DERIVED from the entries, never stored as an editable
 *    number. Credits and refunds add; purchases subtract.
 *  - Corrections never erase: a wrong entry is VOIDED with a reason and,
 *    when the spend still happened, replaced by a fresh entry linked to
 *    the voided one. Voided entries stay visible (labeled Void) and never
 *    count toward any total.
 *  - A month can be CLOSED with the manager's attestation. A closed month
 *    refuses new back-dated entries; void/replace corrections stay
 *    possible and are marked as post-close corrections so the signed
 *    statement and the live log can both be true.
 *  - Money is integer cents everywhere. A purchase over $250 needs a note
 *    saying what it was for; the balance flagging "Low balance" under
 *    $100 is a text label, never color alone.
 *
 * Wording: "Individual/Individuals" only — never client/patient.
 */

import { monthKeyOf } from "./mileage";

/** Balance under this many cents is flagged "Low balance" in text. */
export const HOUSE_CARD_LOW_BALANCE_CENTS = 10_000; // $100.00

/** A purchase above this many cents must carry a note. */
export const HOUSE_CARD_NOTE_REQUIRED_OVER_CENTS = 25_000; // $250.00

/** Receipt photo payload cap, mirroring the QA dispute-photo guardrail. */
export const HOUSE_CARD_RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

export const HOUSE_CARD_LOCATION_MAX = 120;
export const HOUSE_CARD_NOTE_MAX = 500;
export const HOUSE_CARD_VOID_REASON_MAX = 500;
export const HOUSE_CARD_SIGNATURE_MAX = 100;

export const HOUSE_CARD_ENTRY_KINDS = ["credit", "purchase", "refund"] as const;
export type HouseCardEntryKind = (typeof HOUSE_CARD_ENTRY_KINDS)[number];

export const HOUSE_CARD_KIND_LABELS: Record<HouseCardEntryKind, string> = {
  credit: "Funds received",
  purchase: "Purchase",
  refund: "Refund",
};

export const HOUSE_CARD_CATEGORIES = [
  "groceries_household",
  "gas",
  "health_card",
  "food_stamps",
] as const;
export type HouseCardCategory = (typeof HOUSE_CARD_CATEGORIES)[number];

export const HOUSE_CARD_CATEGORY_LABELS: Record<HouseCardCategory, string> = {
  groceries_household: "Groceries & household",
  gas: "Gas",
  health_card: "Health card",
  food_stamps: "Food stamps",
};

/** Categories that are always one Individual's spending, never the home's. */
export const HOUSE_CARD_INDIVIDUAL_CATEGORIES: readonly HouseCardCategory[] = [
  "gas",
  "health_card",
  "food_stamps",
];

export function isHouseCardCategory(
  value: string,
): value is HouseCardCategory {
  return (HOUSE_CARD_CATEGORIES as readonly string[]).includes(value);
}

export function categoryNeedsIndividual(
  category: HouseCardCategory | null | undefined,
): boolean {
  return (
    category != null &&
    (HOUSE_CARD_INDIVIDUAL_CATEGORIES as readonly string[]).includes(category)
  );
}

export function houseCardCategoryLabel(category: string | null): string {
  if (!category) return "";
  return HOUSE_CARD_CATEGORY_LABELS[category as HouseCardCategory] ?? category;
}

/** A receipt photo attached to an entry (same shape as the QA photo input). */
export interface HouseCardReceiptPhoto {
  id: string;
  name: string;
  /** Data URL (both API layers store it the same way; size-capped). */
  dataUrl: string;
  capturedAt: string;
  capturedBy: string;
}

/** Stored house-card entry (local store shape; hosted maps snake_case to this). */
export interface HouseCardEntryRow {
  id: string;
  agencyId: string;
  siteId: string;
  /** Calendar date the money moved, YYYY-MM-DD (America/Chicago day). */
  entryDate: string;
  kind: HouseCardEntryKind;
  /** Where the money was spent or received from. Blank is allowed for credits. */
  location: string;
  /** Always a positive integer number of cents; the kind gives the sign. */
  amountCents: number;
  /** Purchases only; null for credits and refunds. */
  category: HouseCardCategory | null;
  /** Set exactly when the category is one Individual's (gas/health/food). */
  individualId: string | null;
  note: string;
  receiptPhoto: HouseCardReceiptPhoto | null;
  recordedBy: string;
  recordedByName: string;
  /** Role key of the recorder, stamped when the entry was written. */
  recordedByRole: string;
  createdAt: string;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** When this entry replaces a voided one, the voided entry's id. */
  replacesEntryId: string | null;
  /** When this entry was voided and replaced, the replacement's id. */
  replacedByEntryId: string | null;
}

/** An entry as the ledger displays it (names resolved, void state explicit). */
export interface HouseCardEntryView extends HouseCardEntryRow {
  individualName: string | null;
  voidedByName: string | null;
  voided: boolean;
  /**
   * True when this entry (or its void) was written after its month had
   * already been signed closed — the signed statement predates it.
   */
  postCloseCorrection: boolean;
}

/** The writable fields of an entry (create + replacement share this shape). */
export interface HouseCardEntryDraft {
  entryDate: string;
  kind: HouseCardEntryKind;
  location: string;
  amountCents: number;
  category?: HouseCardCategory | null;
  individualId?: string | null;
  note?: string;
  receiptPhoto?: HouseCardReceiptPhoto | null;
}

/** One signed month close for a home. */
export interface HouseCardMonthClose {
  id: string;
  agencyId: string;
  siteId: string;
  /** "YYYY-MM". */
  month: string;
  /** The closing balance (cents) as it stood when the month was signed. */
  closingBalanceCents: number;
  /** Printed name on the sign-off — always the closer's account name. */
  printedName: string;
  /** The closer's typed signature. */
  signatureText: string;
  signedBy: string;
  signedByName: string;
  signedAt: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Money formatting                                                    */
/* ------------------------------------------------------------------ */

/** "$1,234.56" — negative amounts render as "-$12.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateHouseCardDate(value: string, todayIso: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Choose the date of the entry.");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error("Enter the date as YYYY-MM-DD.");
  const parsed = new Date(`${text}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() + 1 !== Number(match[2]) ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("That is not a real calendar date.");
  }
  if (text > todayIso) {
    throw new Error("Entries cannot be dated in the future.");
  }
  return text;
}

export function validateHouseCardAmountCents(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error("Enter an amount greater than $0.00.");
  }
  return value;
}

export function validateHouseCardLocation(
  value: string | undefined | null,
  kind: HouseCardEntryKind,
): string {
  const text = (value ?? "").trim();
  if (text.length > HOUSE_CARD_LOCATION_MAX) {
    throw new Error(
      `Locations are limited to ${HOUSE_CARD_LOCATION_MAX} characters.`,
    );
  }
  if (kind !== "credit" && !text) {
    throw new Error(
      kind === "refund"
        ? "Say where the refund came from."
        : "Say where the purchase was made.",
    );
  }
  return text;
}

export function validateHouseCardNote(
  value: string | undefined | null,
  kind: HouseCardEntryKind,
  amountCents: number,
): string {
  const text = (value ?? "").trim();
  if (text.length > HOUSE_CARD_NOTE_MAX) {
    throw new Error(`Notes are limited to ${HOUSE_CARD_NOTE_MAX} characters.`);
  }
  if (
    kind === "purchase" &&
    amountCents > HOUSE_CARD_NOTE_REQUIRED_OVER_CENTS &&
    !text
  ) {
    throw new Error(
      `A purchase over ${formatCents(HOUSE_CARD_NOTE_REQUIRED_OVER_CENTS)} needs a note saying what it was for.`,
    );
  }
  return text;
}

export function validateHouseCardReceipt(
  value: HouseCardReceiptPhoto | null | undefined,
): HouseCardReceiptPhoto | null {
  if (!value) return null;
  if (
    typeof value.dataUrl !== "string" ||
    !value.dataUrl.startsWith("data:image/")
  ) {
    throw new Error("Attach the receipt as an image.");
  }
  if (value.dataUrl.length > HOUSE_CARD_RECEIPT_MAX_BYTES * 1.4) {
    throw new Error("That receipt photo is too large to attach.");
  }
  return value;
}

/** Validate a full draft the way both APIs do before writing a row. */
export function validateHouseCardDraft(
  draft: HouseCardEntryDraft,
  todayIso: string,
): {
  entryDate: string;
  kind: HouseCardEntryKind;
  location: string;
  amountCents: number;
  category: HouseCardCategory | null;
  individualId: string | null;
  note: string;
  receiptPhoto: HouseCardReceiptPhoto | null;
} {
  const kind = draft.kind;
  if (!(HOUSE_CARD_ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw new Error("Choose whether this is funds received, a purchase, or a refund.");
  }
  const entryDate = validateHouseCardDate(draft.entryDate, todayIso);
  const amountCents = validateHouseCardAmountCents(draft.amountCents);
  const location = validateHouseCardLocation(draft.location, kind);
  const note = validateHouseCardNote(draft.note, kind, amountCents);
  const receiptPhoto = validateHouseCardReceipt(draft.receiptPhoto);

  let category: HouseCardCategory | null = null;
  let individualId: string | null = null;
  if (kind === "purchase") {
    const rawCategory = (draft.category ?? "") as string;
    if (!isHouseCardCategory(rawCategory)) {
      throw new Error("Choose what the purchase was for.");
    }
    category = rawCategory;
    const rawIndividual = (draft.individualId ?? "").trim();
    if (categoryNeedsIndividual(category)) {
      if (!rawIndividual) {
        throw new Error(
          `Choose the Individual this ${houseCardCategoryLabel(category).toLowerCase()} spending belongs to.`,
        );
      }
      individualId = rawIndividual;
    } else if (rawIndividual) {
      throw new Error(
        "Groceries & household is the home's spending — it is not tied to one Individual.",
      );
    }
  } else {
    if (draft.category) {
      throw new Error("Only purchases carry a spending category.");
    }
    if ((draft.individualId ?? "").trim()) {
      throw new Error("Only purchases are tied to an Individual.");
    }
  }
  return {
    entryDate,
    kind,
    location,
    amountCents,
    category,
    individualId,
    note,
    receiptPhoto,
  };
}

export function validateHouseCardVoidReason(value: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Say why this entry is being voided.");
  if (text.length > HOUSE_CARD_VOID_REASON_MAX) {
    throw new Error(
      `Void reasons are limited to ${HOUSE_CARD_VOID_REASON_MAX} characters.`,
    );
  }
  return text;
}

export function validateHouseCardMonth(value: string): string {
  const text = (value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new Error("Choose the month to close.");
  }
  return text;
}

export function validateHouseCardSignature(value: string): string {
  const text = (value ?? "").trim();
  if (!text) throw new Error("Type your signature to close the month.");
  if (text.length > HOUSE_CARD_SIGNATURE_MAX) {
    throw new Error(
      `Signatures are limited to ${HOUSE_CARD_SIGNATURE_MAX} characters.`,
    );
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Ledger math — everything derives from the raw entries               */
/* ------------------------------------------------------------------ */

/** Signed effect of one entry on the house card balance, in cents. */
export function signedAmountCents(
  entry: Pick<HouseCardEntryRow, "kind" | "amountCents">,
): number {
  return entry.kind === "purchase" ? -entry.amountCents : entry.amountCents;
}

export function isVoided(entry: Pick<HouseCardEntryRow, "voidedAt">): boolean {
  return entry.voidedAt !== null;
}

/** The entries that count: same agency + site, not voided. */
export function effectiveEntries<T extends HouseCardEntryRow>(
  entries: T[],
): T[] {
  return entries.filter((entry) => !isVoided(entry));
}

/** Ledger order: by entry date, then by the order entries were recorded. */
export function compareHouseCardEntries(
  a: HouseCardEntryRow,
  b: HouseCardEntryRow,
): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Current balance of the card, from every counting entry ever recorded. */
export function computeBalanceCents(entries: HouseCardEntryRow[]): number {
  return effectiveEntries(entries).reduce(
    (sum, entry) => sum + signedAmountCents(entry),
    0,
  );
}

/** Balance once every counting entry dated on or before `throughDate` lands. */
export function balanceThroughCents(
  entries: HouseCardEntryRow[],
  throughDate: string,
): number {
  return effectiveEntries(entries)
    .filter((entry) => entry.entryDate <= throughDate)
    .reduce((sum, entry) => sum + signedAmountCents(entry), 0);
}

export function isLowBalance(balanceCents: number): boolean {
  return balanceCents < HOUSE_CARD_LOW_BALANCE_CENTS;
}

export interface HouseCardLedgerRow<T extends HouseCardEntryRow = HouseCardEntryRow> {
  entry: T;
  /**
   * Balance after this entry, in ledger order. Voided entries never move
   * the balance, so their row repeats the balance they sit next to.
   */
  runningBalanceCents: number;
}

/** The full chronological log with a running balance on every row. */
export function buildHouseCardLedger<T extends HouseCardEntryRow>(
  entries: T[],
): HouseCardLedgerRow<T>[] {
  let balance = 0;
  return [...entries].sort(compareHouseCardEntries).map((entry) => {
    if (!isVoided(entry)) balance += signedAmountCents(entry);
    return { entry, runningBalanceCents: balance };
  });
}

/* ------------------------------------------------------------------ */
/* Monthly summary                                                     */
/* ------------------------------------------------------------------ */

export interface HouseCardCategoryTotal {
  category: HouseCardCategory;
  label: string;
  totalCents: number;
}

export interface HouseCardIndividualTotal {
  individualId: string;
  name: string;
  totalCents: number;
  categoryTotals: HouseCardCategoryTotal[];
}

export interface HouseCardMonthSummary {
  month: string;
  /** Balance carried into the month (all counting entries before it). */
  openingBalanceCents: number;
  /** Balance at the end of the month. */
  closingBalanceCents: number;
  /** Funds credited onto the card during the month. */
  totalCreditedCents: number;
  /** Refunds received during the month. */
  totalRefundedCents: number;
  /** Total deposited = credits + refunds. */
  totalDepositedCents: number;
  /** Purchases during the month (positive cents). */
  totalSpentCents: number;
  /** Purchase totals per category, in canonical category order. */
  categoryTotals: HouseCardCategoryTotal[];
  /** Per-Individual purchase totals (attributed categories only). */
  individualTotals: HouseCardIndividualTotal[];
  /** Counting entries in the month. */
  entryCount: number;
  /** Voided entries dated in the month (visible, never counted). */
  voidedCount: number;
}

function blankCategoryTotals(): Map<HouseCardCategory, number> {
  return new Map(HOUSE_CARD_CATEGORIES.map((category) => [category, 0]));
}

function categoryTotalsList(
  totals: Map<HouseCardCategory, number>,
): HouseCardCategoryTotal[] {
  return HOUSE_CARD_CATEGORIES.map((category) => ({
    category,
    label: HOUSE_CARD_CATEGORY_LABELS[category],
    totalCents: totals.get(category) ?? 0,
  }));
}

/**
 * Everything the month view and the printed statement show, derived from
 * the raw entries of ONE home: opening balance carried from all earlier
 * counting entries, the month's money in and out, and totals by category
 * and by Individual. `individualNames` resolves attributed spending;
 * unknown ids fall back to "Former Individual" so history stays readable
 * after someone moves out.
 */
export function summarizeHouseCardMonth(
  entries: HouseCardEntryRow[],
  month: string,
  individualNames: Map<string, string>,
): HouseCardMonthSummary {
  const monthStart = `${month}-01`;
  let openingBalanceCents = 0;
  let totalCreditedCents = 0;
  let totalRefundedCents = 0;
  let totalSpentCents = 0;
  let entryCount = 0;
  let voidedCount = 0;
  const categoryTotals = blankCategoryTotals();
  const perIndividual = new Map<
    string,
    { total: number; categories: Map<HouseCardCategory, number> }
  >();

  for (const entry of entries) {
    const entryMonth = monthKeyOf(entry.entryDate);
    if (isVoided(entry)) {
      if (entryMonth === month) voidedCount += 1;
      continue;
    }
    if (entryMonth < month) {
      openingBalanceCents += signedAmountCents(entry);
      continue;
    }
    if (entryMonth > month) continue;
    entryCount += 1;
    if (entry.kind === "credit") totalCreditedCents += entry.amountCents;
    else if (entry.kind === "refund") totalRefundedCents += entry.amountCents;
    else {
      totalSpentCents += entry.amountCents;
      if (entry.category) {
        categoryTotals.set(
          entry.category,
          (categoryTotals.get(entry.category) ?? 0) + entry.amountCents,
        );
      }
      if (entry.individualId) {
        const bucket = perIndividual.get(entry.individualId) ?? {
          total: 0,
          categories: blankCategoryTotals(),
        };
        bucket.total += entry.amountCents;
        if (entry.category) {
          bucket.categories.set(
            entry.category,
            (bucket.categories.get(entry.category) ?? 0) + entry.amountCents,
          );
        }
        perIndividual.set(entry.individualId, bucket);
      }
    }
  }

  const individualTotals = [...perIndividual.entries()]
    .map(([individualId, bucket]) => ({
      individualId,
      name: individualNames.get(individualId) ?? "Former Individual",
      totalCents: bucket.total,
      categoryTotals: categoryTotalsList(bucket.categories).filter(
        (row) => row.totalCents > 0,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    month,
    openingBalanceCents,
    closingBalanceCents:
      openingBalanceCents +
      totalCreditedCents +
      totalRefundedCents -
      totalSpentCents,
    totalCreditedCents,
    totalRefundedCents,
    totalDepositedCents: totalCreditedCents + totalRefundedCents,
    totalSpentCents,
    categoryTotals: categoryTotalsList(categoryTotals),
    individualTotals,
    entryCount,
    voidedCount,
  };
}

/** The last day of a "YYYY-MM" month as an ISO date. */
export function monthEndIso(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0));
  return last.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Month closes                                                        */
/* ------------------------------------------------------------------ */

export function closeForMonth(
  closes: HouseCardMonthClose[],
  month: string,
): HouseCardMonthClose | null {
  return closes.find((close) => close.month === month) ?? null;
}

/**
 * Whether an entry (or its void) post-dates the signing of its month —
 * the marker that keeps a signed statement honest when corrections land
 * afterwards.
 */
export function isPostCloseCorrection(
  entry: Pick<HouseCardEntryRow, "entryDate" | "createdAt" | "voidedAt">,
  close: HouseCardMonthClose | null,
): boolean {
  if (!close) return false;
  if (monthKeyOf(entry.entryDate) !== close.month) return false;
  if (entry.createdAt > close.signedAt) return true;
  if (entry.voidedAt && entry.voidedAt > close.signedAt) return true;
  return false;
}

/** The message shown when a back-dated entry targets a closed month. */
export function closedMonthMessage(monthLabel: string): string {
  return (
    `${monthLabel} is closed and signed. New entries cannot be added to a ` +
    `closed month — record the entry in the current month, or void and ` +
    `replace an entry in the closed month as a post-close correction.`
  );
}

/* ------------------------------------------------------------------ */
/* Location suggestions                                                */
/* ------------------------------------------------------------------ */

/**
 * The home's recent locations, most recent first: what the entry form
 * suggests so "PHILLIPS 66" is typed once, not every day. Credits are
 * excluded (their "location" is a funding source, not a store).
 */
export function recentHouseCardLocations(
  entries: HouseCardEntryRow[],
  limit = 8,
): string[] {
  const seen = new Map<string, string>();
  const newestFirst = [...entries]
    .filter((entry) => !isVoided(entry) && entry.kind !== "credit")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const entry of newestFirst) {
    const label = entry.location.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** Build the display view of one row for one reader. */
export function toHouseCardEntryView(
  row: HouseCardEntryRow,
  individualName: string | null,
  nameFor: (userId: string) => string,
  close: HouseCardMonthClose | null,
): HouseCardEntryView {
  return {
    ...row,
    individualName,
    voidedByName: row.voidedBy ? nameFor(row.voidedBy) : null,
    voided: isVoided(row),
    postCloseCorrection: isPostCloseCorrection(row, close),
  };
}
