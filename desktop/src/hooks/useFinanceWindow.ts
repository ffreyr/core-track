/**
 * Data for the multi-month cash-flow sheet.
 *
 * Loads a rolling window of consecutive months in one go:
 *
 *   - one `GET /api/finance/summary` per month (in parallel) — exact,
 *     server-computed totals: income, paid/pending expenses, remaining budget;
 *   - one `GET /api/finance` for the whole window — the individual entries
 *     that fill the sheet's cells, grouped here by month and kind.
 *
 * Everything is fetched with `Promise.all`, so a 6-month window costs one
 * round-trip of latency. The query refetches whenever the window moves or
 * the global data version changes (mutations, background sync, focus).
 *
 * While a new window loads, the previous window's data is kept and returned
 * (flagged `stale`), so navigating month by month does not blank the sheet.
 */

import { useRef } from "react";

import { api, type FinanceLog, type FinanceSummary } from "../api";
import { addMonths, endOfMonth, startOfMonth, toIsoDate } from "../lib/dates";
import { useApiQuery } from "./useApi";

/** One month column of the sheet. */
export interface FinanceMonth {
  /** `YYYY-MM`, stable React key. */
  key: string;
  /** First day of the month. */
  start: Date;
  summary: FinanceSummary;
  /** Income entries of the month, chronological. */
  income: FinanceLog[];
  /** Expense entries of the month, chronological. */
  expense: FinanceLog[];
}

export interface FinanceWindowState {
  months: FinanceMonth[] | undefined;
  /** `true` while showing the previous window during a reload. */
  stale: boolean;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/** `YYYY-MM` for a date. */
export function monthKey(date: Date): string {
  return toIsoDate(date).slice(0, 7);
}

/**
 * Load `count` consecutive months starting at the month containing `firstMonth`.
 */
export function useFinanceWindow(firstMonth: Date, count: number): FinanceWindowState {
  const start = startOfMonth(firstMonth);
  const startIso = toIsoDate(start);

  const query = useApiQuery(
    async (signal) => {
      const monthStarts = Array.from({ length: count }, (_, index) => addMonths(start, index));
      const windowEnd = endOfMonth(monthStarts[monthStarts.length - 1]);

      const [summaries, entries] = await Promise.all([
        Promise.all(
          monthStarts.map((month) => api.finance.summary(month.getFullYear(), month.getMonth() + 1, signal)),
        ),
        api.finance.list({ start: toIsoDate(monthStarts[0]), end: toIsoDate(windowEnd) }, signal),
      ]);

      // Group entries by month and kind (the API returns them chronologically).
      const byMonth = new Map<string, { income: FinanceLog[]; expense: FinanceLog[] }>();
      for (const month of monthStarts) {
        byMonth.set(monthKey(month), { income: [], expense: [] });
      }
      for (const entry of entries) {
        byMonth.get(entry.occurred_on.slice(0, 7))?.[entry.kind].push(entry);
      }

      return monthStarts.map<FinanceMonth>((month, index) => {
        const key = monthKey(month);
        const group = byMonth.get(key) ?? { income: [], expense: [] };
        return { key, start: month, summary: summaries[index], income: group.income, expense: group.expense };
      });
    },
    [startIso, count],
  );

  // Keep the last successful window visible while the next one loads.
  const lastMonths = useRef<FinanceMonth[] | undefined>(undefined);
  if (query.data) {
    lastMonths.current = query.data;
  }
  const months = query.data ?? lastMonths.current;

  return {
    months,
    stale: query.data === undefined && months !== undefined,
    loading: query.loading,
    error: query.error,
    reload: query.reload,
  };
}
