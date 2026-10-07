/**
 * Side panel with the full content of the selected day.
 *
 * Unlike the cell, the panel ignores the calendar's display filters so the
 * user can always see (and act on) everything scheduled for that day.
 */

import type { CalendarDay, IsoDate, Task } from "../../api";
import { ScopeBadge } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { formatLongDay, parseIsoDate } from "../../lib/dates";
import { PRIORITY_LABELS } from "../../lib/labels";
import { formatMoney } from "../../lib/money";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";

interface DayPanelProps {
  iso: IsoDate;
  day: CalendarDay | undefined;
  onClose: () => void;
  onToggleTask: (task: Task) => void;
}

export function DayPanel({ iso, day, onClose, onToggleTask }: DayPanelProps) {
  const { openTask, openFinance } = useEditors();
  const { preferences } = usePreferences();
  const currency = preferences.defaultCurrency;
  const tasks = day?.tasks ?? [];
  const finance = day?.finance ?? [];

  return (
    <aside className="day-panel" aria-label={`Details for ${iso}`}>
      <header className="day-panel__header">
        <h2>{formatLongDay(parseIsoDate(iso))}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close day panel" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>

      <div className="day-panel__summary">
        <div>
          <span className="stat__label">Income</span>
          <strong className="is-positive">{formatMoney(day?.income_total ?? 0, currency)}</strong>
        </div>
        <div>
          <span className="stat__label">Expense</span>
          <strong className="is-negative">{formatMoney(day?.expense_total ?? 0, currency)}</strong>
        </div>
        <div>
          <span className="stat__label">Net</span>
          <strong className={(day?.net ?? 0) >= 0 ? "is-positive" : "is-negative"}>
            {formatMoney(day?.net ?? 0, currency, { signed: true })}
          </strong>
        </div>
      </div>

      <section className="day-panel__section">
        <header>
          <h3>Tasks</h3>
          <button type="button" className="button button--small" onClick={() => openTask({ date: iso })}>
            <Icon name="plus" size={12} />
            Task
          </button>
        </header>
        {tasks.length === 0 ? (
          <p className="empty-text">Nothing scheduled.</p>
        ) : (
          <ul className="item-list">
            {tasks.map((task) => (
              <li key={task.id} className={task.is_completed ? "item-row is-done" : "item-row"}>
                <input
                  type="checkbox"
                  checked={task.is_completed}
                  onChange={() => onToggleTask(task)}
                  aria-label={`Toggle ${task.title}`}
                />
                <button type="button" className="item-row__main" onClick={() => openTask({ task })}>
                  <span className="item-row__title">{task.title}</span>
                  {task.priority > 0 ? (
                    <span className="item-row__meta">{PRIORITY_LABELS[task.priority]} priority</span>
                  ) : null}
                </button>
                <ScopeBadge scope={task.scope} full />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="day-panel__section">
        <header>
          <h3>Money</h3>
          <div className="button-row">
            <button type="button" className="button button--small" onClick={() => openFinance({ date: iso, kind: "income" })}>
              <Icon name="arrowUp" size={12} />
              Income
            </button>
            <button type="button" className="button button--small" onClick={() => openFinance({ date: iso, kind: "expense" })}>
              <Icon name="arrowDown" size={12} />
              Expense
            </button>
          </div>
        </header>
        {finance.length === 0 ? (
          <p className="empty-text">No income or expenses.</p>
        ) : (
          <ul className="item-list">
            {finance.map((log) => (
              <li key={log.id} className="item-row">
                <button type="button" className="item-row__main" onClick={() => openFinance({ log })}>
                  <span className="item-row__title">{log.category}</span>
                  {log.description ? <span className="item-row__meta">{log.description}</span> : null}
                </button>
                <span className={log.kind === "income" ? "item-row__amount is-positive" : "item-row__amount is-negative"}>
                  {formatMoney(log.kind === "income" ? log.amount : -log.amount, log.currency, { signed: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="day-panel__hint">Tip: drag chips between days to reschedule. Double-click a day to add a task.</p>
    </aside>
  );
}
