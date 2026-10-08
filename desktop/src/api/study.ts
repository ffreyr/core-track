/**
 * Client for the `/api/study` timer endpoints.
 */

import { request } from "./http";
import type {
  IsoDate,
  StudySession,
  StudySessionCreate,
  StudySessionListParams,
  StudySessionUpdate,
  StudyStart,
  StudySummary,
} from "./types";

export const studyApi = {
  /** The running session, or `null` when the timer is idle. */
  active(signal?: AbortSignal): Promise<StudySession | null> {
    return request<StudySession | null>("GET", "/study/active", { signal });
  },

  /** Start a session now (a running session is stopped first). */
  start(payload: StudyStart = {}): Promise<StudySession> {
    return request<StudySession>("POST", "/study/start", { body: payload });
  },

  /** Stop the running session now. Rejects with 404 if nothing is running. */
  stop(): Promise<StudySession> {
    return request<StudySession>("POST", "/study/stop");
  },

  /** Sessions that started within the given bounds, newest first. */
  list(params: StudySessionListParams = {}, signal?: AbortSignal): Promise<StudySession[]> {
    return request<StudySession[]>("GET", "/study/sessions", { query: params, signal });
  },

  /** Log a completed session by hand. */
  create(payload: StudySessionCreate): Promise<StudySession> {
    return request<StudySession>("POST", "/study/sessions", { body: payload });
  },

  /** Edit a session. */
  update(id: number, patch: StudySessionUpdate): Promise<StudySession> {
    return request<StudySession>("PATCH", `/study/sessions/${id}`, { body: patch });
  },

  /** Permanently delete a session. */
  remove(id: number): Promise<void> {
    return request<void>("DELETE", `/study/sessions/${id}`);
  },

  /** Totals per local day and per subject for `[start, end]` in time zone `tz`. */
  summary(start: IsoDate, end: IsoDate, tz: string, signal?: AbortSignal): Promise<StudySummary> {
    return request<StudySummary>("GET", "/study/summary", { query: { start, end, tz }, signal });
  },
};
