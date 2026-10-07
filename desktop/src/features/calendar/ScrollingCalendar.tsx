/**
 * Infinite-scrolling calendar: the Month and 2 Weeks views.
 *
 * State model:
 *  - `weekWindow`: the contiguous block of weeks currently rendered/loaded. It
 *    grows by a block when the grid reports the top or bottom edge
 *    (IntersectionObserver), and is capped so memory stays bounded.
 *  - `scrollRequest`: "bring this week to the top" — issued by toolbar
 *    navigation, the Today button, keyboard shortcuts, or an external anchor
 *    change (e.g. clicking a day in the Finance tab). If the target is not
 *    inside the window, the window is re-centred on it first.
 *  - `viewport`: which weeks are at the top / a third into the screen, as
 *    reported by the grid. The title, the shaded "current month", the
 *    toolbar totals and the Prev/Next targets are all derived from it, so
 *    they follow the user's scrolling.
 *
 * Prev/Next stay page-based: Month jumps to the previous/next month's first
 * week; 2 Weeks jumps by 14 days from the top row.
 *
 * When this view unmounts (switching tab or to a paged view) it hands the
 * date in focus back to the app as the anchor, so other views open where
 * the user was looking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IsoDate } from "../../api";
import { summarizeDays, useCalendarData } from "../../hooks/useCalendarData";
import {
  addDays,
  addMonths,
  eachDay,
  endOfMonth,
  formatDateRange,
  formatMonthYear,
  parseIsoDate,
  startOfMonth,
  toIsoDate,
  today,
} from "../../lib/dates";
import { usePreferences } from "../../state/preferences";
import { CalendarFrame } from "./CalendarFrame";
import { CalendarGrid, type ScrollRequest } from "./CalendarGrid";
import {
  buildWeekRows,
  extendWindowEnd,
  extendWindowStart,
  targetWeekStart,
  weekColumns,
  windowAround,
  windowEnd,
  type WeekWindow,
} from "./layout";
import { useCalendarInteractions } from "./useCalendarInteractions";

interface ScrollingCalendarProps {
  viewMode: "month" | "twoWeeks";
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  selectedIso: IsoDate | null;
  onSelectIso: (iso: IsoDate | null) => void;
}

/** Rows per screen: Month shows ~5 weeks, 2 Weeks shows 2 tall weeks. */
const ROWS_PER_SCREEN = { month: 5, twoWeeks: 2 } as const;

export function ScrollingCalendar({ viewMode, anchor, onAnchorChange, selectedIso, onSelectIso }: ScrollingCalendarProps) {
  const { preferences } = usePreferences();
  const { weekStartsOn } = preferences;
  const { handlers, dropTargetIso, toggleTask } = useCalendarInteractions(onSelectIso);

  // ---- Window, jump requests and viewport ---------------------------------

  const initialTarget = targetWeekStart(viewMode, anchor, weekStartsOn);
  const [weekWindow, setWeekWindow] = useState<WeekWindow>(() => windowAround(initialTarget));
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest>(() => ({
    rowKey: toIsoDate(initialTarget),
    nonce: 1,
  }));
  const [viewport, setViewport] = useState(() => ({
    topKey: toIsoDate(initialTarget),
    focusKey: toIsoDate(initialTarget),
  }));

  const rows = useMemo(() => buildWeekRows(weekWindow, preferences), [weekWindow, preferences]);

  /**
   * Bring the week relevant to `date` to the top, re-centring the window if
   * that week is not loaded.
   */
  const scrollToDate = useCallback(
    (date: Date) => {
      const target = targetWeekStart(viewMode, date, weekStartsOn);
      const rowKey = toIsoDate(target);
      setWeekWindow((current) => {
        const inside = target >= current.start && target <= windowEnd(current);
        return inside ? current : windowAround(target);
      });
      setScrollRequest((current) => ({ rowKey, nonce: current.nonce + 1 }));
    },
    [viewMode, weekStartsOn],
  );

  // Week start changed: every row key changes, so rebuild around the focus.
  const previousWeekStart = useRef(weekStartsOn);
  const focusDateRef = useRef<Date>(addDays(initialTarget, 3));
  useEffect(() => {
    if (previousWeekStart.current !== weekStartsOn) {
      previousWeekStart.current = weekStartsOn;
      const focus = focusDateRef.current;
      setWeekWindow(windowAround(targetWeekStart(viewMode, focus, weekStartsOn)));
      scrollToDate(focus);
    }
  }, [weekStartsOn, viewMode, scrollToDate]);

  // External anchor changes (e.g. "open day" from Finance) → scroll there.
  // Navigation that originates here records the date first, so it is not
  // applied twice.
  const lastNavigatedIso = useRef(toIsoDate(anchor));
  const anchorIso = toIsoDate(anchor);
  useEffect(() => {
    if (anchorIso !== lastNavigatedIso.current) {
      lastNavigatedIso.current = anchorIso;
      scrollToDate(parseIsoDate(anchorIso));
    }
  }, [anchorIso, scrollToDate]);

  /** Navigate from inside the calendar and share the date with the app. */
  const navigate = useCallback(
    (date: Date) => {
      lastNavigatedIso.current = toIsoDate(date);
      onAnchorChange(date);
      scrollToDate(date);
    },
    [onAnchorChange, scrollToDate],
  );

  // ---- Derived focus: title, shading, totals ------------------------------

  const topStart = parseIsoDate(viewport.topKey);
  // Mid-week day of the focus row decides "which month are we looking at".
  const focusDate = addDays(parseIsoDate(viewport.focusKey), 3);
  focusDateRef.current = focusDate;

  const focusMonth = viewMode === "month" ? { year: focusDate.getFullYear(), month: focusDate.getMonth() } : null;
  const title = viewMode === "month" ? formatMonthYear(focusDate) : formatDateRange(topStart, addDays(topStart, 13));

  // Totals cover the focused month (Month) or the two weeks on screen (2 Weeks).
  const totalsStart = viewMode === "month" ? startOfMonth(focusDate) : topStart;
  const totalsEnd = viewMode === "month" ? endOfMonth(focusDate) : addDays(topStart, 13);
  const totalsStartIso = toIsoDate(totalsStart);
  const totalsEndIso = toIsoDate(totalsEnd);

  // ---- Data ---------------------------------------------------------------

  const data = useCalendarData(toIsoDate(weekWindow.start), toIsoDate(windowEnd(weekWindow)));
  const totals = useMemo(
    () =>
      summarizeDays(eachDay(parseIsoDate(totalsStartIso), parseIsoDate(totalsEndIso)).map((day) => data.days.get(toIsoDate(day)))),
    [totalsStartIso, totalsEndIso, data.days],
  );

  // Hand the focused date back to the app when leaving this view.
  const onAnchorChangeRef = useRef(onAnchorChange);
  useEffect(() => {
    onAnchorChangeRef.current = onAnchorChange;
  });
  useEffect(() => () => onAnchorChangeRef.current(focusDateRef.current), []);

  // ---- Navigation ----------------------------------------------------------

  const goRelative = useCallback(
    (direction: 1 | -1) => {
      if (viewMode === "month") {
        navigate(addMonths(startOfMonth(focusDateRef.current), direction));
      } else {
        navigate(addDays(parseIsoDate(viewport.topKey), 14 * direction));
      }
    },
    [viewMode, navigate, viewport.topKey],
  );

  const goToday = useCallback(() => {
    navigate(today());
    onSelectIso(toIsoDate(today()));
  }, [navigate, onSelectIso]);

  const onViewportChange = useCallback((topKey: string, focusKey: string) => {
    setViewport((current) => (current.topKey === topKey && current.focusKey === focusKey ? current : { topKey, focusKey }));
  }, []);
  const onReachStart = useCallback(() => setWeekWindow(extendWindowStart), []);
  const onReachEnd = useCallback(() => setWeekWindow(extendWindowEnd), []);

  return (
    <CalendarFrame
      title={title}
      totals={data.days.size > 0 ? totals : undefined}
      refreshing={data.loading}
      error={data.error}
      onRetry={data.reload}
      onPrev={() => goRelative(-1)}
      onNext={() => goRelative(1)}
      onToday={goToday}
      selectedIso={selectedIso}
      onSelectIso={onSelectIso}
      onToggleTask={toggleTask}
    >
      <CalendarGrid
        rows={rows}
        columns={weekColumns(preferences.showWeekends)}
        weekdayHeader
        dayMap={data.days}
        preferences={preferences}
        todayIso={toIsoDate(today())}
        selectedIso={selectedIso}
        dropTargetIso={dropTargetIso}
        focusMonth={focusMonth}
        loading={data.loading && data.days.size === 0}
        handlers={handlers}
        infinite={{
          rowsPerScreen: ROWS_PER_SCREEN[viewMode],
          scrollRequest,
          onReachStart,
          onReachEnd,
          onViewportChange,
        }}
      />
    </CalendarFrame>
  );
}
