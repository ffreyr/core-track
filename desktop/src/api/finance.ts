/**
 * Client for the `/api/finance` endpoints.
 *
 * Amounts are sent as fixed-point strings (`"12.50"`) rather than JSON
 * numbers. The backend parses them straight into `Decimal`, so binary
 * floating-point noise in the UI (e.g. `0.1 + 0.2`) can never reach storage.
 */

import { request } from "./http";
import type {
  FinanceCreate,
  FinanceListParams,
  FinanceLog,
  FinanceSummary,
  FinanceUpdate,
} from "./types";

/** Convert a major-unit amount to the two-decimal string the API expects. */
function serializeAmount(amount: number): string {
  return amount.toFixed(2);
}

/** Replace a numeric `amount` with its string form, leaving other fields as-is. */
function serializeBody<T extends { amount?: number }>(payload: T): Omit<T, "amount"> & { amount?: string } {
  const { amount, ...rest } = payload;
  return amount === undefined ? rest : { ...rest, amount: serializeAmount(amount) };
}

export const financeApi = {
  /** List financial logs, optionally filtered by date range, kind and category. */
  list(params: FinanceListParams = {}, signal?: AbortSignal): Promise<FinanceLog[]> {
    return request<FinanceLog[]>("GET", "/finance", { query: params, signal });
  },

  /** Fetch a single financial log. */
  get(id: number, signal?: AbortSignal): Promise<FinanceLog> {
    return request<FinanceLog>("GET", `/finance/${id}`, { signal });
  },

  /** Record a new income or expense. */
  create(payload: FinanceCreate): Promise<FinanceLog> {
    return request<FinanceLog>("POST", "/finance", { body: serializeBody(payload) });
  },

  /** Partially update a financial log (also used for drag-and-drop date moves). */
  update(id: number, patch: FinanceUpdate): Promise<FinanceLog> {
    return request<FinanceLog>("PATCH", `/finance/${id}`, { body: serializeBody(patch) });
  },

  /** Permanently delete a financial log. */
  remove(id: number): Promise<void> {
    return request<void>("DELETE", `/finance/${id}`);
  },

  /**
   * Monthly roll-up: totals, per-category breakdown and a zero-filled daily
   * series for the given month (1–12).
   */
  summary(year: number, month: number, signal?: AbortSignal): Promise<FinanceSummary> {
    return request<FinanceSummary>("GET", "/finance/summary", { query: { year, month }, signal });
  },
};
