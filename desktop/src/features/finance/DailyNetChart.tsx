/**
 * Bar chart of daily net cash flow for one month (pure SVG, no chart library).
 *
 * Each day is a bar rising (income > expense, green) or falling (red) from a
 * zero baseline. The vertical scale is symmetric around the larger of the
 * biggest gain and biggest loss, so bar heights are comparable in both
 * directions. Clicking a bar opens that day on the calendar — this is the
 * bridge between the finance tab and the calendar view.
 */

import type { DailyNet, IsoDate } from "../../api";
import { formatShortDay, parseIsoDate } from "../../lib/dates";
import { formatMoney } from "../../lib/money";

interface DailyNetChartProps {
  daily: DailyNet[];
  currency: string;
  todayIso: IsoDate;
  onSelectDay: (iso: IsoDate) => void;
}

const HEIGHT = 160;
const HALF = HEIGHT / 2;
const BAR_GAP = 2;

export function DailyNetChart({ daily, currency, todayIso, onSelectDay }: DailyNetChartProps) {
  const maxMagnitude = Math.max(1, ...daily.map((point) => Math.abs(point.net)));
  // Width is in abstract units; the SVG scales to its container via viewBox.
  const barWidth = 10;
  const width = daily.length * (barWidth + BAR_GAP);

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="chart__svg"
        role="img"
        aria-label="Daily net income for the month"
      >
        <line x1={0} x2={width} y1={HALF} y2={HALF} className="chart__baseline" />
        {daily.map((point, index) => {
          const height = (Math.abs(point.net) / maxMagnitude) * (HALF - 4);
          const x = index * (barWidth + BAR_GAP);
          const y = point.net >= 0 ? HALF - height : HALF;
          const hasActivity = point.income > 0 || point.expense > 0;
          return (
            <g key={point.date} className="chart__day" onClick={() => onSelectDay(point.date)}>
              {/* Full-height transparent hit area so tiny bars are still clickable. */}
              <rect x={x} y={0} width={barWidth} height={HEIGHT} className="chart__hit" />
              {hasActivity ? (
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(height, 1.5)}
                  rx={1.5}
                  className={point.net >= 0 ? "chart__bar is-positive" : "chart__bar is-negative"}
                />
              ) : null}
              {point.date === todayIso ? <rect x={x} y={HEIGHT - 3} width={barWidth} height={3} className="chart__today" /> : null}
              <title>
                {`${formatShortDay(parseIsoDate(point.date))}\nIncome ${formatMoney(point.income, currency)}\nExpense ${formatMoney(point.expense, currency)}\nNet ${formatMoney(point.net, currency, { signed: true })}`}
              </title>
            </g>
          );
        })}
      </svg>
      <figcaption className="chart__axis">
        <span>{daily.length > 0 ? formatShortDay(parseIsoDate(daily[0].date)) : ""}</span>
        <span>Click a bar to open the day in the calendar</span>
        <span>{daily.length > 0 ? formatShortDay(parseIsoDate(daily[daily.length - 1].date)) : ""}</span>
      </figcaption>
    </figure>
  );
}
