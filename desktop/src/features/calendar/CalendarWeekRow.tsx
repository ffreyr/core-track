/**
 * One row of the calendar (normally one week), rendered as a layered CSS grid.
 *
 * Columns are days. Grid *tracks* (rows) are:
 *
 *   track 1            day headers (date number, net badge)
 *   tracks 2 … L+1     one lane per multi-day bar lane
 *   last track         each day's single-day tasks + finance chips
 *
 * Every layer is a separate set of grid items placed into those tracks:
 *
 *   - Day backgrounds span ALL tracks of their column (selection, today,
 *     drop-target and out-of-month shading).
 *   - Headers sit in track 1 of their column.
 *   - Multi-day bars sit in their lane's track and span several columns via
 *     `grid-column: <start> / span <n>` — one element per row segment,
 *     which is what draws them as continuous Google-Calendar-style blocks.
 *   - Item lists sit in the last track of their column.
 *
 * Because bars overlay several days, pointer events (click, double-click,
 * drag over, drop) are handled on the row itself and mapped to a day from
 * the pointer's x coordinate. Items stop propagation for their own clicks.
 *
 * Item budget: `budget` slots per day (from metrics.itemSlots, or Infinity
 * in single-row paged views). Lanes take slots first — a lane occupies its
 * height across the whole row even where a day has no bar, exactly like
 * Google Calendar — then single-day items fill what is left. Anything that
 * does not fit is counted into "+N more".
 */

import { memo, useMemo, type CSSProperties, type MouseEvent, type DragEvent } from "react";

import type { CalendarDay, IsoDate, Task } from "../../api";
import { formatMonthShort, formatWeekdayShort, toIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import type { Preferences } from "../../state/preferences";
import { FinanceChip, TaskBar, TaskChip } from "./Chips";
import type { CalendarRow } from "./layout";
import type { RowMetrics } from "./metrics";
import { isMultiDay, layoutRowBars } from "./spans";
import type { CellHandlers } from "./types";

export interface CalendarWeekRowProps {
  row: CalendarRow;
  columns: number;
  /** Data per column (`undefined` while that day is loading). */
  dayData: (CalendarDay | undefined)[];
  /** Row height in px. */
  height: number;
  /** `fill`: height is a minimum and the row may grow; otherwise fixed. */
  fill: boolean;
  /** Item slots per day (`Infinity` = list everything). */
  budget: number;
  metrics: RowMetrics;
  preferences: Preferences;
  todayIso: IsoDate;
  /** Selected day if it is in this row, else `null` (keeps memo effective). */
  selectedIso: IsoDate | null;
  /** Drop-target day if it is in this row, else `null`. */
  dropTargetIso: IsoDate | null;
  /** Month to emphasise (Month view); other days are shaded. */
  focusMonth: { year: number; month: number } | null;
  /** Label each day with its weekday (views without a weekday header). */
  showWeekday: boolean;
  /** First rendered row: always label its first day with the month. */
  isFirstRow: boolean;
  handlers: CellHandlers;
}

function CalendarWeekRowComponent({
  row,
  columns,
  dayData,
  height,
  fill,
  budget,
  metrics,
  preferences,
  todayIso,
  selectedIso,
  dropTargetIso,
  focusMonth,
  showWeekday,
  isFirstRow,
  handlers,
}: CalendarWeekRowProps) {
  const isos = useMemo(() => row.days.map(toIsoDate), [row.days]);

  // Display filters shared by bars and chips.
  const { visibleScopes, showCompletedTasks, showFinance, defaultCurrency } = preferences;
  const isVisible = useMemo(
    () => (task: Task) => visibleScopes.includes(task.scope) && (showCompletedTasks || !task.is_completed),
    [visibleScopes, showCompletedTasks],
  );

  const { segments, laneCount } = useMemo(() => layoutRowBars(isos, dayData, isVisible), [isos, dayData, isVisible]);
  const lanesShown = Math.min(laneCount, budget);
  const itemSlotsPerDay = budget - lanesShown;
  const itemTrack = lanesShown + 2;

  // Header track, one track per shown lane, then the item track.
  const laneTracks = lanesShown > 0 ? `repeat(${lanesShown}, ${metrics.item + metrics.gap}px) ` : "";
  // Metrics are exposed to CSS as custom properties (cast: React's typings
  // do not know about `--*` keys).
  const cssVariables = {
    "--item-height": `${metrics.item}px`,
    "--item-gap": `${metrics.gap}px`,
    "--more-height": `${metrics.more}px`,
    "--row-padding-bottom": `${metrics.paddingBottom}px`,
  } as CSSProperties;
  const rowStyle: CSSProperties = {
    ...cssVariables,
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gridTemplateRows: `${metrics.header}px ${laneTracks}minmax(0, 1fr)`,
    ...(fill ? { minHeight: height } : { height }),
  };

  /** Map a pointer position to the day column under it. */
  const isoAt = (event: MouseEvent<HTMLDivElement> | DragEvent<HTMLDivElement>): IsoDate => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.min(columns - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * columns)));
    return isos[Math.min(col, isos.length - 1)];
  };

  return (
    <div
      className={fill ? "calendar-week is-fill" : "calendar-week"}
      style={rowStyle}
      data-row-key={row.key}
      // Read by dayAtPoint() to map a pointer position to a day during resize.
      data-row-isos={isos.join(",")}
      data-columns={columns}
      role="row"
      onClick={(event) => handlers.onSelect(isoAt(event))}
      onDoubleClick={(event) => handlers.onQuickAdd(isoAt(event))}
      onDragOver={(event) => {
        // preventDefault marks the row as a valid drop target, only for our own items.
        if (handlers.isDragging()) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          handlers.onDragOverDay(isoAt(event));
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        handlers.onDropDay(isoAt(event));
      }}
    >
      {/* Layer 1: day backgrounds (full height of each column). */}
      {row.days.map((date, col) => {
        const iso = isos[col];
        const outside =
          focusMonth !== null && (date.getMonth() !== focusMonth.month || date.getFullYear() !== focusMonth.year);
        const className = [
          "calendar-day-bg",
          outside ? "is-outside" : "",
          iso === todayIso ? "is-today" : "",
          iso === selectedIso ? "is-selected" : "",
          iso === dropTargetIso ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div
            key={`bg-${iso}`}
            className={className}
            style={{ gridColumn: col + 1, gridRow: "1 / -1" }}
            role="gridcell"
            aria-selected={iso === selectedIso}
            aria-label={iso}
          />
        );
      })}

      {/* Layer 2: day headers. */}
      {row.days.map((date, col) => {
        const iso = isos[col];
        const day = dayData[col];
        const hasMoney = showFinance && day !== undefined && (day.income_total > 0 || day.expense_total > 0);
        const hasPending = showFinance && day !== undefined && day.pending_expense_total > 0;
        const showMonth = date.getDate() === 1 || (isFirstRow && col === 0);
        const outside =
          focusMonth !== null && (date.getMonth() !== focusMonth.month || date.getFullYear() !== focusMonth.year);
        return (
          <div
            key={`hd-${iso}`}
            className={outside ? "calendar-day-header is-outside" : "calendar-day-header"}
            style={{ gridColumn: col + 1, gridRow: 1 }}
          >
            <span className="calendar-day-header__date">
              {showWeekday ? <span className="calendar-day-header__weekday">{formatWeekdayShort(date)}</span> : null}
              <span className={iso === todayIso ? "calendar-day-header__number is-today" : "calendar-day-header__number"}>
                {date.getDate()}
              </span>
              {showMonth ? <span className="calendar-day-header__month">{formatMonthShort(date)}</span> : null}
            </span>
            {hasMoney ? (
              <span
                className={day.net >= 0 ? "calendar-day-header__net is-positive" : "calendar-day-header__net is-negative"}
                title={hasPending ? `Includes ${formatMoney(day.pending_expense_total, defaultCurrency)} pending` : undefined}
              >
                {hasPending ? <span className="pending-dot" aria-label="Has pending payments" /> : null}
                {formatMoney(day.net, defaultCurrency, { signed: true, compact: true })}
              </span>
            ) : null}
          </div>
        );
      })}

      {/* Layer 3: multi-day bars, one grid item per row segment. */}
      {segments
        .filter((segment) => segment.lane < lanesShown)
        .map((segment) => (
          <TaskBar
            key={`bar-${segment.task.id}`}
            segment={segment}
            rowIsos={isos}
            style={{
              gridColumn: `${segment.startCol + 1} / span ${segment.endCol - segment.startCol + 1}`,
              gridRow: segment.lane + 2,
            }}
            onToggle={handlers.onToggleTask}
            onEdit={handlers.onEditTask}
            onDragStart={handlers.onDragStart}
            onDragEnd={handlers.onDragEnd}
            onResizeStart={handlers.onResizeStart}
            isResizing={handlers.isResizing}
          />
        ))}

      {/* Layer 4: each day's single-day tasks and finance entries. */}
      {row.days.map((_, col) => {
        const iso = isos[col];
        const day = dayData[col];
        const singles = (day?.tasks ?? []).filter((task) => !isMultiDay(task) && isVisible(task));
        const finance = showFinance ? (day?.finance ?? []) : [];

        const visibleSingles = singles.slice(0, Math.max(0, itemSlotsPerDay));
        const visibleFinance = finance.slice(0, Math.max(0, itemSlotsPerDay - visibleSingles.length));
        // Bars in lanes beyond what fits also count as hidden for this day.
        const hiddenBars = segments.filter(
          (segment) => segment.lane >= lanesShown && segment.startCol <= col && segment.endCol >= col,
        ).length;
        const hiddenCount =
          singles.length - visibleSingles.length + (finance.length - visibleFinance.length) + hiddenBars;

        return (
          <div key={`it-${iso}`} className="calendar-day-items" style={{ gridColumn: col + 1, gridRow: itemTrack }}>
            {visibleSingles.map((task) => (
              <TaskChip
                key={`t${task.id}`}
                task={task}
                iso={iso}
                onToggle={handlers.onToggleTask}
                onEdit={handlers.onEditTask}
                onDragStart={handlers.onDragStart}
                onDragEnd={handlers.onDragEnd}
                onResizeStart={handlers.onResizeStart}
                isResizing={handlers.isResizing}
              />
            ))}
            {visibleFinance.map((log) => (
              <FinanceChip
                key={`f${log.id}`}
                log={log}
                onEdit={handlers.onEditFinance}
                onDragStart={handlers.onDragStart}
                onDragEnd={handlers.onDragEnd}
              />
            ))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                className="calendar-day-items__more"
                onClick={(event) => {
                  event.stopPropagation();
                  handlers.onSelect(iso);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                +{hiddenCount} more
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Re-render only when something this row shows changed. `dayData` is a new
 * array on every parent render, so it is compared element by element (day
 * objects are replaced only when their data is refetched).
 */
function rowPropsEqual(previous: CalendarWeekRowProps, next: CalendarWeekRowProps): boolean {
  if (
    previous.row !== next.row ||
    previous.columns !== next.columns ||
    previous.height !== next.height ||
    previous.fill !== next.fill ||
    previous.budget !== next.budget ||
    previous.metrics !== next.metrics ||
    previous.preferences !== next.preferences ||
    previous.todayIso !== next.todayIso ||
    previous.selectedIso !== next.selectedIso ||
    previous.dropTargetIso !== next.dropTargetIso ||
    previous.showWeekday !== next.showWeekday ||
    previous.isFirstRow !== next.isFirstRow ||
    previous.handlers !== next.handlers ||
    previous.focusMonth?.year !== next.focusMonth?.year ||
    previous.focusMonth?.month !== next.focusMonth?.month ||
    previous.dayData.length !== next.dayData.length
  ) {
    return false;
  }
  return previous.dayData.every((day, index) => day === next.dayData[index]);
}

export const CalendarWeekRow = memo(CalendarWeekRowComponent, rowPropsEqual);
