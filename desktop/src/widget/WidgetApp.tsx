/**
 * Desktop widget UI: a glanceable card in the style of a native macOS
 * widget, showing today's tasks and this month's budget.
 *
 *   ┌──────────────────────────────┐
 *   │ THURSDAY                (2/4)│  date header + progress ring
 *   │ 8 October                    │  (drag handle; buttons on hover)
 *   │ ◯ Review Q4 budget       !!! │
 *   │ ◯ Berlin trip         2 / 4  │  round, color-coded checkboxes
 *   │ ● Call mom                   │
 *   │ ┌──────────────────────────┐ │
 *   │ │ REMAINING     On track   │ │  budget card: amount, health,
 *   │ │ ₺26,800                  │ │  paid/pending/remaining bar,
 *   │ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬            │ │  next payment due
 *   │ │ Next: Credit card · 14 Oct│ │
 *   │ └──────────────────────────┘ │
 *   └──────────────────────────────┘
 *
 * Window chrome: the widget window is frameless and transparent; macOS draws
 * the frosted "HUD" background (windowEffects in tauri.conf.json) and this
 * component paints only a light tint. The header is a drag handle
 * (`data-tauri-drag-region`); its buttons appear only on hover so the
 * widget stays calm on the desktop.
 *
 * Data comes from the shared `useTodaySnapshot` hook (same numbers as the
 * main window's Today card) and refreshes with the shared sync machinery,
 * including instant cross-window events.
 */

import { useEffect, useRef, useState } from "react";

import { api, type Task } from "../api";
import { ProgressRing, RoundCheck, StatusAction } from "../components/glance";
import { Icon } from "../components/Icon";
import { useApiAction } from "../hooks/useApi";
import { useStudyTimer } from "../hooks/useStudyTimer";
import { useTodaySnapshot } from "../hooks/useTodaySnapshot";
import { diffInDays, formatShortDay, parseIsoDate } from "../lib/dates";
import { hideCurrentWindow, inDesktopApp, openMainWindow } from "../lib/desktopBridge";
import { SCOPE_META } from "../lib/labels";
import { formatClock, formatDuration } from "../lib/duration";
import { formatMoney } from "../lib/money";
import { usePreferences } from "../state/preferences";
import { useSyncStatus } from "../state/sync";

const HEALTH_LABEL = { "on-track": "On track", tight: "Tight", over: "Over budget" } as const;

/** "2/4" progress through a multi-day task on `iso`, else `null`. */
function spanProgress(task: Task, iso: string): string | null {
  if (task.span_days <= 1) {
    return null;
  }
  const day = diffInDays(parseIsoDate(task.due_date), parseIsoDate(iso)) + 1;
  return `${day}/${task.span_days}`;
}

export function WidgetApp() {
  const { preferences } = usePreferences();
  const run = useApiAction();
  const status = useSyncStatus();
  const snapshot = useTodaySnapshot();
  const timer = useStudyTimer();
  const { tasks, doneCount, summary, nextDue, overdueCount, health, todayDate, todayIso } = snapshot;
  const currency = preferences.defaultCurrency;
  const offline = status.state === "offline";

  // Fade the list's bottom edge only when it actually scrolls; otherwise the
  // last task would look washed out for no reason.
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return undefined;
    }
    const check = () => setScrollable(list.scrollHeight > list.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tasks?.length]);

  const weekday = todayDate.toLocaleDateString(undefined, { weekday: "long" });
  const month = todayDate.toLocaleDateString(undefined, { month: "long" });

  // Budget bar segments, scaled to the larger of income and expenses.
  const scale = summary ? Math.max(summary.income_total, summary.expense_total, 0.01) : 1;
  const share = (value: number) => `${Math.min(100, Math.max(0, (value / scale) * 100))}%`;

  return (
    <div className={inDesktopApp ? "widget is-native" : "widget"}>
      <header className="widget__header" data-tauri-drag-region>
        <div className="widget__date" data-tauri-drag-region>
          <span className="widget__weekday" data-tauri-drag-region>
            {weekday}
          </span>
          <span className="widget__day" data-tauri-drag-region>
            {todayDate.getDate()} <span data-tauri-drag-region>{month}</span>
          </span>
        </div>
        <ProgressRing done={doneCount} total={tasks?.length ?? 0} size={46} stroke={4.5} />
        {inDesktopApp ? (
          <div className="widget__actions">
            <button type="button" className="widget__icon-button" onClick={openMainWindow} title="Open Core-Track">
              <Icon name="calendar" size={14} />
            </button>
            <button type="button" className="widget__icon-button" onClick={hideCurrentWindow} title="Hide widget">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : null}
      </header>

      <section className="widget__tasks" aria-label="Today's tasks">
        {tasks === undefined ? (
          <p className="widget__empty">{offline ? "Backend unreachable" : "Loading…"}</p>
        ) : tasks.length === 0 ? (
          <div className="widget__all-clear">
            <span className="widget__all-clear-icon" aria-hidden="true">
              ✓
            </span>
            Nothing scheduled today
          </div>
        ) : (
          <ul ref={listRef} className={scrollable ? "widget__list is-scrollable" : "widget__list"}>
            {tasks.map((task) => {
              const progress = spanProgress(task, todayIso);
              const color = task.color ?? SCOPE_META[task.scope].color;
              return (
                <li key={task.id} className={task.is_completed ? "widget__task is-done" : "widget__task"}>
                  <RoundCheck
                    checked={task.is_completed}
                    inProgress={task.status === "in_progress"}
                    color={color}
                    label={task.is_completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    onToggle={() => void run(() => api.tasks.toggle(task.id))}
                  />
                  <span className="widget__task-title" title={task.title}>
                    {task.title}
                  </span>
                  {task.priority === 3 && !task.is_completed ? (
                    <span className="widget__priority" title="High priority">
                      !!!
                    </span>
                  ) : null}
                  {progress ? <span className="widget__span">{progress}</span> : null}
                  <StatusAction
                    status={task.status}
                    title={task.title}
                    onChange={(next) => void run(() => api.tasks.setStatus(task.id, next))}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Study timer strip: live clock + stop while running, today's total + start when idle. */}
      <section className={timer.active ? "widget__study is-running" : "widget__study"} aria-label="Study timer">
        <span className="widget__study-icon" aria-hidden="true">
          <Icon name="timer" size={15} />
        </span>
        {timer.active ? (
          <>
            <span className="widget__study-text">{timer.active.subject}</span>
            <span className="widget__study-clock">
              {formatClock(timer.remaining !== null ? Math.max(0, timer.remaining) : timer.elapsed)}
            </span>
            <button type="button" className="widget__study-button is-stop" onClick={() => void timer.stop()} title="Stop the timer">
              <Icon name="stop" size={11} />
            </button>
          </>
        ) : (
          <>
            <span className="widget__study-text">Studied today</span>
            <span className="widget__study-clock">{formatDuration(timer.todaySeconds)}</span>
            <button
              type="button"
              className="widget__study-button"
              onClick={() => void timer.start({ subject: timer.recentSubjects[0] ?? "Study" })}
              title={`Start studying ${timer.recentSubjects[0] ?? ""}`.trim()}
            >
              <Icon name="play" size={11} />
            </button>
          </>
        )}
      </section>

      <section className={`widget__budget${health ? ` is-${health}` : ""}`} aria-label="This month's budget">
        <div className="widget__budget-head">
          <span>Remaining · {month}</span>
          {health ? <span className={`health-pill health-pill--${health}`}>{HEALTH_LABEL[health]}</span> : null}
        </div>
        {summary ? (
          <>
            <strong className="widget__amount">
              {formatMoney(summary.remaining_budget, currency, { signed: summary.remaining_budget < 0, compact: true })}
            </strong>
            <div className="widget__bar" aria-hidden="true">
              <span className="is-paid" style={{ width: share(summary.expense_paid) }} />
              <span className="is-pending" style={{ width: share(summary.expense_pending) }} />
              <span className="is-remaining" style={{ width: share(Math.max(0, summary.remaining_budget)) }} />
            </div>
            <p className="widget__budget-meta">
              {overdueCount > 0 ? (
                <span className="is-overdue">
                  {overdueCount} overdue payment{overdueCount > 1 ? "s" : ""}
                </span>
              ) : nextDue ? (
                <>
                  Next: <strong>{nextDue.category}</strong> {formatMoney(nextDue.amount, nextDue.currency, { compact: true })} ·{" "}
                  {formatShortDay(parseIsoDate(nextDue.occurred_on))}
                </>
              ) : (
                "Nothing left to pay this month"
              )}
            </p>
          </>
        ) : (
          <p className="widget__empty">{offline ? "Backend unreachable" : "Loading…"}</p>
        )}
      </section>

      <footer className="widget__footer">
        <span className={offline ? "widget__status is-offline" : "widget__status"}>
          <span className="widget__status-dot" aria-hidden="true" />
          {offline
            ? "Offline"
            : status.lastSyncedAt
              ? `Updated ${status.lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Connecting…"}
        </span>
      </footer>
    </div>
  );
}
