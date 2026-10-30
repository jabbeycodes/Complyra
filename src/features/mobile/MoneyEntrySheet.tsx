import { useState } from "react";
import {
  Fuel,
  HeartPulse,
  ShoppingBasket,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type {
  HouseCardCategory,
  HouseCardReceiptPhoto,
} from "../../data/houseCard";
import type { MoneySheetValues } from "./money";

/**
 * The shared quick-entry sheet for both mobile money views — one
 * component, two ledgers. Built from the expense-tracker research
 * (2026-10-30): amount FIRST on a big keypad-friendly input, then a
 * stable category grid (or the spend's purpose), a location staff
 * simply type (no pick-lists — Joshua, 2026-10-30), and everything
 * else (date, note, receipt) behind
 * "More details" — log now in the fewest fields, code the rest later.
 * The receipt attaches on this same sheet and never blocks the save.
 *
 * The sheet only collects values; each ledger's view builds its own
 * draft and enforces its own rules at save (the APIs enforce them
 * again), so house-card and personal-spending semantics stay exactly
 * the ones shipped in #150/#152.
 */

export interface MoneySheetKindOption {
  value: string;
  label: string;
}

export interface MoneySheetCategoryOption {
  value: string;
  label: string;
  icon: LucideIcon;
}

export interface MoneySheetPersonOption {
  id: string;
  name: string;
}

/** Simple glyphs for the house-card category grid. */
export const HOUSE_CATEGORY_ICONS: Record<HouseCardCategory, LucideIcon> = {
  groceries_household: ShoppingBasket,
  gas: Fuel,
  health_card: HeartPulse,
  food_stamps: UtensilsCrossed,
};

export default function MoneyEntrySheet({
  title,
  kinds,
  detailKind,
  categories,
  purposeLabel,
  purposePlaceholder,
  locationLabelFor,
  locationPlaceholderFor,
  people,
  individualApplies,
  initial,
  userId,
  busy,
  error,
  saveText,
  onClose,
  onSave,
}: {
  title: string;
  kinds: MoneySheetKindOption[];
  /** The kind that carries a category grid / purpose (the spend kind). */
  detailKind: string;
  categories?: MoneySheetCategoryOption[];
  /** Personal spends: the purpose field's label (shown for detailKind). */
  purposeLabel?: string;
  purposePlaceholder?: string;
  locationLabelFor: (kind: string) => string;
  locationPlaceholderFor?: (kind: string) => string;
  /** House card: the home's Individuals (picker shows only on demand). */
  people?: MoneySheetPersonOption[];
  /** Whether the current values need the Individual picker. */
  individualApplies?: (values: MoneySheetValues) => boolean;
  initial: MoneySheetValues;
  userId: string;
  busy: boolean;
  error: string;
  saveText: string;
  onClose: () => void;
  onSave: (values: MoneySheetValues) => void;
}) {
  const [values, setValues] = useState<MoneySheetValues>(initial);
  const [moreOpen, setMoreOpen] = useState(false);

  const set = (patch: Partial<MoneySheetValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  const showDetail = values.kind === detailKind;
  const showIndividual = Boolean(
    people && individualApplies && individualApplies(values),
  );

  const onReceiptFile = (file: File | null) => {
    if (!file) {
      set({ receiptPhoto: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      set({
        receiptPhoto: {
          id: crypto.randomUUID(),
          name: file.name,
          dataUrl: String(reader.result ?? ""),
          capturedAt: new Date().toISOString(),
          capturedBy: userId,
        } satisfies HouseCardReceiptPhoto,
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <button
        type="button"
        className="msh-sheet-backdrop"
        aria-label="Close entry form"
        onClick={onClose}
      />
      <div className="msh-sheet mq-sheet" role="dialog" aria-label={title}>
        <h3 className="msh-sheet-title">{title}</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) onSave(values);
          }}
        >
          <div className="mq-kinds" role="group" aria-label="Entry type">
            {kinds.map((kind) => (
              <button
                key={kind.value}
                type="button"
                className={
                  values.kind === kind.value ? "mq-kind on" : "mq-kind"
                }
                aria-pressed={values.kind === kind.value}
                onClick={() => set({ kind: kind.value })}
              >
                {values.kind === kind.value ? "✓ " : ""}
                {kind.label}
              </button>
            ))}
          </div>

          <label className="mq-amount">
            <span className="mq-field-label">Amount</span>
            <span className="mq-amount-box">
              <span aria-hidden="true">$</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-label="Amount in dollars"
                placeholder="0.00"
                value={values.amountText}
                autoFocus
                onChange={(event) => set({ amountText: event.target.value })}
              />
            </span>
          </label>

          {showDetail && categories && (
            <div className="mq-block">
              <span className="mq-field-label">What was it for?</span>
              <div className="mq-cat-grid">
                {categories.map((category) => {
                  const Icon = category.icon;
                  const selected = values.category === category.value;
                  return (
                    <button
                      key={category.value}
                      type="button"
                      className={selected ? "mq-cat on" : "mq-cat"}
                      aria-pressed={selected}
                      onClick={() => set({ category: category.value })}
                    >
                      <Icon size={24} aria-hidden="true" />
                      <span>
                        {selected ? "✓ " : ""}
                        {category.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showDetail && purposeLabel && (
            <label className="msh-field">
              <span>{purposeLabel}</span>
              <input
                type="text"
                value={values.purpose}
                placeholder={purposePlaceholder}
                onChange={(event) => set({ purpose: event.target.value })}
              />
            </label>
          )}

          {showIndividual && people && (
            <div className="mq-block">
              <span className="mq-field-label">Individual</span>
              <div className="mq-chips">
                {people.map((person) => {
                  const selected = values.individualId === person.id;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      className={
                        selected ? "msh-chip-button mq-chip-on" : "msh-chip-button"
                      }
                      aria-pressed={selected}
                      onClick={() => set({ individualId: person.id })}
                    >
                      {selected ? "✓ " : ""}
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mq-block">
            <label className="msh-field">
              <span>{locationLabelFor(values.kind)}</span>
              <input
                type="text"
                value={values.location}
                placeholder={locationPlaceholderFor?.(values.kind)}
                onChange={(event) => set({ location: event.target.value })}
              />
            </label>
          </div>

          <button
            type="button"
            className="mq-more-toggle"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          >
            More details {moreOpen ? "▴" : "▾"}
          </button>
          {moreOpen && (
            <div className="mq-more">
              <label className="msh-field">
                <span>Date</span>
                <input
                  type="date"
                  value={values.entryDate}
                  onChange={(event) => set({ entryDate: event.target.value })}
                />
              </label>
              <label className="msh-field">
                <span>Note</span>
                <input
                  type="text"
                  value={values.note}
                  placeholder="Optional — required over $250 on the house card"
                  onChange={(event) => set({ note: event.target.value })}
                />
              </label>
              <label className="msh-field">
                <span>Receipt photo (optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    onReceiptFile(event.target.files?.[0] ?? null)
                  }
                />
                {values.receiptPhoto && (
                  <span className="mq-receipt-name">
                    Attached: {values.receiptPhoto.name}
                    <button
                      type="button"
                      className="mq-link"
                      onClick={() => set({ receiptPhoto: null })}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </label>
            </div>
          )}

          {error && (
            <p className="msh-alert" role="alert">
              {error}
            </p>
          )}
          <div className="msh-form-actions">
            <button
              type="button"
              className="msh-button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="msh-button primary" disabled={busy}>
              {busy ? "Saving…" : saveText}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
