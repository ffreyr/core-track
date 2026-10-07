/**
 * Accessible modal dialog.
 *
 * - Closes on Escape and on a click on the dimmed backdrop (but not when a
 *   drag that started inside the dialog ends on the backdrop, e.g. while
 *   selecting text in an input).
 * - Restores focus to the previously focused element when it closes.
 */

import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "./Icon";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer, typically action buttons. */
  footer?: ReactNode;
  /** Width preset. */
  size?: "sm" | "md";
}

export function Modal({ title, onClose, children, footer, size = "md" }: ModalProps) {
  const pointerDownOnBackdrop = useRef(false);

  // Keep the latest onClose in a ref so the mount effect below runs exactly
  // once; re-running it would restore focus on every parent re-render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        pointerDownOnBackdrop.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (pointerDownOnBackdrop.current && event.target === event.currentTarget) {
          onClose();
        }
        pointerDownOnBackdrop.current = false;
      }}
    >
      <div className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
