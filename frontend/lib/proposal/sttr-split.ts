/**
 * STTR cooperative work-split — COMPUTED from the Cost Volume (not asserted in prose).
 *
 * Sums the numeric totals in the cost-volume tables by performer label and returns the split by
 * cost. STTR statute (15 USC 638) requires the small business to perform ≥40% and the single
 * research institution ≥30% of the work, measured by direct + indirect costs.
 *
 * Pure (no DB / no side effects) so it is unit-testable and reusable by the readiness roll-up.
 */
import { coerceJsonb } from '@/lib/jsonb';
import { docNodes, type CanvasDocument } from '@/lib/types/canvas-document';

export interface SttrSplit {
  sbPct: number;
  riPct: number;
  total: number;
  /** true only when at least one Small-Business or Research-Institution total was found. */
  found: boolean;
}

export function computeSttrSplit(costSections: Array<{ content: string | null }>): SttrSplit {
  const cellText = (c: unknown): string =>
    typeof c === 'string'
      ? c
      : c && typeof (c as { text?: string }).text === 'string'
        ? (c as { text: string }).text
        : '';
  const num = (s: string): number => {
    const m = s.replace(/[$,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  };

  let sb = 0, ri = 0, other = 0, found = false;
  for (const sec of costSections) {
    const doc = coerceJsonb<CanvasDocument | null>(sec.content, null);
    if (!doc) continue;
    for (const node of docNodes(doc)) {
      if (node.type !== 'table') continue;
      const rows = (node.content as { rows?: unknown[][] })?.rows ?? [];
      for (const row of rows) {
        const cells = (row ?? []).map(cellText);
        const label = (cells[0] ?? '').toLowerCase();
        const amount = Math.max(0, ...cells.slice(1).map(num).filter((n) => Number.isFinite(n)));
        if (!(amount > 0)) continue;
        if (/small business|\bsbc\b|\bsb\b|prime|proposing firm/.test(label)) { sb += amount; found = true; }
        else if (/research institution|university|\bri\b/.test(label)) { ri += amount; found = true; }
        else if (/subcontract|consultant|other/.test(label)) { other += amount; }
      }
    }
  }
  const total = sb + ri + other;
  return {
    sbPct: total > 0 ? (sb / total) * 100 : 0,
    riPct: total > 0 ? (ri / total) * 100 : 0,
    total,
    found: found && total > 0,
  };
}
