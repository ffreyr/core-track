/**
 * Pixel metrics for calendar rows — the single source of truth.
 *
 * These numbers drive BOTH the rendered layout (they are applied as inline
 * styles / CSS custom properties by `CalendarWeekRow`) AND the "how many
 * items fit" calculation, so the "+N more" logic can never drift from what
 * is actually drawn. Change sizes here, not in CSS.
 *
 * Anatomy of one week row (top to bottom):
 *
 *   ┌───────────────────────────────┐
 *   │ header (padding + day number) │  header
 *   │ ▬▬▬▬▬▬▬ multi-day bar ▬▬▬▬▬▬▬ │  lane × N   (item + gap each)
 *   │ ▭ single-day chip             │  item + gap
 *   │ ▭ single-day chip             │  item + gap
 *   │ +3 more                       │  more + gap (always reserved)
 *   └───────────────────────────────┘  paddingBottom
 */

import type { Density } from "../../state/preferences";

export interface RowMetrics {
  /** Height of the header track (top padding + day number badge). */
  header: number;
  /** Height of one chip or one multi-day bar. */
  item: number;
  /** Vertical gap below each chip/bar. */
  gap: number;
  /** Height of the "+N more" button. */
  more: number;
  /** Bottom padding of a row. */
  paddingBottom: number;
  /** Smallest allowed row height. */
  rowMin: number;
}

export const ROW_METRICS: Record<Density, RowMetrics> = {
  comfortable: { header: 32, item: 24, gap: 3, more: 20, paddingBottom: 6, rowMin: 140 },
  compact: { header: 28, item: 20, gap: 2, more: 18, paddingBottom: 4, rowMin: 108 },
};

/**
 * How many items (multi-day lanes + single-day chips) fit in a row of
 * `rowHeight` px, always leaving room for a "+N more" button. Never less
 * than 1, so every non-empty day shows something.
 */
export function itemSlots(rowHeight: number, metrics: RowMetrics): number {
  const available = rowHeight - metrics.header - metrics.paddingBottom - (metrics.more + metrics.gap);
  return Math.max(1, Math.floor(available / (metrics.item + metrics.gap)));
}

/**
 * Fixed row heights for the infinite-scroll views: the viewport is divided
 * into `rowsPerScreen` rows (5 for Month, 2 for 2 Weeks), never below the
 * density minimum. All rows share this height regardless of content.
 */
export function fixedRowHeight(viewportHeight: number, rowsPerScreen: number, metrics: RowMetrics): number {
  return Math.max(metrics.rowMin, Math.floor(viewportHeight / rowsPerScreen));
}

/**
 * Fill heights for the paged views: rows share the viewport equally (minus
 * the 1px row borders), never below the density minimum.
 */
export function fillRowHeight(viewportHeight: number, rows: number, metrics: RowMetrics): number {
  return Math.max(metrics.rowMin, Math.floor((viewportHeight - (rows - 1)) / rows));
}
