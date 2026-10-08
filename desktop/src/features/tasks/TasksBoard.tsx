/**
 * Tasks board: one lane per scope, each showing the tasks of the period that
 * contains the selected date.
 *
 *   Daily   → tasks due on that day
 *   Weekly  → weekly tasks due in that week
 *   Monthly → monthly tasks due in that month
 *   Yearly  → yearly tasks due in that year
 *
 * This answers "what are my goals at each horizon right now?", which the
 * calendar (organised by day) cannot show at a glance. A progress bar per
 * lane shows completed vs total.
 */

import { api, TASK_SCOPES, type Task, type TaskScope } from "../../api";
import { ErrorNotice } from "../../components/controls";
import { RoundCheck } from "../../components/glance";
import { Icon } from "../../components/Icon";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import {
  addDays,
  formatDateRange,
  formatLongDay,
  formatMonthYear,
  formatShortDay,
  parseIsoDate,
  scopePeriod,
  toIsoDate,
  today,
  type WeekStart,
} from "../../lib/dates";
import { PRIORITY_LABELS, SCOPE_META } from "../../lib/labels";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";

interface TasksBoardProps {
  anchor: Date;
  onAnchorChange: (date: Date) => void;
}

/** Human-readable name of a scope's period, e.g. "Week of Oct 5 – 11, 2026". */
function periodLabel(scope: TaskScope, anchor: Date, weekStartsOn: WeekStart): string {
  const { start, end } = scopePeriod(scope, anchor, weekStartsOn);
  switch (scope) {
    case "daily":
      return formatLongDay(start);
    case "weekly":
      return formatDateRange(start, end);
    case "monthly":
      return formatMonthYear(start);
    case "yearly":
      return String(start.getFullYear());
  }
}

export function TasksBoard({ anchor, onAnchorChange }: TasksBoardProps) {
  const { preferences } = usePreferences();
  const { openTask } = useEditors();
  const run = useApiAction();
  const anchorIso = toIsoDate(anchor);

  // One request per lane, issued in parallel; each is filtered server-side
  // by scope and by that scope's own period.
  const query = useApiQuery(
    async (signal) => {
      const lanes = await Promise.all(
        TASK_SCOPES.map((scope) => {
          const { start, end } = scopePeriod(scope, anchor, preferences.weekStartsOn);
          return api.tasks.list({ scope, start: toIsoDate(start), end: toIsoDate(end) }, signal);
        }),
      );
      return Object.fromEntries(TASK_SCOPES.map((scope, index) => [scope, lanes[index]])) as Record<TaskScope, Task[]>;
    },
    [anchorIso, preferences.weekStartsOn],
  );

  return (
    <div className="tasks-board">
      <header className="toolbar" data-tauri-drag-region>
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => onAnchorChange(today())}>
            Today
          </button>
          <div className="button-group">
            <button type="button" className="icon-button" onClick={() => onAnchorChange(addDays(anchor, -1))} aria-label="Previous day">
              <Icon name="chevronLeft" />
            </button>
            <button type="button" className="icon-button" onClick={() => onAnchorChange(addDays(anchor, 1))} aria-label="Next day">
              <Icon name="chevronRight" />
            </button>
          </div>
          <input
            type="date"
            className="input input--date"
            value={anchorIso}
            onChange={(event) => {
              if (event.target.value) {
                onAnchorChange(parseIsoDate(event.target.value));
              }
            }}
            aria-label="Reference date"
          />
          <span className={query.loading ? "sync-spinner is-active" : "sync-spinner"} aria-hidden="true" />
        </div>
      </header>

      {query.error ? <ErrorNotice error={query.error} onRetry={query.reload} /> : null}

      <div className="lanes">
        {TASK_SCOPES.map((scope) => {
          const tasks = query.data?.[scope] ?? [];
          const done = tasks.filter((task) => task.is_completed).length;
          const percent = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
          const meta = SCOPE_META[scope];
          return (
            <section key={scope} className="lane" style={{ borderTopColor: meta.color }}>
              <header className="lane__header">
                <div>
                  <h2>{meta.label}</h2>
                  <p className="lane__period">{periodLabel(scope, anchor, preferences.weekStartsOn)}</p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => openTask({ date: anchorIso, scope })}
                  aria-label={`Add ${meta.label.toLowerCase()} task`}
                  title={`Add ${meta.label.toLowerCase()} task`}
                >
                  <Icon name="plus" />
                </button>
              </header>

              <div className="progress" aria-label={`${done} of ${tasks.length} done`}>
                <div className="progress__bar" style={{ width: `${percent}%`, backgroundColor: meta.color }} />
              </div>
              <p className="lane__count">
                {done}/{tasks.length} done
              </p>

              {tasks.length === 0 ? (
                <p className="empty-text">{query.data ? "No tasks for this period." : "Loading…"}</p>
              ) : (
                <ul className="item-list">
                  {tasks.map((task) => (
                    <li key={task.id} className={task.is_completed ? "item-row is-done" : "item-row"}>
                      <RoundCheck
                        checked={task.is_completed}
                        color={task.color ?? SCOPE_META[task.scope].color}
                        label={task.is_completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        onToggle={() => void run(() => api.tasks.toggle(task.id))}
                      />
                      <button type="button" className="item-row__main" onClick={() => openTask({ task })}>
                        <span className="item-row__title">
                          {task.color ? <span className="color-dot" style={{ backgroundColor: task.color }} /> : null}
                          {task.title}
                        </span>
                        <span className="item-row__meta">
                          Due {task.end_date ? formatDateRange(parseIsoDate(task.due_date), parseIsoDate(task.end_date)) : formatShortDay(parseIsoDate(task.due_date))}
                          {task.priority > 0 ? ` · ${PRIORITY_LABELS[task.priority]}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
