/**
 * Bounding-box measurement — the box reports two numbers so it is a check, not a claim.
 */
import { describe, it, expect } from 'vitest';
import { measureBox, describeBox, runsFromGroupMap, AGREEMENT_TOLERANCE_PT } from '@/components/canvas/bounding-box-overlay';
import { CANVAS_PRESETS, type CanvasNode } from '@/lib/types/canvas-document';
import type { GroupMap } from '@/components/canvas/canvas-renderer';

const letter = CANVAS_PRESETS.letter_standard;
const node = (id: string, text = 'x'): CanvasNode => ({
  id, type: 'text_block', content: { text }, style: {},
  provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);

const g = (id: string, label?: string) => ({ id, label, keep: false, pos: 'solo' });

describe('measureBox converts the drawn pixels back into the page’s own units', () => {
  it('divides by the scale the page was drawn at', () => {
    const m = measureBox({ label: 'g', drawnPx: 144, scale: 2, nodes: [], canvas: letter });
    expect(m.drawnPt).toBe(72);
  });

  it('never divides by zero — a 0 scale would print Infinity with total confidence', () => {
    const m = measureBox({ label: 'g', drawnPx: 100, scale: 0, nodes: [], canvas: letter });
    expect(Number.isFinite(m.drawnPt)).toBe(true);
    expect(m.drawnPt).toBe(100);
  });

  it('reports agreement when the page and the ruler are within tolerance', () => {
    const nodes = [node('a')];
    const ruler = measureBox({ label: 'g', drawnPx: 0, scale: 1, nodes, canvas: letter }).rulerPt;
    const m = measureBox({ label: 'g', drawnPx: ruler, scale: 1, nodes, canvas: letter });
    expect(m.agrees).toBe(true);
    expect(m.underCounts).toBe(false);
  });

  it('flags the UNDER-COUNT direction specifically — the one that clears an over-length volume', () => {
    const nodes = [node('a')];
    const ruler = measureBox({ label: 'g', drawnPx: 0, scale: 1, nodes, canvas: letter }).rulerPt;
    // The page drew far more than the model predicted: the model reads short.
    const m = measureBox({ label: 'g', drawnPx: ruler + 100, scale: 1, nodes, canvas: letter });
    expect(m.agrees).toBe(false);
    expect(m.underCounts).toBe(true);
    expect(m.deltaPt).toBeGreaterThan(AGREEMENT_TOLERANCE_PT);
  });

  it('an over-count is a disagreement but NOT an under-count — direction matters', () => {
    const nodes = [node('a')];
    const ruler = measureBox({ label: 'g', drawnPx: 0, scale: 1, nodes, canvas: letter }).rulerPt;
    const m = measureBox({ label: 'g', drawnPx: Math.max(0, ruler - 100), scale: 1, nodes, canvas: letter });
    expect(m.underCounts).toBe(false);
  });
});

describe('describeBox says one number when they agree and both when they do not', () => {
  it('shows a single measurement on agreement', () => {
    // Drawn must MATCH the ruler for this to be the agreement case — an empty node list models 0pt,
    // so pairing it with 72px drawn is a 72pt disagreement, which is what this asserted at first.
    const nodes = [node('a')];
    const ruler = measureBox({ label: 'G1', drawnPx: 0, scale: 1, nodes, canvas: letter }).rulerPt;
    const m = measureBox({ label: 'G1', drawnPx: ruler, scale: 1, nodes, canvas: letter });
    expect(m.agrees).toBe(true);
    expect(describeBox(m)).toBe(`${Math.round(ruler)}pt · ${(ruler / 72).toFixed(2)}in`);
    expect(describeBox(m)).not.toContain('ruler');
  });

  it('shows drawn, ruler and the signed gap on disagreement', () => {
    const nodes = [node('a')];
    const ruler = measureBox({ label: 'G1', drawnPx: 0, scale: 1, nodes, canvas: letter }).rulerPt;
    const out = describeBox(measureBox({ label: 'G1', drawnPx: ruler + 50, scale: 1, nodes, canvas: letter }));
    expect(out).toContain('drawn');
    expect(out).toContain('ruler');
    expect(out).toMatch(/\+\d+pt/);
  });
});

describe('runsFromGroupMap treats a group as a CONTIGUOUS block', () => {
  const nodes = [node('1'), node('2'), node('3'), node('4')];

  it('merges consecutive nodes of the same group into one run', () => {
    const map: GroupMap = { '1': g('A'), '2': g('A'), '3': g('B'), '4': g('B') };
    const runs = runsFromGroupMap(nodes, map);
    expect(runs.map((r) => r.id)).toEqual(['A', 'B']);
    expect(runs[0].nodes).toHaveLength(2);
  });

  it('does NOT merge the same group id across a gap — that would box content not in it', () => {
    const map: GroupMap = { '1': g('A'), '3': g('A') };     // node 2 and 4 ungrouped
    const runs = runsFromGroupMap(nodes, map);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.id === 'A')).toBe(true);
    expect(runs.every((r) => r.nodes.length === 1)).toBe(true);
  });

  it('does not merge across an intervening DIFFERENT group either', () => {
    const map: GroupMap = { '1': g('A'), '2': g('B'), '3': g('A') };
    expect(runsFromGroupMap(nodes, map).map((r) => r.id)).toEqual(['A', 'B', 'A']);
  });

  it('carries the group label through for the readout', () => {
    const runs = runsFromGroupMap(nodes, { '1': g('A', 'Past performance') });
    expect(runs[0].label).toBe('Past performance');
  });

  it('returns nothing when no node is grouped', () => {
    expect(runsFromGroupMap(nodes, {})).toEqual([]);
  });
});
