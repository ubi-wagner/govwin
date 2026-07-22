'use client';

/**
 * Drawer — the one responsive slide-out panel primitive.
 *
 * Two modes:
 *  - Pure overlay (no `inlineAt`): a backdrop + a panel that slides in from
 *    `side` at every viewport width. Use for transient tool/upload panels and
 *    the landing "cockpit" content drawers.
 *  - Responsive (`inlineAt="lg"`): an inline static column at/above the
 *    breakpoint, and an overlay drawer below it. Use for the nav rail and the
 *    canvas sidebar — inline on wide screens, a drawer in a split-screen half.
 *
 * Chrome split-screen makes each pane its own viewport, so the breakpoint
 * tracks the pane and the panel collapses to a drawer exactly when it should.
 */

import { useEffect } from 'react';

type Breakpoint = 'md' | 'lg' | 'xl';

// Tailwind can't see interpolated class names, so map breakpoints to literals.
const INLINE: Record<Breakpoint, string> = {
  md: 'md:static md:z-auto md:translate-x-0 md:shadow-none md:max-w-none',
  lg: 'lg:static lg:z-auto lg:translate-x-0 lg:shadow-none lg:max-w-none',
  xl: 'xl:static xl:z-auto xl:translate-x-0 xl:shadow-none xl:max-w-none',
};
const BACKDROP_HIDE: Record<Breakpoint, string> = {
  md: 'md:hidden',
  lg: 'lg:hidden',
  xl: 'xl:hidden',
};

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: 'left' | 'right';
  /** Tailwind width class for the panel, e.g. 'w-64', 'w-80', 'w-96'. */
  width?: string;
  /** If set, render inline (static) at/above this breakpoint; overlay below. */
  inlineAt?: Breakpoint;
  /** Extra classes for the panel (bg/text/padding, e.g. 'bg-navy-900 text-white p-6'). */
  className?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  side = 'right',
  width = 'w-80',
  inlineAt,
  className = 'bg-white',
  ariaLabel = 'Panel',
  children,
}: DrawerProps) {
  // Esc closes the overlay (below the inline breakpoint it's a modal-like drawer).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Pure overlay unmounts when closed; responsive stays mounted (inline at bp).
  const mounted = open || Boolean(inlineAt);
  if (!mounted) return null;

  const closedTranslate = side === 'right' ? 'translate-x-full' : '-translate-x-full';
  const sideAnchor = side === 'right' ? 'right-0' : 'left-0';

  return (
    <>
      {open && (
        <div
          className={`fixed inset-0 bg-black/40 z-40 ${inlineAt ? BACKDROP_HIDE[inlineAt] : ''}`}
          onClick={onClose}
          aria-hidden
        />
      )}
      <aside
        role="dialog"
        aria-modal={open ? true : undefined}
        aria-label={ariaLabel}
        className={[
          'fixed inset-y-0 z-50 max-w-[85vw] overflow-y-auto shadow-2xl',
          'transition-transform duration-200 ease-out',
          sideAnchor,
          width,
          open ? 'translate-x-0' : closedTranslate,
          inlineAt ? INLINE[inlineAt] : '',
          className,
        ].join(' ')}
      >
        {children}
      </aside>
    </>
  );
}
