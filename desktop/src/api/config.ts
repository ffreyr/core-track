/**
 * Backend address resolution.
 *
 * The base URL is resolved, in priority order, from:
 *  1. A value saved by the user in the Settings tab (localStorage). This lets
 *     the packaged app switch between `localhost`, a LAN IP and, later, a
 *     public tunnel without being rebuilt.
 *  2. `VITE_API_BASE_URL` from `.env.local` at build time.
 *  3. `http://localhost:8000`, the backend's default uvicorn address.
 */

/** localStorage key holding the user-chosen base URL. */
const STORAGE_KEY = "coretrack.apiBaseUrl";

/** Path prefix under which every backend router is mounted. */
export const API_PREFIX = "/api";

/**
 * Normalise a user-typed address into a usable base URL.
 *
 * - Trims whitespace.
 * - Adds `http://` when no scheme is given (`192.168.1.20:8000` works).
 * - Removes trailing slashes so paths can be appended safely.
 *
 * @param raw - Address as typed by the user or read from configuration.
 * @returns The normalised URL, or an empty string for blank input.
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (url === "") {
    return url;
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

/** The address used when the user has not saved one. */
export const DEFAULT_API_BASE_URL: string = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000",
);

/**
 * Return the backend base URL currently in effect.
 *
 * Storage access is wrapped in try/catch because localStorage can throw in
 * restricted contexts; the app then simply falls back to the default.
 */
export function getApiBaseUrl(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return normalizeBaseUrl(stored);
    }
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return DEFAULT_API_BASE_URL;
}

/**
 * Persist a new backend base URL, or pass `null` to revert to the default.
 *
 * @returns The URL that is now in effect.
 */
export function setApiBaseUrl(url: string | null): string {
  try {
    const normalized = url === null ? "" : normalizeBaseUrl(url);
    if (normalized === "" || normalized === DEFAULT_API_BASE_URL) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    }
  } catch {
    // Storage unavailable: the change only lasts until reload.
  }
  return getApiBaseUrl();
}
