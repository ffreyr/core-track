/**
 * Calendar screen: the heart of the app.
 *
 * Data flow:
 *   preferences + anchor ──► computeCalendarLayout ──► visible range
 *   visible range ──► GET /api/calendar ──► Map<date, CalendarDay> ──► grid
 *
 * Interactions handled here (cells and chips only report intent):
 *  - Navigation (toolbar arrows, Today, ← / → / T shortcuts).
 *  - Day selection → DayPanel.
 *  - Drag-and-drop rescheduling → PATCH due_date / occurred_on.
 *  - Completion toggles, quick-add (double-click / N shortcut), editors.
 *
 * Every mutation goes through `useApiAction`, which invalidates the data
 * version, so the calendar refetches and reflects the change automatically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type CalendarDay, type IsoDate, type Task } from "../../api";
import { ErrorNotice } from "../../components/controls";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import { formatShortDay, parseIsoDate, toIsoDate, today } from "../../lib/dates";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";
import { CalendarGrid } from "./CalendarGrid";
import { CalendarSettings } from "./CalendarSettings";
import { CalendarToolbar } from "./CalendarToolbar";
import { DayPanel } from "./DayPanel";
import { computeCalendarLayout, shiftAnchor } from "./layout";
import type { CellHandlers, DragItem } from "./types";

interface CalendarViewProps {
  /** Date the view is positioned around (owned by App so other tabs can jump here). */
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  /** Day shown in the side panel, or `null`. */
  selectedIso: IsoDate | null;
  onSelectIso: (iso: IsoDate | null) => void;
}

/** `true` when a key event comes from a text field (shortcuts must not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function CalendarView({ anchor, onAnchorChange, selectedIso, onSelectIso }: CalendarViewProps) {
  const { preferences, updatePreferences } = usePreferences();
  const { openTask, openFinance } = useEditors();
  const run = useApiAction();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- Layout & data ------------------------------------------------------

  const layout = useMemo(
    () => computeCalendarLayout(preferences.viewMode, anchor, preferences),
    [preferences, anchor],
  );
  const startIso = toIsoDate(layout.rangeStart);
  const endIso = toIsoDate(layout.rangeEnd);

  const query = useApiQuery((signal) => api.calendar.get(startIso, endIso, signal), [startIso, endIso]);

  const dayMap = useMemo(() => {
    const map = new Map<IsoDate, CalendarDay>();
    for (const day of query.data?.days ?? []) {
      map.set(day.date, day);
    }
    return map;
  }, [query.data]);

  const todayIso = toIsoDate(today());

  // Close the day panel when navigation moves the selected day out of view.
  useEffect(() => {
    if (selectedIso !== null && (selectedIso < startIso || selectedIso > endIso)) {
      onSelectIso(null);
    }
  }, [selectedIso, startIso, endIso, onSelectIso]);

  // ---- Navigation ---------------------------------------------------------

  const goRelative = useCallback(
    (direction: 1 | -1) => {
      onAnchorChange(shiftAnchor(preferences.viewMode, anchor, direction, preferences));
    },
    [anchor, onAnchorChange, preferences],
  );

  const goToday = useCallback(() => {
    onAnchorChange(today());
    onSelectIso(toIsoDate(today()));
  }, [onAnchorChange, onSelectIso]);

  // Keyboard shortcuts: ← / → page, T today, N new task, Esc close panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      // Leave the keyboard to an open dialog.
      if (document.querySelector(".modal-backdrop")) {
        return;
      }
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          goRelative(-1);
          break;
        case "ArrowRight":
          event.preventDefault();
          goRelative(1);
          break;
        case "t":
        case "T":
          goToday();
          break;
        case "n":
        case "N":
          openTask({ date: selectedIso ?? todayIso });
          break;
        case "Escape":
          onSelectIso(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goRelative, goToday, openTask, selectedIso, todayIso, onSelectIso]);

  // ---- Mutations ----------------------------------------------------------

  const toggleTask = useCallback(
    (task: Task) => {
      void run(() => api.tasks.toggle(task.id));
    },
    [run],
  );

  // ---- Drag and drop ------------------------------------------------------
  // The dragged item lives in a ref (not state) so starting a drag does not
  // re-render all cells; only the hovered drop target is state.

  const dragItem = useRef<DragItem | null>(null);
  const [dropTargetIso, setDropTargetIso] = useState<IsoDate | null>(null);

  const moveItem = useCallback(
    async (item: DragItem, targetIso: IsoDate) => {
      const label = formatShortDay(parseIsoDate(targetIso));
      if (item.type === "task") {
        await run(() => api.tasks.update(item.id, { due_date: targetIso }), { success: `Task moved to ${label}` });
      } else {
        await run(() => api.finance.update(item.id, { occurred_on: targetIso }), { success: `Entry moved to ${label}` });
      }
    },
    [run],
  );

  // ---- Cell handlers (one stable object so memoised cells skip re-renders) ----

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
      onDragEnter: (iso) => setDropTargetIso(iso),
      onDrop: (iso) => {
        const item = dragItem.current;
        dragItem.current = null;
        setDropTargetIso(null);
        if (item && item.fromDate !== iso) {
          void moveItem(item, iso);
        }
      },
      isDragging: () => dragItem.current !== null,
    }),
    [onSelectIso, openTask, openFinance, toggleTask, moveItem],
  );

  // ---- Render -------------------------------------------------------------

  const addDate = selectedIso ?? todayIso;

  return (
    <div className="calendar-view">
      <CalendarToolbar
        title={layout.title}
        viewMode={preferences.viewMode}
        customDayCount={preferences.customDayCount}
        totals={query.data?.totals}
        currency={preferences.defaultCurrency}
        showFinance={preferences.showFinance}
        refreshing={query.loading}
        settingsOpen={settingsOpen}
        onPrev={() => goRelative(-1)}
        onNext={() => goRelative(1)}
        onToday={goToday}
        onViewModeChange={(viewMode) => updatePreferences({ viewMode })}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onAddTask={() => openTask({ date: addDate })}
        onAddFinance={() => openFinance({ date: addDate })}
      />

      {settingsOpen ? <CalendarSettings onClose={() => setSettingsOpen(false)} /> : null}
      {query.error ? <ErrorNotice error={query.error} onRetry={query.reload} /> : null}

      <div className="calendar-body">
        <CalendarGrid
          layout={layout}
          dayMap={dayMap}
          preferences={preferences}
          todayIso={todayIso}
          selectedIso={selectedIso}
          dropTargetIso={dropTargetIso}
          loading={query.loading && query.data === undefined}
          handlers={handlers}
        />
        {selectedIso ? (
          <DayPanel
            iso={selectedIso}
            day={dayMap.get(selectedIso)}
            onClose={() => onSelectIso(null)}
            onToggleTask={toggleTask}
          />
        ) : null}
      </div>
    </div>
  );
}
