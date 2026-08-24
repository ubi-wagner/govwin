'use client';

/**
 * The measurement grid overlay — a transparent ruler laid over the page, in the page's own units.
 *
 * DRAWN IN THE PAGE'S COORDINATE SPACE, deliberately. Every offset below is `pt * scale`, the same
 * expression the page container uses for its own width, height and padding. That is not a detail:
 * a grid computed independently would be a second opinion about where the margin is, and a ruler
 * that disagrees with the thing it measures is worse than none. Sharing the expression means the
 * grid is wrong only if the page is wrong — in which case it shows you that too.
 *
 * `pointer-events: none` throughout: it is a thing to look at, never a thing to click. Selecting a
 * node must work identically with the grid on.
 */
import React from 'react';
import type { CanvasRules } from '@/lib/types/canvas-document';
import { gridGeometry, describePt, type GridStepPt } from '@/lib/canvas/measure-grid';

interface Props {
  canvas: CanvasRules;
  step: GridStepPt;
  /** The same scale the page container applies, so the two cannot drift apart. */
  scale: number;
  /** Show the inch labels down the left and across the top. */
  labels?: boolean;
}

// Weights chosen so the hierarchy reads at a glance without competing with the text underneath:
// an inch line is visible, a minor line is a hint. All are blue-grey rather than black so they
// never look like a rule the author inserted.
const MAJOR = 'rgba(37, 99, 235, 0.34)';
const MEDIUM = 'rgba(37, 99, 235, 0.20)';
const MINOR = 'rgba(37, 99, 235, 0.10)';
const MARGIN_LINE = 'rgba(220, 38, 38, 0.45)';

export function MeasureGridOverlay({ canvas, step, scale, labels = true }: Props) {
  const g = React.useMemo(() => gridGeometry(canvas, step), [canvas, step]);
  const px = (pt: number) => pt * scale;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
      data-testid="measure-grid"
    >
      {/* vertical lines */}
      {g.vertical.map((l) => (
        <div
          key={`v${l.pt}`}
          style={{
            position: 'absolute', top: 0, bottom: 0, left: px(l.pt), width: 1,
            background: l.major ? MAJOR : l.medium ? MEDIUM : MINOR,
          }}
        />
      ))}
      {/* horizontal lines */}
      {g.horizontal.map((l) => (
        <div
          key={`h${l.pt}`}
          style={{
            position: 'absolute', left: 0, right: 0, top: px(l.pt), height: 1,
            background: l.major ? MAJOR : l.medium ? MEDIUM : MINOR,
          }}
        />
      ))}

      {/* THE MARGIN BOX — the landmark that matters most, and the one the grid alone cannot show.
          Content outside it will be outside it in the export too; a block overhanging this line is
          the visible form of the overflow the compliance floor reports as a number. */}
      <div
        style={{
          position: 'absolute',
          left: px(g.margin.left), top: px(g.margin.top),
          width: px(g.margin.width), height: px(g.margin.height),
          border: `1px dashed ${MARGIN_LINE}`,
        }}
      />

      {labels && (
        <>
          {/* inch labels across the top and down the left, on the inch lines only — labelling every
              minor line would bury the page in numbers, which is the failure mode of a busy grid. */}
          {g.vertical.filter((l) => l.major && l.pt > 0).map((l) => (
            <span
              key={`vl${l.pt}`}
              style={{
                position: 'absolute', left: px(l.pt) + 2, top: 2,
                fontSize: 8, lineHeight: '8px', color: MAJOR, fontFamily: 'ui-monospace, monospace',
              }}
            >
              {l.pt / 72}&quot;
            </span>
          ))}
          {g.horizontal.filter((l) => l.major && l.pt > 0).map((l) => (
            <span
              key={`hl${l.pt}`}
              style={{
                position: 'absolute', left: 2, top: px(l.pt) + 2,
                fontSize: 8, lineHeight: '8px', color: MAJOR, fontFamily: 'ui-monospace, monospace',
              }}
            >
              {l.pt / 72}&quot;
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The readout that goes with the grid — what the page IS, stated in the units the grid draws.
 *
 * Separate from the overlay because it belongs in the toolbar, not on the page: numbers printed
 * over the document would be measuring the thing they obscure.
 */
export function MeasureGridReadout({ canvas, step }: { canvas: CanvasRules; step: GridStepPt }) {
  const g = gridGeometry(canvas, step);
  return (
    <span className="font-mono text-[11px] text-gray-500">
      {describePt(g.page.width)} × {describePt(g.page.height)}
      {' · usable '}
      {describePt(g.margin.width)} × {describePt(g.margin.height)}
      {' · grid '}{step}pt
    </span>
  );
}
