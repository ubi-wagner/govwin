'use client';

/**
 * Modal — the one centered-dialog primitive. Replaces the ~12 hand-rolled
 * `fixed inset-0 … flex items-center justify-center` cards. Backdrop-click and
 * Esc close; the card is width-clamped, height-capped, and scrolls its own
 * overflow so it never breaks in a narrow / split-screen pane.
 *
 * Rendered through a portal to <body> so it centers against the VIEWPORT even
 * when opened from inside a transformed ancestor (e.g. a right <Drawer>, whose
 * `translate-x` would otherwise become the containing block and trap it). Its
 * Esc handler runs in the capture phase and stops immediate propagation, so an
 * underlying Drawer's window Esc listener doesn't ALSO fire and close the drawer
 * behind it.
 *
 * Use for small/medium transient forms and confirms. Heavy work surfaces
 * (uploads, builders) should use <Drawer side="right"> instead.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Tailwind max-width class, e.g. 'max-w-md', 'max-w-lg', 'max-w-2xl'. */
  maxWidth?: string;
  ariaLabel?: string;
  /**
   * When true, Esc and backdrop-click do NOT close the modal. Use when the modal is a
   * nested confirm layered over a bigger surface (e.g. an opt-out prompt in front of an
   * editor) so that dismissing the small prompt doesn't tear down the surface behind it.
   */
  disableEsc?: boolean;
  children: React.ReactNode;
}

export function Modal({ open, onClose, maxWidth = 'max-w-lg', ariaLabel = 'Dialog', disableEsc = false, children }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || disableEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation(); // don't let a wrapping Drawer's Esc also fire
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true); // capture → runs before the Drawer's
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, disableEsc]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
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
    </div>,
    document.body,
  );
}
