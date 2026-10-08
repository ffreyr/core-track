/**
 * Interaction logic shared by the scrolling and paged calendars: selection,
 * quick-add, completion toggles, editors, drag-and-drop rescheduling and
 * drag-to-resize.
 *
 * Moving (HTML5 drag-and-drop): the dragged item lives in a ref (starting a
 * drag must not re-render every row); only the hovered drop-target day is
 * state. On drop the item moves by `drop − grab` days, so a multi-day bar
 * grabbed by its middle lands where the pointer is, and the backend's
 * "due_date-only PATCH keeps the task's length" rule moves the whole block.
 *
 * Resizing (pointer events): pressing a task's right-edge handle starts a
 * session tracked in a ref (for the window listeners) and mirrored into
 * state (for rendering). While the pointer moves, the day under it becomes
 * the preview end date; the calendars overlay that preview onto their data
 * (see resize.ts), so the bar visibly stretches. Releasing commits
 * `PATCH {end_date}`; Escape cancels. After a successful commit the preview
 * stays "settled" until the calendar reports fresh data via
 * `acknowledgeData()`, so the bar never flickers back to its old length.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type IsoDate, type Task } from "../../api";
import { useApiAction } from "../../hooks/useApi";
import { addDays, diffInDays, formatShortDay, parseIsoDate, toIsoDate } from "../../lib/dates";
import { useEditors } from "../editors/EditorsProvider";
import { clampResizeEnd, dayAtPoint, type ResizePreview } from "./resize";
import type { CellHandlers, DragItem } from "./types";

export interface CalendarInteractions {
  handlers: CellHandlers;
  dropTargetIso: IsoDate | null;
  toggleTask: (task: Task) => void;
  /** Active resize preview to overlay onto calendar data, or `null`. */
  resizePreview: ResizePreview | null;
  /** Call whenever calendar data refreshes; releases a settled preview. */
  acknowledgeData: () => void;
}

/** Body class applied during a resize (global ew-resize cursor, no text selection). */
const RESIZING_BODY_CLASS = "is-resizing-task";

export function useCalendarInteractions(onSelectIso: (iso: IsoDate | null) => void): CalendarInteractions {
  const { openTask, openFinance } = useEditors();
  const run = useApiAction();

  const toggleTask = useCallback(
    (task: Task) => {
      void run(() => api.tasks.toggle(task.id));
    },
    [run],
  );

  // ---- Move (HTML5 drag-and-drop) ------------------------------------------

  const dragItem = useRef<DragItem | null>(null);
  const [dropTargetIso, setDropTargetIso] = useState<IsoDate | null>(null);

  /** Apply a drop: shift the item by the distance between grabbed and dropped day. */
  const moveItem = useCallback(
    async (item: DragItem, dropIso: IsoDate) => {
      const delta = diffInDays(parseIsoDate(item.grabIso), parseIsoDate(dropIso));
      if (delta === 0) {
        return;
      }
      const newIso = toIsoDate(addDays(parseIsoDate(item.originIso), delta));
      const label = formatShortDay(parseIsoDate(newIso));
      if (item.type === "task") {
        await run(() => api.tasks.update(item.id, { due_date: newIso }), { success: `Task moved to ${label}` });
      } else {
        await run(() => api.finance.update(item.id, { occurred_on: newIso }), { success: `Entry moved to ${label}` });
      }
    },
    [run],
  );

  // ---- Resize (pointer events) ---------------------------------------------

  const resizing = useRef<ResizePreview | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  /** Removes the window listeners of the active session (if any). */
  const detachListeners = useRef<(() => void) | null>(null);

  /** Update the session in the ref (for listeners) and in state (for rendering). */
  const setSession = useCallback((next: ResizePreview | null) => {
    resizing.current = next;
    setResizePreview(next);
  }, []);

  /** Persist the previewed end date. */
  const commitResize = useCallback(async () => {
    const session = resizing.current;
    if (!session) {
      return;
    }
    if (session.previewEnd === session.originalEnd) {
      setSession(null); // Released where it started: nothing to save.
      return;
    }
    const committing: ResizePreview = { ...session, phase: "committing" };
    setSession(committing);
    const { task, previewEnd } = session;
    const endDate = previewEnd === task.due_date ? null : previewEnd;
    const message = endDate
      ? `"${task.title}" now ends ${formatShortDay(parseIsoDate(endDate))}`
      : `"${task.title}" is a single-day task again`;
    const result = await run(() => api.tasks.update(task.id, { end_date: endDate }), { success: message });
    // Only touch the session if it is still this one (the user may already
    // have started another resize while the request was in flight).
    if (resizing.current !== committing) {
      return;
    }
    if (!result.ok) {
      setSession(null); // Snap back; the error toast explains why.
      return;
    }
    setSession({ ...committing, phase: "settled" });
  }, [run, setSession]);

  const startResize = useCallback(
    (task: Task) => {
      // Ignore a second press mid-drag; a committing/settled session may be replaced.
      if (resizing.current?.phase === "dragging") {
        return;
      }
      const originalEnd = task.end_date ?? task.due_date;
      setSession({ task, originalEnd, previewEnd: originalEnd, phase: "dragging" });
      document.body.classList.add(RESIZING_BODY_CLASS);

      const onMove = (event: PointerEvent) => {
        const session = resizing.current;
        if (!session || session.phase !== "dragging") {
          return;
        }
        const iso = dayAtPoint(event.clientX, event.clientY);
        if (iso === null) {
          return; // Outside the grid: keep the last preview.
        }
        const previewEnd = clampResizeEnd(task.due_date, iso);
        if (previewEnd !== session.previewEnd) {
          setSession({ ...session, previewEnd });
        }
      };

      // The click that follows pointerup would select whatever day the
      // pointer ended on; swallow that one click.
      const swallowClick = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };

      const detach = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown, true);
        document.body.classList.remove(RESIZING_BODY_CLASS);
        detachListeners.current = null;
      };

      function onUp() {
        detach();
        window.addEventListener("click", swallowClick, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallowClick, { capture: true }), 0);
        void commitResize();
      }

      function onCancel() {
        detach();
        setSession(null);
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          event.stopPropagation(); // Do not also close the day panel.
          onCancel();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown, true);
      detachListeners.current = detach;
    },
    [commitResize, setSession],
  );

  // Never leave window listeners behind if the calendar unmounts mid-resize.
  useEffect(() => () => detachListeners.current?.(), []);

  const acknowledgeData = useCallback(() => {
    if (resizing.current?.phase === "settled") {
      setSession(null);
    }
  }, [setSession]);

  // ---- Handlers bundle -----------------------------------------------------

  const handlers = useMemo<CellHandlers>(
    () => ({
      onSelect: (iso) => onSelectIso(iso),
      onQuickAdd: (iso) => openTask({ date: iso }),
      onToggleTask: toggleTask,
      onEditTask: (task) => openTask({ task }),
      onEditFinance: (log) => openFinance({ log }),
      onDragStart: (item) => {
        dragItem.current = item;
      },
      onDragEnd: () => {
        dragItem.current = null;
        setDropTargetIso(null);
      },
      // React bails out when the value is unchanged, so this is cheap on every dragover.
      onDragOverDay: (iso) => setDropTargetIso(iso),
      onDropDay: (iso) => {
        const item = dragItem.current;
        dragItem.current = null;
        setDropTargetIso(null);
        if (item) {
          void moveItem(item, iso);
        }
      },
      isDragging: () => dragItem.current !== null,
      onResizeStart: startResize,
      isResizing: () => resizing.current?.phase === "dragging",
    }),
    [onSelectIso, openTask, openFinance, toggleTask, moveItem, startResize],
  );

  return { handlers, dropTargetIso, toggleTask, resizePreview, acknowledgeData };
}
