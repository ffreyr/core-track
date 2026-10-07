/**
 * Finance tab: a forward-looking cash-flow projection for one month.
 *
 * Layout:
 *   ┌─ toolbar: month navigation · + Income · + Expense · + Planned payment ─┐
 *   │ Remaining budget hero (income − paid − pending) + allocation bar       │
 *   │ KPI cards: Expected income · Paid expenses · Pending · Savings rate    │
 *   ├───────────────────────────────────────────┬────────────────────────────┤
 *   │ Balance chart (actual vs projected)       │ Upcoming & pending list    │
 *   │ Cash-flow ledger (spreadsheet)            │ Expenses by category       │
 *   │                                           │ Income by category         │
 *   └───────────────────────────────────────────┴────────────────────────────┘
 *
 * Data: the server-side summary (exact totals, pending list, category split,
 * daily series) and the month's raw entries (for the ledger) load in
 * parallel. Every paid/pending toggle goes through `useApiAction`, which
 * invalidates both queries and the calendar.
 */

import { useState } from "react";

import { api, type FinanceLog, type IsoDate } from "../../api";
import { ErrorNotice, SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import { addMonths, endOfMonth, formatMonthYear, startOfMonth, toIsoDate, today } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";
import { BalanceChart } from "./BalanceChart";
import { BudgetHero } from "./BudgetHero";
import { CashFlowLedger, type LedgerFilter } from "./CashFlowLedger";
import { CategorySplit, PendingPayments } from "./FinanceSidePanels";

interface FinanceViewProps {
  /** The month shown comes from the app's shared anchor date. */
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  /** Jump to the calendar with this day selected. */
  onOpenDay: (iso: IsoDate) => void;
}

export function FinanceView({ anchor, onAnchorChange, onOpenDay }: FinanceViewProps) {
  const { preferences } = usePreferences();
  const { openFinance } = useEditors();
  const run = useApiAction();
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const currency = preferences.defaultCurrency;

  const monthStart = startOfMonth(anchor);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth() + 1;
  const startIso = toIsoDate(monthStart);
  const endIso = toIsoDate(endOfMonth(anchor));
  const todayIso = toIsoDate(today());
  const monthLabel = formatMonthYear(monthStart);

  const summaryQuery = useApiQuery((signal) => api.finance.summary(year, month, signal), [year, month]);
  const entriesQuery = useApiQuery(
    (signal) => api.finance.list({ start: startIso, end: endIso }, signal),
    [startIso, endIso],
  );
  const summary = summaryQuery.data;
  const error = summaryQuery.error ?? entriesQuery.error;

  // New entries default to today in the current month, otherwise the 1st.
  const defaultDate = todayIso >= startIso && todayIso <= endIso ? todayIso : startIso;

  const togglePaid = (log: FinanceLog) => {
    const done = log.kind === "income" ? "received" : "paid";
    void run(() => api.finance.togglePaid(log.id), {
      success: log.is_paid ? `${log.category} marked as pending` : `${log.category} marked as ${done}`,
    });
  };
  const editEntry = (log: FinanceLog) => openFinance({ log });

  const savingsRate = summary && summary.income_total > 0 ? Math.round((summary.net / summary.income_total) * 100) : null;
  const pendingExpenses = summary?.pending.filter((entry) => entry.kind === "expense") ?? [];
  const overdueCount = pendingExpenses.filter((entry) => entry.occurred_on < todayIso).length;

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
          <h1 className="toolbar__title">{monthLabel}</h1>
          <span className={summaryQuery.loading || entriesQuery.loading ? "sync-spinner is-active" : "sync-spinner"} aria-hidden="true" />
        </div>
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => openFinance({ date: defaultDate, kind: "income" })}>
            <Icon name="arrowUp" size={14} />
            Income
          </button>
          <button type="button" className="button" onClick={() => openFinance({ date: defaultDate, kind: "expense" })}>
            <Icon name="arrowDown" size={14} />
            Expense
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => openFinance({ date: defaultDate, kind: "expense", paid: false })}
            title="Plan a future payment, e.g. a credit card due date"
          >
            <Icon name="plus" size={14} />
            Planned payment
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
        {summary ? (
          <BudgetHero summary={summary} currency={currency} monthLabel={monthLabel} />
        ) : (
          <div className="budget-hero budget-hero--placeholder" />
        )}

        <div className="summary-cards">
          <div className="summary-card">
            <span className="stat__label">Expected income</span>
            <strong className="is-positive">{summary ? formatMoney(summary.income_total, currency) : "—"}</strong>
            <span className="summary-card__hint">
              {summary
                ? `${formatMoney(summary.income_received, currency)} received · ${formatMoney(summary.income_pending, currency)} expected`
                : ""}
            </span>
          </div>
          <div className="summary-card">
            <span className="stat__label">Paid expenses</span>
            <strong className="is-negative">{summary ? formatMoney(summary.expense_paid, currency) : "—"}</strong>
            <span className="summary-card__hint">already left your account</span>
          </div>
          <div className="summary-card summary-card--pending">
            <span className="stat__label">Pending expenses</span>
            <strong className="is-pending">{summary ? formatMoney(summary.expense_pending, currency) : "—"}</strong>
            <span className="summary-card__hint">
              {pendingExpenses.length} to pay{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
            </span>
          </div>
          <div className="summary-card">
            <span className="stat__label">Savings rate</span>
            <strong>{savingsRate === null ? "—" : `${savingsRate}%`}</strong>
            <span className="summary-card__hint">{summary ? `${summary.entry_count} entries this month` : ""}</span>
          </div>
        </div>

        <div className="finance-columns">
          <div className="finance-columns__main">
            <section className="panel">
              <h2>Balance through the month</h2>
              {summary ? (
                <BalanceChart daily={summary.daily} currency={currency} todayIso={todayIso} onSelectDay={onOpenDay} />
              ) : (
                <div className="balance-chart balance-chart--placeholder" />
              )}
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Cash-flow ledger</h2>
                <SegmentedControl
                  size="sm"
                  label="Filter ledger"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "pending", label: "Pending" },
                    { value: "paid", label: "Paid" },
                  ]}
                />
              </div>
              <CashFlowLedger
                entries={entriesQuery.data ?? []}
                filter={filter}
                currency={currency}
                todayIso={todayIso}
                loaded={entriesQuery.data !== undefined}
                onTogglePaid={togglePaid}
                onEdit={editEntry}
                onOpenDay={onOpenDay}
              />
            </section>
          </div>

          <div className="finance-columns__side">
            <PendingPayments
              pending={summary?.pending ?? []}
              todayIso={todayIso}
              loaded={summary !== undefined}
              onTogglePaid={togglePaid}
              onEdit={editEntry}
            />
            <CategorySplit
              title="Expenses by category"
              kind="expense"
              currency={currency}
              rows={summary?.by_category.filter((row) => row.kind === "expense") ?? []}
            />
            <CategorySplit
              title="Income by category"
              kind="income"
              currency={currency}
              rows={summary?.by_category.filter((row) => row.kind === "income") ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
