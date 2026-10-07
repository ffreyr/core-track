/**
 * Timezone-safe calendar date helpers.
 *
 * Every `Date` handled here represents a *local calendar day* at local
 * midnight. Days are created with `new Date(year, monthIndex, day)` and
 * serialised from their local components, never via `toISOString()` (which
 * converts to UTC and can shift the day by one, e.g. in Istanbul at 01:00).
 *
 * Day arithmetic goes through the year/month/day constructor, which handles
 * month and year rollover and is immune to daylight-saving transitions.
 */

import type { IsoDate, TaskScope } from "../api";

/** First day of the week: 0 = Sunday, 1 = Monday. */
export type WeekStart = 0 | 1;

const MS_PER_DAY = 86_400_000;

/** Return a copy of `date` truncated to local midnight. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Today at local midnight. */
export function today(): Date {
  return startOfDay(new Date());
}

/** Format a local date as `YYYY-MM-DD`. */
export function toIsoDate(date: Date): IsoDate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse `YYYY-MM-DD` into a local-midnight `Date`.
 *
 * `new Date("2026-10-08")` would be parsed as UTC midnight, which is the
 * previous evening west of Greenwich; splitting the string avoids that.
 */
export function parseIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Add (or subtract) whole days. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Number of days in the month containing `date`. */
export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Add whole months, clamping the day so Jan 31 + 1 month is Feb 28/29
 * instead of overflowing into March.
 */
export function addMonths(date: Date, months: number): Date {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const day = Math.min(date.getDate(), daysInMonth(firstOfTarget));
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), day);
}

/** First day of the month containing `date`. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** First day of the week containing `date`. */
export function startOfWeek(date: Date, weekStartsOn: WeekStart): Date {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/** Last day of the week containing `date`. */
export function endOfWeek(date: Date, weekStartsOn: WeekStart): Date {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

/**
 * Whole days from `from` to `to` (negative if `to` is earlier).
 * Rounding absorbs the ±1h difference across daylight-saving changes.
 */
export function diffInDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

/** All days from `start` to `end`, inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const count = diffInDays(start, end) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, index) => addDays(start, index));
}

/** `true` for Saturday and Sunday. */
export function isWeekend(date: Date): boolean {
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}

/** `true` if both dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * The period a task of the given scope belongs to, relative to `anchor`.
 *
 * Used by the Tasks board: "weekly" tasks for the week containing the
 * anchor, "monthly" tasks for its month, and so on.
 */
export function scopePeriod(
  scope: TaskScope,
  anchor: Date,
  weekStartsOn: WeekStart,
): { start: Date; end: Date } {
  switch (scope) {
    case "daily":
      return { start: startOfDay(anchor), end: startOfDay(anchor) };
    case "weekly":
      return { start: startOfWeek(anchor, weekStartsOn), end: endOfWeek(anchor, weekStartsOn) };
    case "monthly":
      return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
    case "yearly":
      return {
        start: new Date(anchor.getFullYear(), 0, 1),
        end: new Date(anchor.getFullYear(), 11, 31),
      };
  }
}

// ---------------------------------------------------------------------------
// Formatting (uses the system locale so names match macOS settings)
// ---------------------------------------------------------------------------

const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const shortRangeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const weekdayShortFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const longDayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const shortDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthShortFormat = new Intl.DateTimeFormat(undefined, { month: "short" });

/** "October 2026" */
export function formatMonthYear(date: Date): string {
  return monthYearFormat.format(date);
}

/** "Oct 5 – 11, 2026" (locale-aware range collapsing). */
export function formatDateRange(start: Date, end: Date): string {
  return isSameDay(start, end) ? shortRangeFormat.format(start) : shortRangeFormat.formatRange(start, end);
}

/** "Mon" */
export function formatWeekdayShort(date: Date): string {
  return weekdayShortFormat.format(date);
}

/** "Thursday, October 8, 2026" */
export function formatLongDay(date: Date): string {
  return longDayFormat.format(date);
}

/** "Oct 8" */
export function formatShortDay(date: Date): string {
  return shortDayFormat.format(date);
}

/** "Oct" */
export function formatMonthShort(date: Date): string {
  return monthShortFormat.format(date);
}
