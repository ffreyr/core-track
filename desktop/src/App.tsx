/**
 * Application root: providers, sidebar navigation and tab routing.
 *
 * Provider order matters:
 *   Toasts → Preferences → DataSync (reads the poll interval preference)
 *   → Editors (dialogs use toasts, preferences and data invalidation).
 *
 * Navigation state (active tab, anchor date, selected day) lives here so tabs
 * can hand off to each other — e.g. clicking a day in the Finance sheet opens
 * the Calendar positioned on that day with its panel open.
 */

import { useCallback, useState } from "react";

import type { IsoDate } from "./api";
import { CalendarView } from "./features/calendar/CalendarView";
import { EditorsProvider } from "./features/editors/EditorsProvider";
import { FinanceView } from "./features/finance/FinanceView";
import { SettingsView } from "./features/settings/SettingsView";
import { StudyView } from "./features/study/StudyView";
import { Sidebar, type Tab } from "./features/shell/Sidebar";
import { TasksBoard } from "./features/tasks/TasksBoard";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { parseIsoDate, toIsoDate, today } from "./lib/dates";
import { inDesktopApp } from "./lib/desktopBridge";
import { PreferencesProvider, usePreferences } from "./state/preferences";
import { DataSyncProvider } from "./state/sync";
import { ToastProvider } from "./state/toasts";

const TABS: readonly Tab[] = ["calendar", "tasks", "finance", "study", "settings"];

/** Sanitise the remembered tab (guards against stale/invalid stored values). */
function sanitizeTab(stored: unknown): Tab {
  return TABS.includes(stored as Tab) ? (stored as Tab) : "calendar";
}

/**
 * Inside the macOS app the main window uses an overlay title bar
 * (tauri.conf.json), so the layout must leave room for the traffic lights.
 */
const nativeTitleBar = inDesktopApp && navigator.userAgent.includes("Mac");

/** Everything inside the providers. */
function Shell() {
  const [tab, setTab] = useLocalStorage<Tab>("coretrack.activeTab", "calendar", sanitizeTab);
  // Shared "where am I looking" date used by Calendar, Tasks and Finance.
  const [anchor, setAnchor] = useState<Date>(() => today());
  const [selectedIso, setSelectedIso] = useState<IsoDate | null>(null);

  /** Jump from any tab to the calendar with `iso` selected. */
  const openDayInCalendar = useCallback(
    (iso: IsoDate) => {
      setAnchor(parseIsoDate(iso));
      setSelectedIso(iso);
      setTab("calendar");
    },
    [setTab],
  );

  return (
    <div className={nativeTitleBar ? "app has-native-titlebar" : "app"}>
      <Sidebar
        tab={tab}
        onTabChange={setTab}
        nativeTitleBar={nativeTitleBar}
        onOpenToday={() => openDayInCalendar(toIsoDate(today()))}
      />

      <main className="main">
        {tab === "calendar" ? (
          <CalendarView
            anchor={anchor}
            onAnchorChange={setAnchor}
            selectedIso={selectedIso}
            onSelectIso={setSelectedIso}
          />
        ) : null}
        {tab === "tasks" ? <TasksBoard anchor={anchor} onAnchorChange={setAnchor} /> : null}
        {tab === "finance" ? (
          <FinanceView anchor={anchor} onAnchorChange={setAnchor} onOpenDay={openDayInCalendar} />
        ) : null}
        {tab === "study" ? <StudyView /> : null}
        {tab === "settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}

/** DataSync needs the poll interval from preferences, so it sits one level down. */
function SyncedApp() {
  const { preferences } = usePreferences();
  return (
    <DataSyncProvider pollIntervalSec={preferences.pollIntervalSec}>
      <EditorsProvider>
        <Shell />
      </EditorsProvider>
    </DataSyncProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <PreferencesProvider>
        <SyncedApp />
      </PreferencesProvider>
    </ToastProvider>
  );
}
