/**
 * The calendar grid: an optional weekday header row plus `columns × rows`
 * day cells laid out with CSS grid.
 *
 * Column/row counts come from the layout engine and are passed to CSS as
 * custom properties (`--cols`, `--rows`), so the same component renders a
 * 7×6 month, a 5×1 work week or a 4×1 rolling view without special cases.
 * Rows stretch to fill the available height; when content would make them
 * smaller than the density's minimum, the grid scrolls instead.
 *
 * Auto-fit: in multi-row views a ResizeObserver measures the real cell
 * height and computes how many chips fit, so a cell never overflows into a
 * scrollbar — extra items collapse into "+N more" at any window size. The
 * user's "items per cell" preference acts as an upper bound.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { CalendarDay, IsoDate } from "../../api";
import { formatWeekdayShort, toIsoDate } from "../../lib/dates";
import type { Preferences } from "../../state/preferences";
import { CalendarCell } from "./CalendarCell";
import type { CalendarLayout } from "./layout";
import type { CellHandlers } from "./types";

/**
 * Pixel metrics per density. These are the single source of truth: they are
 * pushed into CSS as custom properties AND used by the auto-fit calculation,
 * so the math always matches what is rendered.
 */
const DENSITY_METRICS = {
  comfortable: { rowMin: 118, chip: 22 },
  compact: { rowMin: 88, chip: 18 },
} as const;

/** Fixed parts of a cell (must match calendar.css). */
const CELL_PADDING_Y = 14; // 6px top + 8px bottom
const CELL_HEADER = 22; // .calendar-cell__header min-height
const CELL_HEADER_GAP = 4; // gap between header and items
const ITEM_GAP = 3; // gap between chips
const MORE_ROW = 18; // "+N more" button height

/**
 * How many chips fit in a cell of `cellHeight` px while leaving room for the
 * "+N more" row. Always at least 1 so every non-empty day shows something.
 */
function chipsThatFit(cellHeight: number, chipHeight: number): number {
  const available = cellHeight - CELL_PADDING_Y - CELL_HEADER - CELL_HEADER_GAP - (MORE_ROW + ITEM_GAP);
  return Math.max(1, Math.floor((available + ITEM_GAP) / (chipHeight + ITEM_GAP)));
}

interface CalendarGridProps {
  layout: CalendarLayout;
  /** Day data keyed by ISO date. */
  dayMap: Map<IsoDate, CalendarDay>;
  preferences: Preferences;
  todayIso: IsoDate;
  selectedIso: IsoDate | null;
  dropTargetIso: IsoDate | null;
  /** Fades the grid while the first load of a range is in progress. */
  loading: boolean;
  handlers: CellHandlers;
}

export function CalendarGrid({
  layout,
  dayMap,
  preferences,
  todayIso,
  selectedIso,
  dropTargetIso,
  loading,
  handlers,
}: CalendarGridProps) {
  const metrics = DENSITY_METRICS[preferences.density];
  const cellsRef = useRef<HTMLDivElement>(null);
  const [cellHeight, setCellHeight] = useState<number | null>(null);

  // Track the rendered row height. Rows are `minmax(rowMin, 1fr)`, so the
  // real height is the larger of the minimum and an equal share of the space
  // (minus the 1px grid gaps).
  useEffect(() => {
    const element = cellsRef.current;
    if (!element) {
      return undefined;
    }
    const measure = () => {
      const share = (element.clientHeight - (layout.rows - 1)) / layout.rows;
      setCellHeight(Math.max(metrics.rowMin, share));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout.rows, metrics.rowMin]);

  // Single-row views (week, short rolling ranges) have tall, scrollable
  // cells, so they list everything. Multi-row views cap items at whichever is
  // smaller: the user's preference or what physically fits.
  const maxItems =
    layout.rows > 1
      ? Math.min(preferences.maxItemsPerCell, cellHeight === null ? preferences.maxItemsPerCell : chipsThatFit(cellHeight, metrics.chip))
      : Number.POSITIVE_INFINITY;

  const style = {
    "--cols": layout.columns,
    "--rows": layout.rows,
    "--row-min": `${metrics.rowMin}px`,
    "--chip-height": `${metrics.chip}px`,
  } as CSSProperties;

  return (
    <div
      className={`calendar-grid density-${preferences.density}${loading ? " is-loading" : ""}`}
      style={style}
      role="grid"
      aria-label={layout.title}
    >
      {layout.weekAligned ? (
        <div className="calendar-grid__weekdays" role="row">
          {layout.days.slice(0, layout.columns).map((day) => (
            <div key={day.getDay()} className="calendar-grid__weekday" role="columnheader">
              {formatWeekdayShort(day)}
            </div>
          ))}
        </div>
      ) : null}

      <div className="calendar-grid__cells" ref={cellsRef}>
        {layout.days.map((date, index) => {
          const iso = toIsoDate(date);
          const outside =
            layout.focusMonth !== null &&
            (date.getMonth() !== layout.focusMonth.month || date.getFullYear() !== layout.focusMonth.year);
          return (
            <CalendarCell
              key={iso}
              date={date}
              iso={iso}
              day={dayMap.get(iso)}
              isFirstCell={index === 0}
              outsideFocusMonth={outside}
              isToday={iso === todayIso}
              isSelected={iso === selectedIso}
              isDropTarget={iso === dropTargetIso}
              showWeekday={!layout.weekAligned}
              preferences={preferences}
              maxItems={maxItems}
              handlers={handlers}
            />
          );
        })}
      </div>
    </div>
  );
}
