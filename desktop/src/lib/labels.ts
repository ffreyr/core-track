/**
 * Display metadata (labels, short codes, colors) for enums coming from the API.
 */

import type { FinanceKind, TaskPriority, TaskScope } from "../api";

/** Human-readable label, single-letter badge and accent color for each scope. */
export const SCOPE_META: Record<TaskScope, { label: string; short: string; color: string }> = {
  daily: { label: "Daily", short: "D", color: "#3b82f6" },
  weekly: { label: "Weekly", short: "W", color: "#8b5cf6" },
  monthly: { label: "Monthly", short: "M", color: "#f59e0b" },
  yearly: { label: "Yearly", short: "Y", color: "#ec4899" },
};

/** Labels for the four priority levels. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
};

/** Labels for income/expense. */
export const KIND_LABELS: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expense",
};

/** Swatches offered in the task editor's color picker. */
export const TASK_COLOR_SWATCHES: readonly string[] = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#64748b",
];

/** Category suggestions shown in the finance editor (free text is still allowed). */
export const CATEGORY_SUGGESTIONS: Record<FinanceKind, readonly string[]> = {
  income: ["Salary", "Freelance", "Bonus", "Investment", "Gift", "Refund", "Other"],
  expense: [
    "Rent",
    "Groceries",
    "Dining",
    "Transport",
    "Utilities",
    "Subscriptions",
    "Health",
    "Shopping",
    "Entertainment",
    "Education",
    "Travel",
    "Other",
  ],
};
