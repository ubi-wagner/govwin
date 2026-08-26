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
  /**
   * The landmark role the panel takes while it is INLINE (i.e. `inlineAt` is set and it is not
   * open as an overlay). The nav rail passes `navigation`; leave unset for a generic panel, which
   * then falls back to `<aside>`'s implicit complementary landmark.
   */
  inlineRole?: string;
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
  inlineRole,
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
      {/*
        THE ROLE FOLLOWS THE BEHAVIOUR, and it used to be hardcoded.

        `role="dialog"` was unconditional, so the **primary navigation rail was announced as a
        dialog on every admin and portal page** — it is a `Drawer` with `inlineAt="lg"`, which at
        and above the breakpoint is not an overlay at all but a static 256px column. Two costs, both
        real: a screen-reader user meets a dialog where the site's main navigation should be, and
        the nav is missing from landmark navigation, which is the standard way they would jump to it.

        In `inlineAt` mode the drawer is only a dialog while it is genuinely open as an overlay
        (below the breakpoint, hamburger pressed). At rest it takes `inlineRole` — `navigation` for
        the nav rail — so it is a labelled landmark instead. A drawer with no `inlineAt` is always a
        real overlay and keeps the dialog role.

        Found by a harness, not by reading: an overlay probe kept reporting one persistent
        `role="dialog"` on every page at rest, which is exactly what this bug looks like from outside.
      */}
      <aside
        role={!inlineAt || open ? 'dialog' : inlineRole}
        // `open` is only ever true BELOW the inline breakpoint — the hamburger that sets it is
        // `lg:hidden` — so an open drawer is a real overlay in both modes and keeps aria-modal.
        // (An earlier version of this fix dropped it for `inlineAt` drawers, which would have
        // demoted the mobile nav from a modal to a plain region while it covers the page.)
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
