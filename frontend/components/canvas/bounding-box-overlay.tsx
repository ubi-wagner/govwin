'use client';

/**
 * Bounding boxes for groups and sections — the measured extent of a run of content.
 *
 * The grid tells you WHERE something sits. This tells you HOW BIG it is, and — the part that
 * matters — it reports two numbers rather than one:
 *
 *   drawn   what the browser actually laid out, measured off the DOM
 *   ruler   what `nodesHeightPt` models, the same engine the export gate judges the page by
 *
 * A single number would be a claim. Two numbers are a CHECK. Every layout defect in this codebase's
 * log is the same shape — the editor drawing one thing and a writer modelling another (B64 tables,
 * B65 lists, B66 the toc, B109 the spacer) — and each was invisible until someone measured both
 * sides. This puts that comparison in front of the author, live, on their own document.
 *
 * A divergence is not automatically a bug: the ruler is deliberately conservative (it may over-count
 * and must never under-count, B64). So the overlay states the gap and its direction and lets a
 * person judge, rather than colouring it red and crying wolf on a working page.
 */
import React from 'react';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';
import { nodesHeightPt } from '@/lib/types/canvas-document';
import type { GroupMap } from './canvas-renderer';

/** The ruler's own tolerance: below this a difference is rounding, not disagreement. */
export const AGREEMENT_TOLERANCE_PT = 6;

export interface BoxMeasurement {
  label: string;
  /** Height the browser laid out, in points. */
  drawnPt: number;
  /** Height the ruler models, in points. */
  rulerPt: number;
  /** drawn − ruler. Positive means the page is taller than the model thinks. */
  deltaPt: number;
  /** Within tolerance — the model and the page agree. */
  agrees: boolean;
  /** The model reads SHORTER than the page: the direction that clears an over-length volume. */
  underCounts: boolean;
}

export function measureBox(opts: {
  label: string; drawnPx: number; scale: number; nodes: CanvasNode[]; canvas: CanvasDocument['canvas'];
}): BoxMeasurement {
  // The page container draws at `pt * scale`, so px ÷ scale is points. Guard the divisor: a scale of
  // 0 would make every measurement Infinity and the readout would confidently print nonsense.
  const scale = opts.scale > 0 ? opts.scale : 1;
  const drawnPt = opts.drawnPx / scale;
  const rulerPt = nodesHeightPt(opts.nodes, opts.canvas);
  const deltaPt = drawnPt - rulerPt;
  return {
    label: opts.label,
    drawnPt,
    rulerPt,
    deltaPt,
    agrees: Math.abs(deltaPt) <= AGREEMENT_TOLERANCE_PT,
    underCounts: deltaPt > AGREEMENT_TOLERANCE_PT,
  };
}

/** How the measurement reads to a person, in the units they think in. */
export function describeBox(m: BoxMeasurement): string {
  const inches = (pt: number) => `${(pt / 72).toFixed(2)}in`;
  if (m.agrees) return `${Math.round(m.drawnPt)}pt · ${inches(m.drawnPt)}`;
  const sign = m.deltaPt > 0 ? '+' : '';
  return `${Math.round(m.drawnPt)}pt drawn · ${Math.round(m.rulerPt)}pt ruler · ${sign}${Math.round(m.deltaPt)}pt`;
}

const GROUP_EDGE = 'rgba(194, 65, 12, 0.55)';     // matches the Groups overlay dot
const SECTION_EDGE = 'rgba(109, 94, 240, 0.55)';  // matches the Sections overlay dot
const DISAGREE = 'rgba(217, 119, 6, 0.9)';

/**
 * Draw a box around one measured run.
 *
 * Positioned absolutely against the page, in the same `pt * scale` space as the grid, so a box, a
 * grid line and the page's own margin all agree by construction rather than by coincidence.
 */
export function BoundingBox({
  topPx, heightPx, leftPt, widthPt, scale, kind, measurement,
}: {
  topPx: number; heightPx: number; leftPt: number; widthPt: number; scale: number;
  kind: 'group' | 'section'; measurement: BoxMeasurement;
}) {
  const edge = kind === 'group' ? GROUP_EDGE : SECTION_EDGE;
  return (
    <div style={{ pointerEvents: 'none' }} aria-hidden="true">
      <div
        style={{
          position: 'absolute',
          top: topPx, height: heightPx,
          left: leftPt * scale, width: widthPt * scale,
          border: `1px solid ${edge}`,
          borderRadius: 2,
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: topPx, left: (leftPt + widthPt) * scale + 4,
          fontSize: 9, lineHeight: '10px', whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, monospace',
          color: measurement.agrees ? edge : DISAGREE,
          fontWeight: measurement.agrees ? 400 : 600,
        }}
      >
        {measurement.label} {describeBox(measurement)}
      </span>
    </div>
  );
}

/** Group a flat node list by the group map, preserving document order. */
export function runsFromGroupMap(
  nodes: CanvasNode[],
  groups: GroupMap,
): Array<{ id: string; label?: string; nodes: CanvasNode[] }> {
  const runs: Array<{ id: string; label?: string; nodes: CanvasNode[] }> = [];
  let prevGroupId: string | null = null;

  for (const node of nodes) {
    const g = groups[node.id];
    if (!g) { prevGroupId = null; continue; }   // a gap ends the run, even inside the same group
    // CONSECUTIVE nodes sharing a group id are one run. A repeat of the same id after a gap is a
    // SECOND run, not a continuation — a group is a contiguous block, and merging across a gap
    // would draw one box around content that is not all in it.
    if (g.id === prevGroupId) runs[runs.length - 1].nodes.push(node);
    else runs.push({ id: g.id, label: g.label, nodes: [node] });
    prevGroupId = g.id;
  }
  return runs;
}
