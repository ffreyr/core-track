/**
 * Calendar grid: weekday header + a scroll container of week rows.
 *
 * Two height policies:
 *  - **fixed** (Month / 2 Weeks, infinite scroll): every row has the same
 *    height, derived from the viewport (`rowsPerScreen` rows per screen).
 *  - **fill** (Week / N Days, paged): rows share the viewport; a single-row
 *    view lists every item and may grow, in which case the container scrolls.
 *
 * Infinite scroll (when `infinite` is given):
 *  - Two sentinel elements sit above the first and below the last row. An
 *    IntersectionObserver (rooted at the scroll container, with a generous
 *    margin) calls `onReachStart` / `onReachEnd` when either comes near the
 *    viewport, and the parent grows its week window.
 *  - Scroll anchoring keeps the view perfectly still when weeks are
 *    prepended (or trimmed far away): on every scroll we remember which row
 *    is at the top and its pixel offset; after rows change we restore that
 *    row to the same offset. WebKit (Tauri's macOS webview) has no native
 *    CSS scroll anchoring, so this is done manually in a layout effect,
 *    before the browser paints.
 *  - `scrollRequest` jumps a row to the top (toolbar navigation). Requests
 *    are identified by a nonce so repeating the same target still works.
 *  - The row covering the upper third of the viewport is reported as the
 *    "focus" row; the parent derives the title and shading from it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CalendarDay, IsoDate } from "../../api";
import { formatWeekdayShort, toIsoDate } from "../../lib/dates";
import type { Preferences } from "../../state/preferences";
import { CalendarWeekRow } from "./CalendarWeekRow";
import type { CalendarRow } from "./layout";
import { fillRowHeight, fixedRowHeight, itemSlots, ROW_METRICS } from "./metrics";
import type { CellHandlers } from "./types";

/** Jump-to-row request; a new `nonce` makes it fire even for the same row. */
export interface ScrollRequest {
  rowKey: string;
  nonce: number;
}

/** Infinite-scroll wiring supplied by the scrolling views. */
export interface InfiniteScrollOptions {
  rowsPerScreen: number;
  scrollRequest: ScrollRequest;
  onReachStart: () => void;
  onReachEnd: () => void;
  /** Rows at the top of / a third into the viewport changed. */
  onViewportChange: (topRowKey: string, focusRowKey: string) => void;
}

interface CalendarGridProps {
  rows: CalendarRow[];
  columns: number;
  /** Show the weekday header (rows are calendar weeks). */
  weekdayHeader: boolean;
  dayMap: Map<IsoDate, CalendarDay>;
  preferences: Preferences;
  todayIso: IsoDate;
  selectedIso: IsoDate | null;
  dropTargetIso: IsoDate | null;
  focusMonth: { year: number; month: number } | null;
  /** Dim the grid during the very first load. */
  loading: boolean;
  handlers: CellHandlers;
  /** Present for Month / 2 Weeks; absent for paged views. */
  infinite?: InfiniteScrollOptions;
}

/** Distance from an edge (px) at which the next block is loaded. */
const EDGE_MARGIN_PX = 600;

/** Return `iso` if it belongs to the row, else `null` (keeps row memo effective). */
function inRow(rowIsos: Set<IsoDate>, iso: IsoDate | null): IsoDate | null {
  return iso !== null && rowIsos.has(iso) ? iso : null;
}

export function CalendarGrid({
  rows,
  columns,
  weekdayHeader,
  dayMap,
  preferences,
  todayIso,
  selectedIso,
  dropTargetIso,
  focusMonth,
  loading,
  handlers,
  infinite,
}: CalendarGridProps) {
  const metrics = ROW_METRICS[preferences.density];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Latest callbacks in a ref, so observers are created once.
  const infiniteRef = useRef(infinite);
  useEffect(() => {
    infiniteRef.current = infinite;
  });

  // ---- Viewport measurement ---------------------------------------------

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return undefined;
    }
    const measure = () => setViewportHeight(scroller.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // ---- Row height & item budget -----------------------------------------

  const isInfinite = infinite !== undefined;
  const rowHeight = isInfinite
    ? fixedRowHeight(viewportHeight, infinite.rowsPerScreen, metrics)
    : fillRowHeight(viewportHeight, rows.length, metrics);
  // Single-row paged views are tall: list everything and let the row grow.
  const budget = !isInfinite && rows.length === 1 ? Number.POSITIVE_INFINITY : itemSlots(rowHeight, metrics);

  // ---- Scroll anchoring & viewport reporting ----------------------------

  /** Row at the top of the viewport and its offset, refreshed on every scroll. */
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const lastReported = useRef<{ top: string; focus: string } | null>(null);
  const handledNonce = useRef<number | null>(null);

  /** Recompute the anchor row and report top/focus rows to the parent. */
  const captureViewport = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const rowElements = scroller.querySelectorAll<HTMLElement>("[data-row-key]");
    const top = scroller.scrollTop;
    const focusLine = top + scroller.clientHeight / 3;
    let topRow: HTMLElement | null = null;
    let focusRow: HTMLElement | null = null;
    for (const element of rowElements) {
      const bottom = element.offsetTop + element.offsetHeight;
      if (!topRow && bottom > top + 1) {
        topRow = element;
      }
      if (!focusRow && bottom > focusLine) {
        focusRow = element;
        break;
      }
    }
    if (!topRow) {
      return;
    }
    focusRow = focusRow ?? topRow;
    const topKey = topRow.dataset.rowKey ?? "";
    const focusKey = focusRow.dataset.rowKey ?? "";
    anchor.current = { key: topKey, offset: topRow.offsetTop - top };

    if (lastReported.current?.top !== topKey || lastReported.current?.focus !== focusKey) {
      lastReported.current = { top: topKey, focus: focusKey };
      infiniteRef.current?.onViewportChange(topKey, focusKey);
    }
  }, []);

  /** Load more if either end is within the edge margin (backs up the observer). */
  const checkEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    const options = infiniteRef.current;
    if (!scroller || !options || handledNonce.current !== options.scrollRequest.nonce) {
      return;
    }
    if (scroller.scrollTop < EDGE_MARGIN_PX) {
      options.onReachStart();
    } else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < EDGE_MARGIN_PX) {
      options.onReachEnd();
    }
  }, []);

  const rowsSignature = rows.length > 0 ? `${rows[0].key}|${rows[rows.length - 1].key}|${rows.length}` : "";
  const requestNonce = infinite?.scrollRequest.nonce ?? null;
  const requestKey = infinite?.scrollRequest.rowKey ?? null;

  // Runs before paint whenever rows, heights or the jump request change.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !isInfinite || viewportHeight === 0) {
      return undefined;
    }
    // 1. Pending jump request: bring the requested row to the top.
    if (requestNonce !== null && handledNonce.current !== requestNonce) {
      const target = scroller.querySelector<HTMLElement>(`[data-row-key="${requestKey}"]`);
      if (target) {
        scroller.scrollTop = target.offsetTop;
        handledNonce.current = requestNonce;
        captureViewport();
      }
      return undefined;
    }
    // 2. Otherwise keep the previously visible row exactly where it was.
    const saved = anchor.current;
    if (saved) {
      const target = scroller.querySelector<HTMLElement>(`[data-row-key="${saved.key}"]`);
      if (target) {
        scroller.scrollTop = target.offsetTop - saved.offset;
      }
    }
    captureViewport();
    // After the DOM settles, keep loading if we are still near an edge.
    const frame = window.requestAnimationFrame(checkEdges);
    return () => window.cancelAnimationFrame(frame);
  }, [rowsSignature, rowHeight, requestNonce, requestKey, isInfinite, viewportHeight, captureViewport, checkEdges]);

  // ---- IntersectionObserver on the sentinels ----------------------------

  useEffect(() => {
    const scroller = scrollerRef.current;
    const top = topSentinelRef.current;
    const bottom = bottomSentinelRef.current;
    if (!scroller || !top || !bottom || !isInfinite) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const options = infiniteRef.current;
        // Ignore edge hits until the initial/jump scroll has been applied,
        // otherwise the initial scrollTop of 0 would trigger a prepend.
        if (!options || handledNonce.current !== options.scrollRequest.nonce) {
          return;
        }
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          if (entry.target === top) {
            options.onReachStart();
          } else if (entry.target === bottom) {
            options.onReachEnd();
          }
        }
      },
      { root: scroller, rootMargin: `${EDGE_MARGIN_PX}px 0px` },
    );
    observer.observe(top);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [isInfinite]);

  // ---- Scroll handler (rAF-throttled) -----------------------------------

  const scrollFrame = useRef<number | null>(null);
  const onScroll = () => {
    if (scrollFrame.current !== null) {
      return;
    }
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      captureViewport();
    });
  };
  useEffect(
    () => () => {
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
      }
    },
    [],
  );

  // ---- Render -------------------------------------------------------------

  const weekdayLabels = useMemo(() => (rows[0]?.days ?? []).slice(0, columns).map(formatWeekdayShort), [rows, columns]);

  return (
    <div
      className={`calendar-grid density-${preferences.density}${loading ? " is-loading" : ""}`}
      role="grid"
      aria-busy={loading}
    >
      {weekdayHeader ? (
        <div className="calendar-grid__weekdays" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {weekdayLabels.map((label) => (
            <div key={label} className="calendar-grid__weekday" role="columnheader">
              {label}
            </div>
          ))}
        </div>
      ) : null}

      <div
        className={isInfinite ? "calendar-grid__scroller is-infinite" : "calendar-grid__scroller"}
        ref={scrollerRef}
        onScroll={isInfinite ? onScroll : undefined}
      >
        {isInfinite ? <div ref={topSentinelRef} className="calendar-grid__sentinel" aria-hidden="true" /> : null}
        {viewportHeight > 0
          ? rows.map((row, index) => {
              const rowIsos = new Set(row.days.map(toIsoDate));
              return (
                <CalendarWeekRow
                  key={row.key}
                  row={row}
                  columns={columns}
                  dayData={row.days.map((day) => dayMap.get(toIsoDate(day)))}
                  height={rowHeight}
                  fill={!isInfinite}
                  budget={budget}
                  metrics={metrics}
                  preferences={preferences}
                  todayIso={todayIso}
                  selectedIso={inRow(rowIsos, selectedIso)}
                  dropTargetIso={inRow(rowIsos, dropTargetIso)}
                  focusMonth={focusMonth}
                  showWeekday={!weekdayHeader}
                  isFirstRow={index === 0}
                  handlers={handlers}
                />
              );
            })
          : null}
        {isInfinite ? <div ref={bottomSentinelRef} className="calendar-grid__sentinel" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
