/**
 * Month balance chart: actual vs. projected (pure SVG, no chart library).
 *
 * Two cumulative series over the days of the month, both starting at zero:
 *  - **Projected** (dashed): every entry, paid or pending — where the month
 *    ends up if all plans happen.
 *  - **Actual** (solid): settled entries only, drawn up to today — where the
 *    money really is.
 *
 * The gap between the lines at any point is what is still pending. Clicking
 * anywhere opens that day in the calendar.
 */

import type { DailyNet, IsoDate } from "../../api";
import { formatShortDay, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

interface BalanceChartProps {
  daily: DailyNet[];
  currency: string;
  todayIso: IsoDate;
  onSelectDay: (iso: IsoDate) => void;
}

const WIDTH = 600;
const HEIGHT = 170;
const PADDING_Y = 12;

export function BalanceChart({ daily, currency, todayIso, onSelectDay }: BalanceChartProps) {
  // Cumulative series (cents to avoid float drift).
  let projectedCents = 0;
  let actualCents = 0;
  const points = daily.map((day) => {
    projectedCents += Math.round(day.net * 100);
    const settledIncome = day.income - day.income_pending;
    const settledExpense = day.expense - day.expense_pending;
    actualCents += Math.round((settledIncome - settledExpense) * 100);
    return { date: day.date, projected: projectedCents / 100, actual: actualCents / 100, day };
  });

  const values = points.flatMap((point) => [point.projected, point.actual]);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? WIDTH / (points.length - 1) : WIDTH;
  const x = (index: number) => index * stepX;
  const y = (value: number) => PADDING_Y + ((max - value) / span) * (HEIGHT - PADDING_Y * 2);

  const projectedPath = points.map((point, index) => `${x(index)},${y(point.projected)}`).join(" ");
  // Actual balance only exists up to today.
  const actualPoints = points.filter((point) => point.date <= todayIso);
  const actualPath = actualPoints.map((point, index) => `${x(index)},${y(point.actual)}`).join(" ");
  const todayIndex = points.findIndex((point) => point.date === todayIso);
  const last = points[points.length - 1];
  const lastActual = actualPoints[actualPoints.length - 1];

  return (
    <figure className="balance-chart">
      <div className="balance-chart__legend">
        <span>
          <i className="legend-line is-actual" /> Actual {lastActual ? formatMoney(lastActual.actual, currency, { signed: true }) : "—"}
        </span>
        <span>
          <i className="legend-line is-projected" /> Projected month end{" "}
          {last ? formatMoney(last.projected, currency, { signed: true }) : "—"}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="balance-chart__svg"
        role="img"
        aria-label="Cumulative balance over the month, actual and projected"
      >
        <line x1={0} x2={WIDTH} y1={y(0)} y2={y(0)} className="balance-chart__zero" />
        {todayIndex >= 0 ? (
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1={0} y2={HEIGHT} className="balance-chart__today" />
        ) : null}
        <polyline points={projectedPath} className="balance-chart__line is-projected" />
        {actualPoints.length > 0 ? <polyline points={actualPath} className="balance-chart__line is-actual" /> : null}
        {points.map((point, index) => (
          <rect
            key={point.date}
            x={x(index) - stepX / 2}
            y={0}
            width={stepX}
            height={HEIGHT}
            className="balance-chart__hit"
            onClick={() => onSelectDay(point.date)}
          >
            <title>
              {`${formatShortDay(parseIsoDate(point.date))}\nProjected ${formatMoney(point.projected, currency, { signed: true })}` +
                (point.date <= todayIso ? `\nActual ${formatMoney(point.actual, currency, { signed: true })}` : "") +
                (point.day.expense_pending > 0 ? `\nPending ${formatMoney(point.day.expense_pending, currency)}` : "")}
            </title>
          </rect>
        ))}
      </svg>
      <figcaption className="balance-chart__axis">
        <span>{points[0] ? formatShortDay(parseIsoDate(points[0].date)) : ""}</span>
        <span>Click the chart to open a day in the calendar</span>
        <span>{last ? formatShortDay(parseIsoDate(last.date)) : ""}</span>
      </figcaption>
    </figure>
  );
}
