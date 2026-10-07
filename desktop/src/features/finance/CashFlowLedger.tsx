/**
 * Cash-flow ledger: the month as a spreadsheet.
 *
 * Columns: Date · Item · Status · In · Out · Balance.
 *
 * - Rows are in chronological order (the way a projection sheet reads).
 * - "Balance" is the running projected balance including pending entries,
 *   always computed over the *whole* month so it stays correct when a
 *   status filter hides some rows.
 * - A "Today" divider separates what has happened from what is planned.
 * - Unpaid entries dated before today are flagged "Overdue".
 * - The status checkbox marks an entry paid/received (or back to pending)
 *   in one click; clicking elsewhere on a row opens the editor; clicking the
 *   date opens that day in the calendar.
 */

import { Fragment } from "react";

import type { FinanceLog, IsoDate } from "../../api";
import { formatShortDay, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

export type LedgerFilter = "all" | "pending" | "paid";

interface CashFlowLedgerProps {
  entries: FinanceLog[];
  filter: LedgerFilter;
  currency: string;
  todayIso: IsoDate;
  loaded: boolean;
  onTogglePaid: (log: FinanceLog) => void;
  onEdit: (log: FinanceLog) => void;
  onOpenDay: (iso: IsoDate) => void;
}

export function CashFlowLedger({
  entries,
  filter,
  currency,
  todayIso,
  loaded,
  onTogglePaid,
  onEdit,
  onOpenDay,
}: CashFlowLedgerProps) {
  const ordered = [...entries].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id - b.id);

  // Running projected balance per entry, over every entry of the month.
  const balances = new Map<number, number>();
  let runningCents = 0;
  for (const entry of ordered) {
    runningCents += Math.round(entry.amount * 100) * (entry.kind === "income" ? 1 : -1);
    balances.set(entry.id, runningCents / 100);
  }

  const rows = ordered.filter((entry) => filter === "all" || (filter === "pending" ? !entry.is_paid : entry.is_paid));
  // The divider goes before the first row dated after today (if any row precedes it).
  const firstFutureIndex = rows.findIndex((entry) => entry.occurred_on > todayIso);
  const showTodayDivider = firstFutureIndex > 0;

  if (rows.length === 0) {
    return (
      <p className="empty-text">
        {!loaded ? "Loading…" : filter === "pending" ? "Nothing pending this month." : "No transactions this month."}
      </p>
    );
  }

  return (
    <table className="table ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th>Item</th>
          <th>Status</th>
          <th className="table__num">In</th>
          <th className="table__num">Out</th>
          <th className="table__num">Balance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry, index) => {
          const overdue = !entry.is_paid && entry.occurred_on < todayIso;
          const balance = balances.get(entry.id) ?? 0;
          const statusLabel = entry.is_paid
            ? entry.kind === "income"
              ? "Received"
              : "Paid"
            : entry.kind === "income"
              ? "Expected"
              : "Pending";
          return (
            <Fragment key={entry.id}>
              {showTodayDivider && index === firstFutureIndex ? (
                <tr className="ledger__today">
                  <td colSpan={6}>
                    <span>Today</span>
                  </td>
                </tr>
              ) : null}
              <tr
                className={[
                  "table__row--clickable",
                  entry.is_paid ? "" : "is-pending",
                  overdue ? "is-overdue" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onEdit(entry)}
              >
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(entry.occurred_on);
                    }}
                    title="Open in calendar"
                  >
                    {formatShortDay(parseIsoDate(entry.occurred_on))}
                  </button>
                </td>
                <td>
                  <span className="ledger__category">{entry.category}</span>
                  {entry.description ? <span className="ledger__note">{entry.description}</span> : null}
                </td>
                <td onClick={(event) => event.stopPropagation()}>
                  <label className={entry.is_paid ? "status-toggle is-paid" : "status-toggle"}>
                    <input
                      type="checkbox"
                      checked={entry.is_paid}
                      onChange={() => onTogglePaid(entry)}
                      aria-label={entry.is_paid ? `Mark ${entry.category} as pending` : `Mark ${entry.category} as paid`}
                    />
                    {statusLabel}
                    {overdue ? <span className="badge badge--danger">Overdue</span> : null}
                  </label>
                </td>
                <td className="table__num is-positive">
                  {entry.kind === "income" ? formatMoney(entry.amount, entry.currency) : ""}
                </td>
                <td className="table__num is-negative">
                  {entry.kind === "expense" ? formatMoney(entry.amount, entry.currency) : ""}
                </td>
                <td className={balance >= 0 ? "table__num" : "table__num is-negative"}>
                  {formatMoney(balance, currency, { signed: balance < 0 })}
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
