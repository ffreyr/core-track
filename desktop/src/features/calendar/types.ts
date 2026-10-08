/**
 * Shared types for the calendar feature.
 */

import type { FinanceLog, IsoDate, Task } from "../../api";

/**
 * What is currently being dragged across the grid.
 *
 * `grabIso` is the day under the pointer when the drag started. For a
 * multi-day bar grabbed by its third day, dropping on Thursday moves the
 * task so that its *third* day lands on Thursday — the same behaviour as
 * Google Calendar. The move is therefore `drop − grab` days applied to
 * `originIso` (the item's own start date).
 */
export interface DragItem {
  type: "task" | "finance";
  id: number;
  /** `due_date` of a task / `occurred_on` of a finance entry. */
  originIso: IsoDate;
  /** Day the pointer grabbed. */
  grabIso: IsoDate;
}

/**
 * Callbacks the grid needs. Bundled into one memoised object so `React.memo`
 * week rows only re-render when their own data changes.
 */
export interface CellHandlers {
  /** Select a day (opens the day panel). */
  onSelect: (iso: IsoDate) => void;
  /** Double-click on empty space: create a task on that day. */
  onQuickAdd: (iso: IsoDate) => void;
  onToggleTask: (task: Task) => void;
  onEditTask: (task: Task) => void;
  onEditFinance: (log: FinanceLog) => void;
  /** A chip or bar started dragging. */
  onDragStart: (item: DragItem) => void;
  /** The drag ended (dropped anywhere or cancelled). */
  onDragEnd: () => void;
  /** The pointer is over a day while dragging. */
  onDragOverDay: (iso: IsoDate) => void;
  /** An item was dropped onto a day. */
  onDropDay: (iso: IsoDate) => void;
  /** `true` while one of our items is being dragged (ignore foreign drags). */
  isDragging: () => boolean;
  /** The right-edge resize handle of a task was pressed. */
  onResizeStart: (task: Task) => void;
  /**
   * `true` while a resize is in progress. Chips use it to cancel the native
   * HTML5 drag their (draggable) element would otherwise start when the
   * pointer moves from the resize handle.
   */
  isResizing: () => boolean;
}
