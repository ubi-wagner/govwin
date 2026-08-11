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

/**
 * The number-format presets the sheet UI offers. `code` is an Excel format code, so the SAME
 * value carries straight into the .xlsx export (the xlsx exporter already applies
 * `cell.number_format` as `numFmt`) — one source of truth, no display-vs-export drift.
 */
export const NUMBER_FORMATS: { label: string; code: string }[] = [
  { label: 'Plain',        code: '' },
  { label: 'Number 1,000', code: '#,##0' },
  { label: 'Number 1,000.00', code: '#,##0.00' },
  { label: 'Currency $',   code: '$#,##0.00' },
  { label: 'Currency $0',  code: '$#,##0' },
  { label: 'Percent %',    code: '0%' },
  { label: 'Percent 0.0%', code: '0.0%' },
];

/**
 * Format a numeric value for DISPLAY per a (subset of) Excel format code — the presets above
 * plus any code shaped like them (`$` → currency, `%` → percent×100, `.00`/`.0` → decimals,
 * `,` → grouping). Not a full Excel engine; an unknown code falls back to a grouped number so
 * we never show something worse than the raw value.
 */
export function formatByCode(value: number, code: string | undefined): string {
  if (!code) return String(value);
  const isPct = code.includes('%');
  const hasCurrency = code.includes('$');
  const grouped = code.includes(',');
  const decimals = /\.0{2,}/.test(code) ? 2 : /\.0/.test(code) ? 1 : 0;
  const n = isPct ? value * 100 : value;
  const neg = n < 0;
  const body = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return `${neg ? '-' : ''}${hasCurrency ? '$' : ''}${body}${isPct ? '%' : ''}`;
}

/**
 * The text a table cell should SHOW (read view / grid, not while editing): a number-formatted
 * cell with a numeric `value` renders formatted; everything else shows its raw `text`.
 */
export function formatCellDisplay(cell: { text?: string; number_format?: string; value?: number | null } | string): string {
  if (typeof cell === 'string') return cell;
  if (cell.number_format && typeof cell.value === 'number') return formatByCode(cell.value, cell.number_format);
  return cell.text ?? '';
}
