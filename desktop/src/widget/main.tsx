/**
 * Entry point of the desktop widget window (`widget.html`).
 *
 * Shares the API client, preferences and sync machinery with the main app
 * (same origin → same localStorage, so the backend address and currency
 * match), but renders only the compact widget UI.
 */

import React from "react";
import ReactDOM from "react-dom/client";

import { PreferencesProvider, usePreferences } from "../state/preferences";
import { DataSyncProvider } from "../state/sync";
import { ToastProvider } from "../state/toasts";
import "../styles/base.css";
import "../styles/glance.css";
import "../styles/widget.css";
import { WidgetApp } from "./WidgetApp";

/** DataSync needs the poll interval from preferences, so it sits one level down. */
function SyncedWidget() {
  const { preferences } = usePreferences();
  return (
    <DataSyncProvider pollIntervalSec={preferences.pollIntervalSec}>
      <WidgetApp />
    </DataSyncProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <PreferencesProvider>
        <SyncedWidget />
      </PreferencesProvider>
    </ToastProvider>
  </React.StrictMode>,
);
