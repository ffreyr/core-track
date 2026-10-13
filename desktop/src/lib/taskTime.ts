/**
 * Task clock times ("HH:MM", 24-hour): parsing user input and display.
 */

import type { Task } from "../api";

/**
 * Normalise what the user typed into a 24-hour "HH:MM" string.
 *
 * Accepts "9", "09", "930", "0930", "9:30", "9.30", "14:30", "1430".
 *
 * @returns The normalised time, `null` for empty input, or `undefined` when
 *   the input is not a valid time.
 */
export function normalizeTimeInput(raw: string): string | null | undefined {
  const text = raw.trim().replace(".", ":");
  if (text === "") {
    return null;
  }
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(text);
  if (!match) {
    return undefined;
  }
  let hours: number;
  let minutes: number;
  if (match[2] === undefined && match[1].length <= 2) {
    hours = Number(match[1]);
    minutes = 0;
  } else {
    hours = Number(match[1]);
    minutes = Number(match[2]);
  }
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Display label for a task's times: "14:30", "14:30–16:00", or `null` for
 * an all-day task.
 */
export function formatTaskTime(task: Pick<Task, "due_time" | "end_time">): string | null {
  if (!task.due_time) {
    return null;
  }
  return task.end_time && task.end_time !== task.due_time ? `${task.due_time}–${task.end_time}` : task.due_time;
}
