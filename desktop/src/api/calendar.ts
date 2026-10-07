/**
 * Client for the `/api/calendar` aggregation endpoint and the health probe.
 */

import { request } from "./http";
import type { CalendarResponse, HealthResponse, IsoDate } from "./types";

export const calendarApi = {
  /**
   * Fetch tasks and financial logs grouped by day for `[start, end]`
   * (inclusive). The response contains one entry for every day in the range,
   * so the grid can index it directly without filling gaps.
   */
  get(start: IsoDate, end: IsoDate, signal?: AbortSignal): Promise<CalendarResponse> {
    return request<CalendarResponse>("GET", "/calendar", { query: { start, end }, signal });
  },
};

export const healthApi = {
  /**
   * Ping the backend. `baseUrl` lets Settings test an address before saving
   * it; a short timeout keeps the "Test connection" button responsive.
   */
  check(options: { baseUrl?: string; signal?: AbortSignal } = {}): Promise<HealthResponse> {
    return request<HealthResponse>("GET", "/health", {
      baseUrl: options.baseUrl,
      signal: options.signal,
      timeoutMs: 4_000,
    });
  },
};
