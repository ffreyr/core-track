/**
 * Public entry point of the API client layer.
 *
 * UI code imports from here only:
 *
 * ```ts
 * import { api, type Task } from "../api";
 * const tasks = await api.tasks.list({ scope: "weekly" });
 * ```
 */

import { calendarApi, healthApi } from "./calendar";
import { financeApi } from "./finance";
import { tasksApi } from "./tasks";

export const api = {
  tasks: tasksApi,
  finance: financeApi,
  calendar: calendarApi,
  health: healthApi,
};

export { ApiError, errorMessage, isAbortError } from "./http";
export { DEFAULT_API_BASE_URL, getApiBaseUrl, normalizeBaseUrl, setApiBaseUrl } from "./config";
export * from "./types";
