import { describe, it, expect } from 'vitest';
import { resolveCostForm, buildSf424aCanvas, buildOtfStateBudgetCanvas, buildCostVolume, provisionalOtfLines } from '@/lib/proposal/cost-forms';
import { computeBudget } from '@/lib/proposal/cost-model';
import { provisionalCostInputs } from '@/lib/proposal/cost-volume-canvas';
import type { CanvasNode, TableCell, TableContent } from '@/lib/types/canvas-document';

const NOW = '2026-08-10T00:00:00Z';
function rowValue(nodes: CanvasNode[], startsWith: string): number | undefined {
  for (const n of nodes) {
    if (n.type !== 'table') continue;
    for (const row of (n.content as unknown as TableContent).rows) {
      const first = row[0];
      const label = typeof first === 'string' ? first : first?.text ?? '';
      if (label.startsWith(startsWith)) {
        const amt = row[1];
        return typeof amt === 'string' ? undefined : (amt as TableCell).value ?? undefined;
      }
    }
  }
  return undefined;
}

describe('resolveCostForm — pick the common form from the opportunity', () => {
  it('Ohio TVSF → otf_state_budget', () => {
    expect(resolveCostForm({ agency: 'Ohio Third Frontier', program: 'tvsf' })).toBe('otf_state_budget');
    expect(resolveCostForm({ volumeFormat: 'tvsf_budget' })).toBe('otf_state_budget');
  });
  it('NSF / DOE → sf424a', () => {
    expect(resolveCostForm({ agency: 'National Science Foundation' })).toBe('sf424a');
    expect(resolveCostForm({ agency: 'Department of Energy' })).toBe('sf424a');
    expect(resolveCostForm({ volumeFormat: 'sf424a' })).toBe('sf424a');
  });
  it('DoD / DoW / unknown → burden_waterfall (default)', () => {
    expect(resolveCostForm({ agency: 'Department of the Navy (DON)', program: 'sttr' })).toBe('burden_waterfall');
    expect(resolveCostForm({ agency: 'Department of War', program: 'sbir_phase_1' })).toBe('burden_waterfall');
    expect(resolveCostForm({})).toBe('burden_waterfall');
  });
});

describe('SF-424A — Section B categories driven by the same engine', () => {
  const inputs = provisionalCostInputs();
  it('k (TOTALS) = Total Direct + Indirect, and equals the engine Total Estimated Cost (no grant fee)', () => {
    const doc = buildSf424aCanvas({ ...inputs, meta: { agency: 'National Science Foundation' } }, NOW);
    const eng = computeBudget(inputs.labor, inputs.rates, { odcs: inputs.odcs, subs: inputs.subs });
    const total = rowValue(doc.nodes, 'k. TOTALS');
    const direct = rowValue(doc.nodes, 'i. Total Direct');
    const indirect = rowValue(doc.nodes, 'j. Indirect');
    expect(total).toBe(Math.round(eng.grand.totalEstCost)); // direct + indirect, fee excluded
    expect(total).toBe((direct ?? 0) + (indirect ?? 0));
    expect(rowValue(doc.nodes, 'a. Personnel')).toBe(Math.round(eng.grand.directLabor));
    expect(rowValue(doc.nodes, 'f. Contractual')).toBe(Math.round(eng.grand.subcontracts));
    expect(doc.metadata.status).toBe('ai_drafted');
  });
});

describe('OTF / state project budget (Ohio TVSF Round-45 Budget volume)', () => {
  it('provisional lines fill to the $200k cap with Personnel at exactly the 20% ceiling', () => {
    const lines = provisionalOtfLines(200000, 0.2);
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const personnel = lines.find((l) => l.type === 'Personnel')!.amount;
    expect(total).toBe(200000);        // fills the cap, does not exceed
    expect(personnel).toBe(40000);     // 20% of 200k
    expect(personnel / total).toBeCloseTo(0.2, 6);
  });

  it('renders the spend-type table + a PASS compliance panel at the cap', () => {
    const doc = buildOtfStateBudgetCanvas({ lines: provisionalOtfLines(), meta: { agency: 'Ohio Third Frontier', ceiling: 200000, personnelMaxPct: 0.2, costShareAllowed: false } }, NOW);
    expect(rowValue(doc.nodes, 'Total OTF Project Funds')).toBe(200000);
    // compliance panel present with the ask + personnel + cost-share rows
    const text = doc.nodes.filter((n) => n.type === 'heading').map((n) => (n.content as { text: string }).text);
    expect(text).toContain('Budget Compliance');
    // OVER flagged when a line pushes past the cap
    const over = buildOtfStateBudgetCanvas({ lines: [{ type: 'Personnel', amount: 120000 }, { type: 'Equipment', amount: 120000 }], meta: { ceiling: 200000, personnelMaxPct: 0.2 } }, NOW);
    const flags = over.nodes.flatMap((n) => n.type === 'table' ? (n.content as unknown as TableContent).rows : []).flat().map((c) => (typeof c === 'string' ? c : c.text));
    expect(flags).toContain('OVER'); // ask 240k > 200k AND personnel 50% > 20%
  });
});

describe('buildCostVolume — dispatcher', () => {
  it('routes each form to the right renderer', () => {
    const wf = buildCostVolume('burden_waterfall', { program: 'sttr' });
    const gr = buildCostVolume('sf424a', { agency: 'NSF' });
    const st = buildCostVolume('otf_state_budget', { agency: 'Ohio Third Frontier', ceiling: 200000, personnelMaxPct: 0.2, costShareAllowed: false });
    const heads = (d: typeof wf) => d.nodes.filter((n) => n.type === 'heading').map((n) => (n.content as { text: string }).text);
    expect(heads(wf).some((t) => /Cost Volume/.test(t))).toBe(true);
    expect(heads(gr).some((t) => /SF-424A/.test(t))).toBe(true);
    expect(heads(st).some((t) => t === 'Budget' || /Budget —/.test(t))).toBe(true);
    expect(rowValue(st.nodes, 'Total OTF Project Funds')).toBe(200000);
  });
});
