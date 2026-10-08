/**
 * Cash-flow projection sheet: the Finance tab's Excel-style matrix.
 *
 *   │            October 2026             │            November 2026            │ …
 *   │  Income · Gelir  │ Expense · Gider  │  Income · Gelir  │ Expense · Gider  │
 *   ├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
 *   │ ☑ 1 Salary   45k │ ☑ 1 Rent     15k │ ☐ 1 Salary   45k │ ☐ 1 Rent     15k │  item rows
 *   │                  │ ☐ 14 Card   3.2k │                  │                  │
 *   │ + Add income     │ + Add expense    │ + Add income     │ + Add expense    │  add row
 *   ╞══════════════════╪══════════════════╪══════════════════╪══════════════════╡
 *   │ Total income 45k │ Total exp.  18k  │ …                                       summary rows
 *   │ Expected      —  │ To be paid  3.7k │      (labels live inside the cells)
 *   │ Remaining for the month · Bütün ay… │
 *   │              ₺26,300             │   (spans both sub-columns)
 *
 * Layout mechanics:
 *  - One `<table>` with `border-collapse: separate`, so sticky cells keep
 *    their borders: the two header rows stick to the top and the three
 *    summary rows stick to the bottom of the scroll area.
 *  - There is no separate label column: each summary cell carries its own
 *    label next to its value, so every month column is self-explanatory
 *    wherever the sheet is scrolled horizontally.
 *  - Item rows are positional, as in a spreadsheet: row i shows each
 *    month's i-th income and i-th expense entry (chronological). The number
 *    of rows is the longest list in the window.
 *  - Totals come from the server summaries (exact integer-cent sums), not
 *    from adding up cells in the browser.
 *
 * Interactions: the checkbox marks an item paid/received (or back to
 * pending); clicking an item opens its editor; clicking its day number
 * opens that day in the calendar; double-clicking an empty cell or using a
 * "+ Add" cell creates an entry in that month and column.
 */

import type { MouseEvent, ReactNode } from "react";

import type { FinanceKind, FinanceLog, IsoDate } from "../../api";
import type { FinanceMonth } from "../../hooks/useFinanceWindow";
import { formatMonthYear, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

interface CashFlowSheetProps {
  months: FinanceMonth[];
  currency: string;
  todayIso: IsoDate;
  /** Dim while a new window is loading. */
  stale: boolean;
  onTogglePaid: (log: FinanceLog) => void;
  onEdit: (log: FinanceLog) => void;
  onAdd: (month: FinanceMonth, kind: FinanceKind) => void;
  onOpenDay: (iso: IsoDate) => void;
}

/** Bilingual column/row labels (English · Turkish), as on the original sheet. */
const LABELS = {
  income: { en: "Income", tr: "Gelir" },
  expense: { en: "Expense", tr: "Gider" },
  totalIncome: { en: "Total income", tr: "Toplam gelir" },
  totalExpense: { en: "Total expenses", tr: "Toplam gider" },
  expected: { en: "Expected", tr: "Beklenen" },
  pending: { en: "To be paid", tr: "Ödenecek" },
  remaining: { en: "Remaining for the month", tr: "Bütün ay kapsamında kalacak para" },
} as const;

const stop = (event: MouseEvent) => event.stopPropagation();

/** Inline "Label · Etiket" pair used inside summary cells. */
function SumLabel({ en, tr }: { en: string; tr: string }) {
  return (
    <span className="sheet-sum__label" title={`${en} · ${tr}`}>
      {en} <span className="sheet__tr">· {tr}</span>
    </span>
  );
}

/** A summary cell: its label on the left, its value right-aligned. */
function SumCell({ className, label, value, title }: { className: string; label: ReactNode; value: ReactNode; title?: string }) {
  return (
    <td className={className} title={title}>
      <div className="sheet-sum__inner">
        {label}
        <span className="sheet-sum__value">{value}</span>
      </div>
    </td>
  );
}

/** One filled item cell: paid checkbox, day, name and amount. */
function ItemCell({
  log,
  kind,
  todayIso,
  onTogglePaid,
  onEdit,
  onOpenDay,
}: {
  log: FinanceLog;
  kind: FinanceKind;
  todayIso: IsoDate;
  onTogglePaid: (log: FinanceLog) => void;
  onEdit: (log: FinanceLog) => void;
  onOpenDay: (iso: IsoDate) => void;
}) {
  const overdue = !log.is_paid && log.occurred_on < todayIso;
  const doneWord = kind === "income" ? "received" : "paid";
  const status = log.is_paid ? doneWord : overdue ? "overdue" : kind === "income" ? "expected" : "pending";
  const className = [
    "sheet-cell",
    `sheet-cell--${kind}`,
    log.is_paid ? "is-paid" : "is-pending",
    overdue ? "is-overdue" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <td
      className={className}
      onClick={() => onEdit(log)}
      title={`${log.category}${log.description ? ` — ${log.description}` : ""} (${status})`}
    >
      <div className="sheet-item">
        <input
          type="checkbox"
          className="sheet-item__check"
          checked={log.is_paid}
          onClick={stop}
          onChange={() => onTogglePaid(log)}
          aria-label={log.is_paid ? `Mark ${log.category} as pending` : `Mark ${log.category} as ${doneWord}`}
        />
        <button
          type="button"
          className="sheet-item__day"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDay(log.occurred_on);
          }}
          title="Open this day in the calendar"
        >
          {parseIsoDate(log.occurred_on).getDate()}
        </button>
        <span className="sheet-item__name">
          {log.category}
          {log.description ? <span className="sheet-item__note">{log.description}</span> : null}
        </span>
        <span className="sheet-item__amount">{formatMoney(log.amount, log.currency)}</span>
      </div>
    </td>
  );
}

export function CashFlowSheet({
  months,
  currency,
  todayIso,
  stale,
  onTogglePaid,
  onEdit,
  onAdd,
  onOpenDay,
}: CashFlowSheetProps) {
  const currentMonthKey = todayIso.slice(0, 7);
  // Spreadsheet height = the longest income or expense list in the window (≥ 1 row).
  const rowCount = Math.max(1, ...months.flatMap((month) => [month.income.length, month.expense.length]));
  const rowIndexes = Array.from({ length: rowCount }, (_, index) => index);

  /** Cell for item `index` of one month/kind: filled or empty. */
  const renderCell = (month: FinanceMonth, kind: FinanceKind, index: number) => {
    const log = month[kind][index];
    if (log) {
      return (
        <ItemCell
          key={`${month.key}-${kind}-${log.id}`}
          log={log}
          kind={kind}
          todayIso={todayIso}
          onTogglePaid={onTogglePaid}
          onEdit={onEdit}
          onOpenDay={onOpenDay}
        />
      );
    }
    return (
      <td
        key={`${month.key}-${kind}-empty-${index}`}
        className={`sheet-cell sheet-cell--${kind} is-empty`}
        onDoubleClick={() => onAdd(month, kind)}
        title={`Double-click to add ${kind === "income" ? "income" : "an expense"}`}
      />
    );
  };

  return (
    <div className={stale ? "sheet-scroll is-stale" : "sheet-scroll"}>
      <table className="sheet" aria-label="Cash-flow projection by month">
        <colgroup>
          {months.map((month) => (
            <col key={`${month.key}-cols`} span={2} className="sheet__month-col" />
          ))}
        </colgroup>

        <thead>
          {/* Month headers, each spanning its Income + Expense sub-columns. */}
          <tr className="sheet__month-row">
            {months.map((month) => (
              <th
                key={month.key}
                colSpan={2}
                scope="colgroup"
                className={month.key === currentMonthKey ? "sheet__month is-current" : "sheet__month"}
              >
                {formatMonthYear(month.start)}
                {month.key === currentMonthKey ? <span className="sheet__badge">This month</span> : null}
              </th>
            ))}
          </tr>
          {/* Income / Expense sub-headers. */}
          <tr className="sheet__kind-row">
            {months.map((month) =>
              (["income", "expense"] as const).map((kind) => (
                <th key={`${month.key}-${kind}`} scope="col" className={`sheet__kind sheet__kind--${kind}`}>
                  {LABELS[kind].en} <span className="sheet__tr">· {LABELS[kind].tr}</span>
                </th>
              )),
            )}
          </tr>
        </thead>

        <tbody>
          {rowIndexes.map((index) => (
            <tr key={`row-${index}`}>
              {months.map((month) => [renderCell(month, "income", index), renderCell(month, "expense", index)])}
            </tr>
          ))}
          {/* Add row: one "+ Add" button per sub-column. */}
          <tr className="sheet__add-row">
            {months.map((month) =>
              (["income", "expense"] as const).map((kind) => (
                <td key={`${month.key}-${kind}-add`} className={`sheet-cell sheet-cell--${kind} sheet-cell--add`}>
                  <button type="button" className="sheet__add" onClick={() => onAdd(month, kind)}>
                    + Add {kind === "income" ? "income" : "expense"}
                  </button>
                </td>
              )),
            )}
          </tr>
        </tbody>

        {/* Excel-style summary block, pinned to the bottom of the viewport. */}
        <tfoot>
          <tr className="sheet__sum-row sheet__sum-row--total">
            {months.map((month) => [
              <SumCell
                key={`${month.key}-ti`}
                className="sheet-sum sheet-sum--income"
                label={<SumLabel {...LABELS.totalIncome} />}
                value={formatMoney(month.summary.income_total, currency)}
              />,
              <SumCell
                key={`${month.key}-te`}
                className="sheet-sum sheet-sum--expense"
                label={<SumLabel {...LABELS.totalExpense} />}
                value={formatMoney(month.summary.expense_total, currency)}
              />,
            ])}
          </tr>

          <tr className="sheet__sum-row sheet__sum-row--pending">
            {months.map((month) => [
              <SumCell
                key={`${month.key}-pi`}
                className="sheet-sum sheet-sum--income sheet-sum--muted"
                title="Income still expected this month"
                label={<SumLabel {...LABELS.expected} />}
                value={month.summary.income_pending > 0 ? formatMoney(month.summary.income_pending, currency) : "—"}
              />,
              <SumCell
                key={`${month.key}-pe`}
                className={month.summary.expense_pending > 0 ? "sheet-sum sheet-sum--pending" : "sheet-sum sheet-sum--muted"}
                title="Planned expenses not yet paid this month"
                label={<SumLabel {...LABELS.pending} />}
                value={formatMoney(month.summary.expense_pending, currency)}
              />,
            ])}
          </tr>

          <tr className="sheet__sum-row sheet__sum-row--remaining">
            {months.map((month) => {
              const remaining = month.summary.remaining_budget;
              return (
                <td
                  key={`${month.key}-rem`}
                  colSpan={2}
                  className={remaining < 0 ? "sheet-remaining is-negative" : "sheet-remaining"}
                  title="Income − paid expenses − pending expenses"
                >
                  <span className="sheet-remaining__label">
                    {LABELS.remaining.en} <span className="sheet__tr">· {LABELS.remaining.tr}</span>
                  </span>
                  <span className="sheet-remaining__value">
                    {formatMoney(remaining, currency, { signed: remaining < 0 })}
                  </span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
