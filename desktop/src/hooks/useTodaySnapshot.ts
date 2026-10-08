/**
 * "Today at a glance" data, shared by the desktop widget and the sidebar's
 * Today card so both always show the same numbers.
 *
 * Two small queries:
 *  - tasks overlapping today (multi-day tasks included), sorted for display:
 *    open first, then highest priority, then alphabetical;
 *  - the current month's finance summary, from which the next upcoming
 *    payment and the number of overdue payments are derived.
 *
 * Both refresh through the shared sync machinery (poll, window focus and
 * cross-window change events).
 */

import { api, type FinanceLog, type FinanceSummary, type Task } from "../api";
import { toIsoDate, today } from "../lib/dates";
import { useApiQuery } from "./useApi";

/** Budget health, from the share of expected income already committed. */
export type BudgetHealth = "on-track" | "tight" | "over";

export interface TodaySnapshot {
  todayDate: Date;
  todayIso: string;
  /** Today's tasks, sorted for display; `undefined` before the first load. */
  tasks: Task[] | undefined;
  doneCount: number;
  /** Today's tasks currently in progress. */
  inProgressCount: number;
  /** This month's summary; `undefined` before the first load. */
  summary: FinanceSummary | undefined;
  /** Earliest unpaid expense due today or later this month. */
  nextDue: FinanceLog | null;
  /** Unpaid expenses this month whose date has passed. */
  overdueCount: number;
  health: BudgetHealth | null;
  error: Error | null;
  reload: () => void;
}

/** Workflow rank for display: in progress first, then to do, then done. */
const STATUS_RANK = { in_progress: 0, todo: 1, done: 2 } as const;

/** In-progress tasks first, then open ones, then done; each by priority, then title. */
function sortForGlance(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.priority - a.priority || a.title.localeCompare(b.title),
  );
}

/**
 * Classify the month: "over" when planned spending exceeds income, "tight"
 * when more than 85% of income is committed, otherwise "on track".
 */
function budgetHealth(summary: FinanceSummary): BudgetHealth {
  if (summary.remaining_budget < 0) {
    return "over";
  }
  if (summary.income_total > 0 && summary.expense_total / summary.income_total > 0.85) {
    return "tight";
  }
  return "on-track";
}

export function useTodaySnapshot(): TodaySnapshot {
  const todayDate = today();
  const todayIso = toIsoDate(todayDate);
  const year = todayDate.getFullYear();
  const month = todayDate.getMonth() + 1;

  const tasksQuery = useApiQuery((signal) => api.tasks.list({ start: todayIso, end: todayIso }, signal), [todayIso]);
  const summaryQuery = useApiQuery((signal) => api.finance.summary(year, month, signal), [year, month]);

  const tasks = tasksQuery.data ? sortForGlance(tasksQuery.data) : undefined;
  const summary = summaryQuery.data;
  const pendingExpenses = (summary?.pending ?? []).filter((entry) => entry.kind === "expense");

  return {
    todayDate,
    todayIso,
    tasks,
    doneCount: tasks?.filter((task) => task.is_completed).length ?? 0,
    inProgressCount: tasks?.filter((task) => task.status === "in_progress").length ?? 0,
    summary,
    nextDue: pendingExpenses.find((entry) => entry.occurred_on >= todayIso) ?? null,
    overdueCount: pendingExpenses.filter((entry) => entry.occurred_on < todayIso).length,
    health: summary ? budgetHealth(summary) : null,
    error: tasksQuery.error ?? summaryQuery.error,
    reload: () => {
      tasksQuery.reload();
      summaryQuery.reload();
    },
  };
}
