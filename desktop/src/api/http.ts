/**
 * Low-level HTTP transport shared by every resource module.
 *
 * Responsibilities:
 *  - Build URLs from the configured base URL, the `/api` prefix and query
 *    parameters (dropping `undefined`/`null` values).
 *  - Serialise JSON bodies and parse JSON responses.
 *  - Enforce a timeout so a sleeping backend never leaves the UI spinning.
 *  - Convert every failure into an {@link ApiError} with a human-readable
 *    message, including FastAPI's structured 422 validation errors.
 *  - Let callers cancel requests with an `AbortSignal` (used when the user
 *    navigates away from a calendar range before it finished loading).
 */

import { API_PREFIX, getApiBaseUrl } from "./config";

/** HTTP verbs used by the Core-Track API. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Values allowed in a query string; `undefined`/`null` entries are skipped. */
export type QueryValue = string | number | boolean | null | undefined;

/** A flat map of query parameters. */
export type QueryParams = Record<string, QueryValue>;

/** Options accepted by {@link request}. */
export interface RequestOptions {
  /** Query-string parameters. */
  query?: QueryParams;
  /** JSON-serialisable request body. */
  body?: unknown;
  /** Caller-controlled cancellation. */
  signal?: AbortSignal;
  /** Abort the request after this many milliseconds (default 10 s). */
  timeoutMs?: number;
  /** Override the configured base URL (used by "Test connection"). */
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Error raised for every failed API call.
 *
 * `status` is the HTTP status code, or `0` when the server could not be
 * reached at all (network failure or timeout). The UI uses `status === 0` to
 * show an "offline" indicator instead of an error about the request itself.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(message: string, status: number, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** `true` when the backend could not be reached at all. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/** Return `true` if `error` represents a request cancelled by the caller. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Extract a readable message from any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Build an absolute request URL.
 *
 * @param baseUrl - Backend origin, e.g. `http://localhost:8000`.
 * @param path - Resource path relative to the API prefix, e.g. `/tasks`.
 * @param query - Optional query parameters.
 */
function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const url = new URL(`${baseUrl}${API_PREFIX}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Turn a FastAPI error payload into one sentence.
 *
 * FastAPI returns either `{"detail": "message"}` (our HTTPExceptions) or
 * `{"detail": [{"loc": [...], "msg": "..."}]}` (request validation). The
 * latter is flattened to `"field: message; field: message"`.
 */
function describeErrorPayload(status: number, payload: unknown): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => {
        if (item && typeof item === "object") {
          const entry = item as { loc?: unknown[]; msg?: string };
          // Drop the leading "body"/"query" segment so the message names the field.
          const location = Array.isArray(entry.loc)
            ? entry.loc.filter((segment) => segment !== "body" && segment !== "query").join(".")
            : "";
          return location ? `${location}: ${entry.msg ?? "invalid"}` : (entry.msg ?? "invalid");
        }
        return String(item);
      });
      if (parts.length > 0) {
        return parts.join("; ");
      }
    }
  }
  return `Request failed with HTTP ${status}`;
}

/** Parse a response body as JSON, tolerating empty or non-JSON bodies. */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Perform one API request and return the decoded JSON body.
 *
 * @typeParam T - Expected response shape. `204 No Content` resolves to
 *   `undefined`, so use `void` for delete endpoints.
 * @throws {ApiError} For HTTP errors, unreachable servers and timeouts.
 * @throws {DOMException} `AbortError` when the caller's `signal` aborts; this
 *   is deliberately *not* wrapped so callers can ignore cancellations.
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { query, body, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const baseUrl = options.baseUrl ?? getApiBaseUrl();

  let url: string;
  try {
    url = buildUrl(baseUrl, path, query);
  } catch {
    throw new ApiError(`"${baseUrl}" is not a valid backend address`, 0);
  }

  // One internal controller combines the caller's signal and our timeout.
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      // The caller cancelled: surface a standard AbortError.
      throw new DOMException("Request aborted", "AbortError");
    }
    if (timedOut) {
      throw new ApiError(`The backend at ${baseUrl} did not respond within ${timeoutMs / 1000}s`, 0);
    }
    throw new ApiError(
      `Cannot reach the backend at ${baseUrl}. Is the FastAPI server running?`,
      0,
      errorMessage(error),
    );
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ApiError(describeErrorPayload(response.status, payload), response.status, payload);
  }
  return payload as T;
}
