/**
 * TypeScript mirrors of the FastAPI schemas in `backend/app/schemas.py`.
 *
 * Keep these in sync with the backend. Conventions:
 *  - Calendar days travel as ISO strings (`YYYY-MM-DD`), never as `Date`
 *    objects, so no timezone conversion can shift a task to the wrong day.
 *    ISO dates also compare correctly as plain strings (`a < b`).
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

/** Planning horizon of a task. Does not affect the days it is shown on. */
export type TaskScope = "daily" | "weekly" | "monthly" | "yearly";

/** All scopes in their natural display order. */
export const TASK_SCOPES: readonly TaskScope[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * Workflow state of a task. `status` is the source of truth; `is_completed`
 * is kept equal to `status === "done"` by the server.
 */
export type TaskStatus = "todo" | "in_progress" | "done";

/** All statuses in workflow order. */
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "in_progress", "done"];

/** Task priority: 0 = none, 1 = low, 2 = medium, 3 = high. */
export type TaskPriority = 0 | 1 | 2 | 3;

/**
 * A task as returned by the API.
 *
 * Multi-day tasks cover `due_date` through `end_date` inclusive; single-day
 * tasks have `end_date: null`. `span_days` is always present (1 = single day).
 */
export interface Task {
  id: number;
  title: string;
  description: string | null;
  scope: TaskScope;
  due_date: IsoDate;
  end_date: IsoDate | null;
  span_days: number;
  priority: TaskPriority;
  color: string | null;
  status: TaskStatus;
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
  /** Last day of a multi-day task; omit or `null` for a single day. */
  end_date?: IsoDate | null;
  priority?: TaskPriority;
  color?: string | null;
  /** Defaults to `"todo"` on the server. */
  status?: TaskStatus;
};

/**
 * Body of `PATCH /api/tasks/{id}`; only the fields present are changed.
 *
 * Sending only `due_date` *moves* the task (a multi-day task keeps its
 * length); sending `end_date` *resizes* it (`null` = single day).
 */
export type TaskUpdate = Partial<TaskCreate> & { is_completed?: boolean };

/** Query filters for `GET /api/tasks` (date range uses overlap semantics). */
export type TaskListParams = {
  scope?: TaskScope;
  start?: IsoDate;
  end?: IsoDate;
  completed?: boolean;
  status?: TaskStatus;
};

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/** Direction of a financial log. */
export type FinanceKind = "income" | "expense";

/**
 * A financial log as returned by the API. `amount` is always positive.
 * `is_paid: false` marks a planned entry (a bill due, income expected).
 */
export interface FinanceLog {
  id: number;
  kind: FinanceKind;
  amount: number;
  currency: string;
  category: string;
  description: string | null;
  occurred_on: IsoDate;
  is_paid: boolean;
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
  /** Defaults to `true` on the server; `false` plans a future entry. */
  is_paid?: boolean;
};

/** Body of `PATCH /api/finance/{id}`. */
export type FinanceUpdate = Partial<FinanceCreate>;

/** Query filters for `GET /api/finance`. */
export type FinanceListParams = {
  start?: IsoDate;
  end?: IsoDate;
  kind?: FinanceKind;
  category?: string;
  is_paid?: boolean;
};

/** Totals for one `(category, kind)` pair within a month. `total = paid + pending`. */
export interface CategoryBreakdown {
  category: string;
  kind: FinanceKind;
  total: number;
  paid_total: number;
  pending_total: number;
  count: number;
}

/** One point of the daily series; `income`/`expense` include pending entries. */
export interface DailyNet {
  date: IsoDate;
  income: number;
  expense: number;
  net: number;
  income_pending: number;
  expense_pending: number;
}

/**
 * Response of `GET /api/finance/summary`: a forward-looking cash-flow view.
 *
 * `remaining_budget = income_received − expense_paid − expense_pending`
 * `cash_balance     = income_received − expense_paid`
 */
export interface FinanceSummary {
  year: number;
  month: number;
  income_total: number;
  income_received: number;
  income_pending: number;
  expense_total: number;
  expense_paid: number;
  expense_pending: number;
  net: number;
  remaining_budget: number;
  cash_balance: number;
  entry_count: number;
  pending_count: number;
  by_category: CategoryBreakdown[];
  daily: DailyNet[];
  /** The month's unpaid entries in date order. */
  pending: FinanceLog[];
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

/**
 * Everything needed to render one calendar day. Multi-day tasks are listed
 * on every day they cover, first and in a stable order.
 */
export interface CalendarDay {
  date: IsoDate;
  tasks: Task[];
  finance: FinanceLog[];
  income_total: number;
  expense_total: number;
  pending_expense_total: number;
  net: number;
  open_task_count: number;
  completed_task_count: number;
}

/** Totals across a calendar range (each task counted once). */
export interface CalendarTotals {
  income_total: number;
  expense_total: number;
  pending_expense_total: number;
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
