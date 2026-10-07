/**
 * Client for the `/api/tasks` endpoints.
 */

import { request } from "./http";
import type { Task, TaskCreate, TaskListParams, TaskUpdate } from "./types";

export const tasksApi = {
  /** List tasks, optionally filtered by scope, due-date range and status. */
  list(params: TaskListParams = {}, signal?: AbortSignal): Promise<Task[]> {
    return request<Task[]>("GET", "/tasks", { query: params, signal });
  },

  /** Fetch a single task. */
  get(id: number, signal?: AbortSignal): Promise<Task> {
    return request<Task>("GET", `/tasks/${id}`, { signal });
  },

  /** Create a task. New tasks always start open. */
  create(payload: TaskCreate): Promise<Task> {
    return request<Task>("POST", "/tasks", { body: payload });
  },

  /**
   * Partially update a task. Used for edits and for drag-and-drop
   * rescheduling (`{ due_date }`). Setting `is_completed` lets the server
   * stamp or clear `completed_at`.
   */
  update(id: number, patch: TaskUpdate): Promise<Task> {
    return request<Task>("PATCH", `/tasks/${id}`, { body: patch });
  },

  /** Flip a task between open and completed (the calendar checkbox). */
  toggle(id: number): Promise<Task> {
    return request<Task>("POST", `/tasks/${id}/toggle`);
  },

  /** Permanently delete a task. */
  remove(id: number): Promise<void> {
    return request<void>("DELETE", `/tasks/${id}`);
  },
};
