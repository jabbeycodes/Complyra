/**
 * PERSONAL SPENDING — one Individual's own money, tracked on their chart.
 *
 * Every Individual in care has personal funds: money that arrives for
 * them (a monthly personal-funds deposit, family money) and money spent
 * on their behalf or with them. This module is the single source of the
 * ledger's rules; the LocalApi and HostedApi enforce them again at their
 * layers, and supabase/migrations/20261029130100_personal_spending.sql
 * backstops them in the database.
 *
 * This ledger is SEPARATE from the House Card (the home's petty cash):
 * different money, different home in the product (this lives on the
 * Individual's chart, the house card on the program site's tabs), and no
 * entry ever crosses between them. The shared spine — append-only
 * entries, void-and-replace corrections, derived balances, month close
 * with attestation, a stamped printed statement — follows the house
 * card's proven shape.
 *
 * Complyrer's own model (not a copy of any paper sheet):
 *  - One append-only log per Individual. An entry is a SPEND or a
 *    DEPOSIT. A spend always names where the money went AND its purpose
 *    — the purpose is the audit control: "what was this person's money
 *    used for" must always have an answer. A deposit names its source.
 *  - The balance is DERIVED from the entries and carries across months;
 *    it is never stored as an editable number.
 *  - OVER-BALANCE GUARDRAIL: a spend that takes the balance below $0
 *    still records (staff document reality, they do not rewrite it), but
 *    the entry is labeled "Over balance" in text — never color alone —
 *    and while its month is still open the ledger raises a
 *    needs-attention flag for the house manager.
 *  - Corrections never erase: a wrong entry is VOIDED with a reason and,
 *    when the money still moved, replaced by a fresh entry linked to
 *    the voided one. Voided entries stay visible (labeled Void) and
 *    never count toward any total.
 *  - A month is CLOSED by the house manager's attestation PLUS the
 *    second sign-off: the statement records either that the Individual
 *    signed it, or that the Individual was unable to sign and a second
 *    staff member signed in their place (named, with their signature).
 *    A closed month refuses new back-dated entries; void/replace
 *    corrections stay possible and are marked post-close corrections.
 *  - Money is integer cents everywhere.
 *
 * Wording: "Individual/Individuals" only — never client/patient.
 */

import { monthKeyOf } from "./mileage";
import {
  formatCents,
  monthEndIso,
  validateHouseCardAmountCents,
  validateHouseCardDate,
  validateHouseCardMonth,
  validateHouseCardReceipt,
  validateHouseCardSignature,
  validateHouseCardVoidReason,
  type HouseCardReceiptPhoto,
} from "./houseCard";

export { formatCents, monthEndIso };

export const PERSONAL_SPENDING_LOCATION_MAX = 120;
export const PERSONAL_SPENDING_PURPOSE_MAX = 200;
export const PERSONAL_SPENDING_NOTE_MAX = 500;

export const PERSONAL_SPENDING_ENTRY_KINDS = ["spend", "deposit"] as const;
export type PersonalSpendingEntryKind =
  (typeof PERSONAL_SPENDING_ENTRY_KINDS)[number];

export const PERSONAL_SPENDING_KIND_LABELS: Record<
  PersonalSpendingEntryKind,
  string
> = {
  spend: "Spent",
  deposit: "Funds received",
};

/** How the Individual's own sign-off on a closed month was captured. */
export const PERSONAL_SPENDING_SIGNOFFS = [
  "individual_signed",
  "unable_second_staff",
] as const;
export type PersonalSpendingSignoff =
  (typeof PERSONAL_SPENDING_SIGNOFFS)[number];

export const PERSONAL_SPENDING_SIGNOFF_LABELS: Record<
  PersonalSpendingSignoff,
  string
> = {
  individual_signed: "The Individual signed",
  unable_second_staff:
    "The Individual was unable to sign — a second staff member signed",
};

/** Receipt photo shape, identical to the house card's (same mechanism). */
export type PersonalSpendingReceiptPhoto = HouseCardReceiptPhoto;

/** Stored personal-spending entry (local store shape; hosted maps to it). */
export interface PersonalSpendingEntryRow {
  id: string;
  agencyId: string;
  /** The Individual's home — denormalized for site scoping and print. */
  siteId: string;
  individualId: string;
  /** Calendar date the money moved, YYYY-MM-DD (America/Chicago day). */
  entryDate: string;
  kind: PersonalSpendingEntryKind;
  /** Spends: where the money was spent. Deposits: where it came from. */
  location: string;
  /** Spends only: what the money was used for. Always blank on deposits. */
  purpose: string;
  /** Always a positive integer number of cents; the kind gives the sign. */
  amountCents: number;
  note: string;
  receiptPhoto: PersonalSpendingReceiptPhoto | null;
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

/** An entry as the ledger displays it (names resolved, states explicit). */
export interface PersonalSpendingEntryView extends PersonalSpendingEntryRow {
  voidedByName: string | null;
  voided: boolean;
  /** Balance after this entry, in ledger order (voided rows repeat it). */
  runningBalanceCents: number;
  /**
   * True when this spend took the person's balance below $0. A text
   * label on the row — the guardrail that surfaces the entry for the
   * house manager's review.
   */
  overBalance: boolean;
  /**
   * True when this entry (or its void) was written after its month had
   * already been signed closed — the signed statement predates it.
   */
  postCloseCorrection: boolean;
}

/** The writable fields of an entry (create + replacement share this). */
export interface PersonalSpendingEntryDraft {
  entryDate: string;
  kind: PersonalSpendingEntryKind;
  location: string;
  purpose?: string;
  amountCents: number;
  note?: string;
  receiptPhoto?: PersonalSpendingReceiptPhoto | null;
}

/** One signed month close for one Individual, with BOTH sign-offs. */
export interface PersonalSpendingMonthClose {
  id: string;
  agencyId: string;
  siteId: string;
  individualId: string;
  /** "YYYY-MM". */
  month: string;
  /** The person's balance (cents) as it stood when the month was signed. */
  closingBalanceCents: number;
  /** Printed name on the manager sign-off — always the closer's name. */
  printedName: string;
  /** The closer's (house manager's) typed signature. */
  signatureText: string;
  signedBy: string;
  signedByName: string;
  signedAt: string;
  createdAt: string;
  /** How the Individual's sign-off was captured at this close. */
  individualSignoff: PersonalSpendingSignoff;
  /** Set only when the Individual was unable to sign: who signed instead. */
  secondStaffId: string | null;
  secondStaffName: string | null;
  /** The second staff member's typed signature (unable case only). */
  secondStaffSignatureText: string | null;
}

/** The writable fields of a month close (the API resolves names). */
export interface PersonalSpendingCloseDraft {
  month: string;
  signatureText: string;
  individualSignoff: PersonalSpendingSignoff;
  secondStaffId?: string | null;
  secondStaffSignatureText?: string | null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validatePersonalSpendingLocation(
  value: string | undefined | null,
  kind: PersonalSpendingEntryKind,
): string {
  const text = (value ?? "").trim();
  if (text.length > PERSONAL_SPENDING_LOCATION_MAX) {
    throw new Error(
      `Locations are limited to ${PERSONAL_SPENDING_LOCATION_MAX} characters.`,
    );
  }
  if (kind === "spend" && !text) {
    throw new Error("Say where the money was spent.");
  }
  return text;
}

export function validatePersonalSpendingPurpose(
  value: string | undefined | null,
  kind: PersonalSpendingEntryKind,
): string {
  const text = (value ?? "").trim();
  if (text.length > PERSONAL_SPENDING_PURPOSE_MAX) {
    throw new Error(
      `The purpose is limited to ${PERSONAL_SPENDING_PURPOSE_MAX} characters.`,
    );
  }
  if (kind === "spend" && !text) {
    throw new Error("Say what this spend was for.");
  }
  if (kind === "deposit" && text) {
    throw new Error(
      "A purpose belongs on a spend. For funds received, name the source as the location instead.",
    );
  }
  return kind === "spend" ? text : "";
}

export function validatePersonalSpendingNote(
  value: string | undefined | null,
): string {
  const text = (value ?? "").trim();
  if (text.length > PERSONAL_SPENDING_NOTE_MAX) {
    throw new Error(
      `Notes are limited to ${PERSONAL_SPENDING_NOTE_MAX} characters.`,
    );
  }
  return text;
}

/** Validate a full entry draft the way both APIs do before writing. */
export function validatePersonalSpendingDraft(
  draft: PersonalSpendingEntryDraft,
  todayIso: string,
): {
  entryDate: string;
  kind: PersonalSpendingEntryKind;
  location: string;
  purpose: string;
  amountCents: number;
  note: string;
  receiptPhoto: PersonalSpendingReceiptPhoto | null;
} {
  const kind = draft.kind;
  if (!(PERSONAL_SPENDING_ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw new Error("Choose whether this is a spend or funds received.");
  }
  return {
    entryDate: validateHouseCardDate(draft.entryDate, todayIso),
    kind,
    location: validatePersonalSpendingLocation(draft.location, kind),
    purpose: validatePersonalSpendingPurpose(draft.purpose, kind),
    amountCents: validateHouseCardAmountCents(draft.amountCents),
    note: validatePersonalSpendingNote(draft.note),
    receiptPhoto: validateHouseCardReceipt(draft.receiptPhoto),
  };
}

/**
 * Validate a month-close draft. The dual sign-off is the control: a
 * close is rejected without the Individual's sign-off state, and the
 * unable case is rejected without a second staff member and their
 * signature. The second staff member's identity itself (an active
 * member of the agency, not the closer) is checked by the API layer,
 * which owns the roster.
 */
export function validatePersonalSpendingCloseDraft(
  draft: PersonalSpendingCloseDraft,
): {
  month: string;
  signatureText: string;
  individualSignoff: PersonalSpendingSignoff;
  secondStaffId: string | null;
  secondStaffSignatureText: string | null;
} {
  const month = validateHouseCardMonth(draft.month);
  const signatureText = validateHouseCardSignature(draft.signatureText);
  const individualSignoff = draft.individualSignoff;
  if (
    !(PERSONAL_SPENDING_SIGNOFFS as readonly string[]).includes(
      individualSignoff,
    )
  ) {
    throw new Error(
      "Record how the Individual's sign-off was handled before closing the month.",
    );
  }
  const secondStaffId = (draft.secondStaffId ?? "").trim() || null;
  const secondStaffSignatureText =
    (draft.secondStaffSignatureText ?? "").trim() || null;
  if (individualSignoff === "unable_second_staff") {
    if (!secondStaffId) {
      throw new Error(
        "Choose the second staff member who signed for the Individual.",
      );
    }
    if (!secondStaffSignatureText) {
      throw new Error(
        "The second staff member's signature is required when the Individual was unable to sign.",
      );
    }
    validateHouseCardSignature(secondStaffSignatureText);
  } else {
    if (secondStaffId || secondStaffSignatureText) {
      throw new Error(
        "A second staff member signs only when the Individual was unable to sign.",
      );
    }
  }
  return {
    month,
    signatureText,
    individualSignoff,
    secondStaffId: individualSignoff === "unable_second_staff" ? secondStaffId : null,
    secondStaffSignatureText:
      individualSignoff === "unable_second_staff"
        ? secondStaffSignatureText
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Ledger math — everything derives from the raw entries               */
/* ------------------------------------------------------------------ */

/** Signed effect of one entry on the person's balance, in cents. */
export function signedAmountCents(
  entry: Pick<PersonalSpendingEntryRow, "kind" | "amountCents">,
): number {
  return entry.kind === "spend" ? -entry.amountCents : entry.amountCents;
}

export function isVoided(
  entry: Pick<PersonalSpendingEntryRow, "voidedAt">,
): boolean {
  return entry.voidedAt !== null;
}

/** The entries that count: not voided. */
export function effectiveEntries<T extends PersonalSpendingEntryRow>(
  entries: T[],
): T[] {
  return entries.filter((entry) => !isVoided(entry));
}

/** Ledger order: by entry date, then by the order entries were recorded. */
export function comparePersonalSpendingEntries(
  a: PersonalSpendingEntryRow,
  b: PersonalSpendingEntryRow,
): number {
  if (a.entryDate !== b.entryDate) return a.entryDate < b.entryDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The person's current balance, from every counting entry ever recorded. */
export function computePersonalBalanceCents(
  entries: PersonalSpendingEntryRow[],
): number {
  return effectiveEntries(entries).reduce(
    (sum, entry) => sum + signedAmountCents(entry),
    0,
  );
}

/** Balance once every counting entry dated on or before `throughDate` lands. */
export function balanceThroughCents(
  entries: PersonalSpendingEntryRow[],
  throughDate: string,
): number {
  return effectiveEntries(entries)
    .filter((entry) => entry.entryDate <= throughDate)
    .reduce((sum, entry) => sum + signedAmountCents(entry), 0);
}

export interface PersonalSpendingLedgerRow<
  T extends PersonalSpendingEntryRow = PersonalSpendingEntryRow,
> {
  entry: T;
  /** Balance after this entry. Voided entries never move the balance. */
  runningBalanceCents: number;
  /** True when this spend took the running balance below $0. */
  overBalance: boolean;
}

/** The full chronological log with running balance + over-balance marks. */
export function buildPersonalSpendingLedger<
  T extends PersonalSpendingEntryRow,
>(entries: T[]): PersonalSpendingLedgerRow<T>[] {
  let balance = 0;
  return [...entries].sort(comparePersonalSpendingEntries).map((entry) => {
    let overBalance = false;
    if (!isVoided(entry)) {
      balance += signedAmountCents(entry);
      overBalance = entry.kind === "spend" && balance < 0;
    }
    return { entry, runningBalanceCents: balance, overBalance };
  });
}

/* ------------------------------------------------------------------ */
/* Monthly summary                                                     */
/* ------------------------------------------------------------------ */

export interface PersonalSpendingMonthSummary {
  month: string;
  /** Balance carried into the month (all counting entries before it). */
  openingBalanceCents: number;
  /** Balance at the end of the month. */
  closingBalanceCents: number;
  /** Funds received for the person during the month. */
  totalDepositedCents: number;
  /** Spends during the month (positive cents). */
  totalSpentCents: number;
  /** Counting entries in the month. */
  entryCount: number;
  /** Voided entries dated in the month (visible, never counted). */
  voidedCount: number;
  /** Counting spends in the month that took the balance below $0. */
  overBalanceCount: number;
}

/**
 * Everything the month view and the printed statement show, derived from
 * the raw entries of ONE Individual: the opening balance carried from
 * all earlier counting entries, the month's money in and out, and the
 * month's over-balance spends (which depend on the balance history, so
 * they are read off the full ledger, not just the month's rows).
 */
export function summarizePersonalSpendingMonth(
  entries: PersonalSpendingEntryRow[],
  month: string,
): PersonalSpendingMonthSummary {
  let openingBalanceCents = 0;
  let totalDepositedCents = 0;
  let totalSpentCents = 0;
  let entryCount = 0;
  let voidedCount = 0;

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
    if (entry.kind === "deposit") totalDepositedCents += entry.amountCents;
    else totalSpentCents += entry.amountCents;
  }

  const overBalanceCount = buildPersonalSpendingLedger(entries).filter(
    (row) =>
      row.overBalance && monthKeyOf(row.entry.entryDate) === month,
  ).length;

  return {
    month,
    openingBalanceCents,
    closingBalanceCents:
      openingBalanceCents + totalDepositedCents - totalSpentCents,
    totalDepositedCents,
    totalSpentCents,
    entryCount,
    voidedCount,
    overBalanceCount,
  };
}

/* ------------------------------------------------------------------ */
/* Month closes                                                        */
/* ------------------------------------------------------------------ */

export function closeForMonth(
  closes: PersonalSpendingMonthClose[],
  month: string,
): PersonalSpendingMonthClose | null {
  return closes.find((close) => close.month === month) ?? null;
}

/**
 * Whether an entry (or its void) post-dates the signing of its month —
 * the marker that keeps a signed statement honest when corrections land
 * afterwards.
 */
export function isPostCloseCorrection(
  entry: Pick<PersonalSpendingEntryRow, "entryDate" | "createdAt" | "voidedAt">,
  close: PersonalSpendingMonthClose | null,
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

/**
 * The house manager's needs-attention flag: an over-balance spend in a
 * month nobody has signed closed yet. Once the month is closed, the
 * signed statement itself carries the record.
 */
export function personalSpendingNeedsAttention(
  entries: PersonalSpendingEntryRow[],
  closes: PersonalSpendingMonthClose[],
): boolean {
  const closedMonths = new Set(closes.map((close) => close.month));
  return buildPersonalSpendingLedger(entries).some(
    (row) =>
      row.overBalance && !closedMonths.has(monthKeyOf(row.entry.entryDate)),
  );
}

/* ------------------------------------------------------------------ */
/* Location suggestions                                                */
/* ------------------------------------------------------------------ */

/**
 * Recent locations and sources, most recent first: what the entry form
 * suggests so a store (or a deposit source) is typed once, not daily.
 */
export function recentPersonalSpendingLocations(
  entries: PersonalSpendingEntryRow[],
  limit = 8,
): string[] {
  const seen = new Map<string, string>();
  const newestFirst = [...entries]
    .filter((entry) => !isVoided(entry))
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

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the display views of one person's whole ledger: running
 * balances and over-balance marks come from the full history, close
 * markers from the person's closes. Returned in ledger order.
 */
export function buildPersonalSpendingViews(
  entries: PersonalSpendingEntryRow[],
  closes: PersonalSpendingMonthClose[],
  nameFor: (userId: string) => string,
): PersonalSpendingEntryView[] {
  const closeByMonth = new Map(closes.map((close) => [close.month, close]));
  return buildPersonalSpendingLedger(entries).map(
    ({ entry, runningBalanceCents, overBalance }) => ({
      ...entry,
      voidedByName: entry.voidedBy ? nameFor(entry.voidedBy) : null,
      voided: isVoided(entry),
      runningBalanceCents,
      overBalance,
      postCloseCorrection: isPostCloseCorrection(
        entry,
        closeByMonth.get(monthKeyOf(entry.entryDate)) ?? null,
      ),
    }),
  );
}

/** Re-exported so API layers share the void/month/signature wording. */
export {
  validateHouseCardVoidReason as validatePersonalSpendingVoidReason,
  validateHouseCardMonth as validatePersonalSpendingMonth,
  validateHouseCardSignature as validatePersonalSpendingSignature,
};
