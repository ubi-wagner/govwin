/**
 * Brand + mandatory-table styling for the OPP sheet and the provisioned template.
 *
 * "Add the color" (EC / Ohio Third Frontier): mandatory native tables get a branded HEADER band
 * (accent fill + white text) and the "unmodifiable categories" (fixed category / total rows the EC
 * says applicants may not change — pro-forma Total revenues, Gross profit, Net profit, Equity
 * Investment, budget totals, …) get a light SHADE so a builder sees at a glance what is fixed vs
 * fill-in. Pure (no DB) — used by the cost-form/table generators and by the compliance/OPP render.
 */
import type { TableCell, TableContent, CanvasNode } from '@/lib/types/canvas-document';

/** Ohio Third Frontier / TVSF accent (matches the platform pptx/chart accent 1F4E79). */
export const TVSF_BRAND = {
  headerBg: '#1F4E79', // mandatory-table header band + OPP-card accent
  headerFg: '#FFFFFF', // header text (white on the accent)
  lockedBg: '#DCE6F1', // "unmodifiable" category / total row shade
} as const;

/** First-cell text of an UNMODIFIABLE row (fixed category / total) in a mandatory table. */
export const UNMODIFIABLE_ROW_RE =
  /^\s*(revenues|production expenses|other expenses|total revenues?|gross profit|total other expenses|net profit|equity investment|total(?!\s*other)|subtotal|grand total)\b/i;

const asCell = (c: string | TableCell): TableCell => (typeof c === 'string' ? { text: c } : c);

/** Apply the brand scheme to ONE table in place: header band + shaded unmodifiable rows. */
export function brandMandatoryTable(t: TableContent, opts?: { lockedRowRe?: RegExp | null }): TableContent {
  const lockedRe = opts && 'lockedRowRe' in opts ? opts.lockedRowRe : UNMODIFIABLE_ROW_RE;
  if (Array.isArray(t.headers)) {
    t.headers = t.headers.map((h) => {
      const c = asCell(h);
      return { ...c, style: { ...(c.style ?? {}), bg: TVSF_BRAND.headerBg, fg: TVSF_BRAND.headerFg, bold: true } };
    });
  }
  if (lockedRe && Array.isArray(t.rows)) {
    t.rows = t.rows.map((row) => {
      const label = (asCell(row[0] ?? '').text ?? '').trim();
      if (!lockedRe.test(label)) return row;
      return row.map((rc) => {
        const c = asCell(rc);
        return { ...c, style: { ...(c.style ?? {}), bg: TVSF_BRAND.lockedBg, bold: true } };
      });
    });
  }
  return t;
}

/** Apply the brand scheme to every `table` node in a canvas node list (in place). */
export function brandTablesInNodes(nodes: CanvasNode[], opts?: { lockedRowRe?: RegExp | null }): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === 'table' && node.content) { brandMandatoryTable(node.content as unknown as TableContent, opts); n += 1; }
  }
  return n;
}
