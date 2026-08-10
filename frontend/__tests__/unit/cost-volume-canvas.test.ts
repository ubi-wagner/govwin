import { describe, it, expect } from 'vitest';
import { buildCostVolumeCanvas, buildStarterCostVolume, provisionalCostInputs, parseStructuredCostInputs } from '@/lib/proposal/cost-volume-canvas';
import { computeBudget } from '@/lib/proposal/cost-model';
import type { CanvasNode, TableCell, TableContent } from '@/lib/types/canvas-document';

function tables(nodes: CanvasNode[]): TableContent[] {
  return nodes.filter((n) => n.type === 'table').map((n) => n.content as unknown as TableContent);
}
function headings(nodes: CanvasNode[]): string[] {
  return nodes.filter((n) => n.type === 'heading').map((n) => (n.content as { text: string }).text);
}
/** Find the amount cell (value) for a summary row whose first cell startsWith label. */
function summaryValue(nodes: CanvasNode[], label: string): number | undefined {
  for (const t of tables(nodes)) {
    for (const row of t.rows) {
      const first = row[0];
      const firstText = typeof first === 'string' ? first : first?.text ?? '';
      if (firstText.startsWith(label)) {
        const amt = row[1];
        return typeof amt === 'string' ? undefined : (amt as TableCell).value ?? undefined;
      }
    }
  }
  return undefined;
}

describe('cost-volume-canvas — computed universal cost volume', () => {
  const inputs = provisionalCostInputs();

  it('summary TOTAL PROPOSED PRICE equals the engine grand total (whole dollars)', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    const engine = computeBudget(inputs.labor, inputs.rates, { odcs: inputs.odcs, subs: inputs.subs, program: 'sttr' });
    expect(summaryValue(doc.nodes, 'TOTAL PROPOSED PRICE')).toBe(Math.round(engine.grand.totalPrice));
    expect(summaryValue(doc.nodes, 'TOTAL ESTIMATED COST')).toBe(Math.round(engine.grand.totalEstCost));
    expect(summaryValue(doc.nodes, 'A. Direct Labor')).toBe(Math.round(engine.grand.directLabor));
  });

  it('shows a Work-Share Compliance section for SBIR/STTR only', () => {
    const sttr = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    expect(headings(sttr.nodes)).toContain('Work-Share Compliance');
    // NSF/DOE (no SBIR/STTR work-share statute) → no work-share section, but full summary present
    const nsf = buildCostVolumeCanvas({ ...inputs, meta: { program: null, agency: 'National Science Foundation' } });
    expect(headings(nsf.nodes)).not.toContain('Work-Share Compliance');
    expect(headings(nsf.nodes)).toContain('Cost Summary');
    expect(summaryValue(nsf.nodes, 'TOTAL PROPOSED PRICE')).toBeGreaterThan(0);
  });

  it('every numeric table cell is finite (no NaN leaks into the canvas)', () => {
    const doc = buildStarterCostVolume({ program: 'sbir', agency: 'Department of War', companyName: 'Acme Robotics' });
    for (const t of tables(doc.nodes)) {
      for (const row of t.rows) {
        for (const cell of row) {
          if (typeof cell !== 'string' && cell.value != null) expect(Number.isFinite(cell.value)).toBe(true);
        }
      }
    }
    expect(doc.metadata.status).toBe('ai_drafted');
    expect(doc.nodes.length).toBeGreaterThan(4);
  });

  it('annotates the ceiling headroom / overage', () => {
    const under = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr', ceiling: 2_000_000 } });
    const overDoc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr', ceiling: 50_000 } });
    const textOf = (nodes: CanvasNode[]) => nodes.filter((n) => n.type === 'text_block').map((n) => (n.content as { text: string }).text).join('\n');
    expect(textOf(under.nodes)).toMatch(/within the solicitation ceiling/);
    expect(textOf(overDoc.nodes)).toMatch(/exceeds the solicitation ceiling/);
  });

  it('agency label appears in the top heading', () => {
    const doc = buildStarterCostVolume({ agency: 'Department of Energy' });
    expect(headings(doc.nodes)[0]).toBe('Cost Volume — Department of Energy');
  });
});

describe('parseStructuredCostInputs — canvas → typed inputs (readiness roll-up)', () => {
  const inputs = provisionalCostInputs();

  it('round-trips the generated workbook back to the same engine total', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    const parsed = parseStructuredCostInputs([{ content: JSON.stringify(doc) }]);
    expect(parsed).not.toBeNull();
    const re = computeBudget(parsed!.labor, parsed!.rates, { odcs: parsed!.odcs, subs: parsed!.subs });
    const orig = computeBudget(inputs.labor, inputs.rates, { odcs: inputs.odcs, subs: inputs.subs });
    expect(Math.round(re.grand.totalPrice)).toBe(Math.round(orig.grand.totalPrice));
    // rates + RI flag survive the round trip (RI column, not a label guess)
    expect(re.rates.fringePct).toBe(0.35);
    expect(parsed!.subs.some((s) => s.isResearchInstitution)).toBe(true);
    expect(parsed!.labor).toHaveLength(inputs.labor.length);
  });

  it('reflects an edit: dropping subs to zero raises SBC work share to 100%', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, subs: [], meta: { program: 'sttr' } });
    const parsed = parseStructuredCostInputs([{ content: JSON.stringify(doc) }])!;
    const b = computeBudget(parsed.labor, parsed.rates, { odcs: parsed.odcs, subs: parsed.subs });
    expect(b.workshare.subcontractShareOfPrice).toBe(0);
    expect(parsed.subs).toHaveLength(0);
  });

  it('returns null for a free-text (non-structured) cost canvas → caller falls back', () => {
    const freeform = {
      version: 1, canvas: {}, metadata: {},
      nodes: [{ id: 'x', type: 'table', content: { headers: ['Performer', 'Total'], rows: [['SBC', '$500,000']] }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false }],
    };
    expect(parseStructuredCostInputs([{ content: JSON.stringify(freeform) }])).toBeNull();
    expect(parseStructuredCostInputs([{ content: null }])).toBeNull();
    expect(parseStructuredCostInputs([])).toBeNull();
  });
});
