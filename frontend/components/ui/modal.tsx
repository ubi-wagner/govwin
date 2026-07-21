'use client';

/**
 * Modal — the one centered-dialog primitive. Replaces the ~12 hand-rolled
 * `fixed inset-0 … flex items-center justify-center` cards. Backdrop-click and
 * Esc close; the card is width-clamped, height-capped, and scrolls its own
 * overflow so it never breaks in a narrow / split-screen pane.
 *
 * Use for small/medium transient forms and confirms. Heavy work surfaces
 * (uploads, builders) should use <Drawer side="right"> instead.
 */

import { useEffect } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Tailwind max-width class, e.g. 'max-w-md', 'max-w-lg', 'max-w-2xl'. */
  maxWidth?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, maxWidth = 'max-w-lg', ariaLabel = 'Dialog', children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={ariaLabel}
        className={`bg-white rounded-lg shadow-xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
