'use client';

/**
 * Canvas OverlayLayer (unified-canvas Phase 1) — the togglable "structure-as-overlay" chips.
 *
 * The overlays are painted by CSS keyed off the container class (`cv-ov ov-<key>`) plus the
 * data-attributes every node wrapper already carries (`data-node-id`, `data-node-source`) —
 * see the `.cv-ov` block in app/globals.css. Off by default: a clean document until a chip is
 * summoned. Surface-agnostic: the same bar + class helper mount over the fluid document, the
 * per-section editor, the slide deck, and the sheet (each surface's CSS projects the layers).
 *
 * This is the "toggle section breaks / atom-primitive outlines on-off" surface, made real.
 */
import { useCallback, useState } from 'react';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export type OverlayKey = 'sections' | 'atoms' | 'groups' | 'provenance';

export const OVERLAYS: { key: OverlayKey; label: string; dot: string; hint: string }[] = [
  { key: 'sections',   label: 'Sections',   dot: '#6d5ef0', hint: 'Dotted boundary + label at each section start' },
  { key: 'atoms',      label: 'Atoms',      dot: '#0f9d8f', hint: 'Dotted outline on every content primitive' },
  // The group is the unit an author thinks in: one run from one library atom, moving across a page
  // edge as one when `keep_together` is set. The model has always had it and the UI never showed
  // it, so the layer the assembler populates and a scoped review addresses was invisible.
  { key: 'groups',     label: 'Groups',     dot: '#c2410c', hint: 'Runs from one library atom — solid rail = moves as one block' },
  { key: 'provenance', label: 'Provenance', dot: '#7c5cf0', hint: 'Source gutter — AI · Library · Reuse' },
];

/**
 * Does this document carry the group layer?
 *
 * Hosts filter the chip bar with this rather than always offering `Groups`. A toggle that provably
 * paints nothing is worse than an absent one: it invites the reader to conclude the document has no
 * groups when what it really means is that this SHAPE of document cannot express them. Flat
 * canvases — which is every canvas stored today — are exactly that case.
 */
export const documentHasGroups = (doc: Pick<CanvasDocument, 'sections'> | null | undefined): boolean =>
  !!doc?.sections?.some((s) => (s.groups ?? []).length > 0);

/** The chips worth offering for this document: everything, minus what it cannot show. */
export const overlaysFor = (doc: Pick<CanvasDocument, 'sections'> | null | undefined) =>
  OVERLAYS.filter((o) => o.key !== 'groups' || documentHasGroups(doc));

/** Overlay on/off state (a Set of active keys) + a toggle. */
export function useOverlays(initial: OverlayKey[] = []) {
  const [active, setActive] = useState<Set<OverlayKey>>(() => new Set(initial));
  const toggle = useCallback((k: OverlayKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);
  return { active, toggle };
}

/** The className to put on the render container so the CSS paints the active layers. */
export function overlayClass(active: Set<OverlayKey>): string {
  return ['cv-ov', ...[...active].map((k) => `ov-${k}`)].join(' ');
}

/** The chip toggle bar — controlled; renders only the passed `items` (default: all). */
export function CanvasOverlayBar({
  active,
  onToggle,
  items = OVERLAYS,
  className = '',
}: {
  active: Set<OverlayKey>;
  onToggle: (k: OverlayKey) => void;
  items?: typeof OVERLAYS;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Overlays</span>
      {items.map((o) => {
        const on = active.has(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onToggle(o.key)}
            aria-pressed={on}
            title={o.hint}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              on ? 'border-transparent text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
            style={on ? { backgroundColor: o.dot } : undefined}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: on ? '#fff' : o.dot, opacity: on ? 1 : 0.5 }}
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
