/**
 * Small reusable form controls.
 */

import { useEffect, useState, type ReactNode } from "react";

import type { TaskScope } from "../api";
import { SCOPE_META } from "../lib/labels";
import { Icon } from "./Icon";

// ---------------------------------------------------------------------------
// SegmentedControl
// ---------------------------------------------------------------------------

interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface SegmentedControlProps<T extends string | number> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "md";
}

/** A row of mutually exclusive toggle buttons (macOS-style segmented control). */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = "md",
}: SegmentedControlProps<T>) {
  return (
    <div className={`segmented segmented--${size}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "segmented__item is-active" : "segmented__item"}
          onClick={() => onChange(option.value)}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmDeleteButton
// ---------------------------------------------------------------------------

interface ConfirmDeleteButtonProps {
  onConfirm: () => void;
  disabled?: boolean;
  label?: string;
}

/**
 * Two-step delete: the first click arms the button ("Click again to delete"),
 * the second click confirms. It disarms itself after 3 seconds.
 *
 * Used instead of `window.confirm`, whose availability inside the Tauri
 * webview varies by platform.
 */
export function ConfirmDeleteButton({ onConfirm, disabled, label = "Delete" }: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) {
      return undefined;
    }
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? "button button--danger is-armed" : "button button--ghost-danger"}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      <Icon name="trash" size={14} />
      {armed ? "Click again to delete" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ScopeBadge
// ---------------------------------------------------------------------------

/** Tiny colored badge showing a task's scope letter (D / W / M / Y). */
export function ScopeBadge({ scope, full = false }: { scope: TaskScope; full?: boolean }) {
  const meta = SCOPE_META[scope];
  return (
    <span className="scope-badge" style={{ backgroundColor: meta.color }} title={`${meta.label} task`}>
      {full ? meta.label : meta.short}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

/** Label + control + optional hint/error, laid out consistently in forms. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={error ? "field has-error" : "field"}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="field__error">{error}</p> : hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status blocks
// ---------------------------------------------------------------------------

/** Inline error box with a retry button, used when a query fails. */
export function ErrorNotice({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <span>{error.message}</span>
      <button type="button" className="button button--small" onClick={onRetry}>
        <Icon name="refresh" size={14} />
        Retry
      </button>
    </div>
  );
}
