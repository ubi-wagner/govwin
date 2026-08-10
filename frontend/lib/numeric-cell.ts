/**
 * Parse the numeric value a user sees/types in a table cell.
 *
 * One shared parser so every consumer agrees on money/percent formats: `$`, thousands commas,
 * a trailing `%` (→ fraction), K/M/B magnitude suffixes ("$1.2M" → 1_200_000), and accounting
 * negatives "(5,000)". Returns undefined when the text holds no number (a label, blank, "TBD").
 *
 * Used by the canvas editors (to keep a cell's numeric `value` in sync with an edited `text`) and
 * by the cost-volume parser (readiness roll-up), so an edited cell is read back as what it shows.
 */
export function parseNumericText(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  let t = raw.trim();
  if (!t) return undefined;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); } // accounting negative
  const pct = t.includes('%');
  t = t.replace(/[$,\s%]/g, '');
  const m = t.match(/^(-?\d*\.?\d+)\s*([kmb])?$/i);
  if (!m) return undefined;
  let v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return undefined;
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') v *= 1e3; else if (suf === 'm') v *= 1e6; else if (suf === 'b') v *= 1e9;
  if (pct) v /= 100;
  return neg ? -v : v;
}

/** True when a table cell is meant to hold a number (so an edit should re-derive its `value`). */
export function isNumericCell(cell: { cell_type?: string; number_format?: string; value?: unknown } | null | undefined): boolean {
  if (!cell) return false;
  if (typeof cell.value === 'number') return true;
  if (cell.cell_type && ['number', 'currency', 'percent', 'formula'].includes(cell.cell_type)) return true;
  return !!cell.number_format;
}
