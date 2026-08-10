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
  // Parse a money cell, expanding a K/M/B magnitude suffix ("$1.2M" → 1_200_000, "$550K" → 550_000).
  const num = (s: string): number => {
    const t = s.replace(/[$,\s]/g, '');
    const m = t.match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!m) return NaN;
    let v = parseFloat(m[1]);
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
    return v;
  };
  const isYear = (s: string) => /^(?:fy)?(?:19|20)\d{2}$/i.test(s.replace(/[$,\s]/g, ''));
  // The row's amount: the largest money value, ignoring bare year cells (FY2026, 2026) unless a row
  // is nothing BUT a year (then we still can't use it as money → 0).
  const rowAmount = (cells: string[]): number => {
    const vals = cells.map((c) => ({ v: num(c), year: isYear(c) }));
    const money = vals.filter((x) => Number.isFinite(x.v) && !x.year).map((x) => x.v);
    return money.length ? Math.max(0, ...money) : 0;
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
        const amount = rowAmount(cells.slice(1));
        if (!(amount > 0)) continue;
        // RI: research institutions are usually named (universities/institutes/colleges/labs), so match
        // the common entity words too, not just the literal phrase "research institution".
        if (/small business|\bsbc\b|\bsb\b|\bprime\b|proposing firm/.test(label)) { sb += amount; found = true; }
        else if (/research institution|\buniv(?:ersity|\.)?\b|\binstitute\b|\bcollege\b|laborator/.test(label) || /\bri\b/.test(label)) { ri += amount; found = true; }
        else if (/subcontract|consultant|\bother\b/.test(label)) { other += amount; }
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
