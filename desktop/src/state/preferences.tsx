/**
 * User preferences: calendar customisation plus a few app-wide defaults.
 *
 * Stored in localStorage and exposed through React context so any component
 * (toolbar, settings popover, cells) can read and change them. Every stored
 * value is passed through {@link sanitizePreferences}, so preferences saved by
 * an older app version (missing or invalid fields) are repaired on load.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { TASK_SCOPES, type TaskScope } from "../api";
import { useLocalStorage } from "../hooks/useLocalStorage";
import type { WeekStart } from "../lib/dates";

/**
 * Calendar layouts.
 *  - `month`    – classic month grid (4–6 week rows).
 *  - `twoWeeks` – two week rows starting at the anchor's week.
 *  - `week`     – a single tall week row.
 *  - `days`     – a rolling window of `customDayCount` days from the anchor.
 */
export type CalendarViewMode = "month" | "twoWeeks" | "week" | "days";

/** Cell density: `compact` fits more rows, `comfortable` is easier to read. */
export type Density = "compact" | "comfortable";

export interface Preferences {
  viewMode: CalendarViewMode;
  /** Number of days shown in `days` mode (1–14). */
  customDayCount: number;
  weekStartsOn: WeekStart;
  showWeekends: boolean;
  /** Show income/expense chips and per-day net inside cells. */
  showFinance: boolean;
  showCompletedTasks: boolean;
  /** Task scopes rendered on the calendar; others are filtered out. */
  visibleScopes: TaskScope[];
  density: Density;
  /** Items listed per cell before collapsing into "+N more" (multi-row views only). */
  maxItemsPerCell: number;
  /** Currency preselected for new finance entries and used for totals. */
  defaultCurrency: string;
  /** Background refresh interval in seconds; 0 disables polling. */
  pollIntervalSec: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  viewMode: "month",
  customDayCount: 4,
  weekStartsOn: 1,
  showWeekends: true,
  showFinance: true,
  showCompletedTasks: true,
  visibleScopes: [...TASK_SCOPES],
  density: "comfortable",
  maxItemsPerCell: 4,
  defaultCurrency: "TRY",
  pollIntervalSec: 30,
};

const VIEW_MODES: readonly CalendarViewMode[] = ["month", "twoWeeks", "week", "days"];

/** Clamp a number into `[min, max]`, falling back when it is not a finite integer. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/** Repair an arbitrary stored value into a complete, valid {@link Preferences}. */
export function sanitizePreferences(stored: unknown): Preferences {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<keyof Preferences, unknown>>;
  const d = DEFAULT_PREFERENCES;
  const scopes = Array.isArray(raw.visibleScopes)
    ? TASK_SCOPES.filter((scope) => (raw.visibleScopes as unknown[]).includes(scope))
    : d.visibleScopes;

  return {
    viewMode: VIEW_MODES.includes(raw.viewMode as CalendarViewMode) ? (raw.viewMode as CalendarViewMode) : d.viewMode,
    customDayCount: clampInt(raw.customDayCount, 1, 14, d.customDayCount),
    weekStartsOn: raw.weekStartsOn === 0 || raw.weekStartsOn === 1 ? raw.weekStartsOn : d.weekStartsOn,
    showWeekends: typeof raw.showWeekends === "boolean" ? raw.showWeekends : d.showWeekends,
    showFinance: typeof raw.showFinance === "boolean" ? raw.showFinance : d.showFinance,
    showCompletedTasks: typeof raw.showCompletedTasks === "boolean" ? raw.showCompletedTasks : d.showCompletedTasks,
    visibleScopes: scopes,
    density: raw.density === "compact" || raw.density === "comfortable" ? raw.density : d.density,
    maxItemsPerCell: clampInt(raw.maxItemsPerCell, 1, 20, d.maxItemsPerCell),
    defaultCurrency:
      typeof raw.defaultCurrency === "string" && /^[A-Z]{3}$/.test(raw.defaultCurrency)
        ? raw.defaultCurrency
        : d.defaultCurrency,
    pollIntervalSec: clampInt(raw.pollIntervalSec, 0, 3600, d.pollIntervalSec),
  };
}

interface PreferencesContextValue {
  preferences: Preferences;
  /** Merge a partial change into the current preferences. */
  updatePreferences: (patch: Partial<Preferences>) => void;
  /** Restore every preference to its default. */
  resetPreferences: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Provides persisted preferences to the component tree. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useLocalStorage<Preferences>(
    "coretrack.preferences",
    DEFAULT_PREFERENCES,
    sanitizePreferences,
  );

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => setPreferences((previous) => sanitizePreferences({ ...previous, ...patch })),
    [setPreferences],
  );
  const resetPreferences = useCallback(() => setPreferences(DEFAULT_PREFERENCES), [setPreferences]);

  const value = useMemo(
    () => ({ preferences, updatePreferences, resetPreferences }),
    [preferences, updatePreferences, resetPreferences],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/** Access preferences. Must be used inside {@link PreferencesProvider}. */
export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used inside <PreferencesProvider>");
  }
  return context;
}
