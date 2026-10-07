/**
 * Calendar layout engine (pure functions, no React).
 *
 * The calendar is always rendered as a list of *rows*; each row is a set of
 * consecutive visible days laid out in `columns` columns. Two families of
 * views produce those rows differently:
 *
 *  - **Scrolling views** (`month`, `twoWeeks`): an infinite list of calendar
 *    weeks. This module builds the rows for a *window* of weeks
 *    (`buildWeekRows`); the view grows the window as the user scrolls.
 *  - **Paged views** (`week`, `days`): a fixed page computed from an anchor
 *    date (`computePagedLayout`), navigated with the toolbar arrows.
 *
 * Keeping this pure makes the grid predictable: components only render the
 * rows they are given.
 */

import {
  addDays,
  eachDay,
  formatDateRange,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toIsoDate,
  type WeekStart,
} from "../../lib/dates";
import type { CalendarViewMode, Preferences } from "../../state/preferences";

/** One rendered row of the grid. */
export interface CalendarRow {
  /** Stable identity: ISO date of the row's first *calendar* day (week start). */
  key: string;
  /** Visible days in column order (weekends removed when hidden). */
  days: Date[];
}

/** Layout-relevant subset of preferences. */
export type LayoutPreferences = Pick<Preferences, "weekStartsOn" | "showWeekends" | "customDayCount">;

/** Month and 2 Weeks scroll infinitely; Week and N Days are paged. */
export function isScrollMode(viewMode: CalendarViewMode): viewMode is "month" | "twoWeeks" {
  return viewMode === "month" || viewMode === "twoWeeks";
}

/** Columns in week-aligned views: 7, or 5 when weekends are hidden. */
export function weekColumns(showWeekends: boolean): number {
  return showWeekends ? 7 : 5;
}

/** Drop weekend days when the preference hides them. */
function visibleDays(days: Date[], showWeekends: boolean): Date[] {
  return showWeekends ? days : days.filter((day) => !isWeekend(day));
}

// ---------------------------------------------------------------------------
// Scrolling views
// ---------------------------------------------------------------------------

/** A contiguous block of loaded weeks in a scrolling view. */
export interface WeekWindow {
  /** First day of the first week (always a week start). */
  start: Date;
  /** Number of weeks. */
  count: number;
}

/** Weeks kept above the target week when (re)centring the window. */
export const WINDOW_WEEKS_BEFORE = 8;
/** Weeks loaded initially, including the target week and those above it. */
export const WINDOW_INITIAL_WEEKS = 26;
/** Weeks added per infinite-scroll step. */
export const WINDOW_BLOCK_WEEKS = 8;
/** Upper bound on loaded weeks (364 days < the API's 366-day limit). */
export const WINDOW_MAX_WEEKS = 52;

/** A fresh window positioned so `targetWeekStart` has a buffer above it. */
export function windowAround(targetWeekStart: Date): WeekWindow {
  return { start: addDays(targetWeekStart, -7 * WINDOW_WEEKS_BEFORE), count: WINDOW_INITIAL_WEEKS };
}

/** Grow the window upward by one block, capping its size (drops weeks at the bottom). */
export function extendWindowStart(window: WeekWindow): WeekWindow {
  return {
    start: addDays(window.start, -7 * WINDOW_BLOCK_WEEKS),
    count: Math.min(WINDOW_MAX_WEEKS, window.count + WINDOW_BLOCK_WEEKS),
  };
}

/** Grow the window downward by one block, capping its size (drops weeks at the top). */
export function extendWindowEnd(window: WeekWindow): WeekWindow {
  const count = window.count + WINDOW_BLOCK_WEEKS;
  if (count <= WINDOW_MAX_WEEKS) {
    return { start: window.start, count };
  }
  const trimmed = count - WINDOW_MAX_WEEKS;
  return { start: addDays(window.start, 7 * trimmed), count: WINDOW_MAX_WEEKS };
}

/** Last day covered by a window. */
export function windowEnd(window: WeekWindow): Date {
  return addDays(window.start, window.count * 7 - 1);
}

/**
 * The week a navigation target should bring to the top of the viewport:
 * the week containing the 1st of the month in Month view, otherwise the
 * week containing the date itself.
 */
export function targetWeekStart(viewMode: "month" | "twoWeeks", date: Date, weekStartsOn: WeekStart): Date {
  return viewMode === "month" ? startOfWeek(startOfMonth(date), weekStartsOn) : startOfWeek(date, weekStartsOn);
}

/** Build one row per week of the window. */
export function buildWeekRows(window: WeekWindow, preferences: LayoutPreferences): CalendarRow[] {
  return Array.from({ length: window.count }, (_, index) => {
    const weekStart = addDays(window.start, index * 7);
    return {
      key: toIsoDate(weekStart),
      days: visibleDays(eachDay(weekStart, addDays(weekStart, 6)), preferences.showWeekends),
    };
  });
}

// ---------------------------------------------------------------------------
// Paged views
// ---------------------------------------------------------------------------

/** The computed page for Week / N Days views. */
export interface PagedLayout {
  rangeStart: Date;
  rangeEnd: Date;
  rows: CalendarRow[];
  columns: number;
  /** Rows are calendar weeks, so a weekday header row makes sense. */
  weekAligned: boolean;
  title: string;
}

/**
 * Walk `count` working days (Mon–Fri) from `from` in `direction`, returning
 * the day reached. A weekend `from` is first moved onto a working day.
 */
function stepWorkingDays(from: Date, count: number, direction: 1 | -1): Date {
  let day = startOfDay(from);
  while (isWeekend(day)) {
    day = addDays(day, direction);
  }
  let remaining = count;
  while (remaining > 0) {
    day = addDays(day, direction);
    if (!isWeekend(day)) {
      remaining -= 1;
    }
  }
  return day;
}

/**
 * Compute the Week or rolling N-Days page around `anchor`.
 *
 * - week → the anchor's week (7 or 5 columns, one row).
 * - days → `customDayCount` days starting at the anchor, wrapping after 7
 *   columns; with weekends hidden it counts *working* days.
 */
export function computePagedLayout(
  viewMode: "week" | "days",
  anchor: Date,
  preferences: LayoutPreferences,
): PagedLayout {
  if (viewMode === "week") {
    const start = startOfWeek(anchor, preferences.weekStartsOn);
    const end = addDays(start, 6);
    return {
      rangeStart: start,
      rangeEnd: end,
      rows: [{ key: toIsoDate(start), days: visibleDays(eachDay(start, end), preferences.showWeekends) }],
      columns: weekColumns(preferences.showWeekends),
      weekAligned: true,
      title: formatDateRange(start, end),
    };
  }

  const start = startOfDay(anchor);
  const end = preferences.showWeekends
    ? addDays(start, preferences.customDayCount - 1)
    : stepWorkingDays(start, preferences.customDayCount - 1, 1);
  const all = eachDay(start, end);
  const filtered = visibleDays(all, preferences.showWeekends);
  // A 1–2 day page landing on a weekend would be empty with weekends hidden.
  const days = filtered.length > 0 ? filtered : all;
  const columns = Math.min(7, days.length);

  const rows: CalendarRow[] = [];
  for (let index = 0; index < days.length; index += columns) {
    const chunk = days.slice(index, index + columns);
    rows.push({ key: toIsoDate(chunk[0]), days: chunk });
  }

  return { rangeStart: start, rangeEnd: end, rows, columns, weekAligned: false, title: formatDateRange(start, end) };
}

/**
 * Move a paged view one page forward (`+1`) or backward (`-1`).
 * The rolling view pages by exactly its own length, so pages never overlap.
 */
export function shiftPagedAnchor(
  viewMode: "week" | "days",
  anchor: Date,
  direction: 1 | -1,
  preferences: LayoutPreferences,
): Date {
  if (viewMode === "week") {
    return addDays(anchor, 7 * direction);
  }
  return preferences.showWeekends
    ? addDays(anchor, preferences.customDayCount * direction)
    : stepWorkingDays(anchor, preferences.customDayCount, direction);
}
