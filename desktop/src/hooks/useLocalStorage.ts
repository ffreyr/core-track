/**
 * `useState` that survives app restarts by mirroring its value to localStorage.
 */

import { useCallback, useEffect, useState } from "react";

/**
 * Persisted state hook.
 *
 * @param key - localStorage key (namespace with `coretrack.`).
 * @param fallback - Value used when nothing valid is stored.
 * @param sanitize - Optional function that turns the raw parsed value into a
 *   valid `T`. Use it for objects whose shape may change between app
 *   versions, so a stale stored value can never crash the UI.
 * @returns A `[value, setValue]` tuple, like `useState`.
 */
export function useLocalStorage<T>(
  key: string,
  fallback: T,
  sanitize?: (stored: unknown) => T,
): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return fallback;
      }
      const parsed: unknown = JSON.parse(raw);
      return sanitize ? sanitize(parsed) : (parsed as T);
    } catch {
      return fallback;
    }
  });

  // Write-through on every change. Failures (quota, private mode) are ignored:
  // the in-memory state still works for the current session.
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is best-effort.
    }
  }, [key, value]);

  const update = useCallback((next: T | ((previous: T) => T)) => {
    setValue((previous) => (typeof next === "function" ? (next as (p: T) => T)(previous) : next));
  }, []);

  return [value, update];
}
