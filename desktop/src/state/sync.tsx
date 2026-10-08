/**
 * Data freshness and connection status.
 *
 * Core-Track has several writers (this desktop app, the phone, later the
 * widget refresh), so the desktop UI must notice changes it did not make.
 * Instead of a client-side cache, every data hook depends on a single
 * monotonically increasing `version` number:
 *
 *  - Local mutations call `invalidate()` → every visible query refetches.
 *  - A background timer calls `invalidate()` every `pollIntervalSec`
 *    (only while the window is visible, to avoid useless traffic).
 *  - Returning to the window (focus / visibility) calls `invalidate()` so the
 *    screen is current the moment the user looks at it.
 *  - Another desktop window (main app ⇄ widget) announcing a change calls
 *    `invalidate()` too (see lib/desktopBridge.ts).
 *
 * Two separate contexts are used on purpose: `version` changes trigger
 * refetches, while `status` changes (after every response) only re-render
 * the status indicator, not every data consumer.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, errorMessage } from "../api";
import { onDataChangedElsewhere } from "../lib/desktopBridge";

/** Connection state shown in the sidebar footer. */
export interface SyncStatus {
  state: "connecting" | "online" | "offline";
  lastSyncedAt: Date | null;
  message: string | null;
}

interface DataVersionContextValue {
  version: number;
  invalidate: () => void;
  reportSuccess: () => void;
  reportFailure: (error: unknown) => void;
}

const DataVersionContext = createContext<DataVersionContextValue | null>(null);
const SyncStatusContext = createContext<SyncStatus | null>(null);

/**
 * Provides the shared data version and connection status.
 *
 * @param pollIntervalSec - Background refresh interval; `0` disables polling.
 */
export function DataSyncProvider({ pollIntervalSec, children }: { pollIntervalSec: number; children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<SyncStatus>({ state: "connecting", lastSyncedAt: null, message: null });

  const invalidate = useCallback(() => setVersion((current) => current + 1), []);

  const reportSuccess = useCallback(() => {
    setStatus({ state: "online", lastSyncedAt: new Date(), message: null });
  }, []);

  // Only transport failures mean "offline". A 404/422 proves the server is up.
  const reportFailure = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.isNetworkError) {
      setStatus((previous) => ({ ...previous, state: "offline", message: errorMessage(error) }));
    }
  }, []);

  // Background polling while the window is visible.
  useEffect(() => {
    if (pollIntervalSec <= 0) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        invalidate();
      }
    }, pollIntervalSec * 1000);
    return () => window.clearInterval(timer);
  }, [pollIntervalSec, invalidate]);

  // Refresh immediately when another desktop window (widget ⇄ main) changed data.
  useEffect(() => onDataChangedElsewhere(invalidate), [invalidate]);

  // Refresh when the user comes back to the app.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        invalidate();
      }
    };
    window.addEventListener("focus", invalidate);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", invalidate);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [invalidate]);

  const versionValue = useMemo(
    () => ({ version, invalidate, reportSuccess, reportFailure }),
    [version, invalidate, reportSuccess, reportFailure],
  );

  return (
    <DataVersionContext.Provider value={versionValue}>
      <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>
    </DataVersionContext.Provider>
  );
}

/** Access the data version and invalidation functions. */
export function useDataVersion(): DataVersionContextValue {
  const context = useContext(DataVersionContext);
  if (!context) {
    throw new Error("useDataVersion must be used inside <DataSyncProvider>");
  }
  return context;
}

/** Access the current connection status. */
export function useSyncStatus(): SyncStatus {
  const context = useContext(SyncStatusContext);
  if (!context) {
    throw new Error("useSyncStatus must be used inside <DataSyncProvider>");
  }
  return context;
}
