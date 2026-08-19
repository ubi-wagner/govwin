import { describe, it, expect } from 'vitest';
import { buildCostVolumeCanvas, buildStarterCostVolume, provisionalCostInputs, parseStructuredCostInputs } from '@/lib/proposal/cost-volume-canvas';
import { computeBudget } from '@/lib/proposal/cost-model';
import type { CanvasNode, TableCell, TableContent } from '@/lib/types/canvas-document';
import { docNodes } from '@/lib/types/canvas-document';

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

  it('summary TOTAL PROPOSED PRICE equals the engine grand total (full-precision value; whole-dollar display)', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    const engine = computeBudget(inputs.labor, inputs.rates, { odcs: inputs.odcs, subs: inputs.subs, program: 'sttr' });
    // The cell `value` now carries full precision (F3 fix); the display text is whole dollars.
    expect(summaryValue(doc.nodes, 'TOTAL PROPOSED PRICE')).toBeCloseTo(engine.grand.totalPrice, 4);
    expect(summaryValue(doc.nodes, 'TOTAL ESTIMATED COST')).toBeCloseTo(engine.grand.totalEstCost, 4);
    expect(summaryValue(doc.nodes, 'A. Direct Labor')).toBeCloseTo(engine.grand.directLabor, 4);
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

  it('money value carries full precision: a fractional labor rate round-trips exactly (F3)', () => {
    const doc = buildCostVolumeCanvas({
      labor: [{ name: 'PI', category: 'PI', hours: 500, unburdenedRate: 85.75 }],
      rates: { fringePct: 0.35, overheadPct: 0.45, gnaPct: 0.15, feePct: 0.07 },
      odcs: [], subs: [], meta: { program: 'sttr' },
    });
    const parsed = parseStructuredCostInputs([{ content: JSON.stringify(doc) }])!;
    expect(parsed.labor[0].unburdenedRate).toBe(85.75); // not 86 (whole-dollar display) — precise value
  });

  it('honors a tenant edit: a synced numeric cell + a plain-string new row both read correctly (F1/F4)', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    const labor = doc.nodes.find((n) => n.type === 'table' && (n.content as { sheet_name?: string }).sheet_name === 'Labor')!;
    const rows = (labor.content as { rows: (string | { text: string; value?: number })[][] }).rows;
    // Fixed editor writes BOTH text and value on an edit → parser reads the new number.
    rows[0][3] = { text: '800', value: 800 }; // PI hours 500 → 800 (col 3)
    // A brand-new row is plain strings (no value) — the parser must read the visible text, incl. "$1.2M".
    const subs = doc.nodes.find((n) => n.type === 'table' && (n.content as { sheet_name?: string }).sheet_name === 'Subs')!;
    (subs.content as { rows: unknown[][] }).rows.unshift(['New Partner', 'extra work', 'Subcontractor', '$1.2M']);
    const parsed = parseStructuredCostInputs([{ content: JSON.stringify(doc) }])!;
    expect(parsed.labor[0].hours).toBe(800);
    expect(parsed.subs.some((s) => s.amount === 1_200_000)).toBe(true); // "$1.2M" expanded, not read as $1.20
  });

  it('parser reads visible text when a cell has no machine value (defense-in-depth)', () => {
    const doc = buildCostVolumeCanvas({ ...inputs, meta: { program: 'sttr' } });
    const labor = doc.nodes.find((n) => n.type === 'table' && (n.content as { sheet_name?: string }).sheet_name === 'Labor')!;
    const rows = (labor.content as { rows: (string | { text: string; value?: number })[][] }).rows;
    rows[0][3] = { text: '900' }; // text-only edit, no value → parser must fall back to the text
    const parsed = parseStructuredCostInputs([{ content: JSON.stringify(doc) }])!;
    expect(parsed.labor[0].hours).toBe(900);
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

// ── computed figures ─────────────────────────────────────────────────────────
describe('the cost volume carries its own computed figures', () => {
  // The numbers were all already there; nothing plotted them. A cost evaluator reads the SHAPE of
  // a build-up, and `chart` nodes export natively to docx/pptx/xlsx/pdf, so these reach every
  // download rather than being an editor-only flourish.
  const built = (program: string) => buildCostVolumeCanvas({
    ...provisionalCostInputs(),
    meta: { program, agency: 'DoW', ceiling: 250_000 },
  });

  it('plots the burden waterfall from the SAME numbers the summary table prints', () => {
    const doc = built('sbir');
    const nodes = docNodes(doc);
    const chart = nodes.find((n) => n.type === 'chart'
      && (n.content as { title?: string }).title === 'Cost build-up by element');
    expect(chart, 'no cost build-up chart').toBeTruthy();

    const c = chart!.content as { categories: string[]; series: Array<{ data: number[] }> };
    // Every plotted element must also appear in the Summary table — the chart adds no claim.
    const summary = nodes.find((n) => n.type === 'table'
      && (n.content as { sheet_name?: string }).sheet_name === 'Summary');
    const summaryText = JSON.stringify(summary!.content);
    for (const cat of c.categories) {
      const key = cat.split(' ')[0].replace('&', '&');   // 'Direct', 'Fringe', 'Overhead', 'G&A'…
      expect(summaryText, `${cat} plotted but absent from Summary`).toContain(key);
    }
    expect(c.series[0].data.every((v) => v > 0)).toBe(true); // no empty bars
  });

  it('plots the work split for a program that HAS a work-share floor', () => {
    const nodes = docNodes(built('sttr'));
    const split = nodes.find((n) => n.type === 'chart'
      && (n.content as { title?: string }).title === 'Work share of the research effort');
    expect(split).toBeTruthy();
    const c = split!.content as { series: Array<{ data: number[] }> };
    // the two slices are a split — they sum to 100
    expect(Math.round(c.series[0].data.reduce((a, b) => a + b, 0))).toBe(100);
  });

  it('omits the work-split chart where there is no floor to show', () => {
    const nodes = docNodes(built('baa'));
    expect(nodes.find((n) => n.type === 'chart'
      && (n.content as { title?: string }).title === 'Work share of the research effort')).toBeUndefined();
    // …but the build-up is universal
    expect(nodes.some((n) => n.type === 'chart')).toBe(true);
  });

  it('gives every chart a caption', () => {
    const nodes = docNodes(built('sbir'));
    const charts = nodes.filter((n) => n.type === 'chart').length;
    const captions = nodes.filter((n) => n.type === 'caption').length;
    expect(captions).toBeGreaterThanOrEqual(charts);
  });
});
