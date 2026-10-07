/**
 * Monthly finance tab.
 *
 * Layout (top to bottom):
 *  1. Month navigation + add buttons.
 *  2. Summary cards: income, expense, net, savings rate.
 *  3. Daily net chart (click a bar → open that day in the calendar).
 *  4. Category breakdown for income and expenses, with proportional bars.
 *  5. Transaction table with an income/expense filter; click a row to edit.
 *
 * Two queries run in parallel: the server-side summary (exact totals) and
 * the raw entry list for the table.
 */

import { useState } from "react";

import { api, type CategoryBreakdown, type FinanceKind, type IsoDate } from "../../api";
import { ErrorNotice, SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useApiQuery } from "../../hooks/useApi";
import { addMonths, endOfMonth, formatMonthYear, formatShortDay, parseIsoDate, startOfMonth, toIsoDate, today } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";
import { DailyNetChart } from "./DailyNetChart";

interface FinanceViewProps {
  /** Initial month comes from the app's shared anchor date. */
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  /** Jump to the calendar with this day selected. */
  onOpenDay: (iso: IsoDate) => void;
}

type KindFilter = "all" | FinanceKind;

/** One column of the category breakdown (income or expense). */
function CategoryColumn({ title, rows, currency, kind }: { title: string; rows: CategoryBreakdown[]; currency: string; kind: FinanceKind }) {
  const max = Math.max(0, ...rows.map((row) => row.total));
  return (
    <section className="breakdown">
      <h3>{title}</h3>
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
              <div className="breakdown__track">
                <div
                  className={`breakdown__bar is-${kind}`}
                  style={{ width: `${max === 0 ? 0 : (row.total / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FinanceView({ anchor, onAnchorChange, onOpenDay }: FinanceViewProps) {
  const { preferences } = usePreferences();
  const { openFinance } = useEditors();
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const currency = preferences.defaultCurrency;

  const monthStart = startOfMonth(anchor);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth() + 1;
  const startIso = toIsoDate(monthStart);
  const endIso = toIsoDate(endOfMonth(anchor));
  const todayIso = toIsoDate(today());

  const summaryQuery = useApiQuery((signal) => api.finance.summary(year, month, signal), [year, month]);
  const entriesQuery = useApiQuery(
    (signal) => api.finance.list({ start: startIso, end: endIso }, signal),
    [startIso, endIso],
  );

  const summary = summaryQuery.data;
  const entries = (entriesQuery.data ?? [])
    .filter((entry) => kindFilter === "all" || entry.kind === kindFilter)
    // Newest first in the table (the API returns chronological order).
    .slice()
    .reverse();

  // Savings rate = net / income; undefined when there is no income.
  const savingsRate = summary && summary.income_total > 0 ? Math.round((summary.net / summary.income_total) * 100) : null;
  // New entries default to today when viewing the current month, otherwise the 1st.
  const defaultDate = todayIso >= startIso && todayIso <= endIso ? todayIso : startIso;

  const error = summaryQuery.error ?? entriesQuery.error;

  return (
    <div className="finance-view">
      <header className="toolbar">
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => onAnchorChange(today())}>
            This month
          </button>
          <div className="button-group">
            <button type="button" className="icon-button" onClick={() => onAnchorChange(addMonths(monthStart, -1))} aria-label="Previous month">
              <Icon name="chevronLeft" />
            </button>
            <button type="button" className="icon-button" onClick={() => onAnchorChange(addMonths(monthStart, 1))} aria-label="Next month">
              <Icon name="chevronRight" />
            </button>
          </div>
          <h1 className="toolbar__title">{formatMonthYear(monthStart)}</h1>
          <span className={summaryQuery.loading || entriesQuery.loading ? "sync-spinner is-active" : "sync-spinner"} aria-hidden="true" />
        </div>
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => openFinance({ date: defaultDate, kind: "income" })}>
            <Icon name="arrowUp" size={14} />
            Income
          </button>
          <button type="button" className="button button--primary" onClick={() => openFinance({ date: defaultDate, kind: "expense" })}>
            <Icon name="arrowDown" size={14} />
            Expense
          </button>
        </div>
      </header>

      {error ? (
        <ErrorNotice
          error={error}
          onRetry={() => {
            summaryQuery.reload();
            entriesQuery.reload();
          }}
        />
      ) : null}

      <div className="finance-scroll">
        <div className="summary-cards">
          <div className="summary-card">
            <span className="stat__label">Income</span>
            <strong className="is-positive">{summary ? formatMoney(summary.income_total, currency) : "—"}</strong>
          </div>
          <div className="summary-card">
            <span className="stat__label">Expenses</span>
            <strong className="is-negative">{summary ? formatMoney(summary.expense_total, currency) : "—"}</strong>
          </div>
          <div className="summary-card">
            <span className="stat__label">Net</span>
            <strong className={summary && summary.net < 0 ? "is-negative" : "is-positive"}>
              {summary ? formatMoney(summary.net, currency, { signed: true }) : "—"}
            </strong>
          </div>
          <div className="summary-card">
            <span className="stat__label">Savings rate</span>
            <strong>{savingsRate === null ? "—" : `${savingsRate}%`}</strong>
            <span className="summary-card__hint">{summary ? `${summary.entry_count} entries` : ""}</span>
          </div>
        </div>

        <section className="panel">
          <h2>Daily net</h2>
          {summary ? (
            <DailyNetChart daily={summary.daily} currency={currency} todayIso={todayIso} onSelectDay={onOpenDay} />
          ) : (
            <div className="chart chart--placeholder" />
          )}
        </section>

        <div className="breakdown-grid panel">
          <CategoryColumn
            title="Income by category"
            kind="income"
            currency={currency}
            rows={summary?.by_category.filter((row) => row.kind === "income") ?? []}
          />
          <CategoryColumn
            title="Expenses by category"
            kind="expense"
            currency={currency}
            rows={summary?.by_category.filter((row) => row.kind === "expense") ?? []}
          />
        </div>

        <section className="panel">
          <div className="panel__header">
            <h2>Transactions</h2>
            <SegmentedControl
              size="sm"
              label="Filter transactions"
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: "all", label: "All" },
                { value: "income", label: "Income" },
                { value: "expense", label: "Expenses" },
              ]}
            />
          </div>
          {entries.length === 0 ? (
            <p className="empty-text">{entriesQuery.data ? "No transactions this month." : "Loading…"}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Note</th>
                  <th className="table__num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} onClick={() => openFinance({ log: entry })} className="table__row--clickable">
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
                    <td>{entry.category}</td>
                    <td className="table__muted">{entry.description ?? ""}</td>
                    <td className={entry.kind === "income" ? "table__num is-positive" : "table__num is-negative"}>
                      {formatMoney(entry.kind === "income" ? entry.amount : -entry.amount, entry.currency, { signed: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
