/**
 * Shared types for the calendar feature.
 */

import type { FinanceLog, IsoDate, Task } from "../../api";

/** What is currently being dragged across the grid. */
export type DragItem =
  | { type: "task"; id: number; fromDate: IsoDate }
  | { type: "finance"; id: number; fromDate: IsoDate };

/**
 * Callbacks a calendar cell needs. They are bundled into one memoised object
 * so `React.memo` cells only re-render when their own day data changes.
 */
export interface CellHandlers {
  /** Select a day (opens the day panel). */
  onSelect: (iso: IsoDate) => void;
  /** Double-click on empty space: create a task on that day. */
  onQuickAdd: (iso: IsoDate) => void;
  onToggleTask: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onEditFinance: (log: FinanceLog) => void;
  /** A chip started dragging. */
  onDragStart: (item: DragItem) => void;
  /** The drag ended (dropped anywhere or cancelled). */
  onDragEnd: () => void;
  /** The pointer entered a cell while dragging. */
  onDragEnter: (iso: IsoDate) => void;
  /** A chip was dropped onto a cell. */
  onDrop: (iso: IsoDate) => void;
  /** `true` while one of our chips is being dragged (ignore foreign drags). */
  isDragging: () => boolean;
}
