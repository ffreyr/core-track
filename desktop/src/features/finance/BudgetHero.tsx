/**
 * The finance tab's headline: "Remaining budget for the month".
 *
 *   remaining = expected income − paid expenses − pending expenses
 *
 * A single stacked bar shows where the month's income goes:
 *
 *   [■■■■ paid ■■■■][▨▨ pending ▨▨][░░░ remaining ░░░]
 *
 * When planned spending exceeds income the bar is scaled to total expenses
 * instead, a marker shows where income ends, and the headline turns red.
 */

import type { FinanceSummary } from "../../api";
import { formatMoney } from "../../lib/money";

interface BudgetHeroProps {
  summary: FinanceSummary;
  currency: string;
  monthLabel: string;
}

/** Percentage of `value` relative to `scale`, clamped to [0, 100]. */
function pct(value: number, scale: number): number {
  return scale <= 0 ? 0 : Math.min(100, Math.max(0, (value / scale) * 100));
}

export function BudgetHero({ summary, currency, monthLabel }: BudgetHeroProps) {
  const remaining = summary.remaining_budget;
  const overspent = remaining < 0;
  // Scale the bar to whichever is larger so every segment fits.
  const scale = Math.max(summary.income_total, summary.expense_total);
  const paidWidth = pct(summary.expense_paid, scale);
  const pendingWidth = pct(summary.expense_pending, scale);
  const remainingWidth = pct(Math.max(0, remaining), scale);
  const incomeMarker = overspent ? pct(summary.income_total, scale) : null;
  const spentShare = summary.income_total > 0 ? Math.round((summary.expense_total / summary.income_total) * 100) : null;

  return (
    <section className={overspent ? "budget-hero is-overspent" : "budget-hero"} aria-label="Remaining budget">
      <div className="budget-hero__main">
        <span className="budget-hero__label">Remaining budget for {monthLabel}</span>
        <strong className="budget-hero__value">{formatMoney(remaining, currency, { signed: overspent })}</strong>
        <p className="budget-hero__explain">
          {formatMoney(summary.income_total, currency)} expected income − {formatMoney(summary.expense_paid, currency)} paid −{" "}
          {formatMoney(summary.expense_pending, currency)} pending
        </p>
        {overspent ? (
          <p className="budget-hero__warning">
            Planned spending exceeds expected income by {formatMoney(-remaining, currency)}.
          </p>
        ) : null}
      </div>

      <div className="budget-hero__side">
        <span className="budget-hero__label">Cash moved so far</span>
        <strong className={summary.cash_balance >= 0 ? "is-positive" : "is-negative"}>
          {formatMoney(summary.cash_balance, currency, { signed: true })}
        </strong>
        <span className="budget-hero__hint">received − paid</span>
      </div>

      <div className="budget-bar" role="img" aria-label="Income allocation: paid, pending and remaining">
        <div className="budget-bar__track">
          <div className="budget-bar__segment is-paid" style={{ width: `${paidWidth}%` }} />
          <div className="budget-bar__segment is-pending" style={{ width: `${pendingWidth}%` }} />
          <div className="budget-bar__segment is-remaining" style={{ width: `${remainingWidth}%` }} />
          {incomeMarker !== null ? (
            <div className="budget-bar__marker" style={{ left: `${incomeMarker}%` }} title="Expected income" />
          ) : null}
        </div>
        <div className="budget-bar__legend">
          <span>
            <i className="legend-swatch is-paid" /> Paid {formatMoney(summary.expense_paid, currency)}
          </span>
          <span>
            <i className="legend-swatch is-pending" /> Pending {formatMoney(summary.expense_pending, currency)}
          </span>
          <span>
            <i className="legend-swatch is-remaining" /> Remaining {formatMoney(Math.max(0, remaining), currency)}
          </span>
          {spentShare !== null ? <span className="budget-bar__share">{spentShare}% of income committed</span> : null}
        </div>
      </div>
    </section>
  );
}
