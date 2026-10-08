/**
 * Time-span formatting and local-time helpers for the study timer.
 */

/** Pad to two digits. */
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Stopwatch-style clock: "25:00", "1:05:09". Negative input is shown as 0.
 */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/**
 * Human duration: "1h 05m", "25m", "40s", "0m".
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return seconds > 0 ? `${seconds}s` : "0m";
}

/** Whole seconds between an ISO timestamp and `nowMs`. */
export function secondsSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
}

/** The user's IANA time zone (e.g. "Europe/Istanbul"), for server-side day bucketing. */
export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Format a local `Date` as ISO-8601 *with* its UTC offset, e.g.
 * "2026-10-08T14:05:00+03:00". The API requires an offset so a time can
 * never be misread in another time zone.
 */
export function toOffsetIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** "14:05" in the user's locale. */
export function formatTimeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
