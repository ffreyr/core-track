/**
 * Study tab: a focus timer plus study statistics.
 *
 *   ┌──────────────── timer card ───────────────┐ ┌──────── stats ────────┐
 *   │ [Stopwatch | 25 min | 50 min | Custom]     │ │ Today · Week · Streak │
 *   │              ◯  24:13                      │ │ ▂▅▇▃▁▆█  last 7 days  │
 *   │ Subject [Mathematics      ]                │ │ By subject (7 days)   │
 *   │ Task    [Exam prep        ▾]               │ │ Today's sessions      │
 *   │          [ ▶ Start focus ]                 │ │                       │
 *   └────────────────────────────────────────────┘ └───────────────────────┘
 *
 * The timer itself lives on the server (see useStudyTimer): it keeps running
 * if the app is closed and shows the same time in the widget. Choosing a
 * Pomodoro length makes the session count down and stop automatically.
 */

import { useState, type FormEvent } from "react";

import { api, type StudySession } from "../../api";
import { ConfirmDeleteButton, ErrorNotice, Field, SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { useApiAction, useApiQuery } from "../../hooks/useApi";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useStudyTimer } from "../../hooks/useStudyTimer";
import { addDays, formatLongDay, formatWeekdayShort, parseIsoDate, toIsoDate, today } from "../../lib/dates";
import { formatClock, formatDuration, formatTimeOfDay, localTimeZone, toOffsetIso } from "../../lib/duration";

/** Timer modes: count up, or a Pomodoro countdown of N minutes. */
type Mode = "stopwatch" | "25" | "50" | "custom";

interface TimerSettings {
  mode: Mode;
  customMinutes: number;
  subject: string;
}

const DEFAULT_SETTINGS: TimerSettings = { mode: "25", customMinutes: 45, subject: "Study" };

/** Repair stored settings (shape may change between versions). */
function sanitizeSettings(stored: unknown): TimerSettings {
  const raw = (stored && typeof stored === "object" ? stored : {}) as Partial<TimerSettings>;
  const mode: Mode = ["stopwatch", "25", "50", "custom"].includes(raw.mode as string)
    ? (raw.mode as Mode)
    : DEFAULT_SETTINGS.mode;
  const custom = typeof raw.customMinutes === "number" ? Math.min(600, Math.max(1, Math.round(raw.customMinutes))) : 45;
  const subject = typeof raw.subject === "string" && raw.subject.trim() ? raw.subject.slice(0, 80) : "Study";
  return { mode, customMinutes: custom, subject };
}

/** Minutes for a mode, or `null` for the stopwatch. */
function plannedMinutes(settings: TimerSettings): number | null {
  if (settings.mode === "stopwatch") {
    return null;
  }
  return settings.mode === "custom" ? settings.customMinutes : Number(settings.mode);
}

// ---------------------------------------------------------------------------
// Big timer ring
// ---------------------------------------------------------------------------

/** Large progress ring with the clock in the middle. */
function TimerRing({ progress, clock, caption, running }: { progress: number; clock: string; caption: string; running: boolean }) {
  const size = 236;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={running ? "timer-ring is-running" : "timer-ring"} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="timer-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="timer-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="timer-ring__center">
        <span className="timer-ring__clock" role="timer" aria-live="off">
          {clock}
        </span>
        <span className="timer-ring__caption">{caption}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log-a-past-session dialog
// ---------------------------------------------------------------------------

function LogSessionDialog({ defaultSubject, onClose }: { defaultSubject: string; onClose: () => void }) {
  const run = useApiAction();
  const [subject, setSubject] = useState(defaultSubject);
  const [day, setDay] = useState(toIsoDate(today()));
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("10:00");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const start = new Date(`${day}T${from}:00`);
    const end = new Date(`${day}T${to}:00`);
    if (!subject.trim()) {
      setError("Give the session a subject.");
      return;
    }
    if (!(end > start)) {
      setError("The end time must be after the start time.");
      return;
    }
    setSaving(true);
    const result = await run(
      () => api.study.create({ subject: subject.trim(), started_at: toOffsetIso(start), ended_at: toOffsetIso(end) }),
      { success: "Session logged" },
    );
    setSaving(false);
    if (result.ok) {
      onClose();
    }
  };

  return (
    <Modal
      title="Log a past session"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="log-session-form" className="button button--primary" disabled={saving}>
            {saving ? "Saving…" : "Log session"}
          </button>
        </>
      }
    >
      <form id="log-session-form" className="form" onSubmit={submit}>
        <Field label="Subject" htmlFor="log-subject" error={error}>
          <input
            id="log-subject"
            className="input"
            value={subject}
            maxLength={80}
            autoFocus
            onChange={(event) => {
              setSubject(event.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field label="Day" htmlFor="log-day">
          <input id="log-day" type="date" className="input" value={day} required onChange={(event) => setDay(event.target.value)} />
        </Field>
        <div className="form__row">
          <Field label="From" htmlFor="log-from">
            <input id="log-from" type="time" className="input" value={from} required onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To" htmlFor="log-to">
            <input id="log-to" type="time" className="input" value={to} required onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Study tab
// ---------------------------------------------------------------------------

export function StudyView() {
  const run = useApiAction();
  const timer = useStudyTimer();
  const [settings, setSettings] = useLocalStorage<TimerSettings>("coretrack.studyTimer", DEFAULT_SETTINGS, sanitizeSettings);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const todayDate = today();
  const todayIso = toIsoDate(todayDate);
  const tz = localTimeZone();
  const weekStartIso = toIsoDate(addDays(todayDate, -6));
  const monthStartIso = toIsoDate(addDays(todayDate, -29));

  // Last 7 days (chart + subjects) and last 30 days (streak).
  const week = useApiQuery((signal) => api.study.summary(weekStartIso, todayIso, tz, signal), [weekStartIso, todayIso, tz]);
  const month = useApiQuery((signal) => api.study.summary(monthStartIso, todayIso, tz, signal), [monthStartIso, todayIso, tz]);
  // Today's session log (local midnight to midnight).
  const dayStart = toOffsetIso(todayDate);
  const dayEnd = toOffsetIso(addDays(todayDate, 1));
  const sessions = useApiQuery((signal) => api.study.list({ start: dayStart, end: dayEnd }, signal), [dayStart, dayEnd]);
  // Open tasks of today, to link a session to.
  const tasks = useApiQuery(
    (signal) => api.tasks.list({ start: todayIso, end: todayIso, completed: false }, signal),
    [todayIso],
  );

  const { active, elapsed, remaining } = timer;
  const running = active !== null;
  const planned = plannedMinutes(settings);

  // Ring and clock: countdown for Pomodoro, count-up for the stopwatch.
  let clock: string;
  let progress: number;
  let caption: string;
  if (active) {
    if (active.planned_minutes) {
      clock = formatClock(remaining ?? 0);
      progress = elapsed / (active.planned_minutes * 60);
      caption = `${active.planned_minutes} min focus`;
    } else {
      clock = formatClock(elapsed);
      progress = (elapsed % 3600) / 3600; // One lap per hour.
      caption = "Stopwatch";
    }
  } else {
    clock = planned ? formatClock(planned * 60) : formatClock(0);
    progress = 0;
    caption = planned ? "Ready" : "Stopwatch";
  }

  // Live today/week totals include the running session.
  const weekSeconds = (week.data?.total_seconds ?? 0) + elapsed;
  const todaySessions = sessions.data ?? [];
  const completedToday = todaySessions.filter((session) => !session.is_running).length;

  // Streak: consecutive days up to today with any study (today may still be in progress).
  const streak = (() => {
    const days = [...(month.data?.days ?? [])].reverse(); // Today first.
    let count = 0;
    for (const [index, day] of days.entries()) {
      const studied = day.seconds > 0 || (index === 0 && elapsed > 0);
      if (studied) {
        count += 1;
      } else if (index > 0) {
        break; // A gap before today ends the streak; an empty *today* does not.
      }
    }
    return count;
  })();

  // 7-day bars (today's bar includes the running session).
  const chartDays = (week.data?.days ?? []).map((day) => ({
    ...day,
    seconds: day.date === todayIso ? day.seconds + elapsed : day.seconds,
  }));
  const chartMax = Math.max(1800, ...chartDays.map((day) => day.seconds));
  const subjects = week.data?.by_subject ?? [];
  const subjectMax = Math.max(1, ...subjects.map((entry) => entry.seconds));
  const subjectSuggestions = [...new Set([...(month.data?.by_subject.map((entry) => entry.subject) ?? []), ...timer.recentSubjects])];

  const startTimer = () =>
    void timer.start({ subject: settings.subject.trim() || "Study", task_id: taskId, planned_minutes: planned });

  const error = week.error ?? sessions.error ?? month.error;

  return (
    <div className="study-view">
      <header className="toolbar" data-tauri-drag-region>
        <div className="toolbar__group">
          <h1 className="toolbar__title" data-tauri-drag-region>
            Study
          </h1>
          <span className="toolbar__subtitle" data-tauri-drag-region>
            {formatLongDay(todayDate)}
          </span>
        </div>
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => setLogOpen(true)}>
            <Icon name="plus" size={14} />
            Log past session
          </button>
        </div>
      </header>

      {error ? (
        <ErrorNotice
          error={error}
          onRetry={() => {
            week.reload();
            month.reload();
            sessions.reload();
          }}
        />
      ) : null}

      <div className="study-layout">
        {/* ---- Timer card ---- */}
        <section className={running ? "panel timer-card is-running" : "panel timer-card"} aria-label="Focus timer">
          <SegmentedControl
            label="Timer mode"
            value={running ? (active?.planned_minutes ? settings.mode : "stopwatch") : settings.mode}
            onChange={(mode) => !running && setSettings((current) => ({ ...current, mode }))}
            options={[
              { value: "stopwatch", label: "Stopwatch" },
              { value: "25", label: "25 min" },
              { value: "50", label: "50 min" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {settings.mode === "custom" && !running ? (
            <label className="timer-card__custom">
              <input
                type="number"
                className="input input--narrow"
                min={1}
                max={600}
                value={settings.customMinutes}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, customMinutes: Math.min(600, Math.max(1, Number(event.target.value) || 1)) }))
                }
              />
              minutes
            </label>
          ) : null}

          <TimerRing progress={progress} clock={clock} caption={caption} running={running} />

          {running && active ? (
            <div className="timer-card__running">
              <span className="timer-card__subject">{active.subject}</span>
              <span className="timer-card__meta">
                since {formatTimeOfDay(active.started_at)}
                {active.task_title ? ` · ${active.task_title}` : ""}
              </span>
            </div>
          ) : (
            <div className="timer-card__fields">
              <Field label="Subject" htmlFor="study-subject">
                <input
                  id="study-subject"
                  className="input"
                  list="study-subjects"
                  maxLength={80}
                  value={settings.subject}
                  placeholder="What are you studying?"
                  onChange={(event) => setSettings((current) => ({ ...current, subject: event.target.value }))}
                />
                <datalist id="study-subjects">
                  {subjectSuggestions.map((subject) => (
                    <option key={subject} value={subject} />
                  ))}
                </datalist>
              </Field>
              <Field label="Linked task (optional)" htmlFor="study-task">
                <select
                  id="study-task"
                  className="input"
                  value={taskId ?? ""}
                  onChange={(event) => setTaskId(event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">No task</option>
                  {(tasks.data ?? []).map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {running ? (
            <button type="button" className="button button--danger timer-card__action" onClick={() => void timer.stop()}>
              <Icon name="stop" size={16} />
              Stop
            </button>
          ) : (
            <button type="button" className="button button--primary timer-card__action" onClick={startTimer}>
              <Icon name="play" size={16} />
              {planned ? `Start ${planned}-min focus` : "Start stopwatch"}
            </button>
          )}
        </section>

        {/* ---- Stats ---- */}
        <div className="study-stats">
          <div className="study-kpis">
            <div className="study-kpi">
              <span className="stat__label">Today</span>
              <strong>{formatDuration(timer.todaySeconds)}</strong>
              <span className="study-kpi__hint">
                {completedToday} session{completedToday === 1 ? "" : "s"}
              </span>
            </div>
            <div className="study-kpi">
              <span className="stat__label">Last 7 days</span>
              <strong>{formatDuration(weekSeconds)}</strong>
              <span className="study-kpi__hint">avg {formatDuration(weekSeconds / 7)}/day</span>
            </div>
            <div className="study-kpi">
              <span className="stat__label">Streak</span>
              <strong>
                {streak} day{streak === 1 ? "" : "s"}
              </strong>
              <span className="study-kpi__hint">{streak > 0 ? "keep it going" : "start today"}</span>
            </div>
          </div>

          <section className="panel">
            <h2>Last 7 days</h2>
            <div className="study-chart" role="img" aria-label="Study time per day for the last 7 days">
              {chartDays.map((day) => (
                <div key={day.date} className={day.date === todayIso ? "study-chart__col is-today" : "study-chart__col"}>
                  <span className="study-chart__value">{day.seconds > 0 ? formatDuration(day.seconds) : ""}</span>
                  <div className="study-chart__track">
                    <div className="study-chart__bar" style={{ height: `${(day.seconds / chartMax) * 100}%` }} />
                  </div>
                  <span className="study-chart__label">{formatWeekdayShort(parseIsoDate(day.date))}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="study-columns">
            <section className="panel">
              <h2>By subject · 7 days</h2>
              {subjects.length === 0 ? (
                <p className="empty-text">No completed sessions yet.</p>
              ) : (
                <ul className="study-subjects">
                  {subjects.map((entry) => (
                    <li key={entry.subject}>
                      <div className="study-subjects__label">
                        <span>{entry.subject}</span>
                        <strong>{formatDuration(entry.seconds)}</strong>
                      </div>
                      <div className="study-subjects__track">
                        <div style={{ width: `${(entry.seconds / subjectMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Today's sessions</h2>
              {todaySessions.length === 0 ? (
                <p className="empty-text">{sessions.data ? "No sessions yet today." : "Loading…"}</p>
              ) : (
                <ul className="item-list">
                  {todaySessions.map((session: StudySession) => (
                    <li key={session.id} className="item-row study-session">
                      <span className={session.is_running ? "study-session__dot is-running" : "study-session__dot"} />
                      <div className="item-row__main">
                        <span className="item-row__title">{session.subject}</span>
                        <span className="item-row__meta">
                          {formatTimeOfDay(session.started_at)}
                          {session.ended_at ? ` – ${formatTimeOfDay(session.ended_at)}` : " – now"}
                          {session.task_title ? ` · ${session.task_title}` : ""}
                        </span>
                      </div>
                      <span className="item-row__amount">
                        {session.duration_seconds !== null ? formatDuration(session.duration_seconds) : formatClock(elapsed)}
                      </span>
                      {!session.is_running ? (
                        <ConfirmDeleteButton
                          label=""
                          onConfirm={() => void run(() => api.study.remove(session.id), { success: "Session deleted" })}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      {logOpen ? <LogSessionDialog defaultSubject={settings.subject || "Study"} onClose={() => setLogOpen(false)} /> : null}
    </div>
  );
}
