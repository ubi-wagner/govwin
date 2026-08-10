import { describe, it, expect } from 'vitest';
import { computeSttrSplit } from '@/lib/proposal/sttr-split';

// Build a Cost Volume section whose canvas carries a work-split table with performer-labeled totals.
function costSection(rows: Array<[string, string]>): { content: string } {
  const doc = {
    version: 1,
    nodes: [
      { id: 'n1', type: 'table', content: { headers: ['Performer', 'Total Cost'], rows }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
    ],
    canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, max_pages: null, min_font_size: 10, font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1, header: null, footer: null, max_slides: null },
    metadata: { title: 'Cost Volume', version_number: 1, status: 'accepted' },
  };
  return { content: JSON.stringify(doc) };
}

describe('computeSttrSplit — STTR work-split from the Cost Volume', () => {
  it('computes SB / RI percentages from labeled cost totals and passes the 40/30 floor', () => {
    const r = computeSttrSplit([costSection([
      ['Small Business Concern', '$550,000'],
      ['Research Institution (University)', '$350,000'],
      ['Robotics Subcontractor', '$100,000'],
    ])]);
    expect(r.found).toBe(true);
    expect(r.total).toBe(1_000_000);
    expect(Math.round(r.sbPct)).toBe(55);
    expect(Math.round(r.riPct)).toBe(35);
    expect(r.sbPct >= 40 && r.riPct >= 30).toBe(true);
  });

  it('flags an out-of-bounds split (small business under 40%)', () => {
    const r = computeSttrSplit([costSection([
      ['Small Business Concern', '350000'],
      ['Research Institution', '350000'],
      ['Subcontractor', '300000'],
    ])]);
    expect(r.found).toBe(true);
    expect(Math.round(r.sbPct)).toBe(35); // 350k / 1M
    expect(r.sbPct >= 40 && r.riPct >= 30).toBe(false); // SB below the 40% minimum
  });

  it('flags an out-of-bounds split (research institution under 30%)', () => {
    const r = computeSttrSplit([costSection([
      ['Small Business Concern', '700000'],
      ['Research Institution', '200000'],
      ['Subcontractor', '100000'],
    ])]);
    expect(Math.round(r.riPct)).toBe(20);
    expect(r.riPct >= 30).toBe(false);
  });

  it('reports not-computable when the cost volume has no performer-labeled totals', () => {
    const r = computeSttrSplit([costSection([
      ['Direct Labor', '400000'],
      ['Materials', '100000'],
    ])]);
    expect(r.found).toBe(false);
  });

  it('is empty (not computable) for an absent cost volume', () => {
    expect(computeSttrSplit([]).found).toBe(false);
    expect(computeSttrSplit([{ content: null }]).found).toBe(false);
  });
});
