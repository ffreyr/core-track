/**
 * Paged calendar: the Week and rolling N-Days views.
 *
 * One page at a time, navigated with the toolbar arrows. Rows fill the
 * viewport (auto-fit): a single-row page lists every item and grows when
 * needed; a two-row rolling page caps items per day and shows "+N more".
 */

import { useCallback, useEffect, useMemo } from "react";

import type { IsoDate } from "../../api";
import { summarizeDays, useCalendarData } from "../../hooks/useCalendarData";
import { eachDay, toIsoDate, today } from "../../lib/dates";
import { usePreferences } from "../../state/preferences";
import { CalendarFrame } from "./CalendarFrame";
import { CalendarGrid } from "./CalendarGrid";
import { computePagedLayout, shiftPagedAnchor } from "./layout";
import { applyResizePreview } from "./resize";
import { useCalendarInteractions } from "./useCalendarInteractions";

interface PagedCalendarProps {
  viewMode: "week" | "days";
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  selectedIso: IsoDate | null;
  onSelectIso: (iso: IsoDate | null) => void;
}

export function PagedCalendar({ viewMode, anchor, onAnchorChange, selectedIso, onSelectIso }: PagedCalendarProps) {
  const { preferences } = usePreferences();
  const { handlers, dropTargetIso, toggleTask, resizePreview, acknowledgeData } =
    useCalendarInteractions(onSelectIso);

  const layout = useMemo(() => computePagedLayout(viewMode, anchor, preferences), [viewMode, anchor, preferences]);
  const startIso = toIsoDate(layout.rangeStart);
  const endIso = toIsoDate(layout.rangeEnd);
  const data = useCalendarData(startIso, endIso);

  // Live drag-to-resize preview drawn over the loaded data (see resize.ts),
  // released once fresh data arrives after a successful commit.
  const dayMap = useMemo(() => applyResizePreview(data.days, resizePreview), [data.days, resizePreview]);
  useEffect(() => {
    acknowledgeData();
  }, [data.days, acknowledgeData]);

  const totals = useMemo(
    () => summarizeDays(eachDay(layout.rangeStart, layout.rangeEnd).map((day) => data.days.get(toIsoDate(day)))),
    [layout.rangeStart, layout.rangeEnd, data.days],
  );

  // Close the day panel when paging moves the selected day out of view.
  useEffect(() => {
    if (selectedIso !== null && (selectedIso < startIso || selectedIso > endIso)) {
      onSelectIso(null);
    }
  }, [selectedIso, startIso, endIso, onSelectIso]);

  const goRelative = useCallback(
    (direction: 1 | -1) => onAnchorChange(shiftPagedAnchor(viewMode, anchor, direction, preferences)),
    [viewMode, anchor, preferences, onAnchorChange],
  );
  const goToday = useCallback(() => {
    onAnchorChange(today());
    onSelectIso(toIsoDate(today()));
  }, [onAnchorChange, onSelectIso]);

  return (
    <CalendarFrame
      title={layout.title}
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
        rows={layout.rows}
        columns={layout.columns}
        weekdayHeader={layout.weekAligned}
        dayMap={dayMap}
        preferences={preferences}
        todayIso={toIsoDate(today())}
        selectedIso={selectedIso}
        dropTargetIso={dropTargetIso}
        focusMonth={null}
        loading={data.loading && data.days.size === 0}
        handlers={handlers}
      />
    </CalendarFrame>
  );
}
