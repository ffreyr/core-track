/**
 * Calendar data with incremental loading, for both paged and infinite views.
 *
 * Instead of refetching the whole visible range whenever it changes, this
 * hook remembers which contiguous date range it already holds ("covered")
 * and requests only what is missing:
 *
 *   covered:      [=========]
 *   new range: [++|=========|++++]   → fetch only the "+" segments
 *
 * This is what makes infinite scrolling cheap: appending eight weeks at the
 * bottom fetches just those eight weeks.
 *
 * A *full* refresh of the whole range happens when the global data version
 * changes (a mutation, the background poll or window focus) or on
 * `reload()`. Old data stays visible until the refresh arrives, and a full
 * refresh interrupted by a range change is retried on the next run, so a
 * sync is never silently lost.
 *
 * Days outside the current range are pruned so memory stays bounded.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage, isAbortError, type CalendarDay, type CalendarTotals, type IsoDate } from "../api";
import { addDays, parseIsoDate, toIsoDate } from "../lib/dates";
import { useDataVersion } from "../state/sync";

/** An inclusive ISO date range. */
interface DateRange {
  start: IsoDate;
  end: IsoDate;
}

/** State returned by {@link useCalendarData}. */
export interface CalendarDataState {
  /** Loaded days keyed by ISO date. */
  days: Map<IsoDate, CalendarDay>;
  /** A request is in flight. */
  loading: boolean;
  /** Last error, cleared by the next successful load. */
  error: Error | null;
  /** Force a full refresh of the current range. */
  reload: () => void;
}

/** Day before / after an ISO date. */
const shiftIso = (iso: IsoDate, days: number): IsoDate => toIsoDate(addDays(parseIsoDate(iso), days));

/**
 * Work out which parts of `wanted` are not in `covered`.
 *
 * Returns the whole range when there is no overlap (e.g. after "jump to
 * date"), otherwise the uncovered head and/or tail segments.
 */
function missingSegments(covered: DateRange | null, wanted: DateRange): DateRange[] {
  if (covered === null || wanted.end < covered.start || wanted.start > covered.end) {
    return [wanted];
  }
  const segments: DateRange[] = [];
  if (wanted.start < covered.start) {
    segments.push({ start: wanted.start, end: shiftIso(covered.start, -1) });
  }
  if (wanted.end > covered.end) {
    segments.push({ start: shiftIso(covered.end, 1), end: wanted.end });
  }
  return segments;
}

/** Copy `source`, keeping only days inside `range`. */
function pruneToRange(source: Map<IsoDate, CalendarDay>, range: DateRange): Map<IsoDate, CalendarDay> {
  const next = new Map<IsoDate, CalendarDay>();
  for (const [iso, day] of source) {
    if (iso >= range.start && iso <= range.end) {
      next.set(iso, day);
    }
  }
  return next;
}

/**
 * Load calendar days for `[startIso, endIso]` (inclusive, ≤ 366 days).
 */
export function useCalendarData(startIso: IsoDate, endIso: IsoDate): CalendarDataState {
  const { version, reportSuccess, reportFailure } = useDataVersion();
  const [nonce, setNonce] = useState(0);
  const [days, setDays] = useState<Map<IsoDate, CalendarDay>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /** Range whose data is fully present in `days`. */
  const covered = useRef<DateRange | null>(null);
  /** Last seen version/nonce, to detect "refresh everything" requests. */
  const seen = useRef({ version, nonce });
  /** A full refresh was requested and has not completed yet. */
  const fullRefreshPending = useRef(false);

  useEffect(() => {
    const wanted: DateRange = { start: startIso, end: endIso };
    if (seen.current.version !== version || seen.current.nonce !== nonce) {
      seen.current = { version, nonce };
      fullRefreshPending.current = true;
    }

    const isFull = fullRefreshPending.current || covered.current === null;
    const segments = isFull ? [wanted] : missingSegments(covered.current, wanted);

    // Pure shrink (e.g. far rows trimmed): nothing to fetch, just prune.
    if (segments.length === 0) {
      covered.current = wanted;
      setDays((previous) => pruneToRange(previous, wanted));
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);

    Promise.all(segments.map((segment) => api.calendar.get(segment.start, segment.end, controller.signal)))
      .then((responses) => {
        if (controller.signal.aborted) {
          return;
        }
        setDays((previous) => {
          const next = isFull ? new Map<IsoDate, CalendarDay>() : pruneToRange(previous, wanted);
          for (const response of responses) {
            for (const day of response.days) {
              next.set(day.date, day);
            }
          }
          return next;
        });
        covered.current = wanted;
        if (isFull) {
          fullRefreshPending.current = false;
        }
        setError(null);
        setLoading(false);
        reportSuccess();
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || isAbortError(caught)) {
          return;
        }
        setError(caught instanceof Error ? caught : new Error(errorMessage(caught)));
        setLoading(false);
        reportFailure(caught);
      });

    return () => controller.abort();
  }, [startIso, endIso, version, nonce, reportSuccess, reportFailure]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  return { days, loading, error, reload };
}

/**
 * Totals for a set of days, matching the backend's `CalendarTotals`.
 *
 * Money is summed in integer cents to avoid floating-point drift; each task
 * is counted once even when a multi-day task appears on several days.
 */
export function summarizeDays(days: Iterable<CalendarDay | undefined>): CalendarTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  let pendingCents = 0;
  const taskCompletion = new Map<number, boolean>();

  for (const day of days) {
    if (!day) {
      continue;
    }
    incomeCents += Math.round(day.income_total * 100);
    expenseCents += Math.round(day.expense_total * 100);
    pendingCents += Math.round(day.pending_expense_total * 100);
    for (const task of day.tasks) {
      taskCompletion.set(task.id, task.is_completed);
    }
  }

  const completed = [...taskCompletion.values()].filter(Boolean).length;
  return {
    income_total: incomeCents / 100,
    expense_total: expenseCents / 100,
    pending_expense_total: pendingCents / 100,
    net: (incomeCents - expenseCents) / 100,
    task_count: taskCompletion.size,
    open_task_count: taskCompletion.size - completed,
    completed_task_count: completed,
  };
}
