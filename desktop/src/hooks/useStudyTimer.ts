/**
 * Live study-timer state shared by the Study tab, the sidebar and the widget.
 *
 * The source of truth is the server: one query loads today's summary, which
 * includes the running session (`active`). This hook then ticks a local
 * clock once per second while a session runs, so the display is live without
 * polling the server every second. Starting/stopping goes through
 * `useApiAction`, which refreshes every view (and other windows).
 *
 * Pomodoro: when the running session has `planned_minutes` and the time is
 * up, the session is stopped automatically and a chime plays. The widget
 * never auto-stops (the main window does it, or the next manual action),
 * and a module-level guard ensures each session is auto-stopped only once
 * per window even though several components use this hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage, type StudySession, type StudyStart } from "../api";
import { playChime, primeChime } from "../lib/chime";
import { toIsoDate, today } from "../lib/dates";
import { broadcastDataChanged, currentWindowLabel } from "../lib/desktopBridge";
import { localTimeZone, secondsSince } from "../lib/duration";
import { useDataVersion } from "../state/sync";
import { useToast } from "../state/toasts";
import { useApiAction, useApiQuery } from "./useApi";

/** Sessions already auto-stopped in this window (shared by all hook users). */
const autoStopped = new Set<number>();

export interface StudyTimerState {
  /** The running session, or `null` when idle. */
  active: StudySession | null;
  /** Live seconds elapsed in the running session (0 when idle). */
  elapsed: number;
  /** Seconds left in a Pomodoro, or `null` for a stopwatch/idle. */
  remaining: number | null;
  /** Completed study seconds today plus the running session's live time. */
  todaySeconds: number;
  /** Subjects used recently (most-studied first), for quick picks. */
  recentSubjects: string[];
  loading: boolean;
  start: (options: StudyStart) => Promise<boolean>;
  stop: () => Promise<boolean>;
}

export function useStudyTimer(): StudyTimerState {
  const run = useApiAction();
  const toast = useToast();
  const { invalidate } = useDataVersion();
  const todayIso = toIsoDate(today());
  const tz = localTimeZone();

  const query = useApiQuery((signal) => api.study.summary(todayIso, todayIso, tz, signal), [todayIso, tz]);
  const active = query.data?.active ?? null;

  // Tick once per second while a session runs.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const elapsed = active ? secondsSince(active.started_at, now) : 0;
  const remaining = active?.planned_minutes ? active.planned_minutes * 60 - elapsed : null;

  // Pomodoro completion: stop once, chime, and tell every view.
  const autoStopping = useRef(false);
  useEffect(() => {
    if (!active || remaining === null || remaining > 0) {
      return;
    }
    if (currentWindowLabel() === "widget" || autoStopped.has(active.id) || autoStopping.current) {
      return;
    }
    autoStopped.add(active.id);
    autoStopping.current = true;
    playChime();
    api.study
      .stop()
      .then(() => toast.success(`Focus session complete: ${active.subject} · ${active.planned_minutes} min`))
      .catch((error: unknown) => {
        // A 404 means another window already stopped it — nothing to report.
        if (!errorMessage(error).includes("No study session")) {
          toast.error(errorMessage(error));
        }
      })
      .finally(() => {
        autoStopping.current = false;
        invalidate();
        broadcastDataChanged();
      });
  }, [active, remaining, toast, invalidate]);

  const start = useCallback(
    async (options: StudyStart) => {
      primeChime(); // Called from a click: unlocks audio for the end-of-Pomodoro chime.
      const result = await run(() => api.study.start(options));
      return result.ok;
    },
    [run],
  );

  const stop = useCallback(async () => {
    const result = await run(() => api.study.stop());
    return result.ok;
  }, [run]);

  return {
    active,
    elapsed,
    remaining,
    todaySeconds: (query.data?.total_seconds ?? 0) + elapsed,
    recentSubjects: query.data?.by_subject.map((entry) => entry.subject) ?? [],
    loading: query.loading && query.data === undefined,
    start,
    stop,
  };
}
