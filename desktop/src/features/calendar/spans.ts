/**
 * Multi-day bar layout (Google Calendar style), pure functions.
 *
 * Within one grid row, every multi-day task becomes a *segment*: a
 * contiguous run of columns it covers. Segments are packed into horizontal
 * *lanes* so they never overlap, using the classic greedy interval
 * algorithm:
 *
 *   1. Sort segments by start column, longer segments first on ties.
 *   2. Put each segment in the lowest lane whose last occupied column is
 *      before the segment's start.
 *
 *   lane 0: [====== Trip ======]   [= Conf =]
 *   lane 1:      [== Course ==]
 *
 * Each segment is then rendered once as a CSS grid item spanning its columns
 * (`grid-column: start / span n`), which is what makes it look like one
 * continuous block instead of per-day chips.
 *
 * Lanes are computed per row, like Google Calendar: a task that continues
 * into the next week may sit in a different lane there. `continuesBefore` /
 * `continuesAfter` tell the renderer to draw a flat, arrowed edge.
 */

import type { CalendarDay, IsoDate, Task } from "../../api";

/** One multi-day task's appearance within a single row. */
export interface BarSegment {
  task: Task;
  /** First column covered in this row (0-based). */
  startCol: number;
  /** Last column covered in this row (inclusive). */
  endCol: number;
  /** Lane index (0 = top). */
  lane: number;
  /** The task started before this row's first covered day. */
  continuesBefore: boolean;
  /** The task continues after this row's last covered day. */
  continuesAfter: boolean;
}

/** Result of laying out one row. */
export interface RowBars {
  segments: BarSegment[];
  /** Number of lanes used (0 when the row has no multi-day tasks). */
  laneCount: number;
}

/** Last day covered by a task. */
export function taskLastIso(task: Task): IsoDate {
  return task.end_date ?? task.due_date;
}

/** `true` for tasks rendered as bars. */
export function isMultiDay(task: Task): boolean {
  return task.span_days > 1;
}

/**
 * Lay out the multi-day bars of one row.
 *
 * @param rowIsos - ISO dates of the row's columns, in order. May skip
 *   weekends; a task covering Fri–Mon then occupies Fri and Mon columns,
 *   which are adjacent, so segments stay contiguous.
 * @param dayData - Calendar data per column (`undefined` while loading).
 * @param isVisible - Display filter (scopes, completed tasks).
 */
export function layoutRowBars(
  rowIsos: IsoDate[],
  dayData: (CalendarDay | undefined)[],
  isVisible: (task: Task) => boolean,
): RowBars {
  // Collect each multi-day task once (it is repeated on every day it covers).
  const tasks = new Map<number, Task>();
  for (const day of dayData) {
    for (const task of day?.tasks ?? []) {
      if (isMultiDay(task) && isVisible(task) && !tasks.has(task.id)) {
        tasks.set(task.id, task);
      }
    }
  }

  const segments: Omit<BarSegment, "lane">[] = [];
  for (const task of tasks.values()) {
    const last = taskLastIso(task);
    let startCol = -1;
    let endCol = -1;
    rowIsos.forEach((iso, col) => {
      if (iso >= task.due_date && iso <= last) {
        if (startCol === -1) {
          startCol = col;
        }
        endCol = col;
      }
    });
    if (startCol === -1) {
      continue; // Covers only hidden weekend days in this row.
    }
    segments.push({
      task,
      startCol,
      endCol,
      continuesBefore: task.due_date < rowIsos[startCol],
      continuesAfter: last > rowIsos[endCol],
    });
  }

  segments.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.task.due_date.localeCompare(b.task.due_date) ||
      a.task.id - b.task.id,
  );

  // laneEnds[i] = last column occupied in lane i.
  const laneEnds: number[] = [];
  const placed: BarSegment[] = segments.map((segment) => {
    let lane = laneEnds.findIndex((lastCol) => lastCol < segment.startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(segment.endCol);
    } else {
      laneEnds[lane] = segment.endCol;
    }
    return { ...segment, lane };
  });

  return { segments: placed, laneCount: laneEnds.length };
}
