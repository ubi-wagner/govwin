/**
 * The measurement grid — spatial landmarks in the document's OWN units.
 *
 * WHY THIS EXISTS. Every layout defect this codebase has found was invisible until something
 * measured it from outside: the page ruler under-counting tables and lists (B64/B65), a `toc`
 * modelled as zero height (B66), a stored canvas with no `font_default` white-screening the
 * workspace (B78), a spacer whose height five readers disagreed about (B109). In each case the
 * editor was drawing one thing, a writer another, and nothing on screen said so.
 *
 * A grid drawn in POINTS, from the same `CanvasRules` the exporters read, turns those into
 * something an author can see: a 24pt spacer is visibly two 12pt cells, a block that overhangs the
 * margin box overhangs it on screen, and a page that is about to break breaks where the line is.
 *
 * WHY 6pt IS THE FLOOR, and not 5. There are 72 points to an inch, so a step must divide 72 for its
 * lines to land on the inch marks that make the grid readable as a ruler. 72/5 = 14.4: a 5pt grid
 * drifts against every inch and half-inch, which is worse than no grid because it looks precise
 * while being unaligned. 6 is the smallest divisor of 72 at or above a 5pt floor, and it halves
 * cleanly all the way up: 6 · 12 · 18 · 36 · 72.
 *
 * Pure and IO-free on purpose — the overlay component renders what this returns, so the geometry
 * can be tested without a browser, and one function is the single answer for where a line goes.
 */
import type { CanvasRules } from '@/lib/types/canvas-document';

/** Points per inch. The reason the ladder below is what it is. */
export const PT_PER_INCH = 72;

/**
 * The step ladder, coarse → fine. Every entry divides 72, so every line lands on an inch boundary
 * at some multiple, and each step is half the one before it.
 */
export const GRID_STEPS_PT = [72, 36, 18, 12, 6] as const;
export type GridStepPt = (typeof GRID_STEPS_PT)[number];

/** The smallest step offered. Named rather than indexed so the floor is greppable. */
export const MIN_GRID_STEP_PT: GridStepPt = 6;

export function isGridStep(v: unknown): v is GridStepPt {
  return typeof v === 'number' && (GRID_STEPS_PT as readonly number[]).includes(v);
}

/** How a step reads to a person — the grid is a ruler, so it should say ruler things. */
export function gridStepLabel(step: GridStepPt): string {
  if (step === 72) return '1 in';
  if (step === 36) return '½ in';
  if (step === 18) return '¼ in';
  if (step === 12) return '1 pica';
  return '½ pica';
}

export interface GridLine {
  /** Offset from the page's top-left, in points. */
  pt: number;
  /** An inch boundary — drawn heaviest, and the only lines that carry a label. */
  major: boolean;
  /** A half-inch boundary that is not a full inch — drawn mid-weight. */
  medium: boolean;
}

export interface GridGeometry {
  vertical: GridLine[];
  horizontal: GridLine[];
  /** The usable box inside the margins — the landmark that matters most. */
  margin: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  step: GridStepPt;
  /** Page size in points, echoed so a consumer needs only this object. */
  page: { width: number; height: number };
}

/**
 * Every grid line for a page, in points from the top-left.
 *
 * Lines are emitted at 0 and at each step up to and including the page edge, so a letter page at a
 * 72pt step has a line at 0, 72 … 612 across (9 lines) and 0 … 792 down (12 lines). Emitting the
 * closing edge matters: a grid that stops one step short makes the last cell look wider than it is.
 */
export function gridGeometry(canvas: CanvasRules, step: GridStepPt): GridGeometry {
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const m = canvas.margins;

  const linesAlong = (extent: number): GridLine[] => {
    const out: GridLine[] = [];
    // Guard the loop on the STEP rather than trusting the caller: a step of 0 or a negative would
    // spin forever, and this runs on every render of a document the user is typing into.
    const s = isGridStep(step) ? step : MIN_GRID_STEP_PT;
    const push = (value: number) => {
      const rounded = Math.round(value * 100) / 100;   // float drift over ~130 iterations
      out.push({
        pt: rounded,
        major: rounded % PT_PER_INCH === 0,
        medium: rounded % (PT_PER_INCH / 2) === 0 && rounded % PT_PER_INCH !== 0,
      });
    };
    for (let pt = 0; pt <= extent + 0.001; pt += s) push(pt);
    // ALWAYS CLOSE THE EDGE. A letter page is 612pt wide and 612/72 = 8.5, so a 1-inch grid's last
    // multiple is 576 and the loop above stops there — leaving the rightmost cell 36pt wider than
    // every other one, with no line to show it. A ruler whose final gradation is a different size
    // from the rest misreports the one measurement people take most often: how much room is left.
    const last = out[out.length - 1];
    if (!last || Math.abs(last.pt - extent) > 0.001) push(extent);
    return out;
  };

  return {
    vertical: linesAlong(width),
    horizontal: linesAlong(height),
    margin: {
      left: m.left,
      top: m.top,
      right: width - m.right,
      bottom: height - m.bottom,
      width: Math.max(0, width - m.left - m.right),
      height: Math.max(0, height - m.top - m.bottom),
    },
    step: isGridStep(step) ? step : MIN_GRID_STEP_PT,
    page: { width, height },
  };
}

/**
 * The default step for a page, chosen so the grid is legible rather than a grey wash.
 *
 * A letter page at 6pt is 102 × 132 lines — dense enough to obscure the text it is meant to measure
 * against. The default is the finest step that keeps the total under a legibility budget, which
 * means a slide (720 × 405) starts finer than a letter page, and a poster starts coarser. An author
 * who wants the fine grid can still pick it; this only decides where the toggle starts.
 */
export function defaultGridStep(canvas: CanvasRules, maxLines = 60): GridStepPt {
  for (let i = GRID_STEPS_PT.length - 1; i >= 0; i--) {
    const step = GRID_STEPS_PT[i];
    const lines = Math.ceil(canvas.width / step) + Math.ceil(canvas.height / step);
    if (lines <= maxLines) return step;
  }
  return GRID_STEPS_PT[0];
}

/**
 * Where each page (or slide) boundary falls in the rendered flow, in points from the page top.
 *
 * THE MISSING LANDMARK. The editor computes "~11 of 10 pages — over" and shows it as text, while
 * nothing on the page says WHICH content crossed. An author over a limit is told they are over and
 * left to guess. These are the lines that answer it.
 *
 * PURE GEOMETRY, deliberately — no DOM, no measurement. The canvas renders as one continuous
 * page-shaped element that grows past `canvas.height`, with the margins as padding, so content that
 * would print on page k begins at `marginTop + (k-1) × usableHeight`. That is the SAME arithmetic
 * `flowMetrics`/`paginate` use to decide the page count, which is what makes the line trustworthy:
 * a boundary drawn from a second model would be a second opinion about where page 2 starts.
 *
 * Costs nothing to keep current. `estimatePageCount` is already called on every render, so a
 * boundary needs no measurement pass and no debounce — it is arithmetic over numbers already known.
 */
export function pageBoundaries(canvas: CanvasRules, pageCount: number): number[] {
  const usable = canvas.height - canvas.margins.top - canvas.margins.bottom;
  if (!(usable > 0) || !Number.isFinite(pageCount)) return [];
  const out: number[] = [];
  // Interior boundaries only: page 1 starts at the top of the page and the last page ends at the
  // end of the content, and drawing a "boundary" at either would be a line where nothing breaks.
  for (let k = 1; k < Math.max(1, Math.ceil(pageCount)); k++) {
    out.push(canvas.margins.top + k * usable);
  }
  return out;
}

/**
 * Describe a measured distance the way a person would say it — for a readout beside the grid.
 * 78pt is "78pt · 1⅟12 in" to nobody; it is "78pt (1.08 in)".
 */
export function describePt(pt: number): string {
  const inches = pt / PT_PER_INCH;
  return `${Math.round(pt * 10) / 10}pt (${inches.toFixed(2)} in)`;
}
