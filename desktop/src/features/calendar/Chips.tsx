/**
 * Compact items rendered inside calendar cells.
 *
 * Both chip types are draggable: dropping one on another day reschedules the
 * task (or moves the finance entry) via a PATCH request. Pointer events are
 * stopped at the chip so clicking a chip edits it instead of selecting the
 * day, and double-clicking it does not trigger the cell's quick-add.
 */

import type { CSSProperties, DragEvent, MouseEvent } from "react";

import type { FinanceLog, Task } from "../../api";
import { ScopeBadge } from "../../components/controls";
import { SCOPE_META } from "../../lib/labels";
import { formatMoney } from "../../lib/money";

/** Keep chip clicks from bubbling to the cell (select / quick-add). */
function stop(event: MouseEvent) {
  event.stopPropagation();
}

/** Start an HTML5 drag; the payload itself is tracked by the calendar in a ref. */
function beginDrag(event: DragEvent, label: string, onDragStart: () => void) {
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  // Some engines refuse to start a drag without data; the value is informational.
  event.dataTransfer.setData("text/plain", label);
  onDragStart();
}

interface TaskChipProps {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** A task inside a cell: checkbox, title and scope badge, tinted by color/scope. */
export function TaskChip({ task, onToggle, onEdit, onDragStart, onDragEnd }: TaskChipProps) {
  const accent = task.color ?? SCOPE_META[task.scope].color;
  const className = [
    "chip",
    "chip--task",
    task.is_completed ? "is-done" : "",
    task.priority === 3 ? "is-high-priority" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      style={{ "--chip-accent": accent } as CSSProperties}
      draggable
      onDragStart={(event) => beginDrag(event, task.title, onDragStart)}
      onDragEnd={onDragEnd}
      onClick={stop}
      onDoubleClick={stop}
      title={task.description ? `${task.title}\n\n${task.description}` : task.title}
    >
      <input
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
    </div>
  );
}

interface FinanceChipProps {
  log: FinanceLog;
  onEdit: (log: FinanceLog) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** An income (green, "+") or expense (red, "−") entry inside a cell. */
export function FinanceChip({ log, onEdit, onDragStart, onDragEnd }: FinanceChipProps) {
  const signedAmount = log.kind === "income" ? log.amount : -log.amount;
  return (
    <button
      type="button"
      className={`chip chip--finance chip--${log.kind}`}
      draggable
      onDragStart={(event) => beginDrag(event, log.category, onDragStart)}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        stop(event);
        onEdit(log);
      }}
      onDoubleClick={stop}
      title={log.description ? `${log.category}: ${log.description}` : log.category}
    >
      <span className="chip__amount">{formatMoney(signedAmount, log.currency, { signed: true, compact: true })}</span>
      <span className="chip__category">{log.category}</span>
    </button>
  );
}
