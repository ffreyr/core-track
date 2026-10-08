/**
 * Data hooks built on the API client.
 *
 * - {@link useApiQuery} loads data, refetches when its inputs or the global
 *   data version change, and cancels superseded requests.
 * - {@link useApiAction} wraps mutations: it shows error toasts, optionally a
 *   success toast, and invalidates every query so the UI reflects the change.
 */

import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

import { errorMessage, isAbortError } from "../api";
import { broadcastDataChanged } from "../lib/desktopBridge";
import { useDataVersion } from "../state/sync";
import { useToast } from "../state/toasts";

/** State returned by {@link useApiQuery}. */
export interface QueryState<T> {
  /** Latest data for the current inputs, or `undefined` before the first load. */
  data: T | undefined;
  /** Last error, cleared on the next successful load. */
  error: Error | null;
  /** `true` while a request is in flight (including background refreshes). */
  loading: boolean;
  /** Force a refetch of this query only. */
  reload: () => void;
}

interface InternalState<T> {
  key: string;
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Load data from the API.
 *
 * Refetch triggers: a change in `deps`, a global `invalidate()` (mutation,
 * poll, window focus) or `reload()`.
 *
 * Stale-while-revalidate semantics: on a background refresh of the *same*
 * inputs, the previous data stays visible (no flicker). When the inputs
 * change (e.g. the user navigates to another month), data for the old inputs
 * is hidden immediately so the UI never shows last month's numbers under
 * this month's title.
 *
 * @param fetcher - Performs the request; must honour the `AbortSignal`.
 * @param deps - Inputs the request depends on (like `useEffect` deps). They
 *   must be JSON-serialisable primitives.
 */
export function useApiQuery<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: DependencyList): QueryState<T> {
  const { version, reportSuccess, reportFailure } = useDataVersion();
  const key = JSON.stringify(deps);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<InternalState<T>>({ key, data: undefined, error: null, loading: true });

  // Always call the newest fetcher without making it an effect dependency
  // (inline arrow functions would otherwise refetch on every render).
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({
      key,
      // Keep data only if it belongs to the same inputs.
      data: previous.key === key ? previous.data : undefined,
      error: previous.key === key ? previous.error : null,
      loading: true,
    }));

    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({ key, data, error: null, loading: false });
        reportSuccess();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return;
        }
        const normalized = error instanceof Error ? error : new Error(errorMessage(error));
        setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : undefined,
          error: normalized,
          loading: false,
        }));
        reportFailure(error);
      });

    // Abort when inputs change or the component unmounts.
    return () => controller.abort();
  }, [key, version, nonce, reportSuccess, reportFailure]);

  const reload = useCallback(() => setNonce((current) => current + 1), []);

  // During the render right after `deps` change, `state` still holds the old
  // key; treat that as "no data yet, loading".
  const isCurrent = state.key === key;
  return {
    data: isCurrent ? state.data : undefined,
    error: isCurrent ? state.error : null,
    loading: isCurrent ? state.loading : true,
    reload,
  };
}

/** Result of {@link useApiAction}'s runner: success carries the value. */
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Options for a single action run. */
export interface ActionOptions {
  /** Toast shown on success; omit for silent actions (e.g. checkbox toggles). */
  success?: string;
}

/**
 * Return a function that runs a mutation with standard feedback.
 *
 * ```ts
 * const run = useApiAction();
 * const result = await run(() => api.tasks.toggle(id));
 * if (result.ok) { ... }
 * ```
 */
export function useApiAction(): <T>(action: () => Promise<T>, options?: ActionOptions) => Promise<ActionResult<T>> {
  const { invalidate } = useDataVersion();
  const toast = useToast();

  return useCallback(
    async <T,>(action: () => Promise<T>, options: ActionOptions = {}): Promise<ActionResult<T>> => {
      try {
        const value = await action();
        invalidate();
        // Let the other desktop windows (main app ⇄ widget) refresh right away.
        broadcastDataChanged();
        if (options.success) {
          toast.success(options.success);
        }
        return { ok: true, value };
      } catch (error) {
        toast.error(errorMessage(error));
        return { ok: false, error };
      }
    },
    [invalidate, toast],
  );
}
