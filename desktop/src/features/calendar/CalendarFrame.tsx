/**
 * Chrome shared by every calendar mode: toolbar, view-options popover,
 * error banner, keyboard shortcuts and the selected-day side panel.
 *
 * The mode-specific component (scrolling or paged) supplies the title,
 * totals and navigation callbacks, and renders its grid as `children`.
 */

import { useEffect, useState, type ReactNode } from "react";

import type { CalendarTotals, IsoDate, Task } from "../../api";
import { ErrorNotice } from "../../components/controls";
import { toIsoDate, today } from "../../lib/dates";
import { usePreferences, type CalendarViewMode } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";
import { CalendarSettings } from "./CalendarSettings";
import { CalendarToolbar } from "./CalendarToolbar";
import { DayPanel } from "./DayPanel";

interface CalendarFrameProps {
  title: string;
  totals: CalendarTotals | undefined;
  refreshing: boolean;
  error: Error | null;
  onRetry: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Called before the view mode changes (lets scrolling views hand off their position). */
  onBeforeViewModeChange?: (next: CalendarViewMode) => void;
  selectedIso: IsoDate | null;
  onSelectIso: (iso: IsoDate | null) => void;
  onToggleTask: (task: Task) => void;
  children: ReactNode;
}

/** `true` when a key event comes from a text field (shortcuts must not fire). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function CalendarFrame({
  title,
  totals,
  refreshing,
  error,
  onRetry,
  onPrev,
  onNext,
  onToday,
  onBeforeViewModeChange,
  selectedIso,
  onSelectIso,
  onToggleTask,
  children,
}: CalendarFrameProps) {
  const { preferences, updatePreferences } = usePreferences();
  const { openTask, openFinance } = useEditors();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const todayIso = toIsoDate(today());
  const addDate = selectedIso ?? todayIso;

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
          onPrev();
          break;
        case "ArrowRight":
          event.preventDefault();
          onNext();
          break;
        case "t":
        case "T":
          onToday();
          break;
        case "n":
        case "N":
          openTask({ date: addDate });
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
  }, [onPrev, onNext, onToday, openTask, addDate, onSelectIso]);

  return (
    <div className="calendar-view">
      <CalendarToolbar
        title={title}
        viewMode={preferences.viewMode}
        customDayCount={preferences.customDayCount}
        totals={totals}
        currency={preferences.defaultCurrency}
        showFinance={preferences.showFinance}
        refreshing={refreshing}
        settingsOpen={settingsOpen}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        onViewModeChange={(viewMode) => {
          onBeforeViewModeChange?.(viewMode);
          updatePreferences({ viewMode });
        }}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onAddTask={() => openTask({ date: addDate })}
        onAddFinance={() => openFinance({ date: addDate })}
      />

      {settingsOpen ? <CalendarSettings onClose={() => setSettingsOpen(false)} /> : null}
      {error ? <ErrorNotice error={error} onRetry={onRetry} /> : null}

      <div className="calendar-body">
        {children}
        {selectedIso ? (
          <DayPanel iso={selectedIso} onClose={() => onSelectIso(null)} onToggleTask={onToggleTask} />
        ) : null}
      </div>
    </div>
  );
}
