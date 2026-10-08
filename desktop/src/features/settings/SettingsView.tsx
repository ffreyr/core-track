/**
 * Settings tab: backend connection and app-wide defaults.
 *
 * The backend address can be tested before it is saved, so a typo never
 * leaves the app pointing at nothing. Saving invalidates all data so every
 * view reloads from the new server immediately.
 */

import { useState } from "react";

import {
  api,
  DEFAULT_API_BASE_URL,
  errorMessage,
  getApiBaseUrl,
  normalizeBaseUrl,
  setApiBaseUrl,
  type HealthResponse,
} from "../../api";
import { Field } from "../../components/controls";
import { useDataVersion, useSyncStatus } from "../../state/sync";
import { usePreferences } from "../../state/preferences";
import { useToast } from "../../state/toasts";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; health: HealthResponse; latencyMs: number }
  | { status: "failed"; message: string };

export function SettingsView() {
  const { preferences, updatePreferences, resetPreferences } = usePreferences();
  const { invalidate } = useDataVersion();
  const syncStatus = useSyncStatus();
  const toast = useToast();

  const [activeUrl, setActiveUrl] = useState(getApiBaseUrl());
  const [draftUrl, setDraftUrl] = useState(activeUrl);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [currencyDraft, setCurrencyDraft] = useState(preferences.defaultCurrency);

  /** Ping `/api/health` on the draft address and measure round-trip time. */
  const runTest = async () => {
    const baseUrl = normalizeBaseUrl(draftUrl);
    setTest({ status: "testing" });
    const started = performance.now();
    try {
      const health = await api.health.check({ baseUrl });
      setTest({ status: "ok", health, latencyMs: Math.round(performance.now() - started) });
    } catch (error) {
      setTest({ status: "failed", message: errorMessage(error) });
    }
  };

  const saveUrl = (url: string | null) => {
    const applied = setApiBaseUrl(url);
    setActiveUrl(applied);
    setDraftUrl(applied);
    setTest({ status: "idle" });
    invalidate();
    toast.success(`Using backend ${applied}`);
  };

  const saveCurrency = () => {
    const code = currencyDraft.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      updatePreferences({ defaultCurrency: code });
      toast.success(`Default currency set to ${code}`);
    } else {
      toast.error("Currency must be a 3-letter code such as TRY, USD or EUR.");
      setCurrencyDraft(preferences.defaultCurrency);
    }
  };

  return (
    <div className="settings-view">
      <header className="toolbar" data-tauri-drag-region>
        <h1 className="toolbar__title" data-tauri-drag-region>Settings</h1>
      </header>

      <div className="settings-scroll">
        <section className="panel">
          <h2>Backend connection</h2>
          <p className="panel__lead">
            Status:{" "}
            <strong className={syncStatus.state === "offline" ? "is-negative" : "is-positive"}>{syncStatus.state}</strong>
            {syncStatus.lastSyncedAt ? ` · last sync ${syncStatus.lastSyncedAt.toLocaleTimeString()}` : ""}
          </p>

          <Field
            label="API address"
            htmlFor="api-url"
            hint={`Currently using ${activeUrl}. Default: ${DEFAULT_API_BASE_URL}. Use your Mac's LAN IP or tunnel URL to reach a remote backend.`}
          >
            <div className="input-row">
              <input
                id="api-url"
                className="input"
                value={draftUrl}
                spellCheck={false}
                placeholder="http://localhost:8000"
                onChange={(event) => {
                  setDraftUrl(event.target.value);
                  setTest({ status: "idle" });
                }}
              />
              <button type="button" className="button" onClick={runTest} disabled={test.status === "testing"}>
                {test.status === "testing" ? "Testing…" : "Test"}
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => saveUrl(draftUrl)}
                disabled={normalizeBaseUrl(draftUrl) === activeUrl || normalizeBaseUrl(draftUrl) === ""}
              >
                Save
              </button>
              <button type="button" className="button" onClick={() => saveUrl(null)}>
                Reset
              </button>
            </div>
          </Field>

          {test.status === "ok" ? (
            <p className="notice notice--success">
              Connected to {test.health.app} v{test.health.version} in {test.latencyMs} ms.
            </p>
          ) : null}
          {test.status === "failed" ? <p className="notice notice--error">{test.message}</p> : null}
        </section>

        <section className="panel">
          <h2>Sync</h2>
          <Field
            label="Background refresh"
            htmlFor="poll-interval"
            hint="How often the app re-reads data changed on other devices. It also refreshes whenever the window regains focus."
          >
            <select
              id="poll-interval"
              className="input input--auto"
              value={preferences.pollIntervalSec}
              onChange={(event) => updatePreferences({ pollIntervalSec: Number(event.target.value) })}
            >
              <option value={0}>Off</option>
              <option value={15}>Every 15 seconds</option>
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every minute</option>
              <option value={300}>Every 5 minutes</option>
            </select>
          </Field>
        </section>

        <section className="panel">
          <h2>Money</h2>
          <Field
            label="Default currency"
            htmlFor="default-currency"
            hint="Preselected for new entries and used to display totals."
          >
            <div className="input-row">
              <input
                id="default-currency"
                className="input input--currency"
                maxLength={3}
                value={currencyDraft}
                onChange={(event) => setCurrencyDraft(event.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="button"
                onClick={saveCurrency}
                disabled={currencyDraft === preferences.defaultCurrency}
              >
                Save
              </button>
            </div>
          </Field>
        </section>

        <section className="panel">
          <h2>Reset</h2>
          <p className="panel__lead">Restore all calendar and display preferences to their defaults. Your data is not affected.</p>
          <button
            type="button"
            className="button"
            onClick={() => {
              resetPreferences();
              setCurrencyDraft("TRY");
              toast.info("Preferences reset");
            }}
          >
            Reset preferences
          </button>
        </section>
      </div>
    </div>
  );
}
