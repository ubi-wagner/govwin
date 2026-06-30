'use client';

import { useRef, useState, type ReactNode } from 'react';

/**
 * A single row inside a stat card's hover preview.
 *   left  — primary text (e.g. an event type, a tenant name, a page path)
 *   sub   — muted secondary text under `left` (e.g. an actor, a slug)
 *   right — right-aligned value (e.g. a count, a relative time)
 */
export type StatPreviewItem = {
  left: string;
  sub?: string;
  right?: string;
};

export type StatPreview = {
  /** Heading shown at the top of the popover. Defaults to the card label. */
  title?: string;
  items: StatPreviewItem[];
  /** Shown when `items` is empty. */
  emptyText?: string;
  /** "View all" footer link target (opens in a new tab, same as the card). */
  href?: string;
  hrefLabel?: string;
};

export type StatCardProps = {
  label: string;
  value: ReactNode;
  /** Optional muted caption under the value (e.g. what the number counts). */
  hint?: string;
  /**
   * Drill-through target — the admin screen where this metric is managed.
   * When set, the whole card is a link that opens in a NEW TAB.
   */
  href?: string;
  /**
   * Optional accent classes for the left border + tint
   * (e.g. "border-amber-400 bg-amber-50"). When omitted the card uses the
   * plain white/bordered style.
   */
  color?: string;
  /** Optional recent-activity popover shown on hover/focus. */
  preview?: StatPreview;
  className?: string;
};

/**
 * Shared admin metric tile. Two optional affordances, independently usable:
 *  1. `href`    → the card becomes a click-through that opens the relevant
 *                 admin page in a new tab (with a subtle ↗ affordance).
 *  2. `preview` → hovering (or focusing) the card reveals a small popover with
 *                 the most-recent N items behind the number, plus a "View all".
 */
export function StatCard({ label, value, hint, href, color, preview, className = '' }: StatCardProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPreview = !!preview;

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (hasPreview) setOpen(true);
  };
  // Small grace period so the cursor can travel from the card into the popover.
  const scheduleHide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  const accent = color ? `border-l-4 ${color}` : 'bg-white border border-gray-200';

  const tileInner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
        {href && (
          <span
            aria-hidden
            className="text-gray-300 group-hover:text-gray-500 transition-colors text-xs leading-none"
            title="Opens in a new tab"
          >
            ↗
          </span>
        )}
      </div>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </>
  );

  const tileClass = `group block rounded-lg p-4 transition-shadow ${accent} ${href ? 'hover:shadow-md cursor-pointer' : ''}`;

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={tileClass}>
          {tileInner}
        </a>
      ) : (
        <div className={tileClass}>{tileInner}</div>
      )}

      {hasPreview && open && (
        <div
          className="absolute left-0 top-full z-20 pt-2 w-72 max-w-[min(18rem,90vw)]"
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
          role="dialog"
          aria-label={`${preview?.title ?? label} recent activity`}
        >
          <div className="rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-semibold text-gray-700">{preview?.title ?? label}</p>
            </div>
            {(!preview || preview.items.length === 0) ? (
              <p className="px-3 py-3 text-xs text-gray-400">{preview?.emptyText ?? 'No recent activity'}</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {preview.items.map((it, i) => (
                  <li key={i} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-700 truncate" title={it.left}>{it.left}</p>
                      {it.sub && <p className="text-[11px] text-gray-400 truncate" title={it.sub}>{it.sub}</p>}
                    </div>
                    {it.right && (
                      <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap flex-shrink-0">
                        {it.right}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {preview?.href && (
              <a
                href={preview.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 border-t border-gray-100"
              >
                {preview.hrefLabel ?? 'View all'} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
