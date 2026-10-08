/**
 * Finance tab: a multi-month cash-flow projection laid out like an Excel
 * sheet (see CashFlowSheet for the grid itself).
 *
 * The sheet shows a rolling window of consecutive months starting at the
 * app's shared anchor month (normally the current month). The toolbar moves
 * the window one month at a time, changes its width (3 / 4 / 6 months,
 * remembered between sessions) and adds entries.
 *
 * Every mutation (paid toggle, edits, new entries) goes through
 * `useApiAction`, which invalidates all queries, so the sheet, its server-
 * computed totals and the calendar all refresh together.
 */

import { api, type FinanceKind, type FinanceLog, type IsoDate } from "../../api";
import { ErrorNotice, SegmentedControl } from "../../components/controls";
import { Icon } from "../../components/Icon";
import { useApiAction } from "../../hooks/useApi";
import { useFinanceWindow, type FinanceMonth } from "../../hooks/useFinanceWindow";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { addMonths, endOfMonth, formatMonthYear, startOfMonth, toIsoDate, today } from "../../lib/dates";
import { usePreferences } from "../../state/preferences";
import { useEditors } from "../editors/EditorsProvider";
import { CashFlowSheet } from "./CashFlowSheet";

interface FinanceViewProps {
  /** First month of the window comes from the app's shared anchor date. */
  anchor: Date;
  onAnchorChange: (date: Date) => void;
  /** Jump to the calendar with this day selected. */
  onOpenDay: (iso: IsoDate) => void;
}

/** Window widths offered in the toolbar. */
const WINDOW_SIZES = [3, 4, 6] as const;
type WindowSize = (typeof WINDOW_SIZES)[number];

/** Accept only a known window size from storage. */
function sanitizeWindowSize(stored: unknown): WindowSize {
  return WINDOW_SIZES.includes(stored as WindowSize) ? (stored as WindowSize) : 6;
}

export function FinanceView({ anchor, onAnchorChange, onOpenDay }: FinanceViewProps) {
  const { preferences } = usePreferences();
  const { openFinance } = useEditors();
  const run = useApiAction();
  const [monthCount, setMonthCount] = useLocalStorage<WindowSize>("coretrack.financeMonths", 6, sanitizeWindowSize);

  const firstMonth = startOfMonth(anchor);
  const lastMonth = addMonths(firstMonth, monthCount - 1);
  const todayIso = toIsoDate(today());
  const sheet = useFinanceWindow(firstMonth, monthCount);

  /** Default date for a new entry in `month`: today if inside it, else the 1st. */
  const defaultDateIn = (month: Date): IsoDate => {
    const startIso = toIsoDate(startOfMonth(month));
    const endIso = toIsoDate(endOfMonth(month));
    return todayIso >= startIso && todayIso <= endIso ? todayIso : startIso;
  };

  const togglePaid = (log: FinanceLog) => {
    const done = log.kind === "income" ? "received" : "paid";
    void run(() => api.finance.togglePaid(log.id), {
      success: log.is_paid ? `${log.category} marked as pending` : `${log.category} marked as ${done}`,
    });
  };

  // The finance editor infers paid/pending from the date (future = pending).
  const addEntry = (month: FinanceMonth, kind: FinanceKind) => openFinance({ date: defaultDateIn(month.start), kind });

  const rangeTitle = `${formatMonthYear(firstMonth)} – ${formatMonthYear(lastMonth)}`;

  return (
    <div className="finance-view">
      <header className="toolbar">
        <div className="toolbar__group">
          <button type="button" className="button" onClick={() => onAnchorChange(today())}>
            This month
          </button>
          <div className="button-group">
            <button
              type="button"
              className="icon-button"
              onClick={() => onAnchorChange(addMonths(firstMonth, -1))}
              aria-label="Previous month"
              title="Shift the window one month back"
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onAnchorChange(addMonths(firstMonth, 1))}
              aria-label="Next month"
              title="Shift the window one month forward"
            >
              <Icon name="chevronRight" />
            </button>
          </div>
          <h1 className="toolbar__title">{rangeTitle}</h1>
          <span className={sheet.loading ? "sync-spinner is-active" : "sync-spinner"} aria-hidden="true" />
        </div>

        <div className="toolbar__group">
          <SegmentedControl
            size="sm"
            label="Months shown"
            value={monthCount}
            onChange={setMonthCount}
            options={WINDOW_SIZES.map((size) => ({ value: size, label: `${size} months` }))}
          />
          <button type="button" className="button" onClick={() => openFinance({ date: defaultDateIn(firstMonth), kind: "income" })}>
            <Icon name="arrowUp" size={14} />
            Income
          </button>
          <button type="button" className="button" onClick={() => openFinance({ date: defaultDateIn(firstMonth), kind: "expense" })}>
            <Icon name="arrowDown" size={14} />
            Expense
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => openFinance({ date: defaultDateIn(firstMonth), kind: "expense", paid: false })}
            title="Plan a future payment, e.g. a credit card due date"
          >
            <Icon name="plus" size={14} />
            Planned payment
          </button>
        </div>
      </header>

      {sheet.error ? <ErrorNotice error={sheet.error} onRetry={sheet.reload} /> : null}

      <div className="finance-sheet-area">
        {sheet.months ? (
          <CashFlowSheet
            months={sheet.months}
            currency={preferences.defaultCurrency}
            todayIso={todayIso}
            stale={sheet.stale}
            onTogglePaid={togglePaid}
            onEdit={(log) => openFinance({ log })}
            onAdd={addEntry}
            onOpenDay={onOpenDay}
          />
        ) : (
          <p className="empty-text sheet-loading">{sheet.error ? "" : "Loading months…"}</p>
        )}
        <p className="sheet-legend">
          <span>
            <input type="checkbox" checked readOnly tabIndex={-1} aria-hidden="true" /> paid / received
          </span>
          <span className="sheet-legend__pending">pending</span>
          <span className="sheet-legend__overdue">overdue</span>
          <span>Click an item to edit · click its day to open the calendar · double-click an empty cell to add</span>
        </p>
      </div>
    </div>
  );
}
