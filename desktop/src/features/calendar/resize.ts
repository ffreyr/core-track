/**
 * Drag-to-resize helpers (pure functions + DOM hit testing).
 *
 * Resizing changes a task's `end_date` by dragging the right edge of its
 * chip/bar. Unlike moving (HTML5 drag-and-drop), resizing uses pointer
 * events so the calendar can render a live preview while the pointer moves.
 *
 * Preview strategy: instead of special-casing the renderer, the loaded
 * calendar data is *overlaid* with a patched copy of the task
 * ({@link applyResizePreview}). Every existing rendering path — lane
 * packing, multi-row bars, "+N more" — then shows the stretched task for
 * free. Only the days whose content changes get new objects, so memoised
 * week rows that are not affected do not re-render.
 */

import type { CalendarDay, IsoDate, Task } from "../../api";
import { addDays, diffInDays, parseIsoDate, toIsoDate } from "../../lib/dates";

/** Longest allowed span (inclusive), matching the backend's MAX_TASK_SPAN_DAYS. */
export const MAX_RESIZE_SPAN_DAYS = 366;

/**
 * State of an in-progress resize.
 *
 * - `dragging`   – pointer is down; `previewEnd` follows the pointer.
 * - `committing` – pointer released; the PATCH request is in flight.
 * - `settled`    – the server accepted it; the overlay stays until the next
 *                  data refresh arrives, so the bar never snaps back to its
 *                  old length in between.
 */
export interface ResizePreview {
  task: Task;
  originalEnd: IsoDate;
  previewEnd: IsoDate;
  phase: "dragging" | "committing" | "settled";
}

/** Clamp a candidate end date: never before the start, never beyond the max span. */
export function clampResizeEnd(dueIso: IsoDate, candidate: IsoDate): IsoDate {
  if (candidate < dueIso) {
    return dueIso;
  }
  const span = diffInDays(parseIsoDate(dueIso), parseIsoDate(candidate)) + 1;
  return span > MAX_RESIZE_SPAN_DAYS
    ? toIsoDate(addDays(parseIsoDate(dueIso), MAX_RESIZE_SPAN_DAYS - 1))
    : candidate;
}

/** A copy of `task` ending on `endIso` (single-day when it ends on its start). */
export function taskWithEnd(task: Task, endIso: IsoDate): Task {
  const singleDay = endIso === task.due_date;
  return {
    ...task,
    end_date: singleDay ? null : endIso,
    span_days: diffInDays(parseIsoDate(task.due_date), parseIsoDate(endIso)) + 1,
  };
}

/**
 * Overlay a resize preview onto loaded calendar days.
 *
 * Days from the task's start through `max(originalEnd, previewEnd)` are
 * rewritten: days inside the preview range contain the patched task (placed
 * first, as multi-day tasks are), days beyond it no longer contain the task.
 * Every other day keeps its original object identity.
 */
export function applyResizePreview(
  days: Map<IsoDate, CalendarDay>,
  preview: ResizePreview | null,
): Map<IsoDate, CalendarDay> {
  if (preview === null) {
    return days;
  }
  const { task, originalEnd, previewEnd } = preview;
  const patched = taskWithEnd(task, previewEnd);
  const lastAffected = originalEnd > previewEnd ? originalEnd : previewEnd;

  const next = new Map(days);
  let cursor = parseIsoDate(task.due_date);
  const stop = parseIsoDate(lastAffected);
  while (cursor <= stop) {
    const iso = toIsoDate(cursor);
    const day = days.get(iso);
    if (day) {
      const others = day.tasks.filter((candidate) => candidate.id !== task.id);
      next.set(iso, { ...day, tasks: iso <= previewEnd ? [patched, ...others] : others });
    }
    cursor = addDays(cursor, 1);
  }
  return next;
}

/**
 * Find the calendar day under a screen point.
 *
 * Week rows expose their column dates (`data-row-isos`) and column count
 * (`data-columns`); the column is derived from the pointer's x position, so
 * this works even when the pointer is over a bar or chip inside the row.
 *
 * @returns The ISO date, or `null` when the point is not over a week row.
 */
export function dayAtPoint(clientX: number, clientY: number): IsoDate | null {
  const element = document.elementFromPoint(clientX, clientY);
  const row = element?.closest<HTMLElement>("[data-row-isos]");
  if (!row) {
    return null;
  }
  const isos = (row.dataset.rowIsos ?? "").split(",").filter(Boolean);
  const columns = Number(row.dataset.columns) || isos.length;
  if (isos.length === 0) {
    return null;
  }
  const rect = row.getBoundingClientRect();
  const col = Math.min(columns - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * columns)));
  return isos[Math.min(col, isos.length - 1)];
}
