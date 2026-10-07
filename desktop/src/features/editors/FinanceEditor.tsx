/**
 * Create / edit dialog for an income or expense entry.
 *
 * The amount field accepts both "12.50" and "12,50" (Turkish keyboards type
 * a comma). Validation happens locally before the request so the user gets
 * instant feedback; the backend validates again.
 *
 * Paid vs. pending: an entry can be a settled transaction or a planned one
 * (a bill due on the 14th, a salary expected at month end). For new entries
 * the switch defaults to "pending" when the date is in the future and
 * "paid" otherwise, and follows date changes until the user flips it
 * manually.
 */

import { useState, type FormEvent } from "react";

import { api, type FinanceKind, type FinanceLog, type IsoDate } from "../../api";
import { ConfirmDeleteButton, Field, SegmentedControl } from "../../components/controls";
import { Modal } from "../../components/Modal";
import { useApiAction } from "../../hooks/useApi";
import { toIsoDate, today } from "../../lib/dates";
import { CATEGORY_SUGGESTIONS, KIND_LABELS } from "../../lib/labels";
import { parseAmountInput } from "../../lib/money";
import { usePreferences } from "../../state/preferences";

export interface FinanceEditorProps {
  /** Existing entry to edit; omit to create a new one. */
  log?: FinanceLog;
  /** Prefilled date for new entries. */
  defaultDate: IsoDate;
  /** Prefilled kind for new entries. */
  defaultKind?: FinanceKind;
  /** Prefilled paid state for new entries; omit to infer it from the date. */
  defaultPaid?: boolean;
  onClose: () => void;
}

/** Future-dated entries are usually plans, past/today ones already happened. */
function inferPaid(date: IsoDate): boolean {
  return date <= toIsoDate(today());
}

export function FinanceEditor({ log, defaultDate, defaultKind = "expense", defaultPaid, onClose }: FinanceEditorProps) {
  const run = useApiAction();
  const { preferences } = usePreferences();
  const isEdit = log !== undefined;

  const [kind, setKind] = useState<FinanceKind>(log?.kind ?? defaultKind);
  const [amountText, setAmountText] = useState(log ? log.amount.toFixed(2) : "");
  const [currency, setCurrency] = useState(log?.currency ?? preferences.defaultCurrency);
  const [category, setCategory] = useState(log?.category ?? "");
  const [description, setDescription] = useState(log?.description ?? "");
  const [occurredOn, setOccurredOn] = useState<IsoDate>(log?.occurred_on ?? defaultDate);
  const [isPaid, setIsPaid] = useState<boolean>(log?.is_paid ?? defaultPaid ?? inferPaid(defaultDate));
  /** Once the user picks paid/pending explicitly, date changes stop overriding it. */
  const [paidTouched, setPaidTouched] = useState(isEdit || defaultPaid !== undefined);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; category?: string; currency?: string }>({});

  const paidLabel = kind === "income" ? "Received" : "Paid";
  const pendingLabel = kind === "income" ? "Expected" : "Pending";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = parseAmountInput(amountText);
    const normalizedCurrency = currency.trim().toUpperCase();
    const trimmedCategory = category.trim();
    const nextErrors: typeof errors = {};
    if (amount === null) {
      nextErrors.amount = "Enter a positive amount with up to two decimals.";
    }
    if (trimmedCategory === "") {
      nextErrors.category = "Pick or type a category.";
    }
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      nextErrors.currency = "Use a 3-letter code like TRY or USD.";
    }
    setErrors(nextErrors);
    if (amount === null || Object.keys(nextErrors).length > 0 || !occurredOn) {
      return;
    }

    setSaving(true);
    const fields = {
      kind,
      amount,
      currency: normalizedCurrency,
      category: trimmedCategory,
      description: description.trim() === "" ? null : description.trim(),
      occurred_on: occurredOn,
      is_paid: isPaid,
    };
    const label = isPaid ? KIND_LABELS[kind] : `Planned ${KIND_LABELS[kind].toLowerCase()}`;
    const result = isEdit
      ? await run(() => api.finance.update(log.id, fields), { success: `${label} saved` })
      : await run(() => api.finance.create(fields), { success: `${label} recorded` });
    setSaving(false);
    if (result.ok) {
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!log) {
      return;
    }
    setSaving(true);
    const result = await run(() => api.finance.remove(log.id), { success: "Entry deleted" });
    setSaving(false);
    if (result.ok) {
      onClose();
    }
  };

  const listId = `category-suggestions-${kind}`;
  const titleNoun = KIND_LABELS[kind].toLowerCase();

  return (
    <Modal
      title={isEdit ? `Edit ${titleNoun}` : isPaid ? `New ${titleNoun}` : `Plan ${titleNoun}`}
      onClose={onClose}
      footer={
        <>
          {isEdit ? <ConfirmDeleteButton onConfirm={handleDelete} disabled={saving} /> : null}
          <span className="spacer" />
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="finance-editor-form" className="button button--primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <form id="finance-editor-form" className="form" onSubmit={handleSubmit}>
        <div className="form__row">
          <Field label="Type">
            <SegmentedControl
              label="Type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
            />
          </Field>
          <Field
            label="Status"
            hint={isPaid ? "Already settled." : "Planned: counts toward the month, shown as pending."}
          >
            <SegmentedControl
              label="Status"
              value={isPaid ? "paid" : "pending"}
              onChange={(value) => {
                setIsPaid(value === "paid");
                setPaidTouched(true);
              }}
              options={[
                { value: "paid", label: paidLabel },
                { value: "pending", label: pendingLabel },
              ]}
            />
          </Field>
        </div>

        <div className="form__row">
          <Field label="Amount" htmlFor="finance-amount" error={errors.amount}>
            <input
              id="finance-amount"
              className="input input--amount"
              inputMode="decimal"
              autoFocus
              placeholder="0.00"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
            />
          </Field>
          <Field label="Currency" htmlFor="finance-currency" error={errors.currency}>
            <input
              id="finance-currency"
              className="input input--currency"
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </Field>
        </div>

        <div className="form__row">
          <Field label="Category" htmlFor="finance-category" error={errors.category}>
            <input
              id="finance-category"
              className="input"
              list={listId}
              maxLength={60}
              placeholder="e.g. Credit card"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
            <datalist id={listId}>
              {CATEGORY_SUGGESTIONS[kind].map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </Field>
          <Field label={isPaid ? "Date" : "Due date"} htmlFor="finance-date">
            <input
              id="finance-date"
              type="date"
              className="input"
              required
              value={occurredOn}
              onChange={(event) => {
                const next = event.target.value;
                setOccurredOn(next);
                if (!paidTouched && next) {
                  setIsPaid(inferPaid(next));
                }
              }}
            />
          </Field>
        </div>

        <Field label="Note" htmlFor="finance-description">
          <textarea
            id="finance-description"
            className="input"
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
