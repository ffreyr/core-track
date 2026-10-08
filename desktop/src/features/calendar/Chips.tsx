/**
 * Items rendered inside calendar rows.
 *
 *  - {@link TaskChip}    – a single-day task inside one day's item list.
 *  - {@link TaskBar}     – a multi-day task drawn as one block spanning
 *                          several columns (positioned by the week row).
 *  - {@link FinanceChip} – an income/expense entry; pending entries are drawn
 *                          with a dashed outline.
 *
 * All items are draggable. Pointer events stop at the item so clicking it
 * edits it instead of selecting the day, and double-clicking it does not
 * trigger the row's quick-add.
 *
 * Tasks additionally have a right-edge {@link ResizeHandle}: pressing it
 * starts a pointer-driven resize of the task's end date (see
 * useCalendarInteractions). A single-day chip resized to the right becomes a
 * multi-day bar.
 */

import type { CSSProperties, DragEvent, MouseEvent } from "react";

import type { FinanceLog, IsoDate, Task } from "../../api";
import { ScopeBadge } from "../../components/controls";
import { SCOPE_META } from "../../lib/labels";
import { formatMoney } from "../../lib/money";
import type { BarSegment } from "./spans";
import type { DragItem } from "./types";

/** Keep item clicks from bubbling to the row (select / quick-add). */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

/**
 * Start an HTML5 drag; the payload itself is tracked by the calendar in a ref.
 *
 * When the pointer went down on a resize handle, the browser still tries to
 * drag the (draggable) chip as soon as the pointer moves; `isResizing` lets
 * us cancel that native drag so only the resize happens.
 */
function beginDrag(
  event: DragEvent,
  label: string,
  item: DragItem,
  onDragStart: (item: DragItem) => void,
  isResizing: () => boolean,
) {
  if (isResizing()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  // Some engines refuse to start a drag without data; the value is informational.
  event.dataTransfer.setData("text/plain", label);
  onDragStart(item);
}

/**
 * Ref callback reflecting "in progress" as the checkbox's native
 * indeterminate state (a dash), which has no HTML attribute equivalent.
 */
function inProgressRef(task: Task) {
  return (element: HTMLInputElement | null) => {
    if (element) {
      element.indeterminate = task.status === "in_progress";
    }
  };
}

/** Tooltip suffix describing the task's status. */
function statusNote(task: Task): string {
  return task.status === "in_progress" ? " · In progress" : task.status === "done" ? " · Done" : "";
}

/** Accent color of a task: its own color, else its scope color. */
function taskAccent(task: Task): string {
  return task.color ?? SCOPE_META[task.scope].color;
}

/**
 * Grip on the right edge of a task. Pressing it (primary button) starts a
 * resize; `preventDefault` stops text selection and focus changes, and
 * `stopPropagation` keeps the row from treating the press as a day click.
 */
function ResizeHandle({ task, onResizeStart }: { task: Task; onResizeStart: (task: Task) => void }) {
  return (
    <span
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize "${task.title}"`}
      title="Drag to change the end date"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onResizeStart(task);
      }}
      onClick={stop}
      onDoubleClick={stop}
    />
  );
}

// ---------------------------------------------------------------------------
// Single-day task
// ---------------------------------------------------------------------------

interface TaskChipProps {
  task: Task;
  /** Day this chip is rendered on. */
  iso: IsoDate;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onResizeStart: (task: Task) => void;
  isResizing: () => boolean;
}

/** A single-day task: checkbox, title and scope badge, tinted by color/scope. */
export function TaskChip({
  task,
  iso,
  onToggle,
  onEdit,
  onDragStart,
  onDragEnd,
  onResizeStart,
  isResizing,
}: TaskChipProps) {
  const className = [
    "chip",
    "chip--task",
    task.is_completed ? "is-done" : "",
    task.status === "in_progress" ? "is-in-progress" : "",
    task.priority === 3 ? "is-high-priority" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      style={{ "--chip-accent": taskAccent(task) } as CSSProperties}
      draggable
      onDragStart={(event) =>
        beginDrag(
          event,
          task.title,
          { type: "task", id: task.id, originIso: task.due_date, grabIso: iso },
          onDragStart,
          isResizing,
        )
      }
      onDragEnd={onDragEnd}
      onClick={stop}
      onDoubleClick={stop}
      title={`${task.title}${statusNote(task)}${task.description ? `\n\n${task.description}` : ""}`}
    >
      <input
        ref={inProgressRef(task)}
        type="checkbox"
        className="chip__check"
        checked={task.is_completed}
        onChange={() => onToggle(task)}
        aria-label={task.is_completed ? `Reopen "${task.title}"` : `Complete "${task.title}"`}
      />
      <button type="button" className="chip__label" onClick={() => onEdit(task)}>
        {task.title}
      </button>
      <ScopeBadge scope={task.scope} />
      <ResizeHandle task={task} onResizeStart={onResizeStart} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-day task bar
// ---------------------------------------------------------------------------

interface TaskBarProps {
  segment: BarSegment;
  /** ISO dates of the row's columns, used to find the grabbed day. */
  rowIsos: IsoDate[];
  /** Grid placement computed by the row (column span + lane track). */
  style: CSSProperties;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
  onResizeStart: (task: Task) => void;
  isResizing: () => boolean;
}

/**
 * A multi-day task drawn as one continuous block across its columns.
 *
 * Edges that continue into the previous/next row are drawn flat with an
 * arrow, so the user can tell the bar is a fragment of a longer task.
 *
 * The resize handle is shown only on the segment that contains the task's
 * real last day (`!continuesAfter`), exactly where Google Calendar puts it.
 */
export function TaskBar({
  segment,
  rowIsos,
  style,
  onToggle,
  onEdit,
  onDragStart,
  onDragEnd,
  onResizeStart,
  isResizing,
}: TaskBarProps) {
  const { task, startCol, endCol, continuesBefore, continuesAfter } = segment;
  const className = [
    "task-bar",
    task.is_completed ? "is-done" : "",
    task.status === "in_progress" ? "is-in-progress" : "",
    continuesBefore ? "continues-before" : "",
    continuesAfter ? "continues-after" : "",
  ]
    .filter(Boolean)
    .join(" ");

  /** Which of the bar's days is under the pointer (for drag offset). */
  const grabbedIso = (event: DragEvent<HTMLDivElement>): IsoDate => {
    const rect = event.currentTarget.getBoundingClientRect();
    const spanCols = endCol - startCol + 1;
    const offset = Math.min(spanCols - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * spanCols)));
    return rowIsos[startCol + offset];
  };

  const range = `${task.due_date} → ${task.end_date ?? task.due_date}`;

  return (
    <div
      className={className}
      style={{ ...style, "--chip-accent": taskAccent(task) } as CSSProperties}
      draggable
      onDragStart={(event) =>
        beginDrag(
          event,
          task.title,
          { type: "task", id: task.id, originIso: task.due_date, grabIso: grabbedIso(event) },
          onDragStart,
          isResizing,
        )
      }
      onDragEnd={onDragEnd}
      onClick={stop}
      onDoubleClick={stop}
      title={`${task.title} (${task.span_days} days: ${range})${statusNote(task)}${task.description ? `\n\n${task.description}` : ""}`}
    >
      {continuesBefore ? <span className="task-bar__arrow" aria-hidden="true">‹</span> : null}
      <input
        ref={inProgressRef(task)}
        type="checkbox"
        className="chip__check"
        checked={task.is_completed}
        onChange={() => onToggle(task)}
        aria-label={task.is_completed ? `Reopen "${task.title}"` : `Complete "${task.title}"`}
      />
      <button type="button" className="task-bar__label" onClick={() => onEdit(task)}>
        {task.title}
      </button>
      <ScopeBadge scope={task.scope} />
      {continuesAfter ? (
        <span className="task-bar__arrow" aria-hidden="true">›</span>
      ) : (
        <ResizeHandle task={task} onResizeStart={onResizeStart} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Finance entry
// ---------------------------------------------------------------------------

interface FinanceChipProps {
  log: FinanceLog;
  onEdit: (log: FinanceLog) => void;
  onDragStart: (item: DragItem) => void;
  onDragEnd: () => void;
}

/** An income (green, "+") or expense (red, "−") entry; dashed when still pending. */
export function FinanceChip({ log, onEdit, onDragStart, onDragEnd }: FinanceChipProps) {
  const signedAmount = log.kind === "income" ? log.amount : -log.amount;
  const status = log.is_paid ? "" : log.kind === "income" ? " (expected)" : " (pending)";
  return (
    <button
      type="button"
      className={`chip chip--finance chip--${log.kind}${log.is_paid ? "" : " is-pending"}`}
      draggable
      onDragStart={(event) =>
        beginDrag(
          event,
          log.category,
          { type: "finance", id: log.id, originIso: log.occurred_on, grabIso: log.occurred_on },
          onDragStart,
          () => false,
        )
      }
      onDragEnd={onDragEnd}
      onClick={(event) => {
        stop(event);
        onEdit(log);
      }}
      onDoubleClick={stop}
      title={`${log.category}${status}${log.description ? `: ${log.description}` : ""}`}
    >
      <span className="chip__amount">{formatMoney(signedAmount, log.currency, { signed: true, compact: true })}</span>
      <span className="chip__category">{log.category}</span>
    </button>
  );
}
