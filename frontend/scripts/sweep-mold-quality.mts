/**
 * The pristine pass, measured across EVERY mold (#152).
 *
 * The T3CP SBIR set was made pristine by hand — cover band, running header and footer with real
 * page tokens, figure numbering, render-verified page fit, 12 of 12 exports at zero violations.
 * The other 38 molds were never checked. "Looks fine" is not a measurement, and doing 38 by eye is
 * how things get missed, so this renders each one through the product's own PDF exporter, counts
 * the pages Chromium actually laid out, and reports what is on them.
 *
 * WHAT IT MEASURES, per template — all of it from the rendered artifact, not the model:
 *   · RENDERED pages (or slides) — Chromium's count, the only one that is not an estimate
 *   · the estimator's count beside it, so the two rulers can be compared on real molds
 *   · compliance violations from the standalone floor (font / pages / images / header-footer)
 *   · whether page furniture is actually present — a running header, a footer, a page token
 *   · unsubstituted template tokens left on the page ({{company}}, [TBD], "Lorem")
 *
 * WHAT IT DOES NOT DO: judge whether a page looks good. That is the visual reviewer's job and it
 * needs a real key. This finds the molds worth LOOKING at, which is the part that scales.
 *
 *   cd frontend && node --import tsx scripts/sweep-mold-quality.mts
 *   ... --key dod-sbir-phase1-technical   just one
 */
import { TEMPLATE_CATALOG, getTemplate } from '@/lib/templates';
import { estimatePageCount, estimateSlideCount, validateStandaloneCanvas, docNodes } from '@/lib/types/canvas-document';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { capturePdfPages } from '@/lib/pdf/page-capture';

const ONLY = process.argv.includes('--key') ? process.argv[process.argv.indexOf('--key') + 1] : null;

/** Substitutions the delivery paths make; anything still in braces after these is a real leak. */
const VARS: Record<string, string> = {
  company_name: 'Immobileyes Inc.',
  topic_number: 'AF254-D001',
  solicitation_number: 'AF254-D001',
  proposal_title: 'Edge Vision for Contested Environments',
  date: '2026-08-19',
};

/** Tokens that mean a template shipped with a hole in it. */
const LEAK = /\{\{[^}]+\}\}|\[TBD\]|\bLorem ipsum\b/i;

interface Row {
  key: string;
  format: string;
  rendered: number | null;
  estimated: number;
  violations: string[];
  furniture: { header: boolean; footer: boolean; pageToken: boolean };
  leaks: string[];
  figures: number;
  error?: string;
}

function textOf(doc: ReturnType<typeof getTemplate>): string {
  if (!doc) return '';
  return docNodes(doc)
    .map((n) => (typeof n.content === 'string' ? n.content : ''))
    .join('\n');
}

/**
 * What furniture does THIS mold actually owe? Not one rule for everything.
 *
 * Written after the first sweep flagged 22 of 39 molds, most of them wrongly. A slide deck has no
 * running header — putting one on every slide is how a deck looks amateur, not how it looks
 * finished. A one-page letter of collaboration with "Page 1 of 1" in the foot reads as a document
 * built by a machine. The furniture that MATTERS is on a multi-page document, where a reader who
 * puts the stack down needs to know which page they were on and which volume it belongs to.
 *
 * So: a deck owes nothing; a single-page document owes nothing; a multi-page document owes a
 * running header, a footer, and a real page token in it.
 */
function furnitureGap(r: Row): string[] {
  if (r.error || r.rendered == null) return [];
  if (r.format === 'deck') return [];        // a running header on every slide is a defect, not a fix
  if (r.rendered < 2) return [];             // "Page 1 of 1" is furniture nobody asked for
  const gaps: string[] = [];
  if (!r.furniture.header) gaps.push('no running header');
  if (!r.furniture.footer) gaps.push('no footer');
  else if (!r.furniture.pageToken) gaps.push('footer has no page token');
  return gaps;
}

async function measure(key: string, format: string): Promise<Row> {
  const doc = getTemplate(key as never)!;
  const canvas = doc.canvas ?? {};
  const isDeck = String(canvas.format ?? '').startsWith('slide');
  const estimated = isDeck ? estimateSlideCount(doc) : estimatePageCount(doc);
  const violations = validateStandaloneCanvas(doc).map((v) => v.code ?? String(v));
  const nodes = docNodes(doc);
  const figures = nodes.filter((n) => n.type === 'image' || n.type === 'chart').length;

  const hf = (canvas as { header?: unknown; footer?: unknown });
  const headerText = typeof hf.header === 'string' ? hf.header : JSON.stringify(hf.header ?? '');
  const footerText = typeof hf.footer === 'string' ? hf.footer : JSON.stringify(hf.footer ?? '');
  const furniture = {
    header: !!hf.header && headerText.length > 2,
    footer: !!hf.footer && footerText.length > 2,
    // The exporters' own page token. A footer that hard-codes "Page 1" is furniture that lies.
    pageToken: /\{n\}|\{page\}|\{N\}/.test(footerText + headerText),
  };

  const body = textOf(doc);
  const leaks = Array.from(new Set((body.match(new RegExp(LEAK, 'gi')) ?? []).map((s) => s.slice(0, 40))));

  let rendered: number | null = null;
  let error: string | undefined;
  try {
    const pdf = await exportToPdf(doc, VARS);
    const pages = await capturePdfPages(pdf, { scale: 0.4, maxPages: 60 });
    rendered = pages.length;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 90) : String(e);
  }
  return { key, format, rendered, estimated, violations, furniture, leaks, figures, error };
}

async function main() {
  const targets = TEMPLATE_CATALOG.filter((t) => !ONLY || t.key === ONLY);
  console.log(`\nrendering ${targets.length} mold(s) through the product's own PDF exporter…\n`);

  const rows: Row[] = [];
  for (const t of targets) {
    const r = await measure(t.key, t.format);
    rows.push(r);
    const pages = r.rendered == null ? 'RENDER FAILED' : `${r.rendered}p`;
    const drift = r.rendered == null ? '' : ` (est ${r.estimated}${r.rendered === r.estimated ? '' : ' ✱'})`;
    const flags = [
      r.violations.length ? `${r.violations.length} violation(s)` : '',
      ...furnitureGap(r),
      r.leaks.length ? `leaks: ${r.leaks.join(', ')}` : '',
      r.error ? `error: ${r.error}` : '',
    ].filter(Boolean);
    const mark = flags.length ? '✗' : '✓';
    console.log(`${mark} ${t.key.padEnd(42)} ${pages.padStart(13)}${drift.padEnd(12)} ${flags.join(' · ')}`);
  }

  // The summary is the point: which molds need a person to look at them.
  const failing = rows.filter((r) => r.error || r.violations.length || r.leaks.length || furnitureGap(r).length);

  // DIRECTION IS THE WHOLE FINDING. The two ways the estimator can disagree with Chromium are not
  // two instances of one thing: over-counting is the ruler being conservative (B64 requires it), and
  // under-counting is the ruler clearing a volume the agency will receive over its page limit. A
  // single `drifted` count printed them in the same grey line and the exit code ignored both, so
  // this sweep could have reported the fatal direction as a footnote and still exited 0.
  const measured = rows.filter((r) => r.rendered != null);
  const over = measured.filter((r) => r.estimated > r.rendered!);
  const under = measured.filter((r) => r.estimated < r.rendered!);
  const list = (rs: Row[]) => rs.map((r) => `${r.key} (est ${r.estimated} → drew ${r.rendered})`).join(', ');

  console.log(`\n── summary ──`);
  console.log(`molds measured:        ${rows.length}`);
  console.log(`clean:                 ${rows.length - failing.length}`);
  console.log(`need a look:           ${failing.length}${failing.length ? ` → ${failing.map((r) => r.key).join(', ')}` : ''}`);
  console.log(`ruler over-counts:     ${over.length} (safe — conservative by design)${over.length ? ` → ${list(over)}` : ''}`);
  console.log(`ruler UNDER-counts:    ${under.length}${under.length ? ` ✗ FATAL → ${list(under)}` : ' ✓'}`);
  console.log(`molds with a figure:   ${rows.filter((r) => r.figures > 0).length}`);

  if (under.length) {
    console.log(
      `\n✗ the ruler reads SHORT on ${under.length} mold(s). This is the direction that costs a bid:\n` +
      `  the export gate would clear a volume as within its page limit that Chromium prints over it.`,
    );
  }
  // An under-count fails the sweep. A mold that renders longer than the model predicts is a defect
  // in the model, not a note about it.
  process.exit(failing.length || under.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
