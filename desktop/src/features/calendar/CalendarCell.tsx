/**
 * One day in the calendar grid.
 *
 * Rendering rules:
 *  - Tasks are filtered by the visible scopes and the "show completed"
 *    preference; finance chips appear only when finance is enabled.
 *  - Tasks are listed before money (they are the actionable part), in the
 *    server's order: highest priority first.
 *  - In multi-row views each cell shows at most `maxItems` chips and
 *    collapses the rest into "+N more", which opens the day panel.
 *  - The header shows the day number (plus the month on the 1st and on the
 *    very first cell, so month boundaries are obvious) and the day's net.
 *
 * Interaction:
 *  - Click → select the day.  Double-click empty space → new task on that day.
 *  - Acts as a drop target while a chip is being dragged.
 */

import { memo } from "react";

import type { CalendarDay, IsoDate } from "../../api";
import { formatMonthShort, formatWeekdayShort } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import type { Preferences } from "../../state/preferences";
import { FinanceChip, TaskChip } from "./Chips";
import type { CellHandlers } from "./types";

interface CalendarCellProps {
  date: Date;
  iso: IsoDate;
  /** Server data for this day; `undefined` while loading. */
  day: CalendarDay | undefined;
  /** First cell in the grid (always labelled with its month). */
  isFirstCell: boolean;
  /** Dim the cell (month view, day belongs to an adjacent month). */
  outsideFocusMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDropTarget: boolean;
  /** Label the weekday inside the cell (views without a weekday header). */
  showWeekday: boolean;
  preferences: Preferences;
  /** Chip limit before collapsing into "+N more" (`Infinity` = no limit). */
  maxItems: number;
  handlers: CellHandlers;
}

function CalendarCellComponent({
  date,
  iso,
  day,
  isFirstCell,
  outsideFocusMonth,
  isToday,
  isSelected,
  isDropTarget,
  showWeekday,
  preferences,
  maxItems,
  handlers,
}: CalendarCellProps) {
  const tasks = (day?.tasks ?? []).filter(
    (task) =>
      preferences.visibleScopes.includes(task.scope) && (preferences.showCompletedTasks || !task.is_completed),
  );
  const finance = preferences.showFinance ? (day?.finance ?? []) : [];

  // Fill the chip budget with tasks first, then finance entries.
  const totalItems = tasks.length + finance.length;
  const budget = Math.min(maxItems, totalItems);
  const visibleTasks = tasks.slice(0, budget);
  const visibleFinance = finance.slice(0, Math.max(0, budget - visibleTasks.length));
  const hiddenCount = totalItems - visibleTasks.length - visibleFinance.length;

  const hasMoney = preferences.showFinance && day !== undefined && (day.income_total > 0 || day.expense_total > 0);
  const showMonthLabel = isFirstCell || date.getDate() === 1;

  const className = [
    "calendar-cell",
    outsideFocusMonth ? "is-outside" : "",
    isToday ? "is-today" : "",
    isSelected ? "is-selected" : "",
    isDropTarget ? "is-drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="gridcell"
      aria-selected={isSelected}
      aria-label={iso}
      onClick={() => handlers.onSelect(iso)}
      onDoubleClick={() => handlers.onQuickAdd(iso)}
      onDragOver={(event) => {
        // preventDefault marks the cell as a valid drop target, but only for our own chips.
        if (handlers.isDragging()) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={() => {
        if (handlers.isDragging()) {
          handlers.onDragEnter(iso);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        handlers.onDrop(iso);
      }}
    >
      <div className="calendar-cell__header">
        <span className="calendar-cell__date">
          {showWeekday ? <span className="calendar-cell__weekday">{formatWeekdayShort(date)}</span> : null}
          <span className="calendar-cell__number">{date.getDate()}</span>
          {showMonthLabel ? <span className="calendar-cell__month">{formatMonthShort(date)}</span> : null}
        </span>
        {hasMoney ? (
          <span className={day.net >= 0 ? "calendar-cell__net is-positive" : "calendar-cell__net is-negative"}>
            {formatMoney(day.net, preferences.defaultCurrency, { signed: true, compact: true })}
          </span>
        ) : null}
      </div>

      <div className="calendar-cell__items">
        {visibleTasks.map((task) => (
          <TaskChip
            key={`t${task.id}`}
            task={task}
            onToggle={handlers.onToggleTask}
            onEdit={handlers.onEditTask}
            onDragStart={() => handlers.onDragStart({ type: "task", id: task.id, fromDate: iso })}
            onDragEnd={handlers.onDragEnd}
          />
        ))}
        {visibleFinance.map((log) => (
          <FinanceChip
            key={`f${log.id}`}
            log={log}
            onEdit={handlers.onEditFinance}
            onDragStart={() => handlers.onDragStart({ type: "finance", id: log.id, fromDate: iso })}
            onDragEnd={handlers.onDragEnd}
          />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="calendar-cell__more"
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
    </div>
  );
}

/**
 * Memoised: during polling, the parent re-renders but most days' data objects
 * are replaced only when the response arrives, and drag-hover changes only
 * touch two cells.
 */
export const CalendarCell = memo(CalendarCellComponent);
