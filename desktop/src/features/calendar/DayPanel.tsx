/**
 * Side panel with the full content of the selected day.
 *
 * The panel loads its own day from the API instead of reading the grid's
 * cache. That keeps it correct even when the selected day scrolls out of the
 * loaded window in the infinite views, and it refreshes with every sync like
 * any other query.
 *
 * Unlike the grid, the panel ignores display filters so the user can always
 * see (and act on) everything scheduled for that day. Pending finance
 * entries get a "paid" checkbox for one-click settlement.
 */

import { api, type IsoDate, type Task } from "../../api";
import { ErrorNotice, ScopeBadge } from "../../components/controls";
import { RoundCheck, StatusAction } from "../../components/glance";
import { Icon } from "../../components/Icon";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import { formatDateRange, formatLongDay, parseIsoDate } from "../../lib/dates";
import { PRIORITY_LABELS, SCOPE_META } from "../../lib/labels";
import { formatMoney } from "../../lib/money";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";

interface DayPanelProps {
  iso: IsoDate;
  onClose: () => void;
  onToggleTask: (task: Task) => void;
}

/** "Oct 5 – 8, 2026 · day 2 of 4" for a multi-day task seen on `iso`. */
function multiDayLabel(task: Task, iso: IsoDate): string {
  const start = parseIsoDate(task.due_date);
  const end = parseIsoDate(task.end_date ?? task.due_date);
  const dayNumber = Math.round((parseIsoDate(iso).getTime() - start.getTime()) / 86_400_000) + 1;
  return `${formatDateRange(start, end)} · day ${dayNumber} of ${task.span_days}`;
}

export function DayPanel({ iso, onClose, onToggleTask }: DayPanelProps) {
  const { openTask, openFinance } = useEditors();
  const { preferences } = usePreferences();
  const run = useApiAction();
  const currency = preferences.defaultCurrency;

  const query = useApiQuery((signal) => api.calendar.get(iso, iso, signal), [iso]);
  const day = query.data?.days[0];
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

      {query.error ? <ErrorNotice error={query.error} onRetry={query.reload} /> : null}

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
          <p className="empty-text">{query.data ? "Nothing scheduled." : "Loading…"}</p>
        ) : (
          <ul className="item-list">
            {tasks.map((task) => (
              <li key={task.id} className={task.is_completed ? "item-row is-done" : "item-row"}>
                <RoundCheck
                  checked={task.is_completed}
                  inProgress={task.status === "in_progress"}
                  color={task.color ?? SCOPE_META[task.scope].color}
                  label={task.is_completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                  onToggle={() => onToggleTask(task)}
                />
                <button type="button" className="item-row__main" onClick={() => openTask({ task })}>
                  <span className="item-row__title">{task.title}</span>
                  <span className="item-row__meta">
                    {task.span_days > 1 ? multiDayLabel(task, iso) : null}
                    {task.span_days > 1 && task.priority > 0 ? " · " : null}
                    {task.priority > 0 ? `${PRIORITY_LABELS[task.priority]} priority` : null}
                  </span>
                </button>
                <StatusAction
                  status={task.status}
                  title={task.title}
                  onChange={(next) => void run(() => api.tasks.setStatus(task.id, next))}
                />
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
          <p className="empty-text">{query.data ? "No income or expenses." : "Loading…"}</p>
        ) : (
          <ul className="item-list">
            {finance.map((log) => (
              <li key={log.id} className={log.is_paid ? "item-row" : "item-row is-pending"}>
                <input
                  type="checkbox"
                  checked={log.is_paid}
                  onChange={() => void run(() => api.finance.togglePaid(log.id))}
                  aria-label={log.is_paid ? `Mark ${log.category} as pending` : `Mark ${log.category} as paid`}
                  title={log.is_paid ? (log.kind === "income" ? "Received" : "Paid") : "Mark as paid"}
                />
                <button type="button" className="item-row__main" onClick={() => openFinance({ log })}>
                  <span className="item-row__title">{log.category}</span>
                  <span className="item-row__meta">
                    {log.is_paid ? (log.kind === "income" ? "Received" : "Paid") : log.kind === "income" ? "Expected" : "Pending"}
                    {log.description ? ` · ${log.description}` : ""}
                  </span>
                </button>
                <span className={log.kind === "income" ? "item-row__amount is-positive" : "item-row__amount is-negative"}>
                  {formatMoney(log.kind === "income" ? log.amount : -log.amount, log.currency, { signed: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="day-panel__hint">
        Tip: drag items between days to reschedule. Double-click a day to add a task.
      </p>
    </aside>
  );
}
