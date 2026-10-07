/**
 * Application root: providers, sidebar navigation and tab routing.
 *
 * Provider order matters:
 *   Toasts → Preferences → DataSync (reads the poll interval preference)
 *   → Editors (dialogs use toasts, preferences and data invalidation).
 *
 * Navigation state (active tab, anchor date, selected day) lives here so tabs
 * can hand off to each other — e.g. clicking a bar in the Finance chart opens
 * the Calendar positioned on that day with its panel open.
 */

import { useCallback, useState } from "react";

import type { IsoDate } from "./api";
import { Icon, type IconName } from "./components/Icon";
import { CalendarView } from "./features/calendar/CalendarView";
import { EditorsProvider } from "./features/editors/EditorsProvider";
import { FinanceView } from "./features/finance/FinanceView";
import { SettingsView } from "./features/settings/SettingsView";
import { TasksBoard } from "./features/tasks/TasksBoard";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { parseIsoDate, today } from "./lib/dates";
import { PreferencesProvider, usePreferences } from "./state/preferences";
import { DataSyncProvider, useSyncStatus } from "./state/sync";
import { ToastProvider } from "./state/toasts";

type Tab = "calendar" | "tasks" | "finance" | "settings";

const TABS: readonly { id: Tab; label: string; icon: IconName }[] = [
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "finance", label: "Finance", icon: "wallet" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/** Sanitise the remembered tab (guards against stale/invalid stored values). */
function sanitizeTab(stored: unknown): Tab {
  return TABS.some((tab) => tab.id === stored) ? (stored as Tab) : "calendar";
}

/** Sidebar footer: live backend connection indicator. */
function ConnectionIndicator() {
  const status = useSyncStatus();
  const label =
    status.state === "online"
      ? `Synced ${status.lastSyncedAt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? ""}`
      : status.state === "offline"
        ? "Offline"
        : "Connecting…";
  return (
    <div className={`connection connection--${status.state}`} title={status.message ?? label}>
      <span className="connection__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

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
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            ◆
          </span>
          Core-Track
        </div>
        <ul className="sidebar__nav">
          {TABS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === tab ? "sidebar__link is-active" : "sidebar__link"}
                onClick={() => setTab(item.id)}
                aria-current={item.id === tab ? "page" : undefined}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <ConnectionIndicator />
      </nav>

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
