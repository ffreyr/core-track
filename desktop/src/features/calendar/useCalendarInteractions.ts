/**
 * Interaction logic shared by the scrolling and paged calendars: selection,
 * quick-add, completion toggles, editors and drag-and-drop rescheduling.
 *
 * Drag-and-drop: the dragged item lives in a ref (starting a drag must not
 * re-render every row); only the hovered drop-target day is state. On drop
 * the item moves by `drop − grab` days, so a multi-day bar grabbed by its
 * middle lands where the pointer is, and the backend's "due_date-only PATCH
 * keeps the task's length" rule moves the whole block.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { api, type IsoDate, type Task } from "../../api";
import { useApiAction } from "../../hooks/useApi";
import { addDays, diffInDays, formatShortDay, parseIsoDate, toIsoDate } from "../../lib/dates";
import { useEditors } from "../editors/EditorsProvider";
import type { CellHandlers, DragItem } from "./types";

export interface CalendarInteractions {
  handlers: CellHandlers;
  dropTargetIso: IsoDate | null;
  toggleTask: (task: Task) => void;
}

export function useCalendarInteractions(onSelectIso: (iso: IsoDate | null) => void): CalendarInteractions {
  const { openTask, openFinance } = useEditors();
  const run = useApiAction();

  const toggleTask = useCallback(
    (task: Task) => {
      void run(() => api.tasks.toggle(task.id));
    },
    [run],
  );

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
    }),
    [onSelectIso, openTask, openFinance, toggleTask, moveItem],
  );

  return { handlers, dropTargetIso, toggleTask };
}
