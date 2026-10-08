/**
 * App sidebar: brand header, main navigation, a live "Today" card and a
 * footer with Settings and the connection status.
 *
 * On macOS the main window uses an overlay title bar, so the traffic-light
 * buttons float over the top of the sidebar; `nativeTitleBar` reserves room
 * for them and turns the brand area into a window drag handle.
 */

import packageJson from "../../../package.json";
import logoUrl from "../../assets/logo.png";
import { ProgressRing } from "../../components/glance";
import { Icon, type IconName } from "../../components/Icon";
import { useTodaySnapshot } from "../../hooks/useTodaySnapshot";
import { formatShortDay, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import { usePreferences } from "../../state/preferences";
import { useSyncStatus } from "../../state/sync";

export type Tab = "calendar" | "tasks" | "finance" | "settings";

/** Primary destinations; Settings lives in the footer. */
const NAV_ITEMS: readonly { id: Exclude<Tab, "settings">; label: string; icon: IconName }[] = [
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "finance", label: "Finance", icon: "wallet" },
];

const HEALTH_LABEL = { "on-track": "On track", tight: "Tight", over: "Over budget" } as const;

interface SidebarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  /** Reserve space for macOS traffic lights (overlay title bar). */
  nativeTitleBar: boolean;
  /** Open the calendar on today (Today card click). */
  onOpenToday: () => void;
}

/** Live summary of today: task progress, remaining budget, next payment. */
function TodayCard({ onOpenToday }: { onOpenToday: () => void }) {
  const { preferences } = usePreferences();
  const snapshot = useTodaySnapshot();
  const { tasks, doneCount, summary, nextDue, overdueCount, health, todayDate } = snapshot;
  const currency = preferences.defaultCurrency;
  const weekday = todayDate.toLocaleDateString(undefined, { weekday: "short" });

  return (
    <button type="button" className="today-card" onClick={onOpenToday} title="Open today in the calendar">
      <div className="today-card__top">
        <div className="today-card__date">
          <span className="today-card__weekday">{weekday}</span>
          <span className="today-card__day">{todayDate.getDate()}</span>
        </div>
        <ProgressRing done={doneCount} total={tasks?.length ?? 0} size={40} stroke={4} />
      </div>
      <div className="today-card__line">
        <span>Tasks today</span>
        <strong>{tasks ? `${tasks.length - doneCount} left` : "…"}</strong>
      </div>
      <div className="today-card__line">
        <span>Remaining</span>
        <strong className={summary && summary.remaining_budget < 0 ? "is-negative" : "is-positive"}>
          {summary ? formatMoney(summary.remaining_budget, currency, { compact: true, signed: summary.remaining_budget < 0 }) : "…"}
        </strong>
      </div>
      {health ? <span className={`health-pill health-pill--${health}`}>{HEALTH_LABEL[health]}</span> : null}
      {nextDue ? (
        <p className="today-card__next">
          Next: <strong>{nextDue.category}</strong> · {formatShortDay(parseIsoDate(nextDue.occurred_on))}
        </p>
      ) : null}
      {overdueCount > 0 ? <p className="today-card__overdue">{overdueCount} overdue payment{overdueCount > 1 ? "s" : ""}</p> : null}
    </button>
  );
}

/** Connection dot + last sync time. */
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

export function Sidebar({ tab, onTabChange, nativeTitleBar, onOpenToday }: SidebarProps) {
  return (
    <nav className={nativeTitleBar ? "sidebar has-native-titlebar" : "sidebar"} aria-label="Main">
      {/* Empty strip under the traffic lights doubles as a drag handle. */}
      {nativeTitleBar ? <div className="sidebar__titlebar" data-tauri-drag-region /> : null}

      <div className="sidebar__brand" data-tauri-drag-region>
        <img className="sidebar__logo" src={logoUrl} alt="" aria-hidden="true" width={30} height={30} />
        <div className="sidebar__brand-text" data-tauri-drag-region>
          <span className="sidebar__name" data-tauri-drag-region>
            Core-Track
          </span>
          <span className="sidebar__version" data-tauri-drag-region>
            v{packageJson.version}
          </span>
        </div>
      </div>

      <ul className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === tab ? "sidebar__link is-active" : "sidebar__link"}
              onClick={() => onTabChange(item.id)}
              aria-current={item.id === tab ? "page" : undefined}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <TodayCard onOpenToday={onOpenToday} />

      <div className="sidebar__footer">
        <button
          type="button"
          className={tab === "settings" ? "sidebar__link is-active" : "sidebar__link"}
          onClick={() => onTabChange("settings")}
          aria-current={tab === "settings" ? "page" : undefined}
        >
          <Icon name="settings" size={18} />
          Settings
        </button>
        <ConnectionIndicator />
      </div>
    </nav>
  );
}
