/**
 * Calendar layout engine (pure functions, no React).
 *
 * Given a view mode, an anchor date and the user's preferences, this module
 * decides which days are visible, how they wrap into a grid and what range
 * to request from the backend. Keeping it pure makes the grid trivially
 * predictable: the component only renders `days` in order into
 * `columns × rows` cells.
 */

import {
  addDays,
  addMonths,
  eachDay,
  endOfMonth,
  endOfWeek,
  formatDateRange,
  formatMonthYear,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type WeekStart,
} from "../../lib/dates";
import type { CalendarViewMode, Preferences } from "../../state/preferences";

/** The computed shape of the calendar for one render. */
export interface CalendarLayout {
  /** First day requested from the API (inclusive). */
  rangeStart: Date;
  /** Last day requested from the API (inclusive). */
  rangeEnd: Date;
  /** Days rendered as cells, in reading order (weekends removed if hidden). */
  days: Date[];
  /** Number of grid columns. */
  columns: number;
  /** Number of grid rows. */
  rows: number;
  /**
   * `true` when every row is one calendar week, so a weekday header row
   * makes sense. `false` for the rolling "days" view, whose cells label
   * their own weekday instead.
   */
  weekAligned: boolean;
  /** In month view, the month being displayed (cells outside it are dimmed). */
  focusMonth: { year: number; month: number } | null;
  /** Toolbar title, e.g. "October 2026" or "Oct 5 – 11, 2026". */
  title: string;
}

/** Layout-relevant subset of preferences. */
export type LayoutPreferences = Pick<Preferences, "weekStartsOn" | "showWeekends" | "customDayCount">;

/**
 * Compute the visible range for a view mode.
 *
 * - month    → full weeks covering the anchor's month (4–6 rows).
 * - twoWeeks → the anchor's week plus the following week.
 * - week     → the anchor's week.
 * - days     → `customDayCount` days starting *at* the anchor (not week-aligned),
 *              which makes a "next 3 days" or "next 10 days" planning view.
 *              With weekends hidden it counts *working* days, so "4 Days"
 *              always shows four cells.
 */
function visibleRange(
  viewMode: CalendarViewMode,
  anchor: Date,
  weekStartsOn: WeekStart,
  customDayCount: number,
  showWeekends: boolean,
): { start: Date; end: Date; weekAligned: boolean } {
  switch (viewMode) {
    case "month":
      return {
        start: startOfWeek(startOfMonth(anchor), weekStartsOn),
        end: endOfWeek(endOfMonth(anchor), weekStartsOn),
        weekAligned: true,
      };
    case "twoWeeks": {
      const start = startOfWeek(anchor, weekStartsOn);
      return { start, end: addDays(start, 13), weekAligned: true };
    }
    case "week": {
      const start = startOfWeek(anchor, weekStartsOn);
      return { start, end: addDays(start, 6), weekAligned: true };
    }
    case "days": {
      const start = startOfDay(anchor);
      const end = showWeekends ? addDays(start, customDayCount - 1) : stepWorkingDays(start, customDayCount - 1, 1);
      return { start, end, weekAligned: false };
    }
  }
}

/**
 * Walk `count` working days (Mon–Fri) from `from` in `direction`, returning
 * the day reached. If `from` itself is a weekend it is skipped first, so the
 * result is always a working day.
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

/** Build the full {@link CalendarLayout} for the current state. */
export function computeCalendarLayout(
  viewMode: CalendarViewMode,
  anchor: Date,
  preferences: LayoutPreferences,
): CalendarLayout {
  const { start, end, weekAligned } = visibleRange(
    viewMode,
    anchor,
    preferences.weekStartsOn,
    preferences.customDayCount,
    preferences.showWeekends,
  );

  const allDays = eachDay(start, end);
  const workDays = preferences.showWeekends ? allDays : allDays.filter((day) => !isWeekend(day));
  // Edge case: a 1–2 day "days" view landing on a weekend would be empty with
  // weekends hidden; showing the weekend beats showing nothing.
  const days = workDays.length > 0 ? workDays : allDays;

  // Week-aligned views keep weekdays in fixed columns: 7, or 5 when weekends
  // are hidden (each full week contributes exactly 5 weekdays, so rows stay
  // aligned). The rolling view simply wraps after 7 cells.
  const columns = weekAligned ? (preferences.showWeekends ? 7 : 5) : Math.min(7, days.length);
  const rows = Math.ceil(days.length / columns);

  return {
    rangeStart: start,
    rangeEnd: end,
    days,
    columns,
    rows,
    weekAligned,
    focusMonth: viewMode === "month" ? { year: anchor.getFullYear(), month: anchor.getMonth() } : null,
    title: viewMode === "month" ? formatMonthYear(anchor) : formatDateRange(start, end),
  };
}

/**
 * Move the anchor one "page" forward (`+1`) or backward (`-1`) for the
 * current view mode, i.e. what the toolbar arrows do.
 */
export function shiftAnchor(
  viewMode: CalendarViewMode,
  anchor: Date,
  direction: 1 | -1,
  preferences: LayoutPreferences,
): Date {
  const { customDayCount, showWeekends } = preferences;
  switch (viewMode) {
    case "month":
      return addMonths(anchor, direction);
    case "twoWeeks":
      return addDays(anchor, 14 * direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "days":
      // Page by exactly one window: N calendar days, or N working days when
      // weekends are hidden (so consecutive pages never overlap or skip).
      return showWeekends ? addDays(anchor, customDayCount * direction) : stepWorkingDays(anchor, customDayCount, direction);
  }
}
