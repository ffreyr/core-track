/**
 * "View options" panel: every calendar customisation in one place.
 * Changes apply instantly and persist across restarts (see preferences.tsx).
 */

import { TASK_SCOPES, type TaskScope } from "../../api";
import { SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { SCOPE_META } from "../../lib/labels";
import { usePreferences } from "../../state/preferences";

/** A labelled on/off switch backed by a checkbox. */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function CalendarSettings({ onClose }: { onClose: () => void }) {
  const { preferences, updatePreferences, resetPreferences } = usePreferences();

  /** Show/hide one scope while always keeping at least one visible. */
  const toggleScope = (scope: TaskScope) => {
    const visible = preferences.visibleScopes.includes(scope)
      ? preferences.visibleScopes.filter((item) => item !== scope)
      : [...preferences.visibleScopes, scope];
    if (visible.length > 0) {
      updatePreferences({ visibleScopes: visible });
    }
  };

  return (
    <section className="settings-popover" aria-label="Calendar view options">
      <header className="settings-popover__header">
        <h2>View options</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close view options">
          <Icon name="close" />
        </button>
      </header>

      <div className="settings-popover__grid">
        <div className="settings-group">
          <h3>Layout</h3>
          <div className="settings-row">
            <span>Week starts on</span>
            <SegmentedControl
              size="sm"
              label="Week starts on"
              value={preferences.weekStartsOn}
              onChange={(weekStartsOn) => updatePreferences({ weekStartsOn })}
              options={[
                { value: 1, label: "Mon" },
                { value: 0, label: "Sun" },
              ]}
            />
          </div>
          <div className="settings-row">
            <span>Rolling view length</span>
            <input
              type="number"
              className="input input--narrow"
              min={1}
              max={14}
              value={preferences.customDayCount}
              onChange={(event) => updatePreferences({ customDayCount: Number(event.target.value) })}
              aria-label="Days in rolling view"
            />
          </div>
          <div className="settings-row">
            <span>Density</span>
            <SegmentedControl
              size="sm"
              label="Density"
              value={preferences.density}
              onChange={(density) => updatePreferences({ density })}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
              ]}
            />
          </div>
          <div className="settings-row">
            <span>Items per cell</span>
            <input
              type="number"
              className="input input--narrow"
              min={1}
              max={20}
              value={preferences.maxItemsPerCell}
              onChange={(event) => updatePreferences({ maxItemsPerCell: Number(event.target.value) })}
              aria-label="Maximum items per cell"
            />
          </div>
          <Toggle
            label="Show weekends"
            checked={preferences.showWeekends}
            onChange={(showWeekends) => updatePreferences({ showWeekends })}
          />
        </div>

        <div className="settings-group">
          <h3>Content</h3>
          <Toggle
            label="Show income & expenses"
            checked={preferences.showFinance}
            onChange={(showFinance) => updatePreferences({ showFinance })}
          />
          <Toggle
            label="Show completed tasks"
            checked={preferences.showCompletedTasks}
            onChange={(showCompletedTasks) => updatePreferences({ showCompletedTasks })}
          />
          <div className="settings-row settings-row--stacked">
            <span>Task scopes</span>
            <div className="scope-filter">
              {TASK_SCOPES.map((scope) => {
                const active = preferences.visibleScopes.includes(scope);
                return (
                  <button
                    key={scope}
                    type="button"
                    className={active ? "scope-filter__item is-active" : "scope-filter__item"}
                    style={{ borderColor: SCOPE_META[scope].color, color: active ? "#fff" : SCOPE_META[scope].color, backgroundColor: active ? SCOPE_META[scope].color : "transparent" }}
                    onClick={() => toggleScope(scope)}
                    aria-pressed={active}
                  >
                    {SCOPE_META[scope].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <footer className="settings-popover__footer">
        <button type="button" className="button button--small" onClick={resetPreferences}>
          Reset to defaults
        </button>
      </footer>
    </section>
  );
}
