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
import { gridGeometry, describePt, pageBoundaries, type GridStepPt } from '@/lib/canvas/measure-grid';

interface Props {
  canvas: CanvasRules;
  step: GridStepPt;
  /**
   * How many pages (or slides) the ruler says this document is. Drives the boundary lines — the
   * landmark that tells an author WHICH content crossed a page limit, rather than only that it did.
   */
  pageCount?: number;
  /** 'slide' for a deck, so the boundary reads "Slide 2" and not "Page 2". */
  unit?: 'page' | 'slide';
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

const BOUNDARY = 'rgba(15, 118, 110, 0.75)';

export function MeasureGridOverlay({ canvas, step, scale, labels = true, pageCount = 1, unit = 'page' }: Props) {
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

      {/* PAGE / SLIDE BOUNDARIES — where the break actually falls.
          Drawn last of the lines so they read above the grid, and solid-teal so they are plainly a
          different KIND of thing from a grid gradation: a grid line is a measurement, this is an
          edge the export will enforce. */}
      {pageBoundaries(canvas, pageCount).map((pt, i) => (
        <React.Fragment key={`b${pt}`}>
          <div
            style={{
              position: 'absolute', left: 0, right: 0, top: px(pt), height: 0,
              borderTop: `1px dashed ${BOUNDARY}`,
            }}
          />
          <span
            style={{
              position: 'absolute', right: 2, top: px(pt) + 2,
              fontSize: 8, lineHeight: '8px', color: BOUNDARY,
              fontFamily: 'ui-monospace, monospace', fontWeight: 600,
            }}
          >
            {unit === 'slide' ? 'slide' : 'page'} {i + 2}
          </span>
        </React.Fragment>
      ))}

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
 * The rulers — gradations along the top and left edges, in the grid's own step.
 *
 * IN THE GUTTER, NOT ON THE PAGE. A ruler printed over the document measures the thing it obscures,
 * which is the failure mode of a busy overlay. These sit outside the page edge, so the grid stays
 * the thing you read *through* and the ruler is the thing you read *against*.
 *
 * Same geometry as the grid — `gridGeometry` is called once for both — so a gradation and its grid
 * line are the same number by construction. Two independent sources for "where is 2 inches" is how
 * a ruler ends up disagreeing with its own page.
 */
export function MeasureRulers({ canvas, step, scale, thickness = 14 }: Props & { thickness?: number }) {
  const g = React.useMemo(() => gridGeometry(canvas, step), [canvas, step]);
  const px = (pt: number) => pt * scale;
  const tick = (l: { pt: number; major: boolean; medium: boolean }) =>
    l.major ? thickness : l.medium ? thickness * 0.6 : thickness * 0.3;

  return (
    <div style={{ pointerEvents: 'none' }} aria-hidden="true">
      {/* top ruler */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: -thickness, height: thickness,
        borderBottom: `1px solid ${MAJOR}`,
      }}>
        {g.vertical.map((l) => (
          <div key={`rt${l.pt}`} style={{
            position: 'absolute', bottom: 0, left: px(l.pt), width: 1, height: tick(l),
            background: l.major ? MAJOR : l.medium ? MEDIUM : MINOR,
          }} />
        ))}
        {g.vertical.filter((l) => l.major && l.pt > 0).map((l) => (
          <span key={`rtl${l.pt}`} style={{
            position: 'absolute', bottom: thickness * 0.55, left: px(l.pt) + 2,
            fontSize: 8, lineHeight: '8px', color: MAJOR, fontFamily: 'ui-monospace, monospace',
          }}>{l.pt / 72}</span>
        ))}
      </div>

      {/* left ruler */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: -thickness, width: thickness,
        borderRight: `1px solid ${MAJOR}`,
      }}>
        {g.horizontal.map((l) => (
          <div key={`rl${l.pt}`} style={{
            position: 'absolute', right: 0, top: px(l.pt), height: 1, width: tick(l),
            background: l.major ? MAJOR : l.medium ? MEDIUM : MINOR,
          }} />
        ))}
        {g.horizontal.filter((l) => l.major && l.pt > 0).map((l) => (
          <span key={`rll${l.pt}`} style={{
            position: 'absolute', right: thickness * 0.55, top: px(l.pt) + 2,
            fontSize: 8, lineHeight: '8px', color: MAJOR, fontFamily: 'ui-monospace, monospace',
          }}>{l.pt / 72}</span>
        ))}
      </div>
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
