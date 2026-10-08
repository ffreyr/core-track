/**
 * Small visual primitives for glanceable UI (sidebar Today card, widget).
 */

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// ProgressRing
// ---------------------------------------------------------------------------

interface ProgressRingProps {
  done: number;
  total: number;
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  stroke?: number;
}

/**
 * Circular progress (Apple Fitness style). Shows "done/total" in the middle,
 * or a check mark once everything is done. With no items it shows an empty
 * track and an em dash.
 */
export function ProgressRing({ done, total, size = 44, stroke = 4 }: ProgressRingProps) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total === 0 ? 0 : Math.min(1, done / total);
  const complete = total > 0 && done >= total;

  return (
    <div
      className={complete ? "progress-ring is-complete" : "progress-ring"}
      style={{ width: size, height: size }}
      role="img"
      aria-label={total === 0 ? "No tasks" : `${done} of ${total} done`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
        <circle
          className="progress-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="progress-ring__label">
        {complete ? (
          <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : total === 0 ? (
          "—"
        ) : (
          `${done}/${total}`
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoundCheck
// ---------------------------------------------------------------------------

interface RoundCheckProps {
  checked: boolean;
  onToggle: () => void;
  /** Ring/fill color (task color or scope color). */
  color: string;
  label: string;
}

/**
 * Circular checkbox in the style of Apple Reminders: a colored ring that
 * fills with the same color and shows a white check when completed.
 * Implemented as a `role="checkbox"` button so it is keyboard accessible.
 */
export function RoundCheck({ checked, onToggle, color, label }: RoundCheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={checked ? "round-check is-checked" : "round-check"}
      style={{ "--check-color": color } as CSSProperties}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 12.5l4 4L18 8.5" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
