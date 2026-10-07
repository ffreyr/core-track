/**
 * TypeScript mirrors of the FastAPI schemas in `backend/app/schemas.py`.
 *
 * Keep these in sync with the backend. Conventions:
 *  - Calendar days travel as ISO strings (`YYYY-MM-DD`), never as `Date`
 *    objects, so no timezone conversion can shift a task to the wrong day.
 *  - Timestamps are ISO-8601 strings in UTC (`...Z`).
 *  - Money is a plain JSON number in major units (e.g. `149.9`); the backend
 *    stores exact integer cents, so totals it returns are already exact.
 */

/** A calendar day in `YYYY-MM-DD` form. */
export type IsoDate = string;

/** A UTC timestamp in ISO-8601 form. */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** Planning horizon of a task. Does not affect the day it is shown on. */
export type TaskScope = "daily" | "weekly" | "monthly" | "yearly";

/** All scopes in their natural display order. */
export const TASK_SCOPES: readonly TaskScope[] = ["daily", "weekly", "monthly", "yearly"];

/** Task priority: 0 = none, 1 = low, 2 = medium, 3 = high. */
export type TaskPriority = 0 | 1 | 2 | 3;

/** A task as returned by the API. */
export interface Task {
  id: number;
  title: string;
  description: string | null;
  scope: TaskScope;
  due_date: IsoDate;
  priority: TaskPriority;
  color: string | null;
  is_completed: boolean;
  completed_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Body of `POST /api/tasks`. */
export type TaskCreate = {
  title: string;
  description?: string | null;
  scope?: TaskScope;
  due_date: IsoDate;
  priority?: TaskPriority;
  color?: string | null;
};

/** Body of `PATCH /api/tasks/{id}`; only the fields present are changed. */
export type TaskUpdate = Partial<TaskCreate> & { is_completed?: boolean };

/** Query filters for `GET /api/tasks`. */
export type TaskListParams = {
  scope?: TaskScope;
  start?: IsoDate;
  end?: IsoDate;
  completed?: boolean;
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/** Direction of a financial log. */
export type FinanceKind = "income" | "expense";

/** A financial log as returned by the API. `amount` is always positive. */
export interface FinanceLog {
  id: number;
  kind: FinanceKind;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_on: IsoDate;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** Body of `POST /api/finance`. */
export type FinanceCreate = {
  kind: FinanceKind;
  /** Major units, max two decimals. Sent to the API as a fixed-point string. */
  amount: number;
  currency?: string;
  category: string;
  description?: string | null;
  occurred_on: IsoDate;
};

/** Body of `PATCH /api/finance/{id}`. */
export type FinanceUpdate = Partial<FinanceCreate>;

/** Query filters for `GET /api/finance`. */
export type FinanceListParams = {
  start?: IsoDate;
  end?: IsoDate;
  kind?: FinanceKind;
  category?: string;
};

/** Total for one `(category, kind)` pair within a month. */
export interface CategoryBreakdown {
  category: string;
  kind: FinanceKind;
  total: number;
  count: number;
}

/** One point of the daily income/expense series. */
export interface DailyNet {
  date: IsoDate;
  income: number;
  expense: number;
  net: number;
}

/** Response of `GET /api/finance/summary`. `daily` covers every day of the month. */
export interface FinanceSummary {
  year: number;
  month: number;
  income_total: number;
  expense_total: number;
  net: number;
  entry_count: number;
  by_category: CategoryBreakdown[];
  daily: DailyNet[];
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/** Everything needed to render one calendar cell. */
export interface CalendarDay {
  date: IsoDate;
  tasks: Task[];
  finance: FinanceLog[];
  income_total: number;
  expense_total: number;
  net: number;
  open_task_count: number;
  completed_task_count: number;
}

/** Totals across the requested calendar range. */
export interface CalendarTotals {
  income_total: number;
  expense_total: number;
  net: number;
  task_count: number;
  open_task_count: number;
  completed_task_count: number;
}

/** Response of `GET /api/calendar`: exactly one `days` entry per date in range. */
export interface CalendarResponse {
  start: IsoDate;
  end: IsoDate;
  days: CalendarDay[];
  totals: CalendarTotals;
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** Response of `GET /api/health`. */
export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  server_time: IsoDateTime;
}
