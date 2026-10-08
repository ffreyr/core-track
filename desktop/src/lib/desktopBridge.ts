/**
 * Thin, safe wrapper around the Tauri APIs the frontend uses.
 *
 * Every function is a no-op (or resolves harmlessly) when the page is not
 * running inside Tauri — e.g. in a plain browser during development — so
 * shared code never has to check the environment itself.
 *
 * Cross-window sync: the main window and the desktop widget are separate
 * webviews with separate React state. After any successful mutation a
 * window broadcasts {@link DATA_CHANGED_EVENT}; every *other* window then
 * refetches immediately, so ticking a task in the widget updates the main
 * calendar at once (and vice versa) instead of waiting for the next poll.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Event broadcast to all windows after data changed. */
const DATA_CHANGED_EVENT = "coretrack://data-changed";

interface DataChangedPayload {
  /** Label of the window that made the change (used to ignore our own echo). */
  source: string;
}

/** `true` when running inside the Tauri desktop shell. */
export const inDesktopApp: boolean = isTauri();

/** Label of the current Tauri window (`"main"`, `"widget"`), or `"browser"`. */
export function currentWindowLabel(): string {
  return inDesktopApp ? getCurrentWindow().label : "browser";
}

/** Tell the other windows that data changed. Errors are ignored (best effort). */
export function broadcastDataChanged(): void {
  if (!inDesktopApp) {
    return;
  }
  const payload: DataChangedPayload = { source: currentWindowLabel() };
  void emit(DATA_CHANGED_EVENT, payload).catch(() => undefined);
}

/**
 * Call `onChange` whenever *another* window reports a data change.
 *
 * @returns An unsubscribe function (safe to call before the listener is ready).
 */
export function onDataChangedElsewhere(onChange: () => void): () => void {
  if (!inDesktopApp) {
    return () => undefined;
  }
  const self = currentWindowLabel();
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void listen<DataChangedPayload>(DATA_CHANGED_EVENT, (event) => {
    if (event.payload?.source !== self) {
      onChange();
    }
  })
    .then((stop) => {
      if (disposed) {
        stop();
      } else {
        unlisten = stop;
      }
    })
    .catch(() => undefined);
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Bring the main Core-Track window to the front (Rust command `open_main_window`). */
export function openMainWindow(): void {
  if (inDesktopApp) {
    void invoke("open_main_window").catch(() => undefined);
  }
}

/** Hide the current window (used by the widget's close button). */
export function hideCurrentWindow(): void {
  if (inDesktopApp) {
    void getCurrentWindow().hide().catch(() => undefined);
  }
}
