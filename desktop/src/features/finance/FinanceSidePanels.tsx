/**
 * Right-hand column of the finance tab.
 *
 *  - {@link PendingPayments}: the month's unpaid entries as a checklist,
 *    with "due in N days" / "N days overdue" labels and one-click "paid".
 *  - {@link CategorySplit}: spending and income per category, each bar split
 *    into a solid paid part and a striped pending part.
 */

import type { CategoryBreakdown, FinanceKind, FinanceLog, IsoDate } from "../../api";
import { diffInDays, formatShortDay, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

// ---------------------------------------------------------------------------
// Pending payments
// ---------------------------------------------------------------------------

/** "today", "in 3 days", "2 days overdue" relative to today. */
function dueLabel(iso: IsoDate, todayIso: IsoDate): { text: string; overdue: boolean } {
  const days = diffInDays(parseIsoDate(todayIso), parseIsoDate(iso));
  if (days === 0) {
    return { text: "due today", overdue: false };
  }
  if (days > 0) {
    return { text: days === 1 ? "due tomorrow" : `due in ${days} days`, overdue: false };
  }
  return { text: days === -1 ? "1 day overdue" : `${-days} days overdue`, overdue: true };
}

interface PendingPaymentsProps {
  pending: FinanceLog[];
  todayIso: IsoDate;
  loaded: boolean;
  onTogglePaid: (log: FinanceLog) => void;
  onEdit: (log: FinanceLog) => void;
}

export function PendingPayments({ pending, todayIso, loaded, onTogglePaid, onEdit }: PendingPaymentsProps) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Upcoming &amp; pending</h2>
        <span className="panel__count">{pending.length}</span>
      </div>
      {pending.length === 0 ? (
        <p className="empty-text">{loaded ? "Everything this month is settled." : "Loading…"}</p>
      ) : (
        <ul className="item-list">
          {pending.map((entry) => {
            const due = dueLabel(entry.occurred_on, todayIso);
            return (
              <li key={entry.id} className={due.overdue ? "item-row is-overdue" : "item-row"}>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => onTogglePaid(entry)}
                  aria-label={`Mark ${entry.category} as ${entry.kind === "income" ? "received" : "paid"}`}
                  title={entry.kind === "income" ? "Mark as received" : "Mark as paid"}
                />
                <button type="button" className="item-row__main" onClick={() => onEdit(entry)}>
                  <span className="item-row__title">{entry.category}</span>
                  <span className={due.overdue ? "item-row__meta is-negative" : "item-row__meta"}>
                    {formatShortDay(parseIsoDate(entry.occurred_on))} · {due.text}
                    {entry.description ? ` · ${entry.description}` : ""}
                  </span>
                </button>
                <span className={entry.kind === "income" ? "item-row__amount is-positive" : "item-row__amount is-negative"}>
                  {formatMoney(entry.kind === "income" ? entry.amount : -entry.amount, entry.currency, { signed: true })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Category split
// ---------------------------------------------------------------------------

interface CategorySplitProps {
  title: string;
  kind: FinanceKind;
  rows: CategoryBreakdown[];
  currency: string;
}

export function CategorySplit({ title, kind, rows, currency }: CategorySplitProps) {
  const max = Math.max(0, ...rows.map((row) => row.total));
  return (
    <section className="panel breakdown">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="empty-text">Nothing recorded.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.category} className="breakdown__row">
              <div className="breakdown__label">
                <span>{row.category}</span>
                <span className="breakdown__count">{row.count}×</span>
                <strong>{formatMoney(row.total, currency)}</strong>
              </div>
              <div
                className="breakdown__track"
                title={`Paid ${formatMoney(row.paid_total, currency)} · Pending ${formatMoney(row.pending_total, currency)}`}
              >
                <div
                  className={`breakdown__bar is-${kind}`}
                  style={{ width: `${max === 0 ? 0 : (row.paid_total / max) * 100}%` }}
                />
                <div
                  className={`breakdown__bar is-${kind} is-pending`}
                  style={{ width: `${max === 0 ? 0 : (row.pending_total / max) * 100}%` }}
                />
              </div>
              {row.pending_total > 0 ? (
                <span className="breakdown__pending">{formatMoney(row.pending_total, currency)} pending</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
