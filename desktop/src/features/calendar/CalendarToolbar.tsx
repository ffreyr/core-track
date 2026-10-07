/**
 * Calendar header: navigation, view switcher, range totals and quick actions.
 */

import type { CalendarTotals } from "../../api";
import { SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { formatMoney } from "../../lib/money";
import type { CalendarViewMode } from "../../state/preferences";

interface CalendarToolbarProps {
  title: string;
  viewMode: CalendarViewMode;
  customDayCount: number;
  totals: CalendarTotals | undefined;
  currency: string;
  showFinance: boolean;
  /** Background request in flight (shows a subtle spinner). */
  refreshing: boolean;
  settingsOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewModeChange: (mode: CalendarViewMode) => void;
  onToggleSettings: () => void;
  onAddTask: () => void;
  onAddFinance: () => void;
}

export function CalendarToolbar({
  title,
  viewMode,
  customDayCount,
  totals,
  currency,
  showFinance,
  refreshing,
  settingsOpen,
  onPrev,
  onNext,
  onToday,
  onViewModeChange,
  onToggleSettings,
  onAddTask,
  onAddFinance,
}: CalendarToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__group">
        <button type="button" className="button" onClick={onToday} title="Jump to today (T)">
          Today
        </button>
        <div className="button-group">
          <button type="button" className="icon-button" onClick={onPrev} aria-label="Previous" title="Previous (←)">
            <Icon name="chevronLeft" />
          </button>
          <button type="button" className="icon-button" onClick={onNext} aria-label="Next" title="Next (→)">
            <Icon name="chevronRight" />
          </button>
        </div>
        <h1 className="toolbar__title">{title}</h1>
        <span className={refreshing ? "sync-spinner is-active" : "sync-spinner"} aria-hidden="true" />
      </div>

      {totals ? (
        <div className="toolbar__stats" aria-label="Totals for the period in view">
          <span className="stat">
            <span className="stat__label">Open</span>
            <span className="stat__value">{totals.open_task_count}</span>
          </span>
          <span className="stat">
            <span className="stat__label">Done</span>
            <span className="stat__value">{totals.completed_task_count}</span>
          </span>
          {showFinance ? (
            <>
              <span className="stat">
                <span className="stat__label">In</span>
                <span className="stat__value is-positive">{formatMoney(totals.income_total, currency, { compact: true })}</span>
              </span>
              <span className="stat">
                <span className="stat__label">Out</span>
                <span className="stat__value is-negative">{formatMoney(totals.expense_total, currency, { compact: true })}</span>
              </span>
              {totals.pending_expense_total > 0 ? (
                <span className="stat" title="Planned expenses not yet paid (included in Out)">
                  <span className="stat__label">Pending</span>
                  <span className="stat__value is-pending">
                    {formatMoney(totals.pending_expense_total, currency, { compact: true })}
                  </span>
                </span>
              ) : null}
              <span className="stat">
                <span className="stat__label">Net</span>
                <span className={totals.net >= 0 ? "stat__value is-positive" : "stat__value is-negative"}>
                  {formatMoney(totals.net, currency, { signed: true, compact: true })}
                </span>
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="toolbar__group">
        <SegmentedControl
          label="Calendar view"
          value={viewMode}
          onChange={onViewModeChange}
          options={[
            { value: "month", label: "Month" },
            { value: "twoWeeks", label: "2 Weeks" },
            { value: "week", label: "Week" },
            { value: "days", label: `${customDayCount} Days`, title: "Rolling range; set the length in view options" },
          ]}
        />
        <button
          type="button"
          className={settingsOpen ? "icon-button is-active" : "icon-button"}
          onClick={onToggleSettings}
          aria-label="View options"
          title="View options"
        >
          <Icon name="sliders" />
        </button>
        <button type="button" className="button" onClick={onAddFinance} title="Add income or expense">
          <Icon name="wallet" size={14} />
          Money
        </button>
        <button type="button" className="button button--primary" onClick={onAddTask} title="Add task (N)">
          <Icon name="plus" size={14} />
          Task
        </button>
      </div>
    </header>
  );
}
